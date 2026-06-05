const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

// ========== 角色 Prompt 模板 ==========
const ROLE_PROMPTS = {
  ben: `用通俗比喻向学生讲解这篇论文。

必须遵守：
- 禁止写"好的""同学们""大家好""今天我们来""我是""坐好""聊聊"等开场白
- 第一行必须是"【核心问题】"
- 只输出以下4块，不要多写一个字

【核心问题】一句话
【通俗解释】用生活比喻讲方法，≤3句
【关键发现】
• xxx
• xxx
• xxx
【对普通人的意义】一句话

≤250字。`,

  alice: `为同行研究者做深度审稿点评。

必须遵守：
- 禁止写"好的""各位""大家好""本文""以下是"等开场白
- 第一行必须是"【研究定位】"
- 只输出以下5块，不要多写一个字

【研究定位】增量改进/范式突破？一句话定性
【方法精要】核心链路，≤3步，每步一句
【实验审视】设计是否充分，有无对比缺失
【三个局限】最值得指出的点
【可跟进方向】2个具体思路

≤350字。`,

  david: `向高管做3分钟技术简报。

必须遵守：
- 禁止写"好的""各位""大家好""简报""以下是"等开场白
- 第一行必须是"【一句话价值】"
- 只输出以下4块，不要多写一个字

【一句话价值】对产业意味着什么
• 核心洞察1
• 核心洞察2
• 核心洞察3
【落地判断】TRL等级+距产品化还差什么
【行动建议】给决策者的2条建议

≤250字。`,
};

// API 配置（通过云函数环境变量注入）
const AI_API_KEY = process.env.AI_API_KEY || '';
const AI_API_ENDPOINT = process.env.AI_API_ENDPOINT || 'https://api.deepseek.com/v1/chat/completions';
const AI_MODEL = process.env.AI_MODEL || 'deepseek-chat';

// ========== PDF 文本提取 ==========
async function downloadFromFileID(fileID) {
  try {
    const res = await cloud.downloadFile({ fileID });
    return Buffer.from(res.fileContent);
  } catch (downloadErr) {
    console.error('downloadFile failed, trying getTempFileURL:', downloadErr.message);
    try {
      const tmp = await cloud.getTempFileURL({ fileList: [fileID] });
      if (!tmp.fileList || !tmp.fileList[0] || !tmp.fileList[0].tempFileURL) {
        throw new Error('getTempFileURL 返回空结果');
      }
      return await httpsDownload(tmp.fileList[0].tempFileURL);
    } catch (fallbackErr) {
      throw new Error('文件下载失败: ' + downloadErr.message + ' | 降级也失败: ' + fallbackErr.message);
    }
  }
}

async function extractPdfTextFromBuffer(pdfBuffer) {
  const pdfParse = require('pdf-parse');

  // 第一次尝试：默认解析
  let data = await pdfParse(pdfBuffer);

  // 如果文本太少，尝试另一种渲染策略
  if (!data.text || data.text.trim().length < 50) {
    try {
      data = await pdfParse(pdfBuffer, {
        pagerender: function (pageData) {
          return pageData.getTextContent().then(function (textContent) {
            let text = '';
            let lastY = -1;
            for (const item of textContent.items) {
              if (lastY !== item.transform[5] && text) text += '\n';
              text += item.str;
              lastY = item.transform[5];
            }
            return text;
          });
        },
      });
    } catch (e) {
      // 降级渲染失败，保留原始结果
    }
  }

  const rawText = data.text || '';
  const cleaned = rawText.replace(/\x00/g, '').replace(/[^\S\n]{3,}/g, ' ').trim();

  const maxChars = 8000;
  const truncated = cleaned.length > maxChars
    ? cleaned.substring(0, maxChars) + '...[文本已截断]'
    : cleaned;

  const isScanned = cleaned.length < 100 && data.numpages > 0;

  return {
    text: truncated || rawText,
    pageCount: data.numpages,
    textLength: rawText.length,
    isScanned: isScanned,
  };
}

async function extractPdfText(fileID) {
  const pdfBuffer = await downloadFromFileID(fileID);
  return extractPdfTextFromBuffer(pdfBuffer);
}

// ========== HTTP 下载（用于 getTempFileURL 降级） ==========
function httpsDownload(url) {
  const https = require('https');
  const http = require('http');
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpsDownload(res.headers.location).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

// ========== AI API 调用（兼容 Node.js） ==========
function httpsRequest(url, options) {
  const https = require('https');
  const http = require('http');
  const { URL } = require('url');

  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const req = mod.request(url, {
      method: options.method || 'POST',
      headers: options.headers || {},
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, body: body }));
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function callAI(systemPrompt, paperText) {
  if (!AI_API_KEY) {
    throw new Error('AI_API_KEY 未配置，请在云函数环境变量中设置 API Key');
  }

  const res = await httpsRequest(AI_API_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + AI_API_KEY,
    },
    body: JSON.stringify({
      model: AI_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: '摘要以下论文（不要开场白，直接按格式输出）：\n\n' + paperText },
      ],
      temperature: 0.3,
      max_tokens: 500,
    }),
  });

  if (res.statusCode !== 200) {
    throw new Error('AI API 错误 ' + res.statusCode + ': ' + res.body);
  }

  const data = JSON.parse(res.body);
  return data.choices[0].message.content;
}

// ========== 数据库存储 ==========
async function saveToDb(userId, existQuery, fileID, fileName, role, summary, pageCount, textLength, now) {
  if (existQuery.data.length > 0) {
    const doc = existQuery.data[0];
    const summaries = doc.summaries || {};
    summaries[role] = { text: summary, generatedAt: now };
    await db.collection('documents').doc(doc._id).update({
      data: {
        summaries,
        paperInfo: { pageCount, textLength, updatedAt: now },
        updatedAt: now,
      },
    });
  } else {
    const summaries = {};
    summaries[role] = { text: summary, generatedAt: now };
    await db.collection('documents').add({
      data: {
        userId,
        fileID,
        fileName: fileName || '',
        summaries,
        paperInfo: { pageCount, textLength, createdAt: now },
        createdAt: now,
        updatedAt: now,
      },
    });
  }
}

// ========== OCR 视觉识别 ==========
async function callVisionAPI(fileID, endpoint, apiKey) {
  const res = await cloud.downloadFile({ fileID });
  const base64 = res.fileContent.toString('base64');
  const model = process.env.OCR_MODEL || 'gpt-4o';

  const https = require('https');
  const http = require('http');
  const { URL } = require('url');

  return new Promise((resolve, reject) => {
    const parsed = new URL(endpoint);
    const mod = parsed.protocol === 'https:' ? https : http;
    const body = JSON.stringify({
      model,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: '请识别并提取这份扫描文档中的所有文字内容。只输出识别到的文字，不要添加任何解释。' },
          { type: 'image_url', image_url: { url: 'data:application/pdf;base64,' + base64 } },
        ],
      }],
      max_tokens: 4000,
    });

    const req = mod.request(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
      },
    }, (resp) => {
      let data = '';
      resp.on('data', (chunk) => { data += chunk; });
      resp.on('end', () => {
        try {
          const result = JSON.parse(data);
          resolve(result.choices[0].message.content);
        } catch (e) {
          reject(new Error('OCR 响应解析失败'));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ========== 确保数据库集合存在 ==========
async function ensureCollection(name) {
  try {
    await db.createCollection(name);
  } catch (e) {
    // 集合已存在时会报错，忽略即可
  }
}

// ========== 主入口 ==========
exports.main = async (event, context) => {
  const { action, fileID, fileName, role } = event;

  if (action === 'generate') {
    const targetRole = role || 'ben';
    const systemPrompt = ROLE_PROMPTS[targetRole];
    if (!systemPrompt) {
      return { success: false, errMsg: '无效的角色: ' + targetRole };
    }

    // 确保 documents 集合存在
    await ensureCollection('documents');

    // 1. 检查是否已有该角色摘要
    const wxContext = cloud.getWXContext();
    const userId = wxContext.OPENID;

    try {
      const existQuery = await db.collection('documents')
        .where({ fileID: fileID, userId: userId })
        .get();

      if (existQuery.data.length > 0) {
        const doc = existQuery.data[0];
        if (doc.summaries && doc.summaries[targetRole]) {
          return {
            success: true,
            summary: doc.summaries[targetRole],
            paperInfo: doc.paperInfo || {},
            cached: true,
          };
        }
      }

      // 2. 提取 PDF 文本
      const { text, pageCount, textLength, isScanned } = await extractPdfText(fileID);

      // 扫描版 PDF：检查是否配置了 OCR
      if (isScanned) {
        const ocrApiKey = process.env.OCR_API_KEY || '';
        const ocrEndpoint = process.env.OCR_API_ENDPOINT || '';
        if (ocrApiKey && ocrEndpoint) {
          // 有 OCR API 配置，尝试用视觉模型识别
          try {
            const ocrText = await callVisionAPI(fileID, ocrEndpoint, ocrApiKey);
            if (ocrText && ocrText.trim().length > 50) {
              const summary = await callAI(systemPrompt,
                '以下是从扫描版 PDF 中 OCR 识别的文本，可能存在少量识别错误，请尽力生成摘要：\n\n' + ocrText.substring(0, 6000));
              const now = new Date().toISOString();
              await saveToDb(userId, existQuery, fileID, fileName, targetRole, summary, pageCount, textLength, now);
              return {
                success: true,
                summary: { text: summary, generatedAt: now },
                paperInfo: { pageCount, textLength },
                cached: false,
                ocrUsed: true,
              };
            }
          } catch (e) {
            console.error('OCR 失败:', e.message);
          }
        }
        return {
          success: false,
          errMsg: '该 PDF 为扫描版（图片型），无法提取文本。请使用文字型 PDF，或在云函数环境变量中配置 OCR_API_KEY / OCR_API_ENDPOINT / OCR_MODEL 以启用 OCR 识别。',
          isScanned: true,
        };
      }

      // 3. 调用 AI 生成摘要
      const summary = await callAI(systemPrompt, text);
      const now = new Date().toISOString();

      // 4. 存储到数据库
      await saveToDb(userId, existQuery, fileID, fileName, targetRole, summary, pageCount, textLength, now);

      return {
        success: true,
        summary: { text: summary, generatedAt: now },
        paperInfo: { pageCount, textLength },
        cached: false,
      };
    } catch (err) {
      console.error('生成摘要失败:', err);
      return { success: false, errMsg: err.message };
    }
  }

  if (action === 'get') {
    const wxContext = cloud.getWXContext();
    const targetRole = event.role || 'ben';

    try {
      const query = await db.collection('documents')
        .where({ fileID: fileID, userId: wxContext.OPENID })
        .get();

      if (query.data.length > 0) {
        const doc = query.data[0];
        return {
          success: true,
          summaries: doc.summaries || {},
          paperInfo: doc.paperInfo || {},
          tags: doc.tags || [],
          isFavorite: doc.isFavorite || false,
          fileName: doc.fileName,
        };
      }
      return { success: true, summaries: {}, paperInfo: {} };
    } catch (err) {
      return { success: false, errMsg: err.message };
    }
  }

  if (action === 'list') {
    const wxContext = cloud.getWXContext();
    try {
      await ensureCollection('documents');
      const query = await db.collection('documents')
        .where({ userId: wxContext.OPENID })
        .orderBy('updatedAt', 'desc')
        .limit(20)
        .get();

      return { success: true, list: query.data };
    } catch (err) {
      return { success: false, errMsg: err.message };
    }
  }

  // ========== 笔记操作 ==========
  if (action === 'noteAdd') {
    const wxContext = cloud.getWXContext();
    const { fileID, fileName, excerpt, annotation, color, page, annoType, annoData } = event;
    try {
      await ensureCollection('notes');
      const now = new Date().toISOString();
      const doc = {
        userId: wxContext.OPENID,
        fileID: fileID || '',
        fileName: fileName || '',
        excerpt: excerpt || '',
        annotation: annotation || '',
        color: color || '#1a73e8',
        createdAt: now,
      };
      if (page !== undefined) doc.page = page;
      if (annoType) doc.annoType = annoType;
      if (annoData) doc.annoData = annoData;
      const res = await db.collection('notes').add({ data: doc });
      return { success: true, noteId: res._id };
    } catch (err) {
      return { success: false, errMsg: err.message };
    }
  }

  if (action === 'noteList') {
    const wxContext = cloud.getWXContext();
    const { filterFileID } = event;
    try {
      await ensureCollection('notes');
      const where = { userId: wxContext.OPENID };
      if (filterFileID) where.fileID = filterFileID;
      const query = await db.collection('notes')
        .where(where)
        .orderBy('createdAt', 'desc')
        .limit(50)
        .get();
      return { success: true, list: query.data };
    } catch (err) {
      return { success: false, errMsg: err.message };
    }
  }

  if (action === 'updateDoc') {
    const wxContext = cloud.getWXContext();
    const { fileID, tags, isFavorite } = event;
    try {
      const existQuery = await db.collection('documents')
        .where({ fileID: fileID, userId: wxContext.OPENID })
        .get();
      if (existQuery.data.length === 0) {
        return { success: false, errMsg: '文档不存在' };
      }
      const doc = existQuery.data[0];
      const update = {};
      if (tags !== undefined) update.tags = tags;
      if (isFavorite !== undefined) update.isFavorite = isFavorite;
      await db.collection('documents').doc(doc._id).update({
        data: { ...update, updatedAt: new Date().toISOString() },
      });
      return { success: true };
    } catch (err) {
      return { success: false, errMsg: err.message };
    }
  }

  if (action === 'deleteDoc') {
    const wxContext = cloud.getWXContext();
    const { fileID } = event;
    try {
      const existQuery = await db.collection('documents')
        .where({ fileID: fileID, userId: wxContext.OPENID })
        .get();
      if (existQuery.data.length === 0) {
        return { success: false, errMsg: '文档不存在' };
      }
      // 删除数据库记录
      await db.collection('documents').doc(existQuery.data[0]._id).remove();
      // 删除云存储文件
      try { await cloud.deleteFile({ fileList: [fileID] }); } catch (e) {}
      // 删除关联笔记
      try { await db.collection('notes').where({ fileID: fileID }).remove(); } catch (e) {}
      return { success: true };
    } catch (err) {
      return { success: false, errMsg: err.message };
    }
  }

  if (action === 'updateProgress') {
    const wxContext = cloud.getWXContext();
    const { fileID, progress } = event;
    try {
      const existQuery = await db.collection('documents')
        .where({ fileID: fileID, userId: wxContext.OPENID })
        .get();
      if (existQuery.data.length > 0) {
        const doc = existQuery.data[0];
        const info = doc.paperInfo || {};
        info.progress = progress;
        await db.collection('documents').doc(doc._id).update({
          data: { paperInfo: info, updatedAt: new Date().toISOString() },
        });
      }
      return { success: true };
    } catch (err) {
      return { success: false, errMsg: err.message };
    }
  }

  if (action === 'noteDelete') {
    const { noteId } = event;
    try {
      await db.collection('notes').doc(noteId).remove();
      return { success: true };
    } catch (err) {
      return { success: false, errMsg: err.message };
    }
  }

  if (action === 'downloadPaper') {
    const { pdfUrl, fileName } = event;
    if (!pdfUrl) return { success: false, errMsg: '缺少 PDF 地址' };
    try {
      const pdfBuffer = await downloadFile(pdfUrl);
      const cloudPath = 'papers/' + Date.now() + '_' + (fileName || 'paper') + '.pdf';
      const upload = await cloud.uploadFile({
        cloudPath: cloudPath,
        fileContent: pdfBuffer,
      });
      return { success: true, fileID: upload.fileID };
    } catch (err) {
      return { success: false, errMsg: err.message };
    }
  }

  if (action === 'mindmap') {
    const { summaryText } = event;
    if (!summaryText || !summaryText.trim()) {
      return { success: false, errMsg: '缺少摘要内容' };
    }
    try {
      const treeText = await callAI(
        '请将以下论文摘要转化为结构化思维导图大纲。严格按以下格式输出：每行一个节点，用 "##" 表示一级标题，"###" 表示二级标题，"-" 开头表示叶子节点。只输出大纲，不要任何解释。\n\n示例格式：\n## 研究背景\n- 关键问题\n- 前人工作的局限\n## 核心方法\n### 方法步骤一\n- 技术细节 A\n- 技术细节 B\n### 方法步骤二\n- 技术细节 C\n## 主要发现\n- 发现一\n- 发现二\n## 局限与展望\n- 局限一\n- 未来方向',
        summaryText.trim()
      );
      const tree = parseMindmapTree(treeText);
      return { success: true, tree: tree };
    } catch (err) {
      return { success: false, errMsg: err.message };
    }
  }

  if (action === 'translate') {
    const { text } = event;
    if (!text || !text.trim()) {
      return { success: false, errMsg: '缺少翻译文本' };
    }
    try {
      const translated = await callAI(
        '你是一个专业的中英翻译引擎。请将用户输入的英文准确翻译为中文。要求：1) 保持学术术语的准确性 2) 语句通顺自然 3) 只输出翻译结果，不要添加任何解释。',
        text.trim()
      );
      return { success: true, translated: translated };
    } catch (err) {
      return { success: false, errMsg: err.message };
    }
  }

  if (action === 'searchPapers') {
    const { query } = event;
    if (!query || !query.trim()) {
      return { success: false, errMsg: '请输入搜索关键词' };
    }
    try {
      const result = await searchSemanticScholar(query.trim());
      return { success: true, papers: result };
    } catch (err) {
      return { success: false, errMsg: err.message };
    }
  }

  if (action === 'getText') {
    const { fileID, tempFileURL, pdfBase64 } = event;
    if (!fileID && !tempFileURL && !pdfBase64) return { success: false, errMsg: '缺少文件参数' };
    try {
      let pdfBuffer;
      if (pdfBase64) {
        // 客户端直接传 base64
        pdfBuffer = Buffer.from(pdfBase64, 'base64');
      } else if (tempFileURL) {
        // 客户端已获取临时链接，直接 HTTP 下载
        pdfBuffer = await httpsDownload(tempFileURL);
      } else {
        // 传统方式：fileID 下载
        pdfBuffer = await downloadFromFileID(fileID);
      }
      const result = await extractPdfTextFromBuffer(pdfBuffer);
      if (result.isScanned) {
        return { success: false, errMsg: '该 PDF 为扫描版，无法提取文字', isScanned: true };
      }
      const rawParagraphs = result.text.split(/\n\s*\n/).filter(function(p) {
        return p.trim().length > 0;
      });
      var paragraphs = rawParagraphs;
      if (rawParagraphs.length < 3) {
        paragraphs = result.text.split(/\n/).filter(function(p) {
          return p.trim().length > 0;
        });
      }
      paragraphs = paragraphs.map(function(p, i) {
        return {
          id: 'p' + (i + 1),
          text: p.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim(),
        };
      });
      return { success: true, paragraphs: paragraphs, pageCount: result.pageCount };
    } catch (err) {
      return { success: false, errMsg: err.message };
    }
  }

  if (action === 'getPages') {
    const { fileID, pdfBase64 } = event;
    if (!fileID && !pdfBase64) return { success: false, errMsg: '缺少文件参数' };
    try {
      let pdfBuffer;
      if (pdfBase64) {
        pdfBuffer = Buffer.from(pdfBase64, 'base64');
      } else {
        pdfBuffer = await downloadFromFileID(fileID);
      }
      // 先获取页数
      const pageInfo = await extractPdfTextFromBuffer(pdfBuffer);
      const pageCount = pageInfo.pageCount || 1;
      // 用 sharp 逐页渲染为图片
      const sharp = require('sharp');
      const pages = [];
      const maxPages = Math.min(pageCount, 50); // 限制最多50页
      for (let p = 0; p < maxPages; p++) {
        try {
          const imgBuffer = await sharp(pdfBuffer, { page: p, density: 300 })
            .png({ compressionLevel: 3 })
            .toBuffer();
          pages.push('data:image/png;base64,' + imgBuffer.toString('base64'));
        } catch (e) {
          console.error('渲染第' + (p + 1) + '页失败:', e.message);
          break;
        }
      }
      return { success: true, pages: pages, pageCount: pageCount };
    } catch (err) {
      return { success: false, errMsg: err.message };
    }
  }

  return { success: false, errMsg: '未知操作: ' + action };
};

// ========== HTTP 文件下载 ==========
function downloadFile(url) {
  const https = require('https');
  const http = require('http');
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadFile(res.headers.location).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

// ========== Semantic Scholar 搜索 ==========
function searchSemanticScholar(query) {
  const https = require('https');
  const url = 'https://api.semanticscholar.org/graph/v1/paper/search?query=' +
    encodeURIComponent(query) +
    '&limit=10&fields=title,authors,year,abstract,externalIds,url,openAccessPdf';

  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'Accept': 'application/json' } }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (data.data) {
            resolve(data.data.map((p) => ({
              id: p.paperId,
              title: p.title || '未知标题',
              authors: (p.authors || []).map((a) => a.name).join(', '),
              year: p.year || '',
              abstract: p.abstract || '',
              url: p.url || '',
              pdfUrl: (p.openAccessPdf && p.openAccessPdf.url) || '',
              arxivId: (p.externalIds && p.externalIds.ArXiv) || '',
            })));
          } else {
            resolve([]);
          }
        } catch (e) {
          reject(new Error('搜索解析失败'));
        }
      });
    }).on('error', (e) => {
      reject(new Error('搜索服务不可用: ' + e.message));
    });
  });
}

// ========== 思维导图解析 ==========
function parseMindmapTree(text) {
  const lines = text.split('\n').filter((l) => l.trim());
  const root = { children: [] };
  const stack = [{ level: 0, node: root }];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let level = 0;
    let label = trimmed;

    if (trimmed.startsWith('## ')) {
      level = 1;
      label = trimmed.substring(3);
    } else if (trimmed.startsWith('### ')) {
      level = 2;
      label = trimmed.substring(4);
    } else if (trimmed.startsWith('- ')) {
      level = 3;
      label = trimmed.substring(2);
    } else {
      continue;
    }

    const node = { label: label, children: [] };

    // 找到合适的父节点
    while (stack.length > 1 && stack[stack.length - 1].level >= level) {
      stack.pop();
    }
    stack[stack.length - 1].node.children.push(node);
    stack.push({ level: level, node: node });
  }

  return root.children;
}
