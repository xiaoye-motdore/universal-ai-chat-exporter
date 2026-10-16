# 测试用例与实际测试结果

日期：2026-10-16 · 当前发布构建：`dist/ai-chat-export.bookmarklet.js`，SHA-256 `05aee123b67fa6fe45df3e7167326591f077cd8b778b68dd8938cd5084d6aad9`（65 163 字节）。真实页面验证在构建 `a91f0092…` 上完成；之后的改动只涉及面板样式与文案（`src/core/ui.js`、`src/core/i18n.js`）、导出 HTML 的 CSS 和安装页，适配器与网络层代码未变，自动化测试与安全校验在当前构建上重新通过。

“已验证”在本文件中只有一个含义：**最终构建产物在真实网站页面上执行过，并检查了导出的文件内容**。其他一切都标为未验证。

## 1. 自动化测试（`npm test`）

54 个测试，全部通过。运行环境：Node 24，jsdom。

| 文件 | 覆盖内容 |
| --- | --- |
| `test/schema.test.js` | 时间戳归一化（ISO / 秒 / 毫秒）、空块丢弃、统计与校验 |
| `test/dom-to-markdown.test.js` | 段落 / 强调 / 行内代码 / 链接、代码块语言与 UI 杂项剥离、反引号加宽、嵌套列表、表格、KaTeX 公式还原、标题 / 引用 / 图片 / 分隔线、特殊字符转义 |
| `test/formatters.test.js` | Markdown 原文保留与元数据、分支 / 中断标注、附件引用块、artifact 代码块；JSON 往返；HTML 全量转义、无脚本、不安全链接丢弃；Markdown→HTML 嵌套列表 |
| `test/net.test.js` | 跨域拒绝（含 `//host` 形式）、白名单外路径拒绝、非 GET/POST 拒绝、`credentials: same-origin`、`redirect: error`、`mode: same-origin`、非 2xx 报错 |
| `test/registry.test.js` | 六个平台与 DeepSeek 占位项的 hostname / 对话 ID 识别；`claude.ai.evil.com` 等后缀仿冒不匹配；`x.com/i/grok` 与 `m365.cloud.microsoft` 不匹配 |
| `test/adapter-chatgpt.test.js` | 接口路径：令牌作为请求头、当前分支线性化、连续 assistant 节点合并、隐藏 / 系统 / 工具节点排除、附件、图片指针、引用、中断标记、被放弃分支进入 `inactiveMessages`、令牌不进入导出；接口失败→页面兜底并标记 partial；旧版页面结构；**当前版页面结构（照真实页面建模）** |
| `test/adapter-claude.test.js` | 接口路径：不读 Cookie 的组织发现（多组织遍历）、按 `current_leaf_message_uuid` 走分支、artifact 创建 + 更新折叠（`$&` 不被当作替换模式）、图片 / 文档 / 文本附件、工具标记、thinking 与 tool_result 排除、被放弃分支；缺少 leaf 时按 index 排序并告警；页面兜底 |
| `test/adapter-gemini.test.js` | RPC 信封解析、游标分页、新→旧倒序还原、选中草稿识别、附件文件名收集、令牌不进入导出；记录形状不符→放弃接口路径并告警→页面兜底；缺少页面令牌不猜测 |
| `test/adapter-grok.test.js` | 接口路径：`response-node` 树 + `load-responses` 正文、按最新响应回溯当前分支、被放弃的重新生成进入 `inactiveMessages`、`sender` 大小写、空 `message` 回退 `query`、引用来源（只取 `citedWebSearchResults`）、生成图片、`partial` 中断标记；形状不符→页面兜底并告警；页面 fixture：思考块 / 操作按钮 / 代码块语言标签不泄漏，表格、KaTeX、引用链接还原 |
| `test/adapter-perplexity.test.js` | 接口路径：按 `next_cursor` 翻页并去重、`ask_text` 块优先于 `ask_text_0_markdown`、来源去重、无时区时间按 UTC；形状不符→页面兜底；slug 识别 |
| `test/adapter-copilot.test.js` | 接口路径：`results` 由新到旧反转、`author` 字符串或对象两种形状、system 与 `chainOfThought` 排除、多段 `text` 合并；HTTP 401→页面兜底并告警；侧栏标题；通用 `document.title` 不当作标题；`m365.cloud.microsoft` 不匹配 |
| `test/adapter-deepseek.test.js` | （适配器未打包，测试保留）接口路径：`biz_data` 信封、`fragments` 的 REQUEST / RESPONSE、按 `current_message_id` 回溯分支、THINK 与 `thinking_content` 排除、不发送任何令牌；错误码信封→页面兜底 |
| `test/dist.test.js` | **执行真实构建产物**：在模拟 Trusted Types（`innerHTML` / `DOMParser` 抛错）的 jsdom 中运行，验证面板、三个按钮、下载文件名与内容、只发同源请求（Claude 与 Grok 各一例）；不支持站点提示且零请求；预留平台提示；重复点击只保留一个面板 |
| `test/security.test.js` | 静态安全校验通过（763/763）；重新构建后哈希不变（确定性构建） |

## 2. 静态安全校验（`npm run audit:security`）

763 项检查全部通过，报告见 `dist/security-report.json`。检查项列表见 `SECURITY.md`。

## 3. 真实页面验证

验证方法：在 Claude 桌面应用内置浏览器中打开目标站点，把 `dist/ai-chat-export.bookmarklet.js` 解码后的脚本在页面上下文中执行（与点击书签等价），在页面里挂钩 `URL.createObjectURL` 与 `<a>.click()` 以捕获下载内容，然后点击面板按钮并读取文件。

### 验证方法（登录账号）

在用户自己的 Chrome（Claude in Chrome 扩展）中，用已登录的账号在三个平台各新建一条测试对话（同一提问：两句解释 + Python 代码块 + 两行 Markdown 表格 + LaTeX 公式；Claude 额外要求生成一个 HTML artifact；ChatGPT 上点击“重新生成”制造分支），然后把**最终构建**（SHA-256 `9ae0bc90…`）解码后的脚本在页面上下文执行（与点击书签等价），点击面板三个按钮，对生成的 Markdown / JSON / HTML 做断言检查。断言全部通过的记录如下；更早几轮运行下载的真实文件保存在 `test/results/`（见各节）。

### ChatGPT —— 接口读取路径：已验证

- 页面：`https://chatgpt.com/c/6ad19e5e-…`（登录账号，回答被重新生成一次）。
- 面板：“已读取 2 条消息 · ChatGPT · 来源：接口 · Binary Search Explanation”，并提示 “1 条消息存在其他版本”。
- JSON：`source.method = api`，`model = gpt-6-thinking`，`createdAt` 为接口时间戳，`stats.branchedMessages = 1`，`inactiveMessages` 含 1 条，内容为被放弃的第一版回答；`warnings` 为空。
- Markdown：标题正确；`\`\`\`python` 代码块、`| Best case |` 表格、行内 `\(O(1)\)` 与块级 `\[ \boxed{S(n)…} \]` 公式均为 ChatGPT 存储的原文；含 “This message has 2 versions” 标注；不含 “You said / ChatGPT said / Copy code”。
- HTML：含 `<table>`、`<pre><code class="language-python">`、转义后的标题，无 `<script>`。
- 真实下载文件（上一轮构建，内容逻辑相同）：`test/results/chatgpt-live-api-2026-10-16.md`。
- 网络：只向 `chatgpt.com` 发出 `/api/auth/session` 与 `/backend-api/conversation/{id}` 两个同源请求；令牌不出现在任何导出文件中（JSON 全文检查）。

### ChatGPT —— 页面读取路径：已验证

- 页面：`https://chatgpt.com/uc/6ad19a2a-…`（未登录的匿名对话；登录后的 URL 为 `/c/…`，两者都能识别）。
- 结果：面板显示 “source: page” 并提示接口不可用（未登录）；三个按钮均生成文件。Markdown 逐项核对：标题层级、带 `python` 语言的代码块、GFM 表格、全部 7 处公式还原为 TeX 源；UI 文字未混入。导出原文见 `test/results/chatgpt-live-dom-run2-2026-10-16.md`。
- 第一轮运行发现的缺陷与修复：代码块语言标签 “python” 作为独立段落混入（标签与 `<pre>` 之间存在 HTML 注释节点）。修复后复测通过，第一轮原文保留在 `test/results/chatgpt-live-dom-run1-2026-10-16.md`。
- chatgpt.com 当前页面结构与两个参考项目记录的都不同（`li[data-message-role]`、`[data-assistant-markdown-root]`、`[data-user-message-bubble]`），适配器已按真实结构重写并保留旧结构兜底。

### Claude —— 接口读取路径：已验证

- 页面：`https://claude.ai/chat/3cd6be68-…`（登录账号，回答中包含 Skill / Write / Artifact 三次工具调用与一个 HTML artifact）。
- 面板：“已读取 2 条消息 · Claude · 来源：接口 · Binary search explanation”。
- JSON：`source.method = api`，`model = claude-opus-5-5`，时间戳来自接口；回答的内容块依次为 `text, tool_use, artifact, tool_use, text`。
- Markdown：`**Artifact:** hello.html (File)` 后跟 `\`\`\`html` 代码块（完整文件内容）；工具标记 `*[Tool: Skill — artifact-design]*` 与 `*[Tool: Artifact — Minimal test page that displays the word hello.]*`；Python 代码块、表格、`$$ … $$` 公式为 Claude 存储的原文；不含 thinking 内容，不含 tool_result 文本（“File created successfully / Launching skill / Published …”）。
- HTML：含 `<pre><code class="language-html">` 的 artifact 源码，无 `<script>`。
- 第一轮运行发现的缺陷与修复：claude.ai 当前的工具名为 `Write`（`input.file_path` + `input.content`）、`Artifact`（仅发布，无内容）、`Skill`，而非参考项目记录的 `create_file` / `artifacts`，artifact 内容未导出。适配器已增加对 `Write` 的支持并把其他工具的 `query / command / skill / description / file_path` 作为标记摘要；第一轮下载文件保留在 `test/results/claude-live-api-run1-2026-10-16.md`。
- 组织 ID 通过同源 `/api/organizations` 获取，脚本未读取任何 Cookie。

### Gemini —— 接口读取路径：已验证

- 页面：`https://gemini.google.com/app/b02db24bfa9b1078`（登录账号）。
- 面板：“已读取 2 条消息 · Gemini · 来源：接口 · Binary Search Explanation and Code”。
- JSON：`source.method = api`，`createdAt` 来自 RPC 记录的时间戳，`branchedMessages = 0`，`inactiveMessages` 为空，`warnings` 为空。
- Markdown：Python 代码块、三列表格、行内 `$O(\log n)$` 与块级 `$$k = \lfloor \log_2(n) \rfloor + 1$$` 公式均为 Gemini 存储的原文；不含 “Gemini 说 / 你说 / Export to Sheets”。
- 第一轮运行发现的两个缺陷与修复：（1）标题带 “ - Google Gemini” 后缀，正则只去掉了 “- Gemini”；（2）RPC 记录中与真实回答并列的一个**空候选槽**被当作第二个版本，导致误报 “存在其他版本”。两者已修复（后缀正则、只把有文本的候选计为版本）；第一轮下载文件保留在 `test/results/gemini-live-api-run1-2026-10-16.md`。
- `batchexecute` 的 `at` 令牌取自页面全局 `WIZ_global_data`，只随同源 POST 发送，不出现在导出文件中（JSON 全文检查）。

### Gemini / Claude —— 页面读取路径：未验证

接口路径可用时不会走到页面路径，本次未人为制造接口失败。页面选择器来自 chat-dump-bookmarklet 1.4.0 的实测记录，可能已经变化；若接口失效，面板会显示 “来源：页面” 并标记 partial。

### Grok —— 接口读取路径：已验证

- 页面：`https://grok.com/c/5a1b3d71-…`（匿名使用，经用户批准提交了一条测试提问）。
- 面板：“已读取 2 条消息 · Grok · 来源：接口 · Binary Search Explanation with Code and Table”。
- 网络：书签只发出两个同源请求 `GET /rest/app-chat/conversations/{id}/response-node?includeThreads=true` 与 `POST …/load-responses`。
- JSON：`source.method = api`，`model = grok-3`，两条消息都有接口时间戳，`branchedMessages = 0`，`warnings` 为空；用户消息原文与提交的提问一致。
- Markdown：`\`\`\`python` 代码块、`| Best … | Worst … |` 表格、含 `\lfloor` / `\log` 的公式均为 Grok 存储的原文；不含 “复制 / 已复制 / 工作了 6s” 等 UI 文字。HTML 含 `<pre><code class="language-python">` 与 `<table>`，无 `<script>`。
- 适配器未作改动即通过（第一轮用构建 9ae0bc90 运行，最终构建 a91f0092 复测相同结果）。

### Perplexity —— 接口读取路径：已验证

- 页面：`https://www.perplexity.ai/search/0ba420b6-…`（匿名使用，经用户批准提交了一条测试提问；首次访问出现 Cloudflare 校验页，几秒后自行通过，未做任何绕过）。
- 面板：“已读取 2 条消息 · Perplexity · 来源：接口 · <线程标题>”。Perplexity 的线程标题就是提问全文，文件名会截到 80 个字符。
- 网络：只发出一个同源请求 `GET /rest/thread/{slug}?…`（slug 为 UUID 形式，正则已覆盖）。
- JSON：`source.method = api`，`model = turbo`，时间戳来自接口；回答包含 1 个 `text` 块与 10 个 `citation` 块（与页面显示的 “10 个来源” 一致），`warnings` 为空。
- Markdown：Python 代码块、表格、公式为原文；末尾有 `**Sources:**` 列表；不含 “已研究 / 个来源 / 登录以保存” 等 UI 文字。HTML 含代码块、表格与 Sources，无 `<script>`。
- 适配器未作改动即通过（第一轮用构建 9ae0bc90 运行，最终构建 a91f0092 复测相同结果）。

### Microsoft Copilot —— 未验证

内置浏览器与用户的 Chrome 中 `copilot.microsoft.com` 都跳转到 `copilot.com` 登录页；用户决定暂不登录，因此未运行。接口结构（`/c/api/conversations/{id}/history?api-version=2` 的 `results[].author` / `content[].text`）来自 AIExporter 与一个 Tampermonkey 脚本的记录；已知登录会话的网页自身会附带 MSAL 令牌（存于 localStorage，本项目不读），因此接口可能返回 401，适配器会自动退回页面读取。页面选择器来自 greasyfork 脚本 541051。

### DeepSeek —— 已实现、未打包、未验证

内置浏览器处于登录页。适配器 `src/adapters/deepseek.js` 与测试已完成，但加入后书签为 67 391 字节，超过 64 KB 上限，且其接口需要网页存于 localStorage 的令牌（开源工具均如此发送，仅 Cookie 是否可用未经证实），是四个新平台中可靠性最低的一个，按“可靠性优先于平台数量”的原则未注册。书签在 DeepSeek 上仍提示“已识别但尚未实现”。

### 安装页（`install.html`）—— 部分验证

- 构建产物中的 href 与书签逐字节一致（validate.js 检查）；页面无远程资源（CSP `default-src 'none'`）。
- “拖到书签栏”这一步需要在真实 Chrome 中手动完成，本次未验证；页面上的“点击不生效 + 提示文字”与“复制代码”逻辑为普通 DOM 脚本，未做自动化测试。

## 4. 如何完成剩余验证

1. 在 Chrome 中打开 `install.html`，把按钮拖到书签栏，确认书签名称为 “📤 AI Chat Export”。
2. 在 ChatGPT / Claude / Gemini / Grok / Perplexity 各选一条**超过 30 轮、含附件**的长对话点击书签：面板消息数应与页面一致（包括需滚动才能看到的早期消息），附件应出现在对应消息下。本次测试对话均只有 2 条消息，长对话、分页与附件未实测。
3. 登录 Copilot，打开 `/chats/…`，点击书签：若面板提示接口 401 并显示 “source: page”，说明接口需要 MSAL 令牌，届时页面路径是唯一可用路径。
4. 每次验证把下载的 `.md` 放进 `test/results/` 并在本文件更新状态。
