Page({
  data: {
    fileID: '',
    fileName: '',
    paragraphs: [],
    pageParagraphs: [],
    pageImages: [],
    pageAnnotations: [],  // annotations for current page
    loading: true,
    error: '',
    fontSize: 18,
    fontSizes: [14, 16, 18, 20, 22, 24],

    // 分页
    currentPage: 0,
    totalPages: 0,
    viewMode: 'image',

    // 批注工具
    annoTool: 'none',
    annoTools: [
      { name: 'highlight', icon: '▬', label: '高亮' },
      { name: 'underline', icon: 'U̲', label: '下划线' },
      { name: 'pen', icon: '✎', label: '手写' },
      { name: 'text', icon: '💬', label: '文字' },
      { name: 'none', icon: '×', label: '关闭' },
    ],
    annoColor: '#FFEB3B',
    annoColors: ['#FFEB3B', '#A5D6A7', '#90CAF9', '#F48FB1', '#FFCC80'],

    // 段落批注弹窗
    showAnnoModal: false,
    activeParagraphId: '',
    activeParagraphText: '',
    annoInput: '',
    annotations: {},
  },

  // 缓存
  _canvas: null,
  _ctx: null,
  _displayWidth: 0,
  _displayHeight: 0,
  _imgNaturalWidth: 0,
  _imgNaturalHeight: 0,
  _isDrawing: false,
  _startPos: null,
  _currentStroke: null,
  _allAnnotations: [],  // all annotations for this document

  onLoad(options) {
    if (options && options.fileID) {
      this.setData({ fileID: options.fileID, fileName: options.fileName || '' });
      const app = getApp();
      const pageImages = app.globalData._pageImages;

      if (pageImages && pageImages.length) {
        app.globalData._pageImages = null;
        this.setData({
          pageImages: pageImages,
          totalPages: pageImages.length,
          currentPage: 0,
          loading: false,
        });
        // 后台用 fileID 加载文本用于批注
        this._fetchTextForAnnotations(options.fileID);
        this._loadAllAnnotations();
      } else {
        // 无图片，直接用 fileID 加载文本
        this._fetchTextByFileID(options.fileID);
      }
    }
    wx.setNavigationBarTitle({ title: '阅读' });
  },

  // ========== 图片模式：Canvas 初始化 ==========
  onImageLoad() {
    // 图片加载完成，初始化 Canvas 覆盖层
    const that = this;
    wx.createSelectorQuery()
      .select('#page-image')
      .boundingClientRect()
      .exec((imgRes) => {
        if (!imgRes[0]) return;
        that._displayWidth = imgRes[0].width;
        that._displayHeight = imgRes[0].height;

        // 获取图片原始尺寸
        wx.getImageInfo({
          src: that.data.pageImages[that.data.currentPage],
          success: (info) => {
            that._imgNaturalWidth = info.width;
            that._imgNaturalHeight = info.height;
          },
        });

        wx.createSelectorQuery()
          .select('#anno-canvas')
          .fields({ node: true, size: true })
          .exec((canvasRes) => {
            if (!canvasRes[0] || !canvasRes[0].node) return;
            const canvas = canvasRes[0].node;
            const dpr = wx.getSystemInfoSync().pixelRatio;
            canvas.width = that._displayWidth * dpr;
            canvas.height = that._displayHeight * dpr;
            const ctx = canvas.getContext('2d');
            ctx.scale(dpr, dpr);
            that._canvas = canvas;
            that._ctx = ctx;
            that._redrawAnnotations();
          });
      });
  },

  // 翻页时重新初始化 Canvas
  _reinitCanvas() {
    this._canvas = null;
    this._ctx = null;
    const that = this;
    // 等图片加载完成后 onImageLoad 会重新初始化
    setTimeout(() => {
      if (!that._ctx) that.onImageLoad();
    }, 200);
  },

  // ========== 批注工具选择 ==========
  onAnnoToolChange(e) {
    const tool = e.currentTarget.dataset.tool;
    this.setData({ annoTool: tool });
  },

  onAnnoColorChange(e) {
    const color = e.currentTarget.dataset.color;
    this.setData({ annoColor: color });
  },

  // ========== 触摸绘制 ==========
  onAnnoTouchStart(e) {
    if (this.data.annoTool === 'none' || this.data.annoTool === 'text') return;
    const touch = e.touches[0];
    const x = touch.x;
    const y = touch.y;
    this._isDrawing = true;
    this._startPos = { x, y };
    this._currentStroke = [{ x, y }];

    if (this.data.annoTool === 'pen' && this._ctx) {
      this._ctx.strokeStyle = this.data.annoColor;
      this._ctx.lineWidth = 2;
      this._ctx.lineCap = 'round';
      this._ctx.lineJoin = 'round';
      this._ctx.beginPath();
      this._ctx.moveTo(x, y);
    }
  },

  onAnnoTouchMove(e) {
    if (!this._isDrawing || this.data.annoTool === 'none') return;
    const touch = e.touches[0];
    const x = touch.x;
    const y = touch.y;
    this._currentStroke.push({ x, y });

    if (this.data.annoTool === 'pen' && this._ctx) {
      this._ctx.lineTo(x, y);
      this._ctx.stroke();
    }
  },

  onAnnoTouchEnd(e) {
    const tool = this.data.annoTool;
    if (tool === 'none') return;

    if (tool === 'text') {
      // 文字批注：弹出输入框，在点击位置添加批注
      const touch = e.changedTouches[0];
      const pct = this._screenToPercent(touch.x, touch.y);
      this.setData({
        showAnnoModal: true,
        activeParagraphId: 'img:' + this.data.currentPage + ':' + pct.x.toFixed(3) + ':' + pct.y.toFixed(3),
        activeParagraphText: '第' + (this.data.currentPage + 1) + '页 (' + pct.x.toFixed(1) + '%, ' + pct.y.toFixed(1) + '%)',
        annoInput: '',
      });
      return;
    }

    if (!this._isDrawing) return;
    this._isDrawing = false;

    const color = this.data.annoColor;
    const page = this.data.currentPage;
    const start = this._startPos;
    const end = this._currentStroke[this._currentStroke.length - 1] || start;

    let annoData = null;

    if (tool === 'pen') {
      const points = this._currentStroke.map((p) => this._screenToPercent(p.x, p.y));
      annoData = JSON.stringify({ strokes: [{ points }] });
    } else if (tool === 'highlight' || tool === 'underline') {
      const x1 = Math.min(start.x, end.x);
      const y1 = Math.min(start.y, end.y);
      const x2 = Math.max(start.x, end.x);
      const y2 = Math.max(start.y, end.y);
      if (Math.abs(x2 - x1) < 10 && Math.abs(y2 - y1) < 10) return;
      const p1 = this._screenToPercent(x1, y1);
      const p2 = this._screenToPercent(x2, y2);
      annoData = JSON.stringify({
        rects: [{ x: p1.x, y: p1.y, w: p2.x - p1.x, h: p2.y - p1.y }],
      });
    }

    if (annoData) {
      this._saveAnnotation(page, tool, color, annoData);
      this._redrawAnnotations();
    }
  },

  // ========== 坐标转换 ==========
  _screenToPercent(sx, sy) {
    return {
      x: this._displayWidth > 0 ? sx / this._displayWidth : 0,
      y: this._displayHeight > 0 ? sy / this._displayHeight : 0,
    };
  },

  _percentToScreen(px, py) {
    return {
      x: px * this._displayWidth,
      y: py * this._displayHeight,
    };
  },

  // ========== Canvas 绘制 ==========
  _redrawAnnotations() {
    const ctx = this._ctx;
    if (!ctx) return;
    const dw = this._displayWidth;
    const dh = this._displayHeight;
    ctx.clearRect(0, 0, dw, dh);

    // 筛选当前页的绘制型批注
    const page = this.data.currentPage;
    const annos = this._allAnnotations.filter((a) => a.page === page);
    annos.forEach((a) => {
      if (!a.annoData) return;
      try {
        const data = JSON.parse(a.annoData);
        const color = a.color || '#FFEB3B';
        if (data.rects && a.annoType === 'highlight') {
          data.rects.forEach((r) => this._drawHighlight(ctx, r, color));
        } else if (data.rects && a.annoType === 'underline') {
          data.rects.forEach((r) => this._drawUnderline(ctx, r, color));
        } else if (data.strokes && a.annoType === 'pen') {
          data.strokes.forEach((s) => this._drawStrokes(ctx, s, color));
        }
      } catch (e) {}
    });
  },

  _drawHighlight(ctx, rect, color) {
    const p = this._percentToScreen(rect.x, rect.y);
    const w = rect.w * this._displayWidth;
    const h = rect.h * this._displayHeight;
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.35;
    ctx.fillRect(p.x, p.y, w, h);
    ctx.globalAlpha = 1;
  },

  _drawUnderline(ctx, rect, color) {
    const p = this._percentToScreen(rect.x, rect.y);
    const w = rect.w * this._displayWidth;
    const h = rect.h * this._displayHeight;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y + h);
    ctx.lineTo(p.x + w, p.y + h);
    ctx.stroke();
  },

  _drawStrokes(ctx, stroke, color) {
    if (!stroke.points || stroke.points.length < 2) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    const first = this._percentToScreen(stroke.points[0].x, stroke.points[0].y);
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < stroke.points.length; i++) {
      const pt = this._percentToScreen(stroke.points[i].x, stroke.points[i].y);
      ctx.lineTo(pt.x, pt.y);
    }
    ctx.stroke();
  },

  // ========== 批注存储 ==========
  _saveAnnotation(page, annoType, color, annoData) {
    const that = this;
    wx.cloud.callFunction({
      name: 'pdfSummary',
      data: {
        action: 'noteAdd',
        fileID: this.data.fileID,
        fileName: this.data.fileName,
        excerpt: 'page:' + page,
        annotation: '',
        color: color,
        page: page,
        annoType: annoType,
        annoData: annoData,
      },
      success: () => {
        that._loadAllAnnotations();
      },
    });
  },

  _loadAllAnnotations() {
    const that = this;
    wx.cloud.callFunction({
      name: 'pdfSummary',
      data: { action: 'noteList', filterFileID: this.data.fileID },
      success: (res) => {
        if (res.result && res.result.success) {
          that._allAnnotations = res.result.list || [];
          that._redrawAnnotations();
        }
      },
    });
  },

  // ========== 翻页 ==========
  onPrevPage() {
    const idx = this.data.currentPage - 1;
    if (idx < 0) return;
    if (this.data.viewMode === 'text') {
      this._showPage(idx);
    } else {
      this.setData({ currentPage: idx });
      this._reinitCanvas();
    }
  },

  onNextPage() {
    const idx = this.data.currentPage + 1;
    if (idx >= this.data.totalPages) return;
    if (this.data.viewMode === 'text') {
      this._showPage(idx);
    } else {
      this.setData({ currentPage: idx });
      this._reinitCanvas();
    }
  },

  _showPage(idx) {
    const pages = this._pages;
    if (!pages || idx < 0 || idx >= pages.length) return;
    this.setData({ currentPage: idx, pageParagraphs: pages[idx] || [] });
  },

  // ========== 文本模式 ==========
  _fetchTextByFileID(fileID) {
    const that = this;
    wx.cloud.callFunction({
      name: 'pdfSummary',
      data: { action: 'getText', fileID: fileID },
      success: (res) => {
        if (res.result && res.result.success) {
          const paragraphs = res.result.paragraphs || [];
          that.loadAnnotations();
          that._paginate(paragraphs);
          that.setData({ paragraphs, viewMode: 'text', loading: false });
        } else {
          that.setData({ loading: false, error: res.result ? res.result.errMsg : '提取文本失败' });
        }
      },
      fail: () => that.setData({ loading: false, error: '获取文本失败' }),
    });
  },

  _fetchTextForAnnotations(fileID) {
    const that = this;
    wx.cloud.callFunction({
      name: 'pdfSummary',
      data: { action: 'getText', fileID: fileID },
      success: (res) => {
        if (res.result && res.result.success) {
          that.setData({ paragraphs: res.result.paragraphs || [] });
          that.loadAnnotations();
        }
      },
    });
  },

  _paginate(paragraphs) {
    const charsPerPage = 500;
    const pages = []; let current = []; let count = 0;
    paragraphs.forEach(function(p) {
      current.push(p); count += p.text.length;
      if (count >= charsPerPage) { pages.push(current); current = []; count = 0; }
    });
    if (current.length) pages.push(current);
    this._pages = pages;
    this.setData({ totalPages: pages.length, currentPage: 0, pageParagraphs: pages[0] || [] });
  },

  onToggleView() {
    const newMode = this.data.viewMode === 'image' ? 'text' : 'image';
    if (newMode === 'text' && !this.data.paragraphs.length) {
      wx.showToast({ title: '文本仍在加载中', icon: 'none' }); return;
    }
    this.setData({ viewMode: newMode, currentPage: 0 });
    if (newMode === 'text') this._showPage(0);
    if (newMode === 'image') this._reinitCanvas();
  },

  loadAnnotations() {
    const that = this;
    wx.cloud.callFunction({
      name: 'pdfSummary',
      data: { action: 'noteList', filterFileID: that.data.fileID },
      success: (res) => {
        if (res.result && res.result.success) {
          const list = res.result.list || [];
          that._allAnnotations = list;
          const map = {};
          list.forEach(function(note) {
            if (note.annoType) return; // 跳过绘制型批注
            const pid = note.excerpt || '_general';
            if (!map[pid]) map[pid] = [];
            map[pid].push({ content: note.annotation, time: that.formatTime(note.createdAt) });
          });
          that.setData({ annotations: map });
          that._redrawAnnotations();
        }
      },
    });
  },

  onFontSizeChange(e) {
    this.setData({ fontSize: parseInt(e.currentTarget.dataset.size) });
  },

  onParagraphTap(e) {
    const pid = e.currentTarget.dataset.id;
    const src = this.data.viewMode === 'text' ? this.data.pageParagraphs : this.data.paragraphs;
    const paragraph = src.find(function(p) { return p.id === pid; });
    this.setData({
      showAnnoModal: true, activeParagraphId: pid,
      activeParagraphText: paragraph ? paragraph.text.substring(0, 100) : '', annoInput: '',
    });
  },

  onAnnoInput(e) { this.setData({ annoInput: e.detail.value }); },

  onSaveAnno() {
    const { fileID, fileName, activeParagraphId, annoInput } = this.data;
    if (!annoInput.trim()) return;
    const that = this;

    // 判断是图片位置批注还是段落批注
    const imgMatch = activeParagraphId.match(/^img:(\d+):([\d.]+):([\d.]+)$/);
    const data = {
      action: 'noteAdd',
      fileID: fileID,
      fileName: fileName,
      excerpt: activeParagraphId,
      annotation: annoInput.trim(),
    };
    if (imgMatch) {
      data.page = parseInt(imgMatch[1]);
      data.annoType = 'text';
      data.annoData = JSON.stringify({ x: parseFloat(imgMatch[2]), y: parseFloat(imgMatch[3]) });
      data.color = this.data.annoColor;
    }

    wx.cloud.callFunction({
      name: 'pdfSummary',
      data: data,
      success: () => {
        wx.showToast({ title: '已保存', icon: 'success' });
        that.setData({ showAnnoModal: false });
        that.loadAnnotations();
        that._loadAllAnnotations();
      },
      fail: () => { wx.showToast({ title: '保存失败', icon: 'none' }); },
    });
  },

  onCloseAnnoModal() { this.setData({ showAnnoModal: false }); },

  formatTime(iso) {
    if (!iso) return '';
    const d = new Date(iso); const m = d.getMonth() + 1; const day = d.getDate();
    const h = d.getHours(); const min = d.getMinutes();
    return m + '/' + day + ' ' + (h < 10 ? '0' : '') + h + ':' + (min < 10 ? '0' : '') + min;
  },
});
