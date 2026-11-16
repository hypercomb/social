// website/page-cut.spec.ts
import { describe, expect, it } from 'vitest'
import { TRAIT_ATTR, cutPage, inlineCssOf, partDocument, withSharedStyle } from './page-cut.js'

const PICTURE = 'a'.repeat(64)

// A page nobody here wrote for the cutter: a bakery's single file, with the
// wrappers, inline CSS and script a hand-made page usually has.
const BAKERY = `<!doctype html>
<html lang="en" class="no-js">
<head>
<meta charset="utf-8">
<title>Rye &amp; Salt</title>
<meta name="description" content="A small bakery">
<link rel="stylesheet" href="resource:${'b'.repeat(64)}/reset.css">
<style>:root{--ink:#221} body{margin:0;color:var(--ink)} #app main > section{padding:2rem}</style>
</head>
<body class="warm">
<div id="app">
  <header><a href="/">Rye &amp; Salt</a></header>
  <nav aria-label="Main"><a href="#bread">Bread</a></nav>
  <main class="stack">
    <section><h1>Bread worth the walk</h1><img src="resource:${PICTURE}" alt=""></section>
    <section id="bread"><h2>This week's loaves</h2><p>Rye, spelt, seeded.</p></section>
    <section><h2>This week's loaves</h2><p>A second list under the same heading.</p></section>
    <section><p>No heading here at all.</p></section>
  </main>
  <div class="toasts"></div>
  <footer><p>Open Thursday to Sunday</p></footer>
</div>
<script>document.documentElement.classList.remove('no-js')</script>
</body>
</html>`

describe('cutPage', () => {
  const cut = cutPage(BAKERY)!

  it('cuts at the landmarks, in the order the page shows them', () => {
    expect(cut.parts.map(p => p.role)).toEqual(['header', 'nav', 'section', 'section', 'section', 'section', 'footer'])
  })

  it('names a part by what it calls itself, and never twice the same', () => {
    expect(cut.parts.map(p => p.name)).toEqual([
      'header', 'nav', 'bread-worth-the-walk', 'bread', 'this-weeks-loaves', 'section', 'footer',
    ])
    expect(new Set(cut.parts.map(p => p.name)).size).toBe(cut.parts.length)
  })

  it('gives a second part of the same name a number', () => {
    const twice = cutPage('<body><section><h2>News</h2></section><section><h2>News</h2></section></body>')!
    expect(twice.parts.map(p => p.name)).toEqual(['news', 'news-2'])
  })

  it('keeps each part\'s markup as the page wrote it', () => {
    expect(cut.parts[3].html).toBe('<section id="bread"><h2>This week\'s loaves</h2><p>Rye, spelt, seeded.</p></section>')
  })

  it('remembers the wrappers a part sat in', () => {
    expect(cut.parts[0].open).toEqual(['<div id="app">'])
    expect(cut.parts[2].open).toEqual(['<div id="app">', '<main class="stack">'])
    expect(cut.parts[2].close).toEqual(['</main>', '</div>'])
  })

  it('finds the picture a part shows that the hive already holds', () => {
    expect(cut.parts[2].picture).toBe(PICTURE)
    expect(cut.parts[3].picture).toBeNull()
  })

  it('reads the page\'s look and what it says of itself', () => {
    expect(cut.title).toBe('Rye & Salt')
    expect(cut.description).toBe('A small bakery')
    expect(cut.css).toContain('--ink:#221')
    expect(cut.links).toHaveLength(1)
    expect(cut.rootClass).toBe('no-js warm')
    expect(cut.bodyOpen).toBe('<body class="warm">')
  })

  it('marks each part as the trait it is, and changes nothing else', () => {
    const marked = new DOMParser().parseFromString(cut.marked, 'text/html')
    const stated = Array.from(marked.querySelectorAll(`[${TRAIT_ATTR}]`)).map(el => el.getAttribute(TRAIT_ATTR))
    expect(stated).toEqual(cut.parts.map(p => p.name))
    expect(cut.unmarked).toBe(7)
    // The page keeps its own version of every trait: it is never emptied.
    expect(cut.marked).toContain('Bread worth the walk')
    expect(cut.marked).toContain('<div class="toasts"></div>')
    expect(cut.marked).toContain('classList.remove')
    marked.querySelectorAll(`[${TRAIT_ATTR}]`).forEach(el => el.removeAttribute(TRAIT_ATTR))
    const original = new DOMParser().parseFromString(BAKERY, 'text/html')
    expect(marked.body.innerHTML).toBe(original.body.innerHTML)
  })

  it('gives a filler no trait of its own', () => {
    expect(cutPage(cut.marked)!.parts.every(p => !p.html.includes(TRAIT_ATTR))).toBe(true)
  })

  it('cuts a marked page into the same traits, with nothing left to mark', () => {
    const again = cutPage(cut.marked)!
    expect(again.parts.map(p => p.name)).toEqual(cut.parts.map(p => p.name))
    expect(again.unmarked).toBe(0)
    expect(again.marked).toBe(cut.marked)
  })

  it('keeps a trait the page already states when its heading is reworded', () => {
    const reworded = cutPage(cut.marked.replace('<h1>Bread worth the walk</h1>', '<h1>Loaves for the early</h1>'))!
    expect(reworded.parts[2].name).toBe('bread-worth-the-walk')
    expect(reworded.parts[2].title).toBe('Loaves for the early')
    expect(reworded.unmarked).toBe(0)
  })

  it('names a part by its kind when its own word cannot be a trait', () => {
    const refused = cutPage(BAKERY, word => word === 'bread')!
    expect(refused.parts.map(p => p.name)).toEqual([
      'header', 'nav', 'bread-worth-the-walk', 'section', 'this-weeks-loaves', 'section-2', 'footer',
    ])
  })

  it('does not cut a page that does not divide', () => {
    expect(cutPage('<body><div><p>One thing.</p></div></body>')).toBeNull()
    expect(cutPage('<body><main><section><h1>Only one</h1></section></main></body>')).toBeNull()
    expect(cutPage('')).toBeNull()
  })

  it('cuts body-level blocks when the page has no wrapper and no main', () => {
    const plain = cutPage('<body><header>Top</header><div><h2>About us</h2></div><footer>End</footer></body>')!
    expect(plain.parts.map(p => p.name)).toEqual(['header', 'about-us', 'footer'])
    expect(plain.parts[0].open).toEqual([])
  })
})

describe('partDocument', () => {
  const cut = cutPage(BAKERY)!

  it('stands alone: the part, the wrappers it was written against, the shared look', () => {
    const doc = partDocument(cut, cut.parts[3], { head: '<link rel="stylesheet" href="resource:x/sheet.css">', scope: 'page-abc' })
    const parsed = new DOMParser().parseFromString(doc, 'text/html')
    expect(parsed.title).toBe('This week\'s loaves')
    expect(parsed.documentElement.getAttribute('lang')).toBe('en')
    expect(parsed.body.className).toBe('warm')
    // The rule `#app main > section` still finds it, under the scope.
    expect(parsed.querySelector('.page-abc.warm > #app > main.stack > section#bread')).not.toBeNull()
    expect(parsed.querySelectorAll('section')).toHaveLength(1)
    expect(parsed.querySelector('header')).toBeNull()
    expect(parsed.querySelector('style')).toBeNull()
    expect(parsed.querySelector('script')).toBeNull()
    expect(parsed.querySelector('link')?.getAttribute('href')).toBe('resource:x/sheet.css')
  })

  it('adds no wrapper when nothing was confined', () => {
    const doc = partDocument(cut, cut.parts[0], { head: '' })
    const parsed = new DOMParser().parseFromString(doc, 'text/html')
    expect(parsed.body.firstElementChild?.id).toBe('app')
  })
})

describe('withSharedStyle', () => {
  it('takes the inline CSS out, links the shared look and wraps the body in its class', () => {
    expect(inlineCssOf(BAKERY)).toContain('--ink:#221')
    const out = withSharedStyle(BAKERY, '<link rel="stylesheet" href="resource:x/theme.css">', 'page-abc')
    const parsed = new DOMParser().parseFromString(out, 'text/html')
    expect(parsed.querySelector('style')).toBeNull()
    expect(parsed.querySelectorAll('link')).toHaveLength(2)
    const wrap = parsed.body.firstElementChild!
    expect(wrap.className).toBe('page-abc no-js warm')
    expect(wrap.querySelector('#app footer')).not.toBeNull()
    expect(parsed.body.children).toHaveLength(1)
  })

  it('still cuts into the same parts afterwards, each carrying the wrapper', () => {
    const lifted = cutPage(withSharedStyle(BAKERY, '<link rel="stylesheet" href="resource:x/sheet.css">', 'page-abc'))!
    expect(lifted.parts.map(p => p.name)).toEqual(cutPage(BAKERY)!.parts.map(p => p.name))
    expect(lifted.css).toBe('')
    expect(lifted.parts[0].open[0]).toContain('page-abc')
  })
})
