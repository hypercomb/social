// diamondcoreprocessor.com/presentation/tiles/tile-brief-panel.ts
//
// THE REVERSE OF THE CARD — a tile's brief, set as paper.
//
// A hexagon has no back, so the band crowds its affordances around the rim.
// A square plate DOES have a back: it is a card, and the back of a card is
// where the writing goes. So the square tile view's answer to the hover band
// is a DOG-EAR — a turned gold corner on the plate — and turning it opens the
// card: the tile's lists, its notes, the behaviours it carries, the
// pheromones on it, and the same affordance set the band would offer.
//
// One renderer, two scales:
//   • `spread` — opened inside the grid, the plate's own row widened to a
//     two-page spread. The page never leaves; the siblings make room.
//   • `page`   — the whole sheet, for a tile you are standing IN. A leaf is
//     not an empty page: it is this, at full size.
//
// Presentation only — every value arrives on the brief (tile-brief.ts) and
// every door arrives as a callback. Nothing here reads the hive.

import type { Note } from '../../notes/note-tree.js'
import { noteDisplayText, noteKindOf } from '../../notes/note-classify.js'
import { briefText, type BriefAffordance, type BriefBehavior, type TileBrief } from './tile-brief.js'

/** How deep the outline draws before it stops indenting. Deeper notes still
 *  render — they just stop stepping right, so a runaway tree cannot walk the
 *  column off the paper. */
const MAX_OUTLINE_DEPTH = 4

/** A neighbour on the same row, for the page-scale filmstrip. */
export type BriefSibling = {
  label: string
  title: string
  imageUrl: string | null
  /** The tile the page is about — drawn held, and not a way out. */
  current: boolean
}

export type BriefPanelOptions = {
  scale: 'spread' | 'page'
  /** The tile's picture, at page scale. */
  imageUrl?: string | null
  /** The row this tile sits on — page scale only. Empty hides the strip. */
  siblings?: readonly BriefSibling[]
  /** Turn the dog-ear back down (spread scale) or leave the page. */
  onClose?: () => void
  /** Step into the tile — offered when something is behind it. */
  onEnter?: () => void
  /** Walk to a neighbour on the row. */
  onSibling?: (label: string) => void
  /** Open the annotations window on this tile. Offered only where the tile
   *  can be addressed by label from where the participant stands. */
  onWrite?: () => void
  /** Write a note ON THIS TILE, at its own address — the desk principle, so a
   *  page writes where it reads and never has to move you to be useful. */
  onWriteInline?: (text: string) => void
  /** Open the Beehaviors panel on this tile. */
  onBehaviors?: () => void
  /** Open one carried behaviour. */
  onBehavior?: (behavior: BriefBehavior) => void
}

const element = <K extends keyof HTMLElementTagNameMap>(
  tag: K, className: string, text?: string,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

/** A Material Symbols ligature. The shell loads the face; where it has not,
 *  the ligature's own letters are hidden rather than shown as a word. */
const glyph = (name: string, className = 'tb-glyph'): HTMLElement => {
  const span = element('span', className, name)
  span.setAttribute('aria-hidden', 'true')
  return span
}

const heading = (key: string, fallback: string): HTMLElement =>
  element('h3', 'tb-section-title', briefText(key, fallback))

export function buildTileBriefPanel(brief: TileBrief, options: BriefPanelOptions): HTMLElement {
  const page = options.scale === 'page'
  const root = element('article', 'tb-brief')
  root.setAttribute('data-scale', options.scale)
  root.setAttribute('role', 'region')
  root.setAttribute('aria-label', brief.title || brief.label)

  root.appendChild(briefHead(brief, options, page))

  const body = element('div', 'tb-body')
  if (page && options.imageUrl) {
    const plate = element('div', 'tb-portrait')
    const mat = element('span', 'tb-portrait-mat')
    const art = document.createElement('img')
    art.className = 'tb-portrait-art'
    art.src = options.imageUrl
    art.alt = ''
    art.draggable = false
    mat.appendChild(art)
    plate.appendChild(mat)
    body.appendChild(plate)
  }

  const writing = element('section', 'tb-writing')
  if (brief.lists.length) writing.appendChild(listsSection(brief.lists))
  if (brief.notes.length) writing.appendChild(notesSection(brief.notes))
  if (!brief.lists.length && !brief.notes.length) writing.appendChild(emptyWriting(options))
  const composer = inlineComposer(options)
  if (composer) writing.appendChild(composer)
  body.appendChild(writing)

  const side = element('aside', 'tb-side')
  side.appendChild(behaviorsSection(brief, options))
  if (brief.tags.length) side.appendChild(tagsSection(brief.tags))
  body.appendChild(side)

  root.appendChild(body)

  const rail = affordanceRail(brief, options)
  if (rail) root.appendChild(rail)

  if (page && options.siblings?.length) root.appendChild(siblingStrip(options))

  return root
}

// ── The head ─────────────────────────────────────────────────────────

function briefHead(brief: TileBrief, options: BriefPanelOptions, page: boolean): HTMLElement {
  const head = element('header', 'tb-head')
  const name = element('h2', 'tb-name', brief.title || brief.label)
  head.appendChild(name)
  head.appendChild(element('div', 'tb-rule'))

  const facts: string[] = []
  if (brief.childCount > 0) {
    facts.push(briefText(
      brief.childCount === 1 ? 'square-tile.brief.behind.one' : 'square-tile.brief.behind.other',
      brief.childCount === 1 ? '1 tile behind' : `${brief.childCount} tiles behind`,
    ).replace('{count}', String(brief.childCount)))
  } else {
    facts.push(briefText('square-tile.brief.leaf', 'the end of this branch'))
  }
  if (brief.opensAs) {
    const opener = brief.behaviors.find(behavior => behavior.opensAs)
    facts.push(briefText('square-tile.brief.opensAs', 'opens as {view}')
      .replace('{view}', opener?.label || brief.opensAs))
  }
  head.appendChild(element('p', 'tb-facts', facts.join(' · ')))

  if (brief.childCount > 0 && options.onEnter) {
    const enter = element('button', 'tb-enter', briefText('square-tile.brief.enter', 'step inside'))
    enter.type = 'button'
    enter.onclick = () => options.onEnter?.()
    head.appendChild(enter)
  }

  if (!page && options.onClose) {
    const fold = element('button', 'tb-unfold')
    fold.type = 'button'
    fold.setAttribute('aria-label', briefText('square-tile.brief.close', 'turn the corner back'))
    fold.title = briefText('square-tile.brief.close', 'turn the corner back')
    fold.onclick = () => options.onClose?.()
    head.appendChild(fold)
  }
  return head
}

// ── The writing ──────────────────────────────────────────────────────

/** The structure: an outline, marks kept, nesting drawn with a hairline. */
function listsSection(lists: readonly Note[]): HTMLElement {
  const section = element('section', 'tb-lists')
  section.appendChild(heading('annotations.tab.lists', 'lists'))
  section.appendChild(outline(lists, 0))
  return section
}

function outline(notes: readonly Note[], depth: number): HTMLElement {
  const list = element('ul', 'tb-outline')
  list.style.setProperty('--depth', String(Math.min(depth, MAX_OUTLINE_DEPTH)))
  for (const note of notes) {
    const row = element('li', 'tb-point')
    row.appendChild(note.mark ? glyph(note.mark, 'tb-glyph tb-mark') : element('span', 'tb-bullet'))
    row.appendChild(element('span', 'tb-point-text', noteDisplayText(note)))
    if (note.children.length) row.appendChild(outline(note.children, depth + 1))
    list.appendChild(row)
  }
  return list
}

/** The prose. Long notes are clamped to a readable block with a way to open
 *  them — a page of unbroken text is not a brief. */
function notesSection(notes: readonly Note[]): HTMLElement {
  const section = element('section', 'tb-notes')
  section.appendChild(heading('annotations.tab.notes', 'notes'))
  for (const note of notes) {
    const kind = noteKindOf(note)
    const block = element('div', 'tb-note')
    if (kind !== 'note') block.setAttribute('data-kind', kind)
    if (note.mark) block.appendChild(glyph(note.mark, 'tb-glyph tb-mark'))
    const text = element('p', 'tb-prose', noteDisplayText(note))
    block.appendChild(text)
    const more = element('button', 'tb-more-text', briefText('square-tile.brief.readOn', 'read on'))
    more.type = 'button'
    more.onclick = () => {
      block.setAttribute('data-open', '')
      more.remove()
    }
    block.appendChild(more)
    // The clamp is a CSS decision; the button only matters when the clamp
    // actually bit, so it hides itself once laid out and unclamped.
    requestAnimationFrame(() => {
      if (text.scrollHeight <= text.clientHeight + 2) more.remove()
    })
    if (note.children.length) block.appendChild(outline(note.children, 1))
    section.appendChild(block)
  }
  return section
}

function emptyWriting(options: BriefPanelOptions): HTMLElement {
  const empty = element('section', 'tb-empty')
  empty.appendChild(element('p', 'tb-empty-line',
    briefText('square-tile.brief.unwritten', 'nothing written on this tile yet')))
  if (!options.onWriteInline && options.onWrite) {
    const write = element('button', 'tb-invite', briefText('square-tile.brief.write', 'write the first note'))
    write.type = 'button'
    write.onclick = () => options.onWrite?.()
    empty.appendChild(write)
  }
  return empty
}

/** One line, always open — type and press Enter. THE PAGE WRITES WHERE IT
 *  READS: the note lands at this tile's own address, so a brief you are
 *  standing in never has to move you somewhere else to be written on. */
function inlineComposer(options: BriefPanelOptions): HTMLElement | null {
  if (!options.onWriteInline) return null
  const form = element('form', 'tb-compose')
  const field = document.createElement('input')
  field.type = 'text'
  field.className = 'tb-compose-field'
  field.placeholder = briefText('square-tile.brief.compose', 'add a note')
  field.setAttribute('aria-label', briefText('square-tile.brief.compose', 'add a note'))
  field.autocomplete = 'off'
  form.appendChild(field)
  form.addEventListener('submit', event => {
    event.preventDefault()
    const text = field.value.trim()
    if (!text) return
    // Cleared BY HAND: the value is ours to reset, and leaving the typed text
    // sitting in the field after a commit reads as a note that did not land.
    field.value = ''
    options.onWriteInline?.(text)
  })
  // The sheet is listening for Escape and the grid for keys; a composer that
  // let them through would close the brief under the typing hand.
  form.addEventListener('keydown', event => { event.stopPropagation() })
  return form
}

// ── The behaviours ───────────────────────────────────────────────────

function behaviorsSection(brief: TileBrief, options: BriefPanelOptions): HTMLElement {
  const section = element('section', 'tb-behaviors')
  section.appendChild(heading('square-tile.brief.behaviors', 'behaviours'))
  if (brief.behaviors.length) {
    const list = element('ul', 'tb-behavior-list')
    for (const behavior of brief.behaviors) list.appendChild(behaviorRow(behavior, options))
    section.appendChild(list)
  } else {
    section.appendChild(element('p', 'tb-quiet',
      briefText('square-tile.brief.noBehaviors', 'this tile carries none of its own')))
  }
  if (options.onBehaviors) {
    const all = element('button', 'tb-link', briefText('square-tile.brief.manage', 'Manage beehaviors'))
    all.type = 'button'
    all.onclick = () => options.onBehaviors?.()
    section.appendChild(all)
  }
  return section
}

function behaviorRow(behavior: BriefBehavior, options: BriefPanelOptions): HTMLElement {
  const row = element('li', 'tb-behavior')
  if (behavior.opensAs) row.setAttribute('data-opens-as', '')
  if (behavior.dormant) row.setAttribute('data-dormant', '')
  const button = element('button', 'tb-behavior-button')
  button.type = 'button'
  // A DORMANT ROW IS STILL A DOOR. Entering the view is the one thing it
  // cannot do, but the row must lead somewhere — the caller sends it to the
  // surface that both explains the sleep and offers the wake.
  button.disabled = !options.onBehavior
  button.title = behavior.description || behavior.label
  button.appendChild(glyph(behavior.icon))
  button.appendChild(element('span', 'tb-behavior-name', behavior.label))
  if (behavior.opensAs) {
    button.appendChild(element('span', 'tb-badge', briefText('square-tile.brief.badge.opensAs', 'opens as')))
  } else if (behavior.dormant) {
    button.appendChild(element('span', 'tb-badge', briefText('features.asleep', 'asleep')))
  }
  button.onclick = () => options.onBehavior?.(behavior)
  row.appendChild(button)
  return row
}

function tagsSection(tags: readonly string[]): HTMLElement {
  const section = element('section', 'tb-tags')
  section.appendChild(heading('square-tile.brief.pheromones', 'pheromones'))
  const list = element('ul', 'tb-tag-list')
  for (const tag of tags) list.appendChild(element('li', 'tb-tag', tag))
  section.appendChild(list)
  return section
}

// ── The gold rail ────────────────────────────────────────────────────
//
// The band's own set, in the band's own order — plain affordances first,
// destructive ones behind a ⋯ so the one control you must not hit by accident
// does not sit beside the fifteen you may.

function affordanceRail(brief: TileBrief, options: BriefPanelOptions): HTMLElement | null {
  const plain = brief.affordances.filter(affordance => !affordance.destructive)
  const grave = brief.affordances.filter(affordance => affordance.destructive)
  const doors: BriefAffordance[] = []
  if (options.onWrite && (brief.lists.length || brief.notes.length)) {
    doors.push({
      name: 'annotations',
      svgMarkup: '',
      label: briefText('annotations.title', 'annotations'),
      destructive: false,
      inert: false,
      run: () => options.onWrite?.(),
    })
  }
  if (!plain.length && !grave.length && !doors.length) return null

  const rail = element('footer', 'tb-rail')
  for (const affordance of [...doors, ...plain]) rail.appendChild(affordanceButton(affordance))
  if (grave.length) {
    const more = element('button', 'tb-rail-more', '⋯')
    more.type = 'button'
    more.setAttribute('aria-label', briefText('square-tile.brief.more', 'more'))
    const hidden = element('span', 'tb-rail-hidden')
    for (const affordance of grave) hidden.appendChild(affordanceButton(affordance))
    more.onclick = () => {
      rail.toggleAttribute('data-more-open')
      more.setAttribute('aria-expanded', rail.hasAttribute('data-more-open') ? 'true' : 'false')
    }
    more.setAttribute('aria-expanded', 'false')
    rail.appendChild(more)
    rail.appendChild(hidden)
  }
  return rail
}

function affordanceButton(affordance: BriefAffordance): HTMLElement {
  const button = element('button', 'tb-act')
  button.type = 'button'
  button.setAttribute('aria-label', affordance.label)
  if (affordance.destructive) button.setAttribute('data-danger', '')
  if (affordance.inert) {
    button.disabled = true
    button.setAttribute('data-inert', '')
  }
  const icon = element('span', 'tb-act-icon')
  if (affordance.svgMarkup) {
    // Provider markup: 24×24, white-filled. Recoloured through currentColor
    // so it reads as ink on this paper rather than as a hole in it.
    icon.innerHTML = affordance.svgMarkup
    const svg = icon.firstElementChild as SVGElement | null
    if (svg) {
      svg.setAttribute('width', '100%')
      svg.setAttribute('height', '100%')
      svg.setAttribute('fill', 'currentColor')
    }
  } else {
    icon.appendChild(glyph('sticky_note_2'))
  }
  button.appendChild(icon)
  button.appendChild(element('span', 'tb-act-name', affordance.label))
  button.onclick = () => affordance.run()
  return button
}

// ── The row, at the foot of a page ───────────────────────────────────

function siblingStrip(options: BriefPanelOptions): HTMLElement {
  const strip = element('nav', 'tb-row')
  strip.setAttribute('aria-label', briefText('square-tile.brief.row', 'the row this tile sits on'))
  strip.appendChild(element('h3', 'tb-section-title',
    briefText('square-tile.brief.row', 'the row this tile sits on')))
  const track = element('div', 'tb-row-track')
  for (const sibling of options.siblings ?? []) {
    const button = element('button', 'tb-row-plate')
    button.type = 'button'
    button.title = sibling.title
    if (sibling.current) button.setAttribute('data-current', '')
    const mat = element('span', 'tb-row-mat')
    if (sibling.imageUrl) {
      const art = document.createElement('img')
      art.src = sibling.imageUrl
      art.alt = ''
      art.draggable = false
      mat.appendChild(art)
    } else {
      mat.appendChild(element('span', 'tb-row-blank'))
    }
    button.appendChild(mat)
    button.appendChild(element('span', 'tb-row-name', sibling.title))
    if (!sibling.current) button.onclick = () => options.onSibling?.(sibling.label)
    track.appendChild(button)
  }
  strip.appendChild(track)
  return strip
}

// ── Paper ────────────────────────────────────────────────────────────
//
// The same ivory, espresso and gold the sheet is set in. Nothing here paints
// a plate or a border unless it is carrying meaning: the rule under a name,
// the hairline down a nested list, the gold of the rail.

export const TILE_BRIEF_CSS = `
.tb-brief{position:relative;box-sizing:border-box;width:100%;background:#fffdf7;border:1px solid rgba(184,147,63,.5);
 box-shadow:0 2px 3px rgba(58,42,28,.08),0 20px 40px -20px rgba(58,42,28,.42);
 padding:clamp(1.1rem,2.4vw,2rem);color:#3a2a1c;text-align:left;animation:tb-open .34s cubic-bezier(.2,.7,.2,1) backwards}
.tb-brief[data-scale=spread]{grid-column:1/-1;margin:.2rem 0 .6rem}
.tb-brief[data-scale=page]{max-width:980px;margin:0 auto}
.tb-head{position:relative;padding-right:2.4rem}
/* On a page the CREST already names the place in full. A card that repeats
   it under its own rule is the same word twice — the head keeps only what
   the crest does not say. */
.tb-brief[data-scale=page] .tb-name,.tb-brief[data-scale=page] .tb-rule{display:none}
.tb-brief[data-scale=page] .tb-facts{margin-top:0}
.tb-name{margin:0;font:italic 700 clamp(1.5rem,3.4vw,2.4rem)/1.12 Georgia,'Times New Roman',serif;letter-spacing:.02em;color:#3a2a1c}
.tb-rule{width:5rem;height:2px;margin:.7rem 0 0;background:linear-gradient(90deg,#b8933f,#d9b96a 55%,transparent)}
.tb-facts{margin:.6rem 0 0;color:#8a7657;font:400 .72rem/1.4 Georgia,serif;letter-spacing:.2em;text-transform:uppercase}
.tb-enter{margin-top:.85rem;padding:.4rem .95rem;background:none;border:1px solid rgba(184,147,63,.6);border-radius:2px;
 color:#5c4630;font:600 .7rem/1 Georgia,serif;letter-spacing:.18em;text-transform:uppercase;cursor:pointer;transition:background .16s ease,color .16s ease}
.tb-enter:hover{background:#b8933f;color:#fffdf7}
.tb-unfold{position:absolute;top:-.2rem;right:-.2rem;width:2rem;height:2rem;padding:0;cursor:pointer;border:0;background:none}
.tb-unfold::before{content:'';position:absolute;inset:0;background:linear-gradient(225deg,#d9b96a 48%,transparent 50%);opacity:.85;transition:opacity .16s ease}
.tb-unfold:hover::before{opacity:1}

.tb-body{display:grid;grid-template-columns:minmax(0,1.75fr) minmax(0,1fr);gap:clamp(1rem,3vw,2.4rem);margin-top:clamp(1rem,2.4vh,1.6rem)}
.tb-brief[data-scale=page] .tb-body{grid-template-columns:minmax(0,10rem) minmax(0,1.6fr) minmax(0,1fr)}
.tb-portrait{align-self:start}
.tb-portrait-mat{display:block;background:#fffdf7;border:1px solid rgba(184,147,63,.45);padding:7px;box-shadow:0 8px 20px -12px rgba(58,42,28,.5)}
.tb-portrait-art{display:block;width:100%;aspect-ratio:1/1;object-fit:cover;background:#efe7d6}
.tb-section-title{margin:0 0 .6rem;color:#a08a5e;font:600 .66rem/1 Georgia,serif;letter-spacing:.26em;text-transform:uppercase}
.tb-writing>section+section{margin-top:clamp(1.1rem,2.6vh,1.8rem)}
.tb-side>section+section{margin-top:1.4rem}

.tb-outline{list-style:none;margin:0;padding:0}
.tb-outline .tb-outline{margin:.35rem 0 .1rem .35rem;padding-left:.85rem;border-left:1px solid rgba(184,147,63,.35)}
.tb-point{display:grid;grid-template-columns:1.15rem 1fr;column-gap:.55rem;align-items:start;padding:.2rem 0;font:400 .95rem/1.5 Georgia,'Times New Roman',serif;color:#4a382a}
.tb-point>.tb-outline{grid-column:2}
.tb-bullet{width:.34rem;height:.34rem;margin:.55rem auto 0;border-radius:50%;background:#b8933f}
.tb-mark{color:#b8933f;font-size:1rem;line-height:1.45}
.tb-glyph{font-family:'Material Symbols Outlined','Material Symbols Rounded';font-weight:400;font-style:normal;
 font-size:1.1rem;line-height:1;letter-spacing:normal;text-transform:none;white-space:nowrap;direction:ltr;
 -webkit-font-feature-settings:'liga';font-feature-settings:'liga';-webkit-font-smoothing:antialiased}
.tb-point-text{min-width:0;overflow-wrap:anywhere}

.tb-note{position:relative;padding:0 0 0 1.6rem;margin:0 0 .9rem}
.tb-note>.tb-mark{position:absolute;left:0;top:.28rem}
.tb-note[data-kind=q]{border-left:2px solid rgba(184,147,63,.5);padding-left:1.2rem;margin-left:.2rem}
.tb-note[data-kind=q]>.tb-mark{display:none}
.tb-note[data-kind=a] .tb-prose{color:#5c4630}
.tb-prose{margin:0;font:400 1rem/1.62 Georgia,'Times New Roman',serif;color:#3f2f22;white-space:pre-wrap;overflow-wrap:anywhere;
 max-width:62ch;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:7;overflow:hidden}
.tb-note[data-open] .tb-prose{display:block;-webkit-line-clamp:none;overflow:visible}
.tb-more-text,.tb-link,.tb-invite{margin-top:.4rem;padding:0;background:none;border:0;color:#a07a2a;cursor:pointer;
 font:600 .72rem/1 Georgia,serif;letter-spacing:.16em;text-transform:uppercase;border-bottom:1px solid rgba(184,147,63,.5)}
.tb-more-text:hover,.tb-link:hover,.tb-invite:hover{color:#7d5c14}
.tb-empty-line{margin:0;color:#8a7657;font:italic 400 .98rem/1.5 Georgia,serif}
.tb-compose{margin-top:1rem;max-width:62ch}
.tb-compose-field{width:100%;box-sizing:border-box;padding:.5rem .1rem;background:none;border:0;
 border-bottom:1px solid rgba(184,147,63,.4);color:#3f2f22;font:400 .96rem/1.5 Georgia,'Times New Roman',serif}
.tb-compose-field::placeholder{color:rgba(138,118,87,.7);font-style:italic}
.tb-compose-field:focus{outline:none;border-bottom-color:#b8933f}

.tb-behavior-list{list-style:none;margin:0;padding:0}
.tb-behavior-button{display:flex;align-items:center;gap:.6rem;width:100%;padding:.42rem .5rem;margin:0 0 .2rem -.5rem;
 background:none;border:0;border-radius:2px;color:#4a382a;cursor:pointer;text-align:left;font:400 .92rem/1.3 Georgia,serif;
 transition:background .14s ease}
.tb-behavior-button:hover:not(:disabled){background:rgba(184,147,63,.13)}
.tb-behavior-button:disabled{cursor:default;opacity:.55}
.tb-behavior-button .tb-glyph{color:#b8933f;font-size:1.25rem}
.tb-behavior[data-opens-as] .tb-behavior-button{color:#3a2a1c;font-weight:700}
.tb-behavior[data-opens-as] .tb-glyph{color:#8a6a1a}
.tb-behavior-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tb-badge{flex:0 0 auto;color:#a08a5e;font:600 .58rem/1 Georgia,serif;letter-spacing:.16em;text-transform:uppercase}
.tb-quiet{margin:0;color:#8a7657;font:italic 400 .9rem/1.5 Georgia,serif}
.tb-tag-list{list-style:none;display:flex;flex-wrap:wrap;gap:.35rem;margin:0;padding:0}
.tb-tag{padding:.18rem .5rem;border:1px solid rgba(184,147,63,.45);border-radius:999px;color:#7a6444;
 font:600 .66rem/1.4 Georgia,serif;letter-spacing:.1em}

.tb-rail{display:flex;flex-wrap:wrap;align-items:flex-start;gap:.2rem;margin-top:clamp(1.1rem,2.6vh,1.8rem);
 padding-top:.9rem;border-top:1px solid rgba(184,147,63,.4)}
.tb-act{display:flex;flex-direction:column;align-items:center;gap:.3rem;min-width:4.1rem;padding:.5rem .35rem;
 background:none;border:0;border-radius:3px;color:#5c4630;cursor:pointer;transition:background .14s ease,color .14s ease}
.tb-act:hover:not(:disabled){background:rgba(184,147,63,.15);color:#3a2a1c}
.tb-act[data-inert]{opacity:.32;cursor:default}
.tb-act[data-danger]{color:#8d4a2f}
.tb-act[data-danger]:hover{background:rgba(141,74,47,.12)}
.tb-act-icon{display:flex;align-items:center;justify-content:center;width:1.35rem;height:1.35rem}
.tb-act-name{font:600 .62rem/1.1 Georgia,serif;letter-spacing:.08em;text-transform:lowercase;max-width:5.4rem;
 overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tb-rail-more{align-self:center;margin-left:auto;width:2rem;height:2rem;padding:0;background:none;border:0;border-radius:50%;
 color:#a08a5e;font:1rem/1 Georgia,serif;cursor:pointer}
.tb-rail-more:hover{background:rgba(184,147,63,.15);color:#5c4630}
.tb-rail-hidden{display:none;flex-basis:100%;gap:.2rem}
.tb-rail[data-more-open] .tb-rail-hidden{display:flex}

.tb-row{margin-top:clamp(1.4rem,3vh,2.2rem);padding-top:1rem;border-top:1px solid rgba(184,147,63,.4)}
.tb-row-track{display:flex;gap:.8rem;overflow-x:auto;padding-bottom:.4rem;scrollbar-width:thin}
.tb-row-plate{flex:0 0 5.6rem;display:flex;flex-direction:column;gap:.4rem;padding:0;background:none;border:0;cursor:pointer}
.tb-row-plate[data-current]{cursor:default}
.tb-row-mat{display:block;background:#fffdf7;border:1px solid rgba(184,147,63,.4);padding:4px;transition:border-color .16s ease}
.tb-row-plate:hover .tb-row-mat{border-color:#b8933f}
.tb-row-plate[data-current] .tb-row-mat{border-color:#8a6a1a;box-shadow:0 0 0 1px rgba(138,106,26,.35)}
.tb-row-mat img,.tb-row-blank{display:block;width:100%;aspect-ratio:1/1;object-fit:cover;background:#f0e8d7}
.tb-row-name{color:#6b543b;font:600 .62rem/1.2 Georgia,serif;letter-spacing:.08em;text-transform:uppercase;
 overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tb-row-plate[data-current] .tb-row-name{color:#3a2a1c}

@keyframes tb-open{from{opacity:0;translate:0 -8px;clip-path:inset(0 0 100% 0)}to{opacity:1;translate:0 0;clip-path:inset(0 0 0 0)}}
@media(prefers-reduced-motion:reduce){.tb-brief{animation:none}}
@media(max-width:860px){
 .tb-body,.tb-brief[data-scale=page] .tb-body{grid-template-columns:minmax(0,1fr)}
 .tb-portrait{max-width:11rem}
 .tb-side{padding-top:1.2rem;border-top:1px solid rgba(184,147,63,.3)}
}
`
