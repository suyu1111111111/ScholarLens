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

    // 缩放
    zoomScale: 1,
    zoomX: 0,
    zoomY: 0,

    // 全屏批注
    isFullscreen: false,

    // Canvas 显式尺寸（解决 height:100% 在 auto-height 容器中塌缩的问题）
    canvasWidth: 375,
    canvasHeight: 500,

    // 阅读进度
    progress: 0,
  },

  // 缓存
  _canvas: null,
  _ctx: null,
  _baseWidth: 0,    // 未缩放时的显示宽度
  _baseHeight: 0,   // 未缩放时的显示高度
  _imgNaturalWidth: 0,
  _imgNaturalHeight: 0,
  _isDrawing: false,
  _startPos: null,
  _currentStroke: null,
  _allAnnotations: [],  // all annotations for this document
  _pinchDist0: 0,
  _pinchScale0: 1,
  _panLast: null,
  _scrollTop: 0,
  _lastCloudSave: 0,

  onLoad(options) {
    if (options && options.fileID) {
      // fileID 可能被 URL 编码（云存储路径含 :/ 等特殊字符），解码保证与数据库一致
      const decodedFileID = decodeURIComponent(options.fileID || '');
      // 合并云端进度与本地兜底进度，取较大值
      let initProgress = parseInt(options.progress) || 0;
      try {
        const cached = wx.getStorageSync('reading_progress') || {};
      // 兼容旧编码 key 和新编码 key
      const localPct = cached['progress_' + encodeURIComponent(decodedFileID)] || cached['progress_' + decodedFileID] || 0;
        if (localPct > initProgress) initProgress = localPct;
      } catch (e) {}
      const targetPage = parseInt(options.page);
      const startPage = isNaN(targetPage) ? 0 : targetPage;
      this._targetPage = startPage;
      this._lastCloudSave = initProgress;
      this.setData({ fileID: decodedFileID, fileName: decodeURIComponent(options.fileName || ''), progress: initProgress, currentPage: startPage });
      const app = getApp();
      const pageImages = app.globalData._pageImages;
      const pageCount = app.globalData._pageCount;

      if (pageImages && pageImages.length && pageCount) {
        // 稀疏数组：索引位置有值即为已加载
        this._pageTempURL = app.globalData._pageTempURL || '';
        app.globalData._pageImages = null;
        app.globalData._pageTempURL = null;
        app.globalData._pageCount = null;
        const startPage = this._targetPage || 0;
        this.setData({
          pageImages: pageImages,
          totalPages: pageCount,
          currentPage: startPage,
          loading: false,
        }, () => {
          this._updateProgress(startPage);
        });
        this._fetchTextForAnnotations(options.fileID);
        this._loadAllAnnotations();
      } else {
        this._fetchTextByFileID(options.fileID);
      }
    }
    wx.setNavigationBarTitle({ title: '阅读' });
  },

  onUnload() {
    // 退出时保存当前页进度（优先云函数，同时写本地兜底）
    if (this.data.currentPage !== undefined && this.data.fileID && this.data.totalPages) {
      const pct = Math.round((this.data.currentPage + 1) / this.data.totalPages * 100);
      if (pct > this.data.progress) {
        this.setData({ progress: pct });
      }
      // 同步写本地存储，确保不丢
      try {
        const key = 'progress_' + encodeURIComponent(this.data.fileID);
        const cached = wx.getStorageSync('reading_progress') || {};
        cached[key] = Math.max(pct, (cached[key] || 0));
        wx.setStorageSync('reading_progress', cached);
      } catch (e) {}
      // 异步写云端
        name: 'pdfSummary',
        data: {
          action: 'updateProgress',
          fileID: this.data.fileID,
          fileName: this.data.fileName,
          progress: pct,
        },
      });
    }
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
        const w = imgRes[0].width;
        const h = imgRes[0].height;
        that._baseWidth = w;
        that._baseHeight = h;

        // 获取图片原始尺寸
        wx.getImageInfo({
          src: that.data.pageImages[that.data.currentPage],
          success: (info) => {
            that._imgNaturalWidth = info.width;
            that._imgNaturalHeight = info.height;
          },
        });

        // 先更新 Canvas CSS 尺寸为精确像素值（解决 height:100% 塌缩），
        // 在 setData 渲染完成回调中再获取节点初始化 Canvas 2D 上下文
        that.setData({ canvasWidth: w, canvasHeight: h }, () => {
          wx.createSelectorQuery()
            .select('#anno-canvas')
            .fields({ node: true, size: true })
            .exec((canvasRes) => {
              if (!canvasRes[0] || !canvasRes[0].node) return;
              const canvas = canvasRes[0].node;
              const dpr = wx.getSystemInfoSync().pixelRatio;
              canvas.width = w * dpr;
              canvas.height = h * dpr;
              const ctx = canvas.getContext('2d');
              ctx.scale(dpr, dpr);
              that._canvas = canvas;
              that._ctx = ctx;
              that._redrawAnnotations();
            });
        });
      });
  },

  // 翻页时重新初始化 Canvas
  _reinitCanvas() {
    this._canvas = null;
    this._ctx = null;
    this._scrollTop = 0;
    this.setData({ zoomScale: 1, zoomX: 0, zoomY: 0 });
    const that = this;
    setTimeout(() => {
      if (!that._ctx) that.onImageLoad();
    }, 200);
  },

  // ========== 全屏批注 ==========
  onToggleFullscreen() {
    const newVal = !this.data.isFullscreen;
    this.setData({ isFullscreen: newVal });
    if (newVal) {
      // 进入全屏：滚动到顶部，重置缩放
      this._scrollTop = 0;
      this.setData({ zoomScale: 1, zoomX: 0, zoomY: 0 });
    }
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

  // ========== 缩放 & 平移手势 ==========
  onContainerScroll(e) {
    this._scrollTop = e.detail.scrollTop || 0;
  },

  onContainerTouchStart(e) {
    const touches = e.touches;
    this._gestureType = '';
    if (touches.length >= 2) {
      const dx = touches[0].x - touches[1].x;
      const dy = touches[0].y - touches[1].y;
      this._pinchDist0 = Math.sqrt(dx * dx + dy * dy);
      this._pinchScale0 = this.data.zoomScale;
      this._gestureType = 'pinch';
      this._isDrawing = false;
    } else if (this.data.annoTool === 'none') {
      if (this.data.zoomScale > 1) {
        // 缩放>1时：单指平移
        this._panLast = { x: touches[0].x, y: touches[0].y };
        this._gestureType = 'pan';
      }
      // 缩放=1时：不拦截，让页面自然滚动
      this._isDrawing = false;
    } else if (this.data.annoTool === 'text') {
      this._gestureType = 'text';
      this._isDrawing = false;
    } else {
      this._gestureType = 'draw';
      this._startAnnoDraw(touches[0]);
    }
  },

  onContainerTouchMove(e) {
    const touches = e.touches;
    if (touches.length >= 2 && this._pinchDist0 > 0) {
      const dx = touches[0].x - touches[1].x;
      const dy = touches[0].y - touches[1].y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const newScale = Math.max(1, Math.min(5, this._pinchScale0 * (dist / this._pinchDist0)));
      this.setData({ zoomScale: newScale });
    } else if (this._panLast) {
      const dx = touches[0].x - this._panLast.x;
      const dy = touches[0].y - this._panLast.y;
      this._panLast = { x: touches[0].x, y: touches[0].y };
      const sw = this._baseWidth * this.data.zoomScale;
      const sh = this._baseHeight * this.data.zoomScale;
      const maxX = sw - this._baseWidth;
      const maxY = sh - this._baseHeight;
      this.setData({
        zoomX: Math.max(-maxX, Math.min(0, this.data.zoomX + dx)),
        zoomY: Math.max(-maxY, Math.min(0, this.data.zoomY + dy)),
      });
    } else if (this._isDrawing) {
      this._moveAnnoDraw(touches[0]);
    }
  },

  onContainerTouchEnd(e) {
    if (this._pinchDist0 > 0) { this._pinchDist0 = 0; }
    if (this._panLast) { this._panLast = null; }
    if (this._isDrawing && this._gestureType === 'draw') {
      this._endAnnoDraw(e);
    } else if (this._gestureType === 'text') {
      const touch = e.changedTouches[0];
      const pct = this._screenToPercent(touch.x, touch.y);
      this.setData({
        showAnnoModal: true,
        activeParagraphId: 'img:' + this.data.currentPage + ':' + pct.x.toFixed(3) + ':' + pct.y.toFixed(3),
        activeParagraphText: '第' + (this.data.currentPage + 1) + '页 (' + pct.x.toFixed(1) + '%, ' + pct.y.toFixed(1) + '%)',
        annoInput: '',
      });
    }
    this._gestureType = '';
  },

  // ========== 触摸绘制 ==========
  _startAnnoDraw(touch) {
    const x = touch.x;
    const y = touch.y;
    this._isDrawing = true;
    this._startPos = { x, y };
    this._currentStroke = [{ x, y }];

    if (this.data.annoTool === 'pen' && this._ctx) {
      const c = this._screenToCanvas(x, y);
      this._ctx.strokeStyle = this.data.annoColor;
      this._ctx.lineWidth = 2;
      this._ctx.lineCap = 'round';
      this._ctx.lineJoin = 'round';
      this._ctx.beginPath();
      this._ctx.moveTo(c.x, c.y);
    }
  },

  _moveAnnoDraw(touch) {
    const x = touch.x;
    const y = touch.y;
    this._currentStroke.push({ x, y });

    if (this.data.annoTool === 'pen' && this._ctx) {
      const c = this._screenToCanvas(x, y);
      this._ctx.lineTo(c.x, c.y);
      this._ctx.stroke();
    }
  },

  _endAnnoDraw(e) {
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

  // ========== 坐标转换（考虑缩放和平移） ==========
  _screenToCanvas(sx, sy) {
    const z = this.data.zoomScale;
    const dx = this.data.zoomX;
    const dy = this.data.zoomY;
    const st = this._scrollTop || 0;
    return {
      x: (sx - dx) / z,
      y: (sy - dy + st) / z,
    };
  },

  _screenToPercent(sx, sy) {
    const c = this._screenToCanvas(sx, sy);
    return {
      x: this._baseWidth > 0 ? c.x / this._baseWidth : 0,
      y: this._baseHeight > 0 ? c.y / this._baseHeight : 0,
    };
  },

  _percentToScreen(px, py) {
    const z = this.data.zoomScale;
    const dx = this.data.zoomX;
    const dy = this.data.zoomY;
    return {
      x: px * this._baseWidth * z + dx,
      y: py * this._baseHeight * z + dy,
    };
  },

  // ========== Canvas 绘制 ==========
  _redrawAnnotations() {
    const ctx = this._ctx;
    if (!ctx) return;
    const dw = this._baseWidth;
    const dh = this._baseHeight;
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
    const z = this.data.zoomScale;
    const w = rect.w * this._baseWidth * z;
    const h = rect.h * this._baseHeight * z;
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.35;
    ctx.fillRect(p.x, p.y, w, h);
    ctx.globalAlpha = 1;
  },

  _drawUnderline(ctx, rect, color) {
    const p = this._percentToScreen(rect.x, rect.y);
    const z = this.data.zoomScale;
    const w = rect.w * this._baseWidth * z;
    const h = rect.h * this._baseHeight * z;
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
    // 先本地缓存，立即重绘（不要等网络）
    const newAnno = { page, annoType, color, annoData };
    this._allAnnotations.push(newAnno);
    this._redrawAnnotations();
    // 异步保存到云端
    const typeLabel = { highlight: '高亮', underline: '下划线', pen: '手写' }[annoType] || '批注';
    wx.cloud.callFunction({
      name: 'pdfSummary',
      data: {
        action: 'noteAdd',
        fileID: this.data.fileID,
        fileName: this.data.fileName,
        excerpt: '第' + (page + 1) + '页 · ' + typeLabel,
        annotation: '',
        color: color,
        page: page,
        type: 'annotate',
        annoType: annoType,
        annoData: annoData,
      },
      success: () => {
        that._redrawAnnotations();
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
      this._goToImagePage(idx);
    }
    this._updateProgress(idx);
  },

  onNextPage() {
    const idx = this.data.currentPage + 1;
    if (idx >= this.data.totalPages) return;
    if (this.data.viewMode === 'text') {
      this._showPage(idx);
    } else {
      this._goToImagePage(idx);
    }
    this._updateProgress(idx);
  },

  _updateProgress(pageIndex) {
    const total = this.data.totalPages;
    if (!total || !this.data.fileID) {
      console.warn('[进度] 跳过: total=', total, 'fileID=', this.data.fileID);
      return;
    }
    const pct = Math.round((pageIndex + 1) / total * 100);
    if (pct <= this.data.progress) {
      console.log('[进度] 未增加: pct=', pct, 'current=', this.data.progress);
      return;
    }
    this.setData({ progress: pct });

    // 本地存储兜底
    try {
      const key = 'progress_' + encodeURIComponent(this.data.fileID);
      const cached = wx.getStorageSync('reading_progress') || {};
      cached[key] = Math.max(pct, (cached[key] || 0));
      wx.setStorageSync('reading_progress', cached);
    } catch (e) {
      console.error('[进度] 本地保存失败:', e);
    }

    const that = this;
    wx.cloud.callFunction({
      name: 'pdfSummary',
      data: {
        action: 'updateProgress',
        fileID: this.data.fileID,
        fileName: this.data.fileName,
        progress: pct,
      },
      success: (res) => {
        that._lastCloudSave = pct;
        console.log('[进度] 云端保存成功: pct=', pct, 'res=', JSON.stringify(res));
      },
      fail: (err) => {
        console.error('[进度] 云端保存失败:', JSON.stringify(err));
      },
    });
  },

  _goToImagePage(idx) {
    const images = this.data.pageImages;
    if (images[idx]) {
      this.setData({ currentPage: idx });
      this._reinitCanvas();
    } else {
      wx.showLoading({ title: '加载中...' });
      const that = this;
      wx.cloud.callFunction({
        name: 'pdfSummary',
        data: { action: 'getPage', tempFileURL: that._pageTempURL, page: idx },
        success: (cfRes) => {
          if (cfRes.result && cfRes.result.success) {
            if (cfRes.result.imageFileID) {
              wx.cloud.getTempFileURL({
                fileList: [cfRes.result.imageFileID],
                success: (urlRes) => {
                  wx.hideLoading();
                  const url = (urlRes.fileList && urlRes.fileList[0] && urlRes.fileList[0].tempFileURL) || '';
                  images[idx] = url;
                  that.setData({ pageImages: images, currentPage: idx });
                  that._reinitCanvas();
                },
                fail: () => {
                  wx.hideLoading();
                  wx.showToast({ title: '加载页面失败', icon: 'none' });
                },
              });
            } else if (cfRes.result.image) {
              wx.hideLoading();
              images[idx] = cfRes.result.image;
              that.setData({ pageImages: images, currentPage: idx });
              that._reinitCanvas();
            } else {
              wx.hideLoading();
              wx.showToast({ title: '加载页面失败', icon: 'none' });
            }
          } else {
            wx.hideLoading();
            wx.showToast({ title: '加载页面失败', icon: 'none' });
          }
        },
        fail: () => {
          wx.hideLoading();
          wx.showToast({ title: '加载页面失败', icon: 'none' });
        },
      });
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
    this.setData({ totalPages: pages.length, currentPage: 0, pageParagraphs: pages[0] || [] }, () => {
      this._updateProgress(0);
    });
  },

  onToggleView() {
    const newMode = this.data.viewMode === 'image' ? 'text' : 'image';
    if (newMode === 'text' && !this.data.paragraphs.length) {
      wx.showToast({ title: '文本仍在加载中', icon: 'none' }); return;
    }
    this.setData({ viewMode: newMode, currentPage: 0, isFullscreen: false });
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

    const imgMatch = activeParagraphId.match(/^img:(\d+):([\d.]+):([\d.]+)$/);
    let excerptText = activeParagraphId;
    if (imgMatch) {
      excerptText = '第' + (parseInt(imgMatch[1]) + 1) + '页 · 文字批注';
    }
    const data = {
      action: 'noteAdd',
      fileID: fileID,
      fileName: fileName,
      excerpt: excerptText,
      annotation: annoInput.trim(),
      type: 'annotate',
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
