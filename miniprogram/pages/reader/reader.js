// HTTP 访问服务地址
const READER_BASE_URL = 'https://cloud1-d7gomttv5c8fdacc9-1325686913.ap-shanghai.app.tcloudbase.com/pdfReader';

Page({
  data: {
    status: 'empty',
    fileName: '',
    pdfWebViewUrl: '',
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
    this.setData({ status: 'uploading', fileName: fileName });
    const that = this;

    // 1. 上传 PDF 到云存储
    wx.cloud.uploadFile({
      cloudPath: 'papers/' + Date.now() + '_' + fileName,
      filePath: filePath,
      success: (res) => {
        // 2. 云函数通过 fileID 从云存储下载 PDF，嵌入 HTML，返回完整页面
        const readerUrl = READER_BASE_URL + '?fileID=' + encodeURIComponent(res.fileID);
        that.setData({ status: 'ready', pdfWebViewUrl: readerUrl });
      },
      fail: (err) => {
        console.error('上传 PDF 失败:', err);
        wx.showToast({ title: '上传失败，请重试', icon: 'none' });
        that.setData({ status: 'empty' });
      },
    });
  },

  onToolTap(e) {
    wx.showToast({ title: '功能开发中', icon: 'none' });
  },
});
