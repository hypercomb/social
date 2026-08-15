// hypercomb-shared/ui/chat-window/chat-markdown.spec.ts
//
// The renderer is the chat window's entire safety boundary — its output is
// handed to `bypassSecurityTrustHtml`, so "no unescaped model text survives"
// is not a style preference, it is the invariant. Most of what is checked here
// is that invariant under the passes that could plausibly break it: a code span
// that hides a tag, a link whose href is a script, an autolink next to markup.

import { describe, expect, it } from 'vitest'
import { isHivePath, renderChatMarkdown } from './chat-markdown'

describe('renderChatMarkdown — escaping', () => {
  it('escapes tags in prose', () => {
    const html = renderChatMarkdown('watch out for <img src=x onerror=alert(1)>')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img')
  })

  it('escapes tags inside code spans and fences', () => {
    expect(renderChatMarkdown('use `<script>alert(1)</script>`')).not.toContain('<script')
    expect(renderChatMarkdown('```html\n<script>alert(1)</script>\n```')).not.toContain('<script>alert')
  })

  it('drops javascript: and data: hrefs, keeping the text', () => {
    const html = renderChatMarkdown('[click me](javascript:alert(1))')
    expect(html).not.toContain('javascript:')
    expect(html).toContain('click me')
  })

  it('keeps http(s) links, opened away from the shell document', () => {
    const html = renderChatMarkdown('[docs](https://example.com/a?x=1&y=2)')
    expect(html).toContain('href="https://example.com/a?x=1&amp;y=2"')
    expect(html).toContain('rel="noopener noreferrer"')
  })

  it('autolinks a bare URL without swallowing the sentence', () => {
    const html = renderChatMarkdown('see https://example.com/x. next')
    expect(html).toContain('href="https://example.com/x"')
    expect(html).toContain('. next')
  })

  it('cannot be tricked by a forged placeholder', () => {
    // The sentinels are stripped from the input before any pass runs, so text
    // shaped like a placeholder is inert rather than a hole in the escaping.
    const NUL = String.fromCharCode(0)
    const SOH = String.fromCharCode(1)
    const forged = renderChatMarkdown(`${NUL}0${NUL} and ${SOH}0${SOH}`)
    expect(forged).not.toContain('<code>')
    expect(forged).not.toContain('<a ')
  })
})

describe('renderChatMarkdown — blocks', () => {
  it('renders headings, lists and rules', () => {
    const html = renderChatMarkdown('# Title\n\n- one\n- two\n\n---\n')
    expect(html).toContain('<h1>Title</h1>')
    expect(html).toContain('<ul><li>one</li><li>two</li></ul>')
    expect(html).toContain('<hr>')
  })

  it('nests a sub-list inside its parent', () => {
    const html = renderChatMarkdown('- one\n  - deep\n- two')
    expect(html).toBe('<ul><li>one</li><ul><li>deep</li></ul><li>two</li></ul>')
  })

  it('renders a fenced block with its language and a copy button', () => {
    const html = renderChatMarkdown('```ts\nconst a = 1\n```')
    expect(html).toContain('class="language-ts"')
    expect(html).toContain('data-copy-code')
    expect(html).toContain('const a = 1')
  })

  it('closes an unterminated fence — a stream is read while it arrives', () => {
    const html = renderChatMarkdown('here:\n```js\nconst half =')
    expect(html).toContain('<pre><code class="language-js">const half =</code></pre>')
  })

  it('renders a GFM table inside its own scroller', () => {
    const html = renderChatMarkdown('| a | b |\n|---|---|\n| 1 | 2 |')
    expect(html).toContain('<div class="chat-table">')
    expect(html).toContain('<th>a</th>')
    expect(html).toContain('<td>2</td>')
  })

  it('applies emphasis without eating an unpaired asterisk', () => {
    expect(renderChatMarkdown('**bold** and *soft*')).toContain('<strong>bold</strong>')
    expect(renderChatMarkdown('2 * 3 * 4')).not.toContain('<em>')
  })
})

describe('hive paths', () => {
  it('accepts a rooted path and a bare slug path', () => {
    expect(isHivePath('/dolphin/site')).toBe(true)
    expect(isHivePath('dolphin/site')).toBe(true)
  })

  it('rejects URLs, single words and dotted file paths', () => {
    expect(isHivePath('https://example.com/a')).toBe(false)
    expect(isHivePath('dolphin')).toBe(false)
    expect(isHivePath('src/index.ts')).toBe(false)
  })

  it('turns a path-shaped code span into a navigating chip, not an anchor', () => {
    const html = renderChatMarkdown('look at `dolphin/site` for that')
    expect(html).toContain('data-hive-path="dolphin/site"')
    expect(html).not.toContain('<a ')
  })

  it('leaves a dotted code span as plain code', () => {
    const html = renderChatMarkdown('open `src/index.ts`')
    expect(html).toContain('<code>src/index.ts</code>')
    expect(html).not.toContain('data-hive-path')
  })

  it('routes a scheme-less markdown link through the hive, not the document', () => {
    const html = renderChatMarkdown('[the site](/dolphin/site)')
    expect(html).toContain('data-hive-path="/dolphin/site"')
    expect(html).not.toContain('href')
  })
})
