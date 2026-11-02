/**
 * pages/init/init.js - 首次配置页（Screen1）
 * 优先彩票种类 / 性别 / 默认推演模式均为单选；完成后写入 storage 并进入首页
 */
const api = require('../../utils/api');

function normalizeLotteryType(value, fallback) {
  if (typeof value === 'string' && value) {
    return value;
  }
  if (Array.isArray(value) && value.length) {
    return value[0];
  }
  return fallback;
}

function buildLotterySelectedMap(type) {
  return {
    ssq: type === 'ssq',
    dlt: type === 'dlt'
  };
}

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    maxBirthDate: '',
    lotteryOptions: [
      { label: '双色球', value: 'ssq' },
      { label: '大乐透', value: 'dlt' }
    ],
    lotteryType: 'ssq',
    lotterySelectedMap: {
      ssq: true,
      dlt: false
    },
    name: '',
    birth: '2000-01-15',
    genderOptions: [
      { label: '男', value: 'male' },
      { label: '女', value: 'female' }
    ],
    gender: 'male',
    systemOptions: [
      { label: '星座占星', value: 'astrology' },
      { label: '五行推命', value: 'iching' }
    ],
    system: 'astrology'
  },

  onLoad() {
    // 注入胶囊对齐导航参数
    const app = getApp();
    const today = new Date();
    const maxBirthDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight,
      navBarHeight: app.globalData.navBarHeight,
      maxBirthDate
    });

    // 若已配置过，回填已存配置
    const saved = wx.getStorageSync('userConfig');
    if (saved) {
      const normalizedLotteryType = normalizeLotteryType(saved.lotteryType || saved.lotteryTypes, this.data.lotteryType);
      this.setData({
        lotteryType: normalizedLotteryType,
        lotterySelectedMap: buildLotterySelectedMap(normalizedLotteryType),
        name: saved.name || '',
        birth: saved.birth || this.data.birth,
        gender: saved.gender || this.data.gender,
        system: saved.divinationSystem || this.data.system
      });
    } else {
      this.setData({
        lotterySelectedMap: buildLotterySelectedMap(this.data.lotteryType)
      });
    }
  },

  // 优先彩票种类单选
  selectLottery(e) {
    const value = e.currentTarget.dataset.value;
    if (!value || value === this.data.lotteryType) return;
    this.setData({
      lotteryType: value,
      lotterySelectedMap: buildLotterySelectedMap(value)
    });
  },

  onNameInput(e) {
    this.setData({ name: e.detail.value });
  },

  onBirthChange(e) {
    this.setData({ birth: e.detail.value });
  },

  selectGender(e) {
    this.setData({ gender: e.currentTarget.dataset.value });
  },

  selectSystem(e) {
    this.setData({ system: e.currentTarget.dataset.value });
  },

  onSubmit() {
    const { lotteryType, name, birth, gender, system } = this.data;
    if (!lotteryType) {
      wx.showToast({ title: '请选择优先彩票种类', icon: 'none' });
      return;
    }
    if (!name.trim()) {
      wx.showToast({ title: '请输入姓名', icon: 'none' });
      return;
    }
    if (!birth) {
      wx.showToast({ title: '请选择出生日期', icon: 'none' });
      return;
    }

    const userConfig = {
      lotteryType,
      lotteryTypes: [lotteryType],
      name,
      birth,
      gender,
      divinationSystem: system
    };

    wx.showLoading({ title: '保存中...', mask: true });
    api.saveUserConfig(userConfig)
      .then(() => {
        wx.hideLoading();
        wx.setStorageSync('userConfig', userConfig);
        getApp().globalData.userConfig = userConfig;
        wx.showToast({ title: '配置完成', icon: 'success', duration: 600 });
        setTimeout(() => {
          wx.switchTab({ url: '/pages/home/home' });
        }, 650);
      })
      .catch(() => {
        wx.hideLoading();
        wx.showToast({ title: '保存失败，请重试', icon: 'none' });
      });
  }
});
