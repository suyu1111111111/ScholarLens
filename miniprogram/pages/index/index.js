Page({
  data: {
    searchKeyword: '',
    showFilter: false,
    filterDate: 'all',
    filterTag: 'all',
    recentList: [],
    filteredList: [],
    loading: true,
    emptyType: 'noRecord',
    searchMode: 'local',
    searchPapers: [],
    searchingOnline: false,
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 });
    }
    this.fetchRecentList();
  },

  onSearchModeSwitch() {
    const mode = this.data.searchMode === 'local' ? 'online' : 'local';
    this.setData({ searchMode: mode, searchPapers: [] });
    if (mode === 'online' && this.data.searchKeyword) {
      this.searchOnline();
    }
  },

  fetchRecentList() {
    const that = this;
    wx.cloud.callFunction({
      name: 'pdfSummary',
      data: { action: 'list' },
      success: (res) => {
        if (res.result && res.result.success) {
          const list = (res.result.list || []).map((doc) => ({
            id: doc._id,
            fileID: doc.fileID,
            title: doc.fileName || '未命名论文',
            date: that.formatDate(doc.createdAt),
            progress: (doc.paperInfo && doc.paperInfo.pageCount && doc.paperInfo.progress != null) ? Math.min(100, Math.max(1, Math.round(doc.paperInfo.progress / doc.paperInfo.pageCount * 100))) : 0,
            pageCount: doc.paperInfo ? doc.paperInfo.pageCount : 0,
            tags: doc.tags || [],
            isFavorite: doc.isFavorite || false,
          }));
          that.setData({ recentList: list, loading: false, emptyType: 'noRecord' });
          that.applyFilters();
        } else {
          that.setData({ loading: false, emptyType: 'noRecord' });
        }
      },
      fail: () => {
        that.setData({ loading: false, emptyType: 'noRecord' });
      },
    });
  },

  formatDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const now = new Date();
    const diff = now - d;
    if (diff < 86400000) return '今天';
    if (diff < 2 * 86400000) return '昨天';
    if (diff < 7 * 86400000) return Math.floor(diff / 86400000) + '天前';
    const m = d.getMonth() + 1;
    const day = d.getDate();
    return m + '月' + day + '日';
  },

  onSearchInput(e) {
    const keyword = e.detail.value.trim();
    this.setData({ searchKeyword: keyword });
    if (this.data.searchMode === 'online') {
      if (keyword) {
        this.debounceSearch(keyword);
      } else {
        this.setData({ searchPapers: [] });
      }
    } else {
      this.applyFilters();
    }
  },

  debounceSearch: null,
  doDebounceSearch(keyword) {
    if (this.debounceSearch) clearTimeout(this.debounceSearch);
    const that = this;
    this.debounceSearch = setTimeout(() => {
      that.searchOnline();
    }, 500);
  },

  searchOnline() {
    const keyword = this.data.searchKeyword.trim();
    if (!keyword) return;
    this.setData({ searchingOnline: true });
    const that = this;
    wx.cloud.callFunction({
      name: 'pdfSummary',
      data: { action: 'searchPapers', query: keyword },
      success: (res) => {
        if (res.result && res.result.success) {
          that.setData({ searchPapers: res.result.papers || [], searchingOnline: false });
        } else {
          that.setData({ searchPapers: [], searchingOnline: false });
        }
      },
      fail: () => {
        wx.showToast({ title: '搜索服务暂不可用', icon: 'none' });
        that.setData({ searchPapers: [], searchingOnline: false });
      },
    });
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
    wx.showActionSheet({
      itemList: ['上传单篇论文', '批量上传（最多 9 篇）'],
      success(res) {
        that.openFilePicker(res.tapIndex === 1 ? 9 : 1);
      },
    });
  },

  openFilePicker(count) {
    const that = this;
    wx.chooseMessageFile({
      count: count,
      type: 'file',
      extension: ['pdf'],
      success(res) {
        const files = res.tempFiles;
        if (files.length === 1) {
          const app = getApp();
          app.globalData.pendingFile = {
            filePath: files[0].path,
            fileName: files[0].name,
          };
          wx.switchTab({ url: '/pages/reader/reader' });
        } else {
          that.batchUpload(files);
        }
      },
      fail(err) {
        if (err.errMsg.indexOf('cancel') === -1) {
          wx.showToast({ title: '选择文件失败，请重试', icon: 'none' });
        }
      },
    });
  },

  batchUpload(files) {
    const that = this;
    const total = files.length;
    let done = 0;
    const results = [];

    wx.showLoading({ title: '上传中 0/' + total });

    function uploadNext(i) {
      if (i >= total) {
        wx.hideLoading();
        wx.showToast({ title: '已上传 ' + total + ' 篇论文', icon: 'success' });
        const app = getApp();
        app.globalData.pendingFile = {
          filePath: results[0].fileID,
          fileName: files[0].name,
          batchUpload: true,
        };
        app.globalData.batchFiles = results;
        wx.switchTab({ url: '/pages/reader/reader' });
        return;
      }

      wx.cloud.uploadFile({
        cloudPath: 'papers/' + Date.now() + '_' + files[i].name,
        filePath: files[i].path,
        success: (res) => {
          done++;
          wx.showLoading({ title: '上传中 ' + done + '/' + total });
          results.push({ fileID: res.fileID, fileName: files[i].name });
          uploadNext(i + 1);
        },
        fail: () => {
          done++;
          wx.showLoading({ title: '上传中 ' + done + '/' + total });
          uploadNext(i + 1);
        },
      });
    }

    uploadNext(0);
  },

  onCardTap(e) {
    const { fileid } = e.currentTarget.dataset;
    if (fileid) {
      const app = getApp();
      app.globalData.openFileID = fileid;
      wx.switchTab({ url: '/pages/reader/reader' });
    }
  },

  onDownloadPaper(e) {
    const { url, title } = e.currentTarget.dataset;
    if (!url) {
      wx.showToast({ title: '该论文无可下载 PDF', icon: 'none' });
      return;
    }
    const that = this;
    wx.showLoading({ title: '下载中...' });
    wx.cloud.callFunction({
      name: 'pdfSummary',
      data: { action: 'downloadPaper', pdfUrl: url, fileName: title },
      success: (res) => {
        wx.hideLoading();
        if (res.result && res.result.success) {
          const app = getApp();
          app.globalData.openFileID = res.result.fileID;
          wx.switchTab({ url: '/pages/reader/reader' });
        } else {
          wx.showToast({ title: '下载失败，请手动上传', icon: 'none' });
        }
      },
      fail: () => {
        wx.hideLoading();
        wx.showToast({ title: '下载失败，请手动上传', icon: 'none' });
      },
    });
  },

  onViewAll() {
    wx.switchTab({ url: '/pages/reader/reader' });
  },
});
