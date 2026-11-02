/**
 * utils/api.js - 统一 API 层
 * USE_MOCK=true 时走本地 mock（前端独立调试）；false 时走真实 HTTP 请求
 */
const config = require('../config/index');
const mock = require('./mock');

// 简单 request 封装（返回 Promise）
// 40100 自动重新登录：token 失效（后端清库/换设备）时自动重新获取身份并重试一次。
// 2026-08-21：优先微信登录（openid 身份，手机/PC 同一微信号同一用户），失败降级匿名注册。
let ensuring = null; // 防并发登录

function fallbackRegister() {
  return register().then((res) => {
    const token = res && res.data && res.data.deviceToken;
    if (!token) throw new Error('register 未返回 deviceToken');
    wx.setStorageSync('deviceToken', token);
    const app = typeof getApp === 'function' ? getApp() : null;
    if (app) app.globalData.deviceToken = token;
    return token;
  });
}

/** 获取有效 token：优先微信登录（openid 身份），失败降级匿名注册 */
function ensureToken() {
  return new Promise((resolve, reject) => {
    wx.login({
      success: (res) => {
        if (!res.code) {
          fallbackRegister().then(resolve).catch(reject);
          return;
        }
        login(res.code)
          .then((r) => {
            const token = r && r.data && r.data.deviceToken;
            if (!token) {
              throw new Error('login 未返回 deviceToken: code=' + (r && r.code) + ' message=' + (r && r.message));
            }
            wx.setStorageSync('deviceToken', token);
            const app = typeof getApp === 'function' ? getApp() : null;
            if (app) app.globalData.deviceToken = token;
            resolve(token);
          })
          .catch((err) => {
            // 微信登录失败（code 过期/后端未配置）→ 降级匿名注册，保证可用
            // 2026-09-04：此前静默降级，openid 登录从未成功却无任何痕迹，导致身份分裂排查困难
            console.error('[Auth] wx.login 登录失败，降级匿名注册:', (err && (err.errMsg || err.message)) || err);
            fallbackRegister().then(resolve).catch(reject);
          });
      },
      fail: () => {
        fallbackRegister().then(resolve).catch(reject);
      }
    });
  });
}

function tokenAndRetry(opt, resolve, reject) {
  const ensure = ensuring || (ensuring = ensureToken().finally(() => { ensuring = null; }));
  ensure
    .then(() => request({ ...opt, retried: true }))
    .then(resolve)
    .catch(reject);
}

function request({ url, method = 'GET', data = {}, header = {}, retried = false }) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: config.apiBaseUrl + url,
      method,
      data,
      header: {
        'Content-Type': 'application/json',
        'X-Device-Token': header.token || wx.getStorageSync('deviceToken') || '',
        ...header
      },
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const body = res.data || {};
          // Token 无效：自动重新登录后重试一次（不递归，retried 标记）
          if (body.code === 40100 && !retried) {
            tokenAndRetry({ url, method, data, header }, resolve, reject);
            return;
          }
          resolve(body);
        } else {
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      },
      fail: (err) => reject(err)
    });
  });
}

// 模拟网络延迟，让交互更真实
function mockDelay(data, ms = 300) {
  return new Promise((resolve) => {
    setTimeout(() => resolve(data), ms);
  });
}

// ---------- API 定义（与《云后台接口约定》11 个接口对应） ----------

// 注册设备（返回 deviceToken；匿名设备，眼镜端/登录降级用）
function register(payload) {
  if (config.USE_MOCK) {
    return mockDelay({ code: 0, message: 'ok', data: { deviceToken: 'mock-device-token-001' } });
  }
  return request({ url: '/auth/register', method: 'POST', data: payload });
}

// 微信登录（code → 后端 code2session 换 openid；同一微信号手机/PC 同一用户，2026-08-21）
function login(code) {
  if (config.USE_MOCK) {
    return mockDelay({ code: 0, message: 'ok', data: { deviceToken: 'mock-device-token-001' } });
  }
  return request({ url: '/auth/login', method: 'POST', data: { code } });
}

// 用户配置（GET）
function getUserConfig() {
  if (config.USE_MOCK) {
    const app = getApp ? getApp() : null;
    const savedConfig = wx.getStorageSync('userConfig') || (app && app.globalData && app.globalData.userConfig) || {};
    return mockDelay({
      code: 0,
      message: 'ok',
      data: {
        name: savedConfig.name || '春生',
        gender: savedConfig.gender || 'male',
        birth: savedConfig.birth || '2000-01-15',
        lotteryType: savedConfig.lotteryType || (Array.isArray(savedConfig.lotteryTypes) && savedConfig.lotteryTypes[0]) || 'ssq',
        lotteryTypes: savedConfig.lotteryTypes || [savedConfig.lotteryType || 'ssq'], // 兼容旧结构
        divinationSystem: savedConfig.divinationSystem || 'astrology'                  // 推演模式
      }
    });
  }
  return request({ url: '/user/config' });
}

// 保存用户配置（POST）
function saveUserConfig(payload) {
  if (config.USE_MOCK) {
    return mockDelay({ code: 0, message: 'ok', data: payload });
  }
  return request({ url: '/user/config', method: 'POST', data: payload });
}

// Rokid 口令验证码设置/更新（2026-08-25 改造说明 §5.2）：POST /auth/rokid/passcode
function setRokidPasscode(code) {
  if (config.USE_MOCK) {
    const app = typeof getApp === 'function' ? getApp() : null;
    const cfg = (app && app.globalData && app.globalData.userConfig) || wx.getStorageSync('userConfig') || {};
    const userId = String((cfg && cfg.userId) || '1024');
    return mockDelay({ code: 0, message: 'ok', data: { userId } });
  }
  return request({ url: '/auth/rokid/passcode', method: 'POST', data: { code } });
}

// 票据 OCR 识别（拍照上传）
function ocrTicket(filePath) {
  if (config.USE_MOCK) {
    return mockDelay({
      code: 0,
      message: 'ok',
      data: mock.ocrResult
    });
  }
  return ocrUpload(filePath, false);
}

// uploadFile 专用上传（带 40100 自动重注册重试，与 request() 同款兜底：
// 后端 reset 数据库后 storage 旧 deviceToken 失效，普通接口靠 request 重试，
// 上传接口此前缺失导致清库后 OCR 一直失败，2026-08-21 修复）
function ocrUpload(filePath, retried) {
  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: config.apiBaseUrl + '/ticket/ocr',
      filePath,
      name: 'file',
      header: { 'X-Device-Token': wx.getStorageSync('deviceToken') || '' },
      success: (res) => {
        try {
          const body = JSON.parse(res.data);
          // Token 失效：自动重新登录（微信 openid 优先）后重试一次（不递归，retried 标记）
          if (body && body.code === 40100 && !retried) {
            const ensure = ensuring || (ensuring = ensureToken().finally(() => { ensuring = null; }));
            ensure
              .then(() => ocrUpload(filePath, true))
              .then(resolve)
              .catch(reject);
            return;
          }
          resolve(body);
        } catch (e) {
          reject(e);
        }
      },
      fail: (err) => {
        // 联调排查：打印上传失败详情（域名校验/路径/网络问题会在这里暴露）
        console.error('[OCR] uploadFile 失败, url=', config.apiBaseUrl + '/ticket/ocr', 'filePath=', filePath, 'err=', err);
        reject(err);
      }
    });
  });
}

// 保存彩票（POST /ticket）
function saveTicket(payload) {
  if (config.USE_MOCK) {
    return mockDelay({ code: 0, message: 'ok', data: { id: 'T20260818001' } });
  }
  return request({ url: '/ticket', method: 'POST', data: payload });
}

// 彩票列表（GET /ticket）
function getTickets() {
  if (config.USE_MOCK) {
    return mockDelay({ code: 0, message: 'ok', data: { list: mock.tickets } });
  }
  return request({ url: '/ticket' });
}

// 删除票据（DELETE /ticket/:id）
function deleteTicket(id) {
  if (config.USE_MOCK) {
    return mockDelay({ code: 0, message: 'ok', data: null });
  }
  return request({ url: `/ticket/${id}`, method: 'DELETE' });
}

// 兑奖确认（POST /redeem/confirm，payload: { id } 或 { ticketId }）
function confirmRedeem(payload) {
  if (config.USE_MOCK) {
    return mockDelay({ code: 0, message: 'ok', data: { status: 'redeemed' } });
  }
  return request({ url: '/redeem/confirm', method: 'POST', data: payload });
}

// 待兑奖列表（GET /redeem/pending）
function getPendingRedeem() {
  if (config.USE_MOCK) {
    return mockDelay({
      code: 0,
      message: 'ok',
      data: {
        list: [{
          id: 'R001',
          lotteryName: '双色球',
          period: '第 2024090 期',
          amount: 300000,                    // 单位分
          deadlineDate: '2024-10-12',        // 兑奖截止
          redeemChannel: 'shop',             // 'shop' | 'center'
          daysLeft: 12
        }]
      }
    });
  }
  return request({ url: '/redeem/pending' });
}

// 彩种状态（GET /lottery/status）
function getLotteryStatus(type) {
  if (config.USE_MOCK) {
    return mockDelay({ code: 0, message: 'ok', data: mock.lotteryStatus[type] || mock.lotteryStatus.ssq });
  }
  return request({ url: '/lottery/status', data: { type } });
}

// 开奖号码（GET /lottery/draw）
function getDraw(type) {
  if (config.USE_MOCK) {
    return mockDelay({
      code: 0,
      message: 'ok',
      data: mock.lotteryStatus[type] || mock.lotteryStatus.ssq
    });
  }
  return request({ url: '/lottery/draw', data: { type } });
}

// 补差同步开奖结果（POST /lottery/sync）：按开奖日期同步该期，日历"同步"按钮用
function syncDraw(type, date) {
  if (config.USE_MOCK) {
    return mockDelay({ code: 0, message: 'ok', data: { synced: true, skipped: false, period: '' } });
  }
  return request({ url: '/lottery/sync', method: 'POST', data: { type, date } });
}

// 购彩统计（GET /statistics）
function getStatistics() {
  if (config.USE_MOCK) {
    return mockDelay({ code: 0, message: 'ok', data: mock.statistics });
  }
  return request({ url: '/statistics' });
}

// 热力图（GET /heatmap）
function getHeatmap() {
  if (config.USE_MOCK) {
    return mockDelay({ code: 0, message: 'ok', data: mock.heatmap });
  }
  return request({ url: '/heatmap' });
}

// 农历信息（GET /lunar）
function getLunar() {
  if (config.USE_MOCK) {
    return mockDelay({ code: 0, message: 'ok', data: { lunar: '甲辰年七月廿八' } });
  }
  return request({ url: '/lunar' });
}

// 号码推荐（本地推演：由 lunar + 用户配置组合，真实后端为推荐服务 LLM）
function getRecommendation(payload) {
  if (config.USE_MOCK) {
    // mock：按 (彩种 × 体系) 取四套预置数据之一
    const lottery = (payload && payload.lottery) || 'ssq';  // 'ssq' | 'dlt'
    const system = (payload && payload.system) || 'astrology'; // 'astrology' | 'iching'
    const key = `${lottery}${system === 'iching' ? 'Iching' : 'Astrology'}`;  // e.g. ssqAstrology / dltIching
    const base = (mock.recommend && mock.recommend[key]) || mock.recommend.ssqAstrology;
    // 合并基础字段（userText / disclaimer / date）与对应号码
    return mockDelay({
      code: 0,
      message: 'ok',
      data: {
        systemName: base.systemName,
        date: mock.recommend.date,
        userText: mock.recommend.userText,
        disclaimer: mock.recommend.disclaimer,
        redLabel: base.redLabel,
        blueLabel: base.blueLabel,
        redBalls: base.redBalls,
        blueBalls: base.blueBalls,
        summary: base.summary
      }
    });
  }
  return request({ url: '/recommend', method: 'POST', data: payload || {} });
}

module.exports = {
  register,
  login,
  ensureToken,
  // 通用请求器：仅供「附近」等不走 api.js 接口清单的场景复用
  // （复用 X-Device-Token 注入 + 40100 自动重登重试，避免各页面自己重造一遍网络层）
  request,
  getUserConfig,
  saveUserConfig,
  setRokidPasscode,
  ocrTicket,
  saveTicket,
  getTickets,
  deleteTicket,
  confirmRedeem,
  getPendingRedeem,
  getLotteryStatus,
  getDraw,
  syncDraw,
  getStatistics,
  getHeatmap,
  getLunar,
  getRecommendation
};
