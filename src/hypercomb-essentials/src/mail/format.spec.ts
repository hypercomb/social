// mail/format.spec.ts — what a person types, made into a message. The html must
// be exactly the marks the composer offers and nothing a typed character could
// turn into: every hostile case below arrives as visible text, never as markup.

import { describe, expect, it } from 'vitest'
import { formatMessage } from './format.js'

const html = (source: string): string => formatMessage(source).html
const text = (source: string): string => formatMessage(source).text

/** Every tag name the html contains, so a test can say "only these". */
const tags = (markup: string): string[] => [...new Set(Array.from(markup.matchAll(/<\/?([a-z0-9]+)/gi), m => m[1]!.toLowerCase()))].sort()
const ALLOWED_TAGS = new Set(['a', 'blockquote', 'br', 'code', 'em', 'h1', 'h2', 'li', 'ol', 'p', 'strong', 'ul'])

describe('paragraphs and line breaks', () => {
  it('makes a paragraph per blank-line gap and keeps single line breaks', () => {
    expect(html('one\ntwo\n\nthree')).toBe('<p>one<br>two</p>\n<p>three</p>')
    expect(text('one\ntwo\n\nthree')).toBe('one\ntwo\n\nthree')
  })

  it('reads CRLF and lone CR as line ends, and turns nothing into nothing', () => {
    expect(html('a\r\nb\r\rc')).toBe('<p>a<br>b</p>\n<p>c</p>')
    expect(formatMessage('')).toEqual({ html: '', text: '' })
    expect(formatMessage('  \n\n ')).toEqual({ html: '', text: '' })
  })
})

describe('the marks', () => {
  it('bold, italic and code', () => {
    expect(html('a **bold** and _italic_ and `x < y`')).toBe('<p>a <strong>bold</strong> and <em>italic</em> and <code>x &lt; y</code></p>')
    expect(text('a **bold** and _italic_ and `x < y`')).toBe('a bold and italic and x < y')
  })

  it('nests one mark in another', () => {
    expect(html('**bold _and italic_**')).toBe('<p><strong>bold <em>and italic</em></strong></p>')
  })

  it('leaves snake_case words and lone stars alone', () => {
    expect(html('snake_case_name and 2 * 3 * 4')).toBe('<p>snake_case_name and 2 * 3 * 4</p>')
    expect(html('_ not italic _')).toBe('<p>_ not italic _</p>')
    expect(html('** not bold **')).toBe('<p>** not bold **</p>')
  })

  it('does not read marks inside code', () => {
    expect(html('`**not bold** [x](https://a.example)`')).toBe('<p><code>**not bold** [x](https://a.example)</code></p>')
  })

  it('headings, one and two hashes only', () => {
    expect(html('# Title\n## Part\n### not a heading')).toBe('<h1>Title</h1>\n<h2>Part</h2>\n<p>### not a heading</p>')
    expect(html('#hashtag')).toBe('<p>#hashtag</p>')
    expect(text('# Title\nbody')).toBe('Title\n\nbody')
  })

  it('bullet and numbered lists, with indented continuation lines', () => {
    expect(html('- one\n- two\n  more of two\nafter')).toBe('<ul><li>one</li><li>two<br>more of two</li></ul>\n<p>after</p>')
    expect(html('1. one\n2. two')).toBe('<ol><li>one</li><li>two</li></ol>')
    expect(html('3. three\n4. four')).toBe('<ol start="3"><li>three</li><li>four</li></ol>')
    expect(text('- one\n- **two**')).toBe('- one\n- two')
    expect(text('3. three\n4. four')).toBe('3. three\n4. four')
  })

  it('starts a list right under a line of text', () => {
    expect(html('Bring:\n- bread\n- salt')).toBe('<p>Bring:</p>\n<ul><li>bread</li><li>salt</li></ul>')
  })

  it('quotes, with marks and paragraphs inside, and nested quotes', () => {
    expect(html('> said **this**\n>\n> > and before')).toBe('<blockquote><p>said <strong>this</strong></p>\n<blockquote><p>and before</p></blockquote></blockquote>')
    expect(text('> said **this**\n>\n> > and before')).toBe('> said this\n>\n> > and before')
  })
})

describe('links', () => {
  it('writes [text](url) as a link that opens nothing of ours', () => {
    expect(html('see [the plan](https://hypercomb.com/plan?a=1&b=2)')).toBe('<p>see <a href="https://hypercomb.com/plan?a=1&amp;b=2" rel="noopener noreferrer">the plan</a></p>')
    expect(text('see [the plan](https://hypercomb.com/plan)')).toBe('see the plan <https://hypercomb.com/plan>')
  })

  it('links bare http, https and mailto URLs, leaving sentence punctuation outside', () => {
    expect(html('go to https://hypercomb.com/a_b. Or mailto:jaime@hypercomb.com!')).toBe(
      '<p>go to <a href="https://hypercomb.com/a_b" rel="noopener noreferrer">https://hypercomb.com/a_b</a>. '
      + 'Or <a href="mailto:jaime@hypercomb.com" rel="noopener noreferrer">mailto:jaime@hypercomb.com</a>!</p>',
    )
    expect(html('(https://en.wikipedia.org/wiki/Bee_(disambiguation))')).toContain('href="https://en.wikipedia.org/wiki/Bee_(disambiguation)"')
    expect(html('(see https://a.example)')).toContain('href="https://a.example/"')
    expect(text('go to https://hypercomb.com.')).toBe('go to https://hypercomb.com.')
  })

  it('makes an empty label the url itself', () => {
    expect(html('[](https://a.example)')).toBe('<p><a href="https://a.example/" rel="noopener noreferrer">https://a.example</a></p>')
  })

  it('does not link inside a link', () => {
    const out = html('[go https://b.example](https://a.example)')
    expect(out.match(/<a /g)?.length).toBe(1)
  })
})

describe('hostile input', () => {
  it('a typed <script> is text', () => {
    const out = html('<script>alert(1)</script>')
    expect(out).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>')
    expect(text('<script>alert(1)</script>')).toBe('<script>alert(1)</script>')
  })

  it('a typed <img onerror> is text, and so are attribute breakouts', () => {
    expect(html('<img src=x onerror="alert(1)">')).toBe('<p>&lt;img src=x onerror=&quot;alert(1)&quot;&gt;</p>')
    expect(html("**<b onclick='x'>**")).toBe('<p><strong>&lt;b onclick=&#39;x&#39;&gt;</strong></p>')
  })

  it('a javascript: link is not a link', () => {
    for (const source of ['[x](javascript:alert(1))', '[x]( JaVaScRiPt:alert(1))', '[x](java\tscript:alert(1))', 'javascript:alert(1)', '[x](\u0001javascript:alert(1))']) {
      const out = html(source)
      expect(out).not.toContain('<a')
      expect(out).not.toContain('href')
    }
  })

  it('a data:, relative, protocol-relative or vbscript link is not a link', () => {
    for (const source of ['[x](data:text/html;base64,PHNjcmlwdD4=)', '[x](/etc/passwd)', '[x](//evil.example)', '[x](vbscript:msgbox)', '[x](file:///c:/x)', '[x](https://)']) {
      expect(html(source)).not.toContain('<a')
    }
  })

  it('a url cannot break out of its attribute', () => {
    const out = html('[x](https://a.example/"onmouseover="alert(1))')
    expect(out).not.toMatch(/"\s*onmouseover/)
    const bare = html('https://a.example/x"onmouseover="y')
    expect(bare).not.toMatch(/"\s*onmouseover/)
  })

  it('unbalanced marks stay as typed', () => {
    expect(html('**open and never closed')).toBe('<p>**open and never closed</p>')
    expect(html('_open')).toBe('<p>_open</p>')
    expect(html('`open')).toBe('<p>`open</p>')
    expect(html('[open](https://a.example')).toBe('<p>[open](https://a.example</p>')
    expect(html('[open] (https://a.example)')).toContain('[open] (<a href')
  })

  it('only the composer\'s own tags can appear, whatever is typed', () => {
    const nasty = [
      '<style>body{background:url(https://t.example/p)}</style>', '<iframe src=https://a>', '![img](https://t.example/p.gif)',
      '<a href="javascript:x">y</a>', '<svg onload=x>', '"><script>x</script>', '&lt;script&gt;', '[<img src=x>](https://a.example)',
    ].join('\n\n')
    const out = html(nasty)
    for (const tag of tags(out)) expect(ALLOWED_TAGS.has(tag)).toBe(true)
    // Read back as a browser would: the only attributes anywhere are a link's href and rel.
    const doc = new DOMParser().parseFromString(out, 'text/html')
    for (const el of Array.from(doc.body.querySelectorAll('*'))) {
      expect(ALLOWED_TAGS.has(el.tagName.toLowerCase())).toBe(true)
      for (const attr of Array.from(el.attributes)) expect(['href', 'rel']).toContain(attr.name)
    }
    for (const a of Array.from(doc.querySelectorAll('a'))) expect(a.getAttribute('href')).toMatch(/^https:\/\//)
    expect(doc.querySelectorAll('img, style, script, iframe, svg').length).toBe(0)
    expect(out).toContain('&amp;lt;script&amp;gt;')
  })

  it('finishes fast on a megabyte of nested and unbalanced marks', () => {
    const MB = 1024 * 1024
    const cases = [
      '**_'.repeat(MB / 3) + 'x' + '_**'.repeat(MB / 3),
      '**'.repeat(MB / 2),
      '_a '.repeat(MB / 3),
      '['.repeat(MB),
      '[x]('.repeat(MB / 4),
      '`'.repeat(MB),
      'https://a.example/'.repeat(MB / 18),
      'http:// '.repeat(MB / 8),
      `https://a.example/${')'.repeat(MB)}`,
      '> '.repeat(MB / 2) + 'deep',
      Array.from({ length: MB / 8 }, () => '> > > >').join('\n'),
      Array.from({ length: MB / 4 }, (_, i) => (i % 2 ? '- x' : '1. y')).join('\n'),
      ' '.repeat(MB) + 'x',
    ]
    for (const source of cases) {
      const started = performance.now()
      const out = formatMessage(source)
      expect(performance.now() - started).toBeLessThan(2000)
      expect(typeof out.html).toBe('string')
      expect(typeof out.text).toBe('string')
    }
  })

  it('stops nesting quotes at a fixed depth, keeping the rest as text', () => {
    const out = html('> '.repeat(20) + 'deep')
    expect(out.match(/<blockquote>/g)?.length).toBe(8)
    expect(out).toContain('&gt; &gt;')
  })
})
