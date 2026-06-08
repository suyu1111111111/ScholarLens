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

> **2026-06-02 修正**：HTTP 访问服务方案已废弃。`app.tcloudbase.com` 测试域名会强制弹出"页面访问提示"拦截页，控制台「安全管控」中无关闭入口（仅含 QPS 限频/防盗链/IP 黑白名单），绑自定义域名才能去除。
>
> 当前方案改为**静态网站托管**：
> ```
> reader.js 调 wx.cloud.getTempFileURL → 获取 PDF 临时 COS 链接
>         ↓
> web-view ← 静态网站托管 URL ?pdfUrl=<COS链接>&page=<进度>
>         ↓
> reader.html（托管在静态网站）用 pdf.js 加载 PDF 并渲染
> ```
> - 静态托管域名：`https://cloud1-d7gomttv5c8fdacc9-1325686913.tcloudbaseapp.com`
> - 部署步骤：控制台 → 静态网站托管 → 文件管理 → 上传 `reader.html`
> - 修改 reader.html 后 URL 带 `?v=N` 绕开 CDN 缓存

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

> **2026-06-02 补充踩坑**：
>
> | 方案 | 问题 | 结论 |
> |------|------|------|
> | 云函数 query 传参（HTTP 访问服务） | 测试域名强制弹出安全提示页，控制台无关闭开关 | ❌ 改用静态托管 |
> | 静态托管 CDN 缓存 | 修改 reader.html 后 CDN 仍返回旧版 | URL 带版本号 `?v=N` 绕开 |
> | reader.html scale=1.5 | 页面远超手机屏宽（612pt×1.5=918px vs 375px 屏） | 改为自适应适配宽度 |
> | 动态缩放太小 | fitWidth 后约 0.59x 文字过小 | 适配宽度为默认 + 缩放按钮手动调 |
> | 连续滚动 vs 逐页翻页 | 逐页模式体验差，用户期望像小说阅读器滑动 | 改为所有页面纵向排列自然滚动 |
> | web-view fixed 工具栏偏移 | 页面横向溢出时 fixed 元素被推出视口 | `overflow-x:hidden` + `z-index:999` + `width:100%` |
> | 返回按钮无效 | postMessage 与 navigateBack 存在竞态 | 延迟 150ms 发进度 + `history.back()` 兜底 |
> | CloudBase 静态托管域名 | 含 `-1325686913` 账号后缀 | 格式：`<env-id>-<account-id>.tcloudbaseapp.com` |

### 1.3 HTTP 访问服务配置步骤

1. 云开发控制台 → 云函数 → 找到函数 → 触发器标签
2. 如果显示"未设定"，点击"前往 HTTP 访问服务并配置"
3. 在路由管理中**添加路由**：
   - 路由路径：`/pdfReader`
   - 资源类型：云函数
   - 资源对象：`pdfReader`
   - 身份认证：不开启
4. 保存后复制 HTTP 访问地址

> **2026-06-02 修正**：此方案已废弃（见 1.1 修正），`pdfReader` 云函数保留备用。当前阅读器改为静态托管 `reader.html` + `getTempFileURL`。

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

> **2026-06-02 补充**：云函数偶发 SSL 报错 `ssl3_read_bytes:tlsv1 alert access denied`（errCode: -504002），为 DeepSeek API 临时拒绝 TLS 连接，非代码问题。重试通常恢复，持续报错则检查 `AI_API_KEY` 是否有效。

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

> **2026-06-02 补充**：
> - `reader.html`（项目根目录）— 独立 PDF 阅读器页面，上传到静态网站托管，支持连续滚动、选中批注、翻译、缩放
> - `pdfReader` 云函数已废弃保留备用，阅读器改用静态托管方案

---

## 8. PDF 图片渲染（mupdf）

### 8.1 sharp 模块原生二进制不兼容

- **现象**: `Could not load the "sharp" module`
- **原因**: sharp 的原生二进制依赖与云函数环境的 glibc 版本不匹配
- **修复**: `sharp` → `mupdf`（基于 WASM，无原生依赖）

### 8.2 mupdf ESM 导入失败

- **现象**: `require() of ES Module`
- **原因**: mupdf 是纯 ESM 包，不支持 CommonJS `require()`
- **修复**: `require('mupdf')` → `await import('mupdf')`

### 8.3 云函数云端安装依赖失败

- **现象**: `String does not match the pattern of "^(?:@[a-z0-9-~][a-z0-9-._~]*/)?..."` 或其他 npm 安装错误
- **原因**: 云端 npm 镜像/网络问题导致 mupdf 包安装失败
- **解决**: 本地 `npm install`（可用淘宝镜像），部署时用「上传所有文件」而非「云端安装依赖」

### 8.4 getPages 响应体超过 6MB

- **现象**: `-504002 The size of HTTP response body exceeds the upper limit (6MB)`
- **原因**: 将所有页面渲染为 base64 返回，总体积超标
- **修复**: 拆分为 `getPages`（仅返回页数）+ `getPage`（按需渲染单页）

### 8.5 getPage 响应超过 1MB

- **现象**: `-501000 response size exceeded 1048576 bytes`
- **原因**: 300 DPI 单页 JPEG base64 约 1-2MB，超出云函数 1MB 响应限制
- **修复**: 渲染后上传到云存储，只返回 `fileID`（几十字节）；失败时降级为 base64 直接返回

### 8.6 云函数 downloadFile 失败

- **现象**: `downloadFile:fail 503003 storage file not exists`
- **原因**: 云函数内 `cloud.downloadFile({ fileID })` 对某些 cloud:// 路径不可用
- **修复**: 客户端先 `getTempFileURL` 获取 HTTPS 链接，传给云函数通过 HTTPS 下载

### 8.7 uploadFile 报错 source.on is not a function

- **现象**: `uploadFile:fail source.on is not a function`
- **原因**: 云函数 `cloud.uploadFile` 传 `Buffer` 在某些环境下不兼容
- **当前方案**: try-catch 包裹，失败降级为 base64 返回（<900KB 时可用）；base64 仍超 1MB 则报错

### 8.8 阅读器页面空白

- **现象**: 进入图片模式后页面空白
- **原因**: `cloud://` fileID 不能直接用作 `<image>` 的 src
- **修复**: 通过 `wx.cloud.getTempFileURL` 将 fileID 转为 HTTPS URL 后再存入 `pageImages`

---

## 9. Canvas 批注系统

### 9.1 批注延迟严重

- **现象**: 每次标注完都要等网络刷新生效
- **原因**: `_saveAnnotation` 先调云函数再刷列表
- **修复**: 本地缓存先上屏（`_allAnnotations.push` + 立即 `_redrawAnnotations`），云函数异步保存后静默刷新

### 9.2 文字批注写不了

- **现象**: 选「文字」工具点击页面无反应
- **原因**: `_isDrawing` 在文字工具时被设为 false，touchEnd 中 `_endAnnoDraw` 因 `_isDrawing` 检查直接 return
- **修复**: 导入手势分发系统 `_gestureType`（'pinch'/'pan'/'draw'/'text'），文字工具直接显示批注弹窗

### 9.3 批注只有上半部分可用

- **现象**: A4 长页面滚动不到下半部分，或下半部分无法批注
- **原因**: 图片容器改为 `overflow:hidden` 后截断了超长页面
- **修复**: 恢复 `overflow-y:auto`，缩放=1 时不拦截单指触摸让页面自然滚动

### 9.4 缩放=1 时无法滑动页面

- **现象**: 缩放=1 时单指滑动不触发页面滚动
- **原因**: 单指 pan 逻辑拦截了所有触摸事件
- **修复**: 仅在 `zoomScale > 1` 时启用单指平移，zoomScale=1 时不拦截

### 9.5 缩放后批注重绘位置/大小错误

- **现象**: 缩放后高亮/下划线框大小不对，手写笔位置偏移
- **原因**: Canvas 重绘时宽高和坐标没有乘 `zoomScale`
- **修复**: `_drawHighlight`/`_drawUnderline` 宽高乘 `zoomScale`；手写笔实时绘制通过 `_screenToCanvas()` 转换坐标

### 9.6 滚动后批注坐标偏移

- **现象**: 图片高度超过屏幕需滚动时，在滚动后绘制的批注保存位置偏移
- **原因**: `_screenToCanvas()` 坐标转换未补偿 `scrollTop`，触摸坐标是相对可视区域的，但Canvas坐标是相对图片顶部的
- **修复**: 添加 `bindscroll` 事件追踪 `_scrollTop`，在 `_screenToCanvas()` 中将 `y` 加回 `scrollTop`

### 9.7 只有上半页能批注，下半页无反应（Canvas 高度塌缩）

- **现象**: PDF 图片模式下只能在上半部分标注，下半页手指滑动无批注反应
- **根因**: Canvas CSS `height:100%` 依赖于 transform 容器的高度，但该容器高度为 `auto`（由图片撑开）。微信小程序 WebView 中 `position:absolute` + `height:100%` 在 `height:auto` 的包含块上无法正确求值，Canvas **实际渲染高度塌缩**，只覆盖了图片的上半部分
- **修复**: 
  - 不用 CSS 百分比，改用显式像素值：`width:{{canvasWidth}}px;height:{{canvasHeight}}px`
  - `onImageLoad` 中测量图片尺寸后 `setData({ canvasWidth, canvasHeight })` 确保 Canvas 元素精确覆盖整张图片

### 9.8 全屏批注功能缺失

- **现象**: PDF图片模式下批注区域被底部工具栏和导航栏压缩，无法最大化利用屏幕空间
- **原因**: 没有全屏批注模式
- **修复**: 
  - 添加 `isFullscreen` 状态和全屏切换按钮（⛶图标）
  - 全屏时隐藏底部批注工具栏和翻页导航栏
  - 全屏时显示半透明浮动迷你工具栏（工具图标+颜色选择+页码导航）
  - Transform容器添加 `position:relative` 确保 Canvas 绝对定位参照正确

---

## 10. 未解决 / 待观察

- **uploadFile Buffer 兼容性**: 云函数 `cloud.uploadFile({ fileContent: buffer })` 不稳定，当前有 base64 降级兜底。需持续观察云函数日志确认 `uploadFile 成功` 频率
- **DeepSeek API 余额**: 曾出现 `402 Insufficient Balance`，AI 摘要功能依赖 API Key 余额
- **安全凭证泄露**: Gitee 个人令牌和密码曾在对话中暴露，需轮换
- **缩放 + 批注坐标精度**: 缩放后百分比坐标转换公式已修正，但需真机多种缩放比例下实测验证

---

## 11. 架构 / 技术债务

- PDF 页数多时（100+ 页），稀疏数组 `_pageImages` 内存占用合理，但翻页体验依赖单页按需加载速度
- 云函数 `getPage` 每次渲染整页 300 DPI JPEG，有缓存空间（如按 fileID+page 缓存 fileID）
- 绘制型批注（高亮/下划线/手写）存储在 `notes` 集合的 `annoData` JSON 字段中，文本型批注也存在同一集合，靠 `annoType` 字段区分
- 云函数 runtime 已设为 Node.js 18.15，与 mupdf 兼容

### 关键文件补充

| 文件 | 说明 |
|------|------|
| `miniprogram/pages/read-text/read-text.js` | 图片模式阅读器（Canvas 批注、缩放、手势） |
| `miniprogram/pages/read-text/read-text.wxml` | 阅读器 UI（图片/文本双模式） |
| `cloudfunctions/pdfSummary/index.js` | 已扩展 getPage/getPages/noteAdd/noteList 等操作 |
