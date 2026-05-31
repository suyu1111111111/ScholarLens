const cloud = require("wx-server-sdk");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

// ========== HTTP 触发器：PDF 阅读器 ==========
async function handleHttpRequest(event) {
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
      body: '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="display:flex;align-items:center;justify-content:center;height:100vh;color:#e54545;font-size:16px;font-family:sans-serif"><div>错误：' + errorMsg + '</div></body></html>',
    };
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    body: '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=3,user-scalable=yes"><title>PDF 阅读器</title><script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.2.2/pdf.min.js"><\/script><style>*{margin:0;padding:0;box-sizing:border-box}body{background:#525659;padding-bottom:56px}canvas{display:block;margin:10px auto;box-shadow:0 2px 12px rgba(0,0,0,.5);max-width:100%}.toolbar{position:fixed;bottom:0;left:0;right:0;z-index:10;display:flex;align-items:center;justify-content:center;gap:24px;padding:10px;background:rgba(50,54,57,.95);color:#fff}.toolbar button{padding:8px 24px;border:none;border-radius:4px;background:#555;color:#fff;font-size:14px}.toolbar button:active{background:#777}.toolbar span{font-size:14px;min-width:100px;text-align:center}.loading{display:flex;align-items:center;justify-content:center;height:100vh;color:#ccc;font-size:16px}.error{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;color:#e54545;font-size:16px;gap:16px}<\/style><\/head><body><div id="status" class="loading">加载中...</div><canvas id="pdfCanvas" style="display:none"></canvas><div class="toolbar" id="toolbar" style="display:none"><button id="btnPrev">上一页</button><span>第 <span id="pageNum">0</span> / <span id="pageCount">0</span> 页</span><button id="btnNext">下一页</button></div><script>pdfjsLib.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.2.2/pdf.worker.min.js";var pdfDoc=null,pageNum=1,pageRendering=!1,pageNumPending=null,scale=1.5;var canvas=document.getElementById("pdfCanvas"),ctx=canvas.getContext("2d");var statusEl=document.getElementById("status"),toolbarEl=document.getElementById("toolbar");function renderPage(n){pageRendering=!0;pdfDoc.getPage(n).then(function(p){var v=p.getViewport({scale:scale});canvas.height=v.height;canvas.width=v.width;var t=p.render({canvasContext:ctx,viewport:v});t.promise.then(function(){pageRendering=!1,pageNumPending!==null&&(renderPage(pageNumPending),pageNumPending=null)})}),document.getElementById("pageNum").textContent=n}function queueRenderPage(n){pageRendering?pageNumPending=n:renderPage(n)}document.getElementById("btnPrev").onclick=function(){pageNum<=1||(pageNum--,queueRenderPage(pageNum))};document.getElementById("btnNext").onclick=function(){pageNum>=pdfDoc.numPages||(pageNum++,queueRenderPage(pageNum))};var pdfData="data:application/pdf;base64,' + base64Pdf + '";pdfjsLib.getDocument(pdfData).promise.then(function(p){pdfDoc=p,document.getElementById("pageCount").textContent=p.numPages,statusEl.style.display="none",canvas.style.display="block",toolbarEl.style.display="flex",renderPage(pageNum)}).catch(function(e){statusEl.className="error",statusEl.innerHTML=\'<div>PDF 加载失败</div><div style="font-size:12px;color:#999">\'+e.message+"</div>"})<\/script></body></html>',
  };
}

// ========== 原有功能 ==========
const getOpenId = async () => {
  const wxContext = cloud.getWXContext();
  return { openid: wxContext.OPENID, appid: wxContext.APPID, unionid: wxContext.UNIONID };
};

const getMiniProgramCode = async () => {
  const resp = await cloud.openapi.wxacode.get({ path: "pages/index/index" });
  const { buffer } = resp;
  const upload = await cloud.uploadFile({ cloudPath: "code.png", fileContent: buffer });
  return upload.fileID;
};

const createCollection = async () => {
  try {
    await db.createCollection("sales");
    await db.collection("sales").add({ data: { region: "华东", city: "上海", sales: 11 } });
    await db.collection("sales").add({ data: { region: "华东", city: "南京", sales: 11 } });
    await db.collection("sales").add({ data: { region: "华南", city: "广州", sales: 22 } });
    await db.collection("sales").add({ data: { region: "华南", city: "深圳", sales: 22 } });
    return { success: true };
  } catch (e) {
    return { success: true, data: "create collection success" };
  }
};

const selectRecord = async () => { return await db.collection("sales").get(); };

const updateRecord = async (event) => {
  try {
    for (let i = 0; i < event.data.length; i++) {
      await db.collection("sales").where({ _id: event.data[i]._id }).update({ data: { sales: event.data[i].sales } });
    }
    return { success: true, data: event.data };
  } catch (e) { return { success: false, errMsg: e }; }
};

const insertRecord = async (event) => {
  try {
    await db.collection("sales").add({ data: { region: event.data.region, city: event.data.city, sales: Number(event.data.sales) } });
    return { success: true, data: event.data };
  } catch (e) { return { success: false, errMsg: e }; }
};

const deleteRecord = async (event) => {
  try {
    await db.collection("sales").where({ _id: event.data._id }).remove();
    return { success: true };
  } catch (e) { return { success: false, errMsg: e }; }
};

exports.main = async (event, context) => {
  // HTTP 触发器调用
  if (event.httpMethod) {
    return await handleHttpRequest(event);
  }

  // 微信小程序内部调用
  switch (event.type) {
    case "getOpenId": return await getOpenId();
    case "getMiniProgramCode": return await getMiniProgramCode();
    case "createCollection": return await createCollection();
    case "selectRecord": return await selectRecord();
    case "updateRecord": return await updateRecord(event);
    case "insertRecord": return await insertRecord(event);
    case "deleteRecord": return await deleteRecord(event);
  }
};
