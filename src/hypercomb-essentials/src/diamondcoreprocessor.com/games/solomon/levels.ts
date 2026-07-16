// diamondcoreprocessor.com/games/solomon/levels.ts
//
// Built-in rooms (authored as readable ASCII) + the participant-local store for
// designer-made levels. The built-ins recreate the FEEL and content of the NES
// original's opening rooms across the first three zodiac "shrines" — a safe
// tutorial, the demon-mirror room, a turret/flyer vault, constellation panels
// that open a fairy bonus room, gargoyle climbs, ghost corridors, spark cells,
// a dragon lair, a gauntlet, and Solomon's Gate before the ending. (Tecmo's
// exact block maps are screenshots, not data, so geometry is authored to make
// each room's documented solution work, with faithful item placements.)
//
// Custom levels live in localStorage — participant-local UI data, NOT layer
// state (a level in the layer would skew the lineage signature across peers).

import {
  EMPTY, WALL, BRICK, LIFE_FULL, LIFE_HALF,
  type LevelDef, type Cell, type EnemySpawn, type EnemyKind,
  type ItemSpawn, type ItemKind, type MirrorSpawn, type MirrorKind,
} from './engine.js'

const STORE_KEY = 'hc:solomon-levels'

// ASCII legend (one char per cell):
//   '#' grey WALL · 'B' orange BRICK · '.'/' ' EMPTY · 'P' player · 'D' door
//   items:  K key · b bell · j jewel(500) · J jewel(5000) · $ treasure(2000) ·
//           f jar · F super-jar · / scroll · t hourglass · u half-hourglass ·
//           + extra life · @ Solomon's Seal · Z constellation panel · W Golden Wings
//   foes:   g goblin · r gargoil · a dragon · s saramandor · h ghost ·
//           l neul · k sparkball · o demonhead · n panel monster
//   mirrors: M demonhead mirror · m saramandor mirror
const CHAR_TILE: Record<string, number> = { '#': WALL, 'B': BRICK }
const CHAR_ENEMY: Record<string, EnemyKind> = {
  g: 'goblin', r: 'gargoil', a: 'dragon', s: 'saramandor', h: 'ghost',
  l: 'neul', k: 'sparkball', o: 'demonhead', n: 'panel',
}
const CHAR_ITEM: Record<string, { kind: ItemKind; value?: number }> = {
  K: { kind: 'key' },
  b: { kind: 'bell' },
  j: { kind: 'jewel', value: 500 },
  J: { kind: 'jewel', value: 5000 },
  $: { kind: 'treasure', value: 2000 },
  f: { kind: 'jar' },
  F: { kind: 'superjar' },
  '/': { kind: 'scroll' },
  t: { kind: 'hourglass' },
  u: { kind: 'hourglassHalf' },
  '+': { kind: 'life' },
  '@': { kind: 'seal' },
  Z: { kind: 'zodiac' },
  W: { kind: 'wings' },
  T: { kind: 'pageTime' },
  Y: { kind: 'pageSpace' },
  R: { kind: 'princess' },
}

interface AsciiOpts { hidden?: ItemSpawn[]; lifeStart?: number }

/** Parse an ASCII room. Entity glyphs leave their cell EMPTY and record a
 *  placement; rows are padded / truncated to `cols`. Enemies face inward. */
export function fromAscii(name: string, art: string[], opts: AsciiOpts = {}): LevelDef {
  const rows = art.length
  const cols = art.reduce((m, r) => Math.max(m, r.length), 0)
  const tiles = new Array<number>(rows * cols).fill(EMPTY)
  let player: Cell = { col: 1, row: rows - 2 }
  let door: Cell = { col: cols - 2, row: rows - 2 }
  const items: ItemSpawn[] = []
  const enemies: EnemySpawn[] = []
  const mirrors: MirrorSpawn[] = []
  const inward = (c: number): 1 | -1 => (c < cols / 2 ? 1 : -1)

  for (let r = 0; r < rows; r++) {
    const line = art[r]
    for (let c = 0; c < cols; c++) {
      const ch = line[c] ?? '.'
      const i = r * cols + c
      if (ch === 'P') { player = { col: c, row: r }; continue }
      if (ch === 'D') { door = { col: c, row: r }; continue }
      if (ch === 'M') { mirrors.push({ col: c, row: r, kind: 'demonhead' }); continue }
      if (ch === 'm') { mirrors.push({ col: c, row: r, kind: 'saramandor' }); continue }
      const en = CHAR_ENEMY[ch]
      if (en) { enemies.push({ col: c, row: r, kind: en, dir: inward(c) }); continue }
      const it = CHAR_ITEM[ch]
      if (it) { items.push({ col: c, row: r, kind: it.kind, value: it.value }); continue }
      tiles[i] = CHAR_TILE[ch] ?? EMPTY
    }
  }

  for (const h of opts.hidden ?? []) {
    items.push({ ...h, hidden: true })
    const i = h.row * cols + h.col
    if (tiles[i] === EMPTY) tiles[i] = BRICK
  }

  return { name, cols, rows, tiles, player, door, enemies, items, mirrors, lifeStart: opts.lifeStart }
}

/** A large, scrolling, IRREGULAR cavern — bigger than the screen and not a box
 *  (unlike Solomon's Key's fixed single rooms). A wavy rock rim gives an organic
 *  outline; ledges climb toward the key; a guaranteed 2-tall ground corridor keeps
 *  the player + door connected. `kind` picks horizontal vs vertical scroll. Math.sin
 *  keeps it deterministic (stable every load). Dana's wand makes anything reachable. */
function largeCave(name: string, cols: number, rows: number, kind: 'wide' | 'tall', roster: Roster = {}): LevelDef {
  const tiles = new Array<number>(cols * rows).fill(EMPTY)
  const set = (c: number, r: number, v: number) => { if (c >= 0 && c < cols && r >= 0 && r < rows) tiles[r * cols + c] = v }
  const anchors: Cell[] = []
  const plat = (c: number, r: number, len: number) => {
    for (let i = 0; i < len; i++) set(c + i, r, BRICK)
    for (let i = 0; i < len; i += 2) anchors.push({ col: c + i, row: r - 1 })
  }

  // wavy rock rim (1..3 tiles) → an organic, non-rectangular cave silhouette
  for (let c = 0; c < cols; c++) {
    const top = 1 + Math.round((Math.sin(c * 0.55) + 1) * 1.1)
    const bot = 1 + Math.round((Math.sin(c * 0.43 + 2.1) + 1) * 0.7)
    for (let t = 0; t < top; t++) set(c, t, WALL)
    for (let b = 0; b < bot; b++) set(c, rows - 1 - b, WALL)
  }
  for (let r = 0; r < rows; r++) {
    const lft = 1 + Math.round((Math.sin(r * 0.6) + 1) * 0.9)
    const rgt = 1 + Math.round((Math.sin(r * 0.5 + 1.3) + 1) * 0.9)
    for (let t = 0; t < lft; t++) set(t, r, WALL)
    for (let b = 0; b < rgt; b++) set(cols - 1 - b, r, WALL)
  }

  const floor = rows - 2
  for (let c = 1; c < cols - 1; c++) { set(c, floor, EMPTY); set(c, floor - 1, EMPTY); set(c, rows - 1, WALL) }

  let key: Cell
  if (kind === 'wide') {
    for (let c = 5; c < cols - 5; c += 5) plat(c, floor - 2 - ((c / 5) % 3), 3) // stepping ledges
    key = { col: (cols >> 1) - 1, row: Math.max(3, floor - 6) }
    plat(key.col - 1, key.row + 1, 4)
  } else {
    let left = true
    for (let r = floor - 2; r > 3; r -= 3) { plat(left ? 3 : cols - 7, r, 4); left = !left } // zigzag climb
    key = { col: (cols >> 1) - 1, row: 2 }
    plat(key.col - 1, key.row + 1, 4)
  }

  const extraItems: ItemSpawn[] = []
  const alcoves = carveAlcoves(roster.alcoves ?? 0, cols, set, [key.col, cols - 3, 2])
  extraItems.push(...alcoves.items)
  if (roster.passage) extraItems.push(...carvePassage(cols, floor, set))

  return populate({
    name, cols, rows, tiles, floor, anchors, niches: [], key,
    alcoveCols: alcoves.cols, extraItems, roster,
    defaultLife: kind === 'tall' ? 16000 : 12000,
  })
}

// The room archetypes. Each shapes the interior architecture of a large room; the
// foes / mirrors / items are then scattered onto the ledges that architecture made.
type RoomKind = 'cavern' | 'tower' | 'gallery' | 'throne' | 'depths'

/** A room's contents, scattered onto the generated ledges (so one compact call
 *  describes a whole large room). `items` ride the upper ledges; `hidden` items
 *  are buried in brick at precise cells; `secret` items sit invisible in EMPTY cells
 *  and are found only by waving the wand over them; `foes` split by behaviour
 *  (walkers on the floor, panels in wall slots, flyers in mid-air). */
interface Roster {
  foes?: Partial<Record<EnemyKind, number>>
  mirrors?: Partial<Record<MirrorKind, number>>
  items?: ItemKind[]
  hidden?: ItemSpawn[]
  secret?: ItemSpawn[]
  /** Wand-secrets auto-placed at generator-chosen "interesting" spots (ledge
   *  ends, near the door, mid-floor marks) — no hand-picked cells needed. */
  secretItems?: ItemKind[]
  /** Brick-sealed attic caches carved into the top rim: a visible locked
   *  treasure + a bonus hidden inside the seal brick itself. */
  alcoves?: number
  /** A brick-capped side-rim tunnel with treasure inside. */
  passage?: boolean
  /** Visual theme for the renderer's bakes (per-shrine identity). */
  theme?: string
  lifeStart?: number
}

const WALKER_KINDS = new Set<EnemyKind>(['goblin', 'gargoil', 'dragon', 'saramandor'])

type SetTile = (c: number, r: number, v: number) => void

/** Carve `n` brick-sealed attic caches into the top rim. Each is a 2-wide,
 *  1-tall pocket under a stone cap with a BRICK floor as the sealed entrance —
 *  you can SEE the treasure locked inside (the desire line), then build up and
 *  break in; one entrance brick hides a further jar (the multi-tier find). */
function carveAlcoves(n: number, cols: number, set: SetTile, avoid: number[]): { cols: number[]; items: ItemSpawn[] } {
  const out: number[] = []
  const items: ItemSpawn[] = []
  for (let i = 0; i < n; i++) {
    let c = Math.max(3, Math.min(cols - 6, 4 + i * 9))
    while (avoid.some(a => Math.abs(a - c) < 2) || out.some(o => Math.abs(o - c) < 4)) c += 2
    if (c > cols - 6) break
    set(c - 1, 1, WALL); set(c - 1, 2, WALL)         // side walls
    set(c + 2, 1, WALL); set(c + 2, 2, WALL)
    set(c, 1, WALL); set(c + 1, 1, WALL)             // stone cap
    set(c, 2, EMPTY); set(c + 1, 2, EMPTY)           // the pocket
    set(c, 3, BRICK); set(c + 1, 3, BRICK)           // the sealed brick entrance
    items.push({ col: c, row: 2, kind: 'treasure', value: 2000 })
    items.push({ col: c + 1, row: 3, kind: 'jar', hidden: true })
    out.push(c)
  }
  return { cols: out, items }
}

/** Carve a brick-capped dead-end tunnel into the right rim at floor−4 —
 *  treasure waits mid-tunnel behind a single sealed brick. */
function carvePassage(cols: number, floor: number, set: SetTile): ItemSpawn[] {
  const pr = floor - 4
  for (const pc of [cols - 4, cols - 3, cols - 2]) {
    set(pc, pr, EMPTY)
    set(pc, pr - 1, WALL)
    set(pc, pr + 1, WALL)
  }
  set(cols - 5, pr, BRICK)   // the cap
  return [{ col: cols - 3, row: pr, kind: 'treasure', value: 5000 }]
}

/** The shared scatter tail used by BOTH generators: turns a carved room + a
 *  Roster into a finished LevelDef (allocators, secrets, safety net). */
function populate(ctx: {
  name: string; cols: number; rows: number; tiles: number[]
  floor: number; anchors: Cell[]; niches: Cell[]; key: Cell
  alcoveCols: number[]; extraItems: ItemSpawn[]
  roster: Roster; defaultLife: number
}): LevelDef {
  const { name, cols, rows, tiles, floor, anchors, niches, key, roster } = ctx
  const inB = (c: number, r: number) => c >= 0 && c < cols && r >= 0 && r < rows
  const set: SetTile = (c, r, v) => { if (inB(c, r)) tiles[r * cols + c] = v }
  const solid = (c: number, r: number) => { const t = inB(c, r) ? tiles[r * cols + c] : WALL; return t === WALL || t === BRICK }
  const mid = cols >> 1

  // Open floor only, with a generous SAFE ZONE in front of the player's start
  // (col 2): the nearest walker spawns no closer than col 11.
  const floorSpots: Cell[] = []
  for (let c = 11; c < cols - 4; c += 3) if (!solid(c, floor)) floorSpots.push({ col: c, row: floor })

  const enemies: EnemySpawn[] = []
  const items: ItemSpawn[] = []
  const mirrors: MirrorSpawn[] = []
  const player: Cell = { col: 2, row: floor }
  const door: Cell = { col: cols - 3, row: floor }

  // sequential allocators so scattered things spread out (the key anchor is reserved)
  const high = anchors.filter(a => !(a.col === key.col && a.row === key.row))
  // Flyers keep clear of the start screen — anchors past the safe zone only.
  const flyHigh = high.filter(a => a.col >= 11)
  let hp = 0, fp = 0, gp = 0
  const nextFloor = (): Cell => floorSpots.length ? floorSpots[fp++ % floorSpots.length] : { col: mid, row: floor }
  const nextHigh = (): Cell => high.length ? high[hp++ % high.length] : nextFloor()
  const nextFly = (): Cell => flyHigh.length ? flyHigh[gp++ % flyHigh.length] : { col: Math.max(11, mid), row: 4 }

  items.push({ col: key.col, row: key.row, kind: 'key' })
  for (const k of roster.items ?? []) {
    const a = nextHigh()
    items.push({ col: a.col, row: a.row, kind: k, value: k === 'jewel' ? 2000 : k === 'treasure' ? 5000 : undefined })
  }
  items.push(...ctx.extraItems)   // alcove + passage stock

  for (const [k, n] of Object.entries(roster.foes ?? {}) as [EnemyKind, number][]) {
    for (let j = 0; j < n; j++) {
      let pos: Cell
      // Panel turrets sit in a wall niche if the kind made one; otherwise mid-room.
      if (k === 'panel') pos = niches.length ? niches[j % niches.length] : { col: Math.min(cols - 4, Math.round(cols * 0.55) + j * 5), row: Math.max(3, floor - 5) }
      else if (WALKER_KINDS.has(k)) pos = nextFloor()
      else { const a = nextFly(); pos = { col: a.col, row: Math.max(3, a.row - 2) } }   // flyers
      enemies.push({ col: pos.col, row: pos.row, kind: k, dir: pos.col < mid ? 1 : -1 })
    }
  }

  let mc = 0
  for (const [k, n] of Object.entries(roster.mirrors ?? {}) as [MirrorKind, number][]) {
    for (let j = 0; j < n; j++) { mirrors.push({ col: 4 + ((mc * 2 + 1) * 5) % Math.max(1, cols - 8), row: 3, kind: k }); mc++ }
  }

  for (const h of roster.hidden ?? []) { items.push({ ...h, hidden: true }); if (inB(h.col, h.row) && tiles[h.row * cols + h.col] === EMPTY) set(h.col, h.row, BRICK) }
  // Secrets sit invisible in an EMPTY cell (clear any brick so the wand can reach them).
  for (const sc of roster.secret ?? []) { items.push({ ...sc, hidden: true, secret: true }); if (inB(sc.col, sc.row) && tiles[sc.row * cols + sc.col] === BRICK) set(sc.col, sc.row, EMPTY) }

  // Auto-placed wand-secrets: deterministic "interesting" spots — beside the
  // first alcove (the twinkle leads the eye to the sealed cache), two shy of
  // the door, the quarter-marks of the floor, and above every second anchor.
  const spots: Cell[] = []
  if (ctx.alcoveCols.length) spots.push({ col: ctx.alcoveCols[0] - 2, row: floor })
  spots.push({ col: door.col - 2, row: floor })
  for (const f of [0.25, 0.5, 0.75]) spots.push({ col: Math.max(3, Math.round(cols * f)), row: floor })
  anchors.forEach((a, i) => { if (i % 2 === 0) spots.push({ col: a.col, row: a.row - 1 }) })
  const taken = new Set(items.map(i => `${i.col},${i.row}`))
  taken.add(`${player.col},${player.row}`).add(`${door.col},${door.row}`)
  const good = spots.filter(s => inB(s.col, s.row) && tiles[s.row * cols + s.col] === EMPTY && !taken.has(`${s.col},${s.row}`))
  let sp = 0
  for (const k of roster.secretItems ?? []) {
    while (sp < good.length && taken.has(`${good[sp].col},${good[sp].row}`)) sp++
    const s = sp < good.length ? good[sp] : { col: Math.max(3, mid - 2), row: floor }
    taken.add(`${s.col},${s.row}`)
    items.push({ col: s.col, row: s.row, kind: k, hidden: true, secret: true, value: k === 'jewel' ? 2000 : k === 'treasure' ? 5000 : undefined })
  }

  // Safety net: key supported + cleared, singletons clear, nothing embedded in stone.
  if (!solid(key.col, key.row + 1)) { for (let i = 0; i < 3; i++) set(key.col - 1 + i, key.row + 1, BRICK) }
  set(key.col, key.row, EMPTY)
  for (const e of enemies) set(e.col, e.row, EMPTY)
  for (const m of mirrors) set(m.col, m.row, EMPTY)
  for (const it of items) if (!it.hidden) set(it.col, it.row, EMPTY)
  set(player.col, player.row, EMPTY); set(player.col, player.row - 1, EMPTY); set(player.col, rows - 1, WALL)
  set(door.col, door.row, EMPTY); set(door.col, door.row - 1, EMPTY); set(door.col, rows - 1, WALL)

  return { name, cols, rows, tiles, player, door, enemies, items, mirrors, theme: roster.theme, lifeStart: roster.lifeStart ?? ctx.defaultLife }
}

/** THE room generator. Every cavern is now a large, smooth-scrolling, NON-square
 *  warm-stone castle chamber — this is the Zelda-style replacement for Solomon's
 *  Key's fixed single-screen squares. Because the room is bigger than the viewport,
 *  the camera always follows Dana. A wavy rock rim gives an organic outline; `kind`
 *  shapes the interior (open cavern · vertical tower · colonnade gallery · throne
 *  dais · broken-floor vault); the `roster` is scattered onto the ledges that
 *  architecture made. Deterministic (Math.sin, no RNG); a clear 2-tall ground
 *  corridor, an always-grounded key, and Dana's wand keep every room solvable. */
function bigRoom(name: string, cols: number, rows: number, kind: RoomKind, roster: Roster = {}): LevelDef {
  const tiles = new Array<number>(cols * rows).fill(EMPTY)
  const inB = (c: number, r: number) => c >= 0 && c < cols && r >= 0 && r < rows
  const set = (c: number, r: number, v: number) => { if (inB(c, r)) tiles[r * cols + c] = v }
  const plat = (c: number, r: number, len: number, v = BRICK) => { for (let i = 0; i < len; i++) set(c + i, r, v) }
  const column = (c: number, r0: number, r1: number, v = WALL) => { for (let r = r0; r <= r1; r++) set(c, r, v) }
  const solid = (c: number, r: number) => { const t = inB(c, r) ? tiles[r * cols + c] : WALL; return t === WALL || t === BRICK }

  // irregular warm-rock rim → a non-square silhouette
  for (let c = 0; c < cols; c++) {
    const top = 1 + Math.round((Math.sin(c * 0.5) + 1) * 1.0)
    const bot = 1 + Math.round((Math.sin(c * 0.4 + 2.1) + 1) * 0.55)
    for (let t = 0; t < top; t++) set(c, t, WALL)
    for (let b = 0; b < bot; b++) set(c, rows - 1 - b, WALL)
  }
  for (let r = 0; r < rows; r++) {
    const lft = 1 + Math.round((Math.sin(r * 0.55) + 1) * 0.9)
    const rgt = 1 + Math.round((Math.sin(r * 0.48 + 1.3) + 1) * 0.9)
    for (let t = 0; t < lft; t++) set(t, r, WALL)
    for (let b = 0; b < rgt; b++) set(cols - 1 - b, r, WALL)
  }

  const floor = rows - 2
  const mid = cols >> 1
  for (let c = 1; c < cols - 1; c++) { set(c, floor, EMPTY); set(c, floor - 1, EMPTY); set(c, rows - 1, WALL) }

  const anchors: Cell[] = []   // EMPTY standing cells sitting on a platform top
  const niches: Cell[] = []    // wall slots for panel turrets
  const ledge = (c: number, r: number, len: number) => { plat(c, r, len); for (let i = 0; i < len; i += 2) if (inB(c + i, r - 1)) anchors.push({ col: c + i, row: r - 1 }) }
  let key: Cell = { col: mid, row: 3 }

  switch (kind) {
    case 'cavern': {
      // sparse shelves at staggered heights across an open cave
      for (let i = 0; i < 6; i++) {
        const c = 4 + Math.round((i / 5) * (cols - 10))
        const r = floor - 3 - (i % 3) * 3 - (i % 2)
        ledge(Math.max(2, Math.min(cols - 6, c)), Math.max(3, r), 4)
      }
      if (anchors.length) key = { ...anchors[anchors.length >> 1] }
      break
    }
    case 'tower': {
      // zigzag battlement ledges with arrow-slit turret slots in the side walls
      let left = true
      for (let r = floor - 2; r > 3; r -= 3) { ledge(left ? 3 : cols - 8, r, 5); left = !left }
      niches.push({ col: 2, row: floor - 7 }, { col: cols - 3, row: floor - 13 })
      key = { col: mid, row: 3 }
      break
    }
    case 'gallery': {
      // a long colonnade: a broken upper gallery over hanging columns (they stop
      // above head height, so the floor stays a walkable arcade)
      const gal = 3
      for (let c = 3; c < cols - 3; c++) if (c % 7 < 5) set(c, gal, BRICK)
      for (let c = 5; c < cols - 4; c += 6) { column(c, gal + 1, floor - 3, WALL); ledge(c - 1, floor - 4, 3) }
      for (let c = 4; c < cols - 4; c += 5) if (solid(c, gal) && !solid(c, gal - 1)) anchors.push({ col: c, row: gal - 1 })
      plat(mid - 1, gal, 3, BRICK)
      key = { col: mid, row: gal - 1 }
      break
    }
    case 'throne': {
      // a grand hall around a stepped throne dais (the key crowns it), flanked by
      // colonnade pillars
      for (let h = 0; h < 5; h++) plat(mid - (4 - h), floor - h, (4 - h) * 2 + 1, WALL)
      for (const c of [6, cols - 7]) { column(c, 4, floor - 3, WALL); ledge(c - 1, floor - 4, 3) }
      key = { col: mid, row: floor - 6 }
      break
    }
    case 'depths': {
      // broken vault floors split the room into stacked chambers joined by gaps
      for (const fr of [Math.round(rows * 0.36), Math.round(rows * 0.63)]) {
        for (let c = 2; c < cols - 2; c++) if ((c + fr) % 6 > 1) set(c, fr, BRICK)
        for (let c = 3; c < cols - 3; c += 4) if (solid(c, fr) && !solid(c, fr - 1)) anchors.push({ col: c, row: fr - 1 })
      }
      ledge(3, 5, 4)
      key = { col: 4, row: 4 }
      break
    }
  }

  // Carved caches: brick-sealed attic alcoves + a capped side-rim passage.
  const extraItems: ItemSpawn[] = []
  const alcoves = carveAlcoves(roster.alcoves ?? 0, cols, set, [key.col, cols - 3, 2])
  extraItems.push(...alcoves.items)
  if (roster.passage) extraItems.push(...carvePassage(cols, floor, set))

  return populate({ name, cols, rows, tiles, floor, anchors, niches, key, alcoveCols: alcoves.cols, extraItems, roster, defaultLife: 13000 })
}

export const BUILTIN_LEVELS: LevelDef[] = [
  // GHOSTS 'N GOBLINS style: every room is ONE SCREEN TALL and scrolls only
  // HORIZONTALLY (no vertical scroll, so a jump never bobs the view). Each is a warm
  // castle hall built by bigRoom; foes, items, zodiac panels, seals, wings, pages and
  // hidden/secret rewards are scattered into a roomy `kind` of chamber.

  // ── Shrine of Aries — the telegraph tutorial ──
  // Awakening. Two goblins teach the chase + charge telegraph; a bell on a shelf, a
  // buried jar, a SECRET jewel at the twinkle, and the first sealed attic alcove.
  bigRoom('Awakening', 26, 14, 'cavern', { foes: { goblin: 2 }, items: ['bell'], hidden: [{ col: 8, row: 11, kind: 'jar' }], secret: [{ col: 13, row: 12, kind: 'jewel', value: 2000 }], secretItems: ['hourglassHalf'], alcoves: 1, lifeStart: 12000 }),

  // Hall of Mirrors. Two demon mirrors rain darting demonheads while a goblin prowls;
  // a super-jar buried low, a secret jewel, an attic cache.
  bigRoom('Hall of Mirrors', 28, 14, 'cavern', { foes: { goblin: 1 }, mirrors: { demonhead: 2 }, items: ['bell'], hidden: [{ col: 10, row: 11, kind: 'superjar' }], secretItems: ['jewel'], alcoves: 1, lifeStart: 13000 }),

  // The Vault. A broken-floor vault: panel turret, ghost, gargoil, goblin — an extra
  // Dana, buried jar + jewel, a SECRET treasure, and a capped rim passage.
  bigRoom('The Vault', 28, 14, 'depths', { foes: { panel: 1, ghost: 1, gargoil: 1, goblin: 1 }, items: ['life'], hidden: [{ col: 8, row: 11, kind: 'jar' }, { col: 18, row: 11, kind: 'jewel', value: 2000 }], secret: [{ col: 21, row: 12, kind: 'treasure', value: 5000 }], passage: true, lifeStart: 13000 }),

  // Sunken Gallery. The long colonnade — two ghosts sweep the arcade now, a goblin
  // hunts below; a SECRET 1-up, a secret bell, and an attic cache.
  bigRoom('Sunken Gallery', 34, 14, 'gallery', { foes: { gargoil: 2, ghost: 2, goblin: 1 }, items: ['hourglass', 'jewel', 'jewel', 'bell'], hidden: [{ col: 4, row: 11, kind: 'jar' }], secret: [{ col: 25, row: 12, kind: 'life' }], secretItems: ['bell'], alcoves: 1, lifeStart: 15000 }),

  // Constellation of Aries. The first ZODIAC PANEL — gargoils, goblins and a ghost
  // guard it; two buried bells and a secret one.
  bigRoom('Constellation', 28, 14, 'cavern', { foes: { gargoil: 2, goblin: 2, ghost: 1 }, items: ['zodiac'], hidden: [{ col: 6, row: 11, kind: 'bell' }, { col: 20, row: 11, kind: 'bell' }], secretItems: ['bell'], lifeStart: 13000 }),

  // ── Shrine of Taurus ──
  // Gargoyle Hall. Gargoils prowl the colonnade with a goblin brute among them; a
  // secret jewel + hourglass, and an attic cache.
  bigRoom('Gargoyle Hall', 28, 14, 'cavern', { foes: { gargoil: 4, goblin: 1 }, items: ['jewel', 'jewel'], hidden: [{ col: 10, row: 11, kind: 'bell' }], secretItems: ['jewel', 'hourglassHalf'], alcoves: 1, lifeStart: 14000 }),

  // Ghost Corridor. Ghosts sweep the gallery, a neul ambushes from above; the
  // super-jar clears a path, a secret jewel + a capped rim passage reward the brave.
  bigRoom('Ghost Corridor', 32, 14, 'gallery', { foes: { ghost: 4, neul: 1 }, items: ['superjar'], hidden: [{ col: 15, row: 11, kind: 'jewel', value: 2000 }], secretItems: ['jewel'], passage: true, lifeStart: 14000 }),

  // The Ramparts. Turret-lined gallery with two gargoils now and a goblin runner; a
  // secret 1-up and an attic cache.
  bigRoom('The Ramparts', 30, 14, 'gallery', { foes: { panel: 2, gargoil: 2, ghost: 1, goblin: 1 }, items: ['bell', 'treasure', 'hourglass'], hidden: [{ col: 5, row: 11, kind: 'jar' }], secretItems: ['life'], alcoves: 1, lifeStart: 16000 }),

  // Sky Hall. TWO neuls ambush from the heights over the GOLDEN WINGS; a goblin
  // patrols below. A Solomon's Seal on the way, a secret jewel, an attic cache.
  bigRoom('Sky Hall', 30, 14, 'cavern', { foes: { neul: 2, gargoil: 2, goblin: 1 }, items: ['wings', 'seal'], hidden: [{ col: 4, row: 11, kind: 'scroll' }], secretItems: ['jewel'], alcoves: 1, lifeStart: 16000 }),

  // Constellation of Taurus. Second ZODIAC PANEL — ghosts, gargoils, goblins and a
  // skirmishing saramandor; a secret treasure.
  bigRoom('Constellation II', 28, 14, 'cavern', { foes: { ghost: 2, gargoil: 2, goblin: 2, saramandor: 1 }, items: ['zodiac'], hidden: [{ col: 14, row: 11, kind: 'superjar' }], secretItems: ['treasure'], lifeStart: 13000 }),

  // ── Shrine of Gemini ──
  // Spark Cells. Sparkballs on their supercharge clockwork ricochet through the vault
  // while a goblin and a turret press; a Solomon's Seal, a SECRET jewel, an attic cache.
  bigRoom('Spark Cells', 28, 14, 'depths', { foes: { sparkball: 4, goblin: 1, panel: 1 }, items: ['seal'], hidden: [{ col: 20, row: 11, kind: 'scroll' }], secret: [{ col: 10, row: 12, kind: 'jewel', value: 3000 }], alcoves: 1, lifeStart: 14000 }),

  // Dragon's Lair. The ledge-refusing Dragon holds the throne hall, saramandors
  // hit-and-run, goblins charge; a secret hourglass + a capped rim passage.
  bigRoom("Dragon's Lair", 30, 14, 'throne', { foes: { dragon: 1, saramandor: 2, goblin: 2 }, items: ['jewel'], hidden: [{ col: 8, row: 11, kind: 'jar' }, { col: 21, row: 11, kind: 'jar' }], secretItems: ['hourglassHalf'], passage: true, lifeStart: 15000 }),

  // Throne Antechamber. The grand dais hall — a dragon, saramandors, extra gargoils
  // and a brooding demon mirror; a secret jewel, an attic cache.
  bigRoom('Throne Antechamber', 36, 14, 'throne', { foes: { dragon: 1, saramandor: 2, gargoil: 2 }, mirrors: { demonhead: 1 }, items: ['treasure', 'jewel', 'hourglass'], hidden: [{ col: 8, row: 11, kind: 'superjar' }], secretItems: ['jewel'], alcoves: 1, lifeStart: 16000 }),

  // The Gauntlet. The kitchen sink: mirror, turret, ghosts, sparkball, gargoils,
  // goblin and a neul — a Solomon's Seal, a secret super-jar, an attic cache.
  bigRoom('The Gauntlet', 30, 14, 'depths', { foes: { ghost: 1, sparkball: 1, gargoil: 2, goblin: 1, panel: 1, neul: 1 }, mirrors: { saramandor: 1 }, items: ['seal'], hidden: [{ col: 15, row: 11, kind: 'treasure', value: 5000 }], secretItems: ['superjar'], alcoves: 1, lifeStart: 15000 }),

  // Solomon's Gate. The third ZODIAC PANEL crowns the boss-storm — dragons, gargoils,
  // ghosts, skirmishers, two demon mirrors; a secret hourglass + a rim passage.
  bigRoom("Solomon's Gate", 34, 14, 'throne', { foes: { dragon: 2, gargoil: 2, ghost: 2, saramandor: 2 }, mirrors: { demonhead: 2 }, items: ['zodiac', 'hourglass'], hidden: [{ col: 9, row: 11, kind: 'superjar' }], secretItems: ['hourglass'], passage: true, lifeStart: 16000 }),

  // ── Shrine of Cancer — the road to the Princess ──
  // Tide Pools. Sparkballs, a neul and goblins harry the hall hiding the PAGE OF
  // SPACE; two secret jewels chain toward TWO attic caches.
  bigRoom('Tide Pools', 28, 14, 'cavern', { foes: { sparkball: 2, neul: 1, gargoil: 2, goblin: 2 }, hidden: [{ col: 6, row: 11, kind: 'pageSpace' }], secretItems: ['jewel', 'jewel'], alcoves: 2, lifeStart: 15000 }),

  // The Castle Depths. The grandest vault — and the FOURTH, secret-only Solomon's
  // Seal (the wand finds what the eye cannot). Passage + attic cache too.
  bigRoom('The Castle Depths', 28, 14, 'depths', { foes: { gargoil: 2, ghost: 2, neul: 1, sparkball: 1, goblin: 1 }, hidden: [{ col: 14, row: 11, kind: 'jewel', value: 3000 }], secret: [{ col: 9, row: 12, kind: 'treasure', value: 5000 }], secretItems: ['seal'], passage: true, alcoves: 1, lifeStart: 17000 }),

  // Crystal Cavern. The WIDE natural cave — now properly peopled: gargoils, a ghost,
  // a goblin and a sparkball; a secret jewel + an attic cache.
  largeCave('Crystal Cavern', 30, 13, 'wide', { foes: { gargoil: 2, ghost: 1, goblin: 1, sparkball: 1 }, secretItems: ['jewel'], alcoves: 1, lifeStart: 14000 }),

  // The Long March. The final trek — the PAGE OF TIME buried along the way; a
  // skirmisher, a neul ambusher and ghosts; a secret hourglass + a rim passage.
  largeCave('The Long March', 32, 13, 'wide', { foes: { gargoil: 2, ghost: 1, saramandor: 1, neul: 1 }, hidden: [{ col: 16, row: 10, kind: 'pageTime' }], secretItems: ['hourglassHalf'], passage: true, lifeStart: 15000 }),
]

// Per-shrine visual identity — the renderer bakes each chamber in its shrine's
// stone: Aries warm sandstone → Taurus mossy verdant → Gemini cold crystal →
// Cancer abyssal deep. (5 rooms per shrine; Cancer takes the remainder.)
const SHRINE_THEMES = ['sandstone', 'verdant', 'crystal', 'abyss'] as const
BUILTIN_LEVELS.forEach((l, i) => { l.theme = SHRINE_THEMES[Math.min(3, Math.floor(i / 5))] })

/** The fairy bonus room reached by clearing a room while holding a constellation
 *  panel — no enemies, the door is open from the start, a short timer, and a
 *  glade full of bells, fairies and treasure. */
export const BONUS_ROOM: LevelDef = fromAscii('Fairy Glade', [
  '##############################',
  '#..b.....b.....b.....b....b..#',
  '#............................#',
  '#....j.....j..$......j.......#',
  '#............................#',
  '#..b.......BBBBBBBB.......b..#',
  '#..........BBBBBBBB..........#',
  '#............................#',
  '#....j........b........j.....#',
  '#............................#',
  '#...b.........j..........b...#',
  '#............................#',
  '#.P........................D.#',
  '##############################',
], { lifeStart: LIFE_HALF })
BONUS_ROOM.theme = 'verdant'   // the fairy glade is green

/** The Princess Room — the destination of the true ending (reached when every
 *  Solomon's Seal has been collected). The caged fairy Princess waits on a high
 *  pedestal beside the exit; climb to her to rescue her. No foes, a calm timer. */
export const PRINCESS_ROOM: LevelDef = fromAscii('Princess Room', [
  '##########################',
  '#........................#',
  '#..........RD............#',
  '#.........BBBB...........#',
  '#........................#',
  '#.....b............b.....#',
  '#........................#',
  '#....j......j......j.....#',
  '#........................#',
  '#...b.......j......b.....#',
  '#........................#',
  '#........................#',
  '#.P......................#',
  '##########################',
])
PRINCESS_ROOM.theme = 'crystal'   // the throne of light

/** How many Solomon's Seals exist across the built-in game (all 3 needed for the
 *  best ending). */
export const SEAL_TOTAL = BUILTIN_LEVELS.reduce((n, l) => n + l.items.filter(i => i.kind === 'seal').length, 0)

// ── progression: where clearing a room sends you ─────────────

/** How many rooms the Golden Wings skip ahead. */
export const WARP_ROOMS = 3

export interface NextDecision {
  /** 'next' → play room `index`; 'bonus' → the fairy room, then resume `index`;
   *  'princess' → the Princess Room (true ending earned by all seals); 'ending' →
   *  the game is complete (the plain ending). */
  kind: 'next' | 'bonus' | 'princess' | 'ending'
  index: number
}

/** Pure decision: given the just-cleared room + flags, what plays next? Kept
 *  pure (no DOM) so the warp / bonus / princess / ending branches are
 *  unit-testable. Finishing the run with every seal opens the Princess Room. */
export function decideNext(p: {
  levelIndex: number
  builtinCount: number
  totalCount: number
  zodiacHeld: boolean
  wingsHeld: boolean
  allSeals: boolean
  inBonus: boolean
  bonusResumeIndex: number
}): NextDecision {
  const finish = (): NextDecision => ({ kind: p.allSeals ? 'princess' : 'ending', index: 0 })
  // Finishing the fairy bonus room → resume where the zodiac room left off.
  if (p.inBonus) {
    const idx = p.bonusResumeIndex
    if (idx >= p.builtinCount && p.totalCount === p.builtinCount) return finish()
    return { kind: 'next', index: idx % p.totalCount }
  }
  // Cleared holding a constellation panel → detour through the bonus room.
  if (p.zodiacHeld) return { kind: 'bonus', index: p.levelIndex + 1 }
  // Golden Wings warp ahead; otherwise the next room.
  const target = p.wingsHeld ? p.levelIndex + WARP_ROOMS : p.levelIndex + 1
  // Past the last built-in with no custom levels appended → the game is won.
  if (target >= p.builtinCount && p.totalCount === p.builtinCount) return finish()
  return { kind: 'next', index: target % p.totalCount }
}

// ── custom level store (localStorage) ────────────────────────

const MAX_DIM = 120
const MAX_ENTITIES = MAX_DIM * MAX_DIM
const ENEMY_KINDS = new Set<EnemyKind>(['goblin', 'gargoil', 'ghost', 'demonhead', 'dragon', 'panel', 'neul', 'saramandor', 'sparkball'])
const ITEM_KINDS = new Set<ItemKind>(['key', 'jewel', 'treasure', 'bell', 'jar', 'superjar', 'scroll', 'hourglass', 'hourglassHalf', 'fairy', 'life', 'seal', 'zodiac', 'wings', 'pageTime', 'pageSpace', 'princess'])
const MIRROR_KINDS = new Set(['demonhead', 'saramandor'])

const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n)

function asCell(v: unknown, cols: number, rows: number): Cell | null {
  if (!v || typeof v !== 'object') return null
  const { col, row } = v as Record<string, unknown>
  if (!isInt(col) || !isInt(row) || col < 0 || col >= cols || row < 0 || row >= rows) return null
  return { col, row }
}

/** Validate untrusted level JSON into a CLEAN LevelDef, or null. Accepts BOTH the
 *  current shape (items[]/typed enemies/mirrors) and the legacy shape (key + gems)
 *  so older saved levels still load. Held to the same limits as a pasted level. */
export function sanitizeLevel(raw: unknown): LevelDef | null {
  if (!raw || typeof raw !== 'object') return null
  const d = raw as Record<string, unknown>
  const cols = d['cols'], rows = d['rows']
  if (!isInt(cols) || !isInt(rows) || cols < 1 || rows < 1 || cols > MAX_DIM || rows > MAX_DIM) return null
  const n = cols * rows
  const tilesRaw = d['tiles']
  if (!Array.isArray(tilesRaw) || tilesRaw.length !== n) return null

  const player = asCell(d['player'], cols, rows)
  const door = asCell(d['door'], cols, rows)
  if (!player || !door) return null

  const items: ItemSpawn[] = []
  if (Array.isArray(d['items'])) {
    if (d['items'].length > MAX_ENTITIES) return null
    for (const raw of d['items']) {
      const c = asCell(raw, cols, rows); if (!c) return null
      const kind = (raw as ItemSpawn)?.kind
      if (!ITEM_KINDS.has(kind)) return null
      const value = (raw as ItemSpawn).value
      const secret = !!(raw as ItemSpawn).secret
      items.push({
        col: c.col, row: c.row, kind,
        hidden: !!(raw as ItemSpawn).hidden || secret,   // a secret is always hidden too
        secret: secret || undefined,
        value: isInt(value) ? value : undefined,
      })
    }
  } else {
    const key = d['key'] == null ? null : asCell(d['key'], cols, rows)
    if (d['key'] != null && !key) return null
    if (key) items.push({ col: key.col, row: key.row, kind: 'key' })
    const gemsRaw = Array.isArray(d['gems']) ? d['gems'] : []
    if (gemsRaw.length > MAX_ENTITIES) return null
    for (const g of gemsRaw) { const c = asCell(g, cols, rows); if (!c) return null; items.push({ col: c.col, row: c.row, kind: 'jewel', value: 500 }) }
  }

  const enemiesRaw = Array.isArray(d['enemies']) ? d['enemies'] : []
  if (enemiesRaw.length > MAX_ENTITIES) return null
  const enemies: EnemySpawn[] = []
  for (const e of enemiesRaw) {
    const c = asCell(e, cols, rows); if (!c) return null
    const kindRaw = (e as EnemySpawn)?.kind
    const kind: EnemyKind = ENEMY_KINDS.has(kindRaw as EnemyKind) ? (kindRaw as EnemyKind) : 'goblin'
    enemies.push({ col: c.col, row: c.row, kind, dir: (e as EnemySpawn)?.dir === -1 ? -1 : 1 })
  }

  const mirrorsRaw = Array.isArray(d['mirrors']) ? d['mirrors'] : []
  if (mirrorsRaw.length > MAX_ENTITIES) return null
  const mirrors: MirrorSpawn[] = []
  for (const m of mirrorsRaw) {
    const c = asCell(m, cols, rows); if (!c) return null
    const k = (m as MirrorSpawn)?.kind
    mirrors.push({ col: c.col, row: c.row, kind: MIRROR_KINDS.has(k as string) ? k : 'demonhead' })
  }

  const tiles = new Array<number>(n)
  for (let i = 0; i < n; i++) { const t = Number(tilesRaw[i]); tiles[i] = Number.isFinite(t) && t >= 0 && t <= 3 ? t : 0 }

  const lifeStart = d['lifeStart']
  const theme = d['theme']
  return {
    name: typeof d['name'] === 'string' ? d['name'].slice(0, 80) : 'Imported',
    cols, rows, tiles, player, door, enemies, items, mirrors,
    theme: theme === 'sandstone' || theme === 'verdant' || theme === 'crystal' || theme === 'abyss' ? theme : undefined,
    lifeStart: isInt(lifeStart) && lifeStart > 0 ? lifeStart : undefined,
  }
}

export function loadCustomLevels(): LevelDef[] {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr.map(sanitizeLevel).filter((l): l is LevelDef => l !== null)
  } catch { return [] }
}

export function saveCustomLevels(levels: LevelDef[]): void {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(levels)) } catch { /* quota / disabled */ }
}

export function upsertCustomLevel(level: LevelDef): LevelDef[] {
  const levels = loadCustomLevels()
  const i = levels.findIndex(l => l.name === level.name)
  if (i >= 0) levels[i] = level
  else levels.push(level)
  saveCustomLevels(levels)
  return levels
}

export function deleteCustomLevel(name: string): LevelDef[] {
  const levels = loadCustomLevels().filter(l => l.name !== name)
  saveCustomLevels(levels)
  return levels
}

export function cloneLevel(l: LevelDef): LevelDef {
  return {
    name: l.name, cols: l.cols, rows: l.rows,
    tiles: l.tiles.slice(),
    player: { ...l.player },
    door: { ...l.door },
    enemies: l.enemies.map(e => ({ ...e })),
    items: l.items.map(it => ({ ...it })),
    mirrors: l.mirrors.map(m => ({ ...m })),
    theme: l.theme,
    lifeStart: l.lifeStart,
  }
}

/** A blank canvas for the designer — walled border, floor, a spawn + door. */
export function emptyLevel(name: string, cols = 20, rows = 13): LevelDef {
  const tiles = new Array<number>(cols * rows).fill(EMPTY)
  for (let c = 0; c < cols; c++) { tiles[c] = WALL; tiles[(rows - 1) * cols + c] = WALL }
  for (let r = 0; r < rows; r++) { tiles[r * cols] = WALL; tiles[r * cols + cols - 1] = WALL }
  return {
    name, cols, rows, tiles,
    player: { col: 1, row: rows - 2 },
    door: { col: cols - 2, row: rows - 2 },
    enemies: [], items: [], mirrors: [], lifeStart: LIFE_FULL,
  }
}
