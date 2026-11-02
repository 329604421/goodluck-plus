/**
 * pages/home/home.js - 首页兑奖（Screen2）
 * 自动拉取：待兑奖、本期开奖信息（双色球/大乐透切换）、购彩统计
 */
const api = require('../../utils/api');
const HOME_STORAGE_KEY = 'homePageState';

/** 时长差文案：当天内 'HH:MM:SS'，跨天 'N 天 HH:MM:SS'（与后端 fmtDuration 同款） */
function fmtDur(ms) {
  ms = Math.max(0, ms);
  const days = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const p = (n) => String(n).padStart(2, '0');
  return days > 0 ? `${days} 天 ${p(h)}:${p(m)}:${p(s)}` : `${p(h)}:${p(m)}:${p(s)}`;
}

function todayStr() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function formatAmount(amount) {
  // 2026-08-21：金额只显示到元（去角分）
  return '¥' + Math.round((amount || 0) / 100).toLocaleString('en-US');
}

function buildWinCard(item) {
  return {
    kind: 'redeem',
    id: item.id,
    lotteryType: item.lottery,
    lotteryName: item.lotteryName,
    period: item.period,
    badgeText: '待兑奖',
    title: `${item.lotteryName} · ${item.period}`,
    amountLabel: '中奖金额',
    amount: formatAmount(item.amount),
    rawAmount: item.amount,
    tipText: `兑奖截止 ${item.deadlineDate} · 剩余 ${item.daysLeft} 天`,
    deadlineDate: item.deadlineDate,
    primaryText: '去兑奖',
    secondaryText: item.redeemChannel === 'center' ? '单注 ¥1 万及以上，须到彩票中心兑付' : '单注 ¥1 万以下，彩票店兑付',
    redeemChannel: item.redeemChannel
  };
}

function buildPendingDrawCard(ticket, lotteryStatus) {
  // 待开奖：不显示停售倒计时，改为固定搭配「开奖时间：日期 时刻」
  // （双色球 21:15 / 大乐透 21:25，来自 lottery_status.drawTime；mock 同构）
  const drawDate = (lotteryStatus && lotteryStatus.drawDate) || '';
  const drawTime = (lotteryStatus && lotteryStatus.drawTime) || (ticket.lottery === 'dlt' ? '21:25' : '21:15');
  return {
    kind: 'draw',
    id: `${ticket.lottery}-${ticket.period}`,
    lotteryType: ticket.lottery,
    lotteryName: ticket.lotteryName,
    period: ticket.period,
    badgeText: '待开奖',
    title: `${ticket.lotteryName} · ${ticket.period}`,
    drawTimeText: drawDate ? `开奖时间：${drawDate} ${drawTime}` : '开奖时间待更新',
    tipText: '开奖后这里会提醒你兑奖结果',
    primaryText: '查看详情',
    secondaryText: ticket.betAmount ? `已录入 ${ticket.betAmount}` : ''
  };
}

function buildEmptyCard() {
  return {
    kind: 'empty',
    id: 'empty',
    badgeText: '去录入',
    title: '购彩提醒',
    headline: '当前没有待开奖或待兑奖的彩票',
    desc: '录入彩票后，这里会优先提醒你开奖进度和兑奖状态。',
    primaryText: '去录入彩票',
    secondaryText: ''
  };
}

function getHomePageState() {
  return wx.getStorageSync(HOME_STORAGE_KEY) || {};
}

function setHomePageState(nextState) {
  wx.setStorageSync(HOME_STORAGE_KEY, nextState);
}

function getDismissedRedeemIds(homePageState) {
  if (Array.isArray(homePageState.dismissedRedeemIds)) {
    return homePageState.dismissedRedeemIds;
  }
  if (homePageState.dismissedWinCardId) {
    return [homePageState.dismissedWinCardId];
  }
  return [];
}

function buildHomeNoticeText(heroCard, redeemCount, drawCount) {
  if (!heroCard) {
    return '欢迎回来，开奖记录正在同步中';
  }
  if (heroCard.kind === 'redeem') {
    return `欢迎回来，有 ${redeemCount} 张彩票待兑奖`;
  }
  if (heroCard.kind === 'draw') {
    return `欢迎回来，有 ${drawCount} 张彩票待开奖`;
  }
  return '欢迎回来，录入彩票后会在这里提醒开奖和兑奖';
}

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    contentHeight: 'calc(100vh - 64px)',
    userInfo: { name: '春生' },
    pendingCount: 0,
    actualPendingCount: 0,
    pendingDrawCount: 0,
    heroCard: null,
    homeNoticeText: '欢迎回来，开奖记录正在同步中',
    loading: false,
    errorText: '',
    currentType: 'ssq',
    statusMap: {},
    status: {},
    stats: {},
    drawerVisible: false,
    drawerMode: '',
    drawerPayload: {},
    // Rokid 口令抽屉（2026-08-25 改造说明 §4）
    rokidUserId: '',
    rokidCode: '',
    drawDetailVisible: false // 开奖详情半屏抽屉（专注开奖信息）
  },

  onLoad() {
    // 注入胶囊对齐导航参数
    const app = getApp();
    const statusBarHeight = app.globalData.statusBarHeight;
    const navBarHeight = app.globalData.navBarHeight;
    this.setData({
      statusBarHeight,
      navBarHeight,
      contentHeight: `calc(100vh - ${statusBarHeight + navBarHeight}px)`
    });
  },

  onShow() {
    this.checkInitConfig();
    // 自定义 tabBar 高亮
    this.updateTabBar(false);
    this.loadData();
  },

  /**
   * 初始化判断：本地缓存优先；无缓存则查后端（2026-08-21 修复：
   * 手机/PC 同一 openid 用户——PC 端 storage 为空但数据库已配置，
   * 若只信本地缓存会误跳配置页。改为查库，库中已配置直接进首页）
   */
  checkInitConfig() {
    const app = getApp();
    const saved = app.globalData.userConfig || wx.getStorageSync('userConfig') || {};
    if (saved && (saved.lotteryType || (saved.lotteryTypes && saved.lotteryTypes.length))) {
      if (saved.name) {
        this.setData({ userInfo: { name: saved.name } });
      }
      return; // 本地已有配置，直接首页
    }

    api.getUserConfig()
      .then((res) => {
        const cfg = (res && res.data) || {};
        app.globalData.userConfig = cfg;
        wx.setStorageSync('userConfig', cfg);
        const configured = cfg.initialized === true ||
          !!(cfg.lotteryType || (cfg.lotteryTypes && cfg.lotteryTypes.length));
        if (configured) {
          if (cfg.name) {
            this.setData({ userInfo: { name: cfg.name } });
          }
        } else if (!this._redirectingToInit) {
          this._redirectingToInit = true;
          wx.redirectTo({ url: '/pages/init/init' });
        }
      })
      .catch(() => {
        // 查库失败（网络等）：不跳配置页，页面显示错误态可重试
      });
  },

  onHide() {
    this.stopCountdown();
  },

  onUnload() {
    this.stopCountdown();
  },

  loadData() {
    this.setData({ loading: true, errorText: '' });
    const pendingPromise = api.getPendingRedeem();
    const ticketsPromise = api.getTickets();
    const statsPromise = api.getStatistics();
    const ssqStatusPromise = api.getLotteryStatus('ssq');
    const dltStatusPromise = api.getLotteryStatus('dlt');

    return Promise.all([pendingPromise, ticketsPromise, statsPromise, ssqStatusPromise, dltStatusPromise])
      .then(([pendingRes, ticketsRes, statsRes, ssqStatusRes, dltStatusRes]) => {
        const redeemList = (pendingRes && pendingRes.data && pendingRes.data.list) || [];
        const ticketList = (ticketsRes && ticketsRes.data && ticketsRes.data.list) || [];
        const homePageState = getHomePageState();
        const dismissedRedeemIds = getDismissedRedeemIds(homePageState);
        const visibleRedeemList = redeemList.filter((item) => !dismissedRedeemIds.includes(item.id));
        const pendingDrawList = ticketList.filter((item) => item.status === '待开奖');
        const statusMap = {
          ssq: (ssqStatusRes && ssqStatusRes.data) || {},
          dlt: (dltStatusRes && dltStatusRes.data) || {}
        };
        let heroCard = null;

        if (visibleRedeemList.length) {
          heroCard = buildWinCard(visibleRedeemList[0]);
        } else if (pendingDrawList.length) {
          const topPendingDraw = pendingDrawList[0];
          heroCard = buildPendingDrawCard(topPendingDraw, statusMap[topPendingDraw.lottery]);
        } else {
          heroCard = buildEmptyCard();
        }

        const stats = (statsRes && statsRes.data) || {};
        // 2026-08-21：统计卡片改为三项（已购期数/总花费/中奖总额），金额分 → ¥ 文案
        if (stats && typeof stats === 'object') {
          stats.totalSpentText = formatAmount(stats.totalSpent || 0);
          stats.totalWonText = formatAmount(stats.totalWon || 0);
        }
        const status = statusMap[this.data.currentType] || statusMap.ssq || {};

        this.setData({
          actualPendingCount: visibleRedeemList.length,
          pendingCount: visibleRedeemList.length,
          pendingDrawCount: pendingDrawList.length,
          heroCard,
          homeNoticeText: buildHomeNoticeText(heroCard, visibleRedeemList.length, pendingDrawList.length),
          statusMap,
          status,
          stats
        });
        this.startCountdown(status);
      })
      .catch(() => {
        this.setData({
          errorText: '首页数据加载失败，请检查网络后重试。'
        });
      })
      .finally(() => {
        this.setData({ loading: false });
      });
  },

  loadStatus(type = this.data.currentType) {
    const cachedStatus = this.data.statusMap[type];
    if (cachedStatus) {
      this.setData({
        currentType: type,
        status: cachedStatus
      });
      this.startCountdown(cachedStatus);
      return;
    }
    api.getLotteryStatus(type)
      .then((res) => {
        if (res && res.data) {
          this.setData({
            currentType: type,
            status: res.data,
            statusMap: {
              ...this.data.statusMap,
              [type]: res.data
            }
          });
          this.startCountdown(res.data);
        }
      })
      .catch(() => {
        wx.showToast({ title: '开奖信息加载失败', icon: 'none' });
      });
  },

  /** 前端实时倒计时：基于后端 saleEndAt（停售时刻毫秒时间戳）每秒刷新 countdown 文案 */
  startCountdown(status) {
    this.stopCountdown();
    if (!status || !status.saleEndAt) return; // 无时间戳（旧数据/mock 无字段）则用后端静态文案
    const tick = () => {
      const remain = status.saleEndAt - Date.now();
      let countdown;
      if (remain > 0) {
        countdown = `距停售 ${fmtDur(remain)}`;
      } else if (status.drawDate === todayStr()) {
        countdown = `已停售 · 今晚 ${status.drawTime || ''} 开奖`;
      } else {
        countdown = '已开奖';
      }
      this.setData({ 'status.countdown': countdown });
      if (remain <= 0) this.stopCountdown(); // 停售/开奖后停止跳动
    };
    tick();
    this.countdownTimer = setInterval(tick, 1000);
  },

  stopCountdown() {
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
  },

  openRedeemGuide() {
    const { heroCard } = this.data;
    if (!heroCard || heroCard.kind !== 'redeem') {
      wx.switchTab({ url: '/pages/record/record' });
      return;
    }
    const guide = heroCard.redeemChannel === 'center'
      ? '请携带中奖彩票和本人有效证件，前往当地福利彩票中心办理兑奖。'
      : '请携带中奖彩票前往附近授权彩票店兑奖，建议先确认营业时间。';
    wx.showModal({
      title: `${heroCard.lotteryName}兑奖指引`,
      content: `${heroCard.period}\n中奖金额 ${heroCard.amount}\n${heroCard.tipText}\n${guide}`,
      confirmText: '知道了',
      showCancel: false
    });
  },

  openDrawDetail(type = this.data.currentType) {
    const status = this.data.statusMap[type] || this.data.status || {};
    if (!status || !status.period) {
      wx.showToast({ title: '开奖信息暂未就绪', icon: 'none' });
      return;
    }
    this.setData({
      currentType: type,
      status,
      drawDetailVisible: true
    });
    this.updateTabBar(true);
  },

  closeDrawDetail() {
    this.setData({ drawDetailVisible: false });
    this.updateTabBar(false);
  },

  onRetry() {
    this.loadData();
  },

  onGoRecord() {
    wx.switchTab({ url: '/pages/record/record' });
  },

  onGoConfig() {
    wx.navigateTo({ url: '/pages/init/init' });
  },

  // 双色球 / 大乐透 切换
  switchLottery(e) {
    const type = e.currentTarget.dataset.type;
    if (type === this.data.currentType) return;
    this.loadStatus(type);
  },

  onHeroAction() {
    const { heroCard } = this.data;
    if (!heroCard) return;
    if (heroCard.kind === 'redeem') {
      this.onRedeem();
      return;
    }
    if (heroCard.kind === 'draw') {
      // 待开奖：跳购彩台账页查看该期明细（2026-08-20 调整，不开抽屉）
      wx.switchTab({ url: '/pages/ledger/ledger' });
      return;
    }
    this.onGoRecord();
  },

  onRedeem() {
    const { heroCard } = this.data;
    if (!heroCard || heroCard.kind !== 'redeem') {
      this.openRedeemGuide();
      return;
    }
    this.setData({
      drawerVisible: true,
      drawerMode: 'redeem',
      drawerPayload: {
        title: '完成兑奖',
        desc: '确认完成兑奖后，首页会自动切换到下一条待处理记录；如果当前没有待开奖或待兑奖记录，会提示你录入彩票。',
        amount: `${heroCard.lotteryName} · ${heroCard.amount}`,
        subtext: `${heroCard.period} · ${heroCard.tipText}`
      }
    });
    this.updateTabBar(true);
  },

  onViewDetail() {
    this.openDrawDetail();
  },

  onOpenRokidLogin() {
    // 真实口令抽屉（2026-08-25 改造说明 §4.2）：先确保拿到 userId（config 已带），
    // 再打开抽屉并预填上次验证码（storage 记忆，方便确认/换码）
    const app = getApp();
    const cached = app.globalData.userConfig || wx.getStorageSync('userConfig') || {};
    const open = (userId) => {
      this.setData({
        drawerVisible: true,
        drawerMode: 'rokid',
        rokidUserId: String(userId || ''),
        rokidCode: wx.getStorageSync('rokidLastCode') || '',
        drawerPayload: {
          title: 'Rokid 智能体登录',
          desc: '设置口令后在 Rokid App 的 AI 快捷指令中粘贴，即可完成眼镜端绑定。'
        }
      });
      this.updateTabBar(true);
    };
    if (cached && cached.userId) {
      open(cached.userId);
      return;
    }
    // 缓存无 userId（如清缓存后未拉配置）→ 查后端
    api.getUserConfig()
      .then((res) => {
        const cfg = (res && res.data) || {};
        if (cfg.userId) {
          app.globalData.userConfig = cfg;
          wx.setStorageSync('userConfig', cfg);
        }
        open(cfg.userId || '');
      })
      .catch(() => {
        wx.showToast({ title: '获取账号信息失败，请重试', icon: 'none' });
      });
  },

  /** Rokid 口令验证码输入：仅数字、最长 6 位 */
  onRokidCodeInput(e) {
    const code = String(e.detail.value || '').replace(/\D/g, '').slice(0, 6);
    this.setData({ rokidCode: code });
  },

  noop() {},

  closeDrawer() {
    this.setData({
      drawerVisible: false,
      drawerMode: '',
      drawerPayload: {}
    });
    this.updateTabBar(false);
  },

  updateTabBar(hidden) {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0, hidden });
    }
  },

  onDrawerConfirm() {
    if (this.data.drawerMode === 'redeem') {
      const { heroCard } = this.data;
      if (heroCard && heroCard.kind === 'redeem' && heroCard.id) {
        // 调后端兑奖确认接口（heroCard.id 即 /redeem/pending 返回的兑奖记录 id）
        api.confirmRedeem({ id: heroCard.id })
          .then(() => {
            const homePageState = getHomePageState();
            const dismissedRedeemIds = getDismissedRedeemIds(homePageState);
            setHomePageState({
              ...homePageState,
              dismissedRedeemIds: dismissedRedeemIds.includes(heroCard.id)
                ? dismissedRedeemIds
                : dismissedRedeemIds.concat(heroCard.id)
            });
            this.closeDrawer();
            this.loadData();
          })
          .catch(() => {
            wx.showToast({ title: '兑奖确认失败，请重试', icon: 'none' });
          });
        return;
      }
      this.closeDrawer();
      this.loadData();
      return;
    }

    if (this.data.drawerMode === 'rokid') {
      // 复制口令：先提交验证码（passcode upsert 幂等），成功后再写剪贴板；失败不复制不关抽屉
      const code = this.data.rokidCode;
      const userId = this.data.rokidUserId;
      if (!/^\d{6}$/.test(code)) {
        wx.showToast({ title: '请填写 6 位数字验证码', icon: 'none' });
        return;
      }
      if (!userId) {
        wx.showToast({ title: '账号信息异常，请重试', icon: 'none' });
        return;
      }
      api.setRokidPasscode(code)
        .then((res) => {
          if (!res || res.code !== 0) {
            wx.showToast({ title: '口令设置失败，请重试', icon: 'none' });
            return;
          }
          const passcode = `R${userId}-${code}`;
          wx.setClipboardData({
            data: passcode,
            success: () => {
              const prev = wx.getStorageSync('rokidLastCode') || '';
              wx.setStorageSync('rokidLastCode', code);
              wx.showToast({
                title: prev && prev !== code ? '口令已更新，请重新粘贴到快捷指令' : '口令已复制，请在眼镜端绑定',
                icon: 'none'
              });
            }
          });
          this.closeDrawer();
        })
        .catch(() => {
          wx.showToast({ title: '口令设置失败，请重试', icon: 'none' });
        });
    }
  }
});
