const READER_BASE_URL = 'https://cloud1-d7gomttv5c8fdacc9-1325686913.ap-shanghai.app.tcloudbase.com/pdfReader';

const ROLE_CONFIG = {
  ben: { name: '学生', icon: '🎓', desc: '通俗讲解' },
  alice: { name: '研究者', icon: '🔬', desc: '深度分析' },
  david: { name: '职场', icon: '💼', desc: '商业洞察' },
};

Page({
  data: {
    status: 'empty',
    fileName: '',
    pdfWebViewUrl: '',
    fileID: '',

    // 摘要
    activeRole: 'ben',
    roles: ROLE_CONFIG,
    summary: null,
    summaryText: '',
    paperInfo: null,
    summaryLoading: false,
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 });
    }
    const app = getApp();
    const file = app.globalData.pendingFile;
    if (file) {
      app.globalData.pendingFile = null;
      this.openPdf(file.filePath, file.fileName);
    }
  },

  onSelectFile() {
    const that = this;
    wx.showModal({
      title: '选择论文',
      content: '目前仅支持 PDF 格式。请先将论文文件发送到微信聊天，再从这里选择。',
      confirmText: '选择文件',
      success(res) {
        if (res.confirm) that.openFilePicker();
      },
    });
  },

  openFilePicker() {
    const that = this;
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['pdf'],
      success(res) {
        that.openPdf(res.tempFiles[0].path, res.tempFiles[0].name);
      },
      fail(err) {
        if (err.errMsg.indexOf('cancel') === -1) {
          wx.showToast({ title: '选择文件失败，请重试', icon: 'none' });
        }
      },
    });
  },

  openPdf(filePath, fileName) {
    this.setData({
      status: 'uploading',
      fileName: fileName,
      summary: null,
      summaryText: '',
      paperInfo: null,
    });
    const that = this;

    wx.cloud.uploadFile({
      cloudPath: 'papers/' + Date.now() + '_' + fileName,
      filePath: filePath,
      success: (res) => {
        that.setData({ fileID: res.fileID });
        // 上传完成后自动生成摘要
        that.generateSummary(res.fileID, fileName, 'ben');
      },
      fail: (err) => {
        console.error('上传 PDF 失败:', err);
        wx.showToast({ title: '上传失败，请重试', icon: 'none' });
        that.setData({ status: 'empty' });
      },
    });
  },

  // ========== AI 摘要生成 ==========
  generateSummary(fileID, fileName, role) {
    this.setData({ status: 'analyzing', summaryLoading: true });

    const that = this;
    wx.cloud.callFunction({
      name: 'pdfSummary',
      data: {
        action: 'generate',
        fileID: fileID,
        fileName: fileName,
        role: role,
      },
      success: (res) => {
        if (res.result && res.result.success) {
          const summary = res.result.summary;
          that.setData({
            status: 'summarized',
            summary: summary,
            summaryText: typeof summary === 'string' ? summary : summary.text,
            paperInfo: res.result.paperInfo || {},
            summaryLoading: false,
            activeRole: role,
          });
        } else {
          wx.showToast({
            title: '摘要生成失败: ' + (res.result ? res.result.errMsg : '未知错误'),
            icon: 'none',
            duration: 3000,
          });
          // 失败也允许阅读
          that.setData({ status: 'summarized', summaryLoading: false });
        }
      },
      fail: (err) => {
        console.error('云函数调用失败:', err);
        wx.showToast({ title: '摘要服务暂不可用，可直接阅读', icon: 'none', duration: 2500 });
        that.setData({ status: 'summarized', summaryLoading: false });
      },
    });
  },

  // 切换角色重新生成
  onRoleChange(e) {
    const role = e.currentTarget.dataset.role;
    if (role === this.data.activeRole) return;

    const { fileID, fileName } = this.data;
    if (fileID) {
      this.generateSummary(fileID, fileName, role);
    }
  },

  // 进入阅读
  onStartRead() {
    const { fileID } = this.data;
    if (!fileID) return;

    const readerUrl = READER_BASE_URL + '?fileID=' + encodeURIComponent(fileID);
    this.setData({
      status: 'reading',
      pdfWebViewUrl: readerUrl,
    });
  },

  // 从阅读返回摘要
  onBackToSummary() {
    this.setData({ status: 'summarized', pdfWebViewUrl: '' });
  },

  onToolTap(e) {
    wx.showToast({ title: '功能开发中', icon: 'none' });
  },
});
