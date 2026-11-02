// 彩票小助手 · Rokid 眼镜端 · 全局应用逻辑（V2.1）
// 架构：眼镜端瘦客户端 + 后台重服务（https://lottery.memorymap.cn/api，2026-10-30 由 api 子域迁入）
// 依据：《眼镜端功能需求说明书.md》V1.2 + V2 设计稿 + 《现有小程序前后台改造说明.md》V1.2
// 职责：口令解析 / 意图直达路由 / 24h 免登录态 / 统一请求封装（token 头 + 40100 兜底 + 服务器时间捕获）
// ⚠️ USE_MOCK=false：真实对接后台；本地 mock 调试可临时置 true（静态数据走查）

// ⚠️ 环境自适应（2026-08-26 最终版）：Craft 预览沙箱（QuickJS）无 fetch/网络，真实请求会
//    全部失败 → 骨架等完重试链才显示空数据，走查体验差。
//    ⚠️ 历程与教训：
//    ① 曾用顶层 `const USE_MOCK = typeof fetch === 'undefined'` —— 真机 QuickJS 若以
//       let/const 绑定注入 fetch，模块顶层 typeof 求值命中 TDZ 抛 ReferenceError → app.js
//       加载崩溃 → "已打开智能体但直接回桌面"（2026-08-26 两次真机打不开事故）。
//    ② 曾用 onLaunch 运行时检测（detectMockEnv）——理论上安全，但为彻底消除"环境检测"
//       这一变量、与 10:57 真机验证成功版本保持一致，现恢复**硬编码 false（真实对接）**。
//    Craft 走查需要 mock 时手动置 true（静态数据秒显），真机永远保持 false。
const USE_MOCK = false; // ⚠️ 真机必须保持 false；仅 Craft 本地走查 UI 时可临时置 true

const API_BASE = 'https://lottery.memorymap.cn/api';
const TOKEN_EXPIRY = 24 * 60 * 60 * 1000; // 24 小时免登录窗口

// ⚠️ 临时硬编码口令（2026-08-25）：官方确认「指令文本不会进入应用」，唤起参数拿不到口令，
// 整体绑定流程待重新设计。当前先写死绑定，让应用先跑起来。
// 要求：小程序端已为该用户设置同款口令验证码；待新流程落地后移除。
const FIXED_PASSCODE = { userId: '12', code: '888888' };

/* ============ 静态数据（USE_MOCK 走查，字段与后端真实契约一致） ============ */
const MOCK_USER_CONFIG = {
  userId: '1024', name: '杜春生', gender: 'male', birth: '2000-01-15',
  lotteryType: 'ssq', lotteryTypes: ['ssq'], divinationSystem: 'astrology'
};

const MOCK_REDEEM = {
  list: [{
    id: '5', lottery: 'ssq', lotteryName: '双色球', period: '第 2026090 期',
    amount: 300000, deadlineDate: '2026-10-17', redeemChannel: 'shop', daysLeft: 12
  }]
};

const MOCK_STATS = { purchasedPeriods: 12, totalSpent: 2400, totalWon: 300400 };

const MOCK_STATUS_SSQ = {
  type: 'ssq', name: '双色球', period: '第 2026096 期', drawDate: '2026-08-25', drawTime: '21:30',
  saleEndTime: '20:00', saleEndAt: 0, poolAmount: '¥20.1 亿',
  countdown: '距停售 09:40:02', purchased: true, winningNumbers: []
};

const MOCK_STATUS_DLT = {
  type: 'dlt', name: '大乐透', period: '第 2026093 期', drawDate: '2026-08-24', drawTime: '21:30',
  saleEndTime: '20:00', saleEndAt: 0, poolAmount: '¥11.2 亿',
  countdown: '距停售 09:12:08', purchased: false, winningNumbers: []
};

const MOCK_OCR = {
  lotteryName: '双色球', period: '第 2026101 期', drawDate: '2026-08-20', ocrStatus: 'OK',
  betCount: 5, multiplier: 1, totalAmount: '¥ 12.00',
  bets: [
    { id: 1, red: ['03', '08', '15', '21', '27', '30'], blue: ['09'], mult: 2 },
    { id: 2, red: ['05', '12', '18', '26', '31', '33'], blue: ['12'], mult: 1 },
    { id: 3, red: ['02', '09', '16', '22', '28', '32'], blue: ['05'], mult: 1 },
    { id: 4, red: ['01', '07', '14', '19', '24', '29'], blue: ['08'], mult: 1 },
    { id: 5, red: ['06', '11', '17', '23', '25', '33'], blue: ['03'], mult: 1 }
  ]
};

const MOCK_ANALYSIS_SSQ = '春生 · 2000-01-15 生 · 今日丙午年 七月初一。红球偏向高频区，蓝球关注大号区间。金水相生日利西南方向，宜守成不宜冒进；本期冷号回调概率上升，重点关注遗漏 8-12 期的号码，区间配比建议 2:2:2 均衡布局。';
const MOCK_ANALYSIS_DLT = '春生 · 2000-01-15 生 · 今日丙午年 七月初一。前区热号延续性强，后区关注连号区间。木火之气旺于东南，前区可偏重小中号段；后区防冷号回补，参考前区尾数 1/7/8 组合，整体以稳为主。';

// 固定假想日期（与后端 /recommend 的 date 字段格式一致："2026-08-25 周二"）
const MOCK_RECOMMEND_DATE = '2026-08-25 周二';

const MOCK_RECOMMEND = {
  astrology_ssq: { date: MOCK_RECOMMEND_DATE, redBalls: ['03', '08', '15', '21', '27', '30'], blueBalls: ['09'], summary: MOCK_ANALYSIS_SSQ },
  astrology_dlt: { date: MOCK_RECOMMEND_DATE, redBalls: ['05', '12', '18', '26', '31'], blueBalls: ['08', '11'], summary: MOCK_ANALYSIS_DLT },
  iching_ssq: { date: MOCK_RECOMMEND_DATE, redBalls: ['02', '09', '16', '22', '28', '32'], blueBalls: ['05'], summary: MOCK_ANALYSIS_SSQ },
  iching_dlt: { date: MOCK_RECOMMEND_DATE, redBalls: ['01', '07', '14', '19', '24'], blueBalls: ['03', '09'], summary: MOCK_ANALYSIS_DLT }
};

function mockDateKey(d) {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return d.getFullYear() + '-' + mm + '-' + dd;
}

// 纯算术日期加法（Rokid 真机 new Date() / new Date(y,m,d) 均不可信——台账热力图事故。
// mock 阶段一律用固定基准 + 纯算术，杜绝"当前时间 vs 日期"比较与 Date 构造差异）
const MONTH_DAYS = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
function addDaysFixed(y, m, d, n) {
  let total = d + n;
  let month = m;
  let year = y;
  while (total > MONTH_DAYS[month]) {
    total -= MONTH_DAYS[month];
    month += 1;
    if (month > 12) { month = 1; year += 1; }
  }
  while (total < 1) {
    month -= 1;
    if (month < 1) { month = 12; year -= 1; }
    total += MONTH_DAYS[month];
  }
  return { y: year, m: month, d: total };
}
function pad2(n) { return String(n).padStart(2, '0'); }

// 台账热力图明暗矩阵（还原 V2 设计稿「15-台账」帧：6 行 × 12 列）
// 值 1-5 = 亮度 5 阶（对应 amounts 0-4 → 格子 hl1-hl5，opacity 0.06/0.24/0.48/0.72/1.0）
// 值 0 = 空心（待开奖 / 号码待同步，对应 hl0）
const MOCK_HEAT_PATTERN = [
  [1, 2, 1, 3, 2, 1, 4, 2, 3, 1, 2, 3], // 周一 大乐透
  [1, 1, 2, 2, 1, 3, 2, 1, 2, 4, 1, 2], // 周二 双色球
  [2, 1, 3, 1, 2, 2, 1, 3, 2, 1, 3, 1], // 周三 大乐透
  [1, 2, 1, 2, 3, 1, 2, 2, 1, 2, 3, 2], // 周四 双色球
  [2, 1, 2, 1, 1, 2, 3, 1, 2, 1, 0, 0], // 周六 大乐透
  [1, 3, 1, 2, 1, 1, 2, 3, 1, 2, 0, 0]  // 周日 双色球
];


function storageGet(key) {
  try {
    if (typeof wx !== 'undefined' && wx.getStorageSync) return wx.getStorageSync(key);
    if (typeof localStorage !== 'undefined') {
      const v = localStorage.getItem(key);
      if (v === null) return '';
      try { return JSON.parse(v); } catch (e) { return v; }
    }
  } catch (e) { /* ignore */ }
  return '';
}

function storageSet(key, value) {
  try {
    if (typeof wx !== 'undefined' && wx.setStorageSync) return wx.setStorageSync(key, value);
    if (typeof localStorage !== 'undefined') {
      const v = typeof value === 'string' ? value : JSON.stringify(value);
      localStorage.setItem(key, v);
    }
  } catch (e) { /* ignore */ }
}

function storageRemove(key) {
  try {
    if (typeof wx !== 'undefined' && wx.removeStorageSync) return wx.removeStorageSync(key);
    if (typeof localStorage !== 'undefined') localStorage.removeItem(key);
  } catch (e) { /* ignore */ }
}

// 页面导航统一封装（官方路由体系）
// mode: 'push'（navigateTo 保留当前页入栈，返回走 navigateBack 弹回原实例）
//       'relaunch'（reLaunch 清栈到目标页；登录→首页等根跳转）
//       默认 'replace'（redirectTo 关闭当前页替换）
function navigateToPage(page, mode) {
  const routes = {
    login: '/pages/login/login',
    home: '/pages/home/home',
    record: '/pages/record/record',
    recommend: '/pages/recommend/recommend',
    ledger: '/pages/ledger/ledger'
  };
  const url = routes[page];
  if (!url) {
    console.error('[goodluck+] navigateToPage: 无效页面', page);
    return;
  }
  try {
    const w = (typeof wx !== 'undefined' && wx) || (typeof aiui !== 'undefined' && aiui) || null;
    if (!w) {
      console.error('[goodluck+] navigateToPage: 无可用导航对象 (wx/aiui)');
      return;
    }
    
    // 标记导航已开始（用于 onLaunch 兜底机制）
    try {
      const app = typeof getApp === 'function' ? getApp() : null;
      if (app) app._navigationStarted = true;
    } catch (e) { /* ignore */ }
    
    let success = false;
    if (mode === 'push' && w.navigateTo) {
      console.log('[goodluck+] navigateToPage: push ->', url);
      w.navigateTo({ url });
      success = true;
    } else if (mode === 'relaunch') {
      if (w.reLaunch) {
        console.log('[goodluck+] navigateToPage: relaunch ->', url);
        w.reLaunch({ url });
        success = true;
      } else if (w.redirectTo) {
        console.log('[goodluck+] navigateToPage: relaunch fallback redirectTo ->', url);
        w.redirectTo({ url });
        success = true;
      }
    } else {
      // 默认 replace 模式
      if (w.redirectTo) {
        console.log('[goodluck+] navigateToPage: replace (redirectTo) ->', url);
        w.redirectTo({ url });
        success = true;
      } else if (w.reLaunch) {
        console.log('[goodluck+] navigateToPage: replace fallback reLaunch ->', url);
        w.reLaunch({ url });
        success = true;
      } else if (w.navigateTo) {
        console.log('[goodluck+] navigateToPage: replace fallback navigateTo ->', url);
        w.navigateTo({ url });
        success = true;
      }
    }
    
    if (!success) {
      console.error('[goodluck+] navigateToPage: 所有导航方法都不可用，目标页面:', page, 'url:', url);
    }
  } catch (e) {
    console.error('[goodluck+] navigateToPage 异常:', e.message || e, '页面:', page);
  }
}

// 返回首页兜底（navigateBack 无栈可退时使用）
function navigateHome() {
  navigateToPage('home');
}

// ⚠️ 导出格式（2026-08-26 关键修复）：官方 SKILL.md §1.3 的 app.js 是**直接内联
//    `export default {...}` 对象字面量**。此前用 `const appConfig = {...}; export default
//    appConfig;`——Craft/Node 用真 ESM 解析没问题，但 AIUI Studio 真机打包器若按文本
//    扫描 `export default {` 提取应用配置，会漏掉间接导出的 appConfig → 应用配置缺失
//    → 启动即崩溃回桌面（"Craft 能跑、真机闪退"的根因）。已改为官方内联格式。
export default {
  onLaunch(options) {
    try {
      console.log('[goodluck+] ========== onLaunch 开始 ==========');
      this.globalData.launchOptions = options || {};

      // ⚠️ 恢复服务器时间（上次请求捕获的 HTTP Date 头，已持久化）：
      //    冷启动时页面 onLoad 的 pageToday()/recommendToday() 日期键与上次写入一致，
      //    否则真机时钟不可信 → 缓存键错位 → 秒开缓存全 miss
      try {
        const sn = storageGet('serverNow');
        if (sn) this.globalData.serverNow = new Date(sn);
      } catch (e) { /* ignore */ }

      // 启动诊断日志（联调期保留）：一眼确认加载版本 / 网络模式 / 唤起参数
      // 模拟器或真机 console 应看到：[goodluck+] v2.1 USE_MOCK=false API=https://lottery.memorymap.cn/api
      const hasPasscode = this.extractPasscode(options) ? 'YES' : 'no';
      const intent = this.extractIntentPage(options) || 'home';
      console.log('[goodluck+] v2.1 USE_MOCK=' + USE_MOCK +
        ' API=' + API_BASE +
        ' passcode=' + hasPasscode +
        ' intent=' + intent);

      // 先口令后意图：解析快捷指令透传内容
      const passcode = this.extractPasscode(options);
      const intentPage = this.extractIntentPage(options);
      if (passcode) {
        console.log('[goodluck+] onLaunch: 解析到口令 userId=', passcode.userId);
        this.globalData.launchPasscode = passcode;
      }
      if (intentPage) {
        console.log('[goodluck+] onLaunch: 解析到意图页面=', intentPage);
        this.globalData.intentPage = intentPage;
      }

      console.log('[goodluck+] onLaunch: 调用 routeOnLaunch');
      this.routeOnLaunch();
      console.log('[goodluck+] ========== onLaunch 结束 ==========');
      
      // ⚠️ 兜底机制：routeOnLaunch 是异步的，如果它在 2 秒内没有完成导航，
      //    强制跳转到首页，避免应用无任何页面显示导致崩溃。
      setTimeout(() => {
        // 检查是否已经有页面显示（通过检查 globalData 中的标记）
        // 如果没有，强制跳转到首页
        if (!this._navigationStarted) {
          console.warn('[goodluck+] onLaunch 兜底: 2秒内未完成导航，强制进首页');
          navigateToPage('home');
        }
      }, 2000);
    } catch (e) {
      // ⚠️ 渲染兜底：Craft 预览沙箱（QuickJS）可能缺 fetch 等网络 API，
      //    启动链路任何异常都不能阻断渲染——记录后仍尝试进首页（数据空也可看 UI）。
      console.error('[goodluck+] onLaunch 异常，降级进首页:', e.message || e, e.stack);
      try {
        console.log('[goodluck+] onLaunch 异常兜底: 尝试跳转到首页');
        navigateToPage('home');
      } catch (e2) {
        console.error('[goodluck+] onLaunch 异常兜底失败:', e2.message || e2);
      }
    }
  },

  onShow() { /* 回到前台：无需额外处理 */ },
  onHide() { /* 进入后台 */ },

  // ---- 解析：口令（先） ----
  // 兜底策略：快捷指令/唤起渠道的口令字段名在真机上未经官方确认（改造说明 R1），
  // 因此除显式字段外，全量扫描 query 各字段与 options 顶层文本字段，
  // 凡命中 R<userId>-<6位验证码> 模式即视为口令，避免"字段名不符 → 拿不到口令"。
  extractPasscode(options) {
    if (!options) return null;
    const candidates = [];
    if (typeof options === 'string') candidates.push(options);
    const query = options.query || {};
    // 1) 显式口令字段（先）
    ['rokidCode', 'passcode', 'code'].forEach((k) => {
      if (query[k] != null) candidates.push(query[k]);
    });
    // 2) query 其余字段兜底（平台可能用其他字段透传指令文本）
    Object.keys(query).forEach((k) => {
      if (typeof query[k] === 'string') candidates.push(query[k]);
    });
    // 3) options 顶层文本字段兜底（text/input/command 等宿主常见命名）
    ['text', 'input', 'command', 'value', 'content', 'message'].forEach((k) => {
      if (options[k] != null) candidates.push(options[k]);
    });
    for (const text of candidates) {
      const match = String(text).match(/R(\d+)-(\d{6})/);
      if (match) return { userId: match[1], code: match[2], full: match[0] };
    }
    return null;
  },

  // ---- 解析：意图页面（后） ----
  extractIntentPage(options) {
    if (!options) return null;
    const page = (options.query || {}).page || '';
    const valid = ['home', 'record', 'recommend', 'ledger'];
    return valid.includes(page) ? page : null;
  },

  // ---- 启动分流：固定口令直绑（临时方案，绑定流程待重设计） ----
  // 官方确认指令文本不进应用 → 不再解析唤起口令。
  // 逻辑：有有效登录态（24h）直进；否则用写死口令自动绑定，成功后进首页；
  //       绑定失败（口令失效/网络异常）落登录页，可在登录页点「进入」重试。
  routeOnLaunch() {
    console.log('[goodluck+] routeOnLaunch: 开始启动路由');
    this._navigationStarted = true; // 标记导航已开始
    
    // 检查登录态
    const loginState = this.getLoginState();
    console.log('[goodluck+] routeOnLaunch: 登录态 valid=', loginState.valid, 'reason=', loginState.reason);
    
    if (loginState.valid) {
      console.log('[goodluck+] routeOnLaunch: 已有有效登录态，直接进入');
      this.enterByIntent();
      return;
    }
    
    const pc = FIXED_PASSCODE;
    console.log('[goodluck+] routeOnLaunch: 无登录态，开始绑定 userId=', pc.userId);
    
    this.bindRokid(pc.userId, pc.code)
      .then((data) => {
        console.log('[goodluck+] routeOnLaunch: 绑定成功，进入首页');
        this.enterByIntent();
      })
      .catch((err) => {
        console.error('[goodluck+] routeOnLaunch: 绑定失败 code=', err && err.code, 'msg=', err && err.message);
        if (err && err.code === 40100) {
          // 口令无效 → 登录页口令无效态
          console.log('[goodluck+] routeOnLaunch: 口令无效，设置 pendingInvalid');
          this.globalData.pendingInvalid = true;
        }
        console.log('[goodluck+] routeOnLaunch: 跳转到登录页');
        navigateToPage('login');
      });
  },

  // 按意图直达子页面，无意图进首页（消费后清除意图，避免下次误跳）
  // ⚠️ relaunch 清栈：从登录/启动路径进入时不留 login 在栈中，
  //    首页作为根页面；子页再通过 navigateTo 入栈、navigateBack 返回。
  enterByIntent() {
    const page = this.globalData.intentPage;
    this.globalData.intentPage = null;
    navigateToPage(page && page !== 'home' ? page : 'home', 'relaunch');
  },

  // ---- 口令绑定 ----
  // ⚠️ bind 是登录关键请求且**幂等**（后端幂等 + 旧 rokid token 自动失效）：
  // ⚠️ bind 为幂等 POST：统一走 request 层 retry（网络失败/超时自动重试一次，最多 2 次）。
  //    - timeout 10s（原 20s）：冷启动挂起时更快失败重试，最坏 20s 内出结果（原 40s）
  //    - retry: 1：request 层对 -1/-2 重试一次（已含超时重试逻辑），不再手动 catch 重试
  bindRokid(userId, code) {
    console.log('[goodluck+] bindRokid: 开始绑定 userId=', userId);
    // ⚠️ 防并发绑定（2026-08-26 事故根因）：login 是默认页，应用启动即渲染；
    //    routeOnLaunch 的自动绑定（请求A）与用户手动点「进入」的绑定（请求B）可能重叠——
    //    后端 bind 幂等会作废旧 token：B 先完成签发 tokenB 进首页，A 后完成签发 tokenA
    //    并作废 tokenB → 首页已发出的请求带 tokenB 返回 40100 → 自动退回绑定页。
    //    复用进行中的 bind Promise：同一时刻只有一个 bind 请求，杜绝双 token 作废。
    if (this._bindPromise) {
      console.log('[goodluck+] bindRokid: 复用进行中的绑定请求（防并发）');
      return this._bindPromise;
    }
    this._bindPromise = this.request({
      url: '/auth/rokid/bind',
      method: 'POST',
      data: { userId, code },
      withToken: false,
      timeout: 10000,
      retry: 1
    })
      .then((data) => {
        console.log('[goodluck+] bindRokid: 收到响应', data ? '有数据' : '无数据');
        if (!data || !data.deviceToken) {
          console.error('[goodluck+] bindRokid: 响应异常，无 deviceToken');
          throw { code: 50000, message: 'bind 响应异常' };
        }
        console.log('[goodluck+] bindRokid: 绑定成功，保存 token');
        storageSet('deviceToken', data.deviceToken);
        storageSet('boundAt', Date.now());
        if (data.userConfig) {
          console.log('[goodluck+] bindRokid: 保存用户配置');
          storageSet('userConfig', data.userConfig);
        }
        storageSet('userId', userId);
        this.globalData.launchPasscode = null;
        this.globalData.pendingInvalid = false;
        // ⚠️ 绑定成功即预热首页数据（2026-08-26）：网络此刻已热（刚完成 bind 请求），
        //    立即并行拉取首页 5 个接口存入 prefetched——relaunch 页面切换（1-3s）期间
        //    请求早已返回，home onLoad 时直接消费预取数据秒开，不再"进首页才发请求"。
        //    ⚠️ 必须在 storageSet('deviceToken') **之后**调用——request 同步读 token，
        //    提前调用会导致 5 个预取请求无鉴权头 → 后端 40100 → 清 token 踢回绑定页
        //    （2026-08-26 事故：预取误放 then 开头，token 未保存即发请求 → 踢回死循环）。
        //    冷启动自动绑定与手动"进入"两条路径都经过本方法，统一预热。
        if (this.prefetchHome) this.prefetchHome();
        return data;
      })
      .then((data) => {
        // 无论成功失败都释放"进行中"标记（QuickJS 无 finally 依赖，用双 then 等价）
        this._bindPromise = null;
        return data;
      }, (err) => {
        this._bindPromise = null;
        throw err;
      });
    return this._bindPromise;
  },

  // ---- 登录态（24h 免登录窗口） ----
  getLoginState() {
    const deviceToken = storageGet('deviceToken');
    const boundAtRaw = storageGet('boundAt');
    const boundAt = parseInt(boundAtRaw || 0, 10);
    if (!deviceToken || !boundAt) return { valid: false, reason: 'no_token' };
    if (Date.now() - boundAt > TOKEN_EXPIRY) return { valid: false, reason: 'token_expired' };
    return { valid: true, deviceToken };
  },

  getDeviceToken() {
    return this.getLoginState().valid ? this.getLoginState().deviceToken : null;
  },

  getUserConfig() {
    const c = storageGet('userConfig');
    return (c && typeof c === 'object') ? c : {};
  },

  clearLoginState() {
    storageRemove('deviceToken');
    storageRemove('boundAt');
    storageRemove('userConfig');
    storageRemove('userId');
  },

  // ---- 统一请求封装 ----
  // options: { url, method, data, withToken(默认 true), timeout(默认 10000, OCR 传 30000) }
  request(options) {
    if (USE_MOCK) return this.mockRequest(options);

    const method = (options.method || 'GET').toUpperCase();
    const withToken = options.withToken !== false;
    const timeout = options.timeout || 8000;
    const token = this.getDeviceToken();

    const headers = { 'Content-Type': 'application/json' };
    if (withToken && token) headers['X-Device-Token'] = token;

    let body;
    let finalUrl = API_BASE + options.url;
    // ⚠️ AIUI 运行时无 FormData 全局（实测 ReferenceError: FormData is not defined 崩溃）。
    // 必须先用 typeof 探测，不能直接引用标识符；multipart 上传改由 isMultipart 手写 body。
    const hasFormData = typeof FormData !== 'undefined';
    if (hasFormData && options.data instanceof FormData) {
      // multipart 上传（仅支持 FormData 的环境可用；AIUI 走 isMultipart 分支）
      delete headers['Content-Type'];
      body = options.data;
    } else if (options.isMultipart && options.data) {
      // ⚠️ AIUI 无 FormData/Blob；且 fetch 对 Uint8Array body 的支持未确认（官方 apis-web
      //    仅列出响应体类型）——真机上传 Uint8Array body 可能卡住导致 30s 超时。
      //    改用纯字符串 multipart：图片由页面转 base64（ASCII，wx.arrayBufferToBase64
      //    官方确认支持），body 为字符串（与 bind 的 JSON 请求同机制，已验证可用）。
      // options.data = base64 字符串；options.filename/mime 可选，默认 ticket.jpg/image/jpeg
      const boundary = '----GL' + Date.now().toString(16);
      const filename = options.filename || 'ticket.jpg';
      const mime = options.mime || 'image/jpeg';
      body = '--' + boundary + '\r\n' +
        'Content-Disposition: form-data; name="file"; filename="' + filename + '"\r\n' +
        'Content-Type: ' + mime + '\r\n\r\n' +
        String(options.data) + '\r\n' +
        '--' + boundary + '--\r\n';
      headers['Content-Type'] = 'multipart/form-data; boundary=' + boundary;
    } else if (options.data) {
      body = JSON.stringify(options.data);
    }

    // ⚠️ 超时兜底：AIUI 官方未确认支持 AbortController（apis 文档未列出），
    //    若依赖它 abort，fetch 挂起时将永不返回 → 页面 loading 骨架永久卡死。
    //    统一用 Promise.race 保证超时后一定 reject，页面不被挂起请求阻塞。
    // ⚠️ GET/HEAD 网络异常自动重试一次：AIUI 网络冷启动偶发失败（TypeError），
    //    重试可显著提高首屏数据成功率。POST 默认不重试（幂等性），但幂等 POST
    //    （如 /recommend 当日缓存、bind 口令绑定）可通过 options.retry 显式开启
    //    （retry = 额外重试次数，仅对网络层失败 -1/-2 生效，业务错误不重试）。
    const retryCount = options.retry != null ? options.retry : 0;

    // ⚠️ 大 body 上传（OCR 图片）改走 wx.request 原生通道：
    //    AIUI 的 fetch 发送 80KB+ body 时**响应会挂起**——实测后端 8s 就返回 201 成功，
    //    前端却 60s 超时（响应未回到 JS 层，fetch 大 body 缺陷）。wx.request 是官方
    //    原生网络通道（RequestTask，支持 timeout + dataType:'json' 自动解析），
    //    bind/推荐等小 JSON 请求继续用 fetch（已验证可靠），互不影响。
    if (options.useWxRequest && typeof wx !== 'undefined' && wx.request) {
      return new Promise((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          const err = new Error('请求超时');
          err.code = -2;
          console.log('[goodluck+] 请求超时(>' + timeout + 'ms) url=' + options.url);
          reject(err);
        }, timeout);
        wx.request({
          url: finalUrl,
          method,
          header: headers,
          data: body,
          dataType: 'json',
          timeout,
          success: (res) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            const json = res && res.data;
            if (json && json.code === 0) return resolve(json.data);
            if (json && json.code === 40100 && withToken) {
              console.log('[goodluck+] 40100 token 失效 → 清缓存跳登录', options.url);
              this.clearLoginState();
              navigateToPage('login');
            }
            const err = new Error((json && json.message) || '请求失败');
            err.code = (json && json.code) || 50000;
            console.log('[goodluck+] 请求失败 code=' + err.code + ' url=' + options.url + ' msg=' + err.message);
            reject(err);
          },
          fail: (e) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            const msg = (e && e.errMsg) || '';
            console.log('[goodluck+] 网络异常 url=' + options.url + ' msg=' + msg);
            const err = new Error(/timeout|超时/i.test(msg) ? '网络超时' : '网络异常');
            err.code = -1;
            reject(err);
          }
        });
      });
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      let attempt = 0;
      const maxAttempts = (method === 'GET' || method === 'HEAD') ? 2 : (1 + retryCount);
      const run = () => {
        attempt += 1; // 已尝试次数（catch/timer 里判断 attempt < maxAttempts 才重试）
        const timer = setTimeout(() => {
          if (settled) return;
          // ⚠️ 超时（fetch 挂起，响应不回来）也纳入重试：AIUI 网络层偶发挂起
          //    （之前 OCR 大 body 挂起同源），幂等请求超时后重试一次可能成功；
          //    重试耗尽才真正失败（-2）。
          if (attempt < maxAttempts) {
            console.log('[goodluck+] 请求超时重试 ' + attempt + '/' + maxAttempts + ' url=' + options.url);
            run();
            return;
          }
          settled = true;
          const err = new Error('请求超时');
          err.code = -2;
          console.log('[goodluck+] 请求超时(>' + timeout + 'ms) url=' + options.url);
          reject(err);
        }, timeout);

        // ⚠️ fetch 存在性守卫：Craft 预览沙箱（QuickJS）可能无 fetch 全局，
        //    裸调用会 ReferenceError → onLaunch 崩溃 → "Exception generated by QuickJS" → 渲染失败。
        //    无 fetch 时直接 reject（网络异常），页面走 catch 不崩溃。
        if (typeof fetch === 'undefined') {
          console.log('[goodluck+] 环境无 fetch（预览沙箱？）url=' + options.url);
          const err = new Error('网络异常');
          err.code = -1;
          reject(err);
          return;
        }

        fetch(finalUrl, {
          method,
          headers,
          body
        })
          .then((res) => {
            // 捕获服务器时间（HTTP Date 头，GMT）：Rokid 真机时钟不可信，
            // ledger 等页面以此构建日期基准，避免与后端数据（服务器日期键）错位
            try {
              const dh = res.headers && res.headers.get ? res.headers.get('date') : null;
              if (dh) {
                this.globalData.serverNow = new Date(dh);
                // 持久化：冷启动时 pageToday()/recommendToday() 的日期键与上次写入一致，
                // 否则真机时钟错乱会导致缓存键错位（getPageCache 全 miss）
                try { storageSet('serverNow', this.globalData.serverNow.toISOString()); } catch (e) { /* ignore */ }
              }
            } catch (e) { /* ignore */ }
            return res.json();
          })
          .then((json) => {
            clearTimeout(timer);
            if (settled) return;
            settled = true;
            if (json.code === 0) return resolve(json.data);
            if (json.code === 40100 && withToken) {
              // token 失效：清缓存 → 登录页
              console.log('[goodluck+] 40100 token 失效 → 清缓存跳登录', options.url);
              this.clearLoginState();
              navigateToPage('login');
            }
            const err = new Error(json.message || '请求失败');
            err.code = json.code;
            reject(err);
          })
          .catch((e) => {
            clearTimeout(timer);
            if (settled) return;
            if (e && e.code) {
              console.log('[goodluck+] 请求失败 code=' + e.code + ' url=' + options.url + ' msg=' + e.message);
              settled = true;
              reject(e);
              return;
            }
            // 网络层失败（TypeError: Failed to fetch = CORS 被拦 / DNS / 连接拒绝 / 冷启动）
            // 幂等请求重试一次，规避 AIUI 冷启动偶发失败（attempt 已在 run 开头自增）
            if (attempt < maxAttempts) {
              console.log('[goodluck+] 网络异常重试 ' + attempt + '/' + maxAttempts + ' url=' + options.url +
                ' name=' + (e && e.name));
              setTimeout(run, 600);
              return;
            }
            const isTimeout = !!(e && (e.name === 'AbortError' || /abort/i.test(String(e.message || ''))));
            console.log('[goodluck+] 网络异常 url=' + options.url +
              ' name=' + (e && e.name) +
              ' msg=' + (e && e.message) +
              (isTimeout ? ' [TIMEOUT>' + timeout + 'ms]' : ''));
            const err = new Error(isTimeout ? '网络超时' : '网络异常');
            err.code = -1;
            err.kind = isTimeout ? 'timeout' : 'network';
            settled = true;
            reject(err);
          });
      };
      run();
    });
  },

  // ---- 静态数据走查（USE_MOCK）----
  mockRequest(options) {
    const url = (options.url || '').split('?')[0];
    const delayMap = { '/ticket/ocr': 1500, '/recommend': 1200 }; // 走查 loading 态
    const delay = delayMap[url] != null ? delayMap[url] : 300;
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        try {
          resolve(this.mockDispatch(url, options));
        } catch (e) {
          reject(e);
        }
      }, delay);
    });
  },

  mockDispatch(url, options) {
    switch (url) {
      case '/auth/rokid/bind': {
        const body = options.data || {};
        if (String(body.userId) === '0000') { // 走查口令无效态：口令 R0000-000000
          const e = new Error('口令无效');
          e.code = 40100;
          throw e;
        }
        return { deviceToken: 'mock-token-' + Date.now(), userConfig: MOCK_USER_CONFIG };
      }
      case '/redeem/pending':
        return MOCK_REDEEM;
      case '/statistics':
        return MOCK_STATS;
      case '/lottery/status': {
        const q = (options.url || '').split('?')[1] || '';
        const m = q.match(/type=(ssq|dlt)/);
        return (m && m[1] === 'dlt') ? MOCK_STATUS_DLT : MOCK_STATUS_SSQ;
      }
      case '/ticket/ocr': {
        // 走查完整录入流程：首次 OCR 模拟识别失败（40010）→ 用户点"重试"
        // 重新倒计时拍照 → 第二次起返回识别成功（MOCK_OCR）
        this._ocrFails = (this._ocrFails || 0) + 1;
        if (this._ocrFails === 1) {
          const e = new Error('OCR 识别失败');
          e.code = 40010;
          throw e;
        }
        return MOCK_OCR;
      }
      case '/ticket':
        return { id: 'mock-1001', status: 'saved' };
      case '/recommend': {
        const body = options.data || {};
        const key = (body.system || 'astrology') + '_' + (body.lottery || 'ssq');
        const item = MOCK_RECOMMEND[key] || MOCK_RECOMMEND.astrology_ssq;
        return Object.assign({ cached: true }, item);
      }
      case '/heatmap':
        return this.mockHeatmap();
      default:
        return {};
    }
  },

  // 生成最近 12 周 × 6 开奖日的模拟热力图（还原设计稿明暗分布）
  // ⚠️ 完全静态化：不依赖任何 Date 对象/时钟（Rokid 真机时钟与 Date 构造均不可信，
  //    new Date() 比 new Date(y,m,d) 早 → pending 全 true → 全空心 amt:0）。
  //    日期 key 用纯算术从固定基准 2026-06-08（周一，第 1 列）推算；
  //    pending 固定语义：本周（第 12 列）周二~周日 = 未来期空心；周一当天着色。
  //    直接返回完整 rows（每格含 cls/style），ledger 直接渲染不再自行算日期。
  mockHeatmap() {
    const rowsDef = [
      { label: '周一', lottery: '大乐透', offset: 0 },
      { label: '周二', lottery: '双色球', offset: 1 },
      { label: '周三', lottery: '大乐透', offset: 2 },
      { label: '周四', lottery: '双色球', offset: 3 },
      { label: '周六', lottery: '大乐透', offset: 5 },
      { label: '周日', lottery: '双色球', offset: 6 }
    ];
    const OPACITY = { 1: '0.06', 2: '0.24', 3: '0.48', 4: '0.72', 5: '1' };
    const rows = rowsDef.map((r, rowIdx) => {
      const pattern = MOCK_HEAT_PATTERN[rowIdx] || [];
      const cells = pattern.map((level, col) => {
        const dt = addDaysFixed(2026, 6, 8, col * 7 + r.offset);
        const key = dt.y + '-' + pad2(dt.m) + '-' + pad2(dt.d);
        const noDraw = level === 0;
        const pending = !noDraw && col === 11 && rowIdx >= 1; // 本周周二~周日 = 未来期
        let cls = 'heat hl0';
        let style = 'border: 1px solid rgba(64,255,94,0.24); background-color: rgba(64,255,94,0.06);';
        if (!pending && !noDraw) {
          cls = 'heat hl' + level;
          style = 'background-color: rgba(64,255,94,' + OPACITY[level] + ');';
        }
        return { key, level, pending, noDraw, cls, style };
      });
      return { label: r.label, lottery: r.lottery, cells };
    });
    return { weeks: 12, rows, legend: { min: 0, max: 4 } };
  },

  // ---- 子页返回首页（栈式） ----
  // 官方推荐 navigateBack：home 进入子页时已 navigateTo 入栈，弹回原实例触发
  // onShow（静默刷新，不重建、不闪骨架）；意图直达（栈中无 home）时 fail 兜底 redirectTo。
  navigateBackHome() {
    try {
      if (typeof wx !== 'undefined' && wx.navigateBack) {
        wx.navigateBack({ fail: () => navigateToPage('home') });
        return;
      }
      if (typeof aiui !== 'undefined' && aiui.navigateBack) {
        aiui.navigateBack({ fail: () => navigateToPage('home') });
        return;
      }
    } catch (e) { /* fallthrough */ }
    navigateToPage('home');
  },

  // ---- 页面退出（"退出"按钮 / 触控板双击 / 根页 Backspace 放行） ----
  exitApp() {
    try {
      if (typeof aiui !== 'undefined' && aiui.closeApp) aiui.closeApp();
      else if (typeof wx !== 'undefined' && wx.exitMiniProgram) wx.exitMiniProgram();
      else if (typeof wx !== 'undefined' && wx.navigateBack) wx.navigateBack();
    } catch (e) { console.error('退出失败', e); }
  },

  // ---- 触控板双击退出（2026-08-26 需求） ----
  // 官方文档：GlobalHook = Rokid 镜腿（触控板）触摸事件编码；宿主系统级"双击退出"交互
  // 在应用层无独立事件，且 Backspace 通道此前被全页面拦截导致双击无反应。
  // 这里在应用层主动检测：400ms 内两次 GlobalHook（双击触控板）→ 主动退出智能体。
  _tapLastAt: 0,
  handleTapKey(code) {
    if (code !== 'GlobalHook') return;
    const now = Date.now();
    if (this._tapLastAt && now - this._tapLastAt <= 400) {
      this._tapLastAt = 0;
      console.log('[goodluck+] 触控板双击 → 退出智能体');
      this.exitApp();
      return;
    }
    this._tapLastAt = now;
  },

  // ---- 推荐页跨进入缓存（2026-08-26 性能优化） ----
  // ⚠️ 问题：推荐页每次进入都清空页面缓存重发 5 个请求（默认+4 预取），
  //    任一未缓存场景触发 LLM 演算 5-8s 并占住网络槽位 → 进入极慢/加载失败。
  //    后端本身有当日缓存（命中秒回），这里再加一层应用级缓存（键含日期，跨天自动失效），
  //    已演算过的场景重新进入直接显示，零请求秒开。
  recommendToday() {
    // 日期键：优先服务器时间（HTTP Date 头转北京时间，getUTC* 避免时区双偏移）；真机时钟仅兜底
    const srv = this.globalData && this.globalData.serverNow;
    const d = srv ? new Date(new Date(srv).getTime() + 8 * 3600 * 1000) : new Date();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    return d.getUTCFullYear() + '-' + mm + '-' + dd;
  },

  // 读取当日推荐缓存（map: label → data）；跨天自动失效返回空
  // ⚠️ 持久化（2026-08-26）：眼镜端每次唤起多为冷启动（新进程），内存缓存必丢——
  //    不落 storage 则"推荐秒开"仅应用内切换生效。storage 有当日键，跨天自动失效。
  getRecommendCache() {
    const k = this.recommendToday();
    const c = this.globalData.recommendCache;
    if (c && c.date === k) return c.map || {};
    try {
      const raw = storageGet('recommendCache');
      if (raw && typeof raw === 'object' && raw.date === k) {
        this.globalData.recommendCache = raw;
        return raw.map || {};
      }
    } catch (e) { /* ignore */ }
    return {};
  },

  // 写入推荐缓存（按场景 label：如 '星座-双色球'）
  setRecommendCache(label, data) {
    const key = this.recommendToday();
    const c = this.globalData.recommendCache;
    if (!c || c.date !== key) {
      this.globalData.recommendCache = { date: key, map: {} };
    }
    this.globalData.recommendCache.map[label] = data;
    try { storageSet('recommendCache', this.globalData.recommendCache); } catch (e) { /* ignore */ }
  },

  // ---- 通用页面数据缓存（2026-08-26 性能优化） ----
  // ⚠️ 眼镜端 AIUI 网络栈冷启动开销大（小程序端无此问题），后端接口实测 ~50ms 很快，
  //    慢在眼镜端每次进入页面重新请求。页面数据按 key 缓存（当日有效），
  //    再次进入先秒显缓存再静默刷新——彻底消除"每次进入都等"的感知。
  pageToday() {
    return this.recommendToday();
  },

  getPageCache(key) {
    const k = this.pageToday();
    const c = this.globalData.pageCache;
    if (c && c.date === k) {
      return c.map && c.map[key] ? c.map[key] : null;
    }
    // 冷启动恢复：内存缓存丢失 → 从 storage 读当日缓存（跨天自动失效）
    try {
      const raw = storageGet('pageCache');
      if (raw && typeof raw === 'object' && raw.date === k) {
        this.globalData.pageCache = raw;
        return raw.map && raw.map[key] ? raw.map[key] : null;
      }
    } catch (e) { /* ignore */ }
    return null;
  },

  setPageCache(key, data) {
    const k = this.pageToday();
    const c = this.globalData.pageCache;
    if (!c || c.date !== k) {
      this.globalData.pageCache = { date: k, map: {} };
    }
    this.globalData.pageCache.map[key] = data;
    // 持久化到 storage：冷启动（新进程）也能恢复缓存秒开
    try { storageSet('pageCache', this.globalData.pageCache); } catch (e) { /* ignore */ }
  },

  // ---- 首页数据预热（2026-08-26 性能优化） ----
  // ⚠️ 痛点：绑定页点「进入」→ relaunch 首页 → 首页 onLoad 才发 5 个请求——
  //    AIUI 冷启动时页面切换 + 首轮网络请求叠加，用户感知"点进入后 3s 空窗 + 骨架 3s"。
  // 方案：bind 成功（网络已热）瞬间并行拉首页 5 接口，原始响应存 prefetched；
  //    relaunch 页面切换期间请求已返回，home onLoad 消费预取数据（takePrefetched），
  //    秒开免骨架；数据加工逻辑留在页面（此处只存原始响应，格式与 /api 契约一致）。
  prefetchHome() {
    // ⚠️ 防御（2026-08-26 事故）：无有效 token 绝不发预取——request 层 40100 会清登录态
    //    并跳绑定页，预取请求若无鉴权头 = 主动把自己踢回登录页（死循环）。
    if (!this.getDeviceToken()) {
      console.warn('[goodluck+] prefetchHome: 无有效 token，跳过预取');
      return;
    }
    const urls = [
      '/redeem/pending', '/statistics', '/ticket',
      '/lottery/status?type=ssq', '/lottery/status?type=dlt'
    ];
    const map = (this.globalData && this.globalData.prefetched) || {};
    urls.forEach((u) => {
      this.request({ url: u })
        .then((data) => {
          if (!data) return;
          map[u] = data;
          this.globalData.prefetched = map;
        })
        .catch(() => { /* 预取失败不阻塞：页面走正常网络请求兜底 */ });
    });
  },

  // 页面消费预取数据：命中即返回并移除（一次性，下次 refresh 走真实网络保证新鲜）
  takePrefetched(url) {
    const map = this.globalData && this.globalData.prefetched;
    if (!map || !map[url]) return null;
    const data = map[url];
    delete map[url];
    return data;
  },

  globalData: {
    apiBaseUrl: API_BASE,
    useMock: USE_MOCK,          // 页面据此跳过真实相机等硬件依赖
    launchOptions: null,
    launchPasscode: null,   // 启动携带口令 {userId, code, full}（指令文本不进应用，暂不可用）
    fixedPasscode: FIXED_PASSCODE, // 临时写死口令（绑定流程重设计前使用）
    intentPage: null,       // 意图直达页面（record/recommend/ledger/home）
    pendingInvalid: false,   // bind 40100 → 登录页口令无效态
    recommendCache: null,    // 推荐结果跨页面缓存（当日有效）
    pageCache: null,         // 通用页面数据缓存（当日有效，key → data）
    prefetched: null         // 绑定成功后预取的首页原始响应（url → data，一次性消费）
  }
};

// ⚠️ 官方标准（AIUI 官方 sample + SKILL.md §1.3）：app.js 用 `export default` 注册应用。
//    真机 Ink 基于 QuickJS 2024-01-13（完全支持 ES2023 含 ESM），原生支持 export default——
//    **不要**再调用 App() 或写 module.exports：框架会自动读取 export default 注册，
//    重复注册（App()）会导致真机启动闪退（2026-08-25 事故复盘）。
//    ⚠️ 2026-08-26：对象已直接以 `export default {` 内联开头（上方），此处不再重复导出。
