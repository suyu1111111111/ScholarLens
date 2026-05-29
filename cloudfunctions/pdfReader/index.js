const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

function buildHtml(pdfUrl) {
  var pdfUrlJs = pdfUrl ? JSON.stringify(pdfUrl) : 'null';
  return '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=3,user-scalable=yes"><title>PDF 阅读器</title><script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.2.2/pdf.min.js"><\/script><style>*{margin:0;padding:0;box-sizing:border-box}body{background:#525659;padding-bottom:56px}canvas{display:block;margin:10px auto;box-shadow:0 2px 12px rgba(0,0,0,.5);max-width:100%}.toolbar{position:fixed;bottom:0;left:0;right:0;z-index:10;display:flex;align-items:center;justify-content:center;gap:24px;padding:10px;background:rgba(50,54,57,.95);color:#fff}.toolbar button{padding:8px 24px;border:none;border-radius:4px;background:#555;color:#fff;font-size:14px}.toolbar button:active{background:#777}.toolbar span{font-size:14px;min-width:100px;text-align:center}.loading{display:flex;align-items:center;justify-content:center;height:100vh;color:#ccc;font-size:16px}.error{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;color:#e54545;font-size:16px;gap:16px}<\/style><\/head><body><div id="status" class="loading">加载中...</div><canvas id="pdfCanvas" style="display:none"></canvas><div class="toolbar" id="toolbar" style="display:none"><button id="btnPrev">上一页</button><span>第 <span id="pageNum">0</span> / <span id="pageCount">0</span> 页</span><button id="btnNext">下一页</button></div><script>pdfjsLib.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.2.2/pdf.worker.min.js";var pdfDoc=null,pageNum=1,pageRendering=!1,pageNumPending=null,scale=1.5;var canvas=document.getElementById("pdfCanvas"),ctx=canvas.getContext("2d");var statusEl=document.getElementById("status"),toolbarEl=document.getElementById("toolbar");function renderPage(n){pageRendering=!0;pdfDoc.getPage(n).then(function(p){var v=p.getViewport({scale:scale});canvas.height=v.height;canvas.width=v.width;var t=p.render({canvasContext:ctx,viewport:v});t.promise.then(function(){pageRendering=!1,pageNumPending!==null&&(renderPage(pageNumPending),pageNumPending=null)})}),document.getElementById("pageNum").textContent=n}function queueRenderPage(n){pageRendering?pageNumPending=n:renderPage(n)}document.getElementById("btnPrev").onclick=function(){pageNum<=1||(pageNum--,queueRenderPage(pageNum))};document.getElementById("btnNext").onclick=function(){pageNum>=pdfDoc.numPages||(pageNum++,queueRenderPage(pageNum))};var pdfUrl='+pdfUrlJs+';if(pdfUrl){pdfjsLib.getDocument(pdfUrl).promise.then(function(p){pdfDoc=p,document.getElementById("pageCount").textContent=p.numPages,statusEl.style.display="none",canvas.style.display="block",toolbarEl.style.display="flex",renderPage(pageNum)}).catch(function(e){statusEl.className="error",statusEl.innerHTML=\'<div>PDF 加载失败</div><div style="font-size:12px;color:#999">\'+e.message+"</div>"})}else{statusEl.className="error",statusEl.innerHTML=\'<div>未找到 PDF 文件</div><div style="font-size:12px;color:#999">请重新选择文件</div>\'}<\/script></body></html>';
}

exports.main = async (event, context) => {
  var pdfUrl = null;
  if (event.queryStringParameters && event.queryStringParameters.pdfUrl) {
    pdfUrl = decodeURIComponent(event.queryStringParameters.pdfUrl);
  }
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    body: buildHtml(pdfUrl),
  };
};
