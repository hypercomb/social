// mail/mail-html.spec.ts — HTML mail from a stranger, made safe to show. Every
// case here is a way a message could make this browser DO something: run script,
// load from another host, navigate, or fill in a form. None of them survive.

import { describe, expect, it } from 'vitest'
import { mailFrameDocument, makeMailHtmlSafe } from './mail-html.js'

const PNG = 'data:image/png;base64,iVBORw0KGgo='

describe('what is removed', () => {
  it('removes script, frames, objects, forms and every event handler', () => {
    const { html } = makeMailHtmlSafe(
      '<p onclick="x()" onmouseover=y()>hi</p><script>alert(1)</script><iframe src="https://a"></iframe>'
      + '<object data="a"></object><embed src="a"><form action="https://a"><input name="q"><button>go</button></form>'
      + '<svg onload="x()"><script>1</script></svg><math></math><video src="a"></video>',
    )
    expect(html).toBe('<p>hi</p>')
  })

  it('removes meta refresh, base and link tags', () => {
    const { html } = makeMailHtmlSafe('<meta http-equiv="refresh" content="0;url=https://a"><base href="https://a/"><link rel="stylesheet" href="https://a/x.css"><p>ok</p>')
    expect(html).toBe('<p>ok</p>')
  })

  it('drops javascript: and data: links but keeps http, https and mailto, opened safely', () => {
    const { html } = makeMailHtmlSafe(
      '<a href="javascript:alert(1)">a</a><a href="data:text/html,<script>1</script>">b</a>'
      + '<a href="https://example.org/x">c</a><a href="mailto:a@b.co">d</a><a href=" JaVaScRiPt:1">e</a>',
    )
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const hrefs = Array.from(doc.querySelectorAll('a')).map(a => a.getAttribute('href'))
    expect(hrefs).toEqual([null, null, 'https://example.org/x', 'mailto:a@b.co', null])
    for (const a of Array.from(doc.querySelectorAll('a[href]'))) {
      expect(a.getAttribute('rel')).toBe('noopener noreferrer')
      expect(a.getAttribute('target')).toBe('_blank')
    }
  })
})

describe('nothing remote loads', () => {
  it('drops remote images and counts them', () => {
    const { html, blocked } = makeMailHtmlSafe('<img src="https://tracker.example/p.gif"><img src="//tracker.example/q.gif"><img src="http://t/r.gif" srcset="a 1x, b 2x">')
    expect(html).not.toContain('tracker.example')
    expect(html).not.toContain('srcset')
    expect(blocked).toBeGreaterThanOrEqual(4)
  })

  it('keeps an image whose bytes are in the message, by data: URL or by cid', () => {
    const { html, blocked } = makeMailHtmlSafe(`<img src="${PNG}"><img src="cid:logo">`, { logo: PNG })
    expect(html.match(/src="data:image\/png/g)?.length).toBe(2)
    expect(blocked).toBe(0)
  })

  it('refuses a cid the message did not carry, and any data: that is not a plain image', () => {
    const { html, blocked } = makeMailHtmlSafe('<img src="cid:missing"><img src="data:image/svg+xml;base64,PHN2Zz4="><img src="data:text/html;base64,PHA+">')
    expect(html).not.toContain('src=')
    expect(blocked).toBe(3)
  })

  it('removes outside references from style attributes and style blocks, and keeps the rest', () => {
    const { html, blocked } = makeMailHtmlSafe(
      '<style>@import url(https://a/x.css); .a { background: url("https://a/b.png"); color: red }</style>'
      + `<div style="background:url('http://a/c.png'); color: blue; width: expression(alert(1))">x</div>`
      + `<p style="background-image:url(${PNG})">y</p><table><tr><td background="https://a/bg.png">z</td></tr></table>`,
    )
    expect(html).not.toMatch(/https?:\/\/a/)
    expect(html).not.toContain('expression')
    expect(html).toContain('color: red')
    expect(html).toContain('color: blue')
    expect(html).toContain(PNG)
    expect(blocked).toBeGreaterThanOrEqual(4)
  })
})

describe('the frame', () => {
  it('carries its own policy: no load but a data: image, nothing else', () => {
    const doc = mailFrameDocument('<p>hi</p>')
    expect(doc).toContain("default-src 'none'")
    expect(doc).toContain('img-src data:')
    expect(doc).not.toMatch(/script-src|connect-src [^'n]/)
    expect(doc.endsWith('<p>hi</p>')).toBe(true)
  })

  it('does not let a message close the policy tag and inject its own', () => {
    const { html } = makeMailHtmlSafe('<meta http-equiv="Content-Security-Policy" content="default-src *"><p>x</p>')
    expect(html).not.toContain('Content-Security-Policy')
  })
})

describe('what was held back, by kind', () => {
  it('splits the refusals into images, styles and other, adding up to blocked', () => {
    const { blocked, blockedByKind } = makeMailHtmlSafe(
      '<style>@import url(https://a/x.css); .a { background: url("https://a/b.png") }</style>'
      + '<img src="https://t/p.gif"><img src="cid:missing" srcset="a 1x"><table><tr><td background="https://a/bg.png">z</td></tr></table>'
      + `<div style="background:url('http://a/c.png')">x</div><div data="https://a/o">y</div>`,
    )
    expect(blockedByKind).toEqual({ images: 4, styles: 3, other: 1 })
    expect(blocked).toBe(8)
  })

  it('is all zeros for a message that asked for nothing remote', () => {
    const { blocked, blockedByKind } = makeMailHtmlSafe(`<p>hi</p><img src="${PNG}">`)
    expect(blockedByKind).toEqual({ images: 0, styles: 0, other: 0 })
    expect(blocked).toBe(0)
  })

  it('always adds up, for every message the rules above were tested on', () => {
    for (const source of [
      '<img src="https://tracker.example/p.gif"><img src="//tracker.example/q.gif"><img src="http://t/r.gif" srcset="a 1x, b 2x">',
      '<img src="cid:missing"><img src="data:image/svg+xml;base64,PHN2Zz4="><img src="data:text/html;base64,PHA+">',
      '<style>@import "https://a/x.css";</style><p style="background-image:url(https://a/y.png)">z</p>',
    ]) {
      const { blocked, blockedByKind } = makeMailHtmlSafe(source)
      expect(blockedByKind.images + blockedByKind.styles + blockedByKind.other).toBe(blocked)
      expect(blocked).toBeGreaterThan(0)
    }
  })
})

describe('after the security review (R1)', () => {
  /** Every element the frame's own parser sees, after the frame document is built from the safe html. */
  const frameElements = (source: string): Element[] => {
    const doc = new DOMParser().parseFromString(mailFrameDocument(makeMailHtmlSafe(source).html), 'text/html')
    return Array.from(doc.querySelectorAll('*'))
  }
  const FRAME_OWN = new Set(['html', 'head', 'body', 'meta', 'base', 'style', 'p'])

  it('#1 no removal can leave a </style> behind that ends the style and lets markup out', () => {
    const payload = '<link rel="preconnect" href="https://tracker.example"><meta http-equiv="refresh" content="0;url=https://t.example">'
      + '<img src="https://tracker.example/p.gif"><form action="https://t.example"><input name="q"></form><base href="https://t.example/">'
    const removals = ['@import;', '@import url(https://t.example/x.css);', 'expression(', 'behavior:', '-moz-binding:', 'url(https://t.example/a)', 'image-set("x" 1x)', '\\3c /', '\\3c']
    for (const removal of removals) {
      for (const before of ['', '<p>first</p>']) {
        const elements = frameElements(`${before}<style>p{} </sty${removal}le>${payload}</style><p>ok</p>`)
        for (const el of elements) expect(FRAME_OWN.has(el.tagName.toLowerCase()), `${removal}: <${el.tagName}>`).toBe(true)
        expect(elements.filter(el => el.tagName === 'META').length).toBe(2)
        for (const el of elements) {
          expect(el.getAttribute('http-equiv')?.toLowerCase()).not.toBe('refresh')
          expect(el.hasAttribute('href')).toBe(false)
          expect(el.hasAttribute('src')).toBe(false)
        }
      }
    }
  })

  it('#1 a `<` in style text is written as a CSS escape, so the text can never close its element', () => {
    const { html } = makeMailHtmlSafe('<style>p::after{content:"<"} a{color:red}</style><p style="--x:\'<\'">y</p>')
    expect(html).not.toMatch(/<\/style[^>]*>[\s\S]*<\/style/i)
    expect(html).toContain('content:"\\3c "')
    expect(html).toContain('color:red')
  })

  it('#1 the frame names base-uri and form-action, which do not fall back to default-src', () => {
    const doc = mailFrameDocument('')
    expect(doc).toContain("base-uri 'none'")
    expect(doc).toContain("form-action 'none'")
  })

  it('#9 a cid named like an Object member finds nothing, loses its src and is counted', () => {
    for (const images of [{}, Object.create(null) as Record<string, string>, { logo: PNG }]) {
      const { html, blocked, blockedByKind } = makeMailHtmlSafe('<img src="cid:constructor"><img src="cid:toString"><img src="cid:__proto__"><img src="cid:hasOwnProperty">', images)
      expect(html).not.toContain('src=')
      expect(blocked).toBe(4)
      expect(blockedByKind.images).toBe(4)
    }
  })

  it('#9 an inline image that is not a plain data: image is refused even when the message named it', () => {
    const { html, blocked } = makeMailHtmlSafe('<img src="cid:x">', { x: 'https://tracker.example/p.gif' })
    expect(html).not.toContain('tracker')
    expect(blocked).toBe(1)
  })

  it('#10 CSS escapes, image-set, image() and src() are read through and cut, and counted', () => {
    const inputs = [
      '<p style="background:u\\72l(https://tracker.example/a.png)">x</p>',
      '<p style="background:\\75\\72\\6c (https://tracker.example/a.png)">x</p>',
      `<p style="background-image:image-set('https://tracker.example/a.png' 1x)">x</p>`,
      '<p style="background-image:-webkit-image-set(url(https://tracker.example/a.png) 1x, url(https://tracker.example/b.png) 2x)">x</p>',
      '<p style="background-image:image(&quot;https://tracker.example/a.png&quot;)">x</p>',
      '<style>@font-face{font-family:x;src:src("https://tracker.example/f.woff")}</style><p>y</p>',
      '<style>@\\69mport "https://tracker.example/x.css";</style><p>y</p>',
      '<style>@IMPORT "https://tracker.example/x.css"; .a{background:URL( "https://tracker.example/a" )}</style><p>y</p>',
    ]
    for (const source of inputs) {
      const { html, blocked, blockedByKind } = makeMailHtmlSafe(source)
      expect(blocked, source).toBeGreaterThanOrEqual(1)
      expect(blockedByKind.styles, source).toBe(blocked)
      expect(html, source).not.toContain('https:')
      expect(html, source).not.toContain('tracker')
    }
  })

  it('#10 a data: image in CSS still shows, escaped or not', () => {
    const { html, blocked } = makeMailHtmlSafe(`<p style="background:u\\72l(${PNG})">x</p>`)
    expect(html).toContain(PNG)
    expect(blocked).toBe(0)
  })

  it('#10 an unclosed call is cut to the end, not left half open', () => {
    const { html, blocked } = makeMailHtmlSafe('<style>.a{background:url("https://tracker.example/a.png</style><p>y</p>')
    expect(html).not.toContain('tracker')
    expect(blocked).toBe(1)
  })

  it('stays quick on a large hostile style', () => {
    const started = performance.now()
    makeMailHtmlSafe(`<style>${'url('.repeat(1e5)}${'\\'.repeat(1e5)}${'@import '.repeat(1e4)}${'('.repeat(1e5)}</style>`)
    expect(performance.now() - started).toBeLessThan(1000)
  })
})
