# Universal AI Chat Exporter

*[中文说明 / Chinese README](README.md)*

One bookmarklet that exports the **current ChatGPT / Claude / Gemini / Grok / Perplexity** conversation to **Markdown, JSON or HTML**. No browser extension, no server, no account.

- Everything runs locally. The whole script lives inside the bookmark and only runs when you click it.
- Zero uploads, zero telemetry, zero remote code. The only network traffic is the same-origin requests the platform's own web app already makes.
- Cookies and browser storage are never read. The browser attaches your existing session by itself.
- All platforms produce the same JSON schema, so exports are easy to search, migrate and analyse later.

## Install

1. Open `install.html` in Chrome.
2. Drag the **📤 AI Chat Export** button onto the bookmarks bar (`⌘⇧B` / `Ctrl+Shift+B` shows it).
3. If you cannot drag, expand "Manual install" on that page, copy the code, and paste it as the URL of a new bookmark.

The page embeds exactly `dist/ai-chat-export.bookmarklet.js`; its SHA-256 is printed on the page and in `dist/ai-chat-export.bookmarklet.sha256`.

## Use

1. Open a conversation: `chatgpt.com/c/…`, `claude.ai/chat/…`, `gemini.google.com/app/…`, `grok.com/c/…` or `perplexity.ai/search/…`.
2. Click **📤 AI Chat Export** in the bookmarks bar.
3. A panel appears top-right with the message count, the data source (API or page) and any warnings.
4. Click **Markdown**, **JSON** or **HTML** to download. File names look like `claude-2026-10-16-<title>.md`.

## Platform status

| Platform | Extraction | Status |
| --- | --- | --- |
| ChatGPT | same-origin API (`/backend-api/conversation/{id}`), page fallback | verified on the live site (2026-10-16) |
| Claude | same-origin API (`/api/organizations/…/chat_conversations/{id}`), page fallback | verified on the live site |
| Gemini | same-origin `batchexecute` RPC, page fallback | verified on the live site |
| Grok | same-origin API (`response-node` + `load-responses`), page fallback | verified on the live site |
| Perplexity | same-origin API (`/rest/thread/{slug}`), page fallback | verified on the live site |
| Microsoft Copilot | same-origin API, page fallback | experimental (not run live: requires sign-in) |
| DeepSeek | detection only | planned (adapter exists but is not bundled: bookmarklet size cap and its API wants a storage token) |

"Verified" means the final built bookmarklet was executed on the real page and the downloaded files were checked. See `TEST-RESULTS.md` for every run and the defects they caught.

## What gets exported

Roles, order, title, timestamps and model; Markdown source text (tables, code blocks with language, lists, LaTeX); attachment and image metadata with same-origin links; Claude artifacts and generated files; tool-call markers; citations. Edited or regenerated messages: Markdown/HTML show the selected branch and note the number of versions; JSON keeps the other versions under `inactiveMessages`. Model "thinking" is not exported.

## Build and verify from source

```bash
npm install
npm run verify   # build + static security audit (763 checks) + 54 tests
```

The build is deterministic (no timestamps): the same source always produces the same bytes and hash. `npm run audit:security` fails the build if the bundle contains any absolute URL, any `fetch` outside `src/core/net.js`, any cookie/storage access, `eval`, `innerHTML`, or if `install.html` does not embed the exact bookmarklet.

## Security

See `SECURITY.md` (Chinese) for the full threat model, the per-adapter path allow-list, the two platform tokens that are necessarily read (ChatGPT's session token and Gemini's page token, both used once for a same-origin request and never exported), and how to audit the bundle yourself.

## License

MIT.
