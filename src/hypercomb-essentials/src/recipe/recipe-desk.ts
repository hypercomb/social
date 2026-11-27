// recipe/recipe-desk.ts
//
// THE RECIPE DESK'S ARITHMETIC AND ITS SHORT WORDS, with nothing to measure.
// The page (recipe-page.ts) hands in numbers and values and gets back answers:
//
//   SUMMARY   what a section holds, said in a few words beside its tab.
//   CALLOUTS  which ingredients are drawn as labels, and how many are not.
//   SEATS     which side of the plate each part sits on, and on which row.
//   FIT       wide or narrow, which list, how large the plate is drawn. Decided
//             from the desk's OWN box, which no layout changes, never from a
//             box inside it.
//   LEADERS   the thin line from each tab to its dot on the plate, laid so
//             that no two cross.
//   A SET     the same desk on a photographed table set (recipe-setting.ts):
//             the sections sit on its plates in order, each tab on the side of
//             its plate, its leader to that plate's floor centre, and the
//             ingredients to points spread over their plate's floor.
//
// A recipe is a layout and its fill (N4): the desk draws the layout as tabs
// around a plate and the fill as what each tab says. Nothing here decides what
// a recipe IS; it only decides where a value's label is drawn (A1, V1: what is
// painted is derived, never stored).
//
// Pure: no DOM, no storage, no network. It exports and never registers.

import { RECIPE_SETTING_LIMITS, recipeFloorAt, type RecipeSettingFloor } from './recipe-setting.js'
import { recipeLinkUrl, type RecipeIngredient, type RecipeValue } from './recipe-template.js'
import { recipeWords, type RecipeSay } from './recipe-style.js'

/** The desk's sizes, in px at 100% text (each is scaled by em / 16) or in em where named so. */
export const RECIPE_DESK = Object.freeze({
  /** The plate stays a specimen: a larger desk gets margin, not a larger plate. */
  plateMax: 440,
  plateMin: 320,
  /** Narrow: the plate is a band at the top, about a third of the height. */
  narrowMin: 150,
  narrowMax: 260,
  /** Desk widths (em) where wide stops and where the list gives ground. */
  wideEm: 56,
  listFullEm: 82.5,
  listMidEm: 68.75,
  listEm: Object.freeze({ full: 14.5, mid: 11.5, faces: 3.7 }),
  /** One row of a tab column, in em. */
  pitchEm: 2.4,
  /** The least a tab column may be, the gap between it and the plate, and the stage's side padding, in em. */
  sideEm: 10,
  gapEm: 3.5,
  padEm: 1,
  /** Kept clear above and below the plate: the stage's padding and the tools row, in em. */
  chromeEm: 6.5,
  /** The header's one line, in em: the room under it is the desk's own height less this. */
  headEm: 2.75,
  /** What a narrow desk must have to spare, each way, before it turns wide again, in em. */
  spareEm: 1,
  /** Ingredients drawn as labels before the rest are counted. */
  callouts: 9,
  /** The level run a leader leaves its tab on, px. */
  stub: 22,
  /** The drawn square plate's edge, and the half-width of the face ingredients point into, as shares of the square it is drawn in. */
  rim: 0.48,
  well: 0.33,
  /** How far above and below the middle the ingredients' dots are spread, as a share of that square. */
  face: 0.25,
  /** A table set is a photograph, wider than a plate: its width is capped here, and the rest is margin. */
  setMax: 760,
  /** Where a place card lies on a plate's floor, as shares of the floor along (u) and across (v). A plate is
   *  small in the photograph, and the floor's width is what sizes the words, so the card takes most of it and
   *  leaves a band at the far rim. */
  placeCard: Object.freeze({ u: Object.freeze([0.12, 0.88] as const), v: Object.freeze([0.36, 0.94] as const) }),
  /** Where ingredients' dots are spread over their plate's floor: the band at the far rim, clear of the place card. */
  spread: Object.freeze({ u: Object.freeze([0.16, 0.84] as const), v: Object.freeze([0.08, 0.28] as const) }),
})

export interface RecipeDeskPoint { readonly x: number; readonly y: number }

type Side = 'left' | 'right'

// ── words ───────────────────────────────────────────────────────────────────

/** True for a link to a video host: youtube.com, youtu.be or vimeo.com. It is still only a link. */
export function recipeLinkIsVideo(url: string): boolean {
  const href = recipeLinkUrl(url)
  if (!href) return false
  const host = new URL(href).hostname.toLowerCase().replace(/\.$/, '')
  return ['youtube.com', 'youtu.be', 'vimeo.com'].some(name => host === name || host.endsWith(`.${name}`))
}

/** A bare amount: digits, fractions and the marks between them. */
const BARE_NUMBER = new RegExp('^[\\d\\s.,/\\u00bc-\\u00be\\u2150-\\u215e-]+$')
const SUMMARY_LETTERS = 48

const firstWords = (text: string): string => {
  if (text.length <= SUMMARY_LETTERS) return text
  const cut = text.slice(0, SUMMARY_LETTERS + 1)
  const at = cut.lastIndexOf(' ')
  return `${cut.slice(0, at > SUMMARY_LETTERS / 2 ? at : SUMMARY_LETTERS).replace(/[\s.,;:!?-]+$/, '')}…`
}

/**
 * What a section holds, in the few words its tab has room for: the first words
 * of a text, the facts side by side, "3 steps" and their minutes, "2 links,
 * 1 video", "3 pictures", "6 ingredients", or the word for none.
 */
export function recipeSectionSummary(value: RecipeValue, say: RecipeSay): string {
  const words = (key: string, fallback: string, params?: Record<string, string | number>): string => recipeWords(say, key, fallback, params)
  const none = (): string => words('recipe.summary.none', 'none')
  const counted = (n: number, key: string, one: string, many: string): string =>
    n === 1 ? words(`${key}.one`, one, { n }) : words(`${key}.other`, many, { n })
  switch (value.kind) {
    case 'text': {
      const text = value.text.replace(/\s+/g, ' ').trim()
      return text ? firstWords(text) : none()
    }
    case 'ingredients':
      return value.items.length ? counted(value.items.length, 'recipe.summary.ingredients', '{n} ingredient', '{n} ingredients') : none()
    case 'facts':
      return value.facts.length
        ? value.facts.map(fact => (BARE_NUMBER.test(fact.value) ? `${fact.label} ${fact.value}` : fact.value)).join(' · ')
        : none()
    case 'steps': {
      const n = value.steps.length
      if (!n) return none()
      const steps = counted(n, 'recipe.summary.steps', '{n} step', '{n} steps')
      const minutes = value.steps.reduce((sum, step) => sum + (step.minutes ?? 0), 0)
      if (!minutes) return steps
      const h = Math.floor(minutes / 60)
      const rest = minutes % 60
      const time = !h
        ? words('recipe.summary.minutes', '{n} min', { n: minutes })
        : rest
          ? words('recipe.summary.hours-minutes', '{h} h {n} min', { h, n: rest })
          : words('recipe.summary.hours', '{h} h', { h })
      return `${steps} · ${time}`
    }
    case 'links': {
      const videos = value.links.filter(link => recipeLinkIsVideo(link.url)).length
      const others = value.links.length - videos
      const said = [
        ...(others ? [counted(others, 'recipe.summary.links', '{n} link', '{n} links')] : []),
        ...(videos ? [counted(videos, 'recipe.summary.videos', '{n} video', '{n} videos')] : []),
      ]
      return said.length ? said.join(', ') : none()
    }
    case 'pictures':
      return value.pictures.length ? counted(value.pictures.length, 'recipe.summary.pictures', '{n} picture', '{n} pictures') : none()
  }
}

// ── callouts ────────────────────────────────────────────────────────────────

export interface RecipeDeskCallout {
  /** Which ingredient of the section it is. */
  readonly at: number
  readonly amount: string
  readonly item: string
}

/**
 * The ingredients drawn as labels around the plate. One more than the cap is
 * still drawn whole (a "+ 1 more" label would take the room of the ingredient
 * it hides); past that the first `cap` are drawn and the rest are counted.
 */
export function recipeDeskCallouts(items: readonly RecipeIngredient[], cap: number = RECIPE_DESK.callouts): { readonly shown: readonly RecipeDeskCallout[]; readonly more: number } {
  const most = Math.max(1, Math.floor(cap))
  const shown = (items.length <= most + 1 ? items : items.slice(0, most)).map((each, at) => ({ at, amount: each.amount ?? '', item: each.item }))
  return { shown, more: items.length - shown.length }
}

// ── seats ───────────────────────────────────────────────────────────────────

export interface RecipeDeskPart {
  readonly key: string
  /** An ingredients section: how many labels stand under its heading. Absent for a plain tab. */
  readonly callouts?: number
  /** A value the template has no section for: seated after a divider. */
  readonly kept?: boolean
}

export interface RecipeDeskSeat {
  readonly key: string
  readonly side: Side
  /** The row its tab sits on, counted from the top of its side. Its labels take the rows after it. */
  readonly row: number
  /** The row of the divider drawn before it: the first kept part only. */
  readonly divider?: number
}

export interface RecipeDeskSeating {
  readonly seats: readonly RecipeDeskSeat[]
  /** How many rows each side holds. */
  readonly rows: { readonly left: number; readonly right: number }
}

/**
 * Which side of the plate each part sits on, in reading order. With no
 * ingredients the tabs are shared between the sides, the first half on the
 * left. An ingredients section takes one side for itself (`calloutSide`), its
 * labels stacked under its heading, and the plain tabs take the other; only
 * when that side is full (`capacity` rows) do the last of them move under the
 * labels.
 */
export function recipeDeskSeats(parts: readonly RecipeDeskPart[], capacity = Number.POSITIVE_INFINITY, calloutSide: Side = 'right'): RecipeDeskSeating {
  const rows = { left: 0, right: 0 }
  const seats: RecipeDeskSeat[] = []
  const firstKept = parts.findIndex(part => part.kept)
  const height = (at: number): number => 1 + (parts[at].callouts ?? 0) + (at === firstKept ? 1 : 0)
  const sit = (at: number, side: Side): void => {
    const divider = at === firstKept ? rows[side]++ : undefined
    seats[at] = { key: parts[at].key, side, row: rows[side], ...(divider !== undefined ? { divider } : {}) }
    rows[side] += 1 + (parts[at].callouts ?? 0)
  }
  if (!parts.some(part => part.callouts !== undefined)) {
    const half = Math.ceil(parts.reduce((sum, _, at) => sum + height(at), 0) / 2)
    parts.forEach((_, at) => sit(at, rows.left < half ? 'left' : 'right'))
  } else {
    const plainSide: Side = calloutSide === 'right' ? 'left' : 'right'
    parts.forEach((part, at) => { if (part.callouts !== undefined) sit(at, calloutSide) })
    parts.forEach((part, at) => {
      if (part.callouts !== undefined) return
      const full = rows[plainSide] + height(at) > capacity && rows[calloutSide] + height(at) <= capacity
      sit(at, full ? calloutSide : plainSide)
    })
  }
  return { seats, rows }
}

// ── fit ─────────────────────────────────────────────────────────────────────

export interface RecipeDeskRoom {
  /** The whole desk's width, px. */
  readonly width: number
  /**
   * The room under the header, px: the desk's own height less `headEm`. Never
   * the measured height of the box under the header: the header is taller in
   * one layout than in the other, so that box changes with the very layout it
   * would decide, and a desk resting on a threshold would turn for ever.
   */
  readonly height: number
  /** The desk's own text size, px. */
  readonly em: number
  /** True when the list on the left is shown. */
  readonly list?: boolean
  /** The tallest tab column, in rows. More than fit turns the desk narrow. */
  readonly rows?: number
  /** The layout drawn now. A narrow desk turns wide only with `spareEm` to spare, so one resting on a threshold stays as it is. */
  readonly was?: 'wide' | 'narrow'
  /** A table set's width over its height. Absent: the drawn plate, a square. */
  readonly aspect?: number
}

export interface RecipeDeskFit {
  readonly layout: 'wide' | 'narrow'
  readonly list: 'full' | 'mid' | 'faces'
  /** The plate's side, px: one number the drawing, the dots and the card all share. On a set, the set's height. */
  readonly plate: number
  /** The box the figure is drawn in, px: the plate's square, or the set at its own aspect. */
  readonly figure: { readonly width: number; readonly height: number }
  /** The tab columns are too slim for a summary beside each label. */
  readonly compact: boolean
  /** How many rows a tab column holds at this height. */
  readonly capacity: number
}

const clampTo = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value))

/**
 * Wide or narrow, and how large the plate is drawn. Decided from the desk's own
 * width in em of its own text, so larger text turns narrow sooner, by design.
 * The sizes answered are the same whatever the desk was: only the turn from
 * narrow to wide asks for room to spare.
 */
export function recipeDeskFit(room: RecipeDeskRoom): RecipeDeskFit {
  const D = RECIPE_DESK
  const em = room.em > 0 ? room.em : 16
  const U = em / 16
  const widthEm = room.width / em
  const list: RecipeDeskFit['list'] = widthEm >= D.listFullEm ? 'full' : widthEm >= D.listMidEm ? 'mid' : 'faces'
  const stage = room.width - (room.list ? D.listEm[list] * em : 0)
  // A set's aspect, kept to the shapes the set reader accepts (RECIPE_SETTING_LIMITS.aspect); anything else is the plate.
  const { least, most } = RECIPE_SETTING_LIMITS.aspect
  const aspect = typeof room.aspect === 'number' && Number.isFinite(room.aspect) && room.aspect > 0 ? clampTo(room.aspect, least, most) : 0
  /** The plate and the rows a column holds, in a room `less` px smaller each way. */
  const plateIn = (less: number): number =>
    Math.round(Math.min(D.plateMax * U, stage - less - 2 * (D.sideEm + D.gapEm + D.padEm) * em, room.height - less - D.chromeEm * em))
  /** The set's box where the plate's square would be: as wide as the room between the columns allows, as tall as the height allows. */
  const setIn = (less: number): { width: number; height: number } => {
    const width = Math.min(D.setMax * U, stage - less - 2 * (D.sideEm + D.gapEm + D.padEm) * em, (room.height - less - D.chromeEm * em) * aspect)
    return { width: Math.round(width), height: Math.round(width / aspect) }
  }
  const figureIn = (less: number): { width: number; height: number } => {
    if (aspect) return setIn(less)
    const side = plateIn(less)
    return { width: side, height: side }
  }
  const capacityIn = (less: number): number => Math.max(1, Math.floor((room.height - less - 2.5 * em) / (D.pitchEm * em)))
  const figure = figureIn(0)
  const capacity = capacityIn(0)
  const spare = room.was === 'narrow' ? D.spareEm * em : 0
  const wide = (room.width - spare) / em >= D.wideEm && figureIn(spare).width >= D.plateMin * U && (room.rows ?? 0) <= capacityIn(spare)
  if (!wide) {
    if (aspect) {
      // A phone: the set at full width inside its 16px gutters, never so tall that the tabs under it have no room.
      // Rounded down, both: a pixel over the gutter is a page that scrolls sideways.
      const height = Math.floor(Math.min((room.width - 32) / aspect, room.height * 0.45))
      const width = Math.floor(height * aspect)
      return { layout: 'narrow', list, plate: height, figure: { width, height }, compact: false, capacity }
    }
    const narrow = Math.round(clampTo(Math.min(room.width - 48 * U, room.height * 0.3), D.narrowMin * U, D.narrowMax * U))
    return { layout: 'narrow', list, plate: narrow, figure: { width: narrow, height: narrow }, compact: false, capacity }
  }
  const side = (stage - figure.width - 2 * (D.gapEm + D.padEm) * em) / 2
  return { layout: 'wide', list, plate: figure.height, figure, compact: side < 14 * em, capacity }
}

// ── leaders ─────────────────────────────────────────────────────────────────

export interface RecipeDeskTab {
  readonly id: string
  readonly side: Side
  /** A section's tab ends on the plate's rim; an ingredient's label ends on its face. */
  readonly into: 'rim' | 'face'
  /** The x of the tab's edge nearest the plate, and the y of its middle. */
  readonly edge: number
  readonly y: number
}

export interface RecipeDeskPlate {
  readonly cx: number
  readonly cy: number
  /** The side of the square the plate is drawn in. */
  readonly size: number
  /** A drawn round plate, or the square white card a picture sits on. */
  readonly shape: 'plate' | 'card'
  /** Something is written in the middle (the invitation): dots keep off it. */
  readonly clear?: boolean
}

export interface RecipeDeskLeader {
  readonly id: string
  /** Tab edge, the end of its level run, then the dot. Two points when it runs level all the way. */
  readonly points: readonly RecipeDeskPoint[]
  readonly dot: RecipeDeskPoint
}

const GOLDEN = 0.6180339887

/** Proper crossing of two segments. Touching ends do not count. */
function segmentsCross(a: readonly [RecipeDeskPoint, RecipeDeskPoint], b: readonly [RecipeDeskPoint, RecipeDeskPoint]): boolean {
  const turn = (p: RecipeDeskPoint, q: RecipeDeskPoint, r: RecipeDeskPoint): number => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)
  const d1 = turn(b[0], b[1], a[0])
  const d2 = turn(b[0], b[1], a[1])
  const d3 = turn(a[0], a[1], b[0])
  const d4 = turn(a[0], a[1], b[1])
  return d1 * d2 < 0 && d3 * d4 < 0
}

/** How many times the lines of DIFFERENT leaders cross. The desk draws none. */
export function recipeDeskCrossings(leaders: readonly RecipeDeskLeader[]): number {
  const segments: { id: string; line: [RecipeDeskPoint, RecipeDeskPoint] }[] = []
  for (const leader of leaders) {
    for (let k = 0; k < leader.points.length - 1; k++) segments.push({ id: leader.id, line: [leader.points[k], leader.points[k + 1]] })
  }
  let crossings = 0
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      if (segments[i].id !== segments[j].id && segmentsCross(segments[i].line, segments[j].line)) crossings++
    }
  }
  return crossings
}

/** Values kept in order and at least `gap` apart, moved as little as that takes, inside `low` to `high`. */
function spread(values: readonly number[], gap: number, low: number, high: number): number[] {
  const down = [...values]
  for (let i = 1; i < down.length; i++) down[i] = Math.max(down[i], down[i - 1] + gap)
  const up = [...values]
  for (let i = up.length - 2; i >= 0; i--) up[i] = Math.min(up[i], up[i + 1] - gap)
  // Pushed from the top and pulled from the bottom, then halved: crowded values part evenly about where they were.
  const out = down.map((value, at) => (value + up[at]) / 2)
  let ceiling = high
  for (let i = out.length - 1; i >= 0; i--) {
    out[i] = Math.min(out[i], ceiling)
    ceiling = out[i] - gap
  }
  let floor = low
  for (let i = 0; i < out.length; i++) {
    out[i] = Math.max(out[i], floor)
    floor = out[i] + gap
  }
  return out
}

/**
 * The leaders of one drawing. Each tab leaves on a level run toward the plate
 * and then goes straight to its dot. Section tabs end on the plate's near
 * edge: the left column on its left edge top to bottom, the right column on its
 * right, each dot level with its tab where the edge is tall enough.
 * Ingredient labels end on the plate's face, one row of the face each, at
 * depths that wander so the dots are spread over the dish. Any two lines that
 * would still cross trade dots until none do.
 */
export function recipeDeskLeaders(tabs: readonly RecipeDeskTab[], plate: RecipeDeskPlate, unit = 1): RecipeDeskLeader[] {
  const out = new Map<string, RecipeDeskLeader>()
  const U = unit > 0 ? unit : 1
  const radius = plate.size * RECIPE_DESK.rim
  for (const side of ['left', 'right'] as const) {
    const column = tabs.filter(tab => tab.side === side).sort((a, b) => a.y - b.y)
    if (!column.length) continue
    const toward = side === 'left' ? 1 : -1
    const inner = side === 'left' ? Math.max(...column.map(tab => tab.edge)) : Math.min(...column.map(tab => tab.edge))
    const kink = inner + toward * RECIPE_DESK.stub * U
    const dots = new Map<string, RecipeDeskPoint>()

    const rim = column.filter(tab => tab.into === 'rim')
    {
      // Both shapes are square: the plate a little inside its box (its shadow needs the room), the
      // picture card filling it. A section tab ends on the near edge, level with where it stands;
      // a column taller than the edge is squeezed onto it, in order.
      const half = plate.shape === 'plate' ? radius : plate.size / 2
      const span = plate.shape === 'plate' ? radius * 0.9 : plate.size * 0.47
      const reach = Math.max(1, ...rim.map(tab => Math.abs(tab.y - plate.cy)))
      const squeeze = Math.min(1, (span * 0.94) / reach)
      const ys = spread(rim.map(tab => plate.cy + squeeze * (tab.y - plate.cy)), 6 * U, plate.cy - span, plate.cy + span)
      rim.forEach((tab, at) => dots.set(tab.id, { x: plate.cx - toward * half, y: ys[at] }))
    }

    const face = column.filter(tab => tab.into === 'face')
    if (face.length) {
      const well = plate.size * RECIPE_DESK.well
      const reach = Math.max(1, ...face.map(tab => Math.abs(tab.y - plate.cy)))
      const squeeze = Math.min(1, (plate.size * RECIPE_DESK.face) / reach)
      face.forEach((tab, at) => {
        const dy = squeeze * (tab.y - plate.cy)
        // The face is square: every row of it is as wide as the next.
        const chord = well
        // Beside the invitation a dot keeps to the labels' side of the plate; elsewhere it may reach across.
        const beside = plate.clear === true && Math.abs(dy) < plate.size * 0.16
        const [near, far] = beside ? [0.92, 0.66] : [0.72, -0.55]
        const depth = far + (near - far) * ((0.5 + at * GOLDEN) % 1)
        dots.set(tab.id, { x: plate.cx - toward * depth * chord, y: plate.cy + dy })
      })
    }

    // Two lines that cross trade dots: the pair is shorter afterwards, so this ends.
    const start = (tab: RecipeDeskTab): RecipeDeskPoint => ({ x: kink, y: tab.y })
    for (let pass = 0; pass < column.length * column.length; pass++) {
      let traded = false
      for (let i = 0; i < column.length; i++) {
        for (let j = i + 1; j < column.length; j++) {
          const a = column[i]
          const b = column[j]
          if (a.into !== b.into) continue
          const da = dots.get(a.id) as RecipeDeskPoint
          const db = dots.get(b.id) as RecipeDeskPoint
          if (!segmentsCross([start(a), da], [start(b), db])) continue
          dots.set(a.id, db)
          dots.set(b.id, da)
          traded = true
        }
      }
      if (!traded) break
    }

    for (const tab of column) {
      const dot = dots.get(tab.id) as RecipeDeskPoint
      const from = { x: tab.edge, y: tab.y }
      const level = Math.abs(dot.y - tab.y) < 1
      out.set(tab.id, { id: tab.id, points: level ? [from, dot] : [from, start(tab), dot], dot })
    }
  }
  return tabs.flatMap(tab => { const leader = out.get(tab.id); return leader ? [leader] : [] })
}

// ── a table set ─────────────────────────────────────────────────────────────

/**
 * Which plate each part sits on: the template's sections in order, the first
 * on the first plate and so on. A section beyond the plates, and a value the
 * template has no section for, keeps its tab and sits on no plate.
 */
export function recipeDeskPlatesOf(parts: readonly Pick<RecipeDeskPart, 'kept'>[], plates: number): (number | undefined)[] {
  let next = 0
  return parts.map(part => (part.kept || next >= plates ? undefined : next++))
}

export interface RecipeDeskSetPart extends RecipeDeskPart {
  /** Where its plate's floor centre is, as shares of the set's width and height. Absent: a tab with no plate. */
  readonly plate?: RecipeDeskPoint
}

/**
 * Which side of the set each part sits on, and on which row. A part on a plate
 * sits on its plate's side, the parts of a side top to bottom as their plates
 * are, so the leaders fan out rather than cross. Then the parts on no plate,
 * in reading order, each on the shorter side, and last the values the
 * template has no section for, together after their divider. A side that is
 * full (`capacity` rows) gives way to the other while the other has room.
 */
export function recipeDeskSetSeats(parts: readonly RecipeDeskSetPart[], capacity = Number.POSITIVE_INFINITY): RecipeDeskSeating {
  const rows = { left: 0, right: 0 }
  const seats: RecipeDeskSeat[] = []
  const firstKept = parts.findIndex(part => part.kept)
  const height = (at: number): number => 1 + (parts[at].callouts ?? 0) + (at === firstKept ? 1 : 0)
  const other = (side: Side): Side => (side === 'left' ? 'right' : 'left')
  const fits = (side: Side, at: number): boolean => rows[side] + height(at) <= capacity
  const choose = (want: Side, at: number): Side => (fits(want, at) || !fits(other(want), at) ? want : other(want))
  const shorter = (): Side => (rows.left <= rows.right ? 'left' : 'right')
  const sit = (at: number, side: Side): void => {
    const divider = at === firstKept ? rows[side]++ : undefined
    seats[at] = { key: parts[at].key, side, row: rows[side], ...(divider !== undefined ? { divider } : {}) }
    rows[side] += 1 + (parts[at].callouts ?? 0)
  }
  const plated = parts
    .map((part, at) => ({ part, at }))
    .filter(({ part }) => part.plate && !part.kept)
    .sort((a, b) => (a.part.plate as RecipeDeskPoint).y - (b.part.plate as RecipeDeskPoint).y || a.at - b.at)
  for (const { part, at } of plated) sit(at, choose((part.plate as RecipeDeskPoint).x < 0.5 ? 'left' : 'right', at))
  parts.forEach((part, at) => { if (!part.plate && !part.kept) sit(at, choose(shorter(), at)) })
  // The values the template has no section for stay together under their one divider.
  let keptSide: Side | null = null
  parts.forEach((part, at) => {
    if (!part.kept) return
    keptSide = choose(keptSide ?? shorter(), at)
    sit(at, keptSide)
  })
  return { seats, rows }
}

/**
 * Points spread over a plate's floor for the ingredients' dots, in the
 * picture's own px: `n` of them, top to bottom across the far half of the
 * floor (the near half holds the place card), wandering
 * left and right so they cover the dish rather than line up, and laid through
 * the floor's own perspective so the far ones sit closer together, as the
 * plate does.
 */
export function recipeDeskFloorSpread(floor: RecipeSettingFloor, n: number): RecipeDeskPoint[] {
  const count = Math.max(0, Math.floor(n))
  const out: RecipeDeskPoint[] = []
  for (let at = 0; at < count; at++) {
    const [u0, u1] = RECIPE_DESK.spread.u
    const [v0, v1] = RECIPE_DESK.spread.v
    const u = u0 + (u1 - u0) * ((0.5 + at * GOLDEN) % 1)
    const v = count === 1 ? (v0 + v1) / 2 : v0 + ((v1 - v0) * at) / (count - 1)
    const point = recipeFloorAt(floor, u, v)
    if (point) out.push({ x: point[0], y: point[1] })
  }
  return out
}

/** A tab on a set, and the point its leader ends on: its plate's floor centre, or one of the points spread over the ingredients' plate. */
export interface RecipeDeskSetTab extends RecipeDeskTab {
  readonly to: RecipeDeskPoint
}

/**
 * The leaders of a set. Each tab leaves on a level run toward the set and then
 * goes straight to its point. A section's point is its plate's and never
 * moves; ingredients' points are interchangeable, so two of their lines that
 * would cross trade points until none do, as on the drawn plate.
 */
export function recipeDeskSetLeaders(tabs: readonly RecipeDeskSetTab[], unit = 1): RecipeDeskLeader[] {
  const out = new Map<string, RecipeDeskLeader>()
  const U = unit > 0 ? unit : 1
  for (const side of ['left', 'right'] as const) {
    const column = tabs.filter(tab => tab.side === side).sort((a, b) => a.y - b.y)
    if (!column.length) continue
    const toward = side === 'left' ? 1 : -1
    const inner = side === 'left' ? Math.max(...column.map(tab => tab.edge)) : Math.min(...column.map(tab => tab.edge))
    const kink = inner + toward * RECIPE_DESK.stub * U
    const dots = new Map<string, RecipeDeskPoint>(column.map(tab => [tab.id, tab.to]))
    const start = (tab: RecipeDeskTab): RecipeDeskPoint => ({ x: kink, y: tab.y })
    const face = column.filter(tab => tab.into === 'face')
    // Two lines that cross trade points: the pair is shorter afterwards, so this ends.
    for (let pass = 0; pass < face.length * face.length; pass++) {
      let traded = false
      for (let i = 0; i < face.length; i++) {
        for (let j = i + 1; j < face.length; j++) {
          const a = face[i]
          const b = face[j]
          const da = dots.get(a.id) as RecipeDeskPoint
          const db = dots.get(b.id) as RecipeDeskPoint
          if (!segmentsCross([start(a), da], [start(b), db])) continue
          dots.set(a.id, db)
          dots.set(b.id, da)
          traded = true
        }
      }
      if (!traded) break
    }
    for (const tab of column) {
      const dot = dots.get(tab.id) as RecipeDeskPoint
      const from = { x: tab.edge, y: tab.y }
      const level = Math.abs(dot.y - tab.y) < 1
      out.set(tab.id, { id: tab.id, points: level ? [from, dot] : [from, start(tab), dot], dot })
    }
  }
  return tabs.flatMap(tab => { const leader = out.get(tab.id); return leader ? [leader] : [] })
}
