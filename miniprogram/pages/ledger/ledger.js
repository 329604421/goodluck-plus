/**
 * pages/ledger/ledger.js - 台账热力图页（Screen5）
 *
 * 购彩日历 = GitHub 贡献图式动态热力图：
 *  - 日期范围驱动：endDate=今天，往前 12 周，按「自然周」动态分列（列数 11~13 浮动）
 *  - 行 = 开奖日（周一/二/三/四/六/日，6 行）；列 = 周；每格 = 一期开奖
 *  - 月份标签：每月起始列自动定位（6月/7月/8月…，跨年显示 24年1月 格式）
 *  - 颜色深浅 = 每期购彩金额（L4 = ≥¥50 最深）；本周未开奖格 = L0 待开奖
 */
const api = require('../../utils/api');
const { buildHeatmap } = require('../../utils/heatmap');

// 热力图色阶已统一收敛到 WXSS 令牌（--heat-0 ~ --heat-4，见 app.wxss）。
// 2026-10-16 移除 JS 内的 LEVEL_COLORS：它只被写进 cells[].color 而 WXML 从不读取，
// 属于第二套色板 —— 留着就会在改主题时被漏掉，制造「图例变了、格子没变」的假象。

// 购彩状态 → 徽章 class（WXSS 不支持中文类名，统一用英文映射）
const STATUS_CLASS = {
  '待开奖': 'pending',
  '已兑奖': 'redeemed',
  '待兑奖': 'awaiting',
  '未中奖': 'lost'
};

// 月份标签水平间隔（rpx）：与格子列距 46rpx 对齐（2026-08-21 曾试 45，用户调回 46）
const MONTH_PITCH = 46;
const PAGE_SIZE = 3;
const LOTTERY_NAME = {
  ssq: '双色球',
  dlt: '大乐透'
};

function splitWinningNumbers(type, winningNumbers) {
  const list = Array.isArray(winningNumbers) ? winningNumbers.map((item) => String(item).padStart(2, '0')) : [];
  const redCount = type === 'dlt' ? 5 : 6;
  return {
    red: list.slice(0, redCount),
    blue: list.slice(redCount)
  };
}

/**
 * 真实命中比对：用该期开奖号码（draws[date] 的真实 red/blue）逐个球比对。
 * 2026-08-20 修复：此前用 buildMockMatchedSet 随机 hash 冒充命中 →
 * "比对错号码/蓝球乱高亮"。draws 来自 GET /heatmap（按开奖日期反查 draw_results，
 * 与票据 drawDate 精确对应）。
 */
function buildMatchedSet(ballValues, winningValues) {
  const winning = new Set((winningValues || []).map((item) => String(item).padStart(2, '0')));
  return (ballValues || []).map((item) => String(item).padStart(2, '0')).filter((v) => winning.has(v));
}

function buildBallList(rawValue, matchedValues) {
  const matched = new Set((matchedValues || []).map((item) => String(item).padStart(2, '0')));
  return String(rawValue || '')
    .split(/\s+/)
    .filter(Boolean)
    .map((item) => String(item).padStart(2, '0'))
    .map((item) => ({
      value: item,
      matched: matched.has(item)
    }));
}

function buildTicketView(ticket, statusMap, drawsMap = {}) {
  let matchedCount = 0;
  // 该期真实开奖号码：优先后端随票据返回的 winningRed/Blue（覆盖任意历史期），
  // 兜底用 heatmap drawsMap（12 周窗口内）；都无 → 待开奖/未同步，不高亮
  const drawFallback = drawsMap[ticket.drawDate] || {};
  const drawRed = (ticket.winningRed || []).length
    ? ticket.winningRed
    : (drawFallback.red || []).map((item) => String(item).padStart(2, '0'));
  const drawBlue = (ticket.winningBlue || []).length
    ? ticket.winningBlue
    : (drawFallback.blue || []).map((item) => String(item).padStart(2, '0'));
  const hasDraw = drawRed.length > 0 || drawBlue.length > 0;
  const bets = (ticket.bets || []).map((bet) => {
    const redValues = String(bet.red || '').split(/\s+/).filter(Boolean);
    const blueValues = String(bet.blue || '').split(/\s+/).filter(Boolean);
    const redMatchedValues = hasDraw ? buildMatchedSet(redValues, drawRed) : [];
    const blueMatchedValues = hasDraw ? buildMatchedSet(blueValues, drawBlue) : [];
    const redBalls = buildBallList(bet.red, redMatchedValues);
    const blueBalls = buildBallList(bet.blue, blueMatchedValues);
    matchedCount += redMatchedValues.length + blueMatchedValues.length;
    return {
      ...bet,
      redBalls,
      blueBalls
    };
  });
  return {
    ...ticket,
    bets,
    matchedCount
  };
}

function buildTicketDrawer(ticket, statusMap = {}, drawsMap = {}) {
  if (!ticket) return null;
  const isPending = ticket.status === '待开奖';
  // 2026-08-24 修复：待开奖票绝不展示开奖号码——此前 statusMap 最新期号码会兜底给
  // 待开奖票（假数据），且后端未按状态过滤时也可能误带号码。仅已开奖票取号码。
  let winningRed = [];
  let winningBlue = [];
  if (!isPending) {
    // 开奖号码基准：优先该票据所属期的真实号码（后端 winningRed/Blue → drawsMap）
    const drawFallback = drawsMap[ticket.drawDate] || {};
    const statusWinning = splitWinningNumbers(ticket.lottery, (statusMap[ticket.lottery] || {}).winningNumbers);
    winningRed = (ticket.winningRed || []).length
      ? ticket.winningRed
      : (drawFallback.red || []).length
        ? (drawFallback.red || []).map((item) => String(item).padStart(2, '0'))
        : statusWinning.red;
    winningBlue = (ticket.winningBlue || []).length
      ? ticket.winningBlue
      : (drawFallback.blue || []).length
        ? (drawFallback.blue || []).map((item) => String(item).padStart(2, '0'))
        : statusWinning.blue;
  }
  // 2026-10-16：待兑奖按钮由「兑奖」改为「标记已兑奖」——
    // 应用只能记录「我已兑奖」，不能暗示它能代为线下兑奖（需求：兑奖在彩票店/中心完成）
    const actionText = ticket.status === '待兑奖' ? '标记已兑奖' : '删除记录';
  let summaryText = '';

  if (isPending) {
    summaryText = `开奖日期 ${ticket.drawDate || '--'}，开奖后会在这里标出命中的号码。`;
  } else if (ticket.matchedCount > 0) {
    summaryText = `本期共命中 ${ticket.matchedCount} 个号码，已为你逐个高亮显示。`;
  } else {
    summaryText = '本期暂未命中号码，灰色球表示未命中的号码。';
  }

  return {
    ...ticket,
    actionText,
    winningRed: winningRed.map((item) => ({ value: item })),
    winningBlue: winningBlue.map((item) => ({ value: item })),
    drawDate: ticket.drawDate || '',
    summaryText
  };
}

// 日历详情：按开奖日期反查 draw_results（draws: {'YYYY-MM-DD': {period, red, blue}}），
// 修复此前期号/号码错取"当前期"lottery_status 的问题
function buildHeatmapInfo(cell, draws = {}) {
  if (!cell) {
    return {
      title: '点击日历查看详情',
      desc: '已开奖会显示对应期号与开奖号码，未开奖会显示开奖日期。',
      meta: '',
      winningRed: [],
      winningBlue: [],
      canSync: false
    };
  }

  const lotteryName = LOTTERY_NAME[cell.type] || LOTTERY_NAME.ssq;
  const draw = draws[cell.date];

  // 今天及未来不提供同步（开奖在晚上 21:15，白天点"今天"无意义）——与"待开奖"一致展示
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  if (cell.date >= todayStr) {
    return {
      title: `${lotteryName} · 待开奖`,
      desc: `开奖日期 ${cell.date}`,
      meta: '',
      winningRed: [],
      winningBlue: [],
      canSync: false
    };
  }

  if (draw) {
    return {
      title: `${lotteryName} · ${draw.period}`,
      desc: `${cell.date} 开奖`,
      meta: '已开奖',
      // wxml 直接 {{item}} 渲染，保持字符串数组（与旧 splitWinningNumbers.red 同构）
      winningRed: (draw.red || []).map((item) => String(item).padStart(2, '0')),
      winningBlue: (draw.blue || []).map((item) => String(item).padStart(2, '0')),
      canSync: false
    };
  }

  // 已过开奖日但无数据（未同步/补差机会）→ 显示"同步"按钮，用户端触发 SearchInfinity 补差
  return {
    title: `${lotteryName} · ${cell.date}`,
    desc: '开奖号码待同步',
    meta: '',
    winningRed: [],
    winningBlue: [],
    canSync: true
  };
}

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    loading: false,
    errorText: '',
    heatmap: {},
    drawsMap: {},
    heatmapInfo: buildHeatmapInfo(),
    syncingDraw: false,
    statusMap: {},
    sourceTickets: [],
    allTickets: [],
    visibleTickets: [],
    visibleCount: PAGE_SIZE,
    activeCellId: '',
    selectedDrawFilter: null,
    filterChipText: '',
    hasMore: false,
    drawerVisible: false,
    drawerTicket: null,
    drawerSubmitting: false   // 抽屉操作提交中：防重复请求（2026-10-16）
  },

  onLoad() {
    // 注入胶囊对齐导航参数
    const app = getApp();
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight,
      navBarHeight: app.globalData.navBarHeight
    });
  },

  onShow() {
    this.updateTabBar(this.data.drawerVisible);
    this.loadData();
  },

  onHide() {
    this.updateTabBar(false);
  },

  onUnload() {
    this.updateTabBar(false);
  },

  updateTabBar(hidden) {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 3, hidden });
    }
  },

  loadData() {
    this.setData({ loading: true, errorText: '' });

    return Promise.all([api.getHeatmap(), api.getTickets(), api.getLotteryStatus('ssq'), api.getLotteryStatus('dlt')])
      .then(([heatmapRes, ticketsRes, ssqStatusRes, dltStatusRes]) => {
        const d = (heatmapRes && heatmapRes.data) || {};
        const weeks = d.weeks || 12;
        const amounts = d.amounts || {};
        const draws = d.draws || {};
        const statusMap = {
          ssq: (ssqStatusRes && ssqStatusRes.data) || {},
          dlt: (dltStatusRes && dltStatusRes.data) || {}
        };
        const hm = buildHeatmap({
          weeks,
          end: new Date(),
          getLevel: (dateStr) => amounts[dateStr] || 0
        });

        const cells = hm.cells.map((c, index) => {
          const rowIndex = Math.floor(index / hm.cols);
          const row = hm.rowLabels[rowIndex] || {};
          return {
            ...c,
            type: row.type || 'ssq'
          };
        });

        const monthLabels = hm.monthLabels.map((m) => ({
          text: m.text,
          left: m.col * MONTH_PITCH
        }));

        const list = ((ticketsRes && ticketsRes.data && ticketsRes.data.list) || []).map((t) => buildTicketView({
          ...t,
          statusClass: STATUS_CLASS[t.status] || 'pending'
        }, statusMap, draws));

        const visibleTickets = list.slice(0, PAGE_SIZE);

        // 刷新后恢复选中态（同步开奖信息成功后 loadData 触发），避免高亮与详情卡跳变回初始态
        const prevSelected = this.data.selectedDrawFilter;
        const restoredCell = prevSelected
          ? { id: prevSelected.id, date: prevSelected.date, type: prevSelected.type, isFuture: false }
          : null;

        this.setData({
          heatmap: {
            ...hm,
            cells,
            monthLabels,
            legend: d.legend || { min: '¥0', max: '¥50+' }
          },
          drawsMap: draws,
          statusMap,
          sourceTickets: list,
          allTickets: list,
          visibleTickets,
          visibleCount: visibleTickets.length,
          hasMore: list.length > visibleTickets.length,
          activeCellId: restoredCell ? restoredCell.id : '',
          selectedDrawFilter: prevSelected || null,
          filterChipText: prevSelected
            ? `${String(prevSelected.date || '').slice(5)} · ${LOTTERY_NAME[prevSelected.type] || ''}`
            : '',
          heatmapInfo: restoredCell
            ? buildHeatmapInfo(restoredCell, draws)
            : buildHeatmapInfo(null, draws),
          drawerVisible: false,
          drawerTicket: null,
          drawerSubmitting: false
        });

        // 恢复选中后重新应用票据筛选（该期购彩明细仍过滤显示）
        if (prevSelected) this.updateTicketList(list, prevSelected);
      })
      .catch(() => {
        this.setData({
          errorText: '台账数据加载失败，请稍后重试。'
        });
      })
      .finally(() => {
        this.setData({ loading: false });
      });
  },

  onRetry() {
    this.loadData();
  },

  onHeatmapCellTap(e) {
    const { id, date, level, future, type } = e.currentTarget.dataset;
    const cell = {
      id,
      date,
      level: Number(level) || 0,
      isFuture: future === true || future === 'true',
      type
    };
    const selectedDrawFilter = {
      id,
      date,
      type
    };
    this.setData({
      activeCellId: id,
      selectedDrawFilter,
      heatmapInfo: buildHeatmapInfo(cell, this.data.drawsMap)
    });
    this.updateTicketList(this.data.sourceTickets, selectedDrawFilter);
  },

  // 日历"同步"按钮：用户端补差——按开奖日期触发 SearchInfinity 拉取该期开奖结果
  onSyncDraw() {
    if (this.data.syncingDraw) return;
    const { selectedDrawFilter } = this.data;
    if (!selectedDrawFilter || !selectedDrawFilter.date || !selectedDrawFilter.type) return;

    this.setData({ syncingDraw: true });
    api.syncDraw(selectedDrawFilter.type, selectedDrawFilter.date)
      .then((res) => {
        const data = (res && res.data) || {};
        if (data.synced) {
          wx.showToast({ title: data.skipped ? '该期已同步过' : '开奖信息已同步', icon: 'success' });
          this.loadData(); // 刷新日历与列表，同步后该格显示期号+号码
        } else {
          wx.showToast({ title: '暂未获取到开奖信息，请稍后重试', icon: 'none' });
        }
      })
      .catch(() => {
        wx.showToast({ title: '同步失败，请稍后重试', icon: 'none' });
      })
      .finally(() => {
        this.setData({ syncingDraw: false });
      });
  },

  onTicketTap(e) {
    const index = Number(e.currentTarget.dataset.index);
    const ticket = this.data.visibleTickets[index];
    if (!ticket) return;
    this.updateTabBar(true);
    this.setData({
      drawerVisible: true,
      drawerTicket: buildTicketDrawer(ticket, this.data.statusMap, this.data.drawsMap)
    });
  },

  closeDrawer() {
    this.updateTabBar(false);
    this.setData({
      drawerVisible: false,
      drawerTicket: null,
      drawerSubmitting: false
    });
  },

  updateTicketList(sourceList, selectedDrawFilter = this.data.selectedDrawFilter) {
    const filterActive = !!selectedDrawFilter;
    const filteredList = filterActive
      ? sourceList.filter((item) => item.drawDate === selectedDrawFilter.date && item.lottery === selectedDrawFilter.type)
      : sourceList;
    const visibleCount = Math.min(Math.max(this.data.visibleCount, PAGE_SIZE), filteredList.length || 0);
    this.setData({
      sourceTickets: sourceList,
      allTickets: filteredList,
      visibleTickets: filterActive ? filteredList : filteredList.slice(0, visibleCount),
      visibleCount: filterActive ? this.data.visibleCount : visibleCount,
      hasMore: !filterActive && filteredList.length > visibleCount,
      // 筛选标签文案（2026-10-16）：形如「02-14 · 双色球」
      filterChipText: filterActive
        ? `${String(selectedDrawFilter.date || '').slice(5)} · ${LOTTERY_NAME[selectedDrawFilter.type] || ''}`
        : ''
    });
  },

  /** 清除当前开奖期筛选（由标题旁标签触发，2026-10-16 新增） */
  onClearFilter() {
    this.setData({
      activeCellId: '',
      selectedDrawFilter: null,
      filterChipText: '',
      heatmapInfo: buildHeatmapInfo(null, this.data.drawsMap)
    });
    this.updateTicketList(this.data.sourceTickets, null);
  },

  /**
   * 抽屉主操作（2026-10-16 加固）：
   *  - 「标记已兑奖」：正向操作，提交中禁用按钮防重复请求。
   *  - 「删除记录」：不可逆操作，先弹二次确认，确认文案里写明期号与彩种，
   *    避免在多个期号间操作时删错票；提交中同样禁用。
   */
  onDrawerAction() {
    const { drawerTicket, drawerSubmitting } = this.data;
    if (!drawerTicket || drawerSubmitting) return;

    if (drawerTicket.status === '待兑奖') {
      this.setData({ drawerSubmitting: true });
      // 调后端兑奖确认接口（按票据 id 反查兑奖记录；mock 模式下直接成功）
      api.confirmRedeem({ ticketId: drawerTicket.id })
        .then(() => {
          const nextList = this.data.sourceTickets.map((item) => {
            if (item.period === drawerTicket.period && item.lottery === drawerTicket.lottery) {
              const updatedTicket = {
                ...item,
                status: '已兑奖',
                statusClass: STATUS_CLASS['已兑奖']
              };
              return buildTicketView(updatedTicket, this.data.statusMap, this.data.drawsMap);
            }
            return item;
          });
          this.updateTicketList(nextList);
          this.closeDrawer();
          wx.showToast({ title: '已标记为兑奖完成', icon: 'success' });
        })
        .catch(() => {
          this.setData({ drawerSubmitting: false });
          wx.showToast({ title: '兑奖确认失败，请重试', icon: 'none' });
        });
      return;
    }

    // 删除：二次确认 → 提交
    wx.showModal({
      title: '删除这条购彩记录？',
      content: `${drawerTicket.lotteryName} · ${drawerTicket.period}\n删除后无法恢复，对应的购彩日历金额也会同步减少。`,
      confirmText: '删除记录',
      confirmColor: '#C8102E',
      cancelText: '保留记录',
      success: (res) => {
        if (!res.confirm) return;
        this.doDeleteTicket(drawerTicket);
      }
    });
  },

  /** 真正执行删除；提交中禁用重复点击 */
  doDeleteTicket(drawerTicket) {
    if (this.data.drawerSubmitting) return;
    this.setData({ drawerSubmitting: true });
    api.deleteTicket(drawerTicket.id)
      .then(() => {
        this.closeDrawer();
        wx.showToast({ title: '记录已删除', icon: 'success' });
        // 全量刷新：删除影响购彩金额 → 日历热力图颜色必须同步（仅局部更新列表会导致日历不更新）
        this.loadData();
      })
      .catch(() => {
        this.setData({ drawerSubmitting: false });
        wx.showToast({ title: '删除失败，请重试', icon: 'none' });
      });
  },

  noop() {},

  /** 分页（筛选态下该行已隐藏 —— 清除筛选走 onClearFilter） */
  onLoadMore() {
    const nextCount = Math.min(this.data.visibleCount + PAGE_SIZE, this.data.allTickets.length);
    if (nextCount === this.data.visibleCount) {
      wx.showToast({ title: '已加载全部记录', icon: 'none' });
      return;
    }

    this.setData({
      visibleCount: nextCount,
      visibleTickets: this.data.allTickets.slice(0, nextCount),
      hasMore: nextCount < this.data.allTickets.length
    });
  }
});
