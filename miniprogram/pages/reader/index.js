Page({
  data: {
    article: {
      title: '',
      content: '',
      author: '',
      date: '',
    },
    fontSize: 16,
    bgColor: '#f5f1e8',
    loading: true,
  },

  onLoad(options) {
    // 如果通过导航传入了文章参数，可在此接收
    if (options.title) {
      this.setData({
        'article.title': options.title,
      });
    }
    this.loadArticle();
  },

  loadArticle() {
    // 示例文章数据，实际可从云数据库或 API 获取
    this.setData({
      article: {
        title: '示例文章标题',
        author: '作者',
        date: new Date().toLocaleDateString(),
        content: '这是一篇示例文章的内容。你可以在这里替换为实际的阅读内容。\n\n微信小程序阅读器支持自定义字体大小和背景颜色，提供舒适的阅读体验。',
      },
      loading: false,
    });
  },

  increaseFont() {
    if (this.data.fontSize < 24) {
      this.setData({ fontSize: this.data.fontSize + 1 });
    }
  },

  decreaseFont() {
    if (this.data.fontSize > 12) {
      this.setData({ fontSize: this.data.fontSize - 1 });
    }
  },

  changeBgColor(e) {
    const color = e.currentTarget.dataset.color;
    this.setData({ bgColor: color });
  },
});
