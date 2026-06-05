Page({
  data: {
    currentTab: 'all',
    searchKeyword: '',
    notes: [],
    groupedNotes: [],
    loading: true,
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2 });
    }
    this.fetchNotes();
  },

  fetchNotes() {
    const that = this;
    wx.cloud.callFunction({
      name: 'pdfSummary',
      data: { action: 'noteList' },
      success: (res) => {
        if (res.result && res.result.success) {
          const notes = (res.result.list || []).map((n) => ({
            id: n._id,
            fileID: n.fileID,
            excerpt: n.excerpt,
            annotation: n.annotation,
            date: that.formatDate(n.createdAt),
            source: n.fileName || '未命名',
            color: n.color || '#1a73e8',
            createdAt: n.createdAt,
          }));
          that.setData({ notes, loading: false });
          that.applyFilter();
        } else {
          that.setData({ notes: [], loading: false });
        }
      },
      fail: () => {
        that.setData({ notes: [], loading: false });
      },
    });
  },

  formatDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const now = new Date();
    const diff = now - d;
    if (diff < 86400000) return '今天';
    if (diff < 7 * 86400000) return Math.ceil(diff / 86400000) + '天前';
    const m = d.getMonth() + 1;
    return m + '月' + d.getDate() + '日';
  },

  onSwitchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({ currentTab: tab });
    this.applyFilter();
  },

  onSearchInput(e) {
    this.setData({ searchKeyword: e.detail.value.trim() });
    this.applyFilter();
  },

  applyFilter() {
    let { notes, currentTab, searchKeyword } = this.data;

    if (currentTab === 'paper') {
      const map = {};
      notes.forEach((n) => {
        const key = n.source;
        if (!map[key]) map[key] = { source: key, notes: [], color: n.color };
        map[key].notes.push(n);
      });
      this.setData({ groupedNotes: Object.values(map) });
      return;
    }

    if (searchKeyword) {
      const kw = searchKeyword.toLowerCase();
      notes = notes.filter(
        (n) =>
          n.excerpt.toLowerCase().includes(kw) ||
          n.annotation.toLowerCase().includes(kw) ||
          n.source.toLowerCase().includes(kw)
      );
    }

    this.setData({ notes: notes, groupedNotes: [] });
  },

  onNoteTap(e) {
    const { id } = e.currentTarget.dataset;
    wx.showActionSheet({
      itemList: ['删除笔记'],
      itemColor: '#e54545',
      success: (res) => {
        if (res.tapIndex === 0) this.deleteNote(id);
      },
    });
  },

  deleteNote(noteId) {
    const that = this;
    wx.cloud.callFunction({
      name: 'pdfSummary',
      data: { action: 'noteDelete', noteId: noteId },
      success: () => {
        wx.showToast({ title: '已删除', icon: 'none' });
        that.fetchNotes();
      },
      fail: () => {
        wx.showToast({ title: '删除失败', icon: 'none' });
      },
    });
  },

  onGoRead() {
    wx.switchTab({ url: '/pages/reader/reader' });
  },
});
