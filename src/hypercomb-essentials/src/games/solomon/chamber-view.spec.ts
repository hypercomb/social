import { describe, expect, it } from 'vitest'
import {
  ChamberView, chamberInstruments, type ChamberGainRequest, type ChamberSound, type ChamberViewHooks,
} from './chamber-view.js'
import type {
  ChamberAlcove, ChamberArtifact, ChamberBlock, ChamberChest, ChamberDefinition, ChamberEntrance,
  ChamberExit, ChamberGate, ChamberRisingLight, ChamberTablet, MoveInput,
} from './chamber.js'

// -- fixture: a small test cellar exercising every feature kind chamber-view
// must render — one exit, one entrance, a rising light gated by an artifact
// claim, a chest, a gate behind a tablet, an alcove, and a pushable block.
// (fixtures live as literals in this file, per the folder's standing rule.)

const W = 14, H = 12
const key = (col: number, row: number): string => `${col},${row}`
function makeMap(overrides: Record<string, string> = {}, width = W, height = H): string[] {
  const rows: string[] = []
  for (let row = 0; row < height; row++) {
    let line = ''
    for (let col = 0; col < width; col++) {
      line += (row === 0 || row === height - 1 || col === 0 || col === width - 1) ? '#' : (overrides[key(col, row)] ?? '.')
    }
    rows.push(line)
  }
  return rows
}

const EXIT: ChamberExit = { id: 'up-exit', col: 6, row: 1, style: 'stairs-up', label: 'Daylight', landing: { col: 6, row: 2 }, facing: 'down' }
const ENTRANCE: ChamberEntrance = { id: 'down-entrance', col: 10, row: 4, style: 'stairs-down', empty: 'The way below is not yet open.', landing: { col: 10, row: 5 } }
const RISING: ChamberRisingLight = { id: 'rising-light', col: 1, row: 10, landing: { col: 1, row: 9 } }
const CHEST: ChamberChest = { id: 'iron-chest', col: 3, row: 3, name: 'Iron Chest', subtitle: 'A locked coffer', items: [{ kind: 'key', name: 'A small key' }], lore: 'It creaks open, hinges complaining.' }
const ARTIFACT: ChamberArtifact = { id: 'the-heart', col: 8, row: 3, name: 'The Heart', knowledgeId: 'heart-lore', lore: 'A heart of old stone, still warm.' }
const BLOCK: ChamberBlock = { id: 'stone-1', col: 5, row: 3, look: 'stone' }
const TABLET: ChamberTablet = { id: 'gate-tablet', col: 2, row: 6, title: 'Old Stone', text: 'At dawn the sun answers.' }
const GATE: ChamberGate = {
  id: 'rune-gate', col: 3, row: 6, name: 'Rune Gate', tablet: 'gate-tablet', question: 'Which rune answers dawn?',
  options: [{ id: 'sun', glyph: '☉', label: 'Sun' }, { id: 'moon', glyph: '☾', label: 'Moon' }], answer: ['sun'],
}
const ALCOVE: ChamberAlcove = { id: 'memory-1', col: 5, row: 7, memoryId: 'mem-1', text: 'A memory returns, warm and clear.', locked: 'Nothing answers yet.' }

function baseDef(overrides: Partial<ChamberDefinition> = {}): ChamberDefinition {
  const merged: Record<string, string> = {
    [key(EXIT.col, EXIT.row)]: '<', [key(EXIT.landing.col, EXIT.landing.row)]: '@',
    [key(ENTRANCE.col, ENTRANCE.row)]: '>',
    [key(RISING.col, RISING.row)]: 'u',
    [key(CHEST.col, CHEST.row)]: 'K',
    [key(ARTIFACT.col, ARTIFACT.row)]: 'A',
    [key(BLOCK.col, BLOCK.row)]: 'o',
    [key(TABLET.col, TABLET.row)]: 't',
    [key(GATE.col, GATE.row)]: 'R',
    [key(ALCOVE.col, ALCOVE.row)]: 'h',
  }
  return {
    id: 'test-cellar', name: 'Test Cellar', subtitle: 'A room for testing', look: 'cavern', torch: 4, sconces: true,
    map: makeMap(merged),
    exits: [EXIT], entrances: [ENTRANCE], tablets: [TABLET], gates: [GATE], chests: [CHEST], doors: [],
    shutters: [], plates: [], blocks: [BLOCK], levers: [], lamps: [], lampSets: [], sigils: [],
    alcoves: [ALCOVE], residents: [], furniture: [], effects: [], artifact: ARTIFACT, risingLight: RISING,
    ...overrides,
  }
}

function stubHooks(overrides: Partial<ChamberViewHooks> = {}): ChamberViewHooks & { gains: ChamberGainRequest[]; sounds: ChamberSound[]; navigated: [string, string][]; learned: [string, string][]; foundIds: string[] } {
  const gains: ChamberGainRequest[] = []
  const sounds: ChamberSound[] = []
  const navigated: [string, string][] = []
  const learned: [string, string][] = []
  const foundIds: string[] = []
  return {
    gain: (r) => gains.push(r),
    onNavigate: (to, id) => navigated.push([to, id]),
    sound: (kind) => sounds.push(kind),
    learn: (id, text) => learned.push([id, text]),
    found: (id) => foundIds.push(id),
    gains, sounds, navigated, learned, foundIds,
    ...overrides,
  }
}

const idle: MoveInput = { up: false, down: false, left: false, right: false }
function walk(view: ChamberView, x: number, y: number, maxFrames = 800): void {
  for (let i = 0; i < maxFrames; i++) {
    const dx = x - view.model.x, dy = y - view.model.y
    if (Math.hypot(dx, dy) < 0.08) return
    view.update(1 / 60, { left: dx < -0.04, right: dx > 0.04, up: dy < -0.04, down: dy > 0.04 })
  }
}
function dwell(view: ChamberView, seconds: number): void {
  for (let i = 0; i < Math.ceil(seconds * 60); i++) view.update(1 / 60, idle)
}

function mountView(defOverrides: Partial<ChamberDefinition> = {}, hookOverrides: Partial<ChamberViewHooks> = {}) {
  const hooks = stubHooks(hookOverrides)
  const view = new ChamberView(baseDef(defOverrides), hooks)
  const host = document.createElement('div')
  view.mount(host)
  return { view, hooks, host }
}

describe('ChamberView — mount', () => {
  it('builds a heading from the definition and a portal for every exit/entrance/rising light', () => {
    const { host } = mountView()
    expect(host.querySelector('h2')?.textContent).toBe('Test Cellar')
    expect(host.querySelectorAll('.sol-chamber-portal').length).toBe(3) // exit + entrance + rising light
    expect(host.querySelectorAll('.sol-chamber-feature').length).toBe(4) // chest, gate, alcove, artifact
  })

  it('never throws when canvas contexts are unavailable (jsdom has no canvas)', () => {
    expect(() => mountView()).not.toThrow()
    const { view } = mountView()
    expect(() => { view.update(1 / 60, idle); view.interact(); view.cast() }).not.toThrow()
  })
})

describe('ChamberView — cues (M9: a bubble beside the target, never a bottom prompt pill)', () => {
  it('shows a tag cue beside a portal within reach, with no key hint', () => {
    const { view, host } = mountView()
    view.update(0, idle) // player starts at the exit's landing, already in its reach
    const cue = host.querySelector<HTMLElement>('.sol-chamber-cue')!
    expect(cue.hidden).toBe(false)
    expect(cue.textContent).toBe('Daylight')
    expect(cue.dataset['action']).toBe('tag')
  })

  it('hides once nothing is within reach, and shows an act cue with "E to open" beside the chest', () => {
    const { view, host } = mountView()
    walk(view, 9, 8) // away from every portal and feature
    view.update(0, idle)
    const cue = host.querySelector<HTMLElement>('.sol-chamber-cue')!
    expect(cue.hidden).toBe(true)

    walk(view, 3.5, 4.4) // beside the chest
    view.update(0, idle)
    expect(cue.hidden).toBe(false)
    expect(cue.textContent).toBe('Iron Chest · E to open')
    expect(cue.dataset['action']).toBe('act')
  })
})

describe('ChamberView — portals (present() gates visibility; M9 seeds their thumbnail)', () => {
  it('hides the rising light until the artifact is claimed, and shows it after', () => {
    const { view, host } = mountView()
    const risingButton = host.querySelector<HTMLButtonElement>('.sol-chamber-portal[aria-label="The Rising Light"]')!
    expect(risingButton.hidden).toBe(true)

    walk(view, 8.5, 4.4) // beside the artifact — its own cell is solid, never walked onto
    view.interact('the-heart')
    expect(risingButton.hidden).toBe(false)
  })

  it('paints a portal button\'s live thumbnail from hooks.seatSeed, tolerating a missing or null seed', () => {
    const seed = { cols: 4, rows: 3, rgb: new Uint8ClampedArray(4 * 3 * 3) }
    const { host } = mountView({}, { seatSeed: (id) => (id === 'up-exit' ? seed : null) })
    const exitSeed = host.querySelector<HTMLCanvasElement>('.sol-chamber-portal[aria-label="Daylight"] .sol-chamber-portal-seed')!
    expect(exitSeed.width).toBe(4)
    expect(exitSeed.height).toBe(3)
    const entranceSeed = host.querySelector<HTMLCanvasElement>('.sol-chamber-portal[aria-label="Stairs down"] .sol-chamber-portal-seed')!
    expect(entranceSeed.width).not.toBe(4) // no seed offered for this one — untouched
  })

  it('never throws when no seatSeed hook is supplied at all', () => {
    expect(() => mountView()).not.toThrow()
  })
})

describe('ChamberView — chest and artifact reveals are routed through hooks.gain, never a local dialog (M2/M3)', () => {
  it('a fresh chest open calls hooks.gain with the chamber-scoped ref and fresh:true, and opens no dialog', () => {
    const { view, hooks } = mountView()
    walk(view, 3.5, 4.4)
    view.interact('iron-chest')
    expect(hooks.gains).toEqual([{ ref: 'test-cellar/chest:iron-chest', fresh: true }])
    expect(view.isDialogOpen).toBe(false)
    expect(hooks.sounds).toContain('open')
  })

  it('a repeat open calls hooks.gain again with fresh:false (belt-and-suspenders — the eventual GainScreen dedupes)', () => {
    const { view, hooks } = mountView()
    walk(view, 3.5, 4.4)
    view.interact('iron-chest')
    view.interact('iron-chest')
    expect(hooks.gains).toEqual([
      { ref: 'test-cellar/chest:iron-chest', fresh: true },
      { ref: 'test-cellar/chest:iron-chest', fresh: false },
    ])
  })

  it('claiming the artifact routes through hooks.gain the same way', () => {
    const { view, hooks } = mountView()
    walk(view, 8.5, 4.4)
    view.interact('the-heart')
    expect(hooks.gains).toEqual([{ ref: 'test-cellar/artifact:the-heart', fresh: true }])
    expect(view.isDialogOpen).toBe(false)
    expect(hooks.sounds).toContain('claim')
    expect(hooks.learned).toContainEqual(['heart-lore', 'A heart of old stone, still warm.'])
  })
})

describe('ChamberView — a gate\'s rune choice and an alcove\'s memory stay local scenes (nothing here is ever attained)', () => {
  it('opens a gate dialog once its tablet has been read, and closes it on the right rune', () => {
    const { view, host } = mountView()
    walk(view, 3.5, 7.4) // beside both the tablet and the gate (their own cells are solid)
    dwell(view, 0.6) // long enough for the tablet's proximity-dwell read
    view.interact('rune-gate')
    expect(view.isDialogOpen).toBe(true)
    const dialog = host.querySelector<HTMLElement>('.sol-chamber-dialog')!
    expect(dialog.hidden).toBe(false)
    expect(host.querySelector('.sol-chamber-dialog-title')?.textContent).toBe('Rune Gate')

    const options = Array.from(host.querySelectorAll<HTMLButtonElement>('.sol-chamber-dialog-option'))
    expect(options.map(o => o.textContent)).toEqual(['Sun', 'Moon'])
    options.find(o => o.textContent === 'Sun')!.click()
    expect(view.isDialogOpen).toBe(false)
  })

  it('opens an alcove dialog with the locked text when nothing has unlocked it', () => {
    const { view, host } = mountView()
    walk(view, 8, 8) // clear of every obstacle first
    walk(view, 6.3, 7.6) // then in beside the alcove from the open side — its own cell is solid
    view.interact('memory-1')
    expect(view.isDialogOpen).toBe(true)
    expect(host.querySelector('.sol-chamber-dialog-title')?.textContent).toBe('Memory alcove')
    expect(host.querySelector('.sol-chamber-dialog-body')?.textContent).toBe('Nothing answers yet.')
    view.closeDialog()
    expect(view.isDialogOpen).toBe(false)
  })
})

describe('ChamberView — navigation (a completed portal push, or a click, is routed through hooks.onNavigate — M9)', () => {
  it('interacting with a reachable, armed portal calls onNavigate and found', () => {
    const { view, hooks } = mountView()
    walk(view, 10.5, 5.3) // beside the entrance, which was never disarmed
    view.interact('down-entrance')
    expect(hooks.navigated).toEqual([['down', 'down-entrance']])
    expect(hooks.foundIds).toContain('down-entrance')
  })

  it('clicking a portal button dispatches the same interaction', () => {
    const { view, hooks, host } = mountView()
    walk(view, 10.5, 5.3)
    host.querySelector<HTMLButtonElement>('.sol-chamber-portal[aria-label="Stairs down"]')!.click()
    expect(hooks.navigated).toEqual([['down', 'down-entrance']])
  })

  it('never fires onNavigate for a portal that is out of reach', () => {
    const { view, hooks } = mountView()
    view.interact('down-entrance') // still at the far-away exit landing
    expect(hooks.navigated).toEqual([])
  })
})

describe('ChamberView — show(arrival, at?)', () => {
  it('"above" with an arrive id lands at that exit\'s landing, facing as authored', () => {
    const { view } = mountView()
    walk(view, 9, 9)
    view.show({ from: 'above', arrive: 'up-exit' })
    expect(view.model.x).toBeCloseTo(6.5)
    expect(view.model.y).toBeCloseTo(2.5)
    expect(view.model.facing).toBe('down')
  })

  it('"below" with an exit id lands at that entrance\'s landing', () => {
    const { view } = mountView()
    view.show({ from: 'below', exit: 'down-entrance' })
    expect(view.model.x).toBeCloseTo(10.5)
    expect(view.model.y).toBeCloseTo(5.5)
  })

  it('an unresolvable arrival with an `at` hint falls back to the nearest named portal', () => {
    const { view } = mountView()
    view.show({ from: 'above', arrive: 'no-such-id' }, { x: 0.1, y: 0.1 }) // nearest the up-exit
    expect(view.model.x).toBeCloseTo(6.5)
    expect(view.model.y).toBeCloseTo(2.5)
  })

  it('"save" leaves the position untouched — restoreState is what places the traveller', () => {
    const { view } = mountView()
    walk(view, 4, 5)
    const x = view.model.x, y = view.model.y
    view.show({ from: 'save' })
    expect(view.model.x).toBe(x)
    expect(view.model.y).toBe(y)
  })

  it('un-hides the root', () => {
    const { view, host } = mountView()
    view.hide()
    expect(host.querySelector<HTMLElement>('.sol-chamber-view')!.hidden).toBe(true)
    view.show({ from: 'above' })
    expect(host.querySelector<HTMLElement>('.sol-chamber-view')!.hidden).toBe(false)
  })
})

describe('ChamberView — sound and knowledge hooks', () => {
  it('reading a tablet by dwelling near it calls hooks.learn', () => {
    const { view, hooks } = mountView()
    walk(view, 2.5, 7.4) // beside the tablet — its own cell is solid, read only by proximity
    dwell(view, 0.6)
    // ChamberTablet.knowledgeId defaults to `${chamber.id}-${tablet.id}` (§3.5.1) — TABLET sets none.
    expect(hooks.learned).toContainEqual(['test-cellar-gate-tablet', 'At dawn the sun answers.'])
    expect(hooks.sounds).toContain('read')
  })

  it('pushing a block calls hooks.sound("push") and moves it', () => {
    const { view, hooks } = mountView()
    walk(view, 4.5, 3.5)
    for (let i = 0; i < 40; i++) view.update(1 / 60, { ...idle, right: true })
    expect(view.model.blockCell('stone-1')).toEqual({ col: 6, row: 3 })
    expect(hooks.sounds).toContain('push')
  })
})

describe('ChamberView — seed, anchor and the veil legs', () => {
  it('anchor() returns the fractional cell centre of a named feature, and null for an unknown one', () => {
    const { view } = mountView()
    expect(view.anchor('iron-chest')).toEqual({ x: 3.5 / W, y: 3.5 / H })
    expect(view.anchor('does-not-exist')).toBeNull()
  })

  it('seed() matches the chamber\'s own dimensions', () => {
    const { view } = mountView()
    const seed = view.seed()
    expect(seed.cols).toBe(W)
    expect(seed.rows).toBe(H)
    expect(seed.rgb.length).toBe(W * H * 3)
  })

  it('leaveLeg/arriveLeg return a picture sized to the chamber, anchored at the given point', () => {
    const { view, host } = mountView()
    const leave = view.leaveLeg('in', { x: 0.2, y: 0.8 })
    const arrive = view.arriveLeg('in')
    expect(leave).not.toBeNull()
    expect(arrive).not.toBeNull()
    expect(leave!.origin).toEqual([0.2, 0.8])
    expect(arrive!.origin).toEqual([0.5, 0.5])
    expect(leave!.picture!.cols).toBe(W)
    expect(host.contains(leave!.element)).toBe(true)
    const fakeCtx = { fillStyle: '', fillRect: () => undefined } as unknown as CanvasRenderingContext2D
    expect(() => leave!.picture!.paint(fakeCtx, 4)).not.toThrow()
  })
})

describe('ChamberView — export/restore', () => {
  it('round-trips an opened chest through export and a fresh view\'s restore', () => {
    const { view } = mountView()
    walk(view, 3.5, 4.4)
    view.interact('iron-chest')
    const snapshot = view.exportState()

    const other = new ChamberView(baseDef(), stubHooks())
    other.restoreState(snapshot)
    expect(other.model.opened.has('iron-chest')).toBe(true)
  })
})

describe('ChamberView — dispose', () => {
  it('removes its root from the host, and mount() can be called again cleanly', () => {
    const { view, host } = mountView()
    view.dispose()
    expect(host.querySelector('.sol-chamber-view')).toBeNull()
    expect(() => view.mount(host)).not.toThrow()
    expect(host.querySelector('.sol-chamber-view')).not.toBeNull()
  })
})

describe('chamberInstruments', () => {
  it('carries the look, torch and sconces straight off the definition', () => {
    expect(chamberInstruments(baseDef())).toEqual({ look: 'cavern', torch: 4, sconces: true })
  })
})
