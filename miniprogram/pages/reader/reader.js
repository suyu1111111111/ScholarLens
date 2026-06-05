const ROLE_CONFIG = {
  ben: { name: '学生', icon: '🎓', desc: '通俗讲解' },
  alice: { name: '研究者', icon: '🔬', desc: '深度分析' },
  david: { name: '职场', icon: '💼', desc: '商业洞察' },
};

Page({
  data: {
    status: 'empty',
    fileName: '',
    fileID: '',
    // 摘要
    activeRole: 'ben',
    roles: ROLE_CONFIG,
    summary: null,
    summaryText: '',
    paperInfo: null,
    summaryLoading: false,
    summaryError: '',

    // 思维导图
    showMindmap: false,
    mindmapTree: [],
    mindmapLoading: false,

    // 论文管理
    docTags: [],
    isFavorite: false,
    showTagInput: false,
    tagInputValue: '',

    // 笔记
    showNoteModal: false,
    noteExcerpt: '',
    noteAnnotation: '',
  },

  onLoad(options) {
    if (options && options.fileID) {
      this.loadExistingDoc(options.fileID);
    }
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
      return;
    }
    const openFileID = app.globalData.openFileID;
    if (openFileID) {
      app.globalData.openFileID = null;
      this.loadExistingDoc(openFileID);
    }
    // 控制分享菜单
    if (this.data.fileID && this.data.status === 'summarized') {
      wx.showShareMenu({ withShareTicket: false, menus: ['shareAppMessage', 'shareTimeline'] });
    }
  },

  onShareAppMessage() {
    const { fileName, summaryText, fileID, activeRole, roles } = this.data;
    const roleName = roles[activeRole] ? roles[activeRole].name : '';
    return {
      title: fileName,
      path: '/pages/reader/reader?fileID=' + encodeURIComponent(fileID),
      imageUrl: '',
    };
  },

  onShareTimeline() {
    const { fileName, summaryText, fileID } = this.data;
    const snippet = summaryText ? summaryText.substring(0, 50) + '...' : '';
    return {
      title: fileName + (snippet ? ' - ' + snippet : ''),
      query: 'fileID=' + encodeURIComponent(fileID),
    };
  },

  // 从首页卡片加载已有文档
  loadExistingDoc(fileID) {
    const that = this;
    this.setData({ status: 'summarized', fileID: fileID, summaryText: '', summaryError: '' });

    wx.cloud.callFunction({
      name: 'pdfSummary',
      data: { action: 'get', fileID: fileID },
      success: (res) => {
        if (res.result && res.result.success && res.result.summaries) {
          const roles = res.result.summaries;
          const firstRole = Object.keys(roles)[0] || 'ben';
          const summary = roles[firstRole];
          that.setData({
            summary: summary,
            summaryText: typeof summary === 'string' ? summary : summary.text,
            paperInfo: res.result.paperInfo || {},
            docTags: res.result.tags || [],
            isFavorite: res.result.isFavorite || false,
            activeRole: firstRole,
          });
        }
      },
    });
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
    // 保存本地文件路径，供离线阅读使用
    this._localFilePath = filePath;
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
        const fileID = res.fileID;
        that.setData({ status: 'summarized', fileID: fileID });
      },
      fail: (err) => {
        console.error('上传 PDF 失败:', err);
        wx.showToast({ title: '上传失败，请重试', icon: 'none' });
        that.setData({ status: 'empty' });
      },
    });
  },

  // ========== 错误信息转义 ==========
  translateError(raw) {
    const map = {
      '扫描版': '该 PDF 为扫描版（图片型），无法提取文字。请使用文字型 PDF（如直接从 arXiv 下载的论文）。',
      'AI_API_KEY': 'AI 服务密钥未配置，请先在云函数环境变量中设置 API Key',
      'collection not exists': '数据库集合未创建，请重新部署云函数',
      'ResourceNotFound': '云资源未找到，请检查云函数是否已部署',
      'timeout': 'AI 响应超时，论文篇幅较长，请稍后重试',
      'Invalid JSON': 'AI 返回异常，请重试',
      'Rate limit': '请求过于频繁，请稍等片刻再试',
      'pdf-parse': 'PDF 文本提取失败，该文件可能是扫描版或不支持格式',
      'ECONNREFUSED': '网络连接失败，请检查网络后重试',
      'ENOTFOUND': '无法连接 AI 服务，请检查网络',
    };
    for (const key in map) {
      if (raw.indexOf(key) !== -1) return map[key];
    }
    return raw;
  },

  // ========== AI 摘要生成 ==========
  generateSummary(fileID, fileName, role) {
    this.setData({ summaryLoading: true, summaryError: '', summaryText: '' });

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
            summaryError: '',
            activeRole: role,
          });
        } else {
          const raw = res.result ? res.result.errMsg : '未知错误';
          that.setData({
            status: 'summarized',
            summaryError: that.translateError(raw),
            summaryLoading: false,
            activeRole: role,
          });
        }
      },
      fail: (err) => {
        console.error('云函数调用失败:', err);
        that.setData({
          status: 'summarized',
          summaryError: that.translateError(err.errMsg || JSON.stringify(err)),
          summaryLoading: false,
        });
      },
    });
  },

  // 点击角色生成摘要
  onRoleChange(e) {
    const role = e.currentTarget.dataset.role;
    const { fileID, fileName } = this.data;
    if (!fileID) return;
    this.generateSummary(fileID, fileName, role);
  },

  // 开始阅读：用 fileID 调云函数渲染 PDF 页面为图片
  onStartRead() {
    const { fileID, fileName } = this.data;
    if (!fileID) {
      wx.showToast({ title: '文件信息丢失，请重新上传', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '正在渲染页面...', mask: true });
    const app = getApp();
    const that = this;

    // 传 fileID 而非 base64，避免数据量过大超限
    wx.cloud.callFunction({
      name: 'pdfSummary',
      data: { action: 'getPages', fileID: fileID },
      success: (cfRes) => {
        wx.hideLoading();
        if (cfRes.result && cfRes.result.success) {
          app.globalData._pageImages = cfRes.result.pages || [];
          app.globalData._pageCount = cfRes.result.pageCount;
          app.globalData._pdfBase64 = null;
        } else {
          console.error('getPages 返回失败:', cfRes.result);
          app.globalData._pageImages = null;
          app.globalData._pdfBase64 = null;
        }
        that._navigateToRead(fileID, fileName);
      },
      fail: (err) => {
        wx.hideLoading();
        console.error('getPages 调用失败:', err);
        app.globalData._pageImages = null;
        app.globalData._pdfBase64 = null;
        that._navigateToRead(fileID, fileName);
      },
    });
  },

  _navigateToRead(fileID, fileName) {
    wx.navigateTo({
      url: '/pages/read-text/read-text?fileID=' + encodeURIComponent(fileID || '') + '&fileName=' + encodeURIComponent(fileName || ''),
    });
  },

  onToolTap(e) {
    wx.showToast({ title: '功能开发中', icon: 'none' });
  },

  // ========== 思维导图 ==========
  onGenerateMindmap() {
    const { summaryText } = this.data;
    if (!summaryText) {
      wx.showToast({ title: '请先生成摘要', icon: 'none' });
      return;
    }
    this.setData({ mindmapLoading: true, showMindmap: true });
    const that = this;
    wx.cloud.callFunction({
      name: 'pdfSummary',
      data: { action: 'mindmap', summaryText: summaryText },
      success: (res) => {
        if (res.result && res.result.success && res.result.tree) {
          that.setData({ mindmapTree: res.result.tree, mindmapLoading: false });
        } else {
          wx.showToast({ title: '生成失败', icon: 'none' });
          that.setData({ mindmapLoading: false, showMindmap: false });
        }
      },
      fail: () => {
        wx.showToast({ title: '服务不可用', icon: 'none' });
        that.setData({ mindmapLoading: false, showMindmap: false });
      },
    });
  },

  onCloseMindmap() {
    this.setData({ showMindmap: false });
  },

  // ========== 论文管理 ==========
  onToggleFavorite() {
    const { fileID, isFavorite } = this.data;
    const newVal = !isFavorite;
    this.setData({ isFavorite: newVal });
    wx.cloud.callFunction({
      name: 'pdfSummary',
      data: { action: 'updateDoc', fileID: fileID, isFavorite: newVal },
    });
  },

  onToggleTagInput() {
    this.setData({ showTagInput: !this.data.showTagInput, tagInputValue: '' });
  },

  onTagInput(e) {
    this.setData({ tagInputValue: e.detail.value.trim() });
  },

  onAddTag() {
    const tag = this.data.tagInputValue;
    if (!tag) return;
    const tags = [...this.data.docTags, tag];
    this.setData({ docTags: tags, tagInputValue: '', showTagInput: false });
    this.updateDocTags(tags);
  },

  onRemoveTag(e) {
    const tag = e.currentTarget.dataset.tag;
    const tags = this.data.docTags.filter((t) => t !== tag);
    this.setData({ docTags: tags });
    this.updateDocTags(tags);
  },

  updateDocTags(tags) {
    wx.cloud.callFunction({
      name: 'pdfSummary',
      data: { action: 'updateDoc', fileID: this.data.fileID, tags: tags },
    });
  },

  onDeleteDoc() {
    const that = this;
    wx.showModal({
      title: '删除论文',
      content: '将同时删除该论文的摘要、笔记和云存储文件，确定删除？',
      confirmText: '删除',
      confirmColor: '#e54545',
      success: (res) => {
        if (res.confirm) {
          wx.cloud.callFunction({
            name: 'pdfSummary',
            data: { action: 'deleteDoc', fileID: that.data.fileID },
            success: () => {
              wx.showToast({ title: '已删除', icon: 'success' });
              that.setData({
                status: 'empty', fileID: '', fileName: '', summaryText: '',
                summary: null, paperInfo: null, docTags: [], isFavorite: false,
              });
            },
            fail: () => {
              wx.showToast({ title: '删除失败', icon: 'none' });
            },
          });
        }
      },
    });
  },

  // ========== 导出 ==========
  onExport() {
    if (!this.data.summaryText) {
      wx.showToast({ title: '请先生成摘要', icon: 'none' });
      return;
    }
    this.setData({ showExportMenu: true });
  },

  onCloseExportMenu() {
    this.setData({ showExportMenu: false });
  },

  onCopyMarkdown() {
    const { fileName, activeRole, roles, summaryText } = this.data;
    const roleName = roles[activeRole].name;
    const md = '# ' + fileName + '\n\n> ' + roleName + '视角\n\n' + summaryText.replace(/^/gm, '') + '\n\n---\n*由智阅深析生成*';

    wx.setClipboardData({
      data: md,
      success: () => {
        wx.showToast({ title: '已复制到剪贴板', icon: 'success' });
        this.setData({ showExportMenu: false });
      },
      fail: () => {
        wx.showToast({ title: '复制失败', icon: 'none' });
      },
    });
  },

  onExportImage() {
    const that = this;
    wx.showLoading({ title: '生成中...' });
    wx.createSelectorQuery()
      .select('#exportCanvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res[0] || !res[0].node) {
          // Canvas 2D 不可用，降级为文本分享
          wx.hideLoading();
          that.fallbackShareText();
          return;
        }
        that.drawExportImage(res[0].node);
      });
  },

  drawExportImage(canvas) {
    const that = this;
    const { fileName, activeRole, roles, summaryText } = this.data;
    const roleName = roles[activeRole].name;
    const width = 600;
    const dpr = wx.getSystemInfoSync().pixelRatio;

    canvas.width = width * dpr;
    canvas.height = 800 * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    // 背景
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, 800);

    // 标题
    ctx.fillStyle = '#1a73e8';
    ctx.font = 'bold 24px sans-serif';
    ctx.fillText(fileName, 30, 50);

    // 角色
    ctx.fillStyle = '#666';
    ctx.font = '14px sans-serif';
    ctx.fillText(roleName + '视角', 30, 80);

    // 分隔线
    ctx.strokeStyle = '#eee';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(30, 100);
    ctx.lineTo(570, 100);
    ctx.stroke();

    // 正文（自动换行）
    ctx.fillStyle = '#333';
    ctx.font = '16px sans-serif';
    const maxWidth = 540;
    const lineHeight = 28;
    let y = 130;
    const lines = summaryText.split('\n');
    for (const line of lines) {
      const chunks = that.wrapText(ctx, line, maxWidth);
      for (const chunk of chunks) {
        if (y > 760) {
          ctx.fillStyle = '#999';
          ctx.font = '12px sans-serif';
          ctx.fillText('...(内容过长已截断)', 30, y);
          y = 800;
          break;
        }
        ctx.fillStyle = '#333';
        ctx.font = '16px sans-serif';
        ctx.fillText(chunk, 30, y);
        y += lineHeight;
      }
      if (y > 760) break;
    }

    // 底部
    ctx.fillStyle = '#ccc';
    ctx.font = '11px sans-serif';
    ctx.fillText('由智阅深析生成', 30, 785);

    wx.hideLoading();
    wx.canvasToTempFilePath({
      canvas: canvas,
      success: (res) => {
        wx.showLoading({ title: '保存中...' });
        wx.saveImageToPhotosAlbum({
          filePath: res.tempFilePath,
          success: () => {
            wx.hideLoading();
            wx.showToast({ title: '已保存到相册', icon: 'success' });
          },
          fail: () => {
            wx.hideLoading();
            that.fallbackShareText();
          },
        });
      },
      fail: () => {
        wx.hideLoading();
        that.fallbackShareText();
      },
    });
  },

  wrapText(ctx, text, maxWidth) {
    const chars = text.split('');
    const lines = [];
    let line = '';
    for (const c of chars) {
      const test = line + c;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = c;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    return lines.length ? lines : [''];
  },

  fallbackShareText() {
    const { fileName, summaryText } = this.data;
    wx.setClipboardData({
      data: fileName + '\n\n' + summaryText,
      success: () => {
        wx.showToast({ title: '图片生成失败，已复制文字', icon: 'none', duration: 2000 });
      },
    });
  },

  // ========== 笔记 ==========
  onAddNote() {
    this.setData({ showNoteModal: true, noteExcerpt: '', noteAnnotation: '' });
  },

  onCloseNoteModal() {
    this.setData({ showNoteModal: false });
  },

  onNoteInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ ['note' + field.charAt(0).toUpperCase() + field.slice(1)]: e.detail.value });
  },

  onSaveNote() {
    const { fileID, fileName, noteExcerpt, noteAnnotation } = this.data;
    if (!noteAnnotation.trim() && !noteExcerpt.trim()) {
      wx.showToast({ title: '请至少填写原文引用或批注', icon: 'none' });
      return;
    }
    const that = this;
    wx.cloud.callFunction({
      name: 'pdfSummary',
      data: {
        action: 'noteAdd',
        fileID: fileID,
        fileName: fileName,
        excerpt: noteExcerpt.trim(),
        annotation: noteAnnotation.trim(),
      },
      success: () => {
        wx.showToast({ title: '笔记已保存', icon: 'success' });
        that.setData({ showNoteModal: false });
      },
      fail: () => {
        wx.showToast({ title: '保存失败，请重试', icon: 'none' });
      },
    });
  },
});
