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
