# 技术架构设计

## 总体架构图

## 前端
- 框架：微信原生开发
- 页面：index、reader、notes、me
- 核心阅读器：WebView 加载自建 HTML，内嵌 pdf.js
- 通信：小程页面与 WebView 通过 `postMessage` 双向通信

## 后端
- 云函数：`getExplanation`（AI 解析）、`saveNote`、`exportReport` 等
- 数据库：云开发 JSON 文档型数据库，集合 `notes`、`documents`
- 存储：用户上传的 PDF 存储于云存储，获取临时 URL 供 WebView 访问

## AI 模型路由
- 主模型：腾讯混元，用于划词解释、笔记整理
- 辅助模型：DeepSeek，用于复杂公式推导与核验
- 调用方式：云函数内通过 HTTPS API 调用，Prompt 按角色动态拼装

## 关键设计决策
- 百分比坐标锚定：跨设备适配
- 内容哈希：辅助坐标，避免跨版本漂移
- 本地缓存：同一段解释缓存一日