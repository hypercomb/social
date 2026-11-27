// recipe/recipe-desk.spec.ts
import { describe, expect, it } from 'vitest'
import {
  RECIPE_DESK,
  recipeDeskCallouts,
  recipeDeskCrossings,
  recipeDeskFit,
  recipeDeskFloorSpread,
  recipeDeskLeaders,
  recipeDeskPlatesOf,
  recipeDeskSeats,
  recipeDeskSetLeaders,
  recipeDeskSetSeats,
  recipeLinkIsVideo,
  recipeSectionSummary,
  type RecipeDeskLeader,
  type RecipeDeskPlate,
  type RecipeDeskSetTab,
  type RecipeDeskTab,
} from './recipe-desk.js'
import { recipeFloorHolds, recipeFloorInset, recipeReadingFloor, type RecipeSettingFloor, type RecipeSettingPoint } from './recipe-setting.js'
import type { RecipeValue } from './recipe-template.js'

const say = (_key: string, fallback: string, params?: Record<string, string | number>): string =>
  fallback.replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? ''))
const SIG = 'a'.repeat(64)

describe('recipeLinkIsVideo', () => {
  it('knows the three video hosts and nothing else', () => {
    expect(recipeLinkIsVideo('https://www.youtube.com/watch?v=abc')).toBe(true)
    expect(recipeLinkIsVideo('https://youtu.be/abc')).toBe(true)
    expect(recipeLinkIsVideo('https://player.vimeo.com/video/1')).toBe(true)
    expect(recipeLinkIsVideo('https://example.org/youtube.com')).toBe(false)
    expect(recipeLinkIsVideo('https://notyoutube.com/watch')).toBe(false)
    expect(recipeLinkIsVideo('javascript:alert(1)')).toBe(false)
    expect(recipeLinkIsVideo('')).toBe(false)
  })
})

describe('recipeSectionSummary', () => {
  const said = (value: RecipeValue): string => recipeSectionSummary(value, say)

  it('says the first words of a text, whole when it is short', () => {
    expect(said({ kind: 'text', text: 'A dry cider.' })).toBe('A dry cider.')
    expect(said({ kind: 'text', text: '  Two\n lines   of it ' })).toBe('Two lines of it')
    const long = said({ kind: 'text', text: 'My grandmother made this on Sundays, in a pot far too big for the stove.' })
    expect(long).toBe('My grandmother made this on Sundays, in a pot…')
    expect(long.length).toBeLessThanOrEqual(49)
    expect(said({ kind: 'text', text: 'x'.repeat(200) })).toBe(`${'x'.repeat(48)}…`)
  })

  it('says the facts side by side: a bare number keeps its label', () => {
    expect(said({ kind: 'facts', facts: [{ label: 'Serves', value: '6' }, { label: 'Time', value: '1 hour' }] })).toBe('Serves 6 · 1 hour')
    expect(said({ kind: 'facts', facts: [{ label: 'From', value: 'Lyon' }] })).toBe('Lyon')
    expect(said({ kind: 'facts', facts: [{ label: 'Makes', value: '2-3' }, { label: 'Cups', value: '1 ½' }] })).toBe('Makes 2-3 · Cups 1 ½')
  })

  it('counts steps and adds up their minutes', () => {
    expect(said({ kind: 'steps', steps: [{ text: 'a', minutes: 10 }, { text: 'b', minutes: 15 }, { text: 'c' }] })).toBe('3 steps · 25 min')
    expect(said({ kind: 'steps', steps: [{ text: 'a' }] })).toBe('1 step')
    expect(said({ kind: 'steps', steps: [{ text: 'a', minutes: 60 }, { text: 'b', minutes: 60 }] })).toBe('2 steps · 2 h')
    expect(said({ kind: 'steps', steps: [{ text: 'a', minutes: 45 }, { text: 'b', minutes: 35 }] })).toBe('2 steps · 1 h 20 min')
  })

  it('counts links and videos apart', () => {
    const video = { url: 'https://youtu.be/abc' }
    const page = { url: 'https://example.org/soup' }
    expect(said({ kind: 'links', links: [page, page, video] })).toBe('2 links, 1 video')
    expect(said({ kind: 'links', links: [page] })).toBe('1 link')
    expect(said({ kind: 'links', links: [video, video] })).toBe('2 videos')
  })

  it('counts pictures and ingredients', () => {
    expect(said({ kind: 'pictures', pictures: [SIG, 'b'.repeat(64), 'c'.repeat(64)] })).toBe('3 pictures')
    expect(said({ kind: 'pictures', pictures: [SIG] })).toBe('1 picture')
    expect(said({ kind: 'ingredients', items: [{ item: 'salt' }] })).toBe('1 ingredient')
    expect(said({ kind: 'ingredients', items: [{ item: 'salt' }, { item: 'water' }] })).toBe('2 ingredients')
  })

  it('says the word for none of anything empty', () => {
    const empty: RecipeValue[] = [
      { kind: 'text', text: '  \n ' }, { kind: 'ingredients', items: [] }, { kind: 'steps', steps: [] },
      { kind: 'pictures', pictures: [] }, { kind: 'links', links: [] }, { kind: 'facts', facts: [] },
    ]
    for (const value of empty) expect(said(value), value.kind).toBe('none')
  })

  it('uses the words its caller gives, and the English when a catalogue echoes the key', () => {
    const words = (key: string, fallback: string, params?: Record<string, string | number>): string =>
      key === 'recipe.summary.none' ? 'rien' : key === 'recipe.summary.steps.other' ? key : say(key, fallback, params)
    expect(recipeSectionSummary({ kind: 'links', links: [] }, words)).toBe('rien')
    expect(recipeSectionSummary({ kind: 'steps', steps: [{ text: 'a' }, { text: 'b' }] }, words)).toBe('2 steps')
  })
})

describe('recipeDeskCallouts', () => {
  const items = (n: number) => Array.from({ length: n }, (_, at) => ({ ...(at % 2 ? {} : { amount: `${at + 1} g` }), item: `thing ${at}` }))

  it('draws every ingredient up to the cap, and one more', () => {
    expect(recipeDeskCallouts([])).toEqual({ shown: [], more: 0 })
    const few = recipeDeskCallouts(items(3))
    expect(few.shown).toEqual([{ at: 0, amount: '1 g', item: 'thing 0' }, { at: 1, amount: '', item: 'thing 1' }, { at: 2, amount: '3 g', item: 'thing 2' }])
    expect(few.more).toBe(0)
    expect(recipeDeskCallouts(items(RECIPE_DESK.callouts)).shown).toHaveLength(RECIPE_DESK.callouts)
    const oneOver = recipeDeskCallouts(items(RECIPE_DESK.callouts + 1))
    expect(oneOver.shown).toHaveLength(RECIPE_DESK.callouts + 1)
    expect(oneOver.more).toBe(0)
  })

  it('counts the rest past that', () => {
    const many = recipeDeskCallouts(items(13))
    expect(many.shown).toHaveLength(9)
    expect(many.shown[8].at).toBe(8)
    expect(many.more).toBe(4)
    expect(recipeDeskCallouts(items(13), 4)).toMatchObject({ more: 9 })
    expect(recipeDeskCallouts(items(200)).more).toBe(191)
  })
})

describe('recipeDeskSeats', () => {
  const plain = (...keys: string[]) => keys.map(key => ({ key }))

  it('shares plain tabs between the sides in reading order, the first half on the left', () => {
    const { seats, rows } = recipeDeskSeats(plain('a', 'b', 'c', 'd', 'e'))
    expect(seats.map(seat => `${seat.key}:${seat.side}:${seat.row}`)).toEqual(['a:left:0', 'b:left:1', 'c:left:2', 'd:right:0', 'e:right:1'])
    expect(rows).toEqual({ left: 3, right: 2 })
    expect(recipeDeskSeats(plain('only')).seats).toEqual([{ key: 'only', side: 'left', row: 0 }])
    expect(recipeDeskSeats([])).toEqual({ seats: [], rows: { left: 0, right: 0 } })
  })

  it('gives an ingredients section a side of its own, its labels under its heading', () => {
    const parts = [{ key: 'story' }, { key: 'facts' }, { key: 'ingredients', callouts: 6 }, { key: 'steps' }, { key: 'links' }]
    const { seats, rows } = recipeDeskSeats(parts)
    expect(seats.find(seat => seat.key === 'ingredients')).toEqual({ key: 'ingredients', side: 'right', row: 0 })
    expect(seats.filter(seat => seat.side === 'left').map(seat => seat.key)).toEqual(['story', 'facts', 'steps', 'links'])
    expect(seats.filter(seat => seat.side === 'left').map(seat => seat.row)).toEqual([0, 1, 2, 3])
    expect(rows).toEqual({ left: 4, right: 7 })
    // With nothing in it yet it still keeps its side: tabs never jump across when the first ingredient is typed.
    const empty = recipeDeskSeats(parts.map(part => (part.key === 'ingredients' ? { key: part.key, callouts: 0 } : part)))
    expect(empty.seats.map(seat => seat.side)).toEqual(seats.map(seat => seat.side))
    expect(recipeDeskSeats(parts, undefined, 'left').seats.find(seat => seat.key === 'ingredients')?.side).toBe('left')
  })

  it('moves the last plain tabs under the labels only when their own side is full', () => {
    const parts = [{ key: 'i', callouts: 2 }, ...plain('a', 'b', 'c', 'd', 'e')]
    const { seats, rows } = recipeDeskSeats(parts, 4)
    expect(seats.map(seat => `${seat.key}:${seat.side}:${seat.row}`)).toEqual(['i:right:0', 'a:left:0', 'b:left:1', 'c:left:2', 'd:left:3', 'e:right:3'])
    expect(rows).toEqual({ left: 4, right: 4 })
    // When neither side has room the tab stays with its own: the desk turns narrow instead.
    expect(recipeDeskSeats(parts, 3).rows.left).toBeGreaterThan(3)
  })

  it('seats a second ingredients section under the first', () => {
    const { seats } = recipeDeskSeats([{ key: 'dough', callouts: 3 }, { key: 'x' }, { key: 'filling', callouts: 2 }])
    expect(seats).toEqual([{ key: 'dough', side: 'right', row: 0 }, { key: 'x', side: 'left', row: 0 }, { key: 'filling', side: 'right', row: 4 }])
  })

  it('puts one divider before the first kept part, and seats two parts of one key apart', () => {
    const { seats, rows } = recipeDeskSeats([{ key: 'story' }, { key: 'i', callouts: 1 }, { key: 'story', kept: true }, { key: 'zest', kept: true }])
    expect(seats).toEqual([
      { key: 'story', side: 'left', row: 0 },
      { key: 'i', side: 'right', row: 0 },
      { key: 'story', side: 'left', row: 2, divider: 1 },
      { key: 'zest', side: 'left', row: 3 },
    ])
    expect(rows).toEqual({ left: 4, right: 2 })
  })
})

describe('recipeDeskFit', () => {
  it('draws the plate at its cap on a wide desk, with the full list', () => {
    const fit = recipeDeskFit({ width: 1326, height: 712, em: 16, list: true })
    expect(fit).toMatchObject({ layout: 'wide', list: 'full', plate: RECIPE_DESK.plateMax, compact: false })
    expect(fit.capacity).toBe(17)
  })

  it('lets the list give ground, then the plate, then turns narrow', () => {
    expect(recipeDeskFit({ width: 1200, height: 712, em: 16, list: true })).toMatchObject({ layout: 'wide', list: 'mid', plate: 440 })
    const slim = recipeDeskFit({ width: 920, height: 712, em: 16, list: true })
    expect(slim).toMatchObject({ layout: 'wide', list: 'faces', compact: true })
    expect(slim.plate).toBeLessThan(440)
    expect(slim.plate).toBeGreaterThanOrEqual(RECIPE_DESK.plateMin)
    expect(recipeDeskFit({ width: 880, height: 712, em: 16, list: true }).layout).toBe('narrow')
    // The same width with no list has the room.
    expect(recipeDeskFit({ width: 900, height: 712, em: 16 }).layout).toBe('wide')
  })

  it('is narrow when the plate would be under its least, however wide the desk', () => {
    const short = recipeDeskFit({ width: 1400, height: 380, em: 16 })
    expect(short.layout).toBe('narrow')
    expect(recipeDeskFit({ width: 1400, height: 430, em: 16 })).toMatchObject({ layout: 'wide', plate: 326 })
  })

  it('sizes the narrow plate from about a third of the height, inside its limits', () => {
    expect(recipeDeskFit({ width: 390, height: 700, em: 16 })).toMatchObject({ layout: 'narrow', plate: 210 })
    expect(recipeDeskFit({ width: 390, height: 1200, em: 16 }).plate).toBe(RECIPE_DESK.narrowMax)
    expect(recipeDeskFit({ width: 240, height: 300, em: 16 }).plate).toBe(RECIPE_DESK.narrowMin)
  })

  it('turns narrow sooner under larger text, and scales the plate with it', () => {
    expect(recipeDeskFit({ width: 1100, height: 760, em: 16 }).layout).toBe('wide')
    expect(recipeDeskFit({ width: 1100, height: 760, em: 22 }).layout).toBe('narrow')
    expect(recipeDeskFit({ width: 2400, height: 1400, em: 24 })).toMatchObject({ layout: 'wide', plate: 660 })
    // A text size nobody can have reads as the usual one.
    expect(recipeDeskFit({ width: 1326, height: 712, em: 0 }).plate).toBe(440)
  })

  it('turns narrow when a column holds more rows than the height has', () => {
    const room = { width: 1326, height: 712, em: 16 }
    const { capacity } = recipeDeskFit(room)
    expect(recipeDeskFit({ ...room, rows: capacity }).layout).toBe('wide')
    expect(recipeDeskFit({ ...room, rows: capacity + 1 }).layout).toBe('narrow')
  })

  it('a narrow desk turns wide only with room to spare, and a wide one stays wide down to the threshold', () => {
    const spare = RECIPE_DESK.spareEm * 16
    // The plate is at its least at this height: 320 and the 6.5em kept clear of it.
    const least = RECIPE_DESK.plateMin + RECIPE_DESK.chromeEm * 16
    const tall = (height: number, was?: 'wide' | 'narrow') => recipeDeskFit({ width: 1400, height, em: 16, ...(was ? { was } : {}) }).layout
    expect(tall(least)).toBe('wide')
    expect(tall(least, 'wide')).toBe('wide')
    expect(tall(least - 1, 'wide')).toBe('narrow')
    expect(tall(least, 'narrow')).toBe('narrow')
    expect(tall(least + spare - 1, 'narrow')).toBe('narrow')
    expect(tall(least + spare, 'narrow')).toBe('wide')

    // The same at the width where wide stops.
    const slim = RECIPE_DESK.wideEm * 16
    const across = (width: number, was?: 'wide' | 'narrow') => recipeDeskFit({ width, height: 712, em: 16, ...(was ? { was } : {}) }).layout
    expect(across(slim, 'wide')).toBe('wide')
    expect(across(slim - 1, 'wide')).toBe('narrow')
    expect(across(slim, 'narrow')).toBe('narrow')
    expect(across(slim + spare, 'narrow')).toBe('wide')

    // And at the last row a column holds.
    const room = { width: 1326, height: 712, em: 16 }
    const { capacity } = recipeDeskFit(room)
    expect(recipeDeskFit({ ...room, rows: capacity, was: 'wide' }).layout).toBe('wide')
    expect(recipeDeskFit({ ...room, rows: capacity, was: 'narrow' }).layout).toBe('wide')
    // 708 holds the same 17 rows with 15px left over: less than the em a narrow desk wants to spare.
    expect(recipeDeskFit({ ...room, height: 708, rows: capacity, was: 'narrow' }).layout).toBe('narrow')
    expect(recipeDeskFit({ ...room, height: 708, rows: capacity, was: 'wide' }).layout).toBe('wide')
  })

  it('answers the same sizes whatever the desk was: only the turn asks for room to spare', () => {
    for (const room of [{ width: 1326, height: 712, em: 16, list: true }, { width: 920, height: 500, em: 16 }, { width: 390, height: 700, em: 16 }]) {
      const plain = recipeDeskFit(room)
      for (const was of ['wide', 'narrow'] as const) {
        const held = recipeDeskFit({ ...room, was })
        if (held.layout === plain.layout) expect(held).toEqual(plain)
        expect({ list: held.list, capacity: held.capacity }).toEqual({ list: plain.list, capacity: plain.capacity })
      }
    }
  })
})

describe('recipeDeskLeaders', () => {
  const PLATE: RecipeDeskPlate = { cx: 500, cy: 350, size: 440, shape: 'plate' }
  const CARD: RecipeDeskPlate = { cx: 500, cy: 350, size: 440, shape: 'card' }
  const PITCH = 38.4

  /** A column of n tabs centred on the plate, as the stage lays them out. */
  const column = (n: number, side: 'left' | 'right', into: 'rim' | 'face', pitch = PITCH, shift = 0): RecipeDeskTab[] =>
    Array.from({ length: n }, (_, at) => ({
      id: `${side}-${into}-${at}`,
      side,
      into,
      edge: side === 'left' ? 224 : 776,
      y: 350 + shift + (at - (n - 1) / 2) * pitch,
    }))
  const dotOf = (leaders: readonly RecipeDeskLeader[], id: string) => leaders.find(leader => leader.id === id)!.dot

  it.each(Array.from({ length: 12 }, (_, at) => at + 1))('lays %i tabs a side on the rim without a crossing', n => {
    const tabs = [...column(n, 'left', 'rim'), ...column(n, 'right', 'rim')]
    const leaders = recipeDeskLeaders(tabs, PLATE)
    expect(leaders).toHaveLength(tabs.length)
    expect(recipeDeskCrossings(leaders)).toBe(0)
    for (const leader of leaders) {
      // Every dot is ON the square plate's near edge, within the height of that edge.
      const edge = PLATE.size * RECIPE_DESK.rim
      expect(leader.dot.x).toBeCloseTo(leader.id.startsWith('left') ? PLATE.cx - edge : PLATE.cx + edge, 6)
      expect(Math.abs(leader.dot.y - PLATE.cy)).toBeLessThanOrEqual(edge)
      expect(leader.points[leader.points.length - 1]).toEqual(leader.dot)
    }
    for (const side of ['left', 'right']) {
      // Top to bottom on the rim in the order the tabs stand, and never on top of one another.
      const ys = Array.from({ length: n }, (_, at) => dotOf(leaders, `${side}-rim-${at}`).y)
      for (let at = 1; at < n; at++) expect(ys[at] - ys[at - 1], `${side} ${at}`).toBeGreaterThan(4)
    }
  })

  it.each(Array.from({ length: 12 }, (_, at) => at + 1))('points %i ingredient labels into the dish without a crossing', n => {
    for (const side of ['left', 'right'] as const) {
      for (const plate of [PLATE, CARD, { ...PLATE, clear: true }]) {
        const leaders = recipeDeskLeaders(column(n, side, 'face'), plate)
        expect(leaders).toHaveLength(n)
        expect(recipeDeskCrossings(leaders), `${side} ${plate.shape}`).toBe(0)
        // Every dot is on the plate's square face, inside the lip.
        for (const leader of leaders) {
          expect(Math.abs(leader.dot.x - plate.cx), leader.id).toBeLessThanOrEqual(plate.size * RECIPE_DESK.well + 1e-6)
          expect(Math.abs(leader.dot.y - plate.cy), leader.id).toBeLessThanOrEqual(plate.size * RECIPE_DESK.well + 1e-6)
        }
      }
    }
  })

  it('spreads the ingredients over the face, not along one line', () => {
    const leaders = recipeDeskLeaders(column(7, 'right', 'face'), PLATE)
    const xs = leaders.map(leader => leader.dot.x)
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(PLATE.size * 0.25)
    expect(new Set(leaders.map(leader => Math.round(leader.dot.y))).size).toBe(7)
    // Some reach across the middle of the dish, some stay on the labels' side.
    expect(xs.some(x => x < PLATE.cx)).toBe(true)
    expect(xs.some(x => x > PLATE.cx)).toBe(true)
  })

  it('keeps the dots off the invitation in the middle of an empty plate', () => {
    const leaders = recipeDeskLeaders(column(5, 'right', 'face'), { ...PLATE, clear: true })
    for (const leader of leaders) {
      const beside = Math.abs(leader.dot.y - PLATE.cy) < PLATE.size * 0.16
      if (beside) expect(leader.dot.x - PLATE.cx, leader.id).toBeGreaterThan(PLATE.size * 0.18)
    }
  })

  it('ends section tabs on the edge of a picture card, level with where they stand', () => {
    const leaders = recipeDeskLeaders([...column(6, 'left', 'rim'), ...column(1, 'right', 'rim')], CARD)
    expect(recipeDeskCrossings(leaders)).toBe(0)
    for (const leader of leaders) {
      expect(leader.dot.x).toBe(leader.id.startsWith('left') ? CARD.cx - CARD.size / 2 : CARD.cx + CARD.size / 2)
      expect(Math.abs(leader.dot.y - CARD.cy)).toBeLessThanOrEqual(CARD.size / 2)
    }
    // A tab level with its dot runs straight: two points, no kink.
    expect(leaders.find(leader => leader.id === 'right-rim-0')?.points).toHaveLength(2)
    // A column taller than the card is squeezed onto its edge, in order.
    const tall = recipeDeskLeaders(column(12, 'left', 'rim', 60), CARD)
    expect(recipeDeskCrossings(tall)).toBe(0)
    for (const leader of tall) expect(Math.abs(leader.dot.y - CARD.cy)).toBeLessThanOrEqual(CARD.size / 2)
  })

  it('runs straight to a square plate where it can, and leaves on a level run where it must turn', () => {
    // A tab level with the plate's edge needs no turn: two points.
    const [level] = recipeDeskLeaders([{ id: 'a', side: 'left', into: 'rim', edge: 224, y: 250 }], PLATE, 1.5)
    expect(level.points).toEqual([{ x: 224, y: 250 }, level.dot])
    expect(level.dot.y).toBe(250)
    // A tab standing above the plate leaves level, then turns down to the edge.
    const [high] = recipeDeskLeaders([{ id: 'b', side: 'left', into: 'rim', edge: 224, y: 40 }], PLATE, 1.5)
    expect(high.points).toHaveLength(3)
    expect(high.points[0]).toEqual({ x: 224, y: 40 })
    expect(high.points[1]).toEqual({ x: 224 + RECIPE_DESK.stub * 1.5, y: 40 })
    expect(high.dot.y).toBeGreaterThan(40)
  })

  it('keeps a mixed side in order: labels, then the tabs moved under them', () => {
    const tabs: RecipeDeskTab[] = [
      ...column(6, 'right', 'face', PITCH, -80),
      { id: 'under-1', side: 'right', into: 'rim', edge: 776, y: 540 },
      { id: 'under-2', side: 'right', into: 'rim', edge: 776, y: 578 },
      ...column(8, 'left', 'rim'),
    ]
    const leaders = recipeDeskLeaders(tabs, PLATE)
    expect(leaders.map(leader => leader.id)).toEqual(tabs.map(tab => tab.id))
    expect(recipeDeskCrossings(leaders)).toBe(0)
  })

  it('stays off-centre columns without a crossing, wherever the stage puts them', () => {
    for (const shift of [-160, -60, 90, 200]) {
      for (const pitch of [28, 38.4, 52]) {
        const tabs = [...column(9, 'left', 'rim', pitch, shift), ...column(10, 'right', 'face', pitch, -shift)]
        expect(recipeDeskCrossings(recipeDeskLeaders(tabs, PLATE)), `${shift} ${pitch}`).toBe(0)
        expect(recipeDeskCrossings(recipeDeskLeaders(tabs, CARD)), `card ${shift} ${pitch}`).toBe(0)
      }
    }
  })

  it('answers numbers for a desk that has no size yet', () => {
    const leaders = recipeDeskLeaders([...column(3, 'left', 'rim', 0), ...column(2, 'right', 'face', 0)], { cx: 0, cy: 0, size: 0, shape: 'plate' })
    expect(leaders).toHaveLength(5)
    for (const leader of leaders) for (const point of leader.points) {
      expect(Number.isFinite(point.x) && Number.isFinite(point.y), leader.id).toBe(true)
    }
    expect(recipeDeskLeaders([], PLATE)).toEqual([])
  })
})

describe('recipeDeskCrossings', () => {
  it('counts the crossings between different leaders only', () => {
    const line = (id: string, ...points: [number, number][]): RecipeDeskLeader => {
      const all = points.map(([x, y]) => ({ x, y }))
      return { id, points: all, dot: all[all.length - 1] }
    }
    expect(recipeDeskCrossings([line('a', [0, 0], [10, 10]), line('b', [0, 10], [10, 0])])).toBe(1)
    expect(recipeDeskCrossings([line('a', [0, 0], [10, 0]), line('b', [0, 5], [10, 5])])).toBe(0)
    // Two lines that only meet at an end do not cross, and a line never crosses itself.
    expect(recipeDeskCrossings([line('a', [0, 0], [10, 10]), line('b', [10, 10], [20, 0])])).toBe(0)
    expect(recipeDeskCrossings([line('a', [0, 0], [10, 10], [0, 10], [10, 0])])).toBe(0)
  })
})

// ── on a table set ──────────────────────────────────────────────────────────

/** The four plates of the set rendered on 2026-11-25 (tableware/setting.py's setting.json), as the desk reads them. */
const SET_SIZE = [1800, 1200] as const
const SET_PLATES: readonly { id: string; floor: RecipeSettingFloor; centre: RecipeSettingPoint }[] = [
  { id: 'ash', floor: recipeReadingFloor([[646.1, 206.4], [1007.1, 438.0], [1139.0, 306.0], [781.5, 87.6]]), centre: [889.7, 255.6] },
  { id: 'shino', floor: recipeReadingFloor([[1159.2, 616.7], [1632.5, 759.1], [1673.1, 612.0], [1212.9, 478.2]]), centre: [1416.3, 614.3] },
  { id: 'kuro', floor: recipeReadingFloor([[211.8, 402.0], [498.6, 685.8], [641.1, 581.7], [351.8, 310.1]]), centre: [422.1, 490.1] },
  { id: 'tenmoku', floor: recipeReadingFloor([[727.1, 778.6], [1042.2, 1143.0], [1215.8, 1016.0], [895.9, 668.8]]), centre: [965.5, 894.4] },
]
const share = (at: RecipeSettingPoint): { x: number; y: number } => ({ x: at[0] / SET_SIZE[0], y: at[1] / SET_SIZE[1] })

describe('recipeDeskFit on a table set', () => {
  it('fits the set where the plate was, at its own aspect, capped as a photograph is', () => {
    const fit = recipeDeskFit({ width: 1400, height: 712, em: 16, aspect: 1.5 })
    expect(fit).toMatchObject({ layout: 'wide', figure: { width: RECIPE_DESK.setMax, height: 507 }, plate: 507 })
    // The plate is still the plate: a square.
    expect(recipeDeskFit({ width: 1326, height: 712, em: 16, list: true }).figure).toEqual({ width: 440, height: 440 })
  })

  it('gives the columns their room first, and is wide only while the set is at least as wide as the least plate', () => {
    const slim = recipeDeskFit({ width: 920, height: 712, em: 16, list: true, aspect: 1.5 })
    expect(slim).toMatchObject({ layout: 'wide', list: 'faces', compact: true })
    expect(slim.figure.width).toBe(397)
    expect(slim.figure.height).toBe(Math.round(397 / 1.5))
    // Short: the height caps the set, and a set narrower than the least plate turns the desk narrow.
    expect(recipeDeskFit({ width: 1400, height: 340, em: 16, aspect: 1.5 }).figure).toEqual({ width: 354, height: 236 })
    expect(recipeDeskFit({ width: 1400, height: 300, em: 16, aspect: 1.5 }).layout).toBe('narrow')
  })

  it('on a phone, shows the set at full width inside its gutters, leaving the tabs room under it', () => {
    const phone = recipeDeskFit({ width: 390, height: 700, em: 16, aspect: 1.5 })
    expect(phone).toMatchObject({ layout: 'narrow', figure: { width: 357, height: 238 }, plate: 238 })
    expect(phone.figure.width).toBeLessThanOrEqual(390 - 32)
    const low = recipeDeskFit({ width: 800, height: 380, em: 16, aspect: 1.5 })
    expect(low).toMatchObject({ layout: 'narrow', figure: { width: 256, height: 171 } })
  })

  it('an aspect that is no shape is the plate', () => {
    for (const aspect of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(recipeDeskFit({ width: 1326, height: 712, em: 16, aspect }).figure).toEqual({ width: 440, height: 440 })
    }
  })
})

describe('recipeDeskPlatesOf', () => {
  it('sits the template\'s sections on the plates in order; the rest, and what the template has no section for, sit on none', () => {
    expect(recipeDeskPlatesOf([{}, {}, { kept: true }, {}, {}], 3)).toEqual([0, 1, undefined, 2, undefined])
    expect(recipeDeskPlatesOf([{}, {}], 4)).toEqual([0, 1])
    expect(recipeDeskPlatesOf([{}], 0)).toEqual([undefined])
  })
})

describe('recipeDeskSetSeats', () => {
  const plated = (key: string, plate: number, extra: { callouts?: number } = {}) => ({ key, plate: share(SET_PLATES[plate].centre), ...extra })

  it('seats each section on its plate\'s side, top to bottom as the plates are, then the rest on the shorter side, the kept last together', () => {
    const { seats, rows } = recipeDeskSetSeats([
      plated('story', 0), plated('facts', 1), plated('ingredients', 2), plated('steps', 3),
      { key: 'links' }, { key: 'old-notes', kept: true }, { key: 'older', kept: true },
    ])
    expect(seats.map(seat => [seat.key, seat.side, seat.row, seat.divider])).toEqual([
      ['story', 'left', 0, undefined],
      ['facts', 'right', 0, undefined],
      ['ingredients', 'left', 1, undefined],
      ['steps', 'right', 1, undefined],
      ['links', 'left', 2, undefined],
      ['old-notes', 'right', 3, 2],
      ['older', 'right', 4, undefined],
    ])
    expect(rows).toEqual({ left: 3, right: 5 })
  })

  it('stacks an ingredients section\'s labels under it on its plate\'s side, and a full side gives way to the other', () => {
    const { seats } = recipeDeskSetSeats([plated('ingredients', 2, { callouts: 4 }), plated('story', 0)])
    // The ash plate is higher in the picture, so its tab is first on the left; the labels follow the ingredients' heading.
    expect(seats.map(seat => [seat.key, seat.side, seat.row])).toEqual([['ingredients', 'left', 1], ['story', 'left', 0]])
    const full = recipeDeskSetSeats([plated('story', 0), plated('ingredients', 2, { callouts: 4 })], 5)
    expect(full.seats.map(seat => seat.side)).toEqual(['left', 'right'])
  })
})

describe('recipeDeskFloorSpread', () => {
  it('spreads the ingredients\' points over the far half of their plate\'s floor, clear of the place card', () => {
    for (const { floor } of SET_PLATES) {
      const points = recipeDeskFloorSpread(floor, 9)
      expect(points).toHaveLength(9)
      const far = recipeFloorInset(floor, 0, 0, 1, 0.5) as RecipeSettingFloor
      for (const point of points) expect(recipeFloorHolds(far, [point.x, point.y])).toBe(true)
      // No two land on one another.
      const keys = new Set(points.map(point => `${Math.round(point.x)},${Math.round(point.y)}`))
      expect(keys.size).toBe(9)
    }
    expect(recipeDeskFloorSpread(SET_PLATES[0].floor, 0)).toEqual([])
    expect(recipeDeskFloorSpread(SET_PLATES[0].floor, 1)).toHaveLength(1)
  })
})

describe('recipeDeskSetLeaders', () => {
  /** The set drawn at 0.5, its top-left corner at (300, 40) on the stage; tabs either side of it. */
  const at = (p: RecipeSettingPoint | { x: number; y: number }): { x: number; y: number } =>
    Array.isArray(p) ? { x: 300 + p[0] * 0.5, y: 40 + p[1] * 0.5 } : { x: 300 + (p as { x: number }).x * 0.5, y: 40 + (p as { y: number }).y * 0.5 }

  it('runs each section\'s tab to its plate\'s floor centre, level first, and never moves it', () => {
    const tabs: RecipeDeskSetTab[] = [
      { id: 'story', side: 'left', into: 'rim', edge: 260, y: 100, to: at(SET_PLATES[0].centre) },
      { id: 'steps', side: 'left', into: 'rim', edge: 250, y: 180, to: at(SET_PLATES[2].centre) },
      { id: 'facts', side: 'right', into: 'rim', edge: 1260, y: 330, to: at(SET_PLATES[1].centre) },
    ]
    const leaders = recipeDeskSetLeaders(tabs)
    expect(leaders.map(leader => leader.id)).toEqual(['story', 'steps', 'facts'])
    leaders.forEach((leader, n) => {
      expect(leader.dot).toEqual(tabs[n].to)
      expect(leader.points[0]).toEqual({ x: tabs[n].edge, y: tabs[n].y })
    })
    // The level run leaves the column at its innermost edge, one stub toward the set.
    expect(leaders[0].points[1]).toEqual({ x: 260 + RECIPE_DESK.stub, y: 100 })
    expect(leaders[1].points[1]).toEqual({ x: 260 + RECIPE_DESK.stub, y: 180 })
    expect(leaders[2].points[1]).toEqual({ x: 1260 - RECIPE_DESK.stub, y: 330 })
  })

  it('lets the ingredients trade points until none of their lines cross, every point still one of theirs', () => {
    const points = recipeDeskFloorSpread(SET_PLATES[2].floor, 6).map(at)
    // Handed over in the worst order: the lowest label to the highest point.
    const tabs: RecipeDeskSetTab[] = points.map((to, n) => ({ id: `p0#${n}`, side: 'left', into: 'face', edge: 260, y: 120 + 30 * n, to: points[points.length - 1 - n] }))
    const leaders = recipeDeskSetLeaders(tabs)
    expect(recipeDeskCrossings(leaders)).toBe(0)
    expect(leaders.map(leader => `${leader.dot.x},${leader.dot.y}`).sort()).toEqual(points.map(point => `${point.x},${point.y}`).sort())
    expect(recipeDeskSetLeaders([])).toEqual([])
  })
})
