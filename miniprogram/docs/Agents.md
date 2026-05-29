# Agents.md

## 项目名称
智阅·深析（ScholarLens）—— 基于大模型的探究式学术论文精读微信小程序

## 技术栈
- 前端：微信原生 + WebView (pdf.js)
- 后端：微信云开发（云函数、云数据库、云存储）
- AI 模型：腾讯混元（主）、DeepSeek（辅）
- 本地 AI 助手：Claude Code（通过 DeepSeek API）

## 开发原则
1. 所有代码必须遵循微信小程序开发规范，文件命名、路径注意大小写。
2. 优先使用微信云开发能力（云函数、云数据库），减少自建后端。
3. 核心逻辑（划词、笔记锚定、AI 解析）先以学生模式（Ben）实现，再扩展其他模式。
4. WebView 中的 pdf.js 操作必须与小程序的通信使用 `wx.miniProgram.postMessage`，小程序的回复通过修改 WebView 的 URL 参数。
5. 任何涉及大模型调用的云函数必须包含：角色模式 Prompt 注入、上下文组装、错误处理、流式输出预留。
6. 笔记数据结构必须支持扩展标签，锚定采用百分比坐标 + contentHash。
7. 禁止在代码中硬编码 API Key，所有密钥通过云函数环境变量注入。
8. 每次修改后请确保四个 Tab 页的基础布局不被破坏，优先保证阅读器页面稳定。

## 目录结构参考
- miniprogram/pages/index/ – 首页
- miniprogram/pages/reader/ – 核心阅读器
- miniprogram/pages/notes/ – 笔记列表
- miniprogram/pages/me/ – 个人中心
- miniprogram/utils/pdfjs/ – pdf.js 库及 reader.html
- cloud/ – 云函数目录

## 角色模式
- ben：学生模式，生活化比喻，鼓励学习
- david：职场模式，商业洞察，行动项
- alice：研究者模式，深度拆解，批判思维

严格遵守以上规则，确保代码质量与项目一致性。