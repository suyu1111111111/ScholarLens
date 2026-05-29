Page({
  data: {
    currentTab: 'all',
    notes: [
      {
        id: 1,
        color: '#e54545',
        excerpt: '深度学习模型在自然语言处理任务中表现出色，尤其是基于 Transformer 架构的预训练语言模型。',
        annotation: '核心观点：Transformer 是当前 NLP 的基础架构。',
        date: '2026-05-18',
        source: 'Attention Is All You Need',
      },
    ],
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2 });
    }
  },

  onSwitchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({ currentTab: tab });
  },

  onGoRead() {
    wx.switchTab({ url: '/pages/reader/reader' });
  },
})
