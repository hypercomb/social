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
function largeCave(name: string, cols: number, rows: number, kind: 'wide' | 'tall', hidden: ItemSpawn[] = []): LevelDef {
  const tiles = new Array<number>(cols * rows).fill(EMPTY)
  const set = (c: number, r: number, v: number) => { if (c >= 0 && c < cols && r >= 0 && r < rows) tiles[r * cols + c] = v }
  const plat = (c: number, r: number, len: number) => { for (let i = 0; i < len; i++) set(c + i, r, BRICK) }

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

  const enemies: EnemySpawn[] = []
  const items: ItemSpawn[] = []
  const player: Cell = { col: 2, row: floor }
  const door: Cell = { col: cols - 3, row: floor }
  let key: Cell

  if (kind === 'wide') {
    for (let c = 5; c < cols - 5; c += 5) plat(c, floor - 2 - ((c / 5) % 3), 3) // stepping ledges
    key = { col: (cols >> 1) - 1, row: Math.max(3, floor - 6) }
    plat(key.col - 1, key.row + 1, 4)
    enemies.push(
      { col: 7, row: floor, kind: 'gargoil', dir: 1 },
      { col: cols - 8, row: floor, kind: 'gargoil', dir: -1 },
      { col: cols >> 1, row: 5, kind: 'ghost', dir: 1 },
    )
  } else {
    let left = true
    for (let r = floor - 2; r > 3; r -= 3) { plat(left ? 3 : cols - 7, r, 4); left = !left } // zigzag climb
    key = { col: (cols >> 1) - 1, row: 2 }
    plat(key.col - 1, key.row + 1, 4)
    for (let r = floor - 4; r > 4; r -= 5) enemies.push({ col: cols >> 1, row: r, kind: r % 2 ? 'ghost' : 'gargoil', dir: 1 })
  }
  items.push({ col: key.col, row: key.row, kind: 'key' })

  for (const h of hidden) { items.push({ ...h, hidden: true }); if (tiles[h.row * cols + h.col] === EMPTY) set(h.col, h.row, BRICK) }

  // keep the singletons + key clear and grounded
  set(player.col, player.row, EMPTY); set(player.col, rows - 1, WALL)
  set(door.col, door.row, EMPTY); set(door.col, rows - 1, WALL)
  set(key.col, key.row, EMPTY)

  return { name, cols, rows, tiles, player, door, enemies, items, mirrors: [], lifeStart: kind === 'tall' ? 16000 : 12000 }
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
  lifeStart?: number
}

const WALKER_KINDS = new Set<EnemyKind>(['goblin', 'gargoil', 'dragon', 'saramandor'])

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

  // Open floor only (never under the throne dais), and kept clear of the player's
  // start (col 2) by a ~5-tile buffer so a foe — goblins HUNT — never spawns right
  // on top of Dana. The first spot a walker takes is therefore ≥ col 7.
  const floorSpots: Cell[] = []
  for (let c = 7; c < cols - 4; c += 3) if (!solid(c, floor)) floorSpots.push({ col: c, row: floor })

  const enemies: EnemySpawn[] = []
  const items: ItemSpawn[] = []
  const mirrors: MirrorSpawn[] = []
  const player: Cell = { col: 2, row: floor }
  const door: Cell = { col: cols - 3, row: floor }

  // sequential allocators so scattered things spread out (the key anchor is reserved)
  const high = anchors.filter(a => !(a.col === key.col && a.row === key.row))
  let hp = 0, fp = 0
  const nextHigh = (): Cell => high.length ? high[hp++ % high.length] : nextFloor()
  const nextFloor = (): Cell => floorSpots.length ? floorSpots[fp++ % floorSpots.length] : { col: mid, row: floor }

  items.push({ col: key.col, row: key.row, kind: 'key' })
  for (const k of roster.items ?? []) {
    const a = nextHigh()
    items.push({ col: a.col, row: a.row, kind: k, value: k === 'jewel' ? 2000 : k === 'treasure' ? 5000 : undefined })
  }

  for (const [k, n] of Object.entries(roster.foes ?? {}) as [EnemyKind, number][]) {
    for (let j = 0; j < n; j++) {
      let pos: Cell
      if (k === 'panel') pos = niches.length ? niches[j % niches.length] : { col: 2, row: Math.max(3, floor - 5) }
      else if (WALKER_KINDS.has(k)) pos = nextFloor()
      else { const a = nextHigh(); pos = { col: a.col, row: Math.max(3, a.row - 2) } }
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

  // Safety net: key supported + cleared, singletons clear, nothing embedded in stone.
  if (!solid(key.col, key.row + 1)) plat(key.col - 1, key.row + 1, 3, BRICK)
  set(key.col, key.row, EMPTY)
  for (const e of enemies) set(e.col, e.row, EMPTY)
  for (const m of mirrors) set(m.col, m.row, EMPTY)
  for (const it of items) if (!it.hidden) set(it.col, it.row, EMPTY)
  set(player.col, player.row, EMPTY); set(player.col, player.row - 1, EMPTY); set(player.col, rows - 1, WALL)
  set(door.col, door.row, EMPTY); set(door.col, door.row - 1, EMPTY); set(door.col, rows - 1, WALL)

  return { name, cols, rows, tiles, player, door, enemies, items, mirrors, lifeStart: roster.lifeStart ?? 13000 }
}

export const BUILTIN_LEVELS: LevelDef[] = [
  // Every cavern below is a large, smooth-scrolling warm-stone castle room built by
  // bigRoom (no fixed single-screen squares). Each keeps its identity — foes, items,
  // zodiac panels, seals, wings, pages — scattered into a roomy `kind` of chamber.

  // ── Shrine of Aries ──
  // Awakening. Tutorial cavern: a lone goblin, a bell up on a shelf, a buried jar.
  bigRoom('Awakening', 26, 16, 'cavern', { foes: { goblin: 1 }, items: ['bell'], hidden: [{ col: 8, row: 13, kind: 'jar' }], secret: [{ col: 13, row: 14, kind: 'jewel', value: 2000 }], lifeStart: 12000 }),

  // Hall of Mirrors. Two demon mirrors rain demonheads across an open cave; build up
  // to the bell + key. Super-jar buried low.
  bigRoom('Hall of Mirrors', 28, 16, 'cavern', { mirrors: { demonhead: 2 }, items: ['bell'], hidden: [{ col: 10, row: 13, kind: 'superjar' }], lifeStart: 13000 }),

  // The Vault. A broken-floor vault: panel turret, a ghost, a gargoil — plus an extra
  // Dana and a buried jar + jewel among the stacked chambers.
  bigRoom('The Vault', 28, 18, 'depths', { foes: { panel: 1, ghost: 1, gargoil: 1 }, items: ['life'], hidden: [{ col: 8, row: 15, kind: 'jar' }, { col: 18, row: 15, kind: 'jewel', value: 2000 }], secret: [{ col: 21, row: 16, kind: 'treasure', value: 5000 }], lifeStart: 13000 }),

  // Sunken Gallery. A long colonnade hall — hanging columns over a walkable arcade,
  // the key high on the broken upper gallery. Scrolls well past the screen.
  bigRoom('Sunken Gallery', 34, 15, 'gallery', { foes: { gargoil: 2, ghost: 1 }, items: ['hourglass', 'jewel', 'jewel', 'bell'], hidden: [{ col: 4, row: 12, kind: 'jar' }], secret: [{ col: 25, row: 13, kind: 'life' }], lifeStart: 14000 }),

  // Constellation of Aries. Holds the ZODIAC PANEL — clear the room holding it to
  // drop into the fairy bonus room. Gargoils + goblins guard a wide cave.
  bigRoom('Constellation', 28, 16, 'cavern', { foes: { gargoil: 2, goblin: 2 }, items: ['zodiac'], hidden: [{ col: 6, row: 13, kind: 'bell' }, { col: 20, row: 13, kind: 'bell' }], lifeStart: 13000 }),

  // ── Shrine of Taurus ──
  // Gargoyle Climb. A vertical tower — drop gargoils off the battlements as you climb.
  bigRoom('Gargoyle Climb', 20, 24, 'tower', { foes: { gargoil: 4 }, items: ['jewel', 'jewel'], hidden: [{ col: 10, row: 21, kind: 'bell' }], lifeStart: 16000 }),

  // Ghost Corridor. A long colonnade the ghosts sweep, smashing bridges; grab the
  // super-jar to clear a path.
  bigRoom('Ghost Corridor', 32, 15, 'gallery', { foes: { ghost: 4 }, items: ['superjar'], hidden: [{ col: 15, row: 12, kind: 'jewel', value: 2000 }], lifeStart: 14000 }),

  // The Ramparts. A tall keep climb — zigzag battlements with arrow-slit turrets in
  // the walls. The camera follows you up to the crowning key.
  bigRoom('The Ramparts', 18, 26, 'tower', { foes: { panel: 2, gargoil: 1, ghost: 1 }, items: ['bell', 'treasure', 'hourglass'], hidden: [{ col: 5, row: 23, kind: 'jar' }], lifeStart: 17000 }),

  // Sky Tower. A Neul homes on your height as you climb to the GOLDEN WINGS (clear
  // holding them to warp ahead). A Solomon's Seal waits mid-tower.
  bigRoom('Sky Tower', 20, 26, 'tower', { foes: { neul: 1, gargoil: 2 }, items: ['wings', 'seal'], hidden: [{ col: 4, row: 23, kind: 'scroll' }], lifeStart: 17000 }),

  // Constellation of Taurus. Second ZODIAC PANEL, ghosts + gargoils across a cave.
  bigRoom('Constellation II', 28, 16, 'cavern', { foes: { ghost: 2, gargoil: 2, goblin: 2 }, items: ['zodiac'], hidden: [{ col: 14, row: 13, kind: 'superjar' }], lifeStart: 13000 }),

  // ── Shrine of Gemini ──
  // Spark Cells. Relentless sparkballs ricochet through a broken-floor vault — wall
  // them off or fireball them. A Solomon's Seal + a scroll reward the climb.
  bigRoom('Spark Cells', 28, 18, 'depths', { foes: { sparkball: 4 }, items: ['seal'], hidden: [{ col: 20, row: 15, kind: 'scroll' }], secret: [{ col: 10, row: 16, kind: 'jewel', value: 3000 }], lifeStart: 14000 }),

  // Dragon's Lair. A pink Dragon hunts the throne hall while Saramandors spit fire.
  bigRoom("Dragon's Lair", 30, 16, 'throne', { foes: { dragon: 1, saramandor: 2 }, items: ['jewel'], hidden: [{ col: 8, row: 13, kind: 'jar' }, { col: 21, row: 13, kind: 'jar' }], lifeStart: 14000 }),

  // Throne Antechamber. A wide grand hall around a stepped throne dais (the key
  // crowns it), a demon mirror brooding overhead, a dragon prowling the floor.
  bigRoom('Throne Antechamber', 36, 15, 'throne', { foes: { dragon: 1, saramandor: 2 }, mirrors: { demonhead: 1 }, items: ['treasure', 'jewel', 'hourglass'], hidden: [{ col: 8, row: 12, kind: 'superjar' }], lifeStart: 15000 }),

  // The Gauntlet. A saramandor mirror, a panel turret, ghosts, a sparkball and
  // gargoils across a vault — and a Solomon's Seal among the chambers.
  bigRoom('The Gauntlet', 30, 18, 'depths', { foes: { ghost: 1, sparkball: 1, gargoil: 2, goblin: 1, panel: 1 }, mirrors: { saramandor: 1 }, items: ['seal'], hidden: [{ col: 15, row: 15, kind: 'treasure', value: 5000 }], lifeStart: 15000 }),

  // Solomon's Gate. The third ZODIAC PANEL crowns a foe-storm: two demon mirrors,
  // ghosts, gargoils and dragons. An hourglass keeps you alive.
  bigRoom("Solomon's Gate", 34, 16, 'throne', { foes: { dragon: 2, gargoil: 2, ghost: 2 }, mirrors: { demonhead: 2 }, items: ['zodiac', 'hourglass'], hidden: [{ col: 9, row: 13, kind: 'superjar' }], lifeStart: 15000 }),

  // ── Shrine of Cancer — the road to the Princess ──
  // Tide Pools. Sparkballs + a Neul harry a wide cave; the PAGE OF SPACE hides buried
  // low (one of the two pages the true ending needs).
  bigRoom('Tide Pools', 28, 18, 'cavern', { foes: { sparkball: 2, neul: 1, gargoil: 2 }, hidden: [{ col: 6, row: 15, kind: 'pageSpace' }], lifeStart: 14000 }),

  // The Castle Depths. A big sprawling vault that scrolls in BOTH axes — broken
  // floors stack the chambers. The grandest castle hall before the end.
  bigRoom('The Castle Depths', 28, 20, 'depths', { foes: { gargoil: 1, ghost: 1, neul: 1, sparkball: 1 }, hidden: [{ col: 14, row: 17, kind: 'jewel', value: 3000 }], secret: [{ col: 9, row: 18, kind: 'treasure', value: 5000 }], lifeStart: 16000 }),

  // Crystal Cavern. A WIDE natural cave (30 tiles) that scrolls horizontally — build
  // up to the high key, then trek to the door as the camera follows you.
  largeCave('Crystal Cavern', 30, 13, 'wide'),

  // The Long Ascent. A TALL natural cave (24 tiles) that scrolls vertically: climb
  // the zigzag ledges to the key near the ceiling, then descend. PAGE OF TIME hides up.
  largeCave('The Long Ascent', 18, 24, 'tall', [{ col: 12, row: 9, kind: 'pageTime' }]),
]

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
  '#............................#',
  '#............................#',
  '#.P........................D.#',
  '##############################',
], { lifeStart: LIFE_HALF })

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
  '#........................#',
  '#.P......................#',
  '##########################',
])

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
const ITEM_KINDS = new Set<ItemKind>(['key', 'jewel', 'treasure', 'bell', 'jar', 'superjar', 'scroll', 'hourglass', 'hourglassHalf', 'fairy', 'life', 'seal', 'zodiac', 'wings'])
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
      items.push({ col: c.col, row: c.row, kind, hidden: !!(raw as ItemSpawn).hidden, value: isInt(value) ? value : undefined })
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
  return {
    name: typeof d['name'] === 'string' ? d['name'].slice(0, 80) : 'Imported',
    cols, rows, tiles, player, door, enemies, items, mirrors,
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
