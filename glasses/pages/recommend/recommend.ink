<script def>
{
  "navigationBarTitleText": "推荐"
}
</script>

<script setup>
const LOTTERY_NAMES = { ssq: '双色球', dlt: '大乐透' };
const SCENES = [
  { label: '星座-双色球', system: 'astrology', lottery: 'ssq' },
  { label: '星座-大乐透', system: 'astrology', lottery: 'dlt' },
  { label: '五行-双色球', system: 'iching', lottery: 'ssq' },
  { label: '五行-大乐透', system: 'iching', lottery: 'dlt' }
];
const TIMEOUT_MS = 15000;

export default {
  data: {
    stage: 'loading',
    current: { label: '', meta: '', reds: [], blues: [], note: '', analysis: '' },
    scenes: [],
    focusIndex: 1,
    scrollTop: 0,
    scrollLeft: 0,
    userName: '未绑定',
    // 返回按钮选中态预计算
    btnBackCls: 'btn',
    btnBackText: '返回',
    btnBackTextCls: 'btn-text'
  },

  onLoad() {
    const app = this.app();
    const cfg = app ? app.getUserConfig() : {};
    if (cfg && cfg.name) this.setData({ userName: cfg.name });

    // 默认情景 = 用户配置
    const sys = (cfg && cfg.divinationSystem) || 'astrology';
    const lot = (cfg && cfg.lotteryType) || 'ssq';
    let defIndex = 1;
    SCENES.forEach((s, i) => {
      if (s.system === sys && s.lottery === lot) defIndex = i + 1;
    });
    this.setData({ focusIndex: defIndex });
    this.applyFocus();

    // ⚠️ 应用级缓存（2026-08-26）：不再每次进入清空页面缓存重发 5 请求——
    // 已演算过的场景从 app.globalData.recommendCache 直接读取（当日有效），零请求秒开。
    // 后端当日缓存命中本来秒回，但任一未缓存场景会触发 LLM 演算 5-8s 并占网络槽位，
    // 导致"后台已完成演算仍很慢/加载失败"。跨天（新日期）缓存自动失效回退请求。
    this._cache = app ? app.getRecommendCache() : {};
    this._destroyed = false;
    this.loadScene(SCENES[defIndex - 1]);
    this.prefetchScenes();
  },

  onUnload() {
    // 页面销毁：停止后续预取 + 标记已销毁（pending 请求回调不再 setData/写缓存，
    // 避免慢请求残留占用 AIUI 网络槽位、阻塞返回首页后的请求）
    this._destroyed = true;
    this.clearTimers();
  },

  app() {
    try {
      return typeof getApp === 'function' ? getApp() : null;
    } catch (e) { return null; }
  },

  // 预计算场景按钮列表（class/text 整值）+ 有限滚动对齐位置
  applyFocus(next) {
    const f = next != null ? next : this.data.focusIndex;
    const scenes = SCENES.map((s, i) => {
      const idx = i + 1;
      const on = f === idx;
      return {
        label: s.label,
        id: 'scene-' + idx,
        cls: on ? 'btn btn-active' : 'btn',
        text: on ? '▸ ' + s.label : s.label,
        textCls: on ? 'btn-text btn-text-on' : 'btn-text'
      };
    });
    // 有限滚动（scroll-left 数值驱动，离散对齐；返回按钮始终在滚动区外固定显示）：
    // - 选中最左场景 → scrollLeft=0：按钮条整体右移，最右侧场景被遮挡；
    // - 选中最右场景 → scrollLeft=大值，引擎自动 clamp 到 maxScroll：按钮条整体左移，最左侧场景被遮挡。
    // 步长 110 ≈ .btn 宽 100 + .scene-row gap 6 + 余量。
    const scrollLeft = (f - 1) * 110;
    this.setData({
      scenes,
      btnBackCls: f === 0 ? 'btn btn-active' : 'btn',
      btnBackText: f === 0 ? '▸ 返回' : '返回',
      btnBackTextCls: f === 0 ? 'btn-text btn-text-on' : 'btn-text',
      scrollLeft: scrollLeft
    });
  },

  // 预取 4 情景（应用级缓存：已演算过的场景跳过请求，只补未缓存的）
  // ⚠️ 串行 + 延迟预取：AIUI 网络层可能串行/有限并发，一次性 5 连发会占满网络槽位，
  //    阻塞返回首页后的请求（首页骨架卡住事故）。每 300ms 发一个，页面销毁即停止。
  prefetchScenes() {
    SCENES.forEach((s, i) => {
      setTimeout(() => {
        if (this._destroyed) return;
        if (this._cache[s.label]) return; // 已有缓存：跳过请求
        this.loadScene(s, true);
      }, 300 * (i + 1));
    });
  },

  async loadScene(scene, silent) {
    const app = this.app();
    if (!app) return;
    if (this._cache[scene.label]) {
      if (!silent) this.applyScene(scene, this._cache[scene.label]);
      return;
    }
    // ⚠️ 加载中防重复：onLoad 立即请求默认场景 + 预取 300ms 后遍历全部场景，
    //    若无标记会对默认场景重复发请求（LLM 演算期间并发双请求，慢且占槽位）
    if (this._loadingScenes && this._loadingScenes[scene.label]) return;
    if (!this._loadingScenes) this._loadingScenes = {};
    this._loadingScenes[scene.label] = true;
    if (!silent) {
      this.setData({ stage: 'loading' });
      this.clearLoadTimer();
      this._loadTimer = setTimeout(() => {
        if (this.data.stage === 'loading') this.setData({ stage: 'timeout' });
      }, TIMEOUT_MS);
    }
    try {
      const data = await app.request({
        url: '/recommend',
        method: 'POST',
        data: { system: scene.system, lottery: scene.lottery },
        // ⚠️ AIUI 网络冷启动对 POST 偶发失败/挂起（bind 曾 10s 超时同源）——
        //    /recommend 幂等（当日缓存秒回），网络层失败自动重试一次
        retry: 1
      });
      // 页面已销毁：请求结果丢弃（不写缓存不 setData），让网络槽位尽快释放
      if (this._destroyed) return;
      this._loadingScenes[scene.label] = false;
      this._cache[scene.label] = data;
      if (app.setRecommendCache) app.setRecommendCache(scene.label, data);
      if (!silent) this.applyScene(scene, data);
    } catch (e) {
      if (this._loadingScenes) this._loadingScenes[scene.label] = false;
      if (!silent && !this._destroyed) this.setData({ stage: 'timeout' });
    }
  },

  applyScene(scene, data) {
    this.clearLoadTimer();
    const lotteryName = LOTTERY_NAMES[scene.lottery] || '';
    const sceneName = scene.system === 'astrology' ? '星座占星' : '五行推演';
    const reds = Array.isArray(data.reds) ? data.reds : (data.redBalls || []);
    const blues = Array.isArray(data.blues) ? data.blues : (data.blueBalls || []);
    // ⚠️ 日期权威来源 = 后端 data.date（"2026-08-25 周二"）——服务器生成，
    //    与本地时钟/serverNow 无关（真机时钟不可信，首次进入时 serverNow 未就绪会显示错日期）
    const today = data.date || this.formatToday();
    // 分析文案与小程序端 buildAnalysisText 同款拼装（个人信息 + 号码区 + summary + 免责）
    const analysis = this.buildAnalysisText(scene, data, reds, blues, lotteryName, sceneName, today);
    const note = '推荐 1 注 · 单注 ¥2' + (data.cached ? ' · 当日已计算缓存秒回' : '');
    this.setData({
      stage: 'ready',
      current: {
        label: scene.label,
        meta: lotteryName + ' · ' + sceneName + ' · ' + today,
        reds,
        blues,
        note,
        analysis
      }
    });
    this.startAutoScroll();
  },

  // 分析文案：对齐小程序端 buildAnalysisText 结构（杜春生 · 男 · 1986-03-09 生，…）
  buildAnalysisText(scene, data, reds, blues, lotteryName, sceneName, today) {
    const app = this.app();
    const cfg = app ? app.getUserConfig() : {};
    const name = cfg.name || '你';
    const genderText = cfg.gender === 'male' ? '男' : (cfg.gender === 'female' ? '女' : '未设置');
    const birth = cfg.birth || '未填写';
    const redText = (reds || []).join(' / ') || '--';
    const blueText = (blues || []).join(' / ') || '--';
    const summary = data.analysis || data.summary || '本推荐仅供娱乐参考。';
    return (name + ' · ' + genderText + ' · ' + birth + ' 生，结合今日 ' + (today || this.formatToday()) +
      ' 的个人信息，按' + sceneName + '为你生成一组' + lotteryName +
      '号码。先在红球区 · ' + (reds || []).length + ' 个中筛出 ' + redText +
      ' 作为主选组合，再结合蓝球区 · ' + (blues || []).length + ' 个补入 ' + blueText +
      ' 作为收束号码。' + summary + ' 本结果仅供娱乐，不构成购彩建议。');
  },

  formatToday() {
    // 兜底（正常走后端 data.date）：优先服务器时间（HTTP Date 头，GMT+8 → 北京时间），
    // 全程 getUTC* 解析避免真机时区双偏移；真机时钟仅最后兜底
    const app = this.app();
    let d = new Date();
    const srv = app && app.globalData && app.globalData.serverNow;
    if (srv) d = new Date(new Date(srv).getTime() + 8 * 3600 * 1000);
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const wd = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getUTCDay()];
    return mm + '-' + dd + ' ' + wd;
  },

  // 分析文本自动上下滚动（scroll-top 数据驱动；滚动范围按文本长度动态估算）
  startAutoScroll() {
    this.clearScrollTimer();
    const text = (this.data.current && this.data.current.analysis) || '';
    // 估算总行数（分析卡可视宽约 300px，约 15 汉字/行 × 行高 16px），
    // 滚动上限 = 文本总高 - 可视高（约 120px），保证末尾内容也能滚出
    const lines = Math.ceil(String(text).length / 15);
    const maxTop = Math.max(0, lines * 16 - 120);
    let top = 0;
    this._scrollTimer = setInterval(() => {
      top += 2;
      if (top > maxTop) top = 0;
      this.setData({ scrollTop: top });
    }, 120);
  },

  clearLoadTimer() {
    if (this._loadTimer) {
      clearTimeout(this._loadTimer);
      this._loadTimer = null;
    }
  },

  clearScrollTimer() {
    if (this._scrollTimer) {
      clearInterval(this._scrollTimer);
      this._scrollTimer = null;
    }
  },

  clearTimers() {
    this.clearLoadTimer();
    this.clearScrollTimer();
  },

  // ---- 键位拦截：返回固定左 + 四情景（0-4 循环） ----
  // ⚠️ 循环模式：5 键（返回 + 4 场景），最右场景继续右滑回"返回"，最左返回继续左滑跳最后场景
  onKeyDown(event) {
    const code = event && event.code;
    if (code === 'ArrowUp' || code === 'ArrowDown') {
      const total = 5;
      const delta = code === 'ArrowDown' ? 1 : -1;
      const next = (this.data.focusIndex + delta + total) % total;
      if (next !== this.data.focusIndex) {
        this.setData({ focusIndex: next });
        this.applyFocus(next);
      }
    }
  },

  onKeyUp(event) {
    const code = event && event.code;
    if (code === 'ArrowUp' || code === 'ArrowDown') {
      event.preventDefault();
    } else if (code === 'Enter') {
      event.preventDefault();
      this.confirm();
    } else if (code === 'Backspace') {
      event.preventDefault();
      this.backHome();
    } else if (code === 'GlobalHook') {
      // 触控板（镜腿）触摸：交给 app 层双击检测（400ms 内两次 → 退出智能体）
      event.preventDefault();
      const app = this.app();
      if (app && app.handleTapKey) app.handleTapKey(code);
    }
  },

  confirm() {
    const idx = this.data.focusIndex;
    if (idx === 0) {
      this.backHome();
      return;
    }
    this.loadScene(SCENES[idx - 1]);
  },

  // 点击场景按钮（data-index 定位）
  onSceneTap(event) {
    let idx = -1;
    try {
      const ds = event && event.currentTarget && event.currentTarget.dataset;
      idx = ds ? Number(ds.index) : -1;
    } catch (e) { idx = -1; }
    if (idx >= 1 && idx <= SCENES.length) {
      this.setData({ focusIndex: idx });
      this.applyFocus();
      this.loadScene(SCENES[idx - 1]);
    } else {
      this.confirm();
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
      <text class="topbar-title">推荐</text>
      <view class="topbar-mid">
        <text class="topbar-brand">goodluck+</text>
      </view>
      <text class="topbar-user">{{ userName }}</text>
    </view>
    <view class="divider"></view>

    <view class="body">
      <!-- 演算中：无卡片居中直显 -->
      <view ink:if="{{ stage === 'loading' }}" class="hint-center">
        <text class="body1">系统正在演算中，请稍候…</text>
        <view class="dots">
          <view class="dot"></view>
          <view class="dot dot-2"></view>
          <view class="dot dot-3"></view>
        </view>
        <text class="cap">当日无缓存 · LLM 生成中（约 5-8 秒）· 超 15 秒提示重试</text>
      </view>

      <!-- 演算超时：▲ + 虚线 -->
      <view ink:if="{{ stage === 'timeout' }}" class="hint-center">
        <view class="err-box">
          <view class="err-row">
            <text class="err-tri">▲</text>
            <text class="err-title">演算超时，请重试</text>
          </view>
          <text class="err-cap">超过 15 秒未返回 · 滑动切换情景可重新发起</text>
        </view>
      </view>

      <!-- 就绪：号码卡 + 分析卡 -->
      <view ink:if="{{ stage === 'ready' }}">
        <view class="panel rec-panel">
          <view class="rec-top">
            <text class="sm-strong" style="color: rgba(64,255,94,0.72);">{{ current.meta }}</text>
            <text class="mono">红{{ current.reds.length }} 蓝{{ current.blues.length }}</text>
          </view>
          <view class="ball-row">
            <view ink:for="{{ current.reds }}" ink:key="*this" class="ball ball-red">
              <text class="ball-num">{{ item }}</text>
            </view>
            <text class="ball-sep">-</text>
            <view ink:for="{{ current.blues }}" ink:key="*this" class="ball ball-blue">
              <text class="ball-num">{{ item }}</text>
            </view>
          </view>
          <text class="cap">{{ current.note }}</text>
        </view>

        <view class="divider-gap"></view>

        <!-- 分析卡：自动上下滚动 -->
        <view class="card-line analysis-card">
          <view class="analysis-col">
            <text class="mono">推荐分析</text>
            <scroll-view class="analysis-scroll" scroll-y="{{ true }}" scroll-top="{{ scrollTop }}">
              <text class="sm analysis-text">{{ current.analysis }}</text>
            </scroll-view>
          </view>
          <view class="vscroll">
            <view class="vscroll-thumb"></view>
          </view>
        </view>
      </view>
    </view>

    <view class="divider"></view>

    <!-- 功能区：返回固定左 + 四情景横向滚动（scroll-into-view 驱动） -->
    <view class="funcbar">
      <view class="{{ btnBackCls }}" bindtap="backHome">
        <text class="{{ btnBackTextCls }}">{{ btnBackText }}</text>
      </view>
      <view class="func-group-gap"></view>
      <scroll-view class="scroll-row" scroll-x="{{ true }}" scroll-left="{{ scrollLeft }}">
        <view class="scene-row">
          <view ink:for="{{ scenes }}" ink:key="label" id="{{ item.id }}" class="{{ item.cls }}" bindtap="onSceneTap" data-index="{{ index + 1 }}">
            <text class="{{ item.textCls }}">{{ item.text }}</text>
          </view>
        </view>
      </scroll-view>
      <text class="scroll-ind">»</text>
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
  overflow: hidden;
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

/* ============ 推荐页私有样式 ============ */
.rec-panel {
  padding: 8px;
  gap: 4px;
  flex-grow: 0; flex-shrink: 0; flex-basis: auto;
  border: 1px solid rgba(64,255,94,0.24);  /* 设计稿号码卡 6% 填充 + 1px24% 结构线 */
}
.rec-top {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.analysis-card {
  flex-grow: 1; flex-shrink: 1; flex-basis: 0%;
  display: flex;
  flex-direction: row;
  gap: 8px;
  min-height: 0;
}
.analysis-col {
  flex-grow: 1; flex-shrink: 1; flex-basis: 0%;
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.analysis-scroll {
  flex-grow: 1; flex-shrink: 1; flex-basis: 0%;
  min-height: 0;
  /* 分析卡高度加倍：号码卡 hug、分析卡占满剩余空间，滚动区可视高度放开 */
  max-height: 240px;
}
.analysis-text {
  display: block;
}
.scene-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 6px;
}
</style>
