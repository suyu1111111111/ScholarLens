const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

// ========== 角色 Prompt 模板 ==========
const ROLE_PROMPTS = {
  ben: `你是一位耐心、风趣的大学导师，擅长用生活化的比喻解释学术概念。你的学生是本科/硕士生，基础较弱。
请用以下格式生成摘要：
1. 【一句话概括】用一句话说清楚这篇论文做了什么（< 50 字）
2. 【背景与动机】用生活化比喻解释为什么要做这个研究
3. 【核心方法】用通俗语言解释用了什么方法，打个比方
4. 【主要发现】列出 3 个最重要的发现，每个用一句话
5. 【学习建议】给想深入理解这篇论文的学生 2 条建议

要求：通俗易懂，多用比喻，避免公式和术语，总共不超过 600 字。`,

  alice: `你是一位资深学术审稿人，拥有 15 年顶会审稿经验。你对方法学和实验设计极其敏锐。
请用以下格式生成摘要：
1. 【论文定位】在所属领域的贡献层级（增量/改进/突破）
2. 【方法拆解】分步骤剖析核心方法，点出每个步骤的设计动机
3. 【实验评估】评估实验设计的合理性，指出潜在缺陷
4. 【关键局限】列出 3 个你审稿时会指出的局限性
5. 【延伸思考】提出 2 个可深入的方向或可交叉的领域

要求：学术严谨，直指要害，批判性思维，总共不超过 600 字。`,

  david: `你是一位顶尖咨询公司的技术分析师，正在为高管准备一份 5 分钟速读报告。
请用以下格式生成摘要：
1. 【一句话价值】这篇论文的商业/技术价值（< 30 字）
2. 【核心洞察】3 个关键洞察，bullet point 格式
3. 【行业影响】这项研究可能对哪些行业/产品产生影响
4. 【技术就绪度】TRL 评估 + 距离落地还差什么
5. 【行动建议】给 CTO/产品总监的 2 条具体建议

要求：精炼、有商业视角、可执行、不啰嗦，总共不超过 500 字。`,
};

// API 配置（通过云函数环境变量注入）
const AI_API_KEY = process.env.AI_API_KEY || '';
const AI_API_ENDPOINT = process.env.AI_API_ENDPOINT || 'https://api.deepseek.com/v1/chat/completions';
const AI_MODEL = process.env.AI_MODEL || 'deepseek-chat';

// ========== PDF 文本提取 ==========
async function extractPdfText(fileID) {
  const res = await cloud.downloadFile({ fileID });
  const pdfBuffer = Buffer.from(res.fileContent);
  const pdfParse = require('pdf-parse');
  const data = await pdfParse(pdfBuffer);

  const maxChars = 8000;
  const truncated = data.text.length > maxChars
    ? data.text.substring(0, maxChars) + '...[文本已截断]'
    : data.text;

  return { text: truncated, pageCount: data.numpages, textLength: data.text.length };
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
        { role: 'user', content: '请为以下论文生成摘要：\n\n' + paperText },
      ],
      temperature: 0.7,
      max_tokens: 2000,
    }),
  });

  if (res.statusCode !== 200) {
    throw new Error('AI API 错误 ' + res.statusCode + ': ' + res.body);
  }

  const data = JSON.parse(res.body);
  return data.choices[0].message.content;
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
      const { text, pageCount, textLength } = await extractPdfText(fileID);

      // 3. 调用 AI 生成摘要
      const summary = await callAI(systemPrompt, text);
      const now = new Date().toISOString();

      // 4. 存储到数据库
      if (existQuery.data.length > 0) {
        // 更新已有文档
        const doc = existQuery.data[0];
        const summaries = doc.summaries || {};
        summaries[targetRole] = { text: summary, generatedAt: now };

        await db.collection('documents').doc(doc._id).update({
          data: {
            summaries: summaries,
            paperInfo: {
              pageCount: pageCount,
              textLength: textLength,
              updatedAt: now,
            },
            updatedAt: now,
          },
        });
      } else {
        // 新建文档记录
        const summaries = {};
        summaries[targetRole] = { text: summary, generatedAt: now };

        await db.collection('documents').add({
          data: {
            userId: userId,
            fileID: fileID,
            fileName: fileName || '',
            summaries: summaries,
            paperInfo: {
              pageCount: pageCount,
              textLength: textLength,
              createdAt: now,
            },
            createdAt: now,
            updatedAt: now,
          },
        });
      }

      return {
        success: true,
        summary: { text: summary, generatedAt: now },
        paperInfo: { pageCount: pageCount, textLength: textLength },
        cached: false,
      };
    } catch (err) {
      console.error('生成摘要失败:', err);
      return { success: false, errMsg: err.message };
    }
  }

  if (action === 'get') {
    // 获取已有摘要
    const wxContext = cloud.getWXContext();
    const targetRole = event.role || 'ben';

    try {
      const query = await db.collection('documents')
        .where({ fileID: fileID, userId: wxContext.OPENID })
        .get();

      if (query.data.length > 0 && query.data[0].summaries) {
        return {
          success: true,
          summaries: query.data[0].summaries,
          paperInfo: query.data[0].paperInfo || {},
        };
      }
      return { success: true, summaries: {}, paperInfo: {} };
    } catch (err) {
      return { success: false, errMsg: err.message };
    }
  }

  return { success: false, errMsg: '未知操作: ' + action };
};
