# 安全说明

本文件描述 AI Chat Export 书签的安全边界、实现方式、自动化校验与剩余风险。目标读者是准备审计或安装它的人。

## 承诺

| 承诺 | 实现 | 校验方式 |
| --- | --- | --- |
| 所有代码本地执行 | 书签是一个 `javascript:` URL，整段代码内嵌其中，点击时由浏览器在当前页面内执行，执行完即结束。 | `dist/ai-chat-export.bookmarklet.js` 解码后与 `dist/ai-chat-export.min.js` 逐字节一致（validate.js 检查）。 |
| 禁止第三方上传 | 唯一发请求的模块 `src/core/net.js` 把每个 URL 解析到当前页面的 origin，不同源即拒绝；`mode: 'same-origin'` 让浏览器再拦一次。 | validate.js：`fetch(` 只允许出现在 net.js；产物中恰好一个 `fetch(` 调用点；产物与源码不含任何 `http(s)://` 字面量。 |
| 禁止远程 JavaScript | 不创建 `<script>` / `<iframe>`，不使用 `eval`、`Function`、动态 `import`、`importScripts`。 | validate.js 禁止模式列表。 |
| 禁止遥测、广告、追踪、自动更新 | 代码里没有任何外部地址，也没有版本检查逻辑。想升级只能重新拖一次书签。 | 同上（无绝对 URL）。 |
| 禁止读取不相关的用户信息 | 适配器只访问当前对话的接口路径；`allowedPaths` 是每个适配器声明的正则白名单，net.js 对白名单之外的路径一律拒绝。 | `test/net.test.js`；validate.js 检查 net.js 含白名单逻辑。 |
| 禁止读取或外传 Cookie / Token | 脚本不读 `document.cookie`、`localStorage`、`sessionStorage`、`indexedDB`。浏览器自行附带同源会话（`credentials: 'same-origin'`）。 | validate.js 禁止模式；产物中不含 `cookie` / 存储关键字。 |
| 仅允许必要的同源读取 | 方法限定 GET / POST；`redirect: 'error'`，服务器重定向直接失败，请求不会被带到别处。 | validate.js 检查 `redirect: 'error'`、`credentials: 'same-origin'`。 |
| 不修改任何聊天内容 | 适配器只读 DOM 与接口响应；写入页面的只有导出面板（`createElement`）与一个瞬时的下载链接。 | 代码审查；`test/dist.test.js` 在模拟 Trusted Types 下执行产物（`innerHTML` / `DOMParser` 抛错）。 |
| 不使用远程 eval | 同“禁止远程 JavaScript”。 | — |
| 不持久存储聊天内容 | 导出内容只进入 `Blob` → `URL.createObjectURL` → `<a download>`，下载后 1 秒撤销对象 URL。无任何存储 API 调用。 | validate.js 禁止模式。 |
| 可审计的固定版本 | 构建不含时间戳，同一源码总是产生同一字节序列；`dist/*.sha256` 与 `install.html` 上印有同一哈希。 | `test/security.test.js` 重新构建并比对哈希；validate.js 比对哈希与 `install.html` 内嵌代码。 |

## 两个需要说明的凭据

这两项都是“当前平台必要的同源读取”，但值得单独说明：

1. **ChatGPT 访问令牌。** `/backend-api/conversation/{id}` 需要 `Authorization: Bearer` 头。书签向同源的 `/api/auth/session` 请求一次，把返回的 `accessToken` 作为**同一域名下**第二个请求的请求头，用后即弃：不写入导出文件（`test/adapter-chatgpt.test.js` 断言）、不打印、不存储、不发往任何其他地址。ChatGPT 网页本身每次加载也做同样的事。
2. **Gemini 页面令牌。** `batchexecute` 需要页面全局变量 `WIZ_global_data.SNlM0e`（`at` 参数）。书签从 `window` 读取这个字符串（不是 Cookie），只放进发往 `gemini.google.com` 自身的 POST 表单。

如果你的威胁模型不接受这两点，可以只使用页面读取路径：把对应适配器的 `fromApi` 删掉再构建即可，工具会自动退回 DOM 读取（结果标记为 partial）。

## 浏览器层面的约束

- **同源策略**：`javascript:` 书签运行在当前标签页的 origin 内，看不到其他站点的 Cookie、存储或 DOM。多平台支持 = 多份适配器，而不是跨站读取。
- **CSP / Trusted Types**：chatgpt.com 与 gemini.google.com 启用 `require-trusted-types-for 'script'`，任何 `innerHTML` / `DOMParser` 字符串注入都会抛错。本项目所有 UI 和转换都基于 DOM 节点操作，端到端测试模拟了这种环境。
- **权限**：书签没有扩展权限，无法访问浏览历史、其他标签页、文件系统或剪贴板之外的任何东西（本工具也不读剪贴板）。

## 静态安全校验（`npm run audit:security`）

`src/security/validate.js` 在 Node 中运行，不随书签发布。它检查：

- `src/` 与压缩产物中的禁止模式：`eval`、`Function`、动态 `import`、`importScripts`、`XMLHttpRequest`、`WebSocket`、`EventSource`、`sendBeacon`、`document.cookie`、`localStorage`、`sessionStorage`、`indexedDB`、Cache API、Service Worker、`innerHTML`、`outerHTML`、`insertAdjacentHTML`、`DOMParser`、`document.write`、`<script>` / `<iframe>` 创建、扩展 API、字符串形式的 `setTimeout` / `setInterval`、设备 / 凭据 API、`window.open`、页面跳转。
- `fetch(` 只允许在 `src/core/net.js` 出现；产物中恰好一个 `fetch(` 调用点。
- net.js 必须包含同源判断、路径白名单、`redirect: 'error'`、`credentials: 'same-origin'`。
- 源码与产物不含任何绝对 `http(s)://` 地址（白名单为空）。
- 书签能解码、以 `javascript:` 开头、解码结果等于 `void ` + 压缩包、SHA-256 与 `dist/*.sha256` 一致、大小不超过 64 KB。
- `install.html` 内嵌的 href 与书签逐字节一致；`install.html` 自身不加载任何远程脚本、样式、图片或 iframe（页面设置了 `default-src 'none'` 的 CSP）。

报告写入 `dist/security-report.json`，当前结果：763 项检查全部通过。

## 如何自行审计

```bash
npm install
npm run verify                                  # 构建 + 安全校验 + 测试
shasum -a 256 dist/ai-chat-export.bookmarklet.js
cat dist/ai-chat-export.bookmarklet.sha256      # 与 install.html 页脚上的哈希对照
node -e "console.log(decodeURI(require('fs').readFileSync('dist/ai-chat-export.bookmarklet.js','utf8').slice(11)))" | less
```

可读版打包结果在 `dist/ai-chat-export.js`，与压缩版来自同一次 esbuild 调用。

## 剩余风险与不在范围内的事项

- **导出文件本身就是你的对话。** 它以明文保存在你选择的下载目录，请像对待任何私密文档一样对待它。
- **附件链接需要登录。** 图片 / 文档的 URL 指向平台自己的接口，只有登录同一账号的浏览器能打开；二进制内容不会被下载。
- **平台变更。** 内部接口和页面结构可能随时改变。接口失效时工具退回页面读取并明确标注不完整；页面结构变化可能导致提取为空，此时面板会报告“没有找到消息”，不会静默产出残缺文件。
- **书签本身的来源。** 只从你自己构建或校验过哈希的 `install.html` 安装。任何第三方托管的“同名书签”都应视为不可信。
- **依赖。** 运行时零依赖。构建 / 测试依赖 `esbuild` 与 `jsdom`，它们不进入产物。

## 报告问题

在仓库中提交 issue 时，请附上平台、URL 形态（去掉对话 ID）、面板提示文字与 `dist/build-info.json` 中的哈希。**不要附上 HAR 文件或接口响应原文**，它们包含你的会话凭据与对话内容。
