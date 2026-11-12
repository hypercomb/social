import { describe, expect, it } from 'vitest'
import { authoredOrder, replaceTextInPage, type TextSlot } from './site-text-edit.js'

// AN INLINE EDIT CHANGES ONE TEXT'S WORDS IN THE AUTHORED PAGE AND NOTHING
// ELSE: no markup is written, whitespace around the words is kept, and a text
// the page's script drew (no match in the authored bytes) is refused.

const PAGE = `<!doctype html>
<html><head><style>h1{color:red}</style><script>window.x = 1 < 2</script></head>
<body>
  <h1>  Hello world  </h1>
  <p>First <b>bold</b> after</p>
  <a href="/next">Next page</a>
</body></html>`

/** The slot a click on `text` inside the element matching `selector` names. */
const slotFor = (html: string, selector: string, textIndex: number): TextSlot => {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const order = authoredOrder(doc)
  const el = doc.querySelector(selector)!
  const texts = Array.from(el.childNodes).filter(n => n.nodeType === 3) as Text[]
  return { element: order.get(el)!, text: textIndex, value: texts[textIndex].data }
}

describe('replaceTextInPage', () => {
  it('replaces the words and keeps the whitespace around them', () => {
    const next = replaceTextInPage(PAGE, slotFor(PAGE, 'h1', 0), 'Welcome')!
    expect(next).toContain('<h1>  Welcome  </h1>')
    expect(next.startsWith('<!doctype html>')).toBe(true)
  })

  it('changes only the text it names — its siblings and markup stay', () => {
    const next = replaceTextInPage(PAGE, slotFor(PAGE, 'p', 1), 'then more')!
    expect(next).toContain('<p>First <b>bold</b> then more</p>')
  })

  it('writes words, never markup', () => {
    const next = replaceTextInPage(PAGE, slotFor(PAGE, 'a', 0), '<img src=x onerror=alert(1)>')!
    expect(next).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(next).not.toContain('<img')
  })

  it('leaves scripts and styles as they were authored', () => {
    const next = replaceTextInPage(PAGE, slotFor(PAGE, 'h1', 0), 'Welcome')!
    expect(next).toContain('<script>window.x = 1 < 2</script>')
    expect(next).toContain('<style>h1{color:red}</style>')
  })

  it('refuses a text the authored page does not hold there', () => {
    const slot = { ...slotFor(PAGE, 'h1', 0), value: 'drawn by a script' }
    expect(replaceTextInPage(PAGE, slot, 'Welcome')).toBeNull()
    expect(replaceTextInPage(PAGE, { element: 999, text: 0, value: 'x' }, 'Welcome')).toBeNull()
  })

  it('refuses empty words', () => {
    expect(replaceTextInPage(PAGE, slotFor(PAGE, 'h1', 0), '   ')).toBeNull()
  })
})
