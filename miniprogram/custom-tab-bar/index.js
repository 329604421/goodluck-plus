/**
 * custom-tab-bar/index.js
 * 底部胶囊导航（设计稿：白底圆角36 胶囊内 4 个 tab，激活项黑底圆角32）
 *
 * 2026-09-15：「推荐」→「附近」只替换 tabBar 入口这一层。
 *   - pages/recommend/* 代码保留不删、app.json.pages 保留注册，改回 4 行配置即可回退
 *   - 后端 POST /api/recommend 与眼镜端推荐页均不受影响（详见需求文档 §3.7）
 *
 * backdrop：胶囊下方的毛玻璃渐变浮层。
 *   组件按页实例化，各 tab 页持有自己的副本 → 页面可单独覆盖。
 *   默认 true（首页 / 录入 / 台账保持原样）；「附近」页是地图底图，浮层会与
 *   地图瓦片糊在一起，由 nearby.js 的 updateTabBar 单独置 false（需求 §3.2.3）。
 */
Component({
  data: {
    selected: 0,
    hidden: false,
    backdrop: true,
    list: [
      { pagePath: '/pages/home/home', text: '首页', icon: 'home' },
      { pagePath: '/pages/record/record', text: '录入', icon: 'scanning' },
      { pagePath: '/pages/nearby/nearby', text: '附近', icon: 'local' },
      { pagePath: '/pages/ledger/ledger', text: '台账', icon: 'bill' }
    ]
  },
  methods: {
    switchTab(e) {
      const { index, path } = e.currentTarget.dataset;
      if (index === this.data.selected) return;
      wx.switchTab({ url: path });
    }
  }
});
