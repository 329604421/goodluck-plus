/**
 * pages/recommend/recommend.js - 号码推荐页（Screen4）
 *
 * 三层切换：
 *  1. 彩种：双色球(ssq) / 大乐透(dlt) — 号码卡上方 segmented
 *  2. 推演体系：星座占星(astrology) / 五行推命(iching) — 体系行
 *  3. 重新生成按钮 — 一次性更新全部 4 注（2 体系 × 2 彩种）
 *
 * 数据策略（2026-08-20 调整）：
 *  首次进入页面即并行生成全部 4 注（当天已有缓存的秒回，无缓存的调 LLM），
 *  存 recMap 后切换彩种/体系为纯本地秒切，不再逐个按需请求。
 */
const api = require('../../utils/api');

const ALL_COMBOS = [
  { system: 'astrology', lottery: 'ssq' },
  { system: 'astrology', lottery: 'dlt' },
  { system: 'iching', lottery: 'ssq' },
  { system: 'iching', lottery: 'dlt' }
];

function recKey(system, lottery) {
  return `${system}-${lottery}`;
}

function normalizeLotteryType(value, fallback = 'ssq') {
  if (typeof value === 'string' && value) {
    return value;
  }
  if (Array.isArray(value) && value.length) {
    return value[0];
  }
  return fallback;
}

function formatTodayDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatGenderText(gender) {
  if (gender === 'male') return '男';
  if (gender === 'female') return '女';
  return '未设置';
}

function buildUserProfile(config = {}) {
  return {
    name: config.name || '未填写',
    genderText: formatGenderText(config.gender),
    birth: config.birth || '未填写',
    todayDate: formatTodayDate()
  };
}

function buildAnalysisText(rec = {}, userProfile = {}, lotteryType = 'ssq') {
  const lotteryName = lotteryType === 'dlt' ? '大乐透' : '双色球';
  const redText = (rec.redBalls || []).join(' / ') || '--';
  const blueText = (rec.blueBalls || []).join(' / ') || '--';
  const text = `${userProfile.name || '你'} · ${userProfile.genderText || '未设置'} · ${userProfile.birth || '未填写'} 生，结合今日 ${userProfile.todayDate || formatTodayDate()} 的个人信息，按${rec.systemName || '趣味推演'}为你生成一组${lotteryName}号码。先在${rec.redLabel || '主号区'}中筛出 ${redText} 作为主选组合，再结合${rec.blueLabel || '补充区'}补入 ${blueText} 作为收束号码。${rec.summary || '本推荐仅供娱乐参考。'} 本结果仅供娱乐，不构成购彩建议。`;
  return text.length > 300 ? `${text.slice(0, 297)}...` : text;
}

/**
 * 分析视图：analysisText（完整文案）+ analysisParagraphs（按句分段，抽屉展示更美观）。
 * 2026-08-20 优化：抽屉内逐段渲染 + 行间距，替代单段长文本。
 * 注意：不用 lookbehind（部分低版本基础库不兼容），手动在标点后切分。
 */
function buildAnalysisView(text) {
  const raw = String(text || '');
  const parts = [];
  let buf = '';
  for (const ch of raw) {
    buf += ch;
    if (/[。；;！？!?]/.test(ch)) {
      const trimmed = buf.trim();
      if (trimmed) parts.push(trimmed);
      buf = '';
    }
  }
  const last = buf.trim();
  if (last) parts.push(last);
  return {
    analysisText: raw,
    analysisParagraphs: parts.length ? parts : [raw]
  };
}

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    loading: false,
    refreshing: false,
    loadedOnce: false,
    errorText: '',
    // 结果可信度（2026-10-16）：上次刷新中失败/缺失的组合键，以及针对当前组合的提示文案。
    // 此前只要有请求返回就把 loadedOnce 置 true，且部分失败也弹「已更新全部推荐」——
    // 用户看到的是「旧号码 / 初始化示例」被当成本次新生成的结果。
    staleKeys: [],
    resultNotice: '',
    analysisDrawerVisible: false,
    currentLottery: 'ssq',         // ssq 双色球 / dlt 大乐透
    system: 'astrology',           // astrology / iching
    recMap: {},                    // { 'astrology-ssq': rec, ... } 全量 4 注，切换本地秒读
    userProfile: buildUserProfile(),
    analysisText: '',
    analysisParagraphs: [],
    rec: {
      systemName: '星座占星',
      date: '2024-08-13 周二',
      userText: '春生 · 2000-01-15 生 · 今日 甲辰年七月廿八',
      redLabel: '红球区 · 6 个',
      blueLabel: '蓝球区 · 1 个',
      redBalls: ['03', '08', '15', '21', '27', '30'],
      blueBalls: ['09'],
      summary: '今日火星入命宫，红球偏向高频区 03/08/15/21/27/30，蓝球取幸运数位 9，祝您好运。',
      disclaimer: '本推荐仅供娱乐，不构成任何购彩建议'
    }
  },

  onLoad() {
    // 注入胶囊对齐导航参数
    const app = getApp();
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight,
      navBarHeight: app.globalData.navBarHeight
    });
    const savedConfig = wx.getStorageSync('userConfig') || app.globalData.userConfig;
    if (savedConfig) {
      const currentLottery = normalizeLotteryType(savedConfig.lotteryType || savedConfig.lotteryTypes, this.data.currentLottery);
      const system = savedConfig.divinationSystem || this.data.system;
      const userProfile = buildUserProfile(savedConfig);
      const analysisView = buildAnalysisView(buildAnalysisText(this.data.rec, userProfile, currentLottery));
      this.setData({
        currentLottery,
        system,
        userProfile,
        ...analysisView
      });
    }
  },

  onShow() {
    this.updateTabBar(this.data.analysisDrawerVisible);
    this.loadUserProfile()
      .finally(() => {
        if (!this.data.loadedOnce) {
          // 首次进入：一次性生成全部 4 注（有缓存秒回、无缓存调 LLM），切换即本地秒读
          this.fetchAllRecommendations(false);
        }
      });
  },

  onHide() {
    this.updateTabBar(false);
  },

  onUnload() {
    this.updateTabBar(false);
  },

  updateTabBar(hidden) {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2, hidden });
    }
  },

  loadUserProfile() {
    return api.getUserConfig()
      .then((res) => {
        if (res && res.data) {
          const currentLottery = normalizeLotteryType(res.data.lotteryType || res.data.lotteryTypes, this.data.currentLottery);
          const system = res.data.divinationSystem || this.data.system;
          const userProfile = buildUserProfile(res.data);
          const configChanged = this.data.loadedOnce && (currentLottery !== this.data.currentLottery || system !== this.data.system);
          const analysisView = buildAnalysisView(buildAnalysisText(this.data.rec, userProfile, currentLottery));
          this.setData({
            currentLottery,
            system,
            userProfile,
            ...analysisView
          });
          // 配置变化：四注已全量就绪，仅本地切到对应组合即可（无需再请求）
          if (configChanged) {
            this.showCurrentRec();
          }
        }
        return null;
      })
      .catch(() => {});
  },

  // 彩种切换（双色球 / 大乐透）：本地秒读 recMap，不再发请求
  switchLottery(e) {
    const lottery = e.currentTarget.dataset.type;
    if (lottery === this.data.currentLottery) return;
    this.setData({ currentLottery: lottery });
    this.showCurrentRec();
  },

  // 推演体系切换（星座占星 / 五行推命）：本地秒读 recMap，不再发请求
  switchSystem(e) {
    const system = e.currentTarget.dataset.system;
    if (system === this.data.system) return;
    this.setData({ system });
    this.showCurrentRec();
  },

  /** 当前 (体系, 彩种) 组合是否属于「上次更新失败」的那一批 */
  setResultNotice() {
    const keys = this.data.staleKeys || [];
    const currentKey = recKey(this.data.system, this.data.currentLottery);
    this.setData({
      resultNotice: keys.indexOf(currentKey) > -1 ? '更新失败，这里显示的是上次结果' : ''
    });
  },

  /** 本地展示当前 (体系, 彩种) 组合；recMap 缺失时兜底补生成（正常不会发生） */
  showCurrentRec() {
    const { system, currentLottery, recMap, userProfile } = this.data;
    const rec = recMap[recKey(system, currentLottery)];
    if (rec) {
      const analysisView = buildAnalysisView(buildAnalysisText(rec, userProfile, currentLottery));
      // loadedOnce 与 rec 一起置位：拿到了结果才算「加载过」
      this.setData({ rec, loadedOnce: true, ...analysisView });
      this.setResultNotice();
      return true;
    }
    this.setResultNotice();
    this.fetchRecommend(system, currentLottery);
    return false;
  },

  /**
   * 一次性生成/刷新全部 4 注（2 推演体系 × 2 彩种），并行请求。
   * refresh=true 时绕过当天缓存强制重新生成（"重新生成"按钮）；否则有缓存秒回。
   * 单注失败不影响其他三注（catch 置 null，全部失败才提示错误）。
   */
  fetchAllRecommendations(refresh = false, options = {}) {
    const { useModalLoading = false, toastOnSuccess = false } = options;
    this.setData({
      loading: !this.data.loadedOnce && !useModalLoading,
      refreshing: useModalLoading,
      errorText: ''
    });

    if (useModalLoading) {
      wx.showLoading({ title: '更新全部推荐中...', mask: true });
    }

    return Promise.all(
      ALL_COMBOS.map((c) =>
        api.getRecommendation({ system: c.system, lottery: c.lottery, refresh })
          // 失败也带上 key，否则后面无法判断「是哪一个组合没拿到结果」
          .then((res) => ({ key: recKey(c.system, c.lottery), data: (res && res.data) || null }))
          .catch(() => ({ key: recKey(c.system, c.lottery), data: null }))
      )
    )
      .then((results) => {
        const recMap = { ...this.data.recMap };
        const staleKeys = [];
        for (const r of results) {
          if (!r) continue;
          if (r.data) recMap[r.key] = r.data;
          else staleKeys.push(r.key);
        }
        const currentKey = recKey(this.data.system, this.data.currentLottery);
        const hasCurrent = !!recMap[currentKey];
        const currentRec = recMap[currentKey] || this.data.rec;
        const analysisView = buildAnalysisView(buildAnalysisText(currentRec, this.data.userProfile, this.data.currentLottery));
        const patch = {
          recMap,
          staleKeys,
          ...analysisView
        };
        // 只有当前组合真的拿到结果才置 loadedOnce —— 否则「初始化示例」会被当成新结果展示
        if (hasCurrent) {
          patch.rec = currentRec;
          patch.loadedOnce = true;
        }
        this.setData(patch, () => this.setResultNotice());

        if (staleKeys.length && staleKeys.length < results.length) {
          this.setData({ errorText: '部分推荐更新失败，其余已更新。' });
        } else if (staleKeys.length === results.length) {
          this.setData({ errorText: '推荐结果更新失败，请稍后重试。' });
        } else {
          this.setData({ errorText: '' });
        }

        if (toastOnSuccess) {
          wx.showToast({
            title: staleKeys.length ? '部分组合更新失败，已保留原结果' : '已更新全部推荐',
            icon: 'none'
          });
        }
      })
      .catch(() => {
        this.setData({ errorText: '推荐结果加载失败，请稍后重试。' });
        if (useModalLoading) {
          wx.showToast({ title: '生成失败，请重试', icon: 'none' });
        }
      })
      .finally(() => {
        if (useModalLoading) {
          wx.hideLoading();
        }
        this.setData({ loading: false, refreshing: false });
      });
  },

  fetchRecommend(system, lottery, options = {}) {
    const { useModalLoading = false, toastOnSuccess = false } = options;
    this.setData({
      loading: !this.data.loadedOnce && !useModalLoading,
      refreshing: useModalLoading,
      errorText: ''
    });

    if (useModalLoading) {
      wx.showLoading({ title: '推演中...', mask: true });
    }

    return api.getRecommendation({ system, lottery, refresh: !!options.refresh })
      .then((res) => {
        const targetKey = recKey(system, lottery);
        if (res && res.data) {
          const analysisView = buildAnalysisView(buildAnalysisText(res.data, this.data.userProfile, lottery));
          const recMap = { ...this.data.recMap, [targetKey]: res.data };
          const staleKeys = (this.data.staleKeys || []).filter((k) => k !== targetKey);
          this.setData({
            recMap,
            staleKeys,
            rec: res.data,
            loadedOnce: true,
            errorText: '',
            ...analysisView
          }, () => this.setResultNotice());
          if (toastOnSuccess) {
            wx.showToast({ title: '新号码已生成', icon: 'none' });
          }
        } else {
          throw new Error('empty');
        }
      })
      .catch(() => {
        const targetKey = recKey(system, lottery);
        const staleKeys = (this.data.staleKeys || []).indexOf(targetKey) > -1
          ? this.data.staleKeys
          : (this.data.staleKeys || []).concat(targetKey);
        this.setData({
          staleKeys,
          errorText: '推荐结果加载失败，请稍后重试。'
        }, () => this.setResultNotice());
        if (useModalLoading) {
          wx.showToast({ title: '生成失败，请重试', icon: 'none' });
        }
      })
      .finally(() => {
        if (useModalLoading) {
          wx.hideLoading();
        }
        this.setData({
          loading: false,
          refreshing: false
        });
      });
  },

  onRetry() {
    this.fetchAllRecommendations(false);
  },

  openAnalysisDrawer() {
    if (!this.data.analysisText) return;
    this.updateTabBar(true);
    this.setData({ analysisDrawerVisible: true });
  },

  closeAnalysisDrawer() {
    this.updateTabBar(false);
    this.setData({ analysisDrawerVisible: false });
  },

  onCopyAnalysis() {
    const text = this.data.analysisText;
    if (!text) return;
    wx.setClipboardData({
      data: text,
      success: () => {
        wx.showToast({ title: '分析描述已复制', icon: 'success' });
      }
    });
  },

  noop() {},

  // 重新生成：一次性更新全部 4 注（2 体系 × 2 彩种），绕过当天缓存
  onRegenerate() {
    this.fetchAllRecommendations(true, {
      useModalLoading: true,
      toastOnSuccess: true
    });
  }
});
