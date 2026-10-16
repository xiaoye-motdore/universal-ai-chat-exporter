import { test } from 'node:test'
import assert from 'node:assert/strict'
import { page } from './helpers.js'
import { domToMarkdown } from '../src/core/dom-to-markdown.js'

const convert = (html) => {
  const p = page(`<!doctype html><body><div id="root">${html}</div></body>`, 'https://example.test/x')
  return domToMarkdown(p.document.getElementById('root'), { baseUrl: 'https://example.test/x' })
}

test('paragraphs, emphasis, inline code and links', () => {
  const md = convert('<p>Hello <strong>bold</strong> and <em>it</em> with <code>x = 1</code> see <a href="/doc">doc</a>.</p><p>Second</p>')
  assert.equal(md, 'Hello **bold** and *it* with `x = 1` see [doc](https://example.test/doc).\n\nSecond')
})

test('fenced code keeps language and strips copy-button chrome', () => {
  const md = convert('<pre><div class="chrome"><span>python</span><button>Copy code</button></div><code class="language-python">print(<span class="hl">1</span>)\n</code></pre>')
  assert.equal(md, '```python\nprint(1)\n```')
})

test('fence grows when code contains backticks', () => {
  const md = convert('<pre><code>```\ninner\n```</code></pre>')
  assert.equal(md, '````\n```\ninner\n```\n````')
})

test('nested lists', () => {
  const md = convert('<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul><ol start="3"><li>three</li></ol>')
  assert.equal(md, '- a\n  - b\n- c\n\n3. three')
})

test('tables', () => {
  const md = convert('<table><thead><tr><th>A</th><th>B|C</th></tr></thead><tbody><tr><td>1</td><td><strong>2</strong></td></tr></tbody></table>')
  assert.equal(md, '| A | B\\|C |\n| --- | --- |\n| 1 | **2** |')
})

test('katex math is restored from its TeX annotation', () => {
  const inline = '<span class="katex"><span class="katex-mathml"><math><semantics><mrow></mrow><annotation encoding="application/x-tex">E=mc^2</annotation></semantics></math></span><span class="katex-html">E=mc2</span></span>'
  const md = convert(`<p>Energy: ${inline}</p><span class="katex-display">${inline}</span>`)
  assert.equal(md, 'Energy: $E=mc^2$\n\n$$\nE=mc^2\n$$')
})

test('headings, blockquotes, images, hr and skipped chrome', () => {
  const md = convert('<h2>Title</h2><blockquote><p>q1</p><p>q2</p></blockquote><img src="/i.png" alt="pic"><hr><button>Copy</button><span class="sr-only">hidden</span><svg><path/></svg>')
  assert.equal(md, '## Title\n\n> q1\n>\n> q2\n\n![pic](https://example.test/i.png)\n\n---')
})

test('markdown special characters in text are escaped', () => {
  assert.equal(convert('<p>a*b_c[d]</p>'), 'a\\*b\\_c\\[d\\]')
})

test('language label beside copy-button chrome, with comment nodes in between', () => {
  const md = convert('<div><!--x--><span>bash</span><span aria-hidden="true">copy</span><button>Copied</button><!--y--><pre><code>echo hi</code></pre></div><div><span>Copied</span><pre><code>plain</code></pre></div>')
  assert.equal(md, '```bash\necho hi\n```\n\nCopied\n\n```\nplain\n```')
})
