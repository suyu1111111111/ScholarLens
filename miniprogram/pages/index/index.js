Page({
  data: {
    searchKeyword: '',
    showFilter: false,
    filterDate: 'all',
    filterTag: 'all',
    recentList: [],
    filteredList: [],
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 });
    }
  },

  onSearchInput(e) {
    const keyword = e.detail.value.trim().toLowerCase();
    this.setData({ searchKeyword: keyword });
    this.applyFilters();
  },

  onToggleFilter() {
    this.setData({ showFilter: !this.data.showFilter });
  },

  onFilterChange(e) {
    const { key, value } = e.currentTarget.dataset;
    this.setData({ [key]: value });
    this.applyFilters();
  },

  applyFilters() {
    const { recentList, searchKeyword, filterDate, filterTag } = this.data;
    let list = recentList.slice();

    if (searchKeyword) {
      list = list.filter(
        (item) =>
          item.title.toLowerCase().includes(searchKeyword) ||
          (item.tags || []).some((t) => t.toLowerCase().includes(searchKeyword))
      );
    }

    if (filterDate !== 'all') {
      const now = Date.now();
      const range = filterDate === 'week' ? 7 * 86400000 : 30 * 86400000;
      list = list.filter(
        (item) => now - new Date(item.date).getTime() < range
      );
    }

    if (filterTag !== 'all') {
      list = list.filter((item) =>
        (item.tags || []).includes(filterTag)
      );
    }

    this.setData({ filteredList: list });
  },

  onUploadPaper() {
    const that = this;
    wx.showModal({
      title: '上传论文',
      content: '目前仅支持 PDF 格式。请先将论文文件发送到微信聊天，再从这里选择。',
      confirmText: '选择文件',
      success(res) {
        if (res.confirm) {
          that.openFilePicker();
        }
      },
    });
  },

  openFilePicker() {
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['pdf'],
      success(res) {
        const file = res.tempFiles[0];
        const app = getApp();
        app.globalData.pendingFile = {
          filePath: file.path,
          fileName: file.name,
        };
        wx.switchTab({ url: '/pages/reader/reader' });
      },
      fail(err) {
        if (err.errMsg.indexOf('cancel') === -1) {
          wx.showToast({ title: '选择文件失败，请重试', icon: 'none' });
        }
      },
    });
  },

  onViewAll() {
    wx.switchTab({ url: '/pages/notes/index' });
  },
});
