// Renders one chamber: caverns, the interior chain, the Hollow Grove — every
// place built on `ChamberModel` (§0.1, §3.5.1). A small DOM+canvas board, its
// portals showing a live seed of what lies beyond (M9's "seeds on portal
// buttons"), a single beside-the-target cue bubble instead of a bottom prompt
// pill (M9 — its own, third beside-prompt implementation: it shares only the
// visual/interaction contract with `.sol-rpg-cue`/`.sol-chamber-cue`'s
// sibling on the island, never the code, since the two boards share nothing).
//
// A chest or artifact opening is never shown here: per M2/M3 (one reveal
// mechanism for everything attained), it is routed straight to the shell's
// ONE `GainScreen` through `hooks.gain` — this file invents no title, no
// words, no art for it, only the chamber-scoped ref the registry is keyed by
// (`<chamber>/chest:<id>` / `<chamber>/artifact:<id>`, §3.2's `done()`
// grammar) and whether it is fresh. A gate's rune-choice and an alcove's
// memory text stay local scenes — they hold nothing that is ever attained,
// so they are never routed anywhere.

import {
  ChamberModel,
  type ChamberCell, type ChamberDefinition, type ChamberDialog, type ChamberEvent,
  type ChamberLook, type ChamberResult, type ChamberSnapshot, type ChamberTargetKind,
  type ChamberTerrain, type MoveInput,
} from './chamber.js'
import type { SigilRequirement } from './labyrinth.js'
import type { PlaceSeed } from './place.js'
import { CavernPainter, type CavernCamera, type CavernMap } from './cavern-paint.js'
import { canvasContext } from './island-paint.js'
import { PLAYER_LOOK, drawWalker } from './island-sprites.js'
import { VEIL_ZOOM, veilGridPicture, type VeilDirection, type VeilLeg, type VeilPicture, type VeilRgb } from './place-veil.js'

/** One-shot audio cues a chamber can raise, beside the shared 'door-in' /
 *  'door-out' / 'door-locked' kinds the shell already fires itself around
 *  every place transition (§3.6/§4.10) — a chamber never asks for those. */
export type ChamberSound =
  | 'push' | 'latch' | 'read' | 'lit' | 'complete' | 'settle'
  | 'unlock' | 'pull' | 'wand' | 'seal' | 'open' | 'claim' | 'finale'

/** What `RuntimeShell.instruments(place)` hands back for a chamber place —
 *  enough for a `GameAudio`-style helper to voice `ChamberSound` distinctly
 *  per look, without this file ever touching an audio API itself. */
export interface ChamberInstruments {
  readonly look: ChamberLook
  readonly torch: number
  readonly sconces: boolean
}
export function chamberInstruments(definition: ChamberDefinition): ChamberInstruments {
  return { look: definition.look, torch: definition.torch, sconces: definition.sconces }
}

/** Structurally the shell's own `RuntimeArrival` (place-runtimes.ts, §3.6) —
 *  named locally so this file never imports the shell (that would cycle:
 *  place-runtimes.ts already imports `ChamberView` from here). A `RuntimeArrival`
 *  value satisfies this type as-is; `ChamberRuntime.show()` passes it straight
 *  through. */
export type ChamberArrival =
  | { readonly from: 'above'; readonly arrive?: string }
  | { readonly from: 'below'; readonly exit?: string }
  | { readonly from: 'save' }

/** A fresh or repeat chest/artifact scene, routed to the shell instead of a
 *  local dialog (M2/M3). `ref` is the exact `<chamber>/chest:<id>` or
 *  `<chamber>/artifact:<id>` string §3.2's `done()` grammar already reads —
 *  the runtime looks up the matching `ATTAINMENTS` row by it for every word
 *  of display text; this file invents none (M22/M23's "text comes from
 *  content by id" rule, applied the same way here as for a labyrinth skill).
 *  Called on every open, fresh or not — belt-and-suspenders, since the
 *  eventual `GainScreen` already drops an already-seen id on its own
 *  (§3.8.2). */
export interface ChamberGainRequest {
  readonly ref: string
  readonly fresh: boolean
}

export interface ChamberViewHooks {
  has?(requirement: SigilRequirement): boolean
  knows?(knowledgeId: string): boolean
  /** A knowledge grant newly reached — a tablet read, a chest's `grants`, an
   *  artifact's lore. */
  learn?(id: string, text: string): void
  /** A fresh or repeat chest/artifact scene (see `ChamberGainRequest`). */
  gain(request: ChamberGainRequest): void
  /** A portal push (or a click on its own button, M9) completed: 'up' via an
   *  exit, 'down' via an entrance, 'surface' via the Rising Light. The shell
   *  decides what happens next — the same contract the island's own
   *  `onEntrance` already uses for this exact moment. */
  onNavigate(to: 'up' | 'down' | 'surface', id: string): void
  sound?(kind: ChamberSound): void
  /** The far side of one of this chamber's own portals, for its button's
   *  live thumbnail (M9); null while unknown. */
  seatSeed?(entrance: string): PlaceSeed | null
  /** Records that this portal has been reached, for the found ledger (2) A9.1. */
  found?(entrance: string): void
}

const TILE = 40
/** How far around the traveller counts as "seen" for the fog-of-war record
 *  `ChamberModel.explore()` keeps — independent of the torch's own, tighter
 *  darkness-pass radius inside `CavernPainter`. */
const REVEAL_REACH = 3

const SOUND_FOR: Readonly<Partial<Record<ChamberEvent['kind'], ChamberSound>>> = {
  pushed: 'push', latched: 'latch', read: 'read', lit: 'lit', completed: 'complete',
  unlocked: 'unlock', pulled: 'pull', wand: 'wand', seal: 'seal', settled: 'settle',
  opened: 'open', claimed: 'claim', finale: 'finale',
}

/** Reduces a chamber's own, richer terrain vocabulary down to the three
 *  symbols `CavernPainter` bakes from — a purely visual simplification (the
 *  gameplay-authoritative openness check stays `ChamberModel.open()`, never
 *  this). Anything not plainly walkable or water paints as rock, furniture
 *  and un-wanded cracks/runes/seals included: they read as solid until the
 *  wand (or a lamp set) says otherwise, matching what they actually are. */
function paintSymbol(terrain: ChamberTerrain): string {
  if (terrain === 'water' || terrain === 'spring') return '~'
  if (terrain === 'floor' || terrain === 'threshold' || terrain === 'seal-open' || terrain === 'rubble' || terrain === 'laid' || terrain === 'stone') return '.'
  return '#'
}

function seedPicture(seed: PlaceSeed): VeilPicture {
  return veilGridPicture(seed.cols, seed.rows, (col, row): VeilRgb => {
    const i = (row * seed.cols + col) * 3
    return [seed.rgb[i] ?? 0, seed.rgb[i + 1] ?? 0, seed.rgb[i + 2] ?? 0]
  })
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) node.textContent = text
  return node
}
function button(text: string, action: () => void, className = ''): HTMLButtonElement {
  const node = element('button', className, text)
  node.type = 'button'
  node.addEventListener('click', action)
  return node
}

interface PortalMarker {
  readonly cell: ChamberCell
  readonly button: HTMLButtonElement
  readonly canvas: HTMLCanvasElement
  seedKey: string
}
interface FeatureMarker {
  readonly cell: ChamberCell
  readonly target: ChamberTargetKind
  readonly marker: HTMLButtonElement
}

/** A keyboard-walkable chamber: the canvas paints the room, DOM buttons carry
 *  every portal and feature, and one cue bubble follows whatever
 *  `model.cue()` names (M9). The shell supplies the animation loop, exactly
 *  like `RpgOverworldView`/`LabyrinthRoomView` already do for their own
 *  boards. */
export class ChamberView {
  readonly model: ChamberModel
  readonly #definition: ChamberDefinition
  readonly #hooks: ChamberViewHooks

  #root: HTMLDivElement | null = null
  #map: HTMLDivElement | null = null
  #ctx: CanvasRenderingContext2D | null = null
  #painter: CavernPainter | null = null
  #painterKey = ''
  #dpr = 1
  #player: HTMLCanvasElement | null = null
  #sprite: CanvasRenderingContext2D | null = null
  #spriteKey = ''
  #cue: HTMLDivElement | null = null
  #status: HTMLDivElement | null = null
  #dialog: HTMLDivElement | null = null
  #dialogTitle: HTMLElement | null = null
  #dialogBody: HTMLDivElement | null = null
  #lastFocus: HTMLElement | null = null

  readonly #portals = new Map<string, PortalMarker>()
  readonly #features = new Map<string, FeatureMarker>()
  readonly #blockMarkers = new Map<string, HTMLDivElement>()

  #time = 0
  #notice = ''
  #hiddenPlace = true

  constructor(definition: ChamberDefinition, hooks: ChamberViewHooks) {
    this.#definition = definition
    this.#hooks = hooks
    this.model = new ChamberModel(definition, { has: hooks.has, knows: hooks.knows })
  }

  get isDialogOpen(): boolean { return this.#dialog !== null && !this.#dialog.hidden }

  mount(host: HTMLElement): void {
    this.dispose()
    const def = this.#definition
    const cols = this.model.built.cols, rows = this.model.built.rows
    const root = element('div', 'sol-chamber-view')
    root.append(element('style', '', CHAMBER_VIEW_CSS))
    const heading = element('div', 'sol-chamber-heading')
    heading.append(element('span', 'sol-chamber-eyebrow', def.look.toUpperCase()), element('h2', '', def.name), element('p', '', def.subtitle))
    root.append(heading)

    const map = element('div', 'sol-chamber-map')
    this.#map = map
    map.style.setProperty('--cols', String(cols))
    map.style.setProperty('--rows', String(rows))
    map.style.aspectRatio = `${cols} / ${rows}`
    map.setAttribute('role', 'group')
    map.setAttribute('aria-label', `${def.name}. Move with arrow keys or W A S D. Approach a portal or feature, then press Enter or E, or click, to interact. Z raises the wand.`)

    const canvas = element('canvas', 'sol-chamber-canvas')
    canvas.setAttribute('aria-hidden', 'true')
    this.#dpr = Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, 2)
    canvas.width = Math.max(1, Math.round(cols * TILE * this.#dpr))
    canvas.height = Math.max(1, Math.round(rows * TILE * this.#dpr))
    this.#ctx = canvasContext(canvas)

    const layer = element('div', 'sol-chamber-layer')
    for (const exit of def.exits) this.#mountPortal(layer, exit.id, exit, exit.label)
    for (const entrance of def.entrances) {
      this.#mountPortal(layer, entrance.id, entrance, entrance.style === 'trapdoor' ? 'Trapdoor' : entrance.style === 'tunnel' ? 'Tunnel' : 'Stairs down')
    }
    if (def.risingLight) this.#mountPortal(layer, def.risingLight.id, def.risingLight, 'The Rising Light')
    for (const chest of def.chests) this.#mountFeature(layer, chest.id, 'chest', chest, chest.name)
    for (const door of def.doors) this.#mountFeature(layer, door.id, 'door', door, door.name)
    for (const gate of def.gates) this.#mountFeature(layer, gate.id, 'gate', gate, gate.name)
    for (const lever of def.levers) this.#mountFeature(layer, lever.id, 'lever', lever, lever.name)
    for (const lamp of def.lamps) this.#mountFeature(layer, lamp.id, 'lamp', lamp, lamp.name)
    for (const sigil of def.sigils) this.#mountFeature(layer, sigil.id, 'sigil', sigil, 'Settling stone')
    for (const alcove of def.alcoves) this.#mountFeature(layer, alcove.id, 'alcove', alcove, 'Memory alcove')
    if (def.artifact) this.#mountFeature(layer, def.artifact.id, 'artifact', def.artifact, def.artifact.name)
    for (const resident of def.residents) this.#mountFeature(layer, resident.id, 'resident', resident, resident.name)
    for (const block of def.blocks) {
      const marker = element('div', `sol-chamber-block sol-chamber-block-${block.look}`)
      marker.setAttribute('aria-hidden', 'true')
      this.#blockMarkers.set(block.id, marker)
      layer.append(marker)
    }

    this.#player = element('canvas', 'sol-chamber-player')
    this.#player.width = 64; this.#player.height = 64
    this.#player.setAttribute('role', 'img'); this.#player.setAttribute('aria-label', 'You')
    this.#sprite = canvasContext(this.#player)
    layer.append(this.#player)

    this.#cue = element('div', 'sol-chamber-cue')
    this.#cue.hidden = true
    layer.append(this.#cue)

    map.append(canvas, layer)

    this.#status = element('div', 'sol-chamber-status')
    this.#status.setAttribute('aria-live', 'polite')

    const controls = element('div', 'sol-chamber-controls')
    controls.append(element('span', '', 'WASD / arrows · Walk'), button('E · Interact', () => this.interact()), button('Z · Wand', () => this.cast()))

    root.append(map, this.#status, controls)
    this.#ensureDialog(root)
    host.append(root)
    this.#root = root
    this.#root.hidden = this.#hiddenPlace

    this.#refresh()
  }

  #mountPortal(layer: HTMLDivElement, id: string, cell: ChamberCell, label: string): void {
    const marker = button('', () => this.interact(id), 'sol-chamber-portal')
    marker.style.setProperty('--col', String(cell.col))
    marker.style.setProperty('--row', String(cell.row))
    marker.setAttribute('aria-label', label)
    const seed = element('canvas', 'sol-chamber-portal-seed')
    seed.setAttribute('aria-hidden', 'true')
    marker.append(seed, element('span', 'sol-chamber-portal-label', label))
    layer.append(marker)
    this.#portals.set(id, { cell, button: marker, canvas: seed, seedKey: '' })
  }

  #mountFeature(layer: HTMLDivElement, id: string, target: ChamberTargetKind, cell: ChamberCell, label: string): void {
    const marker = button('', () => this.interact(id), `sol-chamber-feature sol-chamber-feature-${target}`)
    marker.style.setProperty('--col', String(cell.col))
    marker.style.setProperty('--row', String(cell.row))
    marker.setAttribute('aria-label', label)
    layer.append(marker)
    this.#features.set(id, { cell, target, marker })
  }

  #ensureDialog(root: HTMLDivElement): HTMLDivElement {
    if (this.#dialog) return this.#dialog
    const dialog = element('div', 'sol-chamber-dialog')
    dialog.hidden = true
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-modal', 'true')
    const card = element('div', 'sol-chamber-dialog-card')
    this.#dialogTitle = element('h3', 'sol-chamber-dialog-title')
    this.#dialogBody = element('div', 'sol-chamber-dialog-body')
    const close = button('Close (E)', () => this.closeDialog(), 'sol-chamber-dialog-close')
    card.append(this.#dialogTitle, this.#dialogBody, close)
    dialog.append(card)
    root.append(dialog)
    this.#dialog = dialog
    return dialog
  }

  update(dt: number, input: MoveInput): void {
    if (this.isDialogOpen) return
    const events = this.model.update(dt, input)
    this.#dispatchEvents(events)
    const step = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.25) : 0
    this.#time += step
    this.model.explore(REVEAL_REACH)
    this.#refresh()
  }

  interact(target?: string): void {
    if (this.isDialogOpen) return
    this.#applyResult(this.model.interact(target))
  }

  cast(): void {
    if (this.isDialogOpen) return
    this.#applyResult(this.model.cast())
  }

  closeDialog(): void {
    if (!this.#dialog || this.#dialog.hidden) return
    this.#dialog.hidden = true
    this.#lastFocus?.focus()
    this.#lastFocus = null
  }

  exportState(): ChamberSnapshot { return this.model.exportState() }

  restoreState(raw: unknown): void {
    this.closeDialog()
    this.model.restoreState(raw)
    this.#notice = ''
    this.#painterKey = ''
    this.#refresh()
  }

  show(arrival: ChamberArrival, at?: { readonly x: number; readonly y: number }): void {
    this.#hiddenPlace = false
    if (this.#root) this.#root.hidden = false
    if (arrival.from === 'above') {
      if (!this.#tryArrive(arrival.arrive) && at) this.#fallbackTo(at)
    } else if (arrival.from === 'below') {
      if (!this.#tryLand(arrival.exit) && at) this.#fallbackTo(at)
    }
    // 'save': the position already comes from `restoreState()` — nothing to do here.
    this.#notice = ''
    this.#refresh()
  }

  hide(): void {
    this.#hiddenPlace = true
    if (this.#root) this.#root.hidden = true
  }

  /** A coarse picture of the chamber as it stands, for the veil and for
   *  entrance seeds (2) A2.6/A2.8. */
  seed(): PlaceSeed { return this.model.seed() }

  anchor(feature: string): { readonly x: number; readonly y: number } | null {
    const cell = this.#cellOf(feature)
    if (!cell) return null
    const cols = this.model.built.cols, rows = this.model.built.rows
    return { x: (cell.col + 0.5) / cols, y: (cell.row + 0.5) / rows }
  }

  leaveLeg(direction: VeilDirection, at?: { readonly x: number; readonly y: number }): VeilLeg | null {
    if (!this.#map) return null
    const origin: readonly [number, number] = at ? [at.x, at.y] : [0.5, 0.5]
    return { element: this.#map, picture: seedPicture(this.model.seed()), origin, scale: VEIL_ZOOM[direction].leave }
  }
  arriveLeg(direction: VeilDirection): VeilLeg | null {
    if (!this.#map) return null
    const origin: readonly [number, number] = [0.5, 0.5]
    return { element: this.#map, picture: seedPicture(this.model.seed()), origin, scale: VEIL_ZOOM[direction].arrive }
  }

  dispose(): void {
    this.#root?.remove()
    this.#root = null; this.#map = null; this.#ctx = null
    this.#painter = null; this.#painterKey = ''
    this.#player = null; this.#sprite = null; this.#spriteKey = ''
    this.#cue = null; this.#status = null
    this.#dialog = null; this.#dialogTitle = null; this.#dialogBody = null; this.#lastFocus = null
    this.#portals.clear(); this.#features.clear(); this.#blockMarkers.clear()
  }

  // -- internals --------------------------------------------------------

  #tryArrive(id?: string): boolean {
    const target = id !== undefined ? this.#definition.exits.find(e => e.id === id) : this.#definition.exits[0]
    if (!target) return false
    this.model.arrive(target.id)
    return true
  }
  #tryLand(id?: string): boolean {
    const target = id !== undefined ? this.#definition.entrances.find(e => e.id === id) : this.#definition.entrances[0]
    if (!target) return false
    this.model.land(target.id)
    return true
  }
  /** Best-effort placement when the named arrival names nothing here (a save
   *  from before this chamber's own portals existed, or a first-ever visit
   *  with no natural entrance) — the nearest exit or entrance to the given
   *  fractional point, never left ungrounded. */
  #fallbackTo(at: { readonly x: number; readonly y: number }): void {
    const cols = this.model.built.cols, rows = this.model.built.rows
    const targetCol = at.x * cols, targetRow = at.y * rows
    let bestId: string | null = null, bestIsExit = true, bestDist = Infinity
    for (const exit of this.#definition.exits) {
      const d = Math.hypot(exit.col - targetCol, exit.row - targetRow)
      if (d < bestDist) { bestDist = d; bestId = exit.id; bestIsExit = true }
    }
    for (const entrance of this.#definition.entrances) {
      const d = Math.hypot(entrance.col - targetCol, entrance.row - targetRow)
      if (d < bestDist) { bestDist = d; bestId = entrance.id; bestIsExit = false }
    }
    if (bestId === null) return
    if (bestIsExit) this.model.arrive(bestId); else this.model.land(bestId)
  }

  #cellOf(id: string): ChamberCell | null {
    const d = this.#definition
    return d.exits.find(e => e.id === id) ?? d.entrances.find(e => e.id === id)
      ?? (d.risingLight?.id === id ? d.risingLight : null)
      ?? d.chests.find(c => c.id === id) ?? d.doors.find(x => x.id === id) ?? d.gates.find(x => x.id === id)
      ?? d.levers.find(x => x.id === id) ?? d.lamps.find(x => x.id === id) ?? d.sigils.find(x => x.id === id)
      ?? d.alcoves.find(x => x.id === id) ?? (d.artifact?.id === id ? d.artifact : null) ?? d.residents.find(x => x.id === id)
      ?? null
  }

  #applyResult(result: ChamberResult): void {
    this.#dispatchEvents(result.events)
    if (result.kind === 'message') this.#notice = result.text
    else if (result.kind === 'speech') this.#notice = `${this.#residentName(result.resident)}: "${result.text}"`
    else if (result.kind === 'dialog') this.#openResultDialog(result.dialog)
    this.#refresh()
  }

  #residentName(id: string): string { return this.#definition.residents.find(r => r.id === id)?.name ?? '' }

  #dispatchEvents(events: readonly ChamberEvent[]): void {
    for (const event of events) {
      if (event.kind === 'navigate') { this.#onNavigate(event); continue }
      if (event.kind === 'knowledge') this.#hooks.learn?.(event.id, event.text)
      const sound = SOUND_FOR[event.kind]
      if (sound) this.#hooks.sound?.(sound)
    }
  }

  #onNavigate(event: Extract<ChamberEvent, { kind: 'navigate' }>): void {
    if (event.to === 'up') { this.#hooks.onNavigate('up', event.exit); this.#hooks.found?.(event.exit) }
    else if (event.to === 'down') { this.#hooks.onNavigate('down', event.entrance); this.#hooks.found?.(event.entrance) }
    else { this.#hooks.onNavigate('surface', event.light); this.#hooks.found?.(event.light) }
  }

  #openResultDialog(dialog: ChamberDialog): void {
    if (dialog.kind === 'chest') { this.#hooks.gain({ ref: `${this.#definition.id}/chest:${dialog.chest}`, fresh: dialog.fresh }); return }
    if (dialog.kind === 'artifact') { this.#hooks.gain({ ref: `${this.#definition.id}/artifact:${dialog.artifact}`, fresh: dialog.fresh }); return }
    if (dialog.kind === 'gate') { this.#showGateDialog(dialog); return }
    this.#showAlcoveDialog(dialog)
  }

  #showGateDialog(dialog: Extract<ChamberDialog, { kind: 'gate' }>): void {
    if (!this.#root) return
    const el = this.#ensureDialog(this.#root)
    const gateDef = this.#definition.gates.find(g => g.id === dialog.gate)
    if (this.#dialogTitle) this.#dialogTitle.textContent = dialog.title
    if (this.#dialogBody) {
      this.#dialogBody.replaceChildren()
      this.#dialogBody.append(element('p', 'sol-chamber-dialog-inscription', dialog.inscription), element('p', 'sol-chamber-dialog-question', dialog.question))
      const options = element('div', 'sol-chamber-dialog-options')
      for (const option of gateDef?.options ?? []) options.append(button(option.label, () => this.#chooseRune(dialog.gate, option.id), 'sol-chamber-dialog-option'))
      this.#dialogBody.append(options)
      this.#dialogBody.append(element('p', 'sol-chamber-dialog-progress', this.model.runes(dialog.gate).join(' · ')))
    }
    this.#openScene(el)
  }

  #chooseRune(gate: string, rune: string): void {
    const { opened, text } = this.model.choose(gate, rune)
    this.#notice = text
    if (opened) { this.closeDialog(); this.#refresh(); return }
    const progress = this.#dialogBody?.querySelector<HTMLElement>('.sol-chamber-dialog-progress')
    if (progress) progress.textContent = this.model.runes(gate).join(' · ')
  }

  #showAlcoveDialog(dialog: Extract<ChamberDialog, { kind: 'alcove' }>): void {
    if (!this.#root) return
    const el = this.#ensureDialog(this.#root)
    if (this.#dialogTitle) this.#dialogTitle.textContent = dialog.title
    if (this.#dialogBody) { this.#dialogBody.replaceChildren(); this.#dialogBody.append(element('p', '', dialog.text)) }
    this.#openScene(el)
  }

  #openScene(el: HTMLDivElement): void {
    this.#lastFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    el.hidden = false
    el.querySelector<HTMLButtonElement>('.sol-chamber-dialog-close')?.focus()
  }

  #featureActive(id: string, target: ChamberTargetKind): boolean {
    if (target === 'chest') return this.model.opened.has(id)
    if (target === 'door') return this.model.unlocked.has(id)
    if (target === 'gate') return this.model.attuned.has(id)
    if (target === 'lever') return this.model.pulled.has(id)
    if (target === 'lamp') return this.model.lit.includes(id)
    if (target === 'alcove') return this.model.memories.has(id)
    if (target === 'artifact') return this.model.claimed
    return false
  }

  #syncPainter(): void {
    const cols = this.model.built.cols, rows = this.model.built.rows
    const tiles: string[] = []
    for (let row = 0; row < rows; row++) {
      let line = ''
      for (let col = 0; col < cols; col++) line += paintSymbol(this.model.terrainAt(col, row))
      tiles.push(line)
    }
    const key = tiles.join('|')
    if (key === this.#painterKey) return
    this.#painterKey = key
    const map: CavernMap = { cols, rows, tiles, look: this.#definition.look === 'wood' ? 'wood' : 'cavern' }
    this.#painter = new CavernPainter(map)
  }

  #paintPortalSeed(portal: PortalMarker, id: string): void {
    const seed = this.#hooks.seatSeed?.(id) ?? null
    const key = seed ? `${seed.cols}x${seed.rows}:${seed.rgb.length}` : ''
    if (key === portal.seedKey) return
    portal.seedKey = key
    if (!seed) return
    portal.canvas.width = seed.cols
    portal.canvas.height = seed.rows
    const ctx = canvasContext(portal.canvas)
    if (!ctx) return
    seedPicture(seed).paint(ctx, 1)
  }

  #refresh(): void {
    if (!this.#root) return
    this.#syncPainter()
    this.#painter?.reveal(this.model.x, this.model.y)

    const cols = this.model.built.cols, rows = this.model.built.rows
    for (const [id, portal] of this.#portals) {
      const present = this.model.present(id)
      portal.button.hidden = !present
      if (present) this.#paintPortalSeed(portal, id)
    }
    for (const [id, feature] of this.#features) {
      feature.marker.hidden = !this.model.present(id)
      feature.marker.classList.toggle('is-active', this.#featureActive(id, feature.target))
    }
    for (const block of this.#definition.blocks) {
      const marker = this.#blockMarkers.get(block.id)
      if (!marker) continue
      const cell = this.model.blockCell(block.id)
      marker.style.setProperty('--col', String(cell.col))
      marker.style.setProperty('--row', String(cell.row))
    }
    if (this.#player) {
      this.#player.style.left = `${(this.model.x / cols) * 100}%`
      this.#player.style.top = `${(this.model.y / rows) * 100}%`
      this.#drawPlayer()
    }
    if (this.#cue) {
      const cue = this.model.cue()
      this.#cue.hidden = !cue
      if (cue) {
        if (this.#cue.textContent !== cue.words) this.#cue.textContent = cue.words
        this.#cue.dataset['action'] = cue.action
        this.#cue.style.left = `${((cue.anchor.col + 0.5) / cols) * 100}%`
        this.#cue.style.top = `${(cue.anchor.row / rows) * 100}%`
        this.#cue.classList.toggle('is-below', cue.anchor.row / rows < 0.3)
      }
    }
    if (this.#status && this.#status.textContent !== this.#notice) this.#status.textContent = this.#notice
    this.#draw()
  }

  #drawPlayer(): void {
    if (!this.#sprite) return
    const idleKey = `${this.model.facing}:idle`
    if (this.model.moving) {
      this.#sprite.clearRect(0, 0, 64, 64)
      drawWalker(this.#sprite, PLAYER_LOOK, this.model.facing, this.#time)
      this.#spriteKey = `${this.model.facing}:moving`
    } else if (this.#spriteKey !== idleKey) {
      this.#spriteKey = idleKey
      this.#sprite.clearRect(0, 0, 64, 64)
      drawWalker(this.#sprite, PLAYER_LOOK, this.model.facing, 0)
    }
  }

  #draw(): void {
    if (!this.#ctx || !this.#painter) return
    const cols = this.model.built.cols, rows = this.model.built.rows
    const camera: CavernCamera = { x: 0, y: 0, width: cols * TILE, height: rows * TILE, tile: TILE, dpr: this.#dpr }
    this.#painter.paintRock(this.#ctx, camera, this.#time)
    this.#painter.paintLight(this.#ctx, camera, { x: this.model.x, y: this.model.y }, this.#time, [])
  }
}

const CHAMBER_VIEW_CSS = `
.sol-chamber-view{display:flex;flex-direction:column;gap:10px;color:#e8edff;height:100%;min-height:0}
.sol-chamber-heading{display:flex;flex-direction:column;gap:2px;text-align:center}
.sol-chamber-eyebrow{font-size:11px;letter-spacing:.08em;color:#9db6d8}
.sol-chamber-heading h2{margin:0;font-size:18px}
.sol-chamber-heading p{margin:0;font-size:12px;color:#b7c7de}
.sol-chamber-map{position:relative;isolation:isolate;width:min(100%,640px);margin:0 auto;border-radius:8px;overflow:hidden;border:1px solid #5c749c;box-shadow:0 10px 26px rgba(0,0,0,.35)}
.sol-chamber-canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.sol-chamber-layer{position:absolute;inset:0}
.sol-chamber-portal,.sol-chamber-feature{position:absolute;left:calc((var(--col) + .5) / var(--cols) * 100%);top:calc((var(--row) + .5) / var(--rows) * 100%);transform:translate(-50%,-50%);width:calc(100% / var(--cols) * .86);height:calc(100% / var(--rows) * .86);border:none;padding:0;background:transparent;cursor:pointer;display:grid;place-items:center}
.sol-chamber-portal[hidden],.sol-chamber-feature[hidden]{display:none}
.sol-chamber-portal-seed{position:absolute;inset:8%;width:84%;height:84%;image-rendering:pixelated;opacity:.85;border-radius:3px}
.sol-chamber-portal-label{position:absolute;bottom:-16px;left:50%;transform:translateX(-50%);font-size:9px;white-space:nowrap;color:#cfe0f5;pointer-events:none}
.sol-chamber-feature{border-radius:50%;background:rgba(44,60,88,.8);box-shadow:inset 0 0 0 1px rgba(120,149,202,.4)}
.sol-chamber-feature.is-active{background:rgba(44,92,74,.8);box-shadow:inset 0 0 0 1px #6ee8cb}
.sol-chamber-feature-chest{border-radius:3px;background:rgba(92,67,34,.8)}
.sol-chamber-feature-chest.is-active{background:rgba(63,92,34,.8)}
.sol-chamber-feature-artifact{background:rgba(74,44,88,.8);box-shadow:inset 0 0 0 1px #d9a0ff}
.sol-chamber-block{position:absolute;left:calc((var(--col) + .5) / var(--cols) * 100%);top:calc((var(--row) + .5) / var(--rows) * 100%);transform:translate(-50%,-50%);width:calc(100% / var(--cols) * .72);height:calc(100% / var(--rows) * .72);border-radius:3px;pointer-events:none}
.sol-chamber-block-stone{background:linear-gradient(145deg,#9fa6ad,#5e646b);box-shadow:inset 0 0 0 1px #2c2f33}
.sol-chamber-block-barrel{background:radial-gradient(circle at 40% 30%,#c48a4a,#6b4522);border-radius:40%}
.sol-chamber-player{position:absolute;width:calc(100% / var(--cols) * 1.5);transform:translate(-50%,-72%);pointer-events:none;z-index:3}
.sol-chamber-cue{position:absolute;left:0;top:0;transform:translate(-50%,-100%);width:max-content;max-width:200px;padding:5px 10px;border-radius:10px;background:rgba(14,22,26,.86);border:1px solid rgba(255,240,200,.3);color:#fff4d6;font-size:11.5px;font-weight:600;text-align:center;box-shadow:0 4px 12px rgba(0,0,0,.35);pointer-events:none;z-index:4}
.sol-chamber-cue[data-action=tag]{font-weight:500;color:#d9e6df;border-style:dashed}
.sol-chamber-cue.is-below{transform:translate(-50%,10px)}
.sol-chamber-status{min-height:16px;font-size:12.5px;color:#c7d6ec;text-align:center}
.sol-chamber-controls{display:flex;justify-content:center;gap:10px;font-size:12px;color:#aebedb}
.sol-chamber-controls button{background:#28426c;border:1px solid #5c749c;color:#e8edff;border-radius:6px;padding:4px 10px;cursor:pointer;font:inherit}
.sol-chamber-dialog{position:absolute;inset:0;display:grid;place-items:center;background:rgba(6,10,16,.72);z-index:5}
.sol-chamber-dialog[hidden]{display:none}
.sol-chamber-dialog-card{max-width:360px;width:88%;background:#182338;border:1px solid #5c749c;border-radius:10px;padding:16px;box-shadow:0 16px 40px rgba(0,0,0,.5)}
.sol-chamber-dialog-title{margin:0 0 8px;font-size:16px}
.sol-chamber-dialog-inscription{font-style:italic;color:#c7d6ec}
.sol-chamber-dialog-options{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0}
.sol-chamber-dialog-option{background:#28426c;border:1px solid #5c749c;color:#e8edff;border-radius:6px;padding:6px 10px;cursor:pointer;font:inherit}
.sol-chamber-dialog-progress{font-size:12px;color:#9db6d8}
.sol-chamber-dialog-close{margin-top:10px;background:#28426c;border:1px solid #5c749c;color:#e8edff;border-radius:6px;padding:6px 12px;cursor:pointer;font:inherit}
@media(max-width:650px){.sol-chamber-heading h2{font-size:15px}.sol-chamber-status{font-size:11px}}
`
