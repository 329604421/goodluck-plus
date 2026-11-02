/**
 * pages/nearby/nearby.js - 「附近彩站」地图页（tab 型页面，tabBar 第 3 位）
 *
 * 设计依据：《小程序附近功能迭代说明_V1.0.md》§3（功能）与画布「彩票小助手 · 附近功能设计稿」6 屏
 * 屏序对照：01 首屏落点 / 02 点标记→站点卡片 / 03 点气泡→网点列表 / 04 拖动后搜索此区域 / 05 定位被拒 / 06 空态
 *
 * 五条不可动摇的约束（改动前先读需求文档）：
 *   1. 配额保护：**平移**地图绝不自动检索，只浮现「搜索此区域」；
 *      **缩放**改变了范围才自动重搜（V1.10 修订，理由见 onRegionChange）
 *   2. 检索半径跟随地图视野（V1.10 新增）—— 让「视野内有点就一定搜得到」
 *   3. **定位类检索后把结果整体框进视野**（V1.11 新增，见 frameStations）——
 *      这是让「已找到 N 个」与「屏幕上有 N 个标记」一致的那一步。
 *      只靠第 2 条做不到：实测腾讯 auto_extend=1 让 radius 基本失效（见 frameStations 注释）
 *   4. 抽屉优先：卡片/列表打开时隐藏 tabBar 与左上搜索结果气泡，关闭后一并恢复
 *   5. 导航只唤起系统地图 App（MapContext.openMapApp），不做内嵌路线规划、不画 polyline（需求 §3.6）
 *   6. **选中站点时地图中心跟随，关闭卡片后退回原处**（V1.12 新增，见 panTo / rememberAnchor）——
 *      全程只改中心、**绝不改缩放级别**。因此只能用 moveToLocation：
 *        · includePoints 的职责是「缩放视野以包含所有点」，会改级别，正是要排除的；
 *        · MapContext.moveTo **不在官方 API 列表里**（官方是 moveToLocation），旧代码属于误用。
 *
 * 顶部沿用全站统一导航栏（.nav-bar），标题「附近彩站」；地图自导航栏下沿铺满至屏幕底部。
 */
const nearby = require('../../utils/nearby');
const cfg = require('../../config/index');
const theme = require('../../utils/theme');

const TAB_INDEX = 2;                     // tabBar 第 3 位 = 附近
const DRAG_HINT = '地图已移动，请点左下角「搜索此区域」';
const LOCATING_HINT = '正在定位…';
const SEARCHING_HINT = '正在搜索附近网点…';

/**
 * 地图个性化样式（可选付费能力，见 config.mapCustomStyle）。
 *
 * 关闭时返回官方默认值 —— subkey 空串等价于「未设置」，layer-style 默认值本就是 1，
 * 所以关闭状态与不写这两个属性**完全等价**，不会影响现有地图功能。
 * 开启时按当前主题在浅/深两套样式编号间切换（layer-style 支持动态改）。
 */
function resolveMapSubkey() {
  const m = cfg.mapCustomStyle;
  if (!m || !m.enabled) return '';
  return m.subkey || cfg.TENCENT_LBS_KEY || '';
}

function resolveMapLayerStyle() {
  const m = cfg.mapCustomStyle;
  if (!m || !m.enabled) return 1;
  return theme.current() === 'dark'
    ? (Number(m.styleDark) || 1)
    : (Number(m.styleLight) || 1);
}

// 手势结束到量视野之间等一小会儿：regionchange 的 end 与 getRegion 取值之间有几帧间隙
const VIEW_SETTLE_MS = 60;
// 缩放自动重搜的防抖窗口 —— 连续双指缩放只在停手后搜一次
const AUTO_SEARCH_DEBOUNCE_MS = 420;

// 标记点击后多久内的地图 tap 视为「同一次触摸的连发」，直接忽略（见 onMarkerTap）
const MARKER_TAP_GUARD_MS = 400;

// 程序性平移地图后多久内的 regionchange 一律忽略（见 panTo）。
// moveToLocation 属于「调用接口导致」的视野变化（causedBy='update'），本应被 onRegionChange 过滤；
// 这里再留一个时间窗兜底 —— 万一某家基础库把它报成 drag/scale，
// 就会走进「用户移动了地图」分支，把刚打开的卡片立刻关掉（表现：点标记没反应）。
const PROGRAMMATIC_PAN_GUARD_MS = 700;

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    mapHeight: 500,

    // 地图
    latitude: 39.908491,
    longitude: 116.423545,
    scale: 16,
    showLocation: true,
    markers: [],
    // 地图个性化底图：关闭时为空串 / 1（官方默认），等价于「没有这两个属性」
    mapSubkey: '',
    mapLayerStyle: 1,

    // 数据
    stations: [],
    total: 0,
    coverageText: '',      // 形如「最近 533 米」（V1.11 起改用最近点，不再用最远点）
    listSubtitle: '',      // 形如「共 20 个 · 最近 533 米」
    fromCache: false,

    // 交互态
    selectedIndex: -1,
    selectedStation: null,
    panel: '',             // '' | 'card' | 'list'
    dirty: false,          // 拖动后为 true → 显示「搜索此区域」
    locating: false,
    hintText: '',
    showBubble: false,
    bubbleText: '',
    overlay: null          // 异常态浮层（定位被拒 / 空态 / 网络失败 / 配额耗尽）
  },

  onLoad() {
    const app = typeof getApp === 'function' ? getApp() : null;
    const sys = wx.getSystemInfoSync();
    const statusBarHeight = (app && app.globalData && app.globalData.statusBarHeight) || 20;
    const navBarHeight = (app && app.globalData && app.globalData.navBarHeight) || 44;
    const fallback = nearby.getFallbackCenter();

    // 0 = 尚未量过视野；loadNearby 会回落到 config 的兜底半径
    this._radiusTier = 0;
    this._pendingCenter = null;
    this._autoTimer = null;
    this._viewportTimer = null;
    // 地图实测中心（用户拖过地图后，data 上的经纬度就过期了 —— 见 currentMapCenter）
    this._mapCenter = null;
    // 打开卡片前的地图中心，关闭卡片时退回（见 rememberAnchor / closePanel）
    this._anchorCenter = null;
    // 程序性平移的时间窗，窗内的 regionchange 一律忽略（见 PROGRAMMATIC_PAN_GUARD_MS）
    this._panningUntil = 0;

    this.setData({
      statusBarHeight,
      navBarHeight,
      // 地图从导航栏下边缘铺满至屏幕底部（tabBar 是 fixed 浮层，直接叠在地图上）
      mapHeight: Math.max(320, (sys.windowHeight || 667) - statusBarHeight - navBarHeight),
      latitude: fallback.latitude,
      longitude: fallback.longitude,
      mapSubkey: resolveMapSubkey(),
      mapLayerStyle: resolveMapLayerStyle()
    });

    // 主题切换时同步底图样式（仅 mapCustomStyle.enabled 时有效，关闭状态恒为 1）
    this._unsubTheme = theme.subscribe(() => {
      const next = resolveMapLayerStyle();
      if (next !== this.data.mapLayerStyle) {
        this.setData({ mapLayerStyle: next });
      }
    });

    this.loadNearby({ withLocation: true, recenter: true });
  },

  /**
   * 地图就绪后先量一次真实视野。
   *
   * 首屏定位是异步的（几百毫秒），这次读数通常能赶在 fetchNearbyPois 之前就位，
   * 于是首屏就用上正确的半径、而不是兜底的 1000。
   * 这里**刻意不触发重搜**：首屏请求已经在飞，为半径再花一次配额不划算。
   */
  onReady() {
    setTimeout(() => {
      this.readViewport();
    }, VIEW_SETTLE_MS);
  },

  onShow() {
    this.updateTabBar(!!this.data.panel);
  },

  onHide() {
    this.updateTabBar(false);
  },

  onUnload() {
    this.updateTabBar(false);
    if (this._autoTimer) clearTimeout(this._autoTimer);
    if (this._viewportTimer) clearTimeout(this._viewportTimer);
    if (this._unsubTheme) {
      this._unsubTheme();
      this._unsubTheme = null;
    }
  },

  /** 自定义 tabBar 是按页持有的，每个 tab 页都要回写 selected / hidden */
  updateTabBar(hidden) {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      // backdrop: false —— 本页底图是地图，tabBar 的毛玻璃浮层会与地图瓦片
      // 产生视觉冲突（半透明白雾糊在地图纸上），因此仅本页关闭该浮层；
      // 其余 tab 页沿用组件默认值 true（需求 §3.2.3）
      this.getTabBar().setData({ selected: TAB_INDEX, hidden, backdrop: false });
    }
  },

  mapCtx() {
    if (!this._mapCtx) {
      this._mapCtx = wx.createMapContext('nearbyMap', this);
    }
    return this._mapCtx;
  },

  /* ==================== 数据加载 ==================== */

  /**
   * 加载附近站点。**页面唯一的数据入口**。
   * @param {object} opt
   *        withLocation: 是否先定位（首次进入 / 重试 / 回到我的位置 = true）
   *        center:       指定检索中心（「搜索此区域」/ 缩放自动重搜 = 地图当前中心）
   *        recenter:     是否把地图视野移到检索中心（**默认 false**）
   *          ⚠️ 只有「定位」类调用才传 true。平移 / 缩放后的检索**绝不能**回写地图坐标：
   *             部分机型 setData 地图坐标时会连带把 scale 重置回 data.scale，用户刚缩放的
   *             视野会突然跳回去，又触发下一轮 regionchange —— 形成来回搜索。
   *             而这两种场景的检索中心本来就等于地图中心，压根不需要移动视野。
   */
  loadNearby(opt) {
    const options = opt || {};
    const start = options.center
      ? Promise.resolve({ center: options.center, fallback: false })
      : options.withLocation
        ? this.resolveLocation()
        : Promise.resolve({ center: this.currentCenter(), fallback: false });

    this.setData({
      locating: true,
      // 带 center 的是纯检索，不带才是定位 —— 文案别一律写成「正在定位」
      hintText: options.center ? SEARCHING_HINT : LOCATING_HINT,
      dirty: false
    });

    return start.then((res) => {
      const center = res.center;
      const patch = { hintText: SEARCHING_HINT };
      if (options.recenter) {
        patch.latitude = center.latitude;
        patch.longitude = center.longitude;
        // 视野被程序移到检索中心了，实测中心缓存同步跟上（见 currentMapCenter）
        this._mapCenter = { latitude: center.latitude, longitude: center.longitude };
      }
      this.setData(patch);

      // 半径在这里才取（不是函数入口）—— 定位耗时几百毫秒，
      // 期间 onReady 往往已经把真实视野量出来了，首屏就能用上正确半径
      const radius = this._radiusTier || nearby.defaultRadius();
      return nearby.fetchNearbyPois(center, { radius }).then((result) => {
        this.renderResult(result, res.fallback);
        // 只有「定位驱动」的检索才自动适配视野（首屏 / 回到我的位置 / 重试）——
        // 这类场景用户就是想看「我周围有哪些网点」。用户自己拖动 / 缩放出来的视野
        // 是主动行为，绝不能反过来被他自己的操作带着走（见 frameStations 注释）
        if (options.recenter) this.frameStations(result.list);
        return result;
      });
    });
  },

  /**
   * 把检索结果整体框进视野 —— 让「已找到 N 个」与屏幕上的标记数真正一致。
   *
   * 为什么必须做这一步（2026-09-15 实测，用户在 39.9393 / 116.2106）：
   *   腾讯地点搜索开了 `auto_extend=1`，半径内凑不满一页时会**自动向外扩展**，
   *   返回的永远是「离中心最近的 20 条」。实测该位置：
   *     radius=1000 → 20 条，跨度 533m ~ 1825m（≤1000m 的只有 8 条）
   *     radius=300  → 20 条，**逐条完全相同**（533, 653, 653, 867, 900 …）
   *   也就是 `radius` 这个参数在该接口语义下基本失效 —— 所以「让半径跟随视野」
   *   解决不了「提示搜到了、屏幕里没有标点」。
   *   而 scale 16 的视野等效半径只有约 600m，20 条里屏内只落得下最近 1 条。
   *   → 唯一能让两者一致的方向，是反过来让**视野去适配结果集**。
   *
   * 为什么只在定位类检索里调用：
   *   首屏 / 回到我的位置 / 重试，用户要的是「我周围有哪些」；
   *   若每次检索（含缩放自动重搜）都框一次，用户将永远无法放大 —— 一放大就被拉回去。
   *
   * 为什么至少要 2 个点才框：
   *   includePoints 对单点会把视野缩到最极限（屏幕上只剩那一个孤点，底图全无），
   *   那种状态比「保持原视野」更糟。
   *
   * @param {Array} stations 业务模型数组（需含 latitude / longitude）
   */
  frameStations(stations) {
    if (!stations || stations.length < 2) return;
    const ctx = this.mapCtx();
    // 与 onNavigate 同一套写法：能力缺失时明确跳过，不让整页崩在 TypeError 上
    if (typeof ctx.includePoints !== 'function') return;
    ctx.includePoints({
      points: stations.map((s) => ({ latitude: s.latitude, longitude: s.longitude })),
      // [上, 右, 下, 左]，单位 px：顶部给提示条/气泡让位，底部给 tabBar 与操作行让位
      padding: [60, 48, 150, 48],
      // 失败不阻断主流程：数据与标记都已就位，只是视野没自动调
      fail: () => {}
    });
  },

  /**
   * 定位 → 坐标。失败不 reject，回落默认城市（需求 §3.5）。
   * ⚠️ 定位实现全部封在 utils/nearby.js 的 getCurrentLocation 里，
   *    位置接口权限审批通过后只需换那个函数，本页面零改动（需求 §5.2）。
   */
  resolveLocation() {
    return nearby.getCurrentLocation().then((loc) => {
      if (loc) return { center: loc, fallback: false };
      return { center: nearby.getFallbackCenter(), fallback: true };
    });
  },

  currentCenter() {
    return { latitude: this.data.latitude, longitude: this.data.longitude };
  },

  renderResult(res, locationFallback) {
    const stations = res.list || [];
    // ⚠️ total 用**实际渲染出来的标记数**，不用接口给的 count。
    //    腾讯的 count 是「匹配总数」（实测该位置 = 96），而 data 受 page_size=20 限制，
    //    所以屏幕上永远不可能有 96 个标记 —— 用 count 就是又一次「说的 ≠ 看到的」。
    const total = stations.length;
    // 覆盖描述用**最近**那个点的距离。
    //    旧文案用最远点（「约 1.8 公里 内」）有两个问题：
    //      ① 会被读成「检索半径」，与「已找到 20 个」叠加 → 用户期待屏幕上有 20 个标记；
    //      ② 「1.8 公里」是 auto_extend 撑出来的跨度，不是用户选的检索范围，本身有误导性。
    const nearest = stations.length
      ? nearby.formatDistance(Math.min.apply(null, stations.map((s) => s.distance)))
      : '';

    const data = {
      stations,
      total,
      markers: nearby.buildMarkers(stations, -1),
      selectedIndex: -1,
      selectedStation: null,
      fromCache: !!res.fromCache,
      locating: false,
      dirty: false,
      hintText: '',
      coverageText: nearest ? `最近 ${nearest}` : '',
      listSubtitle: stations.length ? `共 ${total} 个 · 最近 ${nearest}` : ''
    };

    // 异常态分流（需求 §3.5）。定位被拒优先于接口异常 —— 用户更关心「为什么没有我附近的」
    if (locationFallback) {
      data.overlay = this.buildOverlay('location');
    } else if (res.error === 'empty') {
      data.overlay = this.buildOverlay('empty');
    } else if (res.error === 'quota') {
      data.overlay = this.buildOverlay('quota');
    } else if (res.error) {
      data.overlay = this.buildOverlay('network');
    } else {
      data.overlay = null;
    }

    this.setData(data);
    this.refreshChrome();
    return res;
  },

  /**
   * 左上搜索结果气泡的显隐，**只在这里决定**（其它地方不要直接改 showBubble）：
   * 有站点 + 未拖动 + 无异常浮层 + 抽屉关闭 → 才显示（需求 §3 三屏状态互斥关系）
   */
  refreshChrome() {
    const { stations, total, coverageText, dirty, overlay, panel } = this.data;
    const show = stations.length > 0 && !dirty && !overlay && !panel;
    this.setData({
      showBubble: show,
      bubbleText: show ? `已找到 ${total} 个网点 · ${coverageText}` : ''
    });
  },

  buildOverlay(type) {
    const center = nearby.getFallbackCenter();
    const city = center.city || '本地';

    if (type === 'location') {
      return {
        icon: 'local',
        title: '无法获取你的位置',
        desc: `已为你展示「${city}」的彩票网点。开启定位后可查看你身边的网点。`,
        actions: [
          { key: 'setting', text: '去设置', icon: 'settingTwo', kind: 'ghost' },
          { key: 'retry', text: '重试', icon: 'refresh', kind: 'primary' }
        ]
      };
    }
    if (type === 'empty') {
      return {
        icon: 'search',
        title: '附近暂未找到彩票站点',
        // 检索范围与地图视野挂钩（V1.10）：查不到通常是「放得太大了」，
        // 所以先给「缩小地图」这条更可能有效的指引
        desc: '可缩小地图看更大范围，或拖动后点左下角「搜索此区域」',
        actions: []
      };
    }
    if (type === 'quota') {
      return {
        icon: 'timer',
        title: '今日查询次数已用完',
        desc: '已为你展示最近一次缓存到的网点，明天再来看看。',
        actions: []
      };
    }
    return {
      icon: 'refresh',
      title: '加载失败，请检查网络后重试',
      desc: '地图仍可正常浏览，也可以拖动后重新搜索此区域。',
      actions: [{ key: 'retry', text: '重试', icon: 'refresh', kind: 'primary' }]
    };
  },

  /* ==================== 地图交互 ==================== */

  onMarkerTap(e) {
    // markerId 是 buildMarkers 里的 index + 1；腾讯 POI id 是字符串，禁止强转（需求 §4.3 坑 1）
    const index = Number(e.detail.markerId) - 1;
    if (!this.data.stations[index]) return;
    // 部分机型点标记后会**连发** markertap + tap，记录时刻交给 onMapTap 忽略掉紧随的那一次，
    // 否则卡片刚打开就被 onMapTap 关掉，表现为「点标记没反应」
    this._markerTapAt = Date.now();
    this.selectStation(index, true);
  },

  onMapTap() {
    // 点地图空白 = 取消选中并收起卡片（需求 §3.4）
    // 但要放过紧跟标记点击而来的那次 tap（见 onMarkerTap 注释）
    if (Date.now() - (this._markerTapAt || 0) < MARKER_TAP_GUARD_MS) return;
    if (this.data.selectedIndex >= 0 || this.data.panel === 'card') {
      // 用户主动关闭 → 视野退回进入卡片前的位置（与点「关闭」同一语义）
      this.closePanel(true);
    }
  },

  onRegionChange(e) {
    if (!e || e.type !== 'end') return;
    // 程序性平移（选中站点 / 关闭卡片退回）同样会触发 regionchange，整段忽略
    if (Date.now() < this._panningUntil) return;
    const causedBy = e.causedBy || '';
    // 只认用户手动拖动 / 缩放；程序的 moveToLocation 触发的 causedBy='update' 必须忽略，
    // 否则每次选中站点都会被误判成「用户移动了地图」。
    //
    // ⚠️ 缩放对应的值是 'scale' —— 官方 map 组件 bindregionchange 返回值写明：
    //    拖动地图导致(drag) / 缩放导致(scale) / 调用接口导致(update)。
    //    早期只写了 'gesture'，等于把缩放整个漏掉：双指缩放后本页毫无反应，
    //    V1.10 设计的「缩放自动重搜」在真机上永远不会触发。
    //    三个值一并收下，兼容各家基础库的差异。
    if (causedBy !== 'drag' && causedBy !== 'scale' && causedBy !== 'gesture') return;

    // 用户自己挪了地图 → 卡片收起时**不要**退回 anchor：
    // 视野是他刚拖出来的，再拉回去就是跟他的操作打架。见 closePanel 的参数说明。
    if (this.data.panel) this.closePanel(false);
    if (this.data.selectedIndex >= 0) this.clearSelection();

    // 手势停下后再量视野，按「档位是否跳档」区分缩放与平移：
    //   平移 → 视野跨度不变 → 档位不变 → 只提示「搜索此区域」（配额保护铁律不动）
    //   缩放 → 范围变了     → 自动按新半径重搜（V1.10 修订）
    //
    // 为什么这次给缩放破例自动搜：放大后视野可能只有两三百米，而旧结果是 1km 范围的，
    // 20 个标记全落在屏幕之外 —— 用户看到的就是「提示搜到了，屏幕上啥也没有」。
    // 代价可控：半径离散成 5 档（同档位直接命中缓存），且放大时能复用更粗档位的缓存
    // （utils/nearby.js 的 readCoarserCache），一次会话最多多花几档配额。
    setTimeout(() => {
      this.readViewport().then((vp) => {
        this._pendingCenter = vp.center;
        if (vp.zoomed) {
          this.scheduleAutoSearch(vp.center);
        } else {
          this.markDirty();
        }
      });
    }, VIEW_SETTLE_MS);
  },

  /* ==================== 视野 → 检索半径 ==================== */

  /**
   * 读一次当前视野，算出检索半径档位并缓存到实例上。
   *
   * 为什么不拿 scale 套公式换算成米：各机型 DPR、地图容器高度、纬度（经度方向要乘
   * cos(纬度)）都不同，任何公式都会在某台机器上是错的；getRegion 给的是这台机器的实测值。
   *
   * @returns {Promise<{center:{latitude,longitude}, radius:number, zoomed:boolean}>}
   *          zoomed = 本次半径与上次不同，即用户这次是缩放而不是平移
   */
  readViewport() {
    const ctx = this.mapCtx();
    return new Promise((resolve) => {
      let settled = false;
      const done = (value) => {
        if (settled) return;
        settled = true;
        if (this._viewportTimer) clearTimeout(this._viewportTimer);
        resolve(value);
      };
      // 兜底计时器：个别基础库失败时既不回调 success 也不回调 fail，
      // 少了它会永远挂着 —— 表现是「拖动后按钮不出现、页面像卡住了」
      this._viewportTimer = setTimeout(() => {
        done(this.applyViewport(this.currentCenter(), null));
      }, 600);

      const readRegion = (center) => {
        ctx.getRegion({
          success: (region) => done(this.applyViewport(center, region)),
          // 拿不到视野就不改档位（沿用上次），也不会被误判成缩放
          fail: () => done(this.applyViewport(center, null))
        });
      };
      ctx.getCenterLocation({
        success: (res) => readRegion({ latitude: res.latitude, longitude: res.longitude }),
        // 中心点读取失败 → 用 data 里的坐标兜底（用户点按钮时同样回落到它）
        fail: () => readRegion(this.currentCenter())
      });
    });
  },

  /** 把视野换算结果落到实例状态上，并给出「是否缩放」的判定 */
  applyViewport(center, region) {
    const raw = nearby.viewRadiusMeters(region);
    const tier = raw > 0 ? nearby.radiusTierOf(raw) : 0;
    const prev = this._radiusTier;
    const radius = tier || prev || nearby.defaultRadius();
    // 平移不改变视野跨度 ⇒ 档位不变；只有缩放才会让档位跳档。
    // 用这个判据区分缩放与平移，不依赖 regionchange 的 causedBy（各家基础库取值不一致）
    const zoomed = prev > 0 && radius !== prev;
    // ⚠️ 量不出视野（getRegion 失败 / 该基础库既不回调 success 也不回调 fail）时
    //    **不更新基准**。早期写法是无条件 `this._radiusTier = radius`，会把兜底的 1000
    //    固化成「上次档位」—— 等真机量出真实视野（比如 300）时就被误判成一次缩放，
    //    白触发一次自动重搜（白花一次配额，且用户看到视野莫名变化）。
    if (tier > 0) this._radiusTier = tier;
    this._viewRadius = raw;
    // 顺手缓存实测中心（值来自 readViewport 里的 getCenterLocation）——
    // rememberAnchor 靠它记录「打开卡片前的位置」，比 data 上的经纬度可靠：
    // 用户拖动地图后，data 里的坐标并不会跟着变。
    if (center && isFinite(center.latitude) && isFinite(center.longitude)) {
      this._mapCenter = { latitude: center.latitude, longitude: center.longitude };
    }
    return { center, radius, zoomed };
  },

  /** 只提示、不发请求 —— 平移场景的配额保护（需求 §3.3） */
  markDirty() {
    this.setData({ dirty: true, hintText: DRAG_HINT });
    this.refreshChrome();
  },

  /** 缩放改了范围后按新半径自动重搜；防抖，连续双指缩放只在停手后搜一次 */
  scheduleAutoSearch(center) {
    if (this._autoTimer) clearTimeout(this._autoTimer);
    this._autoTimer = setTimeout(() => {
      this._autoTimer = null;
      // 抽屉开着就别在背后换数据（用户可能正在看某个网点）
      if (this.data.panel) return;
      this.loadNearby({ center });
    }, AUTO_SEARCH_DEBOUNCE_MS);
  },

  onBackToMe() {
    if (this.data.locating) return;
    this.setData({ overlay: null, dirty: false });
    this.loadNearby({ withLocation: true, recenter: true });
  },

  onSearchArea() {
    if (this.data.locating) return;
    const center = this._pendingCenter || this.currentCenter();
    this.setData({ overlay: null, dirty: false });
    this.loadNearby({ center });
  },

  /* ==================== 选中态与抽屉 ==================== */

  selectStation(index, focus) {
    const station = this.data.stations[index];
    if (!station) return;

    // 进卡片态之前先记住当前视野，关闭卡片时退回（见 closePanel）
    this.rememberAnchor();

    this.setData({
      selectedIndex: index,
      selectedStation: station,
      markers: nearby.buildMarkers(this.data.stations, index),
      panel: 'card'
    });
    this.updateTabBar(true);
    this.refreshChrome();
    if (focus) this.panTo(station.latitude, station.longitude);
  },

  /* ==================== 地图中心联动（V1.12） ====================
     点标记 / 点列表项 → 卡片弹出的同时把屏幕中心移到站点；
     关闭卡片 → 中心退回进入卡片前的位置。**全程不改变缩放级别**。 */

  /**
   * 把地图中心平移到目标坐标，保持当前缩放级别不变。
   *
   * 为什么用 moveToLocation：
   *   · 它只改中心、不碰缩放级别（官方语义：将地图中心移动到指定位置，2.8.0 起支持传坐标）；
   *   · includePoints 会「缩放视野以包含所有点」，正是需求排除的行为，只该用在 frameStations；
   *   · MapContext.moveTo **不在官方 API 列表里** —— 旧代码用的就是它（误用），
   *     在缺少该方法的基础库上会直接抛 TypeError，且当时没有任何能力探测与兜底。
   *
   * 为什么不像 loadNearby 那样直接 setData 经纬度：
   *   setData 地图坐标在部分机型会连带把 scale 重置回 data.scale（本项目已踩过一次），
   *   那正好违反「联动过程不缩放」；而且 setData 是瞬移，moveToLocation 是平滑平移。
   */
  panTo(latitude, longitude) {
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (!isFinite(lat) || !isFinite(lng)) return;

    this._mapCenter = { latitude: lat, longitude: lng };
    this._panningUntil = Date.now() + PROGRAMMATIC_PAN_GUARD_MS;

    const ctx = this.mapCtx();
    if (ctx && typeof ctx.moveToLocation === 'function') {
      ctx.moveToLocation({ latitude: lat, longitude: lng });
      return;
    }
    // 兜底：基础库 < 2.8.0（2018 年）才没有 moveToLocation，本项目实际跑不到
    // （页面已依赖 2.14.0 的 openMapApp）。直接改属性，缩放可能被重置，属可接受的降级。
    this.setData({ latitude: lat, longitude: lng });
  },

  /**
   * 记录「进入卡片前的地图中心」，关闭卡片时退回这里。
   *
   * 为什么取「进入前的位置」而不是硬回到 GPS 定位点：
   *   首屏 / 点「回到我的位置」/ 重试之后，地图中心**就是**用户所在位置，两者等价；
   *   但如果用户先把地图拖到别处、搜过一轮再看站点，退回拖动后的位置才符合直觉 ——
   *   硬跳回 GPS 点会把视野甩到几公里外，而附近数据还是原区域的。
   *
   * 已记录则不覆盖：在列表里连点几个站点时，最终退回最初那个位置，
   * 而不是上一个站点（否则像在导航历史里来回跳）。
   */
  rememberAnchor() {
    if (this._anchorCenter) return;
    this._anchorCenter = this.currentMapCenter();
  },

  /** 当前地图中心。优先取实测值 —— 用户拖过地图后，data 上的经纬度就是过期数据 */
  currentMapCenter() {
    return this._mapCenter || this.currentCenter();
  },

  clearSelection() {
    this.setData({
      selectedIndex: -1,
      selectedStation: null,
      markers: nearby.buildMarkers(this.data.stations, -1)
    });
    this.refreshChrome();
  },

  onBubbleTap() {
    // 点左上搜索结果气泡 → 打开网点列表抽屉（屏 03）
    if (!this.data.stations.length) return;
    this.setData({ panel: 'list' });
    this.updateTabBar(true);
    this.refreshChrome();
  },

  onListItemTap(e) {
    const index = Number(e.currentTarget.dataset.index);
    this.selectStation(index, true);
  },

  /**
   * 关闭抽屉（站点卡片 / 网点列表）。
   * @param {boolean} restoreView 是否把地图中心退回「进入卡片前的位置」
   *        true  —— 用户主动关闭：点「关闭」/ 点遮罩 / 点地图空白
   *        false —— 用户拖动或缩放了地图导致抽屉被收起。视野是他自己挪的，
   *                 再拉回 anchor 就是跟他的操作打架（会看到视野被「抢」回去）
   */
  closePanel(restoreView) {
    const anchor = this._anchorCenter;
    this._anchorCenter = null;

    this.setData({
      panel: '',
      selectedIndex: -1,
      selectedStation: null,
      markers: nearby.buildMarkers(this.data.stations, -1)
    });
    this.updateTabBar(false);
    this.refreshChrome();

    if (restoreView && anchor) this.panTo(anchor.latitude, anchor.longitude);
  },

  /** wxml 入口：点「关闭」按钮 / 点遮罩都算主动关闭，视野要退回 */
  onClosePanel() {
    this.closePanel(true);
  },

  /* ==================== 导航：唤起手机内置地图 App ====================
     用官方 MapContext.openMapApp（基础库 2.14.0 起支持，**不支持 Promise 风格**）。
     仍然「不集成内嵌导航」—— 不做路线规划、不画 polyline，路线全交给第三方地图 App（需求 §3.6）。 */

  onNavigate() {
    const station = this.data.selectedStation;
    if (!station) return;

    const ctx = this.mapCtx();
    // 基础库 < 2.14.0 没有这个方法，直接调用会抛 TypeError。
    // 提示与「唤起失败」分开写 —— 这条是环境问题，用户反馈「点了没反应」时能直接定位
    if (typeof ctx.openMapApp !== 'function') {
      wx.showToast({
        title: '当前微信版本过低，请升级微信后使用导航',
        icon: 'none',
        duration: 2800
      });
      return;
    }

    ctx.openMapApp({
      latitude: station.latitude,
      longitude: station.longitude,
      destination: station.name,
      // 不指定 preferApplication —— 交给系统弹出地图 App 选择列表
      fail: () => this.showNavigateFallback()
    });
  },

  /** 唤起失败时的降级提示。**不预设原因**（无地图 App / 用户取消都会走这里），
      所以文案只说「没能唤起」，不写「未检测到地图应用」——避免用户取消时被误导 */
  showNavigateFallback() {
    wx.showToast({
      title: '未能唤起地图应用，请手动打开地图 App 搜索该网点',
      icon: 'none',
      duration: 2800
    });
  },

  /* ==================== 异常浮层动作 ==================== */

  onOverlayAction(e) {
    const key = e.currentTarget.dataset.key;
    if (key === 'setting') {
      wx.openSetting({
        success: (res) => {
          if (res.authSetting && res.authSetting['scope.userLocation']) {
            this.setData({ overlay: null });
            this.loadNearby({ withLocation: true, recenter: true });
          }
        }
      });
      return;
    }
    if (key === 'retry') {
      this.setData({ overlay: null });
      this.loadNearby({ withLocation: true, recenter: true });
    }
  },

  noop() {}
});
