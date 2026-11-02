<script def>
{
  "navigationBarTitleText": "账号绑定"
}
</script>

<script setup>
export default {
  data: {
    mode: 'guide',
    // 口令格式 R{userId}-{6位验证码}，由小程序端生成后同步到眼镜端
    // 此处为演示占位符，真机由 app.globalData.launchPasscode / fixedPasscode 覆盖
    passcode: 'R00-000000',
    focusIndex: 1,
    toast: '',
    // 按钮选中态预计算（AIUI 模板仅支持整值 class 绑定，杜绝混合绑定/三元）
    btnExitCls: 'btn',
    btnExitText: '退出',
    btnExitTextCls: 'btn-text',
    btnEnterCls: 'btn btn-active',
    btnEnterText: '▸ 进入',
    btnEnterTextCls: 'btn-text btn-text-on'
  },

  onLoad() {
    this._loadedAt = Date.now(); // 启动保护窗口基准（3 秒内 Backspace 仍拦截）
    const app = this.app();
    if (app && app.globalData.pendingInvalid) {
      this.setData({ mode: 'invalid', focusIndex: 0 });
    }
    if (app && app.globalData.launchPasscode) {
      this.tryBind(app.globalData.launchPasscode);
    }
    this.applyFocus();
  },

  onShow() {
    const app = this.app();
    if (app && app.getLoginState().valid) {
      app.enterByIntent();
    }
  },

  // getApp 保护：AIUI 未确认全局函数时降级为 null
  app() {
    try {
      return typeof getApp === 'function' ? getApp() : null;
    } catch (e) { return null; }
  },

  // 根据 focusIndex/mode 预计算按钮 class 与文字
  applyFocus() {
    const f = this.data.focusIndex;
    const guide = this.data.mode === 'guide';
    this.setData({
      btnExitCls: f === 0 ? 'btn btn-active' : 'btn',
      btnExitText: f === 0 ? '▸ 退出' : '退出',
      btnExitTextCls: f === 0 ? 'btn-text btn-text-on' : 'btn-text',
      btnEnterCls: guide && f === 1 ? 'btn btn-active' : 'btn',
      btnEnterText: guide && f === 1 ? '▸ 进入' : '进入',
      btnEnterTextCls: guide && f === 1 ? 'btn-text btn-text-on' : 'btn-text'
    });
  },

  // 页面级键位拦截：单屏无滚动，滑动 = 功能区选中切换（循环模式：到两端继续滑动回绕）
  onKeyDown(event) {
    const code = event && event.code;
    if (code === 'ArrowUp' || code === 'ArrowDown') {
      const max = this.data.mode === 'guide' ? 1 : 0;
      const total = max + 1;
      const delta = code === 'ArrowDown' ? 1 : -1;
      // 循环回绕：最右继续右滑 → 回第一个；最左继续左滑 → 跳最后一个
      const next = (this.data.focusIndex + delta + total) % total;
      if (next !== this.data.focusIndex) {
        this.setData({ focusIndex: next });
        this.applyFocus();
      }
    }
  },

  onKeyUp(event) {
    const code = event && event.code;
    if (code === 'ArrowUp' || code === 'ArrowDown') {
      event.preventDefault();
    } else if (code === 'Enter') {
      event.preventDefault();
      this.data.focusIndex === 0 ? this.doExit() : this.doEnter();
    } else if (code === 'Backspace') {
      // ⚠️ 根页放行宿主默认（返回/请求关闭应用）：login 是应用根页、无上级页面，
      // 宿主默认 = 关闭应用 → 双击触控板/返回键即可退出智能体（2026-08-26 需求）。
      // 防回退：仅启动后 3 秒内拦截（防宿主在唤起瞬间注入返回事件关闭应用——
      // 2026-08-25"打开即退"事故的防御，根因当时已修，此处保留保护窗口）。
      if (!this._loadedAt || Date.now() - this._loadedAt <= 3000) {
        event.preventDefault();
      }
    } else if (code === 'GlobalHook') {
      // 触控板（镜腿）触摸：交给 app 层双击检测（400ms 内两次 → 退出智能体）
      event.preventDefault();
      const app = this.app();
      if (app && app.handleTapKey) app.handleTapKey(code);
    }
  },

  // 退出：关闭智能体
  doExit() {
    const app = this.app();
    if (app) app.exitApp();
  },

  // 进入 = 重试绑定（临时方案：固定口令直绑；指令文本不进应用，无唤起口令可解析）
  doEnter() {
    const app = this.app();
    if (app && app.globalData.useMock) {
      this.tryBind({ userId: '1024', code: '730214' });
      return;
    }
    const pc = app && (app.globalData.fixedPasscode || app.globalData.launchPasscode);
    if (pc) {
      this.tryBind(pc);
    } else {
      this.setData({ toast: '绑定失败，请重试' });
    }
  },

  async tryBind(passcode) {
    const app = this.app();
    try {
      // ⚠️ 即时反馈（2026-08-26）：绑定请求发出前先显示"正在绑定"——
      //    冷启动时 bind 请求需 1-3s，无反馈用户感知"点进入没反应"
      this.setData({ toast: '正在绑定，请稍候…' });
      await app.bindRokid(passcode.userId, passcode.code);
      this.setData({ toast: '' });
      app.enterByIntent();
    } catch (e) {
      this.setData({ toast: '' });
      if (e && e.code === 40100) {
        this.setData({ mode: 'invalid', focusIndex: 0, toast: '' });
        this.applyFocus();
      } else {
        this.setData({ toast: '网络异常，请重试' });
      }
    }
  },

  speak(text) {
    try {
      if (typeof speechSynthesis !== 'undefined' && speechSynthesis.speak) {
        speechSynthesis.speak(new SpeechSynthesisUtterance(text), 'enqueue');
      }
    } catch (e) { /* 可选增强 */ }
  }
};
</script>

<page>
  <view class="app">
    <!-- 顶栏三栏 -->
    <view class="topbar">
      <text class="topbar-title">账号绑定</text>
      <view class="topbar-mid">
        <text class="topbar-brand">goodluck+</text>
      </view>
      <text class="topbar-user">未绑定</text>
    </view>
    <view class="divider"></view>

    <!-- 引导态：无卡片居中直显 -->
    <view ink:if="{{ mode === 'guide' }}" class="hint-center">
      <text class="body1">您正在进行账号绑定，请核实口令</text>
      <text class="body1">正确请单击触控板进入</text>
      <text class="mono-display">{{ passcode }}</text>
      <text class="cap">口令格式：R + 用户ID - 6 位验证码</text>
    </view>

    <!-- 口令无效态：▲ + 虚线双通道（独立 ink:if，不用 ink:else 链——真机链不可靠） -->
    <view ink:if="{{ mode === 'invalid' }}" class="hint-center">
      <view class="err-box">
        <view class="err-row">
          <text class="err-tri">▲</text>
          <text class="err-title">口令无效，请到小程序重新复制口令</text>
        </view>
        <text class="err-cap">并更新 AI 快捷指令 · 常见原因：已更换验证码</text>
      </view>
    </view>

    <!-- 页面内提示 -->
    <text ink:if="{{ toast }}" class="cap page-toast">{{ toast }}</text>

    <view class="divider"></view>

    <!-- 功能区 -->
    <view class="funcbar">
      <view class="{{ btnExitCls }}" bindtap="doExit">
        <text class="{{ btnExitTextCls }}">{{ btnExitText }}</text>
      </view>
      <view ink:if="{{ mode === 'guide' }}" class="{{ btnEnterCls }}" bindtap="doEnter">
        <text class="{{ btnEnterTextCls }}">{{ btnEnterText }}</text>
      </view>
      <text class="btn-hint" ink:if="{{ mode === 'guide' }}">退出=关闭智能体 · 进入=前往绑定</text>
      <text class="btn-hint" ink:if="{{ mode !== 'guide' }}">退出 = 关闭智能体 · 请回小程序重新设置验证码</text>
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
</style>
