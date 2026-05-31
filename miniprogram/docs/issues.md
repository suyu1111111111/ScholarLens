# 开发问题笔记

## 1. PDF 阅读器

### 1.1 最终方案架构

```
用户选择 PDF → 上传云存储 → 获取 fileID
        ↓
web-view ← HTTP 访问服务 URL ?fileID=xxx
        ↓
云函数下载 PDF → base64 嵌入 HTML → 返回完整页面
        ↓
pdf.js (CDN) 在 web-view 中渲染 PDF
```

**关键配置**：
- 云开发控制台 → HTTP 访问服务 → 路由管理 → 添加路由
- 路由路径：`/pdfReader`，资源类型：云函数，资源对象：`pdfReader`
- HTTP 访问地址：`https://cloud1-d7gomttv5c8fdacc9-1325686913.ap-shanghai.app.tcloudbase.com/pdfReader`
- 云函数代码见 `cloudfunctions/pdfReader/index.js`

### 1.2 踩坑记录

| 方案 | 问题 | 结论 |
|------|------|------|
| `wx.openDocument` | Windows 模拟器调用系统浏览器，非微信内打开 | ❌ 用户体验差 |
| web-view 直接加载 PDF | Chrome 内置 PDF 查看器在微信 web-view 中不工作 | ❌ 白屏 |
| 上传 HTML 到云存储 + web-view | 云存储对所有文件强制加 `Content-Disposition: attachment`，web-view 无法渲染 | ❌ 白屏 |
| 云函数 hash 传参 | web-view / HTTP 重定向会丢失 URL hash | ❌ 参数丢失 |
| 云函数 query 传参 | 需要 HTTP 触发器，权限配置复杂 | 最终采用 |
| GitHub Pages 托管 reader.html + CDN pdf.js | github.io → tcb.qcloud.la 跨域，pdf.js 无法加载 PDF | ❌ CORS |
| PDF base64 嵌入 HTML + 云存储 | 云存储 Content-Disposition: attachment | ❌ 白屏 |
| 无后缀上传到云存储 | 同样被加 Content-Disposition | ❌ 白屏 |

### 1.3 HTTP 访问服务配置步骤

1. 云开发控制台 → 云函数 → 找到函数 → 触发器标签
2. 如果显示"未设定"，点击"前往 HTTP 访问服务并配置"
3. 在路由管理中**添加路由**：
   - 路由路径：`/pdfReader`
   - 资源类型：云函数
   - 资源对象：`pdfReader`
   - 身份认证：不开启
4. 保存后复制 HTTP 访问地址

### 1.4 安全规则

云函数 HTTP 触发需要允许未认证访问，安全规则设为：
```json
{ "*": { "invoke": true } }
```
如果控制台报 `INVALID_VALUE` 错误，可能是 UI bug，改为在控制台直接操作 HTTP 访问服务路由（跳过安全规则配置）。

---

## 2. 项目初始化

### 2.1 修复项目打不开

**症状**：编译报 `Error: timeout` + `enableUpdateWxAppCode of undefined`

**修复**：`project.private.config.json` 中将 `libVersion` 从 `"3.16.0"` 降级为 `"2.33.0"`

### 2.2 Tab 激活色不变化

**症状**：自定义 tabBar 选中态颜色始终为灰色

**原因**：三元表达式嵌套错误
```js
// 错误
style="color: {{selected === index ? (index < 2 ? '#1a73e8' : '#999') : '#999'}};"
// 正确
style="color: {{selected === index ? '#1a73e8' : '#999'}};"
```

### 2.3 Tab 页跳转失败

**症状**：`wx.navigateTo` 跳转到 tabBar 页面无反应

**修复**：tabBar 页面必须用 `wx.switchTab` 跳转，不能传参数，改用 `app.globalData.pendingFile` 传递数据。

---

## 3. 登录

### 3.1 登录流程

- 入口页 `pages/login/login` 在 `app.json` 中置为第一个
- 使用 `wx.getUserProfile()` 获取头像昵称
- 登录态存入 `wx.setStorageSync('isLoggedIn', true)`
- `app.js` 中 `onLaunch` 检查登录态，已登录跳过

### 3.2 登录页面闪烁

**症状**：点击登录后页面连续闪烁

**原因**：`wx.reLaunch` 导致页面重新加载

**修复**：改用 `wx.switchTab` + 三状态 UI（idle / authorizing / entering）

### 3.3 登录页白闪

**症状**：`wx.switchTab` 跳转时出现白色背景

**修复**：`app.json` 中将 `window.backgroundColor` 设为 `#2b2b4b`（与登录页背景一致）

---

## 4. 云函数部署

### 4.1 部署失败常见原因

| 错误 | 原因 | 解决 |
|------|------|------|
| `FUNCTION_NOT_FOUND` | 云函数未部署 | IDE 右键 → 上传并部署 |
| `FunctionName parameter could not be found` | 函数名不存在 | 确认云函数已部署成功 |
| `CreateFailed 状态` | 上次部署异常 | 控制台删除函数后重新部署 |
| `ResourceInUse.FunctionName` | 函数名已存在 | 换用不同函数名 |
| `ResourceNotFound.Function` | 先手动创建再在 IDE 部署 | 顺序对调 |

### 4.2 IDE 中找不到 cloudfunctions 文件夹

`cloudfunctions` 和 `miniprogram` 在项目根目录**同级**。IDE 左侧文件树滚动到最顶部即可看到。

### 4.3 部署前需先选择云环境

右键 `cloudfunctions` **文件夹本身** → 当前环境 → 选择 `cloud1-d7gomttv5c8fdacc9`

---

## 5. Git 部署

### 5.1 首次推送

```bash
git init
git add .
git commit -m "初始化项目"
git remote add origin https://github.com/suyu1111111111/ScholarLens.git
git branch -M main
git push -u origin main
```

### 5.2 配置用户信息

```bash
git config user.name "suyu1111111111"
git config user.email "2308636309@qq.com"
```

### 5.3 .gitignore 关键项

- `project.private.config.json`（IDE 本地配置）
- `node_modules/`
- `*.docx`（备份文件）

---

## 6. AI 摘要功能

### 6.1 架构

```
上传 PDF → cloud.uploadFile → fileID
          → cloud.callFunction('pdfSummary') → pdf-parse 提取文本 → AI API 生成摘要
          → 存储到 documents 集合
```

### 6.2 环境变量

在云函数 `pdfSummary` 的环境变量中配置：
- `AI_API_KEY`：DeepSeek API Key
- `AI_API_ENDPOINT`（可选）：默认 `https://api.deepseek.com/v1/chat/completions`
- `AI_MODEL`（可选）：默认 `deepseek-chat`

### 6.3 三种角色 Prompt

| 角色 | 键值 | 风格 |
|------|------|------|
| 学生 | `ben` | 生活化比喻，通俗讲解 |
| 研究者 | `alice` | 深度拆解，批判思维 |
| 职场 | `david` | 商业洞察，行动建议 |

### 6.4 依赖选型

`pdfjs-dist`（~4MB）部署失败 → 改用 `pdf-parse`（轻量级封装），API 更简洁。

---

## 7. 关键文件索引

| 文件 | 说明 |
|------|------|
| `miniprogram/pages/reader/reader.js` | 阅读器核心逻辑（上传、摘要、web-view） |
| `cloudfunctions/pdfReader/index.js` | HTTP 返回 PDF 阅读器 HTML |
| `cloudfunctions/pdfSummary/index.js` | PDF 文本提取 + AI 摘要 |
| `miniprogram/pages/login/login.js` | 登录页 |
| `miniprogram/app.js` | 全局配置 + 登录态检查 |
| `miniprogram/custom-tab-bar/` | 自定义底部导航 |
