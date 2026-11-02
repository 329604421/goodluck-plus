<script def>
{
  "navigationBarTitleText": "首页"
}
</script>

<script setup>
const LOTTERY_NAMES = { ssq: '双色球', dlt: '大乐透' };
const CHANNELS = { shop: '彩票店兑付', center: '彩票中心兑付' };
const NAV_TARGETS = ['record', 'recommend', 'ledger'];

// ⚠️ 骨架横条配置（2026-08-26）：三卡片 × 4 条，宽/高/透明度
//    收缩动效：JS 定时器切换宽度（缩到 62%），CSS transition 平滑（左固定右收缩）；
//    AIUI 不支持 @keyframes/animation，transition 不生效时退化为跳变（仍可见收缩）。
const SKEL_HERO = [
  { w: 140, h: 16, o: 0.24 }, { w: 200, h: 12, o: 0.12 },
  { w: 260, h: 26, o: 0.48 }, { w: 320, h: 12, o: 0.12 }
];
const SKEL_LEFT = [
  { w: 90, h: 12, o: 0.12 }, { w: 180, h: 16, o: 0.16 },
  { w: 150, h: 16, o: 0.16 }, { w: 130, h: 16, o: 0.16 }
];
const SKEL_RIGHT = [
  { w: 80, h: 12, o: 0.12 }, { w: 160, h: 16, o: 0.16 },
  { w: 140, h: 16, o: 0.16 }, { w: 120, h: 16, o: 0.48 }
];
const SKEL_SHRINK = 0.62; // 收缩比例（宽度 × 0.62，右侧收缩、左侧固定）
const SKEL_INTERVAL = 1300; // 收缩/恢复周期（ms）

export default {
  data: {
    // ⚠️ 恢复默认骨架（loading=true）：进入首页有明确加载反馈；
    //    守卫缩短到 1.5s（请求被阻塞时骨架快速消失，不永久卡），
    //    正常请求（含 AIUI 网络冷启动）完成后回填数据。
    loading: true,
    // 骨架/数据双面内联 style（opacity 原地切换，无滚动过渡；内联 style 已验证可靠）
    skelStyle: 'opacity: 1;',
    dataStyle: 'opacity: 0;',
    heroState: 'empty',
    redeem: { amount: '¥0', daysLeft: '', count: 0, title: '', tipText: '' },
    drawHero: { title: '', drawTimeText: '', tipText: '' },
    // 下一期奖池信息 · 双彩种 5 秒纯文字切换（lotteryIdx 0=双色球 1=大乐透；drawInfo=当前展示面）
    lotteryIdx: 0,
    drawInfo: { issue: '', pool: '', countdown: '' },
    stats: { periods: 0, spent: '¥0', won: '¥0' },
    userName: '未绑定',
    focusIndex: 0,
    // 按钮选中态预计算（AIUI 模板仅支持整值 class 绑定）
    btnCls0: 'btn btn-active',
    btnText0: '▸ 录入',
    btnTextCls0: 'btn-text btn-text-on',
    btnCls1: 'btn',
    btnText1: '推荐',
    btnTextCls1: 'btn-text',
    btnCls2: 'btn',
    btnText2: '台账',
    btnTextCls2: 'btn-text',
    // 骨架横条（ink:for 渲染，style 整值绑定；定时器切换宽度实现收缩动效）
    heroBars: [],
    leftBars: [],
    rightBars: []
  },

  onLoad() {
    this._loaded = false;
    this._loadedAt = Date.now(); // 启动保护窗口基准（3 秒内 Backspace 仍拦截）
    this.loadConfig();
    this.initPage();
  },

  onShow() {
    if (!this._loaded) {
      this._loaded = true;
      return;
    }
    // ⚠️ 数据驱动（2026-08-26）：不再强制复位 loading——骨架由 loadAll 在数据全时
    //    统一切换，提前复位会导致"骨架消失但数据还是空的"。loadAll 自带 12s 兜底，
    //    任何情况下加载态最终都会结束。返回/唤醒仅触发静默刷新回填数据。
    this.refresh();
  },

  onVoiceWakeup() {
    this.refresh();
  },

  onUnload() {
    this.clearCountdown();
    this.clearRotate();
    this.clearSkeleton();
  },

  app() {
    try {
      return typeof getApp === 'function' ? getApp() : null;
    } catch (e) { return null; }
  },

  loadConfig() {
    const app = this.app();
    if (!app) return;
    const cfg = app.getUserConfig();
    if (cfg && cfg.name) this.setData({ userName: cfg.name });
  },

  async initPage() {
    // ⚠️ 缓存/预取秒开（2026-08-26）：当日已有页面缓存 → 直接显示上次数据（不显示骨架），
    //    再由 refresh 静默刷新保证新鲜——AIUI 网络冷启动开销大，每次进入重拉很慢；
    //    无缓存但有绑定成功后的预取数据（prefetched）同样秒开（数据加工时直接消费）；
    //    两者都没有才走"骨架等数据全"的首次加载。
    const app = this.app();
    const hasCached = app ? !!(app.getPageCache && (
      app.getPageCache('homeRedeem') || app.getPageCache('homeStats') ||
      app.getPageCache('homeStatus') || app.getPageCache('homeTickets')
    )) : false;
    const hasPrefetched = app ? !!(
      app.globalData && app.globalData.prefetched &&
      Object.keys(app.globalData.prefetched).length > 0
    ) : false;
    if (hasCached || hasPrefetched) {
      this.applyCachedData();
      this.refresh();
      return;
    }
    // 首次加载（骨架）：数据全了才由 loadAll 切回正常态（用户要求"加载完整体显示"）
    this.setLoading(true);
    await this.loadAll(false);
  },

  // 应用页面缓存（秒开）：还原上次各请求的数据与奖池双面，随后 refresh 静默刷新
  applyCachedData() {
    const app = this.app();
    if (!app || !app.getPageCache) return;
    let heroState = null;
    const r = app.getPageCache('homeRedeem');
    if (r && r.redeem) {
      this._redeemPending = true; // 缓存有待兑奖 → 标记（updateHeroState 三选一依赖）
      heroState = 'redeem';
      this.setData({ heroState: 'redeem', redeem: r.redeem });
    }
    const s = app.getPageCache('homeStats');
    if (s && s.stats) this.setData({ stats: s.stats });
    const st = app.getPageCache('homeStatus');
    if (st && st.faces) {
      this._faces = st.faces;
      this._cdDiffs = st.cdDiffs || {};
      this.renderFace();
      this.startCountdown();
      this.startLotteryRotate();
    }
    const t = app.getPageCache('homeTickets');
    if (t && t.drawHero) {
      this._pendingDraw = this._pendingDraw || {}; // 缓存有待开奖 Hero → 标记
      this.setData({ drawHero: t.drawHero });
    }
    if (!heroState) {
      this.setData({ heroState: this.data.drawHero && this.data.drawHero.title ? 'draw' : 'empty' });
    }
  },

  refresh() {
    // 返回/唤醒静默刷新（不设骨架）：请求完成后回填，失败自动重拉
    this.loadAll(true);
  },

  // 双面原地切换（骨架/数据）：同时更新 loading 与两面的内联 opacity——
  // 不用 ink:if 大块切换（引擎滑动过渡 → 骨架上滑一半卡住），opacity 直接替换无滚动
  setLoading(show) {
    if (show) this.startSkeleton();
    else this.clearSkeleton();
    this.setData({
      loading: show,
      skelStyle: show ? 'opacity: 1;' : 'opacity: 0;',
      dataStyle: show ? 'opacity: 0;' : 'opacity: 1;'
    });
  },

  // ---- 骨架横条收缩动效（2026-08-26）----
  // ⚠️ AIUI 不支持 @keyframes/animation（真机渲染不可靠）→ 用 JS 定时器切换
  //    "全长/缩短"两态宽度 + CSS transition 平滑（width 变化默认左固定、右端收缩）。
  //    真机 transition 若不生效则退化为跳变收缩（视觉仍可见），不影响功能。
  buildSkelBars(cfg, shrink) {
    return (cfg || []).map((b) => ({
      style: 'width: ' + Math.round(b.w * (shrink ? SKEL_SHRINK : 1)) + 'px;' +
        'height: ' + b.h + 'px; opacity: ' + b.o + ';' +
        'transition: width 0.65s ease-in-out;'
    }));
  },

  startSkeleton() {
    this.clearSkeleton();
    // 首次先渲染全长横条（骨架出现即有内容），随后周期切换收缩/恢复
    this._skelShrink = false;
    this.setData({
      heroBars: this.buildSkelBars(SKEL_HERO, false),
      leftBars: this.buildSkelBars(SKEL_LEFT, false),
      rightBars: this.buildSkelBars(SKEL_RIGHT, false)
    });
    this._skelTimer = setInterval(() => {
      this._skelShrink = !this._skelShrink;
      this.setData({
        heroBars: this.buildSkelBars(SKEL_HERO, this._skelShrink),
        leftBars: this.buildSkelBars(SKEL_LEFT, this._skelShrink),
        rightBars: this.buildSkelBars(SKEL_RIGHT, this._skelShrink)
      });
    }, SKEL_INTERVAL);
  },

  clearSkeleton() {
    if (this._skelTimer) {
      clearInterval(this._skelTimer);
      this._skelTimer = null;
    }
  },

  // 数据驱动加载（2026-08-26 重构，2026-08-26 二次修复）：
  // ⚠️ 修复 1：status 双彩种拆出主加载链——原实现 Promise.all 等 5 个请求全部 settle
  //    才切正常态，而 queryStatus 整体等"双请求都完成"，冷启动时任一挂起重试（8s+8s）
  //    会拖累整页 16s。现只等基础三件套（待兑奖/统计/票据），奖池卡后台独立先到先渲染。
  // ⚠️ 修复 2：重拉判定改为"请求是否成功过"（_anySuccess），不再用 hasData 判内容——
  //    空数据用户（无票/无待兑奖/统计为 0）会被 hasData 误判为加载失败而白白重拉一轮。
  async loadAll(isRefresh, retried) {
    this._anySuccess = false;
    // 基础三件套：等齐才切正常态（12s 兜底防极端挂起）
    const guard = new Promise((resolve) => setTimeout(resolve, 12000));
    const baseDone = Promise.all([
      this.queryRedeem(), this.queryStats(), this.queryTickets()
    ]).catch(() => {});
    // 奖池双彩种：拆出主链，后台独立跑（内部双请求各自独立，先到先渲染）
    this.queryStatus().catch(() => {});
    await Promise.race([baseDone, guard]);
    this.setLoading(false);
    if (!retried && !this._anySuccess) {
      this.setLoading(true);
      await new Promise((r) => setTimeout(r, 800));
      await this.loadAll(isRefresh, true);
    }
  },

  async queryRedeem() {
    const app = this.app();
    if (!app) return;
    try {
      // 预取优先：绑定成功后已拉取（网络热、无等待）；消费后清除，下次 refresh 走真实网络
      let data = app.takePrefetched ? app.takePrefetched('/redeem/pending') : null;
      if (!data) data = await app.request({ url: '/redeem/pending' });
      this._anySuccess = true; // 请求成功即算（空列表也是正常态，非加载失败）
      const list = (data && data.list) || [];
      if (list.length > 0) {
        const first = list[0]; // 后端字段在 list[0]：lottery/amount/deadlineDate/redeemChannel/daysLeft/period('第 X 期')
        const lotteryName = LOTTERY_NAMES[first.lottery] || first.lotteryName || '';
        this._redeemPending = true; // ⚠️ 三选一标记：有待兑奖（updateHeroState 优先用）
        this.setData({
          heroState: 'redeem',
          redeem: {
            amount: this.formatYuan(first.amount != null ? first.amount : 0),
            daysLeft: first.daysLeft != null ? '剩余 ' + first.daysLeft + ' 天' : '',
            count: list.length,
            // 对齐小程序端 Hero：标题「彩种 · 期号」+ 提示「兑奖截止 MM-DD · 剩余 N 天 · 渠道」
            title: lotteryName + ' · ' + (first.period || ''),
            tipText: '兑奖截止 ' + this.shortDate(first.deadlineDate) +
              (first.daysLeft != null ? ' · 剩余 ' + first.daysLeft + ' 天' : '') +
              ' · ' + (CHANNELS[first.redeemChannel] || '')
          }
        });
      } else {
        // ⚠️ 无待兑奖：清除标记（不锁死旧状态——对齐小程序每次重新三选一）
        this._redeemPending = false;
      }
      // 写页面缓存（待兑奖；空列表也写，避免下次秒开误显旧待兑奖）
      if (app.setPageCache) {
        app.setPageCache('homeRedeem', list.length > 0 ? { redeem: this.data.redeem } : { redeem: null });
      }
      this.updateHeroState();
    } catch (e) { /* 弱提示：卡片保持上一状态 */ }
  },

  async queryStats() {
    const app = this.app();
    if (!app) return;
    try {
      let d = app.takePrefetched ? app.takePrefetched('/statistics') : null;
      if (!d) d = await app.request({ url: '/statistics' });
      this._anySuccess = true;
      this.setData({
        stats: {
          // 期数必须整数（后端可能返回浮点/字符串，前端强制取整）
          periods: Math.floor(Number(d.purchasedPeriods) || 0),
          // 兼容兜底：旧后端无 totalSpent/totalWon 时显示 ¥0（新后端已返回，部署后生效）
          spent: this.formatYuan(d.totalSpent != null ? d.totalSpent : 0),
          won: this.formatYuan(d.totalWon != null ? d.totalWon : 0)
        }
      });
      // 写页面缓存（统计）
      if (app.setPageCache) {
        app.setPageCache('homeStats', { stats: this.data.stats });
      }
      this.updateHeroState();
    } catch (e) { /* ignore */ }
  },

  async queryStatus() {
    const app = this.app();
    if (!app) return;
    try {
      // 双彩种并发拉取（小程序端同构）：两个彩种的奖池/期号/倒计时都取，
      // 眼镜端无点击操作 → 5 秒纯文字自动切换展示。
      // ⚠️ 双请求彻底独立（2026-08-26 二次修复）：各自 then 链、互不等待——
      //    原实现 await dsP 后再 await ddP，冷启动时 ssq 挂起重试（8s+8s）会阻塞
      //    dlt 先到先渲染，且 queryStatus 整体不 resolve → 拖累 loadAll 的 Promise.all。
      //    现在谁先回谁渲染，慢的那个不阻塞任何东西；本函数同步返回，
      //    已从 loadAll 主链拆出（首页基础三件套等齐即可切正常态）。
      const srv = app.globalData && app.globalData.serverNow;
      const base = srv ? new Date(srv).getTime() : Date.now();
      this._cdDiffs = {};
      this._faces = [];
      // 单个请求回来后统一收尾（幂等：clear 前置的定时器/写缓存/状态判定可重复执行）
      const afterOne = () => {
        this.renderFace();
        if (app.setPageCache) {
          app.setPageCache('homeStatus', { faces: this._faces, cdDiffs: this._cdDiffs });
        }
        this.startCountdown();
        this.startLotteryRotate();
        this.updateHeroState();
      };
      // 预取优先：绑定成功后已拉取（消费后清除，下次 refresh 走真实网络）
      const fetchStatus = (url) => {
        const pf = app.takePrefetched ? app.takePrefetched(url) : null;
        return pf ? Promise.resolve(pf) : app.request({ url });
      };
      fetchStatus('/lottery/status?type=ssq')
        .then((ds) => {
          if (!ds) return;
          const diff = ds.saleEndAt ? Math.max(0, Number(ds.saleEndAt) - base) : 0;
          this._cdDiffs.ssq = diff;
          this._faces[0] = {
            issue: '双色球 ' + (ds.period || ''),
            pool: '奖池 ' + (ds.poolAmount || ''),
            countdown: diff > 0 ? this.fmtCountdown(diff) : (ds.countdown || '')
          };
          this._statusSsq = ds;
        })
        .catch(() => {})
        .then(afterOne);
      fetchStatus('/lottery/status?type=dlt')
        .then((dd) => {
          if (!dd) return;
          const diff = dd.saleEndAt ? Math.max(0, Number(dd.saleEndAt) - base) : 0;
          this._cdDiffs.dlt = diff;
          this._faces[1] = {
            issue: '大乐透 ' + (dd.period || ''),
            pool: '奖池 ' + (dd.poolAmount || ''),
            countdown: diff > 0 ? this.fmtCountdown(diff) : (dd.countdown || '')
          };
          this._statusDlt = dd;
        })
        .catch(() => {})
        .then(afterOne);
    } catch (e) { /* ignore */ }
  },

  // 渲染当前彩种的奖池信息（纯文字切换，无翻牌动画）
  renderFace() {
    const faces = this._faces || [];
    const f = faces[this.data.lotteryIdx];
    if (!f) return;
    this.setData({ drawInfo: { issue: f.issue, pool: f.pool, countdown: f.countdown } });
  },

  // 距停售倒计时格式化（HH:MM:SS，走秒）
  fmtCountdown(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const pad = (n) => (n < 10 ? '0' + n : '' + n);
    return '距停售 ' + pad(h) + ':' + pad(m) + ':' + pad(sec);
  },

  // 每秒刷新倒计时：两个彩种差值各自自减，只更新当前展示彩种的 countdown 文本
  startCountdown() {
    this.clearCountdown();
    if (!this._cdDiffs) return;
    this._countdownTimer = setInterval(() => {
      const faces = this._faces || [];
      if (this._cdDiffs.ssq != null) {
        this._cdDiffs.ssq = Math.max(0, this._cdDiffs.ssq - 1000);
        if (faces[0]) faces[0].countdown = this.fmtCountdown(this._cdDiffs.ssq);
      }
      if (this._cdDiffs.dlt != null) {
        this._cdDiffs.dlt = Math.max(0, this._cdDiffs.dlt - 1000);
        if (faces[1]) faces[1].countdown = this.fmtCountdown(this._cdDiffs.dlt);
      }
      const cur = faces[this.data.lotteryIdx];
      if (cur) this.setData({ 'drawInfo.countdown': cur.countdown });
    }, 1000);
  },

  clearCountdown() {
    if (this._countdownTimer) {
      clearInterval(this._countdownTimer);
      this._countdownTimer = null;
    }
  },

  // ---- 双彩种 5 秒纯文字切换（眼镜端无点击，替代小程序端切换器） ----
  startLotteryRotate() {
    this.clearRotate();
    this._rotateTimer = setInterval(() => {
      const next = this.data.lotteryIdx === 0 ? 1 : 0;
      this.setData({ lotteryIdx: next });
      this.renderFace();
    }, 5000);
  },

  clearRotate() {
    if (this._rotateTimer) {
      clearInterval(this._rotateTimer);
      this._rotateTimer = null;
    }
  },

  // 待开奖判定（与小程序端同构）：GET /ticket 列表 → status === '待开奖' 的票据
  // ⚠️ 只有"已录入彩票且未开奖"才是待开奖；无票据/无待开奖 → 去录入态（2026-08-26 修正）
  async queryTickets() {
    const app = this.app();
    if (!app) return;
    try {
      let data = app.takePrefetched ? app.takePrefetched('/ticket') : null;
      if (!data) data = await app.request({ url: '/ticket' });
      this._anySuccess = true;
      const list = (data && data.list) || [];
      const pending = list.filter((t) => t.status === '待开奖');
      this._pendingDraw = pending.length > 0 ? pending[0] : null;
      if (this._pendingDraw) {
        const t = this._pendingDraw;
        // 开奖时间：优先该彩种 lottery_status 的 drawDate/drawTime，兜底 21:15/21:25
        const st = t.lottery === 'dlt' ? (this._statusDlt || {}) : (this._statusSsq || {});
        const drawDate = (st && st.drawDate) || t.drawDate || '';
        const drawTime = (st && st.drawTime) || (t.lottery === 'dlt' ? '21:25' : '21:15');
        this.setData({
          drawHero: {
            title: (t.lotteryName || '') + ' · ' + (t.period || ''),
            drawTimeText: drawDate ? '开奖时间：' + String(drawDate).slice(5) + ' ' + drawTime : '开奖时间待更新',
            tipText: '开奖后这里会提醒你兑奖结果'
          }
        });
        // 写页面缓存（待开奖 Hero）
        if (app.setPageCache) {
          app.setPageCache('homeTickets', { drawHero: this.data.drawHero });
        }
      }
      this.updateHeroState();
    } catch (e) { /* ignore */ }
  },

  // Hero 三态统一判定（对齐小程序端 home.js 的三选一逻辑）：
  // ⚠️ 每次重新计算，三种状态互斥且可降级——待兑奖 > 待开奖（有已录入未开奖的票）> 去录入。
  //    原实现 `if (heroState === 'redeem') return` 会把卡片锁死在待兑奖：刷新后待兑奖
  //    消失（已兑完/取消）也不会降级到待开奖/去录入，与小程序行为不一致。
  updateHeroState() {
    if (this._redeemPending) {
      this.setData({ heroState: 'redeem' });
    } else if (this._pendingDraw) {
      this.setData({ heroState: 'draw' });
    } else {
      this.setData({ heroState: 'empty' });
    }
  },

  formatYuan(fen) {
    const n = Number(fen) || 0;
    return '¥' + Math.floor(n / 100).toLocaleString('en-US');
  },

  shortDate(iso) {
    if (!iso) return '';
    return String(iso).slice(5, 10);
  },

  // 预计算功能区按钮选中态（接受显式 next 参数，避免 setData 时序问题）
  applyFocus(next) {
    const f = next != null ? next : this.data.focusIndex;
    this.setData({
      btnCls0: f === 0 ? 'btn btn-active' : 'btn',
      btnText0: f === 0 ? '▸ 录入' : '录入',
      btnTextCls0: f === 0 ? 'btn-text btn-text-on' : 'btn-text',
      btnCls1: f === 1 ? 'btn btn-active' : 'btn',
      btnText1: f === 1 ? '▸ 推荐' : '推荐',
      btnTextCls1: f === 1 ? 'btn-text btn-text-on' : 'btn-text',
      btnCls2: f === 2 ? 'btn btn-active' : 'btn',
      btnText2: f === 2 ? '▸ 台账' : '台账',
      btnTextCls2: f === 2 ? 'btn-text btn-text-on' : 'btn-text'
    });
  },

  // ---- 键位拦截（onKeyDown 即时反馈 + onKeyUp 拦截默认滚动） ----
  // ⚠️ 循环模式：功能区 3 键（录入/推荐/台账），最右继续右滑回"录入"，最左继续左滑跳"台账"
  onKeyDown(event) {
    const code = event && event.code;
    if (code === 'ArrowUp' || code === 'ArrowDown') {
      const total = 3;
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
      // ⚠️ 根页放行宿主默认（返回/请求关闭应用）：home 是登录后的根页面（reLaunch 清栈），
      // 无上级可退 → 宿主默认 = 关闭应用 → 双击触控板/返回键可退出智能体（2026-08-26 需求）。
      // 保护窗口：页面渲染后 3 秒内仍拦截（防宿主在唤起/跳转瞬间注入返回事件）。
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

  confirm() {
    this.nav(NAV_TARGETS[this.data.focusIndex]);
  },

  // bindtap 点击（data-index 定位目标页）
  onNavTap(event) {
    let idx = -1;
    try {
      const ds = event && event.currentTarget && event.currentTarget.dataset;
      idx = ds ? Number(ds.index) : -1;
    } catch (e) { idx = -1; }
    if (idx >= 0 && idx < NAV_TARGETS.length) {
      this.nav(NAV_TARGETS[idx]);
    } else {
      this.confirm();
    }
  },

  nav(page) {
    // ⚠️ 改用 navigateTo（保留当前页入栈）：home 留在栈中，子页返回用 navigateBack
    //    弹回原实例（触发 onShow 静默刷新，不重建、不闪加载骨架——官方推荐栈式导航）。
    const routes = {
      record: '/pages/record/record',
      recommend: '/pages/recommend/recommend',
      ledger: '/pages/ledger/ledger'
    };
    const url = routes[page];
    if (!url) return;
    try {
      if (typeof wx !== 'undefined' && wx.navigateTo) wx.navigateTo({ url });
      else if (typeof aiui !== 'undefined' && aiui.navigateTo) aiui.navigateTo({ url });
      else if (typeof wx !== 'undefined' && wx.redirectTo) wx.redirectTo({ url });
    } catch (e) { console.error('跳转失败', e); }
  },

  exitApp() {
    const app = this.app();
    if (app && app.exitApp) app.exitApp();
  }
};
</script>

<page>
  <view class="app">
    <!-- 顶栏三栏 -->
    <view class="topbar">
      <text class="topbar-title">首页</text>
      <view class="topbar-mid">
        <text class="topbar-brand">goodluck+</text>
      </view>
      <text class="topbar-user">{{ userName }}</text>
    </view>
    <view class="divider"></view>

    <view class="body">
      <!-- ⚠️ 双视图叠放 + 内联 opacity 切换（2026-08-26）：
           ink:if/ink:else 大块切换会被 AIUI 引擎做滑动过渡（骨架上滑一半卡住、
           正常信息卡下半屏）。改为两态同帧渲染、绝对定位叠放，opacity 0/1 内联
           style 原地切换（内联 opacity 已验证可靠），无滚动、无过渡、无残影。 -->
      <view class="stage">
        <!-- 面A：骨架态（与真实页同构且高度对齐：Hero 4 行 + 双栏各 4 行）
             ⚠️ 横条收缩动效（2026-08-26）：ink:for 渲染 + 内联 style 整值绑定，
             JS 定时器切换"全长/缩短"宽度，CSS transition 平滑（左固定右收缩）；
             真机不支持 @keyframes/animation，transition 不生效时退化为跳变收缩。 -->
        <view class="stage-face" style="{{ skelStyle }}">
          <view class="panel skel-hero">
            <view ink:for="{{ heroBars }}" ink:key="index" class="skel" style="{{ item.style }}"></view>
          </view>
          <view class="divider-gap"></view>
          <view class="two-col">
            <view class="card-line skel-card">
              <view ink:for="{{ leftBars }}" ink:key="index" class="skel" style="{{ item.style }}"></view>
            </view>
            <view class="card-line skel-card">
              <view ink:for="{{ rightBars }}" ink:key="index" class="skel" style="{{ item.style }}"></view>
            </view>
          </view>
        </view>

        <!-- 面B：数据态 -->
        <view class="stage-face" style="{{ dataStyle }}">
          <!-- ⚠️ Hero 三态用三个独立 ink:if（2026-08-26）：
               不用 ink:elif/ink:else 链——真机对 elif/else 链支持不可靠，
               会出现"待兑奖+去录入同时显示"（用户实测）。heroState 是单一值，
               三个独立 ink:if 天然互斥：redeem / draw / empty 只命中一个。 -->
          <!-- Hero 待兑奖（对齐小程序端：标题「彩种 · 期号」+ 中奖金额 + 兑奖截止提示） -->
          <view ink:if="{{ heroState === 'redeem' }}" class="panel">
            <view class="hero-top">
              <text class="sm-strong">▸ 待兑奖</text>
              <text class="cap">共 {{ redeem.count }} 笔</text>
            </view>
            <text class="cap">{{ redeem.title }}</text>
            <view class="hero-main">
              <text class="sm">中奖金额</text>
              <text class="mono-display">{{ redeem.amount }}</text>
            </view>
            <text class="cap">{{ redeem.tipText }}</text>
          </view>

          <!-- Hero 待开奖（对齐小程序端：标题「彩种 · 期号」+ 开奖时间 + 提示） -->
          <view ink:if="{{ heroState === 'draw' }}" class="panel">
            <view class="hero-top">
              <text class="sm-strong">▸ 待开奖</text>
              <text class="cap">已购 {{ stats.periods }} 期</text>
            </view>
            <text class="cap">{{ drawHero.title }}</text>
            <view class="hero-main">
              <text class="sm">开奖时间</text>
              <text class="h1">{{ drawHero.drawTimeText }}</text>
            </view>
            <text class="cap">{{ drawHero.tipText }}</text>
          </view>

          <!-- Hero 待录入（对齐小程序端：购彩提醒 + 空态文案） -->
          <view ink:if="{{ heroState === 'empty' }}" class="panel">
            <view class="hero-top">
              <text class="sm-strong">▸ 去录入</text>
              <text class="cap">购彩提醒</text>
            </view>
            <text class="h1" style="color: rgba(64,255,94,0.72);">当前没有待开奖或待兑奖的彩票</text>
            <text class="cap">录入彩票后，这里会优先提醒你开奖进度和兑奖状态</text>
          </view>

          <view class="divider-gap"></view>

          <!-- 双栏细线卡 -->
          <view class="two-col">
            <!-- 左卡：下一期奖池信息 · 双彩种 5 秒纯文字切换（字号亮度与右侧统计卡统一） -->
            <view class="card-line">
              <text class="cap">下一期奖池信息</text>
              <text class="sm">{{ drawInfo.issue }}</text>
              <text class="sm">{{ drawInfo.pool }}</text>
              <text class="sm">{{ drawInfo.countdown }}</text>
            </view>
            <!-- 右卡：购彩统计（对齐小程序端三项，数值亮度统一） -->
            <view class="card-line">
              <text class="cap">购彩统计</text>
              <text class="sm">已购期数：{{ stats.periods }} 期</text>
              <text class="sm">总花费：{{ stats.spent }}</text>
              <text class="sm">中奖总额：{{ stats.won }}</text>
            </view>
          </view>
        </view>
      </view>
    </view>

    <view class="divider"></view>

    <!-- 功能区 -->
    <view class="funcbar">
      <view class="{{ btnCls0 }}" bindtap="onNavTap" data-index="0">
        <text class="{{ btnTextCls0 }}">{{ btnText0 }}</text>
      </view>
      <view class="{{ btnCls1 }}" bindtap="onNavTap" data-index="1">
        <text class="{{ btnTextCls1 }}">{{ btnText1 }}</text>
      </view>
      <view class="{{ btnCls2 }}" bindtap="onNavTap" data-index="2">
        <text class="{{ btnTextCls2 }}">{{ btnText2 }}</text>
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

/* ============ 骨架/数据双面叠放（原地切换，无滚动过渡） ============ */
.stage {
  position: relative;
  flex-grow: 1; flex-shrink: 1; flex-basis: 0%;
  min-height: 0;
}
.stage-face {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  /* gap 不设：内部 panel/divider-gap/two-col 间距由 divider-gap 自带 margin 8px 提供 */
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
  top: 4px;
  width: 2px;
  height: 26px;
  background-color: rgba(64,255,94,0.72);
  /* AIUI 不支持 animation/@keyframes：静态显示（2026-08-26 合规化） */
}

/* ============ 首页私有样式 ============ */
.hero-top {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.hero-main {
  display: flex;
  flex-direction: row;
  align-items: baseline;
  gap: 12px;
}
.two-col {
  display: flex;
  flex-direction: row;
  gap: 12px;
}
.two-col .card-line {
  flex-grow: 1; flex-shrink: 1; flex-basis: 0%;
  min-width: 0;
}
.skel {
  border-radius: 3px;
  background-color: rgba(64,255,94,0.24);
  flex-grow: 0; flex-shrink: 0; flex-basis: auto;
}
.skel-hero {
  padding: 10px;
  gap: 6px;
  border: 1px solid rgba(64,255,94,0.24);  /* 设计稿骨架 Hero 面板带 1px24% 结构线 */
}
.skel-card {
  gap: 5px;
  min-height: 56px;
}
</style>
