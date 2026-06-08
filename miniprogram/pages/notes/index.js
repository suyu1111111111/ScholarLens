Page({
  data: {
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
            excerpt: n.excerpt || '',
            annotation: n.annotation || '',
            date: that.formatDate(n.createdAt),
            source: n.fileName || '未命名',
            color: n.color || '#1a73e8',
            type: n.type || 'note',
            page: n.page,
            createdAt: n.createdAt,
          }));
          that.setData({ notes: notes, loading: false }, () => {
            that.applyFilter();
          });
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

  onSearchInput(e) {
    this.setData({ searchKeyword: e.detail.value.trim() });
    this.applyFilter();
  },

  applyFilter() {
    let { notes, searchKeyword } = this.data;

    if (searchKeyword) {
      const kw = searchKeyword.toLowerCase();
      notes = notes.filter(
        (n) =>
          n.excerpt.toLowerCase().includes(kw) ||
          n.annotation.toLowerCase().includes(kw) ||
          n.source.toLowerCase().includes(kw)
      );
    }

    // 按论文分组，每篇论文一条记录
    const map = {};
    notes.forEach((n) => {
      const key = n.source;
      if (!map[key]) {
        map[key] = {
          source: key,
          fileID: n.fileID,
          notes: [],
          hasNote: false,
          hasAnnotate: false,
          expanded: false,
        };
      }
      map[key].notes.push(n);
      if (n.type === 'annotate') map[key].hasAnnotate = true;
      if (n.type === 'note') map[key].hasNote = true;
    });
    this.setData({ groupedNotes: Object.values(map) });
  },

  onTogglePaper(e) {
    const source = e.currentTarget.dataset.source;
    const grouped = this.data.groupedNotes.map((g) => {
      if (g.source === source) g.expanded = !g.expanded;
      return g;
    });
    this.setData({ groupedNotes: grouped });
  },

  onNoteNavigate(e) {
    const { fileid, page, source, type: noteType } = e.currentTarget.dataset;
    if (!fileid) return;
    const app = getApp();
    app.globalData.openFileID = fileid;
    // 只有批注类型才有有效页码，普通笔记不跳转到特定页
    if (noteType === 'annotate') {
      const pageNum = parseInt(page);
      app.globalData.targetNotePage = isNaN(pageNum) ? -1 : pageNum;
    } else {
      app.globalData.targetNotePage = -1;
    }
    wx.switchTab({ url: '/pages/reader/reader' });
  },

  onDeleteNote(e) {
    const { id, fileid } = e.currentTarget.dataset;
    const that = this;
    wx.showModal({
      title: '删除笔记',
      content: '确定删除这条笔记？',
      confirmColor: '#e54545',
      success: (res) => {
        if (res.confirm) that.deleteNote(id, fileid);
      },
    });
  },

  deleteNote(noteId, fileID) {
    const that = this;
    wx.cloud.callFunction({
      name: 'pdfSummary',
      data: { action: 'noteDelete', noteId: noteId, fileID: fileID },
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
