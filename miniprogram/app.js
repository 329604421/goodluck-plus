// app.js - 彩票小助手 · 小程序全局入口
const api = require('./utils/api');
const config = require('./config/index');
const theme = require('./utils/theme');

App({
  globalData: {
    // 当前生效主题：'light' | 'dark'（跟随微信/系统，见 utils/theme.js）
    theme: 'light',
    // API 基础地址：生产环境替换为实际域名（需在微信公众平台配置 request 合法域名）
    apiBaseUrl: config.apiBaseUrl,
    // 设备令牌：注册后由后端下发，前端缓存
    deviceToken: '',
    // 用户配置（初始化后写入 storage: userConfig）
    userConfig: null,
    // 当前登录用户信息（mock: 春生）
    userInfo: {
      name: '春生',
      gender: 'male',
      birth: '2000-01-15'
    },
    // 导航参数（胶囊对齐动态计算）
    statusBarHeight: 20,   // 状态栏高度 px（兜底值）
    navBarHeight: 44       // 导航栏高度 px（兜底值，不含状态栏）
  },

  onLaunch() {
    // 构建版本标记（2026-09-04）：真机 vConsole 中可确认运行的是哪次构建
    console.log('[App] BUILD_VERSION =', config.BUILD_VERSION);

    // 主题初始化（2026-10-16）：读取当前系统主题并记录到 globalData。
    // WXSS 侧由 prefers-color-scheme 媒体查询自动生效；这里只为 JS 侧（图标 SVG 色值、
    // 需要按主题选资源的地方）提供来源，并建立唯一的主题变化监听链。
    theme.refresh();
    this.globalData.theme = theme.current();
    console.log('[App] theme =', this.globalData.theme);

    // 读取本地缓存
    const userConfig = wx.getStorageSync('userConfig');
    const deviceToken = wx.getStorageSync('deviceToken');
    if (userConfig) {
      this.globalData.userConfig = userConfig;
    }
    if (deviceToken) {
      this.globalData.deviceToken = deviceToken;
    }

    // 真实模式：无 deviceToken 时自动登录（2026-08-21：优先微信登录 openid 身份，
    // 手机/PC 同一微信号同一用户；失败降级匿名注册）
    if (!config.USE_MOCK && !deviceToken) {
      api.ensureToken().catch(() => {
        // 登录失败（后端未启动等）：页面请求会走 40100 自动重试，下次启动再试
      });
    }

    // 按微信标准：胶囊按钮对齐计算导航栏高度
    try {
      const sys = wx.getSystemInfoSync();
      const menu = wx.getMenuButtonBoundingClientRect();
      // 状态栏高度：取系统值（iOS 44/47/59，Android 约 20-28）
      const statusBarHeight = sys.statusBarHeight || 20;
      // 导航栏高度 = (胶囊top - 状态栏) * 2 + 胶囊高（微信官方推荐算法）
      const navBarHeight = (menu.top - statusBarHeight) * 2 + menu.height;
      this.globalData.statusBarHeight = statusBarHeight;
      this.globalData.navBarHeight = Math.max(44, navBarHeight);
    } catch (e) {
      // 保持兜底值
    }
  },

  /**
   * 回前台校准主题：部分平台在应用被切到后台期间不会补发 onThemeChange 事件，
   * 只靠监听会出现「在后台改了系统主题，回来还是旧色」。
   * 这里只更新样式相关状态，不触发任何业务数据加载。
   */
  onShow() {
    const next = theme.refresh();
    if (next !== this.globalData.theme) {
      this.globalData.theme = next;
    }
  },

  // 是否已完成初始化配置
  isConfigured() {
    const config = this.globalData.userConfig;
    return !!(config && (config.lotteryType || (config.lotteryTypes && config.lotteryTypes.length)));
  }
});
