# Universal AI Chat Exporter

*[English README](README.en.md)*

一个书签（Bookmarklet），在 **ChatGPT / Claude / Gemini / Grok / Perplexity / Microsoft Copilot** 的对话页面上一键导出当前完整对话为 **Markdown、JSON 或 HTML**。

- 不需要浏览器扩展，不需要打开开发者工具，不需要改代码。
- 全部代码内嵌在书签里，**只在你点击时运行**，运行结束即退出。
- **零上传、零遥测、零远程脚本**：只向你当前打开的平台发出它自己也在用的同源读取请求。
- 所有平台的导出结果遵循**同一套 JSON 数据结构**，方便迁移、搜索与分析。

> 本工具只读取**你当前打开的那个平台、那条对话**。跨平台兼容不等于跨站读取：书签运行在哪个站点，就只能看到那个站点，这是浏览器同源策略决定的，也是本项目刻意遵守的边界。

## 安装

1. 在本地用浏览器打开 [`install.html`](install.html)。
2. 把页面上的 **📤 AI Chat Export** 按钮拖到书签栏（Chrome：`⌘⇧B` / `Ctrl+Shift+B` 显示书签栏）。
3. 没有拖拽条件时，展开页面底部的“手动安装 / 校验”，复制书签代码，新建书签并粘贴到“网址”栏。

`install.html` 由构建脚本生成，内嵌的代码与 `dist/ai-chat-export.bookmarklet.js` 逐字节一致，页面上同时印有该文件的 SHA-256。

## 使用

1. 打开一个具体对话：`chatgpt.com/c/…`、`claude.ai/chat/…`、`gemini.google.com/app/…`、`grok.com/c/…`、`perplexity.ai/search/…` 或 `copilot.microsoft.com/chats/…`。
2. 点击书签栏上的 **📤 AI Chat Export**。
3. 右上角出现面板：显示读取到的消息数、数据来源（接口 / 页面）、完整性提示与警告。
4. 点击 **Markdown** / **JSON** / **HTML** 下载。文件名形如 `claude-2026-10-16-对话标题.md`。

在不受支持的网站上点击，面板会提示“当前网站不受支持”；在 DeepSeek 上会提示“已识别但尚未实现”（见下表）。

## 平台支持与验证状态

| 平台 | 读取方式 | 状态 | 说明 |
| --- | --- | --- | --- |
| ChatGPT (`chatgpt.com`, `chat.openai.com`) | 同源接口优先（`/api/auth/session` → `/backend-api/conversation/{id}`），失败时读取页面 | **已在真实页面验证**（2026-10-16，登录账号接口路径 + 未登录页面路径） | 接口路径拿到完整树（含编辑 / 重新生成分支）、时间戳、模型名、附件元数据；被放弃的版本进入 `inactiveMessages`。页面路径只含已渲染消息，标记为 partial。 |
| Claude (`claude.ai`) | 同源接口优先（`/api/organizations` → `/api/organizations/{org}/chat_conversations/{id}?tree=True&…`），失败时读取页面 | **已在真实页面验证**（2026-10-16，登录账号接口路径） | 不读 Cookie，组织 ID 通过同源接口列出。导出 artifact / 生成文件（支持现行 `Write` 与旧版 `artifacts` / `create_file` 两套工具名）、附件提取文本、工具调用标记；thinking 与 tool_result 不导出。页面路径未实测。 |
| Gemini (`gemini.google.com`) | 同源 `batchexecute` RPC（`hNvQHb`）优先，逐条校验记录形状，失败时读取页面 | **已在真实页面验证**（2026-10-16，登录账号接口路径） | 任何形状不符都会放弃接口路径并提示。只把有文本的候选计为版本（空候选槽不算分支）。Gemini 懒加载历史，页面路径只含已加载轮次，未实测。 |
| Grok (`grok.com`) | 同源接口优先（`/rest/app-chat/conversations/{id}/response-node` → `…/load-responses`），失败时读取页面 | **已在真实页面验证**（2026-10-16，匿名会话接口路径） | 接口路径取完整响应树，按最新响应回溯当前分支，其余分支进入 `inactiveMessages`；导出引用来源、被中断标记。页面路径只含已渲染消息，标记为 partial，未实测。 |
| Perplexity (`perplexity.ai`) | 同源接口优先（`/rest/thread/{slug}`，按 `next_cursor` 翻页），失败时读取页面 | **已在真实页面验证**（2026-10-16，匿名会话接口路径） | 每个 entry 为一问一答：`query_str` 与 `ask_text` 块的 Markdown 原文；`web_result_block` / `sources_mode_block` 作为引用来源导出（实测 10 条）。仅 Cookie 鉴权。页面路径标记为 partial，未实测。 |
| Microsoft Copilot (`copilot.microsoft.com`, `copilot.com`) | 同源接口优先（`/c/api/conversations/{id}/history?api-version=2`），失败时读取页面 | **experimental**（未实测；登录会话的网页自身还会附带存于 localStorage 的令牌，本项目不读存储，接口可能返回 401，届时自动退回页面读取） | 只导出 `text` 内容块；标题取自侧栏当前对话。`m365.cloud.microsoft`（Microsoft 365 Copilot Chat）是另一产品，不支持。 |
| DeepSeek (`chat.deepseek.com`) | — | **planned**（仅识别；适配器已实现但未打包） | `src/adapters/deepseek.js` 已实现接口路径（`/api/v0/chat/history_messages`）与页面路径并有测试，但加入后书签超过 64 KB，且其接口需要网页存于 localStorage 的令牌（本项目不读取），可靠性最低，因此未注册。需要时在 `src/core/registry.js` 中用它替换 `planned.js` 的占位项后重新构建。 |

“已验证”只用于真实页面上跑过完整构建产物的情况，详见 [`TEST-RESULTS.md`](TEST-RESULTS.md)。

## 导出内容

- **角色、顺序、标题、时间戳、模型名**（平台提供时）。
- **Markdown 原文**：接口路径直接取平台存储的 Markdown 源；页面路径由内置的 DOM→Markdown 转换器还原表格、代码块（含语言）、列表、引用、链接、图片，以及 KaTeX / MathML 公式（`$…$`、`$$…$$`）。
- **附件与图片元数据**：文件名、类型、大小、同源链接（需登录才能打开）、平台已提取的文本内容。
- **Artifact / 生成文件 / 工具调用**（Claude）与**引用来源**（ChatGPT、Grok、Perplexity）。
- **分支与重新生成**：Markdown / HTML 导出当前选中的分支，并在有多个版本的消息下标注；JSON 的 `inactiveMessages` 保存其余分支的完整内容。
- **完整性信息**：`completeness`（complete / partial）、`warnings`、被中断或被截断的消息标记。

### 统一数据结构（JSON）

```jsonc
{
  "schemaVersion": "1.0",
  "exporter": { "name": "universal-ai-chat-exporter", "version": "1.0.0" },
  "platform": "claude",
  "source": { "url": "…", "conversationId": "…", "method": "api" },
  "title": "…", "model": "…", "createdAt": "…", "updatedAt": "…", "exportedAt": "…",
  "messages": [
    { "id": "…", "parentId": "…", "role": "user", "createdAt": "…", "model": null,
      "content": [ { "type": "text", "markdown": "…" }, { "type": "attachment", "name": "a.pdf", "url": "…" } ],
      "siblings": 1, "flags": {} }
  ],
  "inactiveMessages": [],
  "stats": { "messages": 2, "user": 1, "assistant": 1, "other": 0, "branchedMessages": 0 },
  "completeness": "complete",
  "warnings": []
}
```

内容块类型：`text`、`code`、`image`、`attachment`、`artifact`、`tool_use`、`citation`。完整定义见 [`src/core/schema.js`](src/core/schema.js)。

## 架构

```
src/
  main.js                  入口：run()
  core/
    run.js                 编排：识别平台 → 接口优先、页面兜底 → 面板 → 下载
    adapter.js             适配器接口定义
    registry.js            hostname → 适配器
    schema.js              统一数据结构、校验、统计
    net.js                 唯一允许发网络请求的模块：同源 + 路径白名单 + 拒绝重定向
    dom-to-markdown.js     页面兜底用的 DOM→Markdown 转换器（无依赖）
    markdown-to-html.js    HTML 导出用的 Markdown→HTML 渲染器（全部转义）
    ui.js                  面板（只用 createElement，兼容 Trusted Types）
    download.js / filename.js / i18n.js
  adapters/
    chatgpt.js  claude.js  gemini.js  grok.js  perplexity.js  copilot.js
    deepseek.js            已实现、未打包（见平台表）
    planned.js             仅识别的占位项（DeepSeek）
    _shared.js             第二批适配器共用的小工具（分支回溯、页面兜底）
  formatters/
    markdown.js  json.js  html.js
  security/
    validate.js            静态安全校验（构建后运行，输出 dist/security-report.json）
build/
  build.js                 esbuild 打包 → dist/ + install.html（确定性构建）
  install.template.html
dist/
  ai-chat-export.js                 可读版打包结果（审计用）
  ai-chat-export.min.js             压缩版（书签实际运行的代码）
  ai-chat-export.bookmarklet.js     javascript: URL
  ai-chat-export.bookmarklet.sha256
  build-info.json  security-report.json
test/                      node:test + jsdom；fixtures/ 为页面结构样本；results/ 为真实页面导出样本
```

### 新增平台

实现一个对象，满足 `src/core/adapter.js` 中的契约：`id`、`name`、`status`、`allowedPaths`、`matches()`、`conversationId()`、`fromDom()`，可选 `fromApi()`。只能通过 `ctx.net` 发请求（同源、白名单内），不得读 Cookie / 存储，不得使用 `innerHTML`。在 `src/core/registry.js` 注册，补充 mock 测试与页面 fixture，然后 `npm run verify`。

## 从源码构建与校验

```bash
npm install
npm run verify     # = build + 安全校验 + 测试
```

- `npm run build`：生成 `dist/` 与 `install.html`。构建不含时间戳，同样的源码总是得到同样的字节与同样的 SHA-256。
- `npm run audit:security`：运行 `src/security/validate.js`，检查源码与产物（禁止 API、网络调用位置、绝对 URL、哈希一致性、`install.html` 内嵌代码一致性等），报告写入 `dist/security-report.json`。
- `npm test`：54 个测试，覆盖数据结构、转换器、格式化器、网络守卫、平台识别、七个适配器的接口 / 页面路径，以及在模拟 Trusted Types 的 jsdom 中执行真实书签产物的端到端测试。

## 已知限制

- 平台内部接口与页面结构没有稳定性承诺。接口失效时工具会自动退回页面读取，并在面板与导出文件中明确标注“可能不完整”。
- 图片与文档附件只导出元数据和同源链接，不下载二进制内容。
- 不导出模型的思考过程（thinking / reasoning）与隐藏的系统消息。
- 第一版不做批量导出全部历史、不做云同步。
- 书签 URL 约 63.6 KB（65 163 字节，上限 65 536 字节，余量不足 0.5 KB，新增平台前需先精简）；Chrome / Edge / Safari 可正常保存，Firefox 对超长书签 URL 的支持请自行验证。

## 安全

见 [`SECURITY.md`](SECURITY.md)。

## 许可证

MIT，见 [LICENSE](LICENSE)。

## 致谢

设计参考了 [claude-chat-exporter](https://github.com/agarwalvishal/claude-chat-exporter)（接口优先、分支线性化、artifact 折叠）与 [chat-dump-bookmarklet](https://github.com/mauriziofonte/chat-dump-bookmarklet)（多平台适配器、Trusted Types 约束、Gemini RPC 结构）。本项目不复用它们的代码。
