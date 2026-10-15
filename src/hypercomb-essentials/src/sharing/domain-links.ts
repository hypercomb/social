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
//     `cardigan`. The longest name wins where two overlap.
//   - A match becomes an <a> at the door's address. No underline: the link
//     wears the COLOUR OF ITS DOMAIN instead, the same colour for every door
//     on that zone, derived from the zone's name so every page on every
//     host agrees without a palette to ship. A link that crosses to another
//     zone than the page's own is marked `data-cross`, so a page can say so.
//   - Copy that is already a link, code, a form control or editable text is
//     left alone, and so is a page's own name on its own page: a page never
//     links to itself. Running the rule twice changes nothing.

import type { PublishedDoor } from './publish-results.js'

export const DOMAIN_LINK_CLASS = 'hc-domain-link'

/** The colour a zone wears, everywhere: a hue from the zone's name. Mid
 *  lightness and firm saturation so it reads on a light page and a dark one. */
export const domainColour = (zone: string): string => {
  const text = String(zone ?? '').trim().toLowerCase()
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  const hue = hash % 360
  return `hsl(${hue} 62% 46%)`
}

export interface LinkEntry {
  readonly door: PublishedDoor
  readonly re: RegExp
}

const WORD = '[\\p{L}\\p{N}]'
const GAP = '[^\\p{L}\\p{N}]+'
const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The words of a name — what the phrase match is built from. */
export const nameWords = (name: string): string[] =>
  String(name ?? '').split(/[^\p{L}\p{N}]+/u).filter(Boolean)

/** One regex per name: its words in order, any non-word run between them,
 *  whole words at both ends. Null for a name with no words at all. */
export const nameMatcher = (name: string): RegExp | null => {
  const words = nameWords(name)
  if (words.length === 0) return null
  const body = words.map(escape).join(GAP)
  return new RegExp(`(?<!${WORD})${body}(?!${WORD})`, 'giu')
}

/** Compile the doors to matchers, longest name first (so the longer of two
 *  overlapping names wins) and one entry per distinct name. */
export const compileDoors = (doors: readonly PublishedDoor[]): LinkEntry[] => {
  const seen = new Set<string>()
  const entries: LinkEntry[] = []
  const ordered = [...doors].sort((a, b) =>
    nameWords(b.name).length - nameWords(a.name).length || b.name.length - a.name.length || b.at - a.at)
  for (const door of ordered) {
    const fold = nameWords(door.name).join(' ').toLowerCase()
    if (!fold || seen.has(fold)) continue
    const re = nameMatcher(door.name)
    if (!re) continue
    seen.add(fold)
    entries.push({ door, re })
  }
  return entries
}

/** Where the rule does not reach: inside these, text stays text. */
const SKIP_SELECTOR =
  'a, script, style, code, pre, kbd, samp, textarea, button, input, select, option, noscript, svg, ' +
  'title, [contenteditable], [contenteditable] *, .' + DOMAIN_LINK_CLASS

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

type Hit = { entry: LinkEntry; index: number; length: number }

const earliest = (text: string, entries: readonly LinkEntry[]): Hit | null => {
  let best: Hit | null = null
  for (const entry of entries) {
    entry.re.lastIndex = 0
    const m = entry.re.exec(text)
    if (!m || m[0].length === 0) continue
    if (!best || m.index < best.index || (m.index === best.index && m[0].length > best.length)) {
      best = { entry, index: m.index, length: m[0].length }
    }
  }
  return best
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

export const LINK_CONTROL_CLASS = 'hc-domain-link-control'

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
  const live = options.selfAddress
    ? entries.filter(e => !sameAddress(e.door.address, options.selfAddress ?? ''))
    : entries
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
    let rest = node.data
    let hit = earliest(rest, live)
    if (!hit) continue
    const frag = doc.createDocumentFragment()
    while (hit) {
      if (hit.index > 0) frag.appendChild(doc.createTextNode(rest.slice(0, hit.index)))
      frag.appendChild(domainAnchor(doc, hit.entry.door, rest.slice(hit.index, hit.index + hit.length), options.pageZone))
      made++
      rest = rest.slice(hit.index + hit.length)
      hit = rest ? earliest(rest, live) : null
    }
    if (rest) frag.appendChild(doc.createTextNode(rest))
    node.parentNode?.replaceChild(frag, node)
  }
  return made
}
