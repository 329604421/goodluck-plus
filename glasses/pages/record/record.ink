<script def>
{
  "navigationBarTitleText": "录入"
}
</script>

<script setup>
const LOTTERY_NAMES = { ssq: '双色球', dlt: '大乐透' };

export default {
  data: {
    stage: 'countdown',
    countdownNum: 3,
    lotteryName: '双色球',
    issueText: '',
    bets: [],
    betCount: 0,
    totalAmount: '¥0',
    focusIndex: 0,
    userName: '未绑定',
    toast: '',
    // 按钮选中态预计算
    btnCancelCls: 'btn btn-active',
    btnCancelText: '▸ 取消',
    btnCancelTextCls: 'btn-text btn-text-on',
    btnActionCls: 'btn',
    btnActionText: '',
    btnActionTextCls: 'btn-text',
    btnHint: '单击返回首页 · 放弃本次录入'
  },

  onLoad() {
    const app = this.app();
    if (app) {
      // 每次进入录入页重置 OCR 走查流程：首次拍照模拟识别失败 → 点"重试"后成功
      app._ocrFails = 0;
    }
    const cfg = app ? app.getUserConfig() : {};
    if (cfg && cfg.name) this.setData({ userName: cfg.name });
    this.startCountdown();
  },

  onUnload() {
    this.clearTimer();
    this.clearToastTimer();
  },

  app() {
    try {
      return typeof getApp === 'function' ? getApp() : null;
    } catch (e) { return null; }
  },

  // ---- 倒计时 3-2-1 ----
  startCountdown() {
    this.clearTimer();
    this.setData({ stage: 'countdown', countdownNum: 3, focusIndex: 0 });
    this.applyFocus();
    let n = 3;
    this._timer = setInterval(() => {
      n -= 1;
      if (n <= 0) {
        this.clearTimer();
        this.takePhoto();
        return;
      }
      this.setData({ countdownNum: n });
    }, 1000);
  },

  clearTimer() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  },

  // ---- 页面内提示（2s 自动清除） ----
  showToast(text) {
    this.clearToastTimer();
    this.setData({ toast: text });
    this._toastTimer = setTimeout(() => this.setData({ toast: '' }), 2000);
  },

  clearToastTimer() {
    if (this._toastTimer) {
      clearTimeout(this._toastTimer);
      this._toastTimer = null;
    }
  },

  // ---- 拍照（官方 API：wx.media.createCameraContext） ----
  async takePhoto() {
    this.setData({ stage: 'camera' });
    // USE_MOCK：跳过真实相机与 ArrayBuffer 构造（真机 AIUI 未确认支持），直接走 OCR mock 流程
    const app = this.app();
    if (app && app.globalData.useMock) {
      this.uploadOcr();
      return;
    }
    try {
      const camera = wx.media.createCameraContext();
      const photo = await camera.takePhoto({ quality: 'high' });
      this.uploadOcr(photo.data, photo.mimeType);
    } catch (e) {
      console.error('拍照失败', e);
      this.showToast('拍照失败，请重试');
      this.startCountdown();
    }
  },

  // ---- OCR 上传 ----
  // ⚠️ AIUI 运行时无 FormData/Blob（实测 ReferenceError 崩溃），真实上传改走
  //    app.request 的 isMultipart 手写 multipart（TextEncoder + Uint8Array，零依赖）。
  async uploadOcr(buffer, mimeType) {
    this.setData({ stage: 'ocring', focusIndex: 0 });
    this.applyFocus();
    const app = this.app();
    if (!app) return;
    try {
      let data;
      if (app.globalData && app.globalData.useMock) {
        // mock 模式：不构造任何可能抛错的对象，直接请求即可
        data = await app.request({ url: '/ticket/ocr', method: 'POST', timeout: 30000 });
      } else {
        // 真实模式：photo.data 为 ArrayBuffer → base64 字符串（wx.arrayBufferToBase64 官方支持，
        // ASCII 安全）→ 字符串 multipart（AIUI fetch 字符串 body 已验证可用；Uint8Array body 未确认）
        let b64;
        try {
          const ab = buffer instanceof ArrayBuffer ? buffer : buffer.buffer;
          b64 = wx.arrayBufferToBase64(ab);
        } catch (e) {
          // 兜底：ArrayBuffer → Uint8Array → 手动 base64（若 wx 无该方法）
          const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer;
          let bin = '';
          for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
          b64 = (typeof btoa === 'function') ? btoa(bin) : bin;
        }
        // mimeType 动态化：真机 takePhoto 返回 mimeType（可能 image/jpg），避免硬编码错配
        const mime = mimeType || 'image/jpeg';
        const ext = mime.indexOf('png') >= 0 ? 'png' : 'jpg';
        data = await app.request({
          url: '/ticket/ocr',
          method: 'POST',
          isMultipart: true,
          data: b64,
          filename: 'ticket.' + ext,
          mime,
          timeout: 60000,
          // ⚠️ 走 wx.request 原生通道：AIUI fetch 发送 80KB+ body 时响应挂起
          //    （后端 8s 返回 201 但前端 60s 超时），wx.request 官方确认支持
          useWxRequest: true
        });
      }
      this._ocrData = data;
      this.renderResult(data);
    } catch (e) {
      this.setData({ stage: 'failed', focusIndex: 1 });
      this.applyFocus();
    }
  },

  renderResult(data) {
    // 后端 OCR 契约：lotteryName('双色球')/period('第 X 期')/drawDate/betCount/multiplier/
    // totalAmount('¥ 4.00' 字符串)/bets[{id, red, blue, mult}]
    const lotteryType = this.guessType(data.lotteryName);
    const bets = Array.isArray(data.bets) && data.bets.length > 0 ? data.bets : [];
    // 每注拍平为 nodes（reds + 分隔 + blues + 倍数），模板单层嵌套不依赖别名
    const normalized = bets.map((b) => {
      const reds = b.reds || b.red || [];
      const blues = b.blues || b.blue || [];
      const mult = b.mult || 1;
      const nodes = [];
      reds.forEach((num) => nodes.push({ cls: 'ball-red', num }));
      nodes.push({ cls: 'sep', num: '-' });
      blues.forEach((num) => nodes.push({ cls: 'ball-blue', num }));
      nodes.push({ cls: 'mul', num: '×' + mult });
      return { mult, nodes };
    });
    const totalFen = this.parseAmount(data.totalAmount, normalized);
    this.setData({
      stage: 'result',
      lotteryName: LOTTERY_NAMES[lotteryType] || data.lotteryName || '双色球',
      issueText: this.cleanPeriod(data.period) + (data.drawDate ? ' · 开奖 ' + String(data.drawDate).slice(5) : ''),
      bets: normalized,
      betCount: normalized.length,
      totalAmount: this.formatYuan(totalFen),
      focusIndex: 1
    });
    this.applyFocus();
  },

  // 彩种名 → type（后端 OCR 返回 lotteryName 而非 lotteryType）
  guessType(name) {
    return /大乐透/.test(String(name || '')) ? 'dlt' : 'ssq';
  },

  // '第 2026101 期' → '第 2026101 期'（保留前缀，去除多余空格）
  cleanPeriod(period) {
    const m = String(period || '').match(/(\d+)/);
    return m ? '第 ' + m[1] + ' 期' : '';
  },

  // '第 2026101 期' → '2026101'（纯数字，后端 SaveTicketDto.period 要求）
  cleanPeriodNum(period) {
    const m = String(period || '').match(/(\d+)/);
    return m ? m[1] : '';
  },

  // totalAmount '¥ 4.00'（字符串）→ 分；解析失败按注数×2 元兜底
  parseAmount(amountStr, bets) {
    const m = String(amountStr || '').match(/[\d.]+/);
    const yuan = m ? parseFloat(m[0]) : NaN;
    if (!isNaN(yuan) && yuan >= 0) return Math.round(yuan * 100);
    return (bets || []).reduce((sum, b) => sum + 200 * b.mult, 0);
  },

  // 根据 stage/focusIndex 预计算功能区按钮
  applyFocus() {
    const stage = this.data.stage;
    const f = this.data.focusIndex;
    const canDual = stage === 'result' || stage === 'failed';
    this.setData({
      btnCancelCls: f === 0 ? 'btn btn-active' : 'btn',
      btnCancelText: f === 0 ? '▸ 取消' : '取消',
      btnCancelTextCls: f === 0 ? 'btn-text btn-text-on' : 'btn-text',
      btnActionCls: canDual && f === 1 ? 'btn btn-active' : 'btn',
      btnActionText: stage === 'result' ? (f === 1 ? '▸ 确定' : '确定')
        : stage === 'failed' ? (f === 1 ? '▸ 重试' : '重试')
        : '',
      btnActionTextCls: canDual && f === 1 ? 'btn-text btn-text-on' : 'btn-text',
      btnHint: stage === 'result' ? '滑动切换 · 单击确认'
        : stage === 'failed' ? '重试 = 重新倒计时拍照'
        : '单击返回首页 · 放弃本次录入'
    });
  },

  // ---- 保存 ----
  async saveTicket() {
    const app = this.app();
    if (!app || !this._ocrData) return;
    this.setData({ stage: 'saving' });
    try {
      const ocr = this._ocrData;
      // 后端 SaveTicketDto：lotteryType/period(纯数字)/drawDate/bets[{id,red,blue,mult}]/multiplier/totalAmount(分)
      const bets = (Array.isArray(ocr.bets) ? ocr.bets : []).map((b, i) => ({
        id: b.id != null ? b.id : i + 1,
        red: b.reds || b.red || [],
        blue: b.blues || b.blue || [],
        mult: b.mult || 1
      }));
      await app.request({
        url: '/ticket',
        method: 'POST',
        data: {
          lotteryType: this.guessType(ocr.lotteryName),
          period: this.cleanPeriodNum(ocr.period),
          drawDate: ocr.drawDate || undefined,
          bets,
          multiplier: ocr.multiplier || 1,
          totalAmount: this.parseAmount(ocr.totalAmount, bets)
        }
      });
      this.speak('已录入');
      this.backHome();
    } catch (e) {
      this.showToast('保存失败，请重试');
      this.setData({ stage: 'result', focusIndex: 1 });
      this.applyFocus();
    }
  },

  backHome() {
    const app = this.app();
    if (app && app.navigateBackHome) {
      app.navigateBackHome();
      return;
    }
    this.navHome();
  },

  navHome() {
    try {
      if (typeof wx !== 'undefined' && wx.navigateBack) wx.navigateBack();
      else if (typeof wx !== 'undefined' && wx.redirectTo) wx.redirectTo({ url: '/pages/home/home' });
      else if (typeof aiui !== 'undefined' && aiui.redirectTo) aiui.redirectTo({ url: '/pages/home/home' });
    } catch (e) { /* ignore */ }
  },

  formatYuan(fen) {
    const n = Number(fen) || 0;
    return '¥' + Math.floor(n / 100).toLocaleString('en-US');
  },

  speak(text) {
    try {
      if (typeof speechSynthesis !== 'undefined' && speechSynthesis.speak) {
        speechSynthesis.speak(new SpeechSynthesisUtterance(text), 'enqueue');
      }
    } catch (e) { /* 可选增强 */ }
  },

  // ---- 键位拦截（按状态机分发；onKeyDown 即时反馈） ----
  // ⚠️ 循环模式：result/failed 态 2 键（取消/确定·重试）循环回绕；单键态回绕后不变
  onKeyDown(event) {
    const code = event && event.code;
    const stage = this.data.stage;
    if (stage === 'saving') return;
    if (code === 'ArrowUp' || code === 'ArrowDown') {
      const max = (stage === 'result' || stage === 'failed') ? 1 : 0;
      const total = max + 1;
      const delta = code === 'ArrowDown' ? 1 : -1;
      const next = (this.data.focusIndex + delta + total) % total;
      if (next !== this.data.focusIndex) {
        this.setData({ focusIndex: next });
        this.applyFocus();
      }
    }
  },

  onKeyUp(event) {
    const code = event && event.code;
    const stage = this.data.stage;

    if (stage === 'saving') {
      event.preventDefault();
      return;
    }

    if (code === 'ArrowUp' || code === 'ArrowDown') {
      event.preventDefault();
    } else if (code === 'Enter') {
      event.preventDefault();
      this.confirm(stage);
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

  confirm(stage) {
    if (stage === 'countdown' || stage === 'camera' || stage === 'ocring') {
      this.backHome();
      return;
    }
    if (stage === 'result') {
      if (this.data.focusIndex === 0) this.backHome();
      else this.saveTicket();
      return;
    }
    if (stage === 'failed') {
      if (this.data.focusIndex === 0) this.backHome();
      else this.startCountdown();
    }
  }
};
</script>

<page>
  <view class="app">
    <!-- 顶栏三栏 -->
    <view class="topbar">
      <text class="topbar-title">录入</text>
      <view class="topbar-mid">
        <text class="topbar-brand">goodluck+</text>
      </view>
      <text class="topbar-user">{{ userName }}</text>
    </view>
    <view class="divider"></view>

    <view class="body">
      <!-- 倒计时：圆环 + 大数字 -->
      <view ink:if="{{ stage === 'countdown' }}" class="hint-center">
        <view class="ring">
          <text class="ring-num">{{ countdownNum }}</text>
        </view>
        <text class="body1">即将自动拍照 · 请对准彩票</text>
        <text class="cap">倒计时 3-2-1 结束后自动拍照 · 免手操作</text>
      </view>

      <!-- 拍照中 -->
      <view ink:if="{{ stage === 'camera' }}" class="hint-center">
        <text class="body1">正在拍照…</text>
        <text class="cap">请保持彩票在取景框内</text>
      </view>

      <!-- OCR 识别中 -->
      <view ink:if="{{ stage === 'ocring' }}" class="hint-center">
        <text class="body1">正在对彩票进行 OCR 识别</text>
        <text class="body1">请稍后…</text>
        <view class="dots">
          <view class="dot"></view>
          <view class="dot dot-2"></view>
          <view class="dot dot-3"></view>
        </view>
        <text class="cap">图片已上传 · 识别期间请勿移动头部</text>
      </view>

      <!-- 识别结果：6% 面板 + 5 注号码 -->
      <view ink:if="{{ stage === 'result' }}" class="panel result-panel">
        <view class="result-top">
          <view class="result-title">
            <text class="sm-strong" style="font-size: 14px; color: rgba(64,255,94,0.72);">{{ lotteryName }}</text>
            <text class="cap">{{ issueText }}</text>
          </view>
          <view class="badge">
            <text class="badge-text">识别成功</text>
          </view>
        </view>
        <view class="divider-gap"></view>
        <view class="result-hint">
          <text class="cap">投注号码 · 共 {{ betCount }} 注</text>
          <text class="cap" style="color: rgba(64,255,94,0.72); font-weight: 600;">金额 {{ totalAmount }}</text>
        </view>
        <view ink:for="{{ bets }}" ink:key="index" class="ball-row">
          <view ink:for="{{ item.nodes }}" ink:key="index">
            <view ink:if="{{ item.cls === 'sep' }}" class="ball-sep">
              <text>{{ item.num }}</text>
            </view>
            <view ink:if="{{ item.cls === 'mul' }}" class="ball-mul">
              <text>{{ item.num }}</text>
            </view>
            <view ink:if="{{ item.cls !== 'sep' && item.cls !== 'mul' }}" class="ball {{ item.cls }}">
              <text class="ball-num">{{ item.num }}</text>
            </view>
          </view>
        </view>
      </view>

      <!-- 识别失败：▲ + 虚线 -->
      <view ink:if="{{ stage === 'failed' }}" class="hint-center">
        <view class="err-box">
          <view class="err-row">
            <text class="err-tri">▲</text>
            <text class="err-title">识别失败，请重试</text>
          </view>
          <text class="err-cap">OCR 未识别出有效票面 · code 40010 · 可回小程序手动校对</text>
        </view>
      </view>

      <!-- 保存中 -->
      <view ink:if="{{ stage === 'saving' }}" class="hint-center">
        <text class="body1">正在保存…</text>
        <view class="dots">
          <view class="dot"></view>
          <view class="dot dot-2"></view>
          <view class="dot dot-3"></view>
        </view>
        <text class="cap">保存成功后自动返回首页 · 播报「已录入」</text>
      </view>
    </view>

    <!-- 页面内提示 -->
    <text ink:if="{{ toast }}" class="cap page-toast">{{ toast }}</text>

    <!-- 底部分隔线（保存中隐藏；作为 .app 直接子项，与其他页面一致，避免 wrapper 导致侵入） -->
    <view ink:if="{{ stage !== 'saving' }}" class="divider"></view>

    <!-- 功能区（保存中隐藏） -->
    <view ink:if="{{ stage !== 'saving' }}" class="funcbar">
        <view class="{{ btnCancelCls }}" bindtap="backHome">
          <text class="{{ btnCancelTextCls }}">{{ btnCancelText }}</text>
        </view>
        <view ink:if="{{ stage === 'result' }}" class="{{ btnActionCls }}" bindtap="saveTicket">
          <text class="{{ btnActionTextCls }}">{{ btnActionText }}</text>
        </view>
        <view ink:if="{{ stage === 'failed' }}" class="{{ btnActionCls }}" bindtap="startCountdown">
          <text class="{{ btnActionTextCls }}">{{ btnActionText }}</text>
        </view>
        <text class="btn-hint">{{ btnHint }}</text>
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
  /* AIUI 动画不支持：用静态明暗表达加载行进（设计稿 11-保存中：1/0.48/0.24） */
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

/* ============ 录入页私有样式 ============ */
.result-panel {
  padding: 8px;        /* 覆盖 .panel 10px：收紧面板内部上下间隔（设计稿 Frame 117 padding 8） */
  gap: 4px;            /* 覆盖 .panel 6px：减小号码行间距，防 5 注内容撑高侵占底部功能区 */
  flex-grow: 1; flex-shrink: 1; flex-basis: 0%;
  justify-content: center;
  border: 1px solid rgba(64,255,94,0.24);  /* 设计稿结果面板 6% 填充 + 1px24% 结构线 */
}
.result-top {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.result-title {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.result-hint {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
</style>
