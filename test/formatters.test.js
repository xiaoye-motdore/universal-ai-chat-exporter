import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createConversation, createMessage, block, finalize } from '../src/core/schema.js'
import { toMarkdown } from '../src/formatters/markdown.js'
import { toJson } from '../src/formatters/json.js'
import { toHtml } from '../src/formatters/html.js'
import { markdownToHtml } from '../src/core/markdown-to-html.js'

function sample() {
  const conv = createConversation({
    platform: 'claude',
    url: 'https://claude.ai/chat/abc',
    conversationId: 'abc',
    method: 'api',
    title: 'Sample <title> & "quotes"',
    model: 'claude-x',
    createdAt: '2026-10-16T01:02:03.000Z',
    messages: [
      createMessage({ id: 'u1', role: 'user', createdAt: '2026-10-16T01:02:03.000Z', content: [block.text('# My heading\n\nQuestion with | pipe'), block.attachment({ name: 'notes.md', extractedText: '# inner\nline' })] }),
      createMessage({
        id: 'a1',
        role: 'assistant',
        siblings: 2,
        flags: { interrupted: true },
        content: [
          block.text('Answer with $x^2$ and a table\n\n| a | b |\n| --- | --- |\n| 1 | 2 |'),
          block.code('console.log("```")', 'js'),
          block.artifact({ title: 'app.jsx', kind: 'React', language: 'jsx', content: 'export default 1' }),
          block.toolUse('web_search', 'cats'),
          block.citation('Source', 'https://example.com/s'),
          block.image('pic.png', 'https://claude.ai/p.png', 'pic'),
        ],
      }),
    ],
    completeness: 'complete',
  })
  conv.warnings.push({ code: 'w', message: 'A <warning>' })
  return finalize(conv)
}

test('markdown export keeps content verbatim and adds metadata', () => {
  const md = toMarkdown(sample())
  assert.ok(md.startsWith('---\ntitle: "Sample <title> & \\"quotes\\""\nplatform: "claude"'))
  assert.ok(md.includes('messages: 2'))
  assert.ok(md.includes('## User — 2026-10-16 01:02:03 UTC'))
  assert.ok(md.includes('# My heading\n\nQuestion with | pipe'), 'user heading preserved verbatim')
  assert.ok(md.includes('**Attachment:** notes.md\n\n> # inner\n> line'))
  assert.ok(md.includes('> *This message has 2 versions'))
  assert.ok(md.includes('````js\nconsole.log("```")\n````'), 'fence widened around inner backticks')
  assert.ok(md.includes('**Artifact:** app.jsx (React)\n\n```jsx\nexport default 1\n```'))
  assert.ok(md.includes('*[Tool: web_search — cats]*'))
  assert.ok(md.includes('**Sources:**\n\n- [Source](https://example.com/s)'))
  assert.ok(md.includes('![pic](https://claude.ai/p.png)'))
  assert.ok(md.includes('> *Response was stopped before completion.*'))
  assert.ok(md.includes('> **Warning:** A <warning>'))
})

test('json export round-trips the schema', () => {
  const conv = sample()
  const parsed = JSON.parse(toJson(conv))
  assert.equal(parsed.schemaVersion, '1.0')
  assert.equal(parsed.messages.length, 2)
  assert.equal(parsed.messages[1].content[2].type, 'artifact')
  assert.deepEqual(parsed.stats, conv.stats)
})

test('html export escapes everything and renders structure', () => {
  const html = toHtml(sample())
  assert.ok(html.startsWith('<!doctype html>'))
  assert.ok(html.includes('<title>Sample &lt;title&gt; &amp; &quot;quotes&quot;</title>'))
  assert.ok(!html.includes('<warning>'), 'warning text escaped')
  assert.ok(html.includes('<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>'))
  assert.ok(html.includes('<pre><code class="language-js">console.log(&quot;```&quot;)</code></pre>'))
  assert.ok(html.includes('<img src="https://claude.ai/p.png" alt="pic">'))
  assert.ok(html.includes('<a href="https://example.com/s" rel="noopener noreferrer">Source</a>'))
  assert.ok(!/<script/i.test(html), 'no scripts in export')
})

test('markdownToHtml handles nested lists, quotes and unsafe links', () => {
  const html = markdownToHtml('- a\n  - b\n- c\n\n> quoted **x**\n\n[bad](javascript:alert(1)) [ok](https://x.y)')
  assert.equal(html, '<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul>\n<blockquote><p>quoted <strong>x</strong></p></blockquote>\n<p>bad <a href="https://x.y" rel="noopener noreferrer">ok</a></p>')
})
