// guide/guide-place.ts
//
// What a click on a page is pointing at, and the two ways a direction list
// can arrive: the bee's own reading of that kind of place, or an agent's
// reply. Pure. The overlay and the drone both call these so a spec can hold
// the words still without a hive.

import { splitQuestion } from '@hypercomb/core'

export type GuideKind = 'heading' | 'text' | 'media' | 'control' | 'section' | 'place' | 'tile'

export type GuidePlace = {
  readonly x: number
  readonly y: number
  readonly route: string
  readonly kind: GuideKind
  /** Accessible name, clipped. Empty when the place has nothing to call itself. */
  readonly name: string
  /** Nearest heading above the place, clipped. */
  readonly heading: string
  /** The place's own words, clipped. */
  readonly text: string
  readonly tag: string
  /** Beehaviors the tile already carries. Only a tile sets this. */
  readonly behaviors?: readonly string[]
}

/** One beehavior attached to the tile, and a short reading of its data. */
export type GuideAttachment = {
  readonly name: string
  readonly kind: string
  readonly detail: string
}

/** Somewhere else the same beehavior already exists. `domain` is set when
 *  that place is on another domain. */
export type GuideKin = {
  readonly name: string
  readonly where: string
  readonly domain: string
}

/** One tile under the bee. */
export type GuideTile = {
  readonly x: number
  readonly y: number
  readonly route: string
  readonly label: string
  readonly name: string
  readonly behaviors: readonly string[]
  readonly attached?: readonly GuideAttachment[]
  readonly kin?: readonly GuideKin[]
}

export type GuideDirections = {
  readonly prompt: string
  readonly options: readonly string[]
}

const NAME_LIMIT = 120
const TEXT_LIMIT = 240
const OPTION_LIMIT = 80
const PROMPT_LIMIT = 280

const DIRECTIONS: Record<GuideKind, readonly string[]> = {
  heading: ['Make the heading shorter', 'Say who this is for', 'Move this heading up', 'Soften the claim'],
  text: ['Tighten this to one point', 'Lead with the conclusion', 'Cut what repeats', 'Split this into two beats'],
  media: ['Replace this picture', 'Crop it tighter', 'Add a caption', 'Remove it'],
  control: ['Rename it so the next step is clear', 'Make this the primary action', 'Move it nearer the heading', 'Remove it'],
  section: ['Say less in this section', 'Reorder it against its neighbours', 'Add one proof', 'Split it'],
  place: ['Clarify what this is', 'Move it', 'Give it less weight', 'Remove it'],
  tile: ['Say what this tile is for', 'Suggest one next change', 'Give it one beehavior', 'Leave it as it is'],
}

const HEADING = /^H[1-6]$/
const MEDIA = new Set(['IMG', 'VIDEO', 'PICTURE', 'SVG', 'CANVAS', 'FIGURE'])
const CONTROL = new Set(['A', 'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'SUMMARY'])
const SECTION = new Set(['SECTION', 'ARTICLE', 'HEADER', 'NAV', 'FOOTER', 'MAIN', 'ASIDE'])

const clip = (value: string, limit: number): string => {
  const text = value.replace(/\s+/g, ' ').trim()
  if (text.length <= limit) return text
  return `${text.slice(0, limit - 1).trimEnd()}…`
}

export const kindLabel = (kind: GuideKind): string => {
  if (kind === 'heading') return 'Heading'
  if (kind === 'text') return 'Text'
  if (kind === 'media') return 'Picture'
  if (kind === 'control') return 'Control'
  if (kind === 'section') return 'Section'
  if (kind === 'tile') return 'Tile'
  return 'Place'
}

/** The kind of thing an element is, read from its tag and role. */
export const kindOf = (el: Element): GuideKind => {
  const tag = el.tagName
  const role = (el.getAttribute('role') ?? '').toLowerCase()
  if (HEADING.test(tag) || role === 'heading') return 'heading'
  if (MEDIA.has(tag) || role === 'img') return 'media'
  if (CONTROL.has(tag) || role === 'button' || role === 'link') return 'control'
  if (SECTION.has(tag) || role === 'region') return 'section'
  const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim()
  if (text.length > 40) return 'text'
  return 'place'
}

const accessibleName = (el: Element): string => {
  const labelled = el.getAttribute('aria-label')
    ?? (el instanceof HTMLImageElement ? el.alt : '')
    ?? el.getAttribute('title')
    ?? ''
  if (labelled.trim()) return clip(labelled, NAME_LIMIT)
  return clip(el.textContent ?? '', NAME_LIMIT)
}

/** Climb to the first element that is a real part of the page, not an empty wrapper. */
export const meaningfulElement = (start: Element): Element => {
  let current: Element | null = start
  for (let depth = 0; depth < 6 && current; depth++) {
    if (kindOf(current) !== 'place') return current
    if (accessibleName(current)) return current
    current = current.parentElement
  }
  return start
}

const nearestHeading = (el: Element): string => {
  let current: Element | null = el
  for (let depth = 0; depth < 8 && current; depth++) {
    const heading = HEADING.test(current.tagName)
      ? current
      : current.querySelector('h1, h2, h3, h4, h5, h6')
    if (heading && heading !== el) return clip(heading.textContent ?? '', NAME_LIMIT)
    if (HEADING.test(current.tagName)) return clip(current.textContent ?? '', NAME_LIMIT)
    current = current.parentElement
  }
  return ''
}

/** Describe one element the participant pointed at. */
export const placeFromElement = (
  el: Element,
  point: { readonly x: number; readonly y: number },
  route: string,
): GuidePlace => {
  const found = meaningfulElement(el)
  const name = accessibleName(found)
  return {
    x: point.x,
    y: point.y,
    route: route.trim() || '/',
    kind: kindOf(found),
    name,
    heading: nearestHeading(found),
    text: clip(found.textContent ?? '', TEXT_LIMIT),
    tag: found.tagName.toLowerCase(),
  }
}

/** The bee's own directions for this kind of place. Shown at once, and kept if no agent answers. */
export const beeDirections = (place: GuidePlace): GuideDirections => ({
  prompt: directionsPrompt(place),
  options: DIRECTIONS[place.kind],
})

export const directionsPrompt = (place: GuidePlace): string => {
  const name = place.name.trim()
  if (!name) return 'Which way should this change?'
  const prompt = `Which way should “${clip(name, 80)}” change?`
  return prompt.length <= PROMPT_LIMIT ? prompt : 'Which way should this change?'
}

const cleanLine = (line: string): string => {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('```') || trimmed.startsWith('{') || trimmed.startsWith('}')) return ''
  if (/^(route|kind|name|heading|text|beehaviors):/i.test(trimmed)) return ''
  return trimmed.replace(/^(?:[-*•]|\d+[.)])\s+/, '').replace(/\*\*/g, '').trim()
}

/**
 * Directions an agent sent back. A `hypercomb-question` fence wins. A short
 * list of lines is the other shape a model actually returns. Anything else
 * is not a list of directions.
 */
export const optionsFromAnswer = (text: string): GuideDirections | null => {
  const split = splitQuestion(text)
  if (split.question && split.question.options.length >= 2) {
    return { prompt: split.question.prompt, options: split.question.options }
  }
  const lines: string[] = []
  for (const line of String(text ?? '').split('\n')) {
    const cleaned = cleanLine(line)
    if (!cleaned || cleaned.length > OPTION_LIMIT) continue
    if (lines.some(held => held.toLowerCase() === cleaned.toLowerCase())) continue
    lines.push(cleaned)
  }
  const asked = lines.find(line => line.endsWith('?'))
  const options = lines.filter(line => line !== asked).slice(0, 4)
  if (options.length < 2) return null
  return { prompt: asked || 'Which way should this change?', options }
}

const called = (tile: GuideTile): string => tile.name.trim() || tile.label.trim() || 'This tile'

const spoken = (behavior: string): string => behavior.trim().toLowerCase().replace(/-/g, ' ')

/** A short string carried on a decoration, never a signature or a blob. */
export const payloadDetail = (payload: unknown): string => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return ''
  const record = payload as Record<string, unknown>
  for (const key of ['label', 'title', 'name', 'heading', 'text', 'caption']) {
    const value = record[key]
    if (typeof value !== 'string') continue
    const clean = value.replace(/\s+/g, ' ').trim()
    if (!clean || clean.length > OPTION_LIMIT || /^[0-9a-f]{64}$/.test(clean)) continue
    return clean
  }
  return ''
}

/** One idea for the tile under the bee, plus the beehaviors it already has. */
export const hoverLine = (tile: GuideTile): string => {
  const lines = [called(tile)]
  if (tile.behaviors.length) lines.push(tile.behaviors.join(' · '))
  const detail = tile.attached?.find(item => item.detail)?.detail
  if (detail) lines.push(detail)
  const kin = firstKin(tile)
  if (kin?.domain) lines.push(`Also on ${kin.domain}.`)
  else if (kin?.where) lines.push(`Also at ${kin.where}.`)
  lines.push(tileIdea(tile), 'Stay a moment.')
  return lines.join('\n')
}

/** What the card says once the attached data and the other places are known. */
export const tileReading = (tile: GuideTile): string => {
  const bits: string[] = []
  const attached = tile.attached ?? []
  if (attached.length) {
    const shown = attached.slice(0, 3)
    const details = [...new Set(shown.map(item => item.detail).filter(Boolean))]
    if (details.length === 1) {
      bits.push(`Carries ${shown.map(item => item.name).join(', ')}: ${details[0]}.`)
    } else {
      const parts = shown.map(item => item.detail ? `${item.name}: ${item.detail}` : item.name)
      bits.push(`Carries ${parts.join(', ')}.`)
    }
  }
  const kin = tile.kin ?? []
  const near = kin.find(item => item.where && !item.domain)
  const far = kin.find(item => item.domain)
  if (near) bits.push(`${near.name} also sits at ${near.where}.`)
  if (far) bits.push(`${far.name} also shows on ${far.domain}.`)
  const text = bits.join(' ')
  if (!text) return 'Some choices'
  return text.length <= PROMPT_LIMIT ? text : `${text.slice(0, PROMPT_LIMIT - 1).trimEnd()}…`
}

/** A place on another domain wins over a local path, so the one line the
 *  hover can spare names the farther match. */
const firstKin = (tile: GuideTile): GuideKin | undefined =>
  tile.kin?.find(item => item.domain) ?? tile.kin?.find(item => item.where)

const kinLine = (kin: GuideKin): string => {
  if (kin.domain) {
    const line = `See ${kin.name} on ${kin.domain}`
    return line.length <= OPTION_LIMIT ? line : `See ${kin.domain}`
  }
  const line = `See it at ${kin.where}`
  return line.length <= OPTION_LIMIT ? line : 'See where else this beehavior sits'
}

const tileIdea = (tile: GuideTile): string => {
  const words = tile.behaviors.map(spoken)
  if (words.includes('website')) return 'The page could say one thing more clearly.'
  if (words.includes('files')) return 'The files could be named for what they are.'
  if (words.includes('note') || words.includes('notes')) return 'A note could say what this is for.'
  if (words.length) return 'One of these beehaviors could be the next step.'
  return 'It could take one beehavior.'
}

const suggestionFor = (behavior: string): string => {
  const word = spoken(behavior)
  if (word === 'website') return 'Change the page'
  if (word === 'files') return 'Say what the files are for'
  if (word === 'note' || word === 'notes') return 'Add one note'
  if (word === 'invite') return 'Say who this invites'
  if (word === 'contact') return 'Say how to reach them'
  const line = `Use ${word} here`
  return line.length <= OPTION_LIMIT ? line : 'Use this beehavior'
}

/** One thing that could happen on this tile. */
export type GuideIdea = {
  readonly id: string
  /** The Material Symbols glyph its tile wears. */
  readonly icon: string
  /** The short word its tile shows when the font cannot draw the glyph. */
  readonly word: string
  /** What rollover and the list say. */
  readonly label: string
}

/** A beehavior this hive could put on the tile. */
export type GuideBehavior = {
  readonly word: string
  readonly icon: string
  readonly about: string
}

/** Three rings of tiles, which is the most a screen can hold at a readable size. */
const IDEA_LIMIT = 36

/** What any tile could have done, once its own beehaviors have spoken. */
const GENERAL_IDEAS: readonly Omit<GuideIdea, 'id'>[] = [
  { icon: 'description', word: 'purpose', label: 'Say what this tile is for' },
  { icon: 'lightbulb', word: 'next', label: 'Suggest one next change' },
  { icon: 'category', word: 'parts', label: 'Break this tile into parts' },
  { icon: 'travel_explore', word: 'missing', label: 'Find what is missing here' },
]

/**
 * Everything the bee can offer on one tile: the beehaviors it carries, where
 * the same beehavior sits, what any tile could do, then what this hive could
 * add. The most specific come first, so they take the inner ring.
 */
export const tileIdeas = (tile: GuideTile, offered: readonly GuideBehavior[]): readonly GuideIdea[] => {
  const ideas: GuideIdea[] = []
  const add = (idea: GuideIdea): void => {
    if (ideas.length >= IDEA_LIMIT || !idea.label || idea.label.length > OPTION_LIMIT) return
    if (ideas.some(held => held.label.toLowerCase() === idea.label.toLowerCase())) return
    ideas.push(idea)
  }
  const carried = new Set(tile.behaviors.map(spoken))
  for (const behavior of tile.behaviors) {
    const word = spoken(behavior)
    const known = offered.find(item => spoken(item.word) === word)
    add({ id: `own:${word}`, icon: known?.icon ?? 'edit', word, label: suggestionFor(behavior) })
  }
  const kin = firstKin(tile)
  if (kin) add({ id: 'kin', icon: 'travel_explore', word: kin.name, label: kinLine(kin) })
  for (const idea of GENERAL_IDEAS) add({ id: `general:${idea.word}`, ...idea })
  for (const item of offered) {
    const word = spoken(item.word)
    if (carried.has(word)) continue
    add({ id: `add:${word}`, icon: item.icon, word, label: `Add ${word}` })
  }
  return ideas
}

/** What one agent is told to do with the idea the participant accepted. */
export const ideaTask = (tile: GuideTile, idea: GuideIdea): string => [
  `Task: ${idea.label}.`,
  `Tile: ${called(tile)}, at ${tile.route || '/'}.`,
  `Beehaviors: ${tile.behaviors.length ? tile.behaviors.join(', ') : '(none)'}.`,
  'The participant chose this. Read the tile, do the task on it, and end with one line saying what changed.',
].join('\n')

export type Axial = { readonly q: number; readonly r: number }

/** The neighbour walked to next, going round a ring. */
const RING_WALK: readonly Axial[] = [
  { q: -1, r: 1 }, { q: -1, r: 0 }, { q: 0, r: -1 }, { q: 1, r: -1 }, { q: 1, r: 0 }, { q: 0, r: 1 },
]

/** How many rings `count` tiles fill round the centre. */
export const ringsFor = (count: number): number => {
  let rings = 0
  for (let held = 0; held < count; held += ++rings * 6) { /* the next ring holds six more */ }
  return rings
}

/** The first `count` cells round a centre, ring by ring, as offsets from it. */
export const ringCells = (count: number): readonly Axial[] => {
  const cells: Axial[] = []
  for (let ring = 1; cells.length < count; ring++) {
    let at = { q: ring, r: 0 }
    for (const step of RING_WALK) {
      for (let walked = 0; walked < ring && cells.length < count; walked++) {
        cells.push(at)
        at = { q: at.q + step.q, r: at.r + step.r }
      }
    }
  }
  return cells
}

/** The index of the point within `reach` of the pointer, nearest first. -1 is none. */
export const nearestPoint = (
  points: readonly { readonly x: number; readonly y: number }[],
  x: number,
  y: number,
  reach: number,
): number => {
  let best = -1
  let bestDistance = reach
  points.forEach((point, index) => {
    const distance = Math.hypot(point.x - x, point.y - y)
    if (distance < bestDistance) { best = index; bestDistance = distance }
  })
  return best
}

export type GuideFrame = {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

export type GuideBoardBox = {
  readonly left: number
  readonly width: number
  /** The middle of the board, for a board as tall as what it holds. */
  readonly middle?: number
  /** The top and height, for a board that fills the free height. */
  readonly top?: number
  readonly height?: number
}

/** How far the board stands off the tiles, and its widths. */
const BOARD_GAP = 28
const BOARD_WIDTH = 320
const BOARD_LIST_WIDTH = 560
/** The list keeps at least this much before it would rather cross over the tile. */
const BOARD_MIN_WIDTH = 240

/**
 * The bordered board stands beside what is in the middle, never on it. It
 * takes the side with room, the right when both have it. As a list it fills
 * the free height and scrolls; beside the tiles it is only as tall as it holds.
 */
export const boardBox = (
  free: GuideFrame,
  centre: { readonly x: number; readonly y: number },
  extent: number,
  mode: 'tiles' | 'list',
): GuideBoardBox => {
  const near = extent + BOARD_GAP
  const rightRoom = free.right - (centre.x + near)
  const leftRoom = centre.x - near - free.left
  const onRight = rightRoom >= BOARD_MIN_WIDTH || rightRoom >= leftRoom
  const room = Math.max(BOARD_MIN_WIDTH, onRight ? rightRoom : leftRoom)
  const width = Math.min(mode === 'list' ? BOARD_LIST_WIDTH : BOARD_WIDTH, room)
  const left = onRight
    ? Math.min(centre.x + near, free.right - width)
    : Math.max(centre.x - near - width, free.left)
  return mode === 'list'
    ? { left, width, top: free.top, height: free.bottom - free.top }
    : { left, width, middle: centre.y }
}

/** The question sent after the bee dances on a tile. It asks for suggestions and refuses a write. */
export const guideTileAsk = (tile: GuideTile): string => [
  'You are the guide bee. The participant stayed on a tile and wants a few choices, not the change itself.',
  'Reply with exactly one hypercomb-question fence and no other fence. It must be the last fence.',
  'Do not write a page. Do not emit a change block. Do not read the hive.',
  'Offer two, three, or four options. Each option is under 80 characters. The prompt is one sentence naming the tile.',
  '',
  '```hypercomb-question',
  '{"prompt":"What should the tile do next?","options":["Change the page","Say what this tile is for"]}',
  '```',
  '',
  `Route: ${tile.route || '/'}`,
  `Name: ${called(tile)}`,
  `Beehaviors: ${tile.behaviors.length ? tile.behaviors.join(', ') : '(none)'}`,
].join('\n')

/** The question sent to the conversation. It asks for directions and refuses a write. */
export const guideAsk = (place: GuidePlace): string => [
  'You are the guide bee. The participant clicked one place and wants directions for a change, not the change itself.',
  'Reply with exactly one hypercomb-question fence and no other fence. It must be the last fence.',
  'Do not write a page. Do not emit a change block. Do not read the hive.',
  'Offer two, three, or four options. Each option is under 80 characters. The prompt is one sentence naming the place.',
  '',
  '```hypercomb-question',
  '{"prompt":"Which way should the heading change?","options":["Make it shorter","Say who it is for"]}',
  '```',
  '',
  `Route: ${place.route || '/'}`,
  `Kind: ${place.kind}`,
  `Name: ${place.name || '(none)'}`,
  `Heading: ${place.heading || '(none)'}`,
  `Text: ${place.text || '(none)'}`,
].join('\n')
