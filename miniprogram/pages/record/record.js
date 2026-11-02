/**
 * pages/record/record.js - 录入彩票页（Screen3）
 * 流程：拍照取景 → OCR 识别中 → 详情确认 → 存档
 */
const api = require('../../utils/api');
const mock = require('../../utils/mock');
const config = require('../../config/index');

function formatAmountYuan(amountFen) {
  // 2026-08-21：金额只显示到元（去角分）
  return `¥ ${Math.round((Number(amountFen) || 0) / 100)}`;
}

function buildAmountSummary(ocr) {
  const bets = ocr.bets || [];
  const betCount = bets.length;
  const multipliers = [...new Set(bets.map((item) => Number(item.mult) || 1))];
  if (multipliers.length === 1) {
    return `投注金额 · ${betCount} 注 × ${multipliers[0]} 倍`;
  }
  return `投注金额 · ${betCount} 注 · 含多倍组合`;
}

function buildOcrState(payload) {
  const lotteryType = payload.lotteryType || (payload.lotteryName === '大乐透' ? 'dlt' : 'ssq');
  const bets = (payload.bets || []).map((item, index) => ({
    id: item.id || index + 1,
    red: (item.red || []).map((num) => String(num).padStart(2, '0')),
    blue: (item.blue || []).map((num) => String(num).padStart(2, '0')),
    mult: Number(item.mult) || 1
  }));
  const totalAmountFen = bets.reduce((sum, item) => sum + (Number(item.mult) || 1) * 200, 0);
  return {
    ...payload,
    lotteryType,
    bets,
    betCount: bets.length,
    multiplier: bets[0] ? bets[0].mult : Number(payload.multiplier) || 1,
    totalAmount: formatAmountYuan(totalAmountFen),
    amountSummaryText: buildAmountSummary({ bets }),
    // 2026-10-16 修复：真实后端 /ticket/ocr 不返回 ocrStatus（只有 mock 里有），
    // 徽章文本取空 → 渲染成一个没有任何文字的纯色圆角块（用户看到的"淡黄圆点"）。
    // 这里兜底成"自动识别"，与 WXML 的 auto/verified 两态判断保持一致。
    ocrStatus: payload.ocrStatus || '自动识别'
  };
}

const LOTTERY_RULES = {
  ssq: {
    lotteryType: 'ssq',
    lotteryName: '双色球',
    redLabel: '红球',
    blueLabel: '蓝球',
    redCount: 6,
    blueCount: 1,
    redMax: 33,
    blueMax: 16
  },
  dlt: {
    lotteryType: 'dlt',
    lotteryName: '大乐透',
    redLabel: '前区',
    blueLabel: '后区',
    redCount: 5,
    blueCount: 2,
    redMax: 35,
    blueMax: 12
  }
};

function getLotteryRule(lotteryType) {
  return LOTTERY_RULES[lotteryType] || LOTTERY_RULES.ssq;
}

function sortBallList(list) {
  return list
    .map((item) => String(item).padStart(2, '0'))
    .sort((a, b) => Number(a) - Number(b));
}

function buildNumberOptions(max, selectedList) {
  const selected = sortBallList(selectedList);
  return Array.from({ length: max }, (_, index) => {
    const value = String(index + 1).padStart(2, '0');
    return {
      value,
      selected: selected.includes(value)
    };
  });
}

function buildEditorView(rule, form) {
  // 当前已选号码预览（红球 - 蓝球，抽屉内展示，2026-08-20 新增）
  const previewRed = (form.red || []).map((item) => String(item).padStart(2, '0'));
  const previewBlue = (form.blue || []).map((item) => String(item).padStart(2, '0'));
  return {
    editorRule: rule,
    editorRedOptions: buildNumberOptions(rule.redMax, form.red),
    editorBlueOptions: buildNumberOptions(rule.blueMax, form.blue),
    editorRedSummary: `已选 ${form.red.length}/${rule.redCount}`,
    editorBlueSummary: `已选 ${form.blue.length}/${rule.blueCount}`,
    editorPreviewRed: previewRed,
    editorPreviewBlue: previewBlue
  };
}

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    captureStage: 'camera',
    ocr: null,
    editorVisible: false,
    editingBetIndex: -1,
    editorDirty: false,   // 校对抽屉是否有未保存改动（2026-10-16：关闭前需确认，避免静默丢失草稿）
    saving: false,
    editorRule: getLotteryRule('ssq'),
    editorRedOptions: [],
    editorBlueOptions: [],
    editorRedSummary: '',
    editorBlueSummary: '',
    editorPreviewRed: [],
    editorPreviewBlue: [],
    editorForm: {
      red: [],
      blue: [],
      mult: 1
    }
  },

  onLoad() {
    // 注入胶囊对齐导航参数
    const app = getApp();
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight,
      navBarHeight: app.globalData.navBarHeight
    });
  },

  onReady() {
    this.cameraContext = wx.createCameraContext();
  },

  onShow() {
    this.updateTabBar(this.data.editorVisible);
    // 2026-09-04 修复：安卓端（小米实测）相册选择器关闭会触发页面 onShow，且时序晚于
    // chooseMedia 的 success 回调 → 此前 resetToCamera 把 recognizing 状态打回 camera
    // 并清空 captureRequestId，导致"OCR识别中"不显示、runOcr 中途自毁、上传从未发出
    // （华为 onShow 先于 success 回调，故无此问题）。识别进行中时跳过重置。
    if (this.data.captureStage === 'recognizing') return;
    // 再次进入录入页时重置为待拍照状态（2026-08-20 修复：保存成功后再进入，
    // 上次的识别结果/OCR 数据仍残留显示 → 每次 onShow 清空）
    this.resetToCamera();
  },

  /** 回到初始取景态：清空 OCR 结果、关闭校对抽屉、重置请求 ID */
  resetToCamera() {
    this.captureRequestId = null;
    this.updateTabBar(false);
    this.setData({
      captureStage: 'camera',
      ocr: null,
      editorVisible: false,
      editingBetIndex: -1,
      editorDirty: false
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
      this.getTabBar().setData({ selected: 1, hidden });
    }
  },

  onPrimaryAction() {
    if (this.data.captureStage === 'camera') {
      this.startCapture();
      return;
    }

    if (this.data.captureStage === 'result') {
      this.onSave();
    }
  },

  // 相册选图（开发者工具模拟器无摄像头 / 真机备选）：选图后走同一 OCR 链路
  chooseFromAlbum() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album'],
      sizeType: ['compressed'],
      success: (res) => {
        const filePath = res.tempFiles && res.tempFiles[0] && res.tempFiles[0].tempFilePath;
        if (!filePath) {
          wx.showToast({ title: '未获取到图片', icon: 'none' });
          return;
        }
        // 小米等安卓机型可能选中 HEIC/HEIF 照片，记录扩展名与体积便于排查
        const fileSize = res.tempFiles[0].size;
        console.log('[OCR] 相册选图成功:', filePath, 'size=', fileSize);
        const captureRequestId = Date.now();
        this.captureRequestId = captureRequestId;
        this.setData({ captureStage: 'recognizing' });
        this.runOcr(filePath, captureRequestId);
      },
      fail: (err) => {
        // 2026-09-04 修复：此前 fail 分支为空，把权限/隐私协议等失败全当成用户取消，
        // 小米机型上表现为"点了相册没反应"。仅用户主动取消时静默，其余必须提示。
        const msg = (err && err.errMsg) || '';
        if (/cancel/i.test(msg)) return;
        console.error('[OCR] chooseMedia 失败:', msg);
        wx.showToast({ title: '相册打开失败，请重试', icon: 'none' });
      }
    });
  },

  onRetake() {
    this.captureRequestId = null;
    this.updateTabBar(false);
    this.setData({
      captureStage: 'camera',
      ocr: null,
      editorVisible: false,
      editingBetIndex: -1,
      editorDirty: false
    });
  },

  // 相机拍照 → OCR
  startCapture() {
    if (!this.cameraContext) {
      this.cameraContext = wx.createCameraContext();
    }

    const captureRequestId = Date.now();
    this.captureRequestId = captureRequestId;

    // 2026-09-04 修复：1200ms 对小米等机型过短（相机初始化/首拍慢，华为正常）→
    // 放宽到 5s；超时后作废本次请求 ID，防止 takePhoto 迟到的 success 再触发 OCR
    const fallbackTimer = setTimeout(() => {
      if (this.captureRequestId !== captureRequestId) return;
      if (config.USE_MOCK) {
        this.setData({ captureStage: 'recognizing' });
        this.runOcr('mock-camera-shot', captureRequestId);
        return;
      }
      this.captureRequestId = null;
      this.setData({ captureStage: 'camera' });
      wx.showToast({ title: '拍照超时，请重试', icon: 'none' });
    }, config.USE_MOCK ? 1200 : 5000);

    // 2026-09-04 关键修复：必须先 takePhoto、成功后再切 recognizing。
    // 此前先 setData('recognizing') 会经 wx:if 销毁相机组件，真机上 takePhoto
    // 永久挂起 → 5 秒后误报"拍照超时"（小米实锤；华为/模拟器时序快未暴露）
    this.cameraContext.takePhoto({
      quality: 'high',
      success: (res) => {
        clearTimeout(fallbackTimer);
        if (this.captureRequestId !== captureRequestId) return;
        this.setData({ captureStage: 'recognizing' });
        this.runOcr(res.tempImagePath, captureRequestId);
      },
      fail: (err) => {
        clearTimeout(fallbackTimer);
        if (this.captureRequestId !== captureRequestId) return;
        this.captureRequestId = null;
        this.setData({ captureStage: 'camera' });
        console.warn('[OCR] takePhoto 失败:', (err && err.errMsg) || err);
        wx.showToast({ title: '拍照失败，请重试', icon: 'none' });
      }
    });
  },

  // HEIC/HEIF 检测：iPhone 默认 HEIC，部分安卓新机同样命中。
  // 前端无转码能力（微信无 HEIC→JPG 转换 API），HEIC 原图直传后端 OCR 必失败
  // （iOS uploadFile 报 invalid file type），故不再浪费上传，直接给可操作提示。
  isHeicFile(filePath) {
    return /\.hei[cf]$/i.test(filePath || '');
  },

  runOcr(filePath, requestId) {
    if (requestId && this.captureRequestId !== requestId) return;
    // 2026-09-04 加固：部分小米机型 compressImage 可能既不回调 success 也不回调 fail（挂起），
    // 导致永远卡在"OCR识别中"。8s 无回调则直接上传原图（后端超 2MB 会返回明确提示）。
    let settled = false;
    const watchdog = setTimeout(() => {
      if (settled) return;
      settled = true;
      console.warn('[OCR] compressImage 8s 无回调，直接上传原图:', filePath);
      this.doOcrUpload(filePath, requestId);
    }, 8000);
    const settle = (path) => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      this.doOcrUpload(path, requestId);
    };
    // 上传前压缩：手机原图通常 2-5MB，超出后端 2MB 限制会被拒收
    // 注意：安卓端 compressImage 仅支持 jpg；iOS 端支持 jpg/png，
    // 且 iOS 对 HEIC 通常能自动转 jpeg（此时压缩产物扩展名为 .jpg，可正常上传）
    wx.compressImage({
      src: filePath,
      quality: 80,
      success: (res) => {
        const compressed = res.tempFilePath || filePath;
        // 2026-09-04 兼容修复：部分小米机型 compressImage 返回的临时路径未落盘/不可读，
        // 导致 uploadFile 静默失败（服务器端收不到请求）。压缩产物先校验，不可读则回退原图。
        this.ensureFileReadable(compressed, (readable) => {
          if (requestId && this.captureRequestId !== requestId) return;
          if (readable) {
            settle(compressed);
          } else {
            console.warn('[OCR] 压缩图不可读，回退原图上传:', compressed);
            settle(filePath);
          }
        });
      },
      fail: (err) => {
        // 2026-09-04 修复：此前静默降级不打日志，小米端 HEIC/压缩失败完全无感知
        console.warn('[OCR] compressImage 失败，使用原图:', (err && err.errMsg) || err);
        // 原图即 HEIC 时回退原图没有意义（后端无法识别该格式），直接提示换图
        if (this.isHeicFile(filePath)) {
          settled = true;
          clearTimeout(watchdog);
          if (requestId && this.captureRequestId !== requestId) return;
          this.resetToCamera();
          wx.showToast({
            title: '该照片为 HEIC 格式无法识别，请换一张照片，或把相机格式改为“兼容性最佳”',
            icon: 'none',
            duration: 3000
          });
          return;
        }
        settle(filePath);
      }
    });
  },

  // 校验临时文件真实可读（FileSystemManager.access）。
  // 注意：access 本身在个别机型也可能误报，因此只用于"压缩产物→原图"降级判断，
  // 原图路径不做硬拦截，最终以 uploadFile 的 fail 回调兜底。
  ensureFileReadable(filePath, cb) {
    try {
      wx.getFileSystemManager().access({
        path: filePath,
        success: () => cb(true),
        fail: (err) => {
          console.warn('[OCR] 文件不可读:', filePath, (err && err.errMsg) || err);
          cb(false);
        }
      });
    } catch (e) {
      // 低版本基础库无 FileSystemManager → 跳过校验，按可读处理
      cb(true);
    }
  },

  doOcrUpload(filePath, requestId) {
    if (requestId && this.captureRequestId !== requestId) return;
    console.log('[OCR] 开始上传:', filePath);
    api.ocrTicket(filePath)
      .then((result) => {
        if (requestId && this.captureRequestId !== requestId) return;
        if (result && result.data) {
          this.setData({
            captureStage: 'result',
            ocr: buildOcrState(result.data)
          });
        } else {
          console.warn('[OCR] 返回无 data, result=', result);
          this.fallbackManual();
        }
      })
      .catch((err) => {
        // 联调排查：打印后端返回的 code/message
        console.error('[OCR] ocrTicket reject, err=', err);
        if (requestId && this.captureRequestId !== requestId) return;
        this.fallbackManual();
      });
  },

  // OCR 识别失败 → 回到初始取景态（不塞 mock 数据，用户可重拍或从相册选图）
  fallbackManual() {
    this.resetToCamera();
    wx.showToast({ title: '识别失败，请重拍或从相册选取', icon: 'none' });
  },

  onEditBet(e) {
    if (!this.data.ocr) return;
    const index = Number(e.currentTarget.dataset.index);
    const bet = this.data.ocr.bets[index];
    if (!bet) return;
    const rule = getLotteryRule(this.data.ocr.lotteryType);
    const editorForm = {
      red: sortBallList(bet.red),
      blue: sortBallList(bet.blue),
      mult: Math.max(1, Number(bet.mult) || 1)
    };

    this.updateTabBar(true);
    this.setData({
      editorVisible: true,
      editingBetIndex: index,
      editorDirty: false,
      editorForm,
      ...buildEditorView(rule, editorForm)
    });
  },

  onToggleEditorBall(e) {
    const { area, value } = e.currentTarget.dataset;
    const editorRule = this.data.editorRule;
    const limit = area === 'red' ? editorRule.redCount : editorRule.blueCount;
    const selected = (this.data.editorForm[area] || []).slice();
    const currentIndex = selected.indexOf(value);

    if (currentIndex > -1) {
      selected.splice(currentIndex, 1);
    } else if (selected.length >= limit) {
      wx.showToast({ title: `${area === 'red' ? editorRule.redLabel : editorRule.blueLabel}最多选 ${limit} 个`, icon: 'none' });
      return;
    } else {
      selected.push(value);
    }

    const editorForm = {
      ...this.data.editorForm,
      [area]: sortBallList(selected)
    };

    this.setData({
      editorForm,
      editorDirty: true,
      ...buildEditorView(editorRule, editorForm)
    });
  },

  /**
   * 关闭校对抽屉（2026-10-16）：
   * 有未保存改动时先确认再放弃 —— 点抽屉遮罩、点「取消」都走这里。
   * 只关闭抽屉，不动 captureStage 与 ocr（用户可能只是想退出校对继续存档）。
   */
  closeEditor() {
    if (this.data.editorDirty) {
      wx.showModal({
        title: '放弃本次校对？',
        content: '你修改的号码还没有保存，关闭后改动会丢失。',
        confirmText: '放弃修改',
        cancelText: '继续校对',
        success: (res) => {
          if (res.confirm) this.doCloseEditor();
        }
      });
      return;
    }
    this.doCloseEditor();
  },

  doCloseEditor() {
    this.updateTabBar(false);
    this.setData({
      editorVisible: false,
      editingBetIndex: -1,
      editorDirty: false
    });
  },

  onDecreaseMult() {
    const nextMult = Math.max(1, Number(this.data.editorForm.mult) - 1 || 1);
    if (nextMult === Number(this.data.editorForm.mult)) return;
    this.setData({
      'editorForm.mult': nextMult,
      editorDirty: true
    });
  },

  onIncreaseMult() {
    const nextMult = Math.max(1, Number(this.data.editorForm.mult) + 1 || 1);
    this.setData({
      'editorForm.mult': nextMult,
      editorDirty: true
    });
  },

  saveEditor() {
    const { editingBetIndex, editorForm, ocr } = this.data;
    const currentBet = ocr.bets[editingBetIndex];
    if (!currentBet) return;
    const editorRule = this.data.editorRule;

    if ((editorForm.red || []).length !== editorRule.redCount) {
      wx.showToast({ title: `${editorRule.redLabel}需要选满 ${editorRule.redCount} 个`, icon: 'none' });
      return;
    }

    if ((editorForm.blue || []).length !== editorRule.blueCount) {
      wx.showToast({ title: `${editorRule.blueLabel}需要选满 ${editorRule.blueCount} 个`, icon: 'none' });
      return;
    }

    const mult = Number(editorForm.mult);
    if (!Number.isInteger(mult) || mult <= 0) {
      wx.showToast({ title: '倍数需为正整数', icon: 'none' });
      return;
    }

    const bets = ocr.bets.slice();
    bets[editingBetIndex] = {
      ...currentBet,
      red: sortBallList(editorForm.red),
      blue: sortBallList(editorForm.blue),
      mult
    };

    this.updateTabBar(false);
    this.setData({
      ocr: buildOcrState({
        ...ocr,
        ocrStatus: '已手动校对',
        bets
      }),
      editorVisible: false,
      editingBetIndex: -1,
      editorDirty: false
    });
    wx.showToast({ title: '号码已更新', icon: 'success' });
  },

  noop() {},

  // 确认存档
  onSave() {
    if (this.data.saving || !this.data.ocr) return;
    const { ocr } = this.data;
    const lotteryType = ocr.lotteryType || (ocr.lotteryName === '大乐透' ? 'dlt' : 'ssq');
    const totalAmount = (ocr.bets || []).reduce((sum, item) => sum + (Number(item.mult) || 1) * 200, 0);
    const period = String(ocr.period || '').replace(/\D/g, '');

    this.setData({ saving: true });
    api.saveTicket({
      lotteryType,
      period,
      // 票面开奖日期（OCR 识别）：不传则后端按期号推算，可能把录入时间/下一开奖日当开奖日
      drawDate: ocr.drawDate || '',
      bets: ocr.bets,
      multiplier: ocr.multiplier,
      totalAmount
    })
      .then(() => {
        this.setData({ saving: false });
        wx.showToast({ title: '已存档', icon: 'success' });
        setTimeout(() => {
          wx.switchTab({ url: '/pages/home/home' });
        }, 900);
      })
      .catch(() => {
        this.setData({ saving: false });
        wx.showToast({ title: '存档失败，请重试', icon: 'none' });
      });
  }
});
