# 数据库设计（云开发 MongoDB）

## 1. 笔记集合 `notes`
```json
{
  "_id": "auto",
  "userId": "openid",
  "documentId": "pdf_hash",
  "citation": {
    "type": "text|formula|image",
    "page": 5,
    "position": { "x": 0.15, "y": 0.32, "w": 0.70, "h": 0.05 },
    "contentHash": "sha256",
    "originalText": "..."
  },
  "content": {
    "type": "comment",
    "body": "用户批注"
  },
  "tags": {
    "review": true,        // 学生模式
    "innovation": true,    // 研究者模式
    "urgent": true         // 职场模式
  },
  "createdAt": "ISO8601",
  "updatedAt": "ISO8601"
}