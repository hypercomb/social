// website/trait-seat.spec.ts
import { describe, expect, it } from 'vitest'
import { hydrateSeatedParts } from '../presentation/tiles/division-render.js'
import { seatFillers } from './trait-seat.js'

const PAGE = `<!doctype html><html><head><title>Page</title></head><body>
<div id="app">
<header data-hc-trait="header" class="top">The page's own header</header>
<main><section data-hc-trait="hero"><h1>The page's own hero</h1></section></main>
<footer data-hc-trait="footer">The page's own footer</footer>
</div></body></html>`

const FILLER = '<!doctype html><html><head><title>Other</title><link rel="stylesheet" href="resource:x/sheet.css"></head><body><header class="lent">A header from another tile</header></body></html>'

const parse = (html: string): Document => new DOMParser().parseFromString(html, 'text/html')

describe('seatFillers', () => {
  it('leaves the page exactly as written when nothing fills a trait', () => {
    expect(seatFillers(PAGE, () => undefined)).toBe(PAGE)
    expect(seatFillers('<body><p>No traits here</p></body>', () => FILLER)).toBe('<body><p>No traits here</p></body>')
  })

  it('seats a filler where the page\'s own version stood, and only there', () => {
    const doc = parse(seatFillers(PAGE, word => (word === 'header' ? FILLER : undefined)))
    const holder = doc.querySelector('[data-hc-trait="header"]')!
    expect(holder.tagName).toBe('DIV')
    expect(holder.hasAttribute('data-hc-filled')).toBe(true)
    expect(doc.body.textContent).not.toContain("The page's own header")
    // The other traits keep the page's own version.
    expect(doc.querySelector('section[data-hc-trait="hero"] h1')?.textContent).toBe("The page's own hero")
    expect(doc.querySelector('footer[data-hc-trait="footer"]')?.textContent).toBe("The page's own footer")
    // In the same place in the page.
    expect(holder.parentElement?.id).toBe('app')
    expect(holder.nextElementSibling?.tagName).toBe('MAIN')
  })

  it('seats the filler in a shadow root, with the look it brought', () => {
    const doc = parse(seatFillers(PAGE, word => (word === 'header' ? FILLER : undefined)))
    const template = doc.querySelector('[data-hc-trait="header"] > template[shadowrootmode="open"]') as HTMLTemplateElement
    expect(template).not.toBeNull()
    expect(template.content.querySelector('header.lent')?.textContent).toBe('A header from another tile')
    expect(template.content.querySelector('link')?.getAttribute('href')).toBe('resource:x/sheet.css')
    // The renderer attaches what the parser left inert.
    expect(hydrateSeatedParts(doc.body)).toBe(1)
    expect(doc.querySelector('[data-hc-trait="header"]')!.shadowRoot?.querySelector('header.lent')).not.toBeNull()
  })

  it('fills every trait that has a filler', () => {
    const doc = parse(seatFillers(PAGE, () => FILLER))
    expect(doc.querySelectorAll('[data-hc-filled]')).toHaveLength(3)
  })

  it('does not fill a trait stated inside one already filled', () => {
    const nested = '<body><section data-hc-trait="outer"><div data-hc-trait="inner">own</div></section></body>'
    const doc = parse(seatFillers(nested, () => FILLER))
    expect(doc.querySelectorAll('[data-hc-filled]')).toHaveLength(1)
    expect(doc.querySelector('[data-hc-trait="inner"]')).toBeNull()
  })
})
