(() => {
  // src/core/adapter.js
  var STATUS = Object.freeze({
    VERIFIED: "verified",
    // extraction exercised on the live site; see TEST-RESULTS.md
    EXPERIMENTAL: "experimental",
    // implemented from documented/observed structures, not live-verified
    PLANNED: "planned"
    // detection only; export not implemented
  });
  function assertAdapter(a) {
    const required = ["id", "name", "status", "matches", "conversationId", "fromDom"];
    for (const key of required) {
      if (!(key in a)) throw new Error(`adapter ${a && a.id}: missing ${key}`);
    }
    if (!Array.isArray(a.allowedPaths)) throw new Error(`adapter ${a.id}: allowedPaths must be an array`);
    return a;
  }

  // src/core/schema.js
  var SCHEMA_VERSION = "1.0";
  var EXPORTER = { name: "universal-ai-chat-exporter", version: "1.0.0" };
  var ROLES = ["user", "assistant", "system", "tool"];
  var BLOCK_TYPES = ["text", "code", "image", "attachment", "artifact", "tool_use", "citation"];
  function createConversation(fields) {
    return {
      schemaVersion: SCHEMA_VERSION,
      exporter: { ...EXPORTER },
      platform: fields.platform,
      source: {
        url: fields.url || "",
        conversationId: fields.conversationId || null,
        method: fields.method || "unknown"
      },
      title: (fields.title || "").trim() || "Untitled conversation",
      model: fields.model || null,
      createdAt: toIso(fields.createdAt),
      updatedAt: toIso(fields.updatedAt),
      exportedAt: (/* @__PURE__ */ new Date()).toISOString(),
      messages: fields.messages || [],
      inactiveMessages: fields.inactiveMessages || [],
      stats: { messages: 0, user: 0, assistant: 0, other: 0, branchedMessages: 0 },
      completeness: fields.completeness || "unknown",
      warnings: []
    };
  }
  function createMessage(fields) {
    const role = ROLES.includes(fields.role) ? fields.role : "other";
    return {
      id: String(fields.id || ""),
      parentId: fields.parentId ? String(fields.parentId) : null,
      role,
      createdAt: toIso(fields.createdAt),
      model: fields.model || null,
      content: (fields.content || []).filter(Boolean),
      siblings: fields.siblings > 1 ? fields.siblings : 1,
      flags: fields.flags || {}
    };
  }
  var block = {
    text: (markdown) => markdown && markdown.trim() ? { type: "text", markdown: markdown.replace(/\r\n/g, "\n").trim() } : null,
    code: (code, language) => typeof code === "string" && code.trim() ? { type: "code", language: language || "", code: code.replace(/\r\n/g, "\n") } : null,
    image: (name, url, alt) => ({ type: "image", name: name || "image", url: url || null, alt: alt || name || "image" }),
    attachment: (f) => ({
      type: "attachment",
      name: f.name || "attachment",
      mimeType: f.mimeType || null,
      sizeBytes: typeof f.sizeBytes === "number" ? f.sizeBytes : null,
      url: f.url || null,
      extractedText: typeof f.extractedText === "string" && f.extractedText.trim() ? f.extractedText : null
    }),
    artifact: (a) => ({ type: "artifact", title: a.title || "untitled", kind: a.kind || null, language: a.language || "", content: a.content || "" }),
    toolUse: (name, summary) => ({ type: "tool_use", name: name || "tool", summary: summary || "" }),
    citation: (title2, url) => ({ type: "citation", title: title2 || url || "", url: url || null })
  };
  function toIso(value) {
    if (value === null || value === void 0 || value === "") return null;
    let date;
    if (typeof value === "number") {
      date = new Date(value < 1e12 ? value * 1e3 : value);
    } else {
      date = new Date(value);
    }
    return isNaN(date.getTime()) ? null : date.toISOString();
  }
  function finalize(conv) {
    conv.messages = conv.messages.filter((m) => m.content.length > 0);
    const stats = { messages: conv.messages.length, user: 0, assistant: 0, other: 0, branchedMessages: 0 };
    for (const m of conv.messages) {
      if (m.role === "user") stats.user++;
      else if (m.role === "assistant") stats.assistant++;
      else stats.other++;
      if (m.siblings > 1) stats.branchedMessages++;
    }
    conv.stats = stats;
    if (!conv.messages.length) conv.completeness = "unknown";
    return conv;
  }
  function validateConversation(conv) {
    const issues = [];
    if (!conv || typeof conv !== "object") return ["conversation is not an object"];
    if (conv.schemaVersion !== SCHEMA_VERSION) issues.push("schemaVersion mismatch");
    if (typeof conv.platform !== "string" || !conv.platform) issues.push("platform missing");
    if (typeof conv.title !== "string") issues.push("title missing");
    if (!Array.isArray(conv.messages)) issues.push("messages is not an array");
    else {
      conv.messages.forEach((m, i) => {
        if (!ROLES.includes(m.role) && m.role !== "other") issues.push(`message ${i}: invalid role ${m.role}`);
        if (!Array.isArray(m.content)) issues.push(`message ${i}: content is not an array`);
        else m.content.forEach((b, j) => {
          if (!b || !BLOCK_TYPES.includes(b.type)) issues.push(`message ${i} block ${j}: invalid block type`);
        });
      });
    }
    return issues;
  }

  // src/core/dom-to-markdown.js
  var SKIP_SELECTOR = 'button, svg, script, style, template, select, input, textarea, .sr-only, .cdk-visually-hidden, [aria-hidden="true"]';
  function isElement(node) {
    return node.nodeType === 1;
  }
  function escapeInline(text) {
    return text.replace(/([\\`*_~[\]])/g, "\\$1");
  }
  function codeLanguage(pre, code) {
    const classes = `${code && code.className || ""} ${pre.className || ""}`;
    const m = classes.match(/(?:language|lang)-([\w#+.-]+)/);
    if (m) return m[1];
    const dataLang = code && code.getAttribute("data-language") || pre.getAttribute("data-language");
    return dataLang || "";
  }
  function fence(code, lang) {
    const longest = (code.match(/`{3,}/g) || []).reduce((max, s) => Math.max(max, s.length), 0);
    const marks = "`".repeat(Math.max(3, longest + 1));
    return `

${marks}${lang}
${code.replace(/\n$/, "")}
${marks}

`;
  }
  function texOf(el2) {
    const annotation = el2.querySelector('annotation[encoding="application/x-tex"]');
    if (annotation) return annotation.textContent.trim();
    const alt = el2.getAttribute("data-tex") || el2.getAttribute("alttext") || el2.getAttribute("data-math");
    return alt ? alt.trim() : "";
  }
  function tableToMarkdown(table, convert) {
    const rows = Array.from(table.querySelectorAll("tr")).filter((tr) => tr.closest("table") === table);
    if (!rows.length) return "";
    const cells = rows.map(
      (tr) => Array.from(tr.children).filter((c) => c.tagName === "TD" || c.tagName === "TH").map((c) => convert(c, { inline: true }).replace(/\s*\n\s*/g, " ").replace(/\|/g, "\\|").trim())
    );
    const width = Math.max(...cells.map((r) => r.length));
    const pad = (r) => r.concat(Array(width - r.length).fill(""));
    const header = pad(cells[0]);
    const lines = [`| ${header.join(" | ")} |`, `| ${header.map(() => "---").join(" | ")} |`];
    for (const row of cells.slice(1)) lines.push(`| ${pad(row).join(" | ")} |`);
    return `

${lines.join("\n")}

`;
  }
  var LANG_LABEL = /^[\w#+.-]{1,20}$/;
  var NOT_A_LANGUAGE = /^(copy|copied|code|run|edit|download|expand|collapse|wrap)$/i;
  function labelText(node) {
    if (!node) return "";
    if (node.nodeType === 3) return (node.nodeValue || "").trim();
    if (!isElement(node) || node.querySelector("pre, code, p, table, ul, ol")) return "";
    const candidates = [];
    let own = "";
    node.childNodes.forEach((c) => {
      if (c.nodeType === 3) own += c.nodeValue;
      else if (isElement(c) && !c.matches('button, svg, [aria-hidden="true"]')) candidates.push(c.textContent.trim());
    });
    candidates.unshift(own.trim());
    return candidates.find((t2) => LANG_LABEL.test(t2) && !NOT_A_LANGUAGE.test(t2)) || "";
  }
  function prevSiblings(node, max) {
    const out = [];
    let s = node.previousSibling;
    while (s && out.length < max) {
      const skip = s.nodeType === 8 || s.nodeType === 3 && !s.nodeValue.trim() || isElement(s) && s.matches('button, svg, [aria-hidden="true"]');
      if (!skip) out.push(s);
      s = s.previousSibling;
    }
    return out;
  }
  function siblingLanguage(pre) {
    const candidates = prevSiblings(pre, 3);
    const parent = pre.parentElement;
    if (parent && parent.children.length === 1) candidates.push(...prevSiblings(parent, 2));
    for (const c of candidates) {
      const text = labelText(c);
      if (text && LANG_LABEL.test(text) && !NOT_A_LANGUAGE.test(text)) return { lang: text.toLowerCase(), node: c };
    }
    return null;
  }
  function domToMarkdown(root, options) {
    const opts = options || {};
    const consumed = /* @__PURE__ */ new Set();
    const langOf = /* @__PURE__ */ new Map();
    root.querySelectorAll("pre").forEach((pre) => {
      if (codeLanguage(pre, pre.querySelector("code"))) return;
      const found = siblingLanguage(pre);
      if (found) {
        consumed.add(found.node);
        langOf.set(pre, found.lang);
      }
    });
    function convertChildren(node, ctx) {
      let out = "";
      for (const child of Array.from(node.childNodes)) if (!consumed.has(child)) out += convertNode(child, ctx);
      return out;
    }
    function convertNode(node, ctx) {
      if (node.nodeType === 3) {
        const text = node.nodeValue || "";
        if (ctx.pre) return text;
        const collapsed = text.replace(/\s+/g, " ");
        return ctx.raw ? collapsed : escapeInline(collapsed);
      }
      if (!isElement(node)) return "";
      if (node.matches(SKIP_SELECTOR)) return "";
      if (opts.skip && node.matches(opts.skip)) return "";
      const tag = node.tagName.toLowerCase();
      if (node.classList.contains("katex-display") || tag === "math" && node.getAttribute("display") === "block") {
        const tex = texOf(node);
        return tex ? `

$$
${tex}
$$

` : "";
      }
      if (node.classList.contains("katex") || tag === "math" || node.classList.contains("MathJax")) {
        const tex = texOf(node);
        return tex ? `$${tex}$` : "";
      }
      if (node.classList.contains("katex-html")) return "";
      switch (tag) {
        case "br":
          return ctx.inline ? " " : "  \n";
        case "hr":
          return "\n\n---\n\n";
        case "p":
        case "div":
        case "section":
        case "article": {
          const inner = convertChildren(node, ctx);
          if (ctx.inline) return inner;
          const isBlockContainer = tag !== "p" && Array.from(node.children).some((c) => /^(p|div|ul|ol|pre|table|h[1-6]|blockquote)$/i.test(c.tagName));
          return isBlockContainer ? inner : `

${inner.trim()}

`;
        }
        case "h1":
        case "h2":
        case "h3":
        case "h4":
        case "h5":
        case "h6": {
          const level = Number(tag[1]);
          return `

${"#".repeat(level)} ${convertChildren(node, { ...ctx, inline: true }).trim()}

`;
        }
        case "strong":
        case "b": {
          const inner = convertChildren(node, ctx).trim();
          return inner ? `**${inner}**` : "";
        }
        case "em":
        case "i": {
          const inner = convertChildren(node, ctx).trim();
          return inner ? `*${inner}*` : "";
        }
        case "del":
        case "s":
        case "strike": {
          const inner = convertChildren(node, ctx).trim();
          return inner ? `~~${inner}~~` : "";
        }
        case "code": {
          if (ctx.pre) return node.textContent;
          const text = node.textContent;
          const ticks = "`".repeat((text.match(/`+/g) || []).reduce((m, s) => Math.max(m, s.length), 0) + 1);
          return `${ticks}${text}${ticks}`;
        }
        case "pre": {
          const code = node.querySelector("code");
          const lang = codeLanguage(node, code) || langOf.get(node) || "";
          const source = code ? code.textContent : node.textContent;
          return fence(source, lang);
        }
        case "blockquote": {
          const inner = convertChildren(node, ctx).replace(/\n{3,}/g, "\n\n").trim();
          return `

${inner.split("\n").map((l) => l ? `> ${l}` : ">").join("\n")}

`;
        }
        case "ul":
        case "ol":
          return `

${listToMarkdown(node, ctx, 0)}

`;
        case "li":
          return convertChildren(node, ctx);
        case "a": {
          const href = node.getAttribute("href") || "";
          const inner = convertChildren(node, { ...ctx, inline: true }).trim();
          if (!href || href.startsWith("javascript:")) return inner;
          const abs = absolute(href);
          return inner ? `[${inner}](${abs})` : `<${abs}>`;
        }
        case "img": {
          const src = node.getAttribute("src") || "";
          const alt = node.getAttribute("alt") || "";
          if (!src || src.startsWith("data:")) return alt ? `[image: ${alt}]` : "";
          return `![${alt}](${absolute(src)})`;
        }
        case "table":
          return ctx.inline ? convertChildren(node, ctx) : tableToMarkdown(node, (el2, c) => convertChildren(el2, { ...ctx, ...c }));
        case "thead":
        case "tbody":
        case "tr":
        case "td":
        case "th":
          return convertChildren(node, ctx) + (tag === "tr" ? "\n" : " ");
        default:
          return convertChildren(node, ctx);
      }
    }
    function listToMarkdown(list, ctx, depth) {
      const ordered = list.tagName.toLowerCase() === "ol";
      const start = Number(list.getAttribute("start") || 1);
      const items = Array.from(list.children).filter((c) => c.tagName === "LI");
      const indent = "  ".repeat(depth);
      return items.map((li, i) => {
        const marker = ordered ? `${start + i}.` : "-";
        let body = "";
        const nested = [];
        for (const child of Array.from(li.childNodes)) {
          if (isElement(child) && /^(ul|ol)$/i.test(child.tagName)) nested.push(listToMarkdown(child, ctx, depth + 1));
          else body += convertNode(child, ctx);
        }
        const lines = body.replace(/\n{3,}/g, "\n\n").trim().split("\n");
        const first = lines.shift() || "";
        const rest = lines.map((l) => l ? `${indent}  ${l}` : "").join("\n");
        return `${indent}${marker} ${first}${rest ? `
${rest}` : ""}${nested.length ? `
${nested.join("\n")}` : ""}`;
      }).join("\n");
    }
    function absolute(href) {
      if (!opts.baseUrl) return href;
      try {
        return new URL(href, opts.baseUrl).href;
      } catch (e) {
        return href;
      }
    }
    const md = convertNode(root, { inline: false, pre: false });
    return md.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  // src/adapters/chatgpt.js
  var CONVERSATION_PATH = /\/u?c\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
  var HIDDEN_CONTENT_TYPES = /* @__PURE__ */ new Set(["thoughts", "reasoning_recap", "system_error", "user_editable_context", "model_editable_context", "tether_browsing_display", "tether_quote", "sonic_webpage"]);
  function assetName(pointer) {
    const m = String(pointer || "").match(/([^/]+)$/);
    return m ? m[1] : "image";
  }
  function messageBlocks(message, warn) {
    const content = message.content || {};
    const type = content.content_type;
    const out = [];
    if (type === "text") {
      out.push(block.text((content.parts || []).filter((p) => typeof p === "string").join("\n\n")));
    } else if (type === "multimodal_text") {
      for (const part of content.parts || []) {
        if (typeof part === "string") out.push(block.text(part));
        else if (part && part.content_type === "image_asset_pointer") out.push(block.image(assetName(part.asset_pointer), null, "image"));
        else if (part && typeof part.text === "string") out.push(block.text(part.text));
      }
    } else if (type === "code") {
      const lang = content.language && content.language !== "unknown" ? content.language : "";
      out.push(block.code(content.text, lang));
    } else if (type === "execution_output") {
      out.push(block.code(content.text, "output"));
    } else if (!HIDDEN_CONTENT_TYPES.has(type) && type) {
      warn("chatgpt-unknown-content", `Unknown ChatGPT content type "${type}" skipped`);
    }
    const meta = message.metadata || {};
    for (const a of meta.attachments || []) {
      out.push(block.attachment({ name: a.name, mimeType: a.mime_type || a.mimeType, sizeBytes: typeof a.size === "number" ? a.size : null }));
    }
    for (const ref of meta.content_references || []) {
      if (ref && ref.type === "webpage" && ref.url) out.push(block.citation(ref.title, ref.url));
      for (const item of ref && ref.items || []) if (item && item.url) out.push(block.citation(item.title, item.url));
    }
    return out.filter(Boolean);
  }
  function nodeIsVisible(node) {
    const m = node && node.message;
    if (!m) return false;
    if (m.metadata && m.metadata.is_visually_hidden_from_conversation) return false;
    const role = m.author && m.author.role;
    if (role === "system") return false;
    if (role === "tool" && !(m.content && m.content.content_type === "multimodal_text")) return false;
    if (role === "assistant" && m.recipient && m.recipient !== "all" && m.content && m.content.content_type === "code") return false;
    return true;
  }
  function activeChain(data) {
    const chain = [];
    let id = data.current_node;
    const seen = /* @__PURE__ */ new Set();
    while (id && data.mapping[id] && !seen.has(id)) {
      seen.add(id);
      chain.push(data.mapping[id]);
      id = data.mapping[id].parent;
    }
    return chain.reverse();
  }
  function buildMessages(nodes, data, warn) {
    const messages = [];
    let current = null;
    for (const node of nodes) {
      if (!nodeIsVisible(node)) continue;
      const m = node.message;
      const role = m.author.role === "tool" ? "assistant" : m.author.role;
      const blocks = messageBlocks(m, warn);
      const parent = data.mapping[node.parent];
      const siblings = parent && Array.isArray(parent.children) ? parent.children.filter((cid) => nodeIsVisible(data.mapping[cid])).length : 1;
      const finish = m.metadata && m.metadata.finish_details && m.metadata.finish_details.type || "";
      const flags = {};
      if (finish === "interrupted" || m.status === "finished_partial_completion") flags.interrupted = true;
      if (finish === "max_tokens") flags.truncated = true;
      if (role === "assistant" && current && current.role === "assistant") {
        current.content.push(...blocks);
        Object.assign(current.flags, flags);
        if (siblings > current.siblings) current.siblings = siblings;
        continue;
      }
      current = createMessage({
        id: m.id || node.id,
        parentId: node.parent,
        role,
        createdAt: m.create_time,
        model: m.metadata && m.metadata.model_slug || null,
        content: blocks,
        siblings,
        flags
      });
      messages.push(current);
    }
    return messages;
  }
  var adapter = {
    id: "chatgpt",
    name: "ChatGPT",
    status: STATUS.VERIFIED,
    // live-verified 2026-10-16, see TEST-RESULTS.md
    allowedPaths: [/^\/api\/auth\/session$/, /^\/backend-api\/conversation\/[0-9a-f-]{36}$/i],
    matches: (location2) => /(^|\.)chatgpt\.com$/.test(location2.hostname) || /(^|\.)chat\.openai\.com$/.test(location2.hostname),
    conversationId: (location2) => {
      const m = location2.pathname.match(CONVERSATION_PATH);
      return m ? m[1].toLowerCase() : null;
    },
    async fromApi(ctx) {
      const id = adapter.conversationId(ctx.location);
      if (!id) return null;
      const session = await ctx.net.json("/api/auth/session");
      if (!session || typeof session.accessToken !== "string") throw new Error("not signed in (no session token)");
      const data = await ctx.net.json(`/backend-api/conversation/${id}`, { headers: { authorization: `Bearer ${session.accessToken}` } });
      if (!data || typeof data.mapping !== "object" || typeof data.current_node !== "string") throw new Error("unexpected conversation payload");
      const active = activeChain(data);
      const activeIds = new Set(active.map((n) => n.id));
      const messages = buildMessages(active, data, ctx.warn);
      const inactiveNodes = Object.values(data.mapping).filter((n) => !activeIds.has(n.id) && nodeIsVisible(n));
      const inactive = buildMessages(
        inactiveNodes.sort((a, b) => (a.message && a.message.create_time || 0) - (b.message && b.message.create_time || 0)),
        data,
        ctx.warn
      );
      const model = (messages.find((m) => m.role === "assistant" && m.model) || {}).model || data.default_model_slug || null;
      return createConversation({
        platform: adapter.id,
        url: `${ctx.location.origin}/c/${id}`,
        conversationId: id,
        method: "api",
        title: data.title,
        model,
        createdAt: data.create_time,
        updatedAt: data.update_time,
        messages,
        inactiveMessages: inactive.filter((m) => m.content.length),
        completeness: "complete"
      });
    },
    fromDom(ctx) {
      const doc = ctx.document;
      let turns = Array.from(doc.querySelectorAll("li[data-message-role]"));
      if (!turns.length) turns = Array.from(doc.querySelectorAll("[data-turn]"));
      if (!turns.length) turns = Array.from(doc.querySelectorAll("[data-message-author-role]"));
      const messages = [];
      for (const turn of turns) {
        const roleAttr = turn.getAttribute("data-message-role") || turn.getAttribute("data-turn") || turn.getAttribute("data-message-author-role");
        const role = roleAttr === "user" ? "user" : "assistant";
        const node = turn.querySelector("[data-assistant-markdown-root]") || turn.querySelector("[data-user-message-bubble]") || turn.querySelector(".markdown") || turn.querySelector(".whitespace-pre-wrap") || turn;
        const md = domToMarkdown(node, {
          baseUrl: ctx.location.href,
          skip: '[data-message-attribution], [data-message-actions], [data-message-content-controls], [data-assistant-message-actions], [data-message-intervention], [data-testid="copy-turn-action-button"], .sr-only'
        });
        const images = Array.from(turn.querySelectorAll("img")).filter((img) => !/avatar|icon/i.test(img.getAttribute("alt") || "") && (img.getAttribute("src") || "").startsWith("http"));
        const blocks = [block.text(md), ...images.map((img) => block.image(img.getAttribute("alt") || "image", img.getAttribute("src"), img.getAttribute("alt") || ""))];
        messages.push(createMessage({ id: turn.id || turn.getAttribute("data-message-id") || `dom-${messages.length}`, role, content: blocks.filter(Boolean) }));
      }
      if (!messages.length) return null;
      const generic = /^ChatGPT\b/i.test(doc.title || "");
      const title2 = generic ? "" : (doc.title || "").replace(/\s*[-|]\s*ChatGPT\s*$/i, "").trim();
      const idEl = doc.querySelector("[data-conversation-id]");
      return createConversation({
        platform: adapter.id,
        url: ctx.location.href,
        conversationId: adapter.conversationId(ctx.location) || idEl && idEl.getAttribute("data-conversation-id") || null,
        method: "dom",
        title: title2,
        messages,
        completeness: "partial"
      });
    }
  };
  var chatgpt_default = adapter;

  // src/adapters/claude.js
  var CONVERSATION_PATH2 = /\/chat\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
  var UUID = /^[0-9a-f-]{36}$/i;
  var ARTIFACT_KINDS = {
    "application/vnd.ant.react": { lang: "jsx", kind: "React" },
    "text/html": { lang: "html", kind: "HTML" },
    "image/svg+xml": { lang: "svg", kind: "SVG" },
    "application/vnd.ant.mermaid": { lang: "mermaid", kind: "Mermaid" },
    "text/markdown": { lang: "markdown", kind: "Markdown" },
    "application/vnd.ant.code": { lang: "", kind: "Code" }
  };
  function collectArtifacts(messages, warn) {
    const artifacts = /* @__PURE__ */ new Map();
    for (const m of messages) {
      for (const b of m.content || []) {
        if (b.type !== "tool_use" || b.name !== "artifacts") continue;
        const input = b.input || {};
        const id = input.id || "__artifact__";
        let a = artifacts.get(id);
        if (!a) {
          a = { content: "", title: "", type: "", language: "" };
          artifacts.set(id, a);
        }
        if (input.command === "update" && typeof input.old_str === "string" && typeof input.new_str === "string") {
          if (a.content.indexOf(input.old_str) === -1) warn("claude-artifact-update", `Artifact "${a.title || id}": an update could not be applied; content may be incomplete`);
          else a.content = a.content.replace(input.old_str, () => input.new_str);
        } else if (typeof input.content === "string") {
          a.content = input.content;
        }
        if (input.title) a.title = input.title;
        if (input.type) a.type = input.type;
        if (input.language) a.language = input.language;
        a.lastVersion = input.version_uuid || null;
        a.lastBlock = b;
      }
    }
    return artifacts;
  }
  var EXT_LANG = { py: "python", js: "javascript", jsx: "jsx", ts: "typescript", tsx: "tsx", md: "markdown", html: "html", css: "css", json: "json", sh: "bash", yml: "yaml", yaml: "yaml", sql: "sql", svg: "svg" };
  function basename(path) {
    return String(path || "file").split("/").pop();
  }
  function toolUseBlock(b, artifacts) {
    const input = b.input || {};
    if (b.name === "artifacts") {
      const a = artifacts.get(input.id || "__artifact__");
      if (!a || a.lastBlock !== b || !a.content) return null;
      const info = ARTIFACT_KINDS[a.type] || { lang: a.language || "", kind: a.language || "" };
      return block.artifact({ title: a.title, kind: info.kind, language: info.lang || a.language || "", content: a.content });
    }
    const fileText = typeof input.file_text === "string" ? input.file_text : b.name === "Write" && typeof input.content === "string" ? input.content : "";
    if ((b.name === "create_file" || b.name === "Write") && fileText) {
      const file = basename(input.path || input.file_path);
      const ext = file.includes(".") ? file.split(".").pop().toLowerCase() : "";
      return block.artifact({ title: file, kind: "File", language: EXT_LANG[ext] || "", content: fileText });
    }
    if (b.name === "visualize:show_widget" && typeof input.widget_code === "string") {
      return block.artifact({ title: input.title || "widget", kind: "Widget", language: "jsx", content: input.widget_code });
    }
    const summary = [input.query, input.command, input.skill, input.description, input.file_path && basename(input.file_path)].find((v) => typeof v === "string" && v) || "";
    return block.toolUse(b.name, summary);
  }
  function attachmentBlocks(m, origin) {
    const out = [];
    const abs = (u) => {
      if (!u || typeof u !== "string") return null;
      try {
        return new URL(u, origin).href;
      } catch (e) {
        return null;
      }
    };
    const seen = /* @__PURE__ */ new Set();
    for (const f of [...m.files || [], ...m.files_v2 || []]) {
      const key = f.file_uuid || f.uuid || f.file_name;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      if (f.file_kind === "image") {
        out.push(block.image(f.file_name || "image", abs(f.preview_url || f.preview_asset && f.preview_asset.url), f.file_name));
      } else {
        out.push(block.attachment({ name: f.file_name, mimeType: f.file_kind || null, sizeBytes: typeof f.size_bytes === "number" ? f.size_bytes : null, url: abs(f.document_asset && f.document_asset.url) }));
      }
    }
    for (const a of m.attachments || []) {
      out.push(block.attachment({ name: a.file_name || a.name, mimeType: a.file_type || null, sizeBytes: typeof a.file_size === "number" ? a.file_size : null, extractedText: a.extracted_content }));
    }
    return out;
  }
  function messageToUnified(m, artifacts, siblings, origin) {
    const blocks = attachmentBlocks(m, origin);
    for (const b of m.content || []) {
      if (b.type === "text" && typeof b.text === "string") blocks.push(block.text(b.text));
      else if (b.type === "tool_use") blocks.push(toolUseBlock(b, artifacts));
    }
    if (!blocks.filter(Boolean).length && typeof m.text === "string") blocks.push(block.text(m.text));
    const flags = {};
    if (m.stop_reason === "user_canceled") flags.interrupted = true;
    if (m.truncated) flags.truncated = true;
    return createMessage({
      id: m.uuid,
      parentId: m.parent_message_uuid,
      role: m.sender === "human" ? "user" : m.sender === "assistant" ? "assistant" : m.sender || "other",
      createdAt: m.created_at,
      content: blocks.filter(Boolean),
      siblings,
      flags
    });
  }
  var adapter2 = {
    id: "claude",
    name: "Claude",
    status: STATUS.VERIFIED,
    // live-verified 2026-10-16, see TEST-RESULTS.md
    allowedPaths: [/^\/api\/organizations$/, /^\/api\/organizations\/[0-9a-f-]{36}\/chat_conversations\/[0-9a-f-]{36}$/i],
    matches: (location2) => /(^|\.)claude\.ai$/.test(location2.hostname),
    conversationId: (location2) => {
      const m = location2.pathname.match(CONVERSATION_PATH2);
      return m ? m[1].toLowerCase() : null;
    },
    async fromApi(ctx) {
      const id = adapter2.conversationId(ctx.location);
      if (!id) return null;
      const orgs = await ctx.net.json("/api/organizations");
      const orgIds = (Array.isArray(orgs) ? orgs : []).map((o) => o && o.uuid).filter((u) => typeof u === "string" && UUID.test(u));
      if (!orgIds.length) throw new Error("not signed in (no organizations)");
      let data = null;
      let lastError = null;
      for (const org of orgIds) {
        try {
          data = await ctx.net.json(`/api/organizations/${org}/chat_conversations/${id}?tree=True&rendering_mode=messages&render_all_tools=true`);
          if (data && Array.isArray(data.chat_messages)) break;
          data = null;
        } catch (e) {
          lastError = e;
        }
      }
      if (!data) throw lastError || new Error("conversation not found in any organization");
      const all = data.chat_messages;
      const byId = new Map(all.map((m) => [m.uuid, m]));
      let ordered = null;
      const leaf = data.current_leaf_message_uuid;
      if (leaf && byId.has(leaf)) {
        const path = [];
        const seen = /* @__PURE__ */ new Set();
        let cur = byId.get(leaf);
        while (cur && !seen.has(cur.uuid)) {
          seen.add(cur.uuid);
          path.push(cur);
          cur = cur.parent_message_uuid ? byId.get(cur.parent_message_uuid) : null;
        }
        ordered = path.reverse();
      }
      if (!ordered) {
        ctx.warn("claude-branch", "Could not resolve the current branch; messages are in index order, which may interleave branches");
        ordered = [...all].sort((a, b) => (a.index || 0) - (b.index || 0));
      }
      const childrenOf = /* @__PURE__ */ new Map();
      for (const m of all) {
        const key = m.parent_message_uuid || "__root__";
        childrenOf.set(key, (childrenOf.get(key) || 0) + 1);
      }
      const siblingsOf = (m) => childrenOf.get(m.parent_message_uuid || "__root__") || 1;
      const artifacts = collectArtifacts(ordered, ctx.warn);
      const activeIds = new Set(ordered.map((m) => m.uuid));
      const messages = ordered.map((m) => messageToUnified(m, artifacts, siblingsOf(m), ctx.location.origin));
      const inactiveRaw = all.filter((m) => !activeIds.has(m.uuid));
      const inactiveArtifacts = collectArtifacts(inactiveRaw, () => {
      });
      const inactive = inactiveRaw.map((m) => messageToUnified(m, inactiveArtifacts, siblingsOf(m), ctx.location.origin)).filter((m) => m.content.length);
      return createConversation({
        platform: adapter2.id,
        url: `${ctx.location.origin}/chat/${id}`,
        conversationId: id,
        method: "api",
        title: data.name,
        model: data.model || null,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
        messages,
        inactiveMessages: inactive,
        completeness: "complete"
      });
    },
    fromDom(ctx) {
      const doc = ctx.document;
      const nodes = Array.from(doc.querySelectorAll('[data-testid="user-message"], .font-claude-response, .font-claude-message'));
      const messages = [];
      for (const node of nodes) {
        if (nodes.some((other) => other !== node && other.contains(node))) continue;
        const isUser = node.getAttribute("data-testid") === "user-message";
        let source = node;
        if (!isUser) {
          const parts = node.querySelectorAll(".standard-markdown");
          if (parts.length) {
            source = doc.createElement("div");
            parts.forEach((p) => source.appendChild(p.cloneNode(true)));
          }
        }
        const md = domToMarkdown(source, { baseUrl: ctx.location.href });
        messages.push(createMessage({ id: `dom-${messages.length}`, role: isUser ? "user" : "assistant", content: [block.text(md)].filter(Boolean) }));
      }
      if (!messages.length) return null;
      const title2 = (doc.title || "").replace(/\s*[-|]\s*Claude\s*$/i, "").trim();
      return createConversation({
        platform: adapter2.id,
        url: ctx.location.href,
        conversationId: adapter2.conversationId(ctx.location),
        method: "dom",
        title: title2,
        messages,
        completeness: "partial"
      });
    }
  };
  var claude_default = adapter2;

  // src/adapters/gemini.js
  var CONVERSATION_PATH3 = /\/app\/([a-z0-9]+)/i;
  var RPC_ID = "hNvQHb";
  var PAGE_SIZE = 100;
  var MAX_PAGES = 50;
  var FILENAME = /^[^/\\:*?"<>|$\s][^/\\:*?"<>|$]{0,118}\.[a-z0-9]{2,6}$/i;
  function collectFilenames(node, names) {
    if (typeof node === "string") {
      if (FILENAME.test(node) && !names.includes(node)) names.push(node);
    } else if (Array.isArray(node)) {
      for (const child of node) collectFilenames(child, names);
    }
    return names;
  }
  function wizData(doc) {
    const win = doc.defaultView || globalThis;
    const wiz = win.WIZ_global_data;
    if (!wiz || typeof wiz.SNlM0e !== "string") throw new Error("page token (WIZ_global_data.SNlM0e) not found");
    return { at: wiz.SNlM0e, bl: typeof wiz.cfb2h === "string" ? wiz.cfb2h : "", sid: typeof wiz.FdrFJe === "string" ? wiz.FdrFJe : "" };
  }
  async function rpc(ctx, conversationId, count, cursor) {
    const wiz = wizData(ctx.document);
    const lang = (typeof navigator !== "undefined" && navigator.language || "en").split("-")[0];
    const query = [
      `rpcids=${RPC_ID}`,
      `source-path=${encodeURIComponent(ctx.location.pathname)}`,
      wiz.bl ? `bl=${encodeURIComponent(wiz.bl)}` : "",
      wiz.sid ? `f.sid=${encodeURIComponent(wiz.sid)}` : "",
      `hl=${encodeURIComponent(lang)}`,
      `_reqid=${Math.floor(1e5 + Date.now() % 9e5)}`,
      "rt=c"
    ].filter(Boolean).join("&");
    const inner = JSON.stringify([conversationId, count, cursor, 1, [0], [4], null, 1]);
    const freq = JSON.stringify([[[RPC_ID, inner, null, "generic"]]]);
    const text = await ctx.net.text(`/_/BardChatUi/data/batchexecute?${query}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: `f.req=${encodeURIComponent(freq)}&at=${encodeURIComponent(wiz.at)}`
    });
    for (const line of text.split("\n")) {
      if (line.charAt(0) !== "[") continue;
      let chunk;
      try {
        chunk = JSON.parse(line);
      } catch (e) {
        continue;
      }
      for (const entry of Array.isArray(chunk) ? chunk : []) {
        if (Array.isArray(entry) && entry[0] === "wrb.fr" && entry[1] === RPC_ID && typeof entry[2] === "string") return JSON.parse(entry[2]);
      }
    }
    throw new Error("no payload in batchexecute response");
  }
  function validRecord(r) {
    return Array.isArray(r) && Array.isArray(r[0]) && typeof r[0][1] === "string" && (Array.isArray(r[2]) || Array.isArray(r[3]));
  }
  function mapTurns(turns) {
    const chosen = /* @__PURE__ */ new Set();
    for (const t2 of turns) if (Array.isArray(t2[1]) && typeof t2[1][2] === "string") chosen.add(t2[1][2]);
    const messages = [];
    const inactive = [];
    const listed = /* @__PURE__ */ new Set();
    for (const t2 of turns) {
      const turnId = t2[0][1];
      const createdAt = Array.isArray(t2[4]) && typeof t2[4][0] === "number" && t2[4][0] > 1e9 ? t2[4][0] : null;
      const user = Array.isArray(t2[2]) && t2[2][0] || [];
      const text = typeof user[0] === "string" ? user[0] : "";
      const names = collectFilenames(user[4], []).filter((n) => {
        if (listed.has(n)) return false;
        listed.add(n);
        return true;
      });
      const userBlocks = [block.text(text), ...names.map((n) => block.attachment({ name: n }))].filter(Boolean);
      if (userBlocks.length) messages.push(createMessage({ id: `${turnId}:user`, role: "user", createdAt, content: userBlocks }));
      const candidates = (Array.isArray(t2[3]) && t2[3][0] || []).filter((c) => Array.isArray(c) && Array.isArray(c[1]) && typeof c[1][0] === "string" && c[1][0].trim());
      if (!candidates.length) continue;
      const pick = candidates.find((c) => chosen.has(c[0])) || candidates[0];
      messages.push(createMessage({ id: pick[0] || `${turnId}:model`, parentId: `${turnId}:user`, role: "assistant", createdAt, content: [block.text(pick[1][0])].filter(Boolean), siblings: candidates.length }));
      for (const c of candidates) {
        if (c !== pick) inactive.push(createMessage({ id: c[0], parentId: `${turnId}:user`, role: "assistant", createdAt, content: [block.text(c[1][0])].filter(Boolean), siblings: candidates.length }));
      }
    }
    return { messages, inactive };
  }
  function pageTitle(doc) {
    const el2 = doc.querySelector('[data-test-id="conversation-title"], .conversation-title, .selected .conversation-title');
    const fromEl = el2 && el2.textContent.trim();
    if (fromEl) return fromEl;
    return (doc.title || "").replace(/\s*[-|]\s*(Google\s+)?Gemini\s*$/i, "").trim();
  }
  var adapter3 = {
    id: "gemini",
    name: "Gemini",
    status: STATUS.VERIFIED,
    // live-verified 2026-10-16, see TEST-RESULTS.md
    allowedPaths: [/^\/_\/BardChatUi\/data\/batchexecute$/],
    matches: (location2) => location2.hostname === "gemini.google.com",
    conversationId: (location2) => {
      const m = location2.pathname.match(CONVERSATION_PATH3);
      return m ? m[1] : null;
    },
    async fromApi(ctx) {
      const id = adapter3.conversationId(ctx.location);
      if (!id) return null;
      const conversationId = `c_${id}`;
      let payload = await rpc(ctx, conversationId, PAGE_SIZE, null);
      const turns = [];
      const seen = /* @__PURE__ */ new Set();
      for (let page = 0; page < MAX_PAGES && payload; page++) {
        const records = Array.isArray(payload[0]) ? payload[0] : [];
        let added = 0;
        for (const r of records) {
          if (!validRecord(r)) throw new Error("unexpected record shape in batchexecute payload");
          if (seen.has(r[0][1])) continue;
          seen.add(r[0][1]);
          turns.push(r);
          added++;
        }
        const cursor = typeof payload[1] === "string" && payload[1] ? payload[1] : null;
        if (!cursor || !added) break;
        payload = await rpc(ctx, conversationId, PAGE_SIZE, cursor);
      }
      if (!turns.length) throw new Error("RPC returned no turns");
      turns.reverse();
      const { messages, inactive } = mapTurns(turns);
      return createConversation({
        platform: adapter3.id,
        url: ctx.location.href,
        conversationId: id,
        method: "api",
        title: pageTitle(ctx.document),
        createdAt: messages.length ? messages[0].createdAt : null,
        messages,
        inactiveMessages: inactive,
        completeness: "complete"
      });
    },
    fromDom(ctx) {
      const doc = ctx.document;
      const containers = Array.from(doc.querySelectorAll("div.conversation-container"));
      const messages = [];
      for (const c of containers) {
        const query = c.querySelector("user-query .query-text, .query-content, user-query");
        const response = c.querySelector("model-response message-content, .response-content, model-response");
        if (query) {
          const md = domToMarkdown(query, { baseUrl: ctx.location.href });
          const files = Array.from(c.querySelectorAll('user-query [data-test-id="file-name"], user-query .file-name')).map((n) => n.textContent.trim()).filter(Boolean);
          messages.push(createMessage({ id: `dom-${messages.length}`, role: "user", content: [block.text(md), ...files.map((n) => block.attachment({ name: n }))].filter(Boolean) }));
        }
        if (response) {
          const md = domToMarkdown(response, { baseUrl: ctx.location.href, skip: '.code-block-decoration, .table-footer, [class*="export-sheets"], [class*="hide-from-message"], .response-footer, sources-list, .thoughts-header' });
          messages.push(createMessage({ id: `dom-${messages.length}`, role: "assistant", content: [block.text(md)].filter(Boolean) }));
        }
      }
      if (!messages.length) return null;
      return createConversation({
        platform: adapter3.id,
        url: ctx.location.href,
        conversationId: adapter3.conversationId(ctx.location),
        method: "dom",
        title: pageTitle(doc),
        messages,
        completeness: "partial"
      });
    }
  };
  var gemini_default = adapter3;

  // src/adapters/_shared.js
  function branch(byId, leafId, parentOf) {
    const out = [];
    let cur = byId.get(leafId);
    while (cur && !out.includes(cur)) {
      out.push(cur);
      cur = byId.get(parentOf(cur));
    }
    return out.reverse();
  }
  function siblingCounter(items, parentOf) {
    const counts = /* @__PURE__ */ new Map();
    for (const m of items) counts.set(parentOf(m), (counts.get(parentOf(m)) || 0) + 1);
    return (m) => counts.get(parentOf(m)) || 1;
  }
  function domConversation(adapter7, ctx, turns, title2, skip) {
    const messages = turns.map((t2, i) => createMessage({ id: `dom-${i}`, role: t2.role, content: [block.text(domToMarkdown(t2.node, { baseUrl: ctx.location.href, skip }))] })).filter((m) => m.content.length);
    if (!messages.length) return null;
    return createConversation({
      platform: adapter7.id,
      url: ctx.location.href,
      conversationId: adapter7.conversationId(ctx.location),
      method: "dom",
      title: title2,
      messages,
      completeness: "partial"
    });
  }
  function pageTitle2(doc, suffix) {
    return (doc.title || "").replace(suffix, "").trim();
  }

  // src/adapters/grok.js
  var CONVERSATION_PATH4 = /\/c\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
  var TITLE_SUFFIX = /\s*-\s*Grok\s*$/;
  function toMessage(r, siblings) {
    const human = /^human$/i.test(r.sender || "");
    const blocks = [block.text(typeof r.message === "string" && r.message ? r.message : human && typeof r.query === "string" ? r.query : "")];
    for (const w of Array.isArray(r.citedWebSearchResults) ? r.citedWebSearchResults : []) if (w && typeof w.url === "string") blocks.push(block.citation(w.title, w.url));
    return createMessage({
      id: r.responseId,
      parentId: r.parentResponseId,
      role: human ? "user" : "assistant",
      createdAt: r.createTime,
      model: typeof r.model === "string" ? r.model : null,
      content: blocks,
      siblings,
      flags: r.partial ? { interrupted: true } : {}
    });
  }
  var adapter4 = {
    id: "grok",
    name: "Grok",
    status: STATUS.VERIFIED,
    // live-verified 2026-10-16, see TEST-RESULTS.md
    allowedPaths: [/^\/rest\/app-chat\/conversations\/[0-9a-f-]{36}\/(response-node|load-responses)$/i],
    matches: (location2) => /(^|\.)grok\.com$/.test(location2.hostname),
    conversationId: (location2) => {
      const m = location2.pathname.match(CONVERSATION_PATH4);
      return m ? m[1].toLowerCase() : null;
    },
    async fromApi(ctx) {
      const id = adapter4.conversationId(ctx.location);
      if (!id) return null;
      const base = `/rest/app-chat/conversations/${id}/`;
      const tree = await ctx.net.json(`${base}response-node?includeThreads=true`);
      const nodes = tree && Array.isArray(tree.responseNodes) ? tree.responseNodes.filter((n) => n && typeof n.responseId === "string") : [];
      if (!nodes.length) throw new Error("unexpected response-node payload");
      const loaded = await ctx.net.json(`${base}load-responses`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ responseIds: nodes.map((n) => n.responseId) }) });
      const responses = loaded && Array.isArray(loaded.responses) ? loaded.responses.filter((r) => r && typeof r.responseId === "string") : [];
      if (!responses.length) throw new Error("unexpected load-responses payload");
      const byId = new Map(responses.map((r) => [r.responseId, r]));
      for (const n of nodes) {
        const r = byId.get(n.responseId);
        if (r) {
          r.sender = r.sender || n.sender;
          r.parentResponseId = r.parentResponseId || n.parentResponseId;
        }
      }
      let leaf = responses[responses.length - 1];
      for (const r of responses) if (new Date(r.createTime) > new Date(leaf.createTime)) leaf = r;
      const parentOf = (r) => r.parentResponseId || "";
      const active = branch(byId, leaf.responseId, parentOf);
      const siblingsOf = siblingCounter(responses, parentOf);
      const messages = active.map((r) => toMessage(r, siblingsOf(r)));
      return createConversation({
        platform: adapter4.id,
        url: `${ctx.location.origin}/c/${id}`,
        conversationId: id,
        method: "api",
        title: pageTitle2(ctx.document, TITLE_SUFFIX),
        model: (messages.find((m) => m.model) || {}).model,
        createdAt: messages[0].createdAt,
        updatedAt: messages[messages.length - 1].createdAt,
        messages,
        inactiveMessages: responses.filter((r) => !active.includes(r)).map((r) => toMessage(r, siblingsOf(r))).filter((m) => m.content.length),
        completeness: "complete"
      });
    },
    fromDom(ctx) {
      const doc = ctx.document;
      const turns = [];
      for (const el2 of doc.querySelectorAll('div[id^="response-"]')) {
        const bubble = el2.querySelector(".message-bubble");
        if (!bubble) continue;
        const node = (bubble.querySelector(".response-content-markdown") || bubble).cloneNode(true);
        for (const h of node.querySelectorAll('[class~="group/code-header"]')) h.remove();
        turns.push({ role: bubble.getAttribute("data-testid") === "user-message" ? "user" : "assistant", node });
      }
      return domConversation(adapter4, ctx, turns, pageTitle2(doc, TITLE_SUFFIX), ".thinking-container, .action-buttons, .inline-media-container");
    }
  };
  var grok_default = adapter4;

  // src/adapters/perplexity.js
  var THREAD_PATH = /^\/search\/([A-Za-z0-9._~%-]+)/;
  var TITLE_SUFFIX2 = /\s*[-|]\s*Perplexity.*$/i;
  var QUERY = "with_parent_info=true&with_schematized_response=true&version=2.18&source=default&limit=50&from_first=true";
  var MAX_PAGES2 = 40;
  var utc = (s) => typeof s === "string" && !/[zZ]$|[+-]\d\d:?\d\d$/.test(s) ? `${s}Z` : s;
  function answerBlocks(entry) {
    const blocks = Array.isArray(entry.blocks) ? entry.blocks.filter(Boolean) : [];
    const md = blocks.filter((b) => b.markdown_block && typeof b.markdown_block.answer === "string");
    const pick = md.find((b) => b.intended_usage === "ask_text") || md.find((b) => /^ask_text/.test(b.intended_usage)) || md[0];
    const out = [block.text(pick ? pick.markdown_block.answer : "")];
    const urls = /* @__PURE__ */ new Set();
    for (const b of blocks) {
      for (const k of ["web_result_block", "sources_mode_block"]) {
        for (const s of b[k] && Array.isArray(b[k].web_results) ? b[k].web_results : []) if (s && typeof s.url === "string" && !urls.has(s.url) && urls.add(s.url)) out.push(block.citation(s.name || s.title, s.url));
      }
    }
    return out;
  }
  var adapter5 = {
    id: "perplexity",
    name: "Perplexity",
    status: STATUS.VERIFIED,
    // live-verified 2026-10-16, see TEST-RESULTS.md
    allowedPaths: [/^\/rest\/thread\/[A-Za-z0-9._~%-]+$/],
    matches: (location2) => /(^|\.)perplexity\.ai$/.test(location2.hostname),
    conversationId: (location2) => {
      const m = location2.pathname.match(THREAD_PATH);
      return m ? m[1] : null;
    },
    async fromApi(ctx) {
      const slug = adapter5.conversationId(ctx.location);
      if (!slug) return null;
      const entries = [];
      const seen = /* @__PURE__ */ new Set();
      let offset = 0;
      for (let page = 0; page < MAX_PAGES2; page++) {
        const data = await ctx.net.json(`/rest/thread/${slug}?${QUERY}&offset=${offset}`);
        if (!data || !Array.isArray(data.entries)) throw new Error("unexpected thread payload");
        let added = 0;
        for (const e of data.entries) {
          const key = e && (e.uuid || e.backend_uuid);
          if (!key || seen.has(key)) continue;
          seen.add(key);
          entries.push(e);
          added++;
        }
        const next = data.next_cursor;
        if (!data.has_next_page || !added || typeof next !== "number" && typeof next !== "string" || next === "") break;
        offset = next;
      }
      if (!entries.length) throw new Error("thread has no entries");
      const messages = [];
      for (const e of entries) {
        const eid = String(e.uuid || e.backend_uuid);
        messages.push(createMessage({ id: `${eid}:q`, role: "user", createdAt: utc(e.entry_created_datetime || e.updated_datetime), content: [block.text(typeof e.query_str === "string" ? e.query_str : "")] }));
        messages.push(createMessage({ id: eid, parentId: `${eid}:q`, role: "assistant", createdAt: utc(e.updated_datetime || e.entry_updated_datetime), model: typeof e.display_model === "string" ? e.display_model : null, content: answerBlocks(e) }));
      }
      return createConversation({
        platform: adapter5.id,
        url: ctx.location.href,
        conversationId: slug,
        method: "api",
        title: typeof entries[0].thread_title === "string" ? entries[0].thread_title : pageTitle2(ctx.document, TITLE_SUFFIX2),
        model: (messages.find((m) => m.model) || {}).model,
        createdAt: messages[0].createdAt,
        updatedAt: messages[messages.length - 1].createdAt,
        messages,
        completeness: "complete"
      });
    },
    fromDom(ctx) {
      const doc = ctx.document;
      const turns = Array.from(doc.querySelectorAll('[class~="group/user-bubble"], [class~="group/final-text"]')).map((el2) => ({ role: el2.classList.contains("group/user-bubble") ? "user" : "assistant", node: el2 }));
      return domConversation(adapter5, ctx, turns, pageTitle2(doc, TITLE_SUFFIX2), '[data-testid="toggle-query-expand-button"]');
    }
  };
  var perplexity_default = adapter5;

  // src/adapters/copilot.js
  var CONVERSATION_PATH5 = /^\/chats\/([A-Za-z0-9_-]{8,128})\/?$/;
  var TITLE_SUFFIX3 = /^\s*Microsoft[\s_-]*Copilot.*$|\s*[-|–]\s*(Microsoft )?Copilot.*$/i;
  function title(doc) {
    const selected = doc.querySelector('[role="option"][aria-selected="true"] p');
    return selected && selected.textContent.trim() || pageTitle2(doc, TITLE_SUFFIX3);
  }
  var adapter6 = {
    id: "copilot",
    name: "Microsoft Copilot",
    status: STATUS.EXPERIMENTAL,
    allowedPaths: [/^\/c\/api\/conversations\/[A-Za-z0-9_-]+\/history$/],
    matches: (location2) => location2.hostname === "copilot.microsoft.com" || /(^|\.)copilot\.com$/.test(location2.hostname),
    conversationId: (location2) => {
      const m = location2.pathname.match(CONVERSATION_PATH5);
      return m ? m[1] : null;
    },
    async fromApi(ctx) {
      const id = adapter6.conversationId(ctx.location);
      if (!id) return null;
      const data = await ctx.net.json(`/c/api/conversations/${id}/history?api-version=2`);
      if (!data || !Array.isArray(data.results)) throw new Error("unexpected history payload");
      const messages = [];
      for (const m of data.results.slice().reverse()) {
        if (!m) continue;
        const author = String(typeof m.author === "string" ? m.author : m.author && m.author.type || "").toLowerCase();
        const role = author === "human" ? "user" : author === "ai" ? "assistant" : null;
        if (!role) continue;
        const text = (Array.isArray(m.content) ? m.content : []).filter((p) => p && p.type === "text" && typeof p.text === "string").map((p) => p.text);
        messages.push(createMessage({ id: m.id || `${role}-${messages.length}`, role, createdAt: m.createdAt, content: [block.text(text.join("\n\n"))] }));
      }
      if (!messages.length) throw new Error("history has no messages");
      return createConversation({
        platform: adapter6.id,
        url: `${ctx.location.origin}/chats/${id}`,
        conversationId: id,
        method: "api",
        title: title(ctx.document),
        createdAt: messages[0].createdAt,
        updatedAt: messages[messages.length - 1].createdAt,
        messages,
        completeness: "complete"
      });
    },
    fromDom(ctx) {
      const doc = ctx.document;
      const turns = Array.from(doc.querySelectorAll('[class~="group/user-message"], [class~="group/ai-message"]')).map((el2) => {
        const user = el2.classList.contains("group/user-message");
        return { role: user ? "user" : "assistant", node: el2.querySelector(user ? '[data-content="user-message"]' : '[class~="group/ai-message-item"]') || el2 };
      });
      return domConversation(adapter6, ctx, turns, title(doc), '[data-testid="message-item-reactions"]');
    }
  };
  var copilot_default = adapter6;

  // src/adapters/planned.js
  var planned = [
    {
      id: "deepseek",
      name: "DeepSeek",
      status: STATUS.PLANNED,
      allowedPaths: [],
      matches: (location2) => location2.hostname === "chat.deepseek.com",
      conversationId: () => null,
      fromDom: () => null
    }
  ];

  // src/core/registry.js
  var adapters = [chatgpt_default, claude_default, gemini_default, grok_default, perplexity_default, copilot_default, ...planned].map(assertAdapter);
  function detectAdapter(location2) {
    return adapters.find((a) => a.matches(location2)) || null;
  }
  function supportedNames() {
    return adapters.filter((a) => a.status !== "planned").map((a) => a.name);
  }

  // src/core/net.js
  var NetError = class extends Error {
    constructor(message, status) {
      super(message);
      this.name = "NetError";
      this.status = status || 0;
    }
  };
  function createNet(location2, allowedPaths, fetchImpl) {
    const doFetch = fetchImpl || ((...args) => globalThis.fetch(...args));
    const origin = location2.origin;
    function resolve(path) {
      const url = new URL(path, origin);
      if (url.origin !== origin) throw new NetError(`refused cross-origin request to ${url.origin}`);
      if (!allowedPaths.some((re) => re.test(url.pathname))) throw new NetError(`refused request outside allow-list: ${url.pathname}`);
      return url;
    }
    async function request(path, init) {
      init = init || {};
      const method = String(init.method || "GET").toUpperCase();
      if (method !== "GET" && method !== "POST") throw new NetError(`refused method ${method}`);
      const url = resolve(path);
      const response = await doFetch(url.href, {
        method,
        headers: init.headers || {},
        body: method === "POST" ? init.body : void 0,
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
        mode: "same-origin"
      });
      if (!response.ok) throw new NetError(`${method} ${url.pathname} returned HTTP ${response.status}`, response.status);
      return response;
    }
    return {
      async json(path, init) {
        const response = await request(path, Object.assign({}, init, { headers: Object.assign({ accept: "application/json" }, init && init.headers || {}) }));
        return response.json();
      },
      async text(path, init) {
        const response = await request(path, init);
        return response.text();
      }
    };
  }

  // src/core/i18n.js
  var STRINGS = {
    en: {
      loading: "Reading conversation\u2026",
      unsupported: "This site is not supported. Supported: {list}",
      planned: "{name} detected, but its exporter is not implemented yet.",
      noConversation: "Open a conversation first (no conversation id in the URL).",
      empty: "No messages found on this page.",
      exported: "{count} messages ready",
      partial: "Export may be incomplete",
      source_api: "source: API",
      source_dom: "source: page",
      download: "Download",
      close: "Close",
      error: "Export failed: {message}",
      branches: "{count} messages have other versions (edits or regenerations); JSON keeps them all.",
      dom_fallback: "API unavailable, read from the page: only loaded messages are included.",
      hint: "Only this conversation is read. Nothing leaves your browser."
    },
    zh: {
      loading: "\u6B63\u5728\u8BFB\u53D6\u5BF9\u8BDD\u2026",
      unsupported: "\u5F53\u524D\u7F51\u7AD9\u4E0D\u53D7\u652F\u6301\u3002\u652F\u6301\uFF1A{list}",
      planned: "\u5DF2\u8BC6\u522B {name}\uFF0C\u4F46\u5176\u5BFC\u51FA\u529F\u80FD\u5C1A\u672A\u5B9E\u73B0\u3002",
      noConversation: "\u8BF7\u5148\u6253\u5F00\u4E00\u4E2A\u5177\u4F53\u5BF9\u8BDD\uFF08URL \u4E2D\u6CA1\u6709\u5BF9\u8BDD ID\uFF09\u3002",
      empty: "\u9875\u9762\u4E0A\u6CA1\u6709\u627E\u5230\u6D88\u606F\u3002",
      exported: "\u5DF2\u8BFB\u53D6 {count} \u6761\u6D88\u606F",
      partial: "\u5BFC\u51FA\u53EF\u80FD\u4E0D\u5B8C\u6574",
      source_api: "\u6765\u6E90\uFF1A\u63A5\u53E3",
      source_dom: "\u6765\u6E90\uFF1A\u9875\u9762",
      download: "\u4E0B\u8F7D",
      close: "\u5173\u95ED",
      error: "\u5BFC\u51FA\u5931\u8D25\uFF1A{message}",
      branches: "{count} \u6761\u6D88\u606F\u6709\u5176\u4ED6\u7248\u672C\uFF08\u7F16\u8F91\u6216\u91CD\u65B0\u751F\u6210\uFF09\uFF0CJSON \u4E2D\u4FDD\u7559\u5168\u90E8\u3002",
      dom_fallback: "\u63A5\u53E3\u4E0D\u53EF\u7528\uFF0C\u5DF2\u6539\u8BFB\u9875\u9762\uFF0C\u53EA\u542B\u5DF2\u52A0\u8F7D\u7684\u6D88\u606F\u3002",
      hint: "\u53EA\u8BFB\u53D6\u5F53\u524D\u5BF9\u8BDD\uFF0C\u4E0D\u4F1A\u4E0A\u4F20\u4EFB\u4F55\u5185\u5BB9\u3002"
    }
  };
  function t(key, params, lang) {
    const language = lang || typeof navigator !== "undefined" && navigator.language || "en";
    const table = STRINGS[language.toLowerCase().startsWith("zh") ? "zh" : "en"];
    let text = table[key] || STRINGS.en[key] || key;
    for (const k in params || {}) text = text.replace(`{${k}}`, String(params[k]));
    return text;
  }

  // src/core/ui.js
  var ROOT_ID = "uace-panel";
  var STYLE_ID = "uace-style";
  var CSS = `
#${ROOT_ID}{--bg:#fff;--fg:#1a1a22;--mut:#6b6b78;--line:#e7e7ee;--btn:#f4f4f8;--btnh:#e9e9f1;--acc:#5b6cff;position:fixed;top:18px;right:18px;z-index:2147483647;width:344px;max-width:calc(100vw - 36px);box-sizing:border-box;padding:16px 18px;color:var(--fg);background:var(--bg);border:1px solid var(--line);border-radius:18px;box-shadow:0 24px 60px #14142838,0 2px 8px #14142814;font:13px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;animation:uace-in .24s cubic-bezier(.2,.9,.25,1.15)}
@media(prefers-color-scheme:dark){#${ROOT_ID}{--bg:#1d1d24;--fg:#f2f2f6;--mut:#9f9fac;--line:#34343f;--btn:#2a2a34;--btnh:#363642;--acc:#7b8aff}}
@keyframes uace-in{from{opacity:0;transform:translateY(-8px) scale(.97)}}
@keyframes uace-spin{to{transform:rotate(360deg)}}
#${ROOT_ID} *{box-sizing:border-box;margin:0}
.uace-head{display:flex;align-items:center;gap:10px;margin-bottom:12px}
.uace-logo{flex:none;width:32px;height:32px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:17px;background:linear-gradient(135deg,#6f86ff,#b36bff);box-shadow:0 4px 12px #6f86ff59}
.uace-title{flex:1;font-weight:700;font-size:15px;letter-spacing:-.01em}
#${ROOT_ID} .uace-close{border:0;background:none;color:var(--mut);font:15px/1 inherit;cursor:pointer;padding:6px;border-radius:8px}
#${ROOT_ID} .uace-close:hover{background:var(--btn);color:var(--fg)}
.uace-status{display:flex;align-items:center;gap:9px;font-weight:600;font-size:14px}
.uace-dot{flex:none;width:9px;height:9px;border-radius:50%;background:#22c55e;box-shadow:0 0 0 3px #22c55e33}
.uace-dot.warn{background:#f59e0b;box-shadow:0 0 0 3px #f59e0b38}
.uace-spin{flex:none;width:14px;height:14px;border:2px solid var(--line);border-top-color:var(--acc);border-radius:50%;animation:uace-spin .7s linear infinite}
.uace-meta{color:var(--mut);font-size:12px;margin:3px 0 0 18px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.uace-warn,.uace-error{border-radius:11px;padding:9px 11px;margin-top:10px;font-size:12px;line-height:1.45}
.uace-warn{background:#f59e0b1c;border:1px solid #f59e0b59}
.uace-error{background:#ef44441a;border:1px solid #ef444459}
.uace-buttons{display:flex;gap:8px;margin-top:14px}
#${ROOT_ID} .uace-btn{flex:1;border:1px solid var(--line);background:var(--btn);color:var(--fg);border-radius:11px;padding:9px 0;font:inherit;font-weight:650;cursor:pointer;transition:background .15s,transform .08s}
#${ROOT_ID} .uace-btn:hover{background:var(--btnh)}
#${ROOT_ID} .uace-btn:active{transform:scale(.96)}
#${ROOT_ID} .uace-btn.primary{background:var(--acc);border-color:var(--acc);color:#fff}
#${ROOT_ID} .uace-btn.primary:hover{filter:brightness(1.08)}
.uace-hint{color:var(--mut);font-size:11px;text-align:center;margin-top:11px}
`;
  function el(doc, tag, className, text) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== void 0) node.textContent = text;
    return node;
  }
  function createPanel(doc) {
    if (!doc.getElementById(STYLE_ID)) {
      const style = el(doc, "style");
      style.id = STYLE_ID;
      style.textContent = CSS;
      doc.head.appendChild(style);
    }
    const previous = doc.getElementById(ROOT_ID);
    if (previous) previous.remove();
    const root = el(doc, "div");
    root.id = ROOT_ID;
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", "AI Chat Export");
    const head = el(doc, "div", "uace-head");
    head.appendChild(el(doc, "span", "uace-logo", "\u{1F4E4}"));
    head.appendChild(el(doc, "span", "uace-title", "AI Chat Export"));
    const close = el(doc, "button", "uace-close", "\u2715");
    close.setAttribute("aria-label", t("close"));
    close.addEventListener("click", () => root.remove());
    head.appendChild(close);
    root.appendChild(head);
    const body = el(doc, "div", "uace-body");
    root.appendChild(body);
    doc.body.appendChild(root);
    function clear() {
      while (body.firstChild) body.removeChild(body.firstChild);
    }
    return {
      root,
      showLoading() {
        clear();
        const status = el(doc, "div", "uace-status");
        status.appendChild(el(doc, "span", "uace-spin"));
        status.appendChild(doc.createTextNode(t("loading")));
        body.appendChild(status);
      },
      showError(message) {
        clear();
        body.appendChild(el(doc, "div", "uace-error", message));
      },
      showResult({ statusText, metaText, warnings, partial, buttons }) {
        clear();
        const status = el(doc, "div", "uace-status");
        status.appendChild(el(doc, "span", partial ? "uace-dot warn" : "uace-dot"));
        status.appendChild(doc.createTextNode(statusText));
        body.appendChild(status);
        if (metaText) {
          const meta = el(doc, "div", "uace-meta", metaText);
          meta.title = metaText;
          body.appendChild(meta);
        }
        for (const w of warnings || []) body.appendChild(el(doc, "div", "uace-warn", w));
        const row = el(doc, "div", "uace-buttons");
        buttons.forEach((b, i) => {
          const btn = el(doc, "button", i === 0 ? "uace-btn primary" : "uace-btn", b.label);
          btn.addEventListener("click", b.onClick);
          row.appendChild(btn);
        });
        body.appendChild(row);
        body.appendChild(el(doc, "div", "uace-hint", t("hint")));
      },
      remove() {
        root.remove();
      }
    };
  }

  // src/core/download.js
  function downloadText(text, filename, mimeType, doc) {
    const d = doc || document;
    const blob = new Blob([text], { type: mimeType || "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = d.createElement("a");
    a.href = url;
    a.download = filename;
    a.style.display = "none";
    d.body.appendChild(a);
    try {
      a.click();
    } finally {
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1e3);
    }
  }

  // src/core/filename.js
  function safeTitle(title2, maxLength) {
    const cleaned = String(title2 || "").replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().replace(/\.+$/, "").replace(/ /g, "-");
    return cleaned.slice(0, maxLength || 80) || "conversation";
  }
  function buildFilename(platform, title2, ext, date) {
    const d = date || /* @__PURE__ */ new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    return `${platform}-${stamp}-${safeTitle(title2)}.${ext}`;
  }

  // src/formatters/markdown.js
  var ROLE_LABEL = { user: "User", assistant: "Assistant", system: "System", tool: "Tool", other: "Other" };
  function yaml(value) {
    return `"${String(value === null || value === void 0 ? "" : value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  function fenceFor(source) {
    const longest = (String(source).match(/`{3,}/g) || []).reduce((m, s) => Math.max(m, s.length), 0);
    return "`".repeat(Math.max(3, longest + 1));
  }
  function renderBlock(b) {
    switch (b.type) {
      case "text":
        return b.markdown;
      case "code": {
        const f = fenceFor(b.code);
        return `${f}${b.language || ""}
${b.code.replace(/\n$/, "")}
${f}`;
      }
      case "image":
        return b.url ? `![${b.alt || b.name}](${b.url})` : `[Image: ${b.name}]`;
      case "attachment": {
        const meta = [b.mimeType, b.sizeBytes !== null ? formatBytes(b.sizeBytes) : null].filter(Boolean).join(", ");
        const label = b.url ? `[${b.name}](${b.url})` : b.name;
        const head = `**Attachment:** ${label}${meta ? ` (${meta})` : ""}`;
        if (!b.extractedText) return head;
        const quoted = b.extractedText.split("\n").map((l) => l ? `> ${l}` : ">").join("\n");
        return `${head}

${quoted}`;
      }
      case "artifact": {
        const f = fenceFor(b.content);
        const kind = b.kind ? ` (${b.kind})` : "";
        return `**Artifact:** ${b.title}${kind}

${f}${b.language || ""}
${b.content.replace(/\n$/, "")}
${f}`;
      }
      case "tool_use":
        return `*[Tool: ${b.name}${b.summary ? ` \u2014 ${b.summary}` : ""}]*`;
      case "citation":
        return b.url ? `- [${b.title || b.url}](${b.url})` : `- ${b.title}`;
      default:
        return "";
    }
  }
  function formatBytes(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  }
  function timestamp(iso) {
    return iso ? iso.replace("T", " ").replace(/\.\d{3}Z$/, " UTC") : "";
  }
  function toMarkdown(conv) {
    const lines = [
      "---",
      `title: ${yaml(conv.title)}`,
      `platform: ${yaml(conv.platform)}`,
      `source: ${yaml(conv.source.url)}`,
      `conversation_id: ${yaml(conv.source.conversationId)}`,
      `model: ${yaml(conv.model)}`,
      `created: ${yaml(conv.createdAt)}`,
      `exported: ${yaml(conv.exportedAt)}`,
      `extraction: ${yaml(conv.source.method)}`,
      `completeness: ${yaml(conv.completeness)}`,
      `messages: ${conv.stats.messages}`,
      "---",
      "",
      `# ${conv.title}`,
      ""
    ];
    if (conv.warnings.length) {
      for (const w of conv.warnings) lines.push(`> **Warning:** ${w.message}`);
      lines.push("");
    }
    conv.messages.forEach((m, i) => {
      const when = timestamp(m.createdAt);
      lines.push(`## ${ROLE_LABEL[m.role] || m.role}${when ? ` \u2014 ${when}` : ""}`);
      lines.push("");
      if (m.siblings > 1) lines.push(`> *This message has ${m.siblings} versions (edited or regenerated); the selected version is shown.*`, "");
      const citations = m.content.filter((b) => b.type === "citation");
      for (const b of m.content) {
        if (b.type === "citation") continue;
        const rendered = renderBlock(b);
        if (rendered) lines.push(rendered, "");
      }
      if (citations.length) lines.push("**Sources:**", "", ...citations.map(renderBlock), "");
      if (m.flags.interrupted) lines.push("> *Response was stopped before completion.*", "");
      if (m.flags.truncated) lines.push("> *Message flagged as truncated by the platform.*", "");
      if (i < conv.messages.length - 1) lines.push("---", "");
    });
    return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
  }

  // src/formatters/json.js
  function toJson(conv) {
    return JSON.stringify(conv, null, 2) + "\n";
  }

  // src/core/markdown-to-html.js
  function escapeHtml(text) {
    return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function safeUrl(url) {
    return /^https?:\/\//i.test(url) ? escapeHtml(url) : null;
  }
  function inline(text) {
    const codes = [];
    let html = escapeHtml(text);
    html = html.replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (m, ticks, code) => {
      codes.push(`<code>${code}</code>`);
      return `\0${codes.length - 1}\0`;
    });
    html = html.replace(/!\[([^\]]*)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g, (m, alt, src) => {
      const u = safeUrl(src);
      return u ? `<img src="${u}" alt="${alt}">` : alt;
    });
    html = html.replace(/\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g, (m, label, href) => {
      const u = safeUrl(href);
      return u ? `<a href="${u}" rel="noopener noreferrer">${label}</a>` : label;
    });
    html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, "$1<em>$2</em>");
    html = html.replace(/~~([^~]+)~~/g, "<del>$1</del>");
    html = html.replace(/\u0000(\d+)\u0000/g, (m, i) => codes[Number(i)]);
    return html;
  }
  function tableHtml(rows) {
    const cells = (line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split(new RegExp("(?<!\\\\)\\|")).map((c) => inline(c.replace(/\\\|/g, "|").trim()));
    const head = cells(rows[0]);
    const body = rows.slice(2).map(cells);
    return `<table><thead><tr>${head.map((c) => `<th>${c}</th>`).join("")}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  }
  function markdownToHtml(markdown) {
    const lines = String(markdown).replace(/\r\n/g, "\n").split("\n");
    const out = [];
    let paragraph = [];
    let list = null;
    const flushParagraph = () => {
      if (paragraph.length) out.push(`<p>${paragraph.map(inline).join("<br>")}</p>`);
      paragraph = [];
    };
    const flushList = () => {
      if (!list) return;
      const stack = [];
      let html = "";
      for (const item of list.items) {
        while (stack.length && stack[stack.length - 1].indent > item.indent) html += `</li></${stack.pop().tag}>`;
        if (!stack.length || stack[stack.length - 1].indent < item.indent) {
          stack.push({ tag: item.tag, indent: item.indent });
          html += `<${item.tag}>`;
        } else {
          html += "</li>";
        }
        html += `<li>${item.html}`;
      }
      while (stack.length) html += `</li></${stack.pop().tag}>`;
      out.push(html);
      list = null;
    };
    const flushAll = () => {
      flushParagraph();
      flushList();
    };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      const fenceMatch = trimmed.match(/^(`{3,}|~{3,})\s*([\w#+.-]*)\s*$/);
      if (fenceMatch) {
        flushAll();
        const marks = fenceMatch[1];
        const code = [];
        i++;
        while (i < lines.length && !(lines[i].trim().startsWith(marks[0]) && lines[i].trim().length >= marks.length && /^[`~]+$/.test(lines[i].trim()))) {
          code.push(lines[i]);
          i++;
        }
        const cls = fenceMatch[2] ? ` class="language-${escapeHtml(fenceMatch[2])}"` : "";
        out.push(`<pre><code${cls}>${escapeHtml(code.join("\n"))}</code></pre>`);
        continue;
      }
      if (trimmed === "$$") {
        flushAll();
        const tex = [];
        i++;
        while (i < lines.length && lines[i].trim() !== "$$") tex.push(lines[i++]);
        out.push(`<div class="math">$$
${escapeHtml(tex.join("\n"))}
$$</div>`);
        continue;
      }
      if (!trimmed) {
        flushAll();
        continue;
      }
      const heading = trimmed.match(/^(#{1,6})\s+(.*)$/);
      if (heading) {
        flushAll();
        out.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`);
        continue;
      }
      if (/^(-{3,}|_{3,}|\*{3,})$/.test(trimmed)) {
        flushAll();
        out.push("<hr>");
        continue;
      }
      if (trimmed.startsWith(">")) {
        flushAll();
        const quote = [trimmed.replace(/^>\s?/, "")];
        while (i + 1 < lines.length && lines[i + 1].trim().startsWith(">")) quote.push(lines[++i].trim().replace(/^>\s?/, ""));
        out.push(`<blockquote>${markdownToHtml(quote.join("\n"))}</blockquote>`);
        continue;
      }
      if (/^\|.*\|\s*$/.test(trimmed) && i + 1 < lines.length && /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(lines[i + 1].trim())) {
        flushAll();
        const rows = [trimmed, lines[++i].trim()];
        while (i + 1 < lines.length && /^\|.*\|\s*$/.test(lines[i + 1].trim())) rows.push(lines[++i].trim());
        out.push(tableHtml(rows));
        continue;
      }
      const bullet = line.match(/^(\s*)[-*+]\s+(.*)$/);
      const ordered = line.match(/^(\s*)\d+[.)]\s+(.*)$/);
      if (bullet || ordered) {
        flushParagraph();
        const m = bullet || ordered;
        const indent = m[1].replace(/\t/g, "  ").length;
        if (!list) list = { items: [] };
        list.items.push({ tag: bullet ? "ul" : "ol", indent, html: inline(m[2]) });
        continue;
      }
      if (list && /^\s{2,}\S/.test(line)) {
        list.items[list.items.length - 1].html += `<br>${inline(trimmed)}`;
        continue;
      }
      flushList();
      paragraph.push(trimmed);
    }
    flushAll();
    return out.join("\n");
  }

  // src/formatters/html.js
  var CSS2 = `
body{margin:0;background:#f5f5f7;color:#1d1d1f;font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC",sans-serif}
main{max-width:860px;margin:0 auto;padding:32px 20px 64px}
h1{font-size:24px;margin:0 0 6px}
.meta{color:#6e6e73;font-size:13px}.meta span{margin-right:14px}
.warning,.note{background:#fff7e6;border:1px solid #ffd591;color:#613400;border-radius:8px;padding:6px 10px;margin:8px 0;font-size:13px}
article{background:#fff;border:1px solid #e5e5ea;border-radius:12px;padding:16px 20px;margin:16px 0}
article.user{background:#eef3ff;border-color:#d3dffb}
.role{font-weight:700;font-size:13px;text-transform:uppercase;color:#6e6e73;margin-bottom:8px}
.role time{font-weight:400;text-transform:none;margin-left:8px}
pre{background:#1e1e24;color:#f3f3f3;padding:12px 14px;border-radius:8px;overflow:auto;font:13px/1.5 ui-monospace,Menlo,monospace}
code{font:.92em ui-monospace,Menlo,monospace;background:#0000000f;padding:1px 4px;border-radius:4px}
pre code{background:none;padding:0;font-size:inherit}
table{border-collapse:collapse;margin:10px 0;display:block;overflow:auto}
th,td{border:1px solid #d2d2d7;padding:6px 10px;text-align:left;vertical-align:top}th{background:#f0f0f5}
blockquote{margin:8px 0;padding:4px 14px;border-left:3px solid #c7c7cc;color:#515154}
img{max-width:100%;height:auto;border-radius:6px}
.math{font-family:ui-monospace,monospace;white-space:pre-wrap;border:1px dashed #d2d2d7;padding:8px;border-radius:6px}
hr{border:0;border-top:1px solid #e5e5ea;margin:16px 0}
`;
  function blockHtml(b) {
    if (b.type === "image" && b.url && /^https?:\/\//i.test(b.url)) {
      return `<figure><img src="${escapeHtml(b.url)}" alt="${escapeHtml(b.alt || b.name)}"><figcaption>${escapeHtml(b.name)}</figcaption></figure>`;
    }
    return markdownToHtml(renderBlock(b));
  }
  function toHtml(conv) {
    const meta = [
      `<span>Platform: ${escapeHtml(conv.platform)}</span>`,
      conv.model ? `<span>Model: ${escapeHtml(conv.model)}</span>` : "",
      conv.createdAt ? `<span>Created: ${escapeHtml(conv.createdAt)}</span>` : "",
      `<span>Exported: ${escapeHtml(conv.exportedAt)}</span>`,
      `<span>Messages: ${conv.stats.messages}</span>`,
      conv.source.url ? `<span><a href="${escapeHtml(conv.source.url)}" rel="noopener noreferrer">Original conversation</a></span>` : ""
    ].filter(Boolean).join("");
    const warnings = conv.warnings.map((w) => `<div class="warning">${escapeHtml(w.message)}</div>`).join("\n");
    const articles = conv.messages.map((m) => {
      const when = m.createdAt ? `<time datetime="${escapeHtml(m.createdAt)}">${escapeHtml(m.createdAt.replace("T", " ").replace(/\.\d{3}Z$/, " UTC"))}</time>` : "";
      const notes = [];
      if (m.siblings > 1) notes.push(`This message has ${m.siblings} versions (edited or regenerated); the selected version is shown.`);
      if (m.flags.interrupted) notes.push("Response was stopped before completion.");
      if (m.flags.truncated) notes.push("Message flagged as truncated by the platform.");
      const citations = m.content.filter((b) => b.type === "citation");
      const body = m.content.filter((b) => b.type !== "citation").map(blockHtml).join("\n");
      const sources = citations.length ? `<p><strong>Sources:</strong></p>${markdownToHtml(citations.map(renderBlock).join("\n"))}` : "";
      return `<article class="${escapeHtml(m.role)}">
<div class="role">${escapeHtml(ROLE_LABEL[m.role] || m.role)}${when}</div>
${notes.map((n) => `<div class="note">${escapeHtml(n)}</div>`).join("\n")}
${body}
${sources}
</article>`;
    }).join("\n");
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="${escapeHtml(conv.exporter.name)} ${escapeHtml(conv.exporter.version)}">
<title>${escapeHtml(conv.title)}</title>
<style>${CSS2}</style>
</head>
<body>
<main>
<header>
<h1>${escapeHtml(conv.title)}</h1>
<div class="meta">${meta}</div>
</header>
${warnings}
${articles}
</main>
</body>
</html>
`;
  }

  // src/core/run.js
  var API_TIMEOUT_MS = 2e4;
  var FORMATS = [
    { id: "md", label: "Markdown", ext: "md", mime: "text/markdown;charset=utf-8", render: toMarkdown },
    { id: "json", label: "JSON", ext: "json", mime: "application/json;charset=utf-8", render: toJson },
    { id: "html", label: "HTML", ext: "html", mime: "text/html;charset=utf-8", render: toHtml }
  ];
  function withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`API timed out after ${ms} ms`)), ms);
      promise.then(
        (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        (e) => {
          clearTimeout(timer);
          reject(e);
        }
      );
    });
  }
  async function extractConversation(adapter7, env) {
    const warnings = [];
    const warn = (code, message) => {
      if (!warnings.some((w) => w.code === code && w.message === message)) warnings.push({ code, message });
    };
    const ctx = {
      location: env.location,
      document: env.document,
      net: createNet(env.location, adapter7.allowedPaths, env.fetch),
      warn
    };
    let conv = null;
    let apiError = null;
    if (adapter7.fromApi) {
      try {
        conv = await withTimeout(adapter7.fromApi(ctx), env.apiTimeoutMs || API_TIMEOUT_MS);
      } catch (e) {
        apiError = e;
      }
    }
    if (!conv) {
      conv = adapter7.fromDom(ctx);
      if (conv && adapter7.fromApi) {
        warn("dom-fallback", `${t("dom_fallback")}${apiError ? ` (${apiError.message})` : ""}`);
        if (conv.completeness === "unknown") conv.completeness = "partial";
      }
    }
    if (!conv) return null;
    finalize(conv);
    for (const w of warnings) conv.warnings.push(w);
    const issues = validateConversation(conv);
    if (issues.length) throw new Error(`schema validation failed: ${issues.join("; ")}`);
    return conv;
  }
  async function run(env) {
    env = env || {};
    const doc = env.document || document;
    const loc = env.location || location;
    const panel = createPanel(doc);
    try {
      const adapter7 = detectAdapter(loc);
      if (!adapter7) {
        panel.showError(t("unsupported", { list: supportedNames().join(", ") }));
        return null;
      }
      if (adapter7.status === "planned") {
        panel.showError(t("planned", { name: adapter7.name }));
        return null;
      }
      if (!adapter7.conversationId(loc)) {
        panel.showError(t("noConversation"));
        return null;
      }
      panel.showLoading();
      const conv = await extractConversation(adapter7, { location: loc, document: doc, fetch: env.fetch, apiTimeoutMs: env.apiTimeoutMs });
      if (!conv || !conv.stats.messages) {
        panel.showError(t("empty"));
        return null;
      }
      const warnings = conv.warnings.map((w) => w.message);
      if (conv.stats.branchedMessages) warnings.push(t("branches", { count: conv.stats.branchedMessages }));
      const status = `${t("exported", { count: conv.stats.messages })}${conv.completeness === "partial" ? ` \xB7 ${t("partial")}` : ""}`;
      const meta = `${adapter7.name} \xB7 ${conv.source.method === "api" ? t("source_api") : t("source_dom")} \xB7 ${conv.title}`;
      panel.showResult({
        statusText: status,
        metaText: meta,
        warnings,
        partial: conv.completeness === "partial",
        buttons: FORMATS.map((f) => ({
          label: f.label,
          onClick: () => downloadText(f.render(conv), buildFilename(adapter7.id, conv.title, f.ext), f.mime, doc)
        }))
      });
      return conv;
    } catch (e) {
      panel.showError(t("error", { message: e && e.message ? e.message : String(e) }));
      return null;
    }
  }

  // src/main.js
  run();
})();
