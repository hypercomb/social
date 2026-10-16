// sharing/domain-links.ts
//
// THE COPY IS THE NAVIGATION (jwize, 2026-10-15). Any copy inside a website
// the hive hosts that says the NAME of a published creation becomes a link to
// that creation at its own address — and when a new domain comes online, the
// pages that already mentioned it start linking without anyone editing them.
// The list of names is not authored: it is the set of doors the publish
// results fold to (publish-results.ts), computed when the page mounts.
//
// The rule, in one place and pure, so it can be proven on a detached DOM:
//
//   - A NAME matches as a phrase, case-blind, with any run of non-letters
//     between its words: `point blank solutions`, `Point-Blank Solutions`
//     and `POINT  BLANK  SOLUTIONS` all say the creation named
//     "Point Blank Solutions". Whole words only — `card` never links inside
//     `cardigan`, nor inside `<b>card</b>igan` — except beside a script
//     written without spaces (Japanese, Chinese, Thai…), where no word edge
//     exists to find. Where two names overlap the longest wins, wherever it
//     starts: `New York Pizza` links `York Pizza` over `New York`.
//   - A match becomes an <a> at the door's address. No underline: the link
//     wears the COLOUR OF ITS DOMAIN instead, the same colour for every door
//     on that zone, derived from the zone's name so every page on every
//     host agrees without a palette to ship. A link that crosses to another
//     zone than the page's own is marked `data-cross`, so a page can say so.
//     Where two zones published the same name, the page's own zone's door
//     is the one it links.
//   - Copy that is already a link, code, a form control or editable text is
//     left alone, and so is a page's own name on its own page: a page never
//     links to itself. Running the rule twice changes nothing.

import type { PublishedDoor } from './publish-results.js'

export const DOMAIN_LINK_CLASS = 'hc-domain-link'
export const LINK_CONTROL_CLASS = 'hc-domain-link-control'

/** The colour a zone wears, everywhere: a hue from the zone's name. The
 *  lightness is found per hue, not fixed: at one lightness a yellow is a
 *  ghost on ivory paper and a blue is ink on a dark page. Each hue is set to
 *  the same mid luminance, so every zone reads on a light page (about 3.9:1
 *  at worst on ivory) and on a dark page (about 3.5:1) alike. A surface that
 *  is always light and sets small type asks for `PAPER_INK_LUMINANCE`: the
 *  same hue, inked dark enough for 4.5:1 there. */
export const domainColour = (zone: string, target: number = ZONE_LUMINANCE): string => {
  const text = String(zone ?? '').trim().toLowerCase()
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  const hue = hash % 360
  let lo = 0
  let hi = 100
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (luminance(hue, 0.62, mid / 100) < target) lo = mid + 1
    else hi = mid
  }
  return `hsl(${hue} 62% ${lo}%)`
}

/** Halfway (by contrast) between ivory paper and a near-black page. */
const ZONE_LUMINANCE = 0.15

/** Ink for light paper only: at most 0.135 keeps 4.5:1 on the plate's ivory
 *  (#ede4d1); 0.12 leaves room for the 1% lightness step. Never on a dark page. */
export const PAPER_INK_LUMINANCE = 0.12

/** WCAG relative luminance of an hsl colour. */
const luminance = (h: number, s: number, l: number): number => {
  const k = (n: number): number => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number): number => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))
  const lin = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * lin(f(0)) + 0.7152 * lin(f(8)) + 0.0722 * lin(f(4))
}

export interface LinkEntry {
  /** The door the name links to when nothing about the page says otherwise:
   *  the most recently published of those sharing the name. */
  readonly door: PublishedDoor
  readonly re: RegExp
  /** Every door sharing this name, most recent first. Two zones may publish
   *  the same name; which one a page links is the page's question (linkify). */
  readonly doors?: readonly PublishedDoor[]
}

// Marks are part of a word: a Devanagari vowel sign or a decomposed accent
// splits nothing. Names and copy are both read in NFC, as lineage keys are.
const WORD = '[\\p{L}\\p{M}\\p{N}]'
const GAP = '[^\\p{L}\\p{M}\\p{N}]+'
const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Scripts written without spaces between words. Beside a letter of these
// there is no word edge to find — `会議` sits between `の` and `は` in running
// text — so the whole-word check is dropped at that end of the name.
const NO_SPACE = /[\p{scx=Han}\p{scx=Hiragana}\p{scx=Katakana}\p{scx=Hangul}\p{scx=Thai}\p{scx=Lao}\p{scx=Khmer}\p{scx=Myanmar}]/u

/** The words of a name — what the phrase match is built from. */
export const nameWords = (name: string): string[] =>
  String(name ?? '').normalize('NFC').split(/[^\p{L}\p{M}\p{N}]+/u).filter(Boolean)

/** One regex per name: its words in order, any non-word run between them,
 *  whole words at both ends (except beside a script without spaces). Null
 *  for a name with no words at all. */
export const nameMatcher = (name: string): RegExp | null => {
  const words = nameWords(name)
  if (words.length === 0) return null
  const body = words.map(escape).join(GAP)
  const head = NO_SPACE.test(Array.from(words[0]!)[0] ?? '') ? '' : `(?<!${WORD})`
  // The tail is the name's LAST letter (past any marks): `ABC会議` ends in Han.
  const tail = NO_SPACE.test(Array.from(words[words.length - 1]!).reverse().find(c => !/\p{M}/u.test(c)) ?? '') ? '' : `(?!${WORD})`
  return new RegExp(`${head}${body}${tail}`, 'giu')
}

/** Compile the doors to matchers, one entry per distinct name, the doors
 *  sharing it kept on the entry so each page can choose among them. */
export const compileDoors = (doors: readonly PublishedDoor[]): LinkEntry[] => {
  const byName = new Map<string, { door: PublishedDoor; re: RegExp; doors: PublishedDoor[] }>()
  const ordered = [...doors].sort((a, b) => b.at - a.at)
  for (const door of ordered) {
    const fold = nameWords(door.name).join(' ').toLowerCase()
    if (!fold) continue
    const known = byName.get(fold)
    if (known) { known.doors.push(door); continue }
    const re = nameMatcher(door.name)
    if (!re) continue
    byName.set(fold, { door, re, doors: [door] })
  }
  // Longest name first: the order breaks ties between equal-length hits.
  return [...byName.values()].sort((a, b) =>
    nameWords(b.door.name).length - nameWords(a.door.name).length || b.door.name.length - a.door.name.length || b.door.at - a.door.at)
}

/** Where the rule does not reach: inside these, text stays text. The link
 *  control sits beside its anchor inside the page, so its words are skipped
 *  too — `raise` must never become a link. */
const SKIP_SELECTOR =
  'a, script, style, code, pre, kbd, samp, textarea, button, input, select, option, noscript, svg, ' +
  'title, [contenteditable], [contenteditable] *, .' + DOMAIN_LINK_CLASS + ', .' + LINK_CONTROL_CLASS

export interface LinkifyOptions {
  /** The zone the page is served on; a door elsewhere is a cross-domain link. */
  readonly pageZone?: string
  /** The page's own address — a page never links to itself. */
  readonly selfAddress?: string
}

const sameAddress = (a: string, b: string): boolean => {
  const fold = (u: string): string => u.trim().toLowerCase().replace(/\/+$/, '')
  return !!a && !!b && fold(a) === fold(b)
}

/** The door a name links to on this page. A name one of whose doors is the
 *  page itself stays text — the page's own name on its own page, whichever
 *  zone published that name last. Otherwise the door on the page's own zone,
 *  then the most recent. */
const doorFor = (entry: LinkEntry, options: LinkifyOptions): PublishedDoor | null => {
  const doors = entry.doors?.length ? entry.doors : [entry.door]
  if (options.selfAddress && doors.some(d => sameAddress(d.address, options.selfAddress ?? ''))) return null
  const zone = options.pageZone?.toLowerCase()
  return (zone && doors.find(d => d.zone.toLowerCase() === zone)) || doors[0] || null
}

type Live = { door: PublishedDoor; re: RegExp }
type Hit = { door: PublishedDoor; index: number; length: number; order: number }

/** Every name in `text`, overlaps settled longest first. `before` and
 *  `after` are the letters that adjoin this text in the same run of copy
 *  (across inline markup), so the whole-word check sees past the node. */
const hitsIn = (text: string, before: string, after: string, live: readonly Live[]): Hit[] => {
  const probe = before + text + after
  const from = before.length
  const to = from + text.length
  const all: Hit[] = []
  live.forEach(({ door, re }, order) => {
    re.lastIndex = from
    for (let m = re.exec(probe); m; m = re.exec(probe)) {
      if (m[0].length === 0) { re.lastIndex++; continue }
      if (m.index + m[0].length > to) break
      all.push({ door, index: m.index - from, length: m[0].length, order })
    }
  })
  all.sort((a, b) => b.length - a.length || a.index - b.index || a.order - b.order)
  const kept: Hit[] = []
  for (const h of all) {
    if (!kept.some(k => h.index < k.index + k.length && k.index < h.index + h.length)) kept.push(h)
  }
  return kept.sort((a, b) => a.index - b.index)
}

// Elements that join their text to the words around them. Anything else —
// a paragraph, a list item, a <br> — ends a run of copy.
const INLINE = new Set([
  'A', 'ABBR', 'B', 'BDI', 'BDO', 'CITE', 'DATA', 'DFN', 'EM', 'FONT', 'I', 'INS', 'DEL', 'MARK', 'Q',
  'S', 'SMALL', 'SPAN', 'STRONG', 'SUB', 'SUP', 'TIME', 'U', 'VAR',
])

/** The one character that adjoins `node` on one side within its run of
 *  copy, or '' at the edge of the run (or of `root`). */
const adjoining = (root: Node, node: Text, side: 'before' | 'after'): string => {
  const back = side === 'before'
  let n: Node = node
  for (;;) {
    let next = back ? n.previousSibling : n.nextSibling
    while (!next) {
      const up = n.parentNode
      if (!up || up === root || !INLINE.has((up as Element).tagName)) return ''
      n = up
      next = back ? n.previousSibling : n.nextSibling
    }
    n = next
    // Down into it, toward the side that touches us.
    for (;;) {
      if (n.nodeType === 3) {
        const data = (n as Text).data.normalize('NFC')
        if (data) return back ? (data.match(/.$/su)?.[0] ?? '') : (data.match(/^./su)?.[0] ?? '')
        break
      }
      if (n.nodeType === 8) break
      if (n.nodeType !== 1 || !INLINE.has((n as Element).tagName)) return ''
      const inner: Node | null = back ? n.lastChild : n.firstChild
      if (!inner) break
      n = inner
    }
  }
}

/** Make the anchor a match becomes. */
export const domainAnchor = (doc: Document, door: PublishedDoor, text: string, pageZone?: string): HTMLAnchorElement => {
  const a = doc.createElement('a')
  a.href = door.address
  a.textContent = text
  a.className = DOMAIN_LINK_CLASS
  a.setAttribute('data-domain', door.zone)
  a.setAttribute('data-lineage', door.lineageKey)
  const cross = !!pageZone && pageZone.toLowerCase() !== door.zone.toLowerCase()
  if (cross) a.setAttribute('data-cross', '')
  a.title = `${door.name} · ${door.zone}`
  a.style.color = domainColour(door.zone)
  a.style.textDecoration = 'none'
  return a
}

// ── the link control ──────────────────────────────────────────────────────
//
// THE WORDS ON A COLOURED NAME (jwize, 2026-10-15). Resting on a domain link
// shows the acts a reader can say about it, and each is a sentence on the
// command line said by a click: `raise <address>` brings its layer to the
// top; `recommend <address> <word>` leaves a signed word on it. The control
// is nothing but those words — an agent says the same sentences.

export interface LinkWord {
  readonly word: string
  /** The sentence takes one more word from the reader (recommend <what> <word>). */
  readonly asks?: string
}

export const LINK_WORDS: readonly LinkWord[] = [
  { word: 'raise' },
  { word: 'hold' },
  { word: 'recommend', asks: 'a word' },
]

/** Build the control for one door. `say` receives the full sentence. The
 *  control's own text is the words, so a reader learns the dialect by using it. */
export const linkControl = (
  doc: Document,
  door: PublishedDoor,
  say: (sentence: string) => void,
  words: readonly LinkWord[] = LINK_WORDS,
): HTMLElement => {
  const box = doc.createElement('span')
  box.className = LINK_CONTROL_CLASS
  box.setAttribute('role', 'group')
  box.setAttribute('aria-label', `${door.name} · ${door.zone}`)
  // The keymap hears Escape in the capture phase, before the input can stop
  // it; this says the control answers its own Escape (escape-cascade.ts).
  box.setAttribute('data-escape-local', '')
  box.style.cssText =
    'position:fixed;z-index:59990;display:inline-flex;align-items:center;gap:.35rem;' +
    'padding:.2rem .45rem;border-radius:4px;background:rgba(20,18,16,.92);color:#f4efe6;' +
    'font:500 .72rem/1.4 system-ui,sans-serif;letter-spacing:.04em;box-shadow:0 2px 10px rgba(0,0,0,.35);' +
    `border-left:3px solid ${domainColour(door.zone)}`
  const name = doc.createElement('span')
  name.textContent = door.zone
  name.style.cssText = 'opacity:.7;margin-right:.15rem'
  box.appendChild(name)
  for (const w of words) {
    const b = doc.createElement('button')
    b.type = 'button'
    b.textContent = w.word
    b.setAttribute('data-word', w.word)
    b.style.cssText =
      'all:unset;cursor:pointer;padding:.1rem .35rem;border-radius:2px;color:inherit;' +
      'text-decoration:none;font:inherit;outline-offset:2px'
    b.onmouseenter = () => { b.style.background = 'rgba(255,255,255,.12)' }
    b.onmouseleave = () => { b.style.background = '' }
    b.onclick = (e) => {
      e.preventDefault()
      e.stopPropagation()
      if (!w.asks) { say(`${w.word} ${door.address}`); return }
      // The sentence wants one more word: ask for it in place, Enter says it.
      const input = doc.createElement('input')
      input.type = 'text'
      input.placeholder = w.asks
      input.setAttribute('aria-label', `${w.word} ${door.name}: ${w.asks}`)
      input.style.cssText =
        'all:unset;min-width:6rem;padding:.1rem .35rem;border-radius:2px;background:rgba(255,255,255,.1);' +
        'color:inherit;font:inherit'
      input.onkeydown = (k) => {
        // An Enter that confirms an IME conversion is not the reader's Enter.
        if (k.isComposing || k.keyCode === 229) return
        // The word's own keys end here: nothing behind the control hears them.
        if (k.key === 'Enter' || k.key === 'Escape') k.stopPropagation()
        if (k.key === 'Enter') {
          const word = input.value.trim().split(/\s+/)[0] ?? ''
          if (word) say(`${w.word} ${door.address} ${word}`)
          input.replaceWith(b)
        } else if (k.key === 'Escape') {
          input.replaceWith(b)
        }
      }
      b.replaceWith(input)
      input.focus()
    }
    box.appendChild(b)
  }
  return box
}

/** Turn every name in `root`'s copy into a link. Returns how many were made.
 *  Idempotent: links it made are skipped the next time. */
export const linkify = (root: ParentNode, entries: readonly LinkEntry[], options: LinkifyOptions = {}): number => {
  if (entries.length === 0) return 0
  const live: Live[] = []
  for (const entry of entries) {
    const door = doorFor(entry, options)
    if (door) live.push({ door, re: entry.re })
  }
  if (live.length === 0) return 0
  const doc = (root as Node).ownerDocument ?? (root as Document)
  const walker = doc.createTreeWalker(root as Node, NodeFilter.SHOW_TEXT)
  const texts: Text[] = []
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const node = n as Text
    if (!node.data.trim()) continue
    if (node.parentElement?.closest(SKIP_SELECTOR)) continue
    texts.push(node)
  }
  let made = 0
  for (const node of texts) {
    // Read in NFC, as the names are: a decomposed accent is the same letter.
    const text = node.data.normalize('NFC')
    const hits = hitsIn(text, adjoining(root as Node, node, 'before'), adjoining(root as Node, node, 'after'), live)
    if (hits.length === 0) continue
    const frag = doc.createDocumentFragment()
    let at = 0
    for (const hit of hits) {
      if (hit.index > at) frag.appendChild(doc.createTextNode(text.slice(at, hit.index)))
      frag.appendChild(domainAnchor(doc, hit.door, text.slice(hit.index, hit.index + hit.length), options.pageZone))
      made++
      at = hit.index + hit.length
    }
    if (at < text.length) frag.appendChild(doc.createTextNode(text.slice(at)))
    node.parentNode?.replaceChild(frag, node)
  }
  return made
}
