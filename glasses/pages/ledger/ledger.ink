<script def>
{
  "navigationBarTitleText": "台账"
}
</script>

<script setup>
export default {
  data: {
    loading: true,
    rows: [],
    monthLabels: [],
    userName: '未绑定'
  },

  onLoad() {
    const app = this.app();
    const cfg = app ? app.getUserConfig() : {};
    if (cfg && cfg.name) this.setData({ userName: cfg.name });
    this._destroyed = false;
    // ⚠️ 缓存秒开（2026-08-26）：当日已有台账缓存 → 直接显示，再静默刷新——
    //    AIUI 网络冷启动开销大，每次进入重拉 /heatmap 很慢（后端实测 ~50ms 很快）
    const cached = app && app.getPageCache ? app.getPageCache('heatmap') : null;
    if (cached && cached.rows) {
      this.setData({ rows: cached.rows, monthLabels: cached.monthLabels || [], loading: false });
    }
    this.queryHeatmap();
  },

  onUnload() {
    // 页面销毁：标记已销毁，pending 的 /heatmap 回调不再 setData（释放网络槽位）
    this._destroyed = true;
  },

  onVoiceWakeup() {
    if (this._destroyed) return;
    this.queryHeatmap();
  },

  app() {
    try {
      return typeof getApp === 'function' ? getApp() : null;
    } catch (e) { return null; }
  },

  async queryHeatmap() {
    const app = this.app();
    if (!app) return;
    try {
      const data = await app.request({ url: '/heatmap' });
      // 页面已销毁：结果丢弃，不 setData
      if (this._destroyed) return;
      let rows = null;
      // 直供模式：mock/后端直接返回完整 rows（每格含 cls/style），本页不再自行算日期，
      // 彻底规避真机时钟/两套日期计算错位。
      if (data && Array.isArray(data.rows) && data.rows.length > 0) {
        rows = data.rows;
      } else {
        // 兼容模式：后端仅返回 amounts/draws，本页自行 buildRows
        this._amounts = (data && data.amounts) || {};
        this._draws = (data && data.draws) || null;
        rows = this.buildRows();
      }
      this.setData({ rows, monthLabels: this.buildMonths(rows), loading: false });
      // 写页面缓存（再次进入秒开）
      if (app.setPageCache) {
        app.setPageCache('heatmap', { rows, monthLabels: this.data.monthLabels });
      }
    } catch (e) {
      if (!this._destroyed) this.setData({ loading: false });
    }
  },

  // 最近 12 周 × 6 个开奖日（周一/二/三/四/六/日，周五跳过）
  // ⚠️ 三态语义（用户澄清，2026-08-25）：
  //   1) 已购（amounts 有值）→ 按金额亮度着色（hl2-hl5）——含"今天已购未开奖"（原 noDraw 误判空心）
  //   2) 未购但已开奖（amounts 无 + draws 有）→ ¥0 浅色填充（hl1 0.06，非空心）
  //   3) 未购且未开奖 / 无历史开奖信息（amounts 无 + draws 无）→ 空心（hl0 边框）
  //   amounts/draws 均为后端权威（服务器时间生成），完全不依赖本地时钟
  buildRows() {
    const app = this.app();
    let today = new Date();
    const srv = app && app.globalData && app.globalData.serverNow;
    if (srv) {
      today = new Date(new Date(srv).getTime() + 8 * 3600 * 1000); // 服务器 GMT → 北京时间
    }
    const thisMonday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - ((today.getUTCDay() || 7) - 1)));
    const rowsDef = [
      { label: '周一', lottery: '大乐透', offset: 0 },
      { label: '周二', lottery: '双色球', offset: 1 },
      { label: '周三', lottery: '大乐透', offset: 2 },
      { label: '周四', lottery: '双色球', offset: 3 },
      { label: '周六', lottery: '大乐透', offset: 5 },
      { label: '周日', lottery: '双色球', offset: 6 }
    ];
    const rows = rowsDef.map((r) => {
      const cells = [];
      for (let w = 11; w >= 0; w -= 1) {
        const d = new Date(Date.UTC(thisMonday.getUTCFullYear(), thisMonday.getUTCMonth(), thisMonday.getUTCDate() - w * 7 + r.offset));
        const key = this.dateKey(d);
        const hasAmount = this._amounts[key] != null; // 是否已购
        const hasDraw = this._draws ? !!this._draws[key] : false; // 是否有开奖记录
        const level = hasAmount ? this._amounts[key] : 0;
        cells.push({
          key,
          level,
          // 预计算格子 class（AIUI 模板不支持方法调用，必须整值绑定）
          cls: this.cellClass(hasAmount, hasDraw, level),
          // 内联 style 兜底：亮度/空心直接内联（类选择器渲染在部分环境不可靠）
          style: this.cellStyle(hasAmount, hasDraw, level)
        });
      }
      return { label: r.label, lottery: r.lottery, cells };
    });
    return rows;
  },

  // 月份图例：列 1/5/9/12 所在日期（预计算绝对定位 style，含 32px 周一列偏移）
  buildMonths(rows) {
    if (!rows || rows.length === 0) return [];
    const idxs = [0, 4, 8, 11];
    return idxs.map((i) => {
      const key = rows[0].cells[i].key;
      const month = parseInt(key.slice(5, 7), 10);
      const left = 32 + i * 22;
      return { left, label: month + '月', style: 'left: ' + left + 'px;' };
    });
  },

  dateKey(d) {
    // 统一用 UTC getter（buildRows 全程 UTC 计算，与后端 Asia/Shanghai 日期键对齐）
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    return d.getUTCFullYear() + '-' + mm + '-' + dd;
  },

  // 格子三态：已购→按金额 hl2-hl5；未购已开奖→0 元 hl1 浅填充；未购未开奖/无开奖信息→hl0 空心
  // 返回双类名 'heat hlN'（.heat 基类 + .hlN 独立亮度类——多类组合选择器官方不支持）
  // ⚠️ 映射对齐（2026-08-26 修复）：后端 /heatmap amounts 分级 toLevel = 1(≤¥4 小额)～
  //    4(≥¥30 最深档)；设计 5 阶 = hl2 小额(0.24) / hl3 中额(0.48) / hl4 较大(0.72) / hl5 ≥¥50(1)。
  //    原映射 {0:'hl2',1:'hl3',...} 整体偏深一档（1 注显示成中额亮度），已修正。
  cellClass(hasAmount, hasDraw, level) {
    if (!hasAmount) return hasDraw ? 'heat hl1' : 'heat hl0';
    const map = { 1: 'hl2', 2: 'hl3', 3: 'hl4', 4: 'hl5' };
    return 'heat ' + (map[level] != null ? map[level] : 'hl2');
  },

  // 内联 style 亮度（与类方案并行，渲染优先走内联）：
  // 避免依赖类选择器/CSS 属性在 AIUI 的不确定行为；rgba 背景色 + 边框与图例同机制
  // ⚠️ 映射对齐（2026-08-26 修复）：level 1-4 = 0.24/0.48/0.72/1（小额→≥¥50），
  //    原 map 0→0.24 起整体偏深一档（1 注显示成中额亮度），已修正。
  cellStyle(hasAmount, hasDraw, level) {
    if (!hasAmount) {
      // 未购：已开奖 → 0 元浅填充；未开奖/无开奖信息 → 空心（边框）
      return hasDraw
        ? 'background-color: rgba(64,255,94,0.06);'
        : 'border: 1px solid rgba(64,255,94,0.24); background-color: rgba(64,255,94,0.06);';
    }
    const map = {
      1: 'background-color: rgba(64,255,94,0.24);',
      2: 'background-color: rgba(64,255,94,0.48);',
      3: 'background-color: rgba(64,255,94,0.72);',
      4: 'background-color: rgba(64,255,94,1);'
    };
    return map[level] != null ? map[level] : map[1];
  },

  // ---- 键位：唯一按钮（返回） ----
  onKeyDown(event) {
    const code = event && event.code;
    if (code === 'ArrowUp' || code === 'ArrowDown') {
      event.preventDefault();
    }
  },

  onKeyUp(event) {
    const code = event && event.code;
    if (code === 'Enter' || code === 'Backspace') {
      event.preventDefault();
      this.backHome();
    } else if (code === 'ArrowUp' || code === 'ArrowDown') {
      event.preventDefault();
    } else if (code === 'GlobalHook') {
      // 触控板（镜腿）触摸：交给 app 层双击检测（400ms 内两次 → 退出智能体）
      event.preventDefault();
      const app = this.app();
      if (app && app.handleTapKey) app.handleTapKey(code);
    }
  },

  backHome() {
    // ⚠️ 栈式返回：home 在 navigateTo 时已入栈，navigateBack 弹回原实例（onShow 无骨架刷新）；
    //    意图直达无栈时 app.navigateBackHome 内部 fail 兜底 redirectTo home。
    const app = this.app();
    if (app && app.navigateBackHome) {
      app.navigateBackHome();
      return;
    }
    try {
      if (typeof wx !== 'undefined' && wx.navigateBack) wx.navigateBack();
      else if (typeof wx !== 'undefined' && wx.redirectTo) wx.redirectTo({ url: '/pages/home/home' });
      else if (typeof aiui !== 'undefined' && aiui.redirectTo) aiui.redirectTo({ url: '/pages/home/home' });
    } catch (e) { /* ignore */ }
  }
};
</script>

<page>
  <view class="app">
    <!-- 顶栏三栏 -->
    <view class="topbar">
      <text class="topbar-title">台账</text>
      <view class="topbar-mid">
        <text class="topbar-brand">goodluck+</text>
      </view>
      <text class="topbar-user">{{ userName }}</text>
    </view>
    <view class="divider"></view>

    <view class="body ledger-body">
      <!-- 加载态 -->
      <text ink:if="{{ loading }}" class="cap">台账加载中…</text>

      <!-- 热力图（整体水平居中，参照设计稿帧 2:481） -->
      <view ink:if="{{ loading === false }}" class="heatmap-wrap">
        <!-- 亮度图例（左上角，与周一列左缘对齐） -->
        <view class="legend">
          <text class="mono">¥0</text>
          <view class="legend-swatch sw1"></view>
          <view class="legend-swatch sw2"></view>
          <view class="legend-swatch sw3"></view>
          <view class="legend-swatch sw4"></view>
          <view class="legend-swatch sw5"></view>
          <text class="mono">¥50+</text>
        </view>

        <!-- ▼ 本周（对准第 12 列正上方） -->
        <view class="week-row">
          <text class="week-marker">▼ 本周</text>
        </view>

        <!-- 6 行热力图 -->
        <view ink:for="{{ rows }}" ink:key="label" class="heat-row">
          <text class="heat-label">{{ item.label }}</text>
          <view class="heat-grid">
            <view ink:for="{{ item.cells }}" ink:key="key" class="{{ item.cls }}" style="{{ item.style }}"></view>
          </view>
          <text class="heat-lottery">{{ item.lottery }}</text>
        </view>

        <!-- 月份图例（底部，与格子列对齐） -->
        <view class="month-row">
          <view ink:for="{{ monthLabels }}" ink:key="label" class="month-marker" style="{{ item.style }}">
            <text class="mono">{{ item.label }}</text>
          </view>
        </view>

        <text class="cap">亮度 5 阶 = 购彩金额 · 空心 = 待开奖 / 号码待同步</text>
      </view>
    </view>

    <view class="divider"></view>

    <!-- 功能区 -->
    <view class="funcbar">
      <view class="btn btn-active" bindtap="backHome">
        <text class="btn-text btn-text-on">▸ 返回</text>
      </view>
      <text class="btn-hint">滑动切换 · 单击进入</text>
    </view>
  </view>
</page>

<style>
/* ============================================================
   彩票小助手 · 眼镜端 · 全局设计 token 与通用组件（V2.2）
   依据：官方 aiui-dev / design-system-green.md（beta）+ V2 设计稿
   亮度 6 级：100 / 72 / 48 / 24 / 12 / 06
   ⚠️ 全部使用字面值（不依赖自定义 CSS 变量）
   ============================================================ */

/* ============ 页面骨架 ============ */
.app {
  width: 480px;
  height: 352px;
  display: flex;
  flex-direction: column;
  padding: 12px 16px 16px 16px;
  gap: 8px;
  background-color: #000000;
  box-sizing: border-box;
  overflow: hidden;
}

/* 展示区（撑满，内容垂直居中） */
.body {
  flex-grow: 1; flex-shrink: 1; flex-basis: 0%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: stretch;
  gap: 8px;
  min-height: 0;
}

/* ============ 页面内提示（替代 toast） ============ */
.page-toast {
  align-self: center;
  color: #40ff5e;
  font-weight: 600;
  padding: 4px 12px;
  border-radius: 4px;
  border: 1px solid rgba(64,255,94,0.24);
  background-color: rgba(64,255,94,0.06);
  flex-grow: 0; flex-shrink: 0; flex-basis: auto;
}

/* ============ 顶栏三栏 ============ */
.topbar {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-grow: 0; flex-shrink: 0; flex-basis: auto;
}
.topbar-title {
  font-size: 16px;
  font-weight: 600;
  color: #40ff5e;
  font-family: sans-serif;
  flex-grow: 0; flex-shrink: 0; flex-basis: auto;
}
.topbar-mid {
  flex-grow: 1; flex-shrink: 1; flex-basis: 0%;
  display: flex;
  justify-content: center;
  align-items: center;
}
.topbar-brand {
  font-size: 11px;
  font-weight: 400;
  color: rgba(64,255,94,0.48);
  font-family: monospace;
}
.topbar-user {
  font-size: 12px;
  font-weight: 400;
  color: rgba(64,255,94,0.48);
  font-family: sans-serif;
  flex-grow: 0; flex-shrink: 0; flex-basis: auto;
}

/* ============ 分隔线 ============ */
.divider {
  width: 100%;
  height: 1px;
  background-color: rgba(64,255,94,0.24);
  flex-grow: 0; flex-shrink: 0; flex-basis: auto;
}
/* 展示区内部分隔线：保持 margin 间隔（顶部/底部分隔线依赖 flex gap 8px，内部用本类显式 8px） */
.divider-gap {
  width: 100%;
  height: 1px;
  background-color: rgba(64,255,94,0.24);
  margin-top: 8px;
  margin-bottom: 8px;
  flex-grow: 0; flex-shrink: 0; flex-basis: auto;
}

/* ============ 功能区按钮（两字规范） ============ */
.funcbar {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  flex-grow: 0; flex-shrink: 0; flex-basis: auto;
}
.btn {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 32px;
  padding: 0 12px;
  border-radius: 4px;
  border: 1px solid rgba(64,255,94,0.48);
  background-color: transparent;
  box-sizing: border-box;
}
.btn-text {
  font-size: 12px;
  font-weight: 400;
  line-height: 16px;
  color: rgba(64,255,94,0.48);
  font-family: sans-serif;
}
.btn-active {
  border: 1px solid rgba(64,255,94,0.72);
  background-color: rgba(64,255,94,0.12);
}
.btn-active .btn-text {
  font-weight: 600;
  color: #40ff5e;
}
/* 选中态文字（单类，绕开后代选择器在 AIUI 的渲染不确定性） */
.btn-text-on {
  font-weight: 600;
  color: #40ff5e;
}
.btn-hint {
  font-size: 10px;
  font-weight: 400;
  color: rgba(64,255,94,0.48);
  font-family: sans-serif;
  flex-grow: 0; flex-shrink: 0; flex-basis: auto;
}
.func-group-gap {
  width: 12px;
  flex-grow: 0; flex-shrink: 0; flex-basis: auto;
}
.scroll-row {
  flex-grow: 1; flex-shrink: 1; flex-basis: 0%;
  min-width: 0;
}
.scroll-ind {
  font-size: 12px;
  font-weight: 600;
  color: rgba(64,255,94,0.48);
  font-family: monospace;
  flex-grow: 0; flex-shrink: 0; flex-basis: auto;
}

/* ============ 面板 / 细线卡 ============ */
.panel {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px;
  border-radius: 6px;
  background-color: rgba(64,255,94,0.06);
  box-sizing: border-box;
}
.card-line {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
  border-radius: 6px;
  border: 1px solid rgba(64,255,94,0.24);
  background-color: #000000;
  box-sizing: border-box;
}

/* ============ 文本层级 ============ */
.h1 { font-size: 16px; font-weight: 600; color: #40ff5e; font-family: sans-serif; }
.h2 { font-size: 22px; font-weight: 600; color: #40ff5e; font-family: sans-serif; }
.mono-display { font-size: 22px; font-weight: 600; color: #40ff5e; font-family: monospace; }
.body1 { font-size: 14px; font-weight: 400; color: rgba(64,255,94,0.72); font-family: sans-serif; }
.sm { font-size: 12px; font-weight: 400; color: rgba(64,255,94,0.72); font-family: sans-serif; }
.sm-strong { font-size: 12px; font-weight: 600; color: #40ff5e; font-family: sans-serif; }
.cap { font-size: 10px; font-weight: 400; color: rgba(64,255,94,0.48); font-family: sans-serif; }
.mono { font-size: 11px; font-weight: 400; color: rgba(64,255,94,0.48); font-family: monospace; }
.mono-data { font-size: 13px; font-weight: 600; color: #40ff5e; font-family: monospace; }

/* ============ 提示态（无卡片居中直显） ============ */
.hint-center {
  flex-grow: 1; flex-shrink: 1; flex-basis: 0%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 0;
}

/* ============ 错误态（▲ + 虚线双通道） ============ */
.err-box {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
  border-radius: 4px;
  border: 1px dashed rgba(64,255,94,0.72);
  background-color: rgba(64,255,94,0.06);
  box-sizing: border-box;
  width: 400px;
}
.err-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 6px;
}
.err-tri {
  font-size: 14px;
  font-weight: 400;
  color: #40ff5e;
  font-family: sans-serif;
}
.err-title {
  font-size: 13px;
  font-weight: 400;
  color: rgba(64,255,94,0.72);
  font-family: sans-serif;
}
.err-cap {
  font-size: 10px;
  font-weight: 400;
  color: rgba(64,255,94,0.48);
  font-family: sans-serif;
}

/* ============ Loading 三点（行进动画） ============ */
.dots {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 6px;
}
.dot {
  width: 6px;
  height: 6px;
  border-radius: 9999px;
  background-color: #40ff5e;
  /* AIUI 动画不支持：用静态明暗表达加载行进（设计稿 1/0.48/0.24） */
}
.dot-2 { opacity: 0.48; }
.dot-3 { opacity: 0.24; }

/* ============ 号码球 ============ */
.ball-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 4px;
}
.ball {
  width: 22px;
  height: 22px;
  border-radius: 9999px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
}
.ball-red {
  border: 1px solid rgba(64,255,94,0.72);
  background-color: rgba(64,255,94,0.48);
}
.ball-blue {
  border: 1px solid rgba(64,255,94,0.72);
  background-color: #000000;
}
.ball-num {
  font-size: 10px;
  font-weight: 600;
  color: #40ff5e;
  font-family: monospace;
}
.ball-sep {
  font-size: 10px;
  font-weight: 400;
  color: rgba(64,255,94,0.48);
  font-family: monospace;
  padding: 0 2px;
}
.ball-mul {
  font-size: 11px;
  font-weight: 600;
  color: rgba(64,255,94,0.72);
  font-family: monospace;
  margin-left: 4px;
}

/* ============ 徽标（识别成功等） ============ */
.badge {
  display: flex;
  align-items: center;
  padding: 3px 8px;
  border-radius: 4px;
  border: 1px solid rgba(64,255,94,0.24);
  background-color: #000000;
  box-sizing: border-box;
}
.badge-text {
  font-size: 10px;
  font-weight: 400;
  color: rgba(64,255,94,0.48);
  font-family: sans-serif;
}

/* ============ 倒计时圆环 ============ */
.ring {
  width: 108px;
  height: 108px;
  border-radius: 9999px;
  border: 1px solid rgba(64,255,94,0.24);
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
}
.ring-num {
  font-size: 44px;
  font-weight: 600;
  color: #40ff5e;
  font-family: monospace;
  line-height: 1;
}

/* ============ 垂直滚动条（分析卡自动滚动） ============ */
.vscroll {
  width: 2px;
  align-self: stretch;
  background-color: rgba(64,255,94,0.24);
  position: relative;
  flex-grow: 0; flex-shrink: 0; flex-basis: auto;
}
.vscroll-thumb {
  position: absolute;
  left: 0;
  width: 2px;
  height: 26px;
  background-color: rgba(64,255,94,0.72);
  top: 4px;
  /* AIUI 不支持 animation/@keyframes：静态显示（2026-08-26 合规化） */
}

/* ============ 台账页私有样式 ============ */
.ledger-body {
  justify-content: center;
  align-items: stretch;
}

/* 热力图整体容器：与设计稿帧 2:481 一致的水平居中
   图例/本周/6 行/月份行统一 354px 宽，左缘对齐 = 周一列左缘 */
.heatmap-wrap {
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-self: center;
  width: 354px;
  flex-grow: 0; flex-shrink: 0; flex-basis: auto;
}

/* 图例（与格子行同起点：label 24 + gap 8 = 32px） */
.legend {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 6px;
  width: 354px;
  flex-grow: 0; flex-shrink: 0; flex-basis: auto;
}
.legend-swatch {
  width: 12px;
  height: 12px;
  border-radius: 3px;
}
/* 图例 5 阶（rgba 背景，与热力格子同机制，不用 opacity） */
.sw1 { background-color: rgba(64,255,94,0.06); }
.sw2 { background-color: rgba(64,255,94,0.24); }
.sw3 { background-color: rgba(64,255,94,0.48); }
.sw4 { background-color: rgba(64,255,94,0.72); }
.sw5 { background-color: rgba(64,255,94,1); }

/* ▼ 本周：与格子区同宽同起点，绝对定位到第 12 列中心正上方
   第 12 列起点 = 32（周一列）+ 11×22 = 274，中心 = 283；
   ▼ 三角左缘 = 278（参照设计稿 Frame 491 x=278，三角中心≈283 正好对准第 12 列方格中心） */
.week-row {
  position: relative;
  width: 354px;
  height: 16px;
  flex-grow: 0; flex-shrink: 0; flex-basis: auto;
}
.week-marker {
  position: absolute;
  left: 278px;
  top: 0;
  font-size: 11px;
  font-weight: 600;
  color: rgba(64,255,94,0.72);
  font-family: sans-serif;
}

/* 行：周几 + Flex 12 列 + 彩种 */
.heat-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  width: 354px;
  flex-grow: 0; flex-shrink: 0; flex-basis: auto;
}
.heat-label {
  width: 24px;
  flex-grow: 0; flex-shrink: 0; flex-basis: auto;
  font-size: 12px;
  font-weight: 600;
  color: rgba(64,255,94,0.72);
  font-family: sans-serif;
}
/* Flex 布局（Grid 的 repeat() 写法官方未确认，flex 更稳）：
   12 格 × 18px + 11 × 4px gap = 260px */
.heat-grid {
  display: flex;
  flex-direction: row;
  gap: 4px;
  flex-grow: 0; flex-shrink: 0; flex-basis: auto;
}
/* 基类：尺寸/圆角 */
.heat {
  width: 18px;
  height: 18px;
  border-radius: 4px;
  box-sizing: border-box;
}
/* 独立亮度类（单类选择器，官方支持；勿改回 .heat.hl1 多类组合）
   ⚠️ 不用 opacity 属性区分亮度：AIUI CSS 类内 opacity 渲染不可靠
   （图例用内联 style opacity 正常、此处 CSS opacity 全失效→格子全是不透明绿）。
   改用 rgba 背景色直接表达 5 阶亮度，与分隔线/选中态背景同机制（已验证可靠）。 */
.hl0 {
  border: 1px solid rgba(64,255,94,0.24);
  background-color: rgba(64,255,94,0.06); /* 设计稿空心格：0.06 极浅填充 + 1px24% 边框 */
}
.hl1 { background-color: rgba(64,255,94,0.06); }
.hl2 { background-color: rgba(64,255,94,0.24); }
.hl3 { background-color: rgba(64,255,94,0.48); }
.hl4 { background-color: rgba(64,255,94,0.72); }
.hl5 { background-color: rgba(64,255,94,1); }
.heat-lottery {
  font-size: 10px;
  font-weight: 400;
  color: rgba(64,255,94,0.48);
  font-family: sans-serif;
  flex-grow: 0; flex-shrink: 0; flex-basis: auto;
}

/* 月份图例：绝对定位对齐列 1/5/9/12（列步长 22px = 18 + 4，左偏移 32 = 周一列宽+gap） */
.month-row {
  position: relative;
  width: 354px;
  height: 14px;
  flex-grow: 0; flex-shrink: 0; flex-basis: auto;
}
.month-marker {
  position: absolute;
  top: 0;
}
</style>
