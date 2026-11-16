// website/page-cut.ts
//
// ONE HTML FILE, CUT AT ITS LANDMARKS.
//
// A page somebody made elsewhere arrives as one document. This reads where it
// already divides (its header, its navigation, each section of its main
// content, its footer) and hands back three things:
//
//   parts   each landmark as markup that can stand alone, with a name
//   marked  the same document, unchanged but for one attribute on each
//           landmark saying which TRAIT it is (documentation/traits.md)
//   style   the page's own inline CSS and its linked sheets, so a part can
//           carry the look with it
//
// THE NAME IS A TRAIT WORD. A trait is the placeholder: `header`, `hero`,
// `footer` name a kind of part, an interface, and say nothing about which tile
// fills it. The markup the page already holds there is the page's OWN version
// of that trait; a tile named the word is an implementation that replaces it.
// So the page is never emptied: with no filler it draws exactly as it did.
//
// Nothing is invented. A page that does not divide (fewer than two parts) cuts
// to null, and the caller says so instead of making one tile called "section".
//
// WHY THE ANCESTORS TRAVEL WITH A PART. A section usually sits inside wrappers
// (`<div id="root"><main class="flex flex-col">`), and the page's rules select
// through them. A part lifted out bare loses every rule that named a wrapper.
// So a part remembers the open tags between <body> and itself, and its own
// document reopens them, empty of every sibling.
//
// SCRIPTS STAY WITH THE WHOLE. A part is markup and style. What the page ran
// is still in the page.
//
// Pure: a string in, plain data out. It parses with the platform's DOMParser
// and touches no store, no registry and no live document.
//
// Generalised from the Café Society cut (scripts/bridge/_cafe-society/build.cjs),
// where the part names and the wrappers were written by hand for one site.

import { normalizeCell } from '@hypercomb/core'

/** The attribute a page states a trait with: the element that wears it is the
 *  page's own version of the trait its value names. */
export const TRAIT_ATTR = 'data-hc-trait'

export type PartRole = 'header' | 'nav' | 'section' | 'aside' | 'footer'

export interface PagePart {
  /** The trait word, which is also the name of a tile that fills it: the role
   *  for a header, navigation or footer; for a section, what it calls itself
   *  (the trait it already states, its id, its label, its first heading). */
  readonly name: string
  readonly role: PartRole
  /** What a person would call it. */
  readonly title: string
  /** The part's own markup, as the page wrote it (without the trait attribute:
   *  a filler is an implementation, it states no trait of its own). */
  readonly html: string
  /** Open tags of the wrappers between <body> and the part, outermost first. */
  readonly open: readonly string[]
  /** Their closing tags, innermost first. */
  readonly close: readonly string[]
  /** The first picture the part shows that the hive already holds, by
   *  signature; null when it shows none. */
  readonly picture: string | null
}

export interface PageCut {
  readonly title: string
  readonly description: string
  /** `<html …>` and `<body …>` as the page opened them. */
  readonly htmlOpen: string
  readonly bodyOpen: string
  /** Classes and theme the page put on its root, for a wrapper that stands in
   *  for the root where there is none (a seated part has no <body>). */
  readonly rootClass: string
  readonly rootTheme: string
  /** Every inline stylesheet outside the parts, joined in document order. */
  readonly css: string
  /** Every `<link rel="stylesheet">`, as written. */
  readonly links: readonly string[]
  readonly parts: readonly PagePart[]
  /** The page with each part stating its trait. Nothing else differs. */
  readonly marked: string
  /** How many parts the page did not yet state as that trait; 0 when the page
   *  already is its marked form. */
  readonly unmarked: number
}

const SKIP = new Set(['SCRIPT', 'STYLE', 'LINK', 'TEMPLATE', 'NOSCRIPT', 'META', 'TITLE', 'BASE'])
const LANDMARK = new Set(['HEADER', 'NAV', 'FOOTER', 'ASIDE', 'SECTION', 'ARTICLE', 'MAIN'])
const SHOWS = 'img,svg,picture,video,canvas,iframe,form,input,button'
const SIGNATURE_REF = /resource:([0-9a-f]{64})/

const content = (el: Element): Element[] =>
  Array.from(el.children).filter(child => !SKIP.has(child.tagName))

/** Walk down through wrappers that hold exactly one thing, to the element
 *  whose children are the page's blocks. */
function stackOf(from: Element): Element {
  let at = from
  for (;;) {
    const kids = content(at)
    if (kids.length !== 1 || LANDMARK.has(kids[0].tagName)) return at
    at = kids[0]
  }
}

/** Something a reader would see: words, or a thing that draws. */
const visible = (el: Element): boolean =>
  (el.textContent ?? '').trim().length > 0 || el.matches(SHOWS) || el.querySelector(SHOWS) !== null

function roleOf(el: Element): PartRole {
  const said = (el.getAttribute('role') ?? '').toLowerCase()
  if (said === 'banner') return 'header'
  if (said === 'navigation') return 'nav'
  if (said === 'contentinfo') return 'footer'
  if (said === 'complementary') return 'aside'
  switch (el.tagName) {
    case 'HEADER': return 'header'
    case 'NAV': return 'nav'
    case 'FOOTER': return 'footer'
    case 'ASIDE': return 'aside'
    default: return 'section'
  }
}

const words = (text: string): string => text.replace(/\s+/g, ' ').trim()

/** A section's own word for itself, most deliberate first. */
function saidName(el: Element): { name: string; title: string } {
  const heading = words(el.querySelector('h1,h2,h3')?.textContent ?? '')
  const label = words(el.getAttribute('aria-label') ?? '')
  const id = words(el.getAttribute('id') ?? '')
  for (const candidate of [id, label, heading]) {
    // A name is a few words, never a sentence.
    const name = normalizeCell(candidate.split(' ').slice(0, 5).join(' ')).slice(0, 40).replace(/-$/, '')
    if (name) return { name, title: heading || label || candidate }
  }
  return { name: '', title: heading || label }
}

const ROLE_TITLE: Record<PartRole, string> = {
  header: 'Header', nav: 'Navigation', footer: 'Footer', aside: 'Aside', section: 'Section',
}

/** `<div class="x">` from an element, without its children. */
function openTag(el: Element): string {
  const shallow = el.cloneNode(false) as Element
  const html = shallow.outerHTML
  const close = `</${el.tagName.toLowerCase()}>`
  return html.endsWith(close) ? html.slice(0, -close.length) : html
}

function pictureOf(el: Element): string | null {
  for (const img of Array.from(el.querySelectorAll('img'))) {
    const sig = SIGNATURE_REF.exec(img.getAttribute('src') ?? '')?.[1]
    if (sig) return sig
  }
  return null
}

/**
 * Cut a page at its landmarks, or null when it does not divide. `refuse` says
 * a word cannot be a trait here (one the hive keeps for itself); a part that
 * would have taken it is named by its kind instead.
 */
export function cutPage(html: string, refuse: (word: string) => boolean = () => false): PageCut | null {
  const source = String(html ?? '')
  if (!source.trim() || typeof DOMParser === 'undefined') return null
  const doc = new DOMParser().parseFromString(source, 'text/html')
  const body = doc.body
  if (!body) return null

  // The blocks, in document order. <main> is a wrapper around the sections a
  // reader means, so it opens into them when it holds more than one.
  const blocks: Element[] = []
  for (const child of content(stackOf(body))) {
    if (child.tagName === 'MAIN') {
      const inner = content(stackOf(child)).filter(visible)
      if (inner.length >= 2) { blocks.push(...inner); continue }
    }
    if (visible(child)) blocks.push(child)
  }
  if (blocks.length < 2) return null

  const taken = new Map<string, number>()
  const unique = (base: string): string => {
    const count = (taken.get(base) ?? 0) + 1
    taken.set(base, count)
    return count === 1 ? base : `${base}-${count}`
  }

  let unmarked = 0
  const parts: PagePart[] = blocks.map(el => {
    const role = roleOf(el)
    // A trait the page already states is kept: saying `parts` again after a
    // heading was reworded must not rename the trait under its filler.
    const stated = normalizeCell(el.getAttribute(TRAIT_ATTR) ?? '')
    const said = stated
      ? { name: stated, title: role === 'section' ? saidName(el).title : ROLE_TITLE[role] }
      : role === 'section' ? saidName(el) : { name: role, title: ROLE_TITLE[role] }
    const name = unique(said.name && !refuse(said.name) ? said.name : 'section')
    if (el.getAttribute(TRAIT_ATTR) !== name) unmarked++
    const open: string[] = []
    const close: string[] = []
    for (let up = el.parentElement; up && up !== body; up = up.parentElement) {
      open.unshift(openTag(up))
      close.push(`</${up.tagName.toLowerCase()}>`)
    }
    const own = el.cloneNode(true) as Element
    own.removeAttribute(TRAIT_ATTR)
    return { name, role, title: said.title || ROLE_TITLE[role], html: own.outerHTML, open, close, picture: pictureOf(el) }
  })

  // Read the look before the parts leave: a sheet written inside a part goes
  // with that part and is not the page's to share.
  const inPart = (node: Element): boolean => blocks.some(block => block.contains(node))
  const css = Array.from(doc.querySelectorAll('style'))
    .filter(style => !inPart(style))
    .map(style => style.textContent ?? '')
    .filter(text => text.trim())
    .join('\n')
  const links = Array.from(doc.querySelectorAll('link[rel~="stylesheet"]'))
    .filter(link => !inPart(link))
    .map(link => link.outerHTML)

  const root = doc.documentElement
  const rootClass = words(`${root.getAttribute('class') ?? ''} ${body.getAttribute('class') ?? ''}`)
  const rootTheme = root.getAttribute('data-theme') ?? body.getAttribute('data-theme') ?? ''
  const htmlOpen = openTag(root)
  const bodyOpen = openTag(body)
  const title = words(doc.title ?? '')
  const description = doc.querySelector('meta[name="description"]')?.getAttribute('content') ?? ''

  // The marks last: it is the one step that changes the document.
  blocks.forEach((el, index) => el.setAttribute(TRAIT_ATTR, parts[index].name))
  // No trailing newline: it would land inside <body> on the next read, and a
  // marked page must cut to itself.
  const marked = `<!doctype html>\n${root.outerHTML}`

  return { title, description, htmlOpen, bodyOpen, rootClass, rootTheme, css, links, parts, marked, unmarked }
}

/** Every inline stylesheet a page carries, joined in document order. */
export function inlineCssOf(html: string): string {
  if (typeof DOMParser === 'undefined') return ''
  const doc = new DOMParser().parseFromString(String(html ?? ''), 'text/html')
  return Array.from(doc.querySelectorAll('style'))
    .map(style => style.textContent ?? '')
    .filter(text => text.trim())
    .join('\n')
}

/**
 * The same page, reaching its look by signature instead of carrying it: its
 * inline stylesheets are taken out, `head` (links to the shared atoms) is put
 * in their place, and everything the body held is wrapped in the class those
 * atoms are confined to. Sheets the page already linked stay where they were.
 */
export function withSharedStyle(html: string, head: string, scope: string): string {
  const doc = new DOMParser().parseFromString(String(html ?? ''), 'text/html')
  const root = doc.documentElement
  const body = doc.body
  const rootClass = words(`${root.getAttribute('class') ?? ''} ${body.getAttribute('class') ?? ''}`)
  const rootTheme = root.getAttribute('data-theme') ?? body.getAttribute('data-theme') ?? ''
  for (const style of Array.from(doc.querySelectorAll('style'))) style.remove()
  doc.head.insertAdjacentHTML('beforeend', head)

  const wrap = doc.createElement('div')
  wrap.setAttribute('class', words(`${scope} ${rootClass}`))
  if (rootTheme) wrap.setAttribute('data-theme', rootTheme)
  // The wrapper stands in for the root, and a root is at least a screen tall.
  wrap.setAttribute('style', 'min-height:100vh')
  while (body.firstChild) wrap.appendChild(body.firstChild)
  body.appendChild(wrap)
  return `<!doctype html>\n${root.outerHTML}\n`
}

const escape = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')

/** How a part reaches the page's look. */
export interface PartStyle {
  /** What goes in the part's <head>: links to shared sheets, in order. */
  readonly head: string
  /** The class the shared sheets are confined to; absent when the page had no
   *  inline CSS of its own and nothing was confined. */
  readonly scope?: string
}

/** The scope wrapper: it stands in for the page's root, so it wears what the
 *  root wore. */
export function scopeOpen(cut: Pick<PageCut, 'rootClass' | 'rootTheme'>, scope: string, extra = ''): string {
  const theme = cut.rootTheme ? ` data-theme="${escape(cut.rootTheme)}"` : ''
  return `<div class="${escape(words(`${scope} ${cut.rootClass}`))}"${theme}${extra}>`
}

/**
 * A part as a document of its own: it opens anywhere and looks like itself.
 * It carries no copy of the page's CSS. It links the sheets the page shares
 * and reopens the wrappers the rules were written against.
 */
export function partDocument(cut: PageCut, part: PagePart, style: PartStyle): string {
  const wrapOpen = style.scope ? scopeOpen(cut, style.scope) : ''
  const wrapClose = style.scope ? '</div>' : ''
  return `<!doctype html>
${cut.htmlOpen}
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(part.title)}</title>
${style.head}
</head>
${cut.bodyOpen}
${wrapOpen}${part.open.join('')}
${part.html}
${part.close.join('')}${wrapClose}
</body>
</html>
`
}
