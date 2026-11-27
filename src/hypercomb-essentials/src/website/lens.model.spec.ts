// website/lens.model.spec.ts
import { describe, expect, it } from 'vitest'
import { linkTargets, readPage, ruleCount, selectorClasses, unownedClasses, type LensLine } from './lens.model.js'

const PICTURE = 'a'.repeat(64)
const SHEET = 'b'.repeat(64)
const SCRIPT = 'c'.repeat(64)

const PAGE = `<!doctype html>
<html><head>
<link rel="stylesheet" href="resource:${SHEET}/sheet.css">
<style>.card{padding:1rem} .md\\:flex{display:flex} @media (min-width: 40rem){ .wide{width:100%} }</style>
</head>
<body class="page-1">
  <header data-hc-trait="header" class="card"><a href="/">Rye &amp; Salt</a></header>
  <section data-hc-trait="hero" style="background: url(x.png); color: red" class="card md:flex loose">
    <h1 onclick="go()">Bread worth the walk</h1>
    <img src="resource:${PICTURE}" alt="">
    <community-doors words="coffee"></community-doors>
  </section>
  <script src="resource:${SCRIPT}"></script>
</body></html>`

const said = (line: LensLine): string => `${'  '.repeat(line.depth)}${line.spans.map(span => span.text).join('')}`

describe('readPage', () => {
  it('says a page in the binding syntax, one way', () => {
    const read = readPage(PAGE)
    const text = read.lines.map(said).join('\n')
    expect(text).toContain('<header *trait="header" class="card">')
    expect(text).toContain('[style.background]="url(x.png)" [style.color]="red"')
    expect(text).toContain('<h1 (click)="go()">Bread worth the walk</h1>')
    expect(text).toContain(`<img [src]="resource aaaaaaaa…" alt />`)
    expect(text).toContain('<community-doors words="coffee"></community-doors>')
    expect(text).toContain(`<script [src]="resource cccccccc…"> … </script>`)
    // The head is where the look is reached from, never a line of the template.
    expect(text).not.toContain('<link')
  })

  it('reads what the page reaches: traits, sheets, inline css, classes, behaviours, pictures', () => {
    const read = readPage(PAGE)
    expect(read.traits).toEqual(['header', 'hero'])
    expect(read.sheets).toEqual([{ sig: SHEET, file: 'sheet.css' }])
    expect(read.inlineCss).toContain('.card{padding:1rem}')
    expect(read.classes).toEqual(['page-1', 'card', 'md:flex', 'loose'])
    expect(read.behaviours).toEqual(['<community-doors>', 'script cccccccc…'])
    expect(read.pictures).toBe(1)
  })

  it('says a filled trait as one line that leads to its filler, not its own version', () => {
    const read = readPage(PAGE, { filled: word => word === 'hero' })
    const hero = read.lines.findIndex(line => line.spans.some(span => span.text === ' *trait' && span.trait === 'hero'))
    expect(hero).toBeGreaterThan(-1)
    expect(said(read.lines[hero + 1])).toContain('filled by the tile "hero"')
    expect(read.lines[hero + 1].spans[0].trait).toBe('hero')
    expect(read.lines.map(said).join('\n')).not.toContain('Bread worth the walk')
  })

  it('warns a class no rule the piece carries names', () => {
    const owned = selectorClasses(readPage(PAGE).inlineCss)
    const read = readPage(PAGE, { owned: cls => owned.has(cls) })
    const warned = read.lines.flatMap(line => line.spans).filter(span => span.tone === 'warn').map(span => span.text)
    expect(warned).toEqual(['page-1', 'loose'])
  })

  it('sums up what is past the line budget', () => {
    const read = readPage(PAGE, { maxLines: 3 })
    expect(read.lines).toHaveLength(4)
    expect(said(read.lines[3])).toMatch(/^… \d+ more lines$/)
  })

  it('reads nothing from nothing', () => {
    expect(readPage('').lines).toEqual([])
  })
})

describe('linkTargets', () => {
  const at = ['bakery', 'loaves']
  const entry = ['bakery']

  it('reads a link the way the website view does, most likely tile first', () => {
    expect(linkTargets('/bakery/visit', at, entry)).toEqual([['bakery', 'visit'], ['bakery', 'bakery', 'visit']])
    expect(linkTargets('/visit', at, entry)).toEqual([['visit'], ['bakery', 'visit']])
    expect(linkTargets('rye', at, entry)).toEqual([['bakery', 'loaves', 'rye'], ['bakery', 'rye']])
    expect(linkTargets('./rye/', at, entry)).toEqual([['bakery', 'loaves', 'rye'], ['bakery', 'rye']])
    expect(linkTargets('caf%C3%A9?x=1#top', at, entry)).toEqual([['bakery', 'loaves', 'café'], ['bakery', 'café']])
  })

  it('climbs one level, never above where the site was entered', () => {
    expect(linkTargets('..', at, entry)).toEqual([['bakery']])
    expect(linkTargets('..', ['bakery'], entry)).toEqual([])
  })

  it('leads nowhere in the hive for the web, mail, resources and anchors', () => {
    for (const href of ['https://example.com', '//example.com', 'mailto:a@b.c', '#loaves', `resource:${'a'.repeat(64)}`, '/@resource/x', '']) {
      expect(linkTargets(href, at, entry)).toEqual([])
    }
  })
})

describe('what a piece\'s own styles name', () => {
  const css = `/* .ghost{} */ .card, .a > .b:hover { x: 1 } .md\\:flex{} .w-1\\/2{} @media (min-width: 1.5rem) { .wide { y: 2 } }
@keyframes rise { from { opacity: 0 } 50% { opacity: .5 } to { opacity: 1 } } [title=".quoted"] {}`

  it('names every class a selector names, unescaped, and none from comments, at-rules or keyframes', () => {
    expect([...selectorClasses(css)].sort()).toEqual(['a', 'b', 'card', 'md:flex', 'w-1/2', 'wide'])
  })

  it('counts rules, not at-rule heads or keyframe steps', () => {
    expect(ruleCount(css)).toBe(5)
  })

  it('answers the classes used that nothing carries', () => {
    expect(unownedClasses(['card', 'loose', 'wide'], css)).toEqual(['loose'])
  })
})
