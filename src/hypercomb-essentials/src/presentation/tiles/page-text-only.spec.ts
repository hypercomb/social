import { describe, expect, it } from 'vitest'
import { differsOnlyInText } from './page-text-only.js'
import { authoredOrder, replaceTextInPage } from './site-text-edit.js'

// A CONTRIBUTION THAT CHANGES ONLY WORDS RUNS NOTHING NEW (documentation/
// page-contributions.md, step 1): it may be viewed without review. Every other
// difference — markup, attributes, code — sends it through the activation gate.

const BASE = `<!doctype html>
<html><head><title>Bees</title><style>h1{color:red}</style><script>window.n = 1</script></head>
<body>
  <!-- the hero -->
  <h1 class="hero">Hello world</h1>
  <p>First <b>bold</b> after</p>
  <a href="/next">Next page</a>
  <template shadowrootmode="open"><p>inside</p><script>window.m = 1</script></template>
</body></html>`

const swap = (from: string, to: string): string => {
  expect(BASE.includes(from), `fixture holds ${from}`).toBe(true)
  return BASE.replace(from, to)
}

describe('differsOnlyInText', () => {
  it('passes the same page', () => {
    expect(differsOnlyInText(BASE, BASE)).toBe(true)
  })

  it('passes changed words — in the body, inside nested markup, in the title, in a template', () => {
    expect(differsOnlyInText(BASE, swap('Hello world', 'Welcome, bees'))).toBe(true)
    expect(differsOnlyInText(BASE, swap('<b>bold</b>', '<b>strong</b>'))).toBe(true)
    expect(differsOnlyInText(BASE, swap('<title>Bees</title>', '<title>Hive</title>'))).toBe(true)
    expect(differsOnlyInText(BASE, swap('<p>inside</p>', '<p>within</p>'))).toBe(true)
  })

  it('passes what the inline editor writes', () => {
    const doc = new DOMParser().parseFromString(BASE, 'text/html')
    const h1 = doc.querySelector('h1')!
    const slot = { element: authoredOrder(doc).get(h1)!, text: 0, value: h1.firstChild!.textContent! }
    const next = replaceTextInPage(BASE, slot, 'Edited inline')!
    expect(differsOnlyInText(BASE, next)).toBe(true)
  })

  it('fails a changed, added or removed attribute', () => {
    expect(differsOnlyInText(BASE, swap('class="hero"', 'class="villain"'))).toBe(false)
    expect(differsOnlyInText(BASE, swap('<h1 class="hero">', '<h1 class="hero" onclick="steal()">'))).toBe(false)
    expect(differsOnlyInText(BASE, swap('href="/next"', 'href="https://elsewhere.example/"'))).toBe(false)
    expect(differsOnlyInText(BASE, swap(' class="hero"', ''))).toBe(false)
  })

  it('fails an added, removed or renamed element', () => {
    expect(differsOnlyInText(BASE, swap('</h1>', '</h1><img src="/x.png">'))).toBe(false)
    expect(differsOnlyInText(BASE, swap('<b>bold</b>', 'bold'))).toBe(false)
    expect(differsOnlyInText(BASE, swap('<b>bold</b>', '<i>bold</i>'))).toBe(false)
  })

  it('fails changed code — a script, a style, a script inside a template', () => {
    expect(differsOnlyInText(BASE, swap('window.n = 1', 'window.n = 2'))).toBe(false)
    expect(differsOnlyInText(BASE, swap('h1{color:red}', 'h1{background:url(/track)}'))).toBe(false)
    expect(differsOnlyInText(BASE, swap('window.m = 1', 'window.m = 2'))).toBe(false)
  })

  it('fails a changed comment or doctype', () => {
    expect(differsOnlyInText(BASE, swap('<!-- the hero -->', '<!-- [if IE]><script src=x></script><![endif] -->'))).toBe(false)
    expect(differsOnlyInText(BASE, swap('<!doctype html>', '<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.01//EN">'))).toBe(false)
  })

  it('fails words that become markup — text cannot smuggle an element in', () => {
    expect(differsOnlyInText(BASE, swap('Hello world', 'Hello <script>steal()</script>'))).toBe(false)
  })
})
