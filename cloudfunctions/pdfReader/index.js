const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

function buildHtml(base64Pdf) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=3,user-scalable=yes">
<title>PDF 阅读器</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.2.2/pdf.min.js"><\/script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#525659;padding-bottom:100px;overflow-x:hidden}
.page-wrap{position:relative;margin:10px auto;box-shadow:0 2px 12px rgba(0,0,0,.5);overflow:hidden;max-width:100%}
canvas{display:block;max-width:100%}
.textLayer{position:absolute;top:0;left:0;right:0;bottom:0;overflow:hidden;opacity:1}
.textLayer span{color:transparent;position:absolute;white-space:pre;transform-origin:0 0;cursor:text;transform:scaleX(-1)}
.textLayer span::selection{background:rgba(0,100,255,.3);color:transparent}
.textLayer span::-moz-selection{background:rgba(0,100,255,.3);color:transparent}
.toolbar{position:fixed;bottom:0;left:0;right:0;z-index:10;display:flex;align-items:center;justify-content:space-between;padding:10px 16px;background:rgba(50,54,57,.95);color:#fff;gap:8px}
.toolbar button{padding:8px 16px;border:none;border-radius:4px;background:#555;color:#fff;font-size:14px;white-space:nowrap}
.toolbar button:active{background:#777}
.toolbar button.primary{background:#1a73e8}
.toolbar span{font-size:13px;min-width:80px;text-align:center}
.loading,.error{display:flex;align-items:center;justify-content:center;height:100vh;color:#ccc;font-size:16px}
.error{flex-direction:column;color:#e54545;gap:16px}
.annotate-popup{display:none;position:fixed;z-index:20;background:#fff;border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,.3);padding:12px;min-width:240px;max-width:90vw}
.annotate-popup.show{display:block}
.annotate-popup .sel-text{font-size:13px;color:#333;line-height:1.5;max-height:80px;overflow-y:auto;padding:8px;background:#f0f4ff;border-radius:4px;margin-bottom:8px;border-left:3px solid #1a73e8}
.annotate-popup textarea{width:100%;height:60px;font-size:13px;border:1px solid #ddd;border-radius:4px;padding:8px;resize:none;outline:none}
.annotate-popup textarea:focus{border-color:#1a73e8}
.annotate-popup .popup-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:8px}
.annotate-popup .popup-actions button{padding:6px 16px;border:none;border-radius:4px;font-size:13px}
.annotate-popup .btn-save{background:#1a73e8;color:#fff}
.annotate-popup .btn-translate{background:#34a853;color:#fff}
.annotate-popup .btn-close{background:#eee;color:#666}
.annotate-popup .btn-translate:disabled{background:#999}
.highlight-rect{position:absolute;background:rgba(255,235,59,.4);pointer-events:none;mix-blend-mode:multiply;border-radius:2px}
.highlights-btn{position:relative}
.highlights-btn .badge{position:absolute;top:-4px;right:-4px;background:#e54545;color:#fff;font-size:10px;min-width:16px;height:16px;line-height:16px;border-radius:8px;text-align:center}
.toast{display:none;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,.8);color:#fff;font-size:14px;padding:10px 20px;border-radius:8px;z-index:30;pointer-events:none}
.toast.show{display:block;animation:fadeIn .3s}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
</style>
</head>
<body>
<div id="status" class="loading">加载中...</div>
<div id="pagesContainer" style="display:none"></div>
<div class="toolbar" id="toolbar" style="display:none">
  <button id="btnPrev">上一页</button>
  <span>第 <span id="pageNum">0</span>/<span id="pageCount">0</span> 页</span>
  <button id="btnNext">下一页</button>
  <button id="btnBack" class="primary">返回</button>
</div>
<div class="annotate-popup" id="annotatePopup">
  <div class="sel-text" id="selTextDisplay"></div>
  <div class="sel-text" id="transResult" style="display:none;background:#f0fff0;border-left-color:#34a853"></div>
  <textarea id="annotateInput" placeholder="添加批注（可选）"></textarea>
  <div class="popup-actions">
    <button class="btn-close" id="btnCancel">取消</button>
    <button class="btn-translate" id="btnTranslate">翻译</button>
    <button class="btn-save" id="btnSave">保存标注</button>
  </div>
</div>
<div class="toast" id="toast"></div>

<script>
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.2.2/pdf.worker.min.js';

// 从 URL 读取初始页码
function getParam(name) {
  var m = location.search.match(new RegExp('[?&]' + name + '=([^&]*)'));
  return m ? parseInt(decodeURIComponent(m[1])) || 1 : null;
}
var startPage = getParam('page') || 1;

var pdfDoc = null, pageNum = startPage, scale = 1;
var pagesContainer = document.getElementById('pagesContainer');
var statusEl = document.getElementById('status');
var toolbarEl = document.getElementById('toolbar');
var popup = document.getElementById('annotatePopup');
var selTextDisplay = document.getElementById('selTextDisplay');
var annotateInput = document.getElementById('annotateInput');
var toast = document.getElementById('toast');

// 存储标注
var annotations = [];
var currentSelection = null;
var currentPage = 1;

function showToast(msg) {
  toast.textContent = msg;
  toast.className = 'toast show';
  setTimeout(function(){ toast.className = 'toast'; }, 1500);
}

function renderPage(n) {
  currentPage = n;
  pdfDoc.getPage(n).then(function(page) {
    var rawVp = page.getViewport({scale: 1});
    scale = (document.documentElement.clientWidth - 12) / rawVp.width;
    var vp = page.getViewport({scale: scale});

    // 创建页面容器
    var wrap = document.createElement('div');
    wrap.className = 'page-wrap';
    wrap.style.width = vp.width + 'px';
    wrap.style.height = vp.height + 'px';
    wrap.setAttribute('data-page', n);

    var canvas = document.createElement('canvas');
    canvas.width = vp.width;
    canvas.height = vp.height;
    wrap.appendChild(canvas);

    var ctx = canvas.getContext('2d');
    page.render({canvasContext: ctx, viewport: vp}).promise.then(function() {
      // 渲染高亮矩形
      var pageAnnots = annotations.filter(function(a){ return a.page === n; });
      pageAnnots.forEach(function(a){
        var rect = document.createElement('div');
        rect.className = 'highlight-rect';
        rect.style.left = a.x + 'px';
        rect.style.top = a.y + 'px';
        rect.style.width = a.w + 'px';
        rect.style.height = a.h + 'px';
        wrap.appendChild(rect);
      });

      // 渲染文字层
      page.getTextContent().then(function(textContent) {
        var textLayer = document.createElement('div');
        textLayer.className = 'textLayer';
        textLayer.style.width = vp.width + 'px';
        textLayer.style.height = vp.height + 'px';

        textContent.items.forEach(function(item) {
          if (!item.str || !item.str.trim()) return;
          var tx = item.transform;
          var span = document.createElement('span');
          span.textContent = item.str;
          span.style.left = tx[4] + 'px';
          span.style.top = (vp.height - tx[5] - item.height) + 'px';
          span.style.fontSize = item.height * 0.9 + 'px';
          span.style.fontFamily = item.fontName || 'sans-serif';
          if (item.width) span.style.width = item.width + 'px';
          textLayer.appendChild(span);
        });

        wrap.appendChild(textLayer);
      });
    });

    // 清除旧内容，添加新页面
    pagesContainer.innerHTML = '';
    pagesContainer.appendChild(wrap);

    document.getElementById('pageNum').textContent = n;
  });
}

// 文字选择处理
document.addEventListener('mouseup', handleSelection);
document.addEventListener('touchend', function(e){
  setTimeout(handleSelection, 300);
});

function handleSelection() {
  var sel = window.getSelection();
  var text = sel.toString().trim();
  if (!text || text.length < 2) {
    return;
  }

  // 检查选区是否在文字层内
  var range = sel.getRangeAt(0);
  var textLayer = document.querySelector('.textLayer');
  if (!textLayer || !textLayer.contains(range.commonAncestorContainer)) {
    return;
  }

  currentSelection = {
    text: text,
    page: currentPage,
    rect: range.getBoundingClientRect()
  };

  selTextDisplay.textContent = text;
  annotateInput.value = '';

  // 定位弹窗
  var top = currentSelection.rect.bottom + 8;
  var left = Math.max(10, currentSelection.rect.left);
  if (top + 200 > window.innerHeight) {
    top = currentSelection.rect.top - 180;
  }
  popup.style.top = top + 'px';
  popup.style.left = left + 'px';
  popup.style.right = 'auto';
  popup.style.bottom = 'auto';
  popup.className = 'annotate-popup show';
  annotateInput.focus();
}

// 弹窗按钮
document.getElementById('btnCancel').onclick = function(){
  popup.className = 'annotate-popup';
  document.getElementById('transResult').style.display = 'none';
  window.getSelection().removeAllRanges();
};

// 翻译按钮
var BASE_URL = location.origin + location.pathname;
document.getElementById('btnTranslate').onclick = function(){
  if (!currentSelection) return;
  var btn = this;
  btn.disabled = true;
  btn.textContent = '翻译中...';
  var transDiv = document.getElementById('transResult');
  transDiv.style.display = 'none';

  fetch(BASE_URL + '?action=translate&text=' + encodeURIComponent(currentSelection.text))
    .then(function(r){ return r.json(); })
    .then(function(data){
      if (data.success) {
        transDiv.textContent = data.translated;
        transDiv.style.display = 'block';
      } else {
        transDiv.textContent = '翻译失败: ' + (data.errMsg || '未知错误');
        transDiv.style.display = 'block';
      }
      btn.disabled = false;
      btn.textContent = '翻译';
    })
    .catch(function(e){
      transDiv.textContent = '翻译服务不可用';
      transDiv.style.display = 'block';
      btn.disabled = false;
      btn.textContent = '翻译';
    });
};

document.getElementById('btnSave').onclick = function(){
  if (!currentSelection) return;
  var note = {
    page: currentSelection.page,
    text: currentSelection.text,
    annotation: annotateInput.value.trim(),
    time: new Date().toISOString()
  };
  annotations.push(note);
  popup.className = 'annotate-popup';
  window.getSelection().removeAllRanges();
  showToast('已保存 ' + annotations.length + ' 条标注');
  updateBadge();
  // 重新渲染当前页以显示高亮
  renderPage(currentPage);
};

function updateBadge() {
  var badge = document.getElementById('badge');
  if (annotations.length > 0) {
    if (!badge) {
      badge = document.createElement('span');
      badge.id = 'badge';
      badge.className = 'badge';
      document.getElementById('btnBack').appendChild(badge);
    }
    badge.textContent = annotations.length;
  } else if (badge) {
    badge.remove();
  }
}

function sendProgress() {
  wx.miniProgram.postMessage({data: {type: 'progress', page: currentPage, annotations: annotations}});
}

// 翻页
document.getElementById('btnPrev').onclick = function(){
  if (pageNum <= 1) return;
  pageNum--;
  renderPage(pageNum);
  sendProgress();
};
document.getElementById('btnNext').onclick = function(){
  if (pageNum >= pdfDoc.numPages) return;
  pageNum++;
  renderPage(pageNum);
  sendProgress();
};

// 返回并回传标注
document.getElementById('btnBack').onclick = function(){
  sendProgress();
  wx.miniProgram.navigateBack({delta: 1});
};

var pdfData = 'data:application/pdf;base64,${base64Pdf}';
pdfjsLib.getDocument(pdfData).promise.then(function(p) {
  pdfDoc = p;
  document.getElementById('pageCount').textContent = p.numPages;
  statusEl.style.display = 'none';
  pagesContainer.style.display = 'block';
  toolbarEl.style.display = 'flex';
  renderPage(pageNum);
  sendProgress();
}).catch(function(e) {
  statusEl.className = 'error';
  statusEl.innerHTML = '<div>PDF 加载失败</div><div style="font-size:12px;color:#999">' + e.message + '</div>';
});
<\/script>
</body>
</html>`;
}

exports.main = async (event, context) => {
  // 翻译请求：GET /pdfReader?action=translate&text=...&source=en&target=zh
  if (event.queryStringParameters && event.queryStringParameters.action === 'translate') {
    return await handleTranslate(event.queryStringParameters);
  }

  var base64Pdf = '';
  var errorMsg = '';

  var fileID = null;
  if (event.queryStringParameters && event.queryStringParameters.fileID) {
    fileID = event.queryStringParameters.fileID;
  }

  if (fileID) {
    try {
      const res = await cloud.downloadFile({ fileID });
      base64Pdf = res.fileContent.toString('base64');
    } catch (err) {
      errorMsg = err.message;
    }
  }

  if (!base64Pdf && !errorMsg) {
    errorMsg = '缺少 fileID 参数';
  }

  if (errorMsg) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="display:flex;align-items:center;justify-content:center;height:100vh;color:#e54545;font-size:16px;font-family:sans-serif"><div>错误：' + errorMsg + '</div></body></html>',
    };
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    body: buildHtml(base64Pdf),
  };
};

// ========== 翻译处理 ==========
async function handleTranslate(params) {
  const text = params.text || '';
  if (!text.trim()) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ success: false, errMsg: '缺少翻译文本' }),
    };
  }

  try {
    const result = await cloud.callFunction({
      name: 'pdfSummary',
      data: { action: 'translate', text: text.trim() },
    });
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(result.result),
    };
  } catch (err) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ success: false, errMsg: err.message }),
    };
  }
}
