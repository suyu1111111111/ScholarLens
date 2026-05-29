Component({
  data: {
    selected: 0,
    list: [
      { pagePath: "/pages/index/index", text: "首页", icon: "🏠" },
      { pagePath: "/pages/reader/reader", text: "阅读器", icon: "📖" },
      { pagePath: "/pages/notes/index", text: "笔记", icon: "📝" },
      { pagePath: "/pages/me/index", text: "我的", icon: "👤" },
    ],
  },
  methods: {
    switchTab(e) {
      const index = e.currentTarget.dataset.index;
      const item = this.data.list[index];
      wx.switchTab({ url: item.pagePath });
    },
  },
});
