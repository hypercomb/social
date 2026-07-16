// diamondcoreprocessor.com/games/solomon/overlay.ts
//
// The full-screen game shell. Owns the DOM (backdrop, toolbar, canvas, banners),
// the requestAnimationFrame loop, keyboard input for play, and pointer input for
// the designer. It's a self-contained mini-app: it never touches the hex grid or
// Pixi — it mounts above everything as a fixed overlay and tears itself fully
// down on close. The SolomonDrone owns its lifecycle (open/close).

import { Engine, TILE, SIM_DT, type LevelDef } from './engine.js'
import { Renderer } from './renderer.js'
import { Designer, TOOLS, type Tool } from './designer.js'
import {
  BUILTIN_LEVELS, PRINCESS_ROOM, SEAL_TOTAL,
  loadCustomLevels, upsertCustomLevel, deleteCustomLevel, cloneLevel,
} from './levels.js'
import { Overworld, OverworldView, type NodeDef } from './overworld.js'
import { Shaker, ParticleField, easeOutBack, ARCADE } from '../juice.js'
import { GameAudio } from '../audio.js'

const STYLE_ID = 'sol-overlay-styles'
const Z = 2147483000

const GAME_KEYS = new Set([
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', 'Spacebar', 'Enter',
  'a', 'A', 'd', 'D', 'w', 'W', 's', 'S',
  'j', 'J', 'k', 'K', 'z', 'Z', 'x', 'X', 'm', 'M', 'r', 'R',
])

type Mode = 'play' | 'design' | 'overworld'

// Sentinel "level index" for the Princess Room (not a BUILTIN_LEVELS index), and
// the overworld camera viewport size in px.
const PRINCESS_INDEX = 1000
const OVIEW_W = 720
const OVIEW_H = 452
// Cavern viewport (tiles). Caverns can now be ANY size: bigger than this scroll
// (a camera follows Dana); smaller ones fit + centre. Standard 20×13 rooms are
// unchanged (the cap only kicks in above it).
const VIEW_COLS = 22
const VIEW_ROWS = 14
// Camera feel. HORIZONTAL is a smooth Ghosts 'n Goblins follow — X_FOLLOW is the ease
// rate (higher = tighter tracking). VERTICAL still flip-scrolls room-to-room (ROOM_SLIDE
// seconds per screen) from Dana's grounded position, so a jump never bobs the view.
const ROOM_SLIDE = 0.32
const X_FOLLOW = 9

// Level-clear flow (continuous play — identical to the Bubble overlay so every
// game advances the same way): on clearing a screen we tally the level's score
// (+ any perfect bonus) counting up, then scroll the next level UP from the
// bottom — no button press, you just keep playing. Score + lives carry across
// levels; the toolbar still has prev / next / restart for jumping around.
const TALLY_MS = 1.7          // how long the score add-up reads
const PERFECT_BONUS = 1000    // awarded when a cavern is cleared without dying

/** A cavern-clear interlude: count the score up, then act — surface to the
 *  overworld map, replay a designer test, or roll the Princess true ending. */
interface Transition {
  t: number
  levelScore: number      // points earned in the just-cleared cavern
  timeBonus: number       // remaining life-meter converted to score (NES time bonus)
  bonus: number           // perfect-clear bonus (0 if a life was lost)
  baseScore: number       // running total at the start of the cavern
  prev: Engine            // the cleared engine, drawn under the tally
  princess: boolean       // after the tally → the Princess true ending
  testing: boolean        // after the tally → replay the designer test level
}

export class SolomonOverlay {
  #root: HTMLDivElement | null = null
  #canvas: HTMLCanvasElement | null = null
  #ctx: CanvasRenderingContext2D | null = null
  #renderer: Renderer | null = null
  #stage: HTMLDivElement | null = null
  #banner: HTMLDivElement | null = null
  #status: HTMLSpanElement | null = null
  #levelLabel: HTMLSpanElement | null = null
  #playBar: HTMLDivElement | null = null
  #designBar: HTMLDivElement | null = null
  #nameInput: HTMLInputElement | null = null
  #loadSelect: HTMLSelectElement | null = null
  #toolButtons = new Map<Tool, HTMLButtonElement>()

  #mode: Mode = 'play'
  #engine: Engine | null = null
  #designer = new Designer()

  #levels: LevelDef[] = []
  #levelIndex = 0

  // The Zelda-like overworld + the running journey carried cavern → cavern. Each
  // cavern is a fresh attempt (3 lives); score, fairies, seals and pages persist.
  #overworld: Overworld | null = null
  #owView: OverworldView | null = null
  #currentCavern = 0
  #journey = { score: 0, fairyCount: 0, sealCount: 0, pageTime: false, pageSpace: false }
  #mapBtn: HTMLButtonElement | null = null

  #raf = 0
  #lastTs = 0
  #time = 0
  #acc = 0        // fixed-timestep accumulator — the sim always steps at SIM_DT
  #overShown = false

  // Zelda room camera: the sliding origin (#cam), the room indices Dana occupies
  // (#room, for hysteresis), and a flag to snap to the starting room on entry.
  #cam = { x: 0, y: 0 }
  #room = { x: 0, y: 0 }
  #anchor = { x: 0, y: 0 }   // Dana's last grounded centre — jumps don't move the room
  #camInit = false

  // Smooth high-res render (matching the Bubble/Arkanoid pipeline): the world is
  // drawn in logical viewport units (#logicalW/H, world px) through a single
  // device-space scale (#scaleBack = cssScale × dpr) with smoothing ON, so curves
  // and gradients render crisp instead of chunky-pixelated.
  #logicalW = 1
  #logicalH = 1
  #scaleBack = 1

  // juice: trauma screen-shake + a short additive particle field + a level-intro
  // title card — the shared "modern vector arcade" kit, mirroring the Bubble
  // overlay. Solomon is pixel-crisp (no scale transform, smoothing OFF), so the
  // shaker runs SMALL and its offset is ROUNDED into the frame each draw. Shake
  // is driven purely by score/lives/conjure deltas read after engine.update().
  #shaker = new Shaker(7, 1.8)
  #field = new ParticleField()
  #audio = new GameAudio()
  #muteBtn: HTMLButtonElement | null = null
  #prevScore = 0
  #prevLives = 3
  #prevConjure = 0
  #prevSmash = 0
  #prevPickup = 0
  // new engine event counters (diffed after update — same doctrine as above)
  #prevKill = 0
  #prevShot = 0
  #prevSpawn = 0
  #prevSecret = 0
  #prevReveal = 0
  #prevJump = 0
  #prevLand = 0
  #prevFire = 0
  #prevDoor = false
  #prevFairies = 0
  #prevFairyCount = 0
  #prevLifeLow = false
  #tallyTick = -1
  #intro: { t: number; title: string; sub: string } | null = null

  // Continuous-play state (see the Transition note above). The engine's score is
  // the RUNNING total carried across levels; the snapshots below record where the
  // current level began so a clear can show its own gain + award a perfect bonus.
  #transition: Transition | null = null
  #levelStartScore = 0
  #levelStartLives = 3
  #testing = false   // playing a designer test (not part of the level list)
  // Meta-progression flow: a constellation panel detours through the fairy bonus
  // room; clearing the final room shows the victory banner (and freezes play).
  #inBonus = false
  #inPrincess = false
  #bonusResumeIndex = 0
  #ended = false

  // designer pointer paint state
  #painting = false
  #lastCell = { col: -1, row: -1 }
  #hover: { col: number; row: number } | null = null
  #onClose: () => void

  constructor(onClose: () => void) {
    this.#onClose = onClose
  }

  get engine(): Engine | null { return this.#engine }
  isMounted(): boolean { return !!this.#root }

  /** Jump straight to the level designer (used by `/solomon design`). */
  showDesigner(): void { this.#setMode('design') }

  // ── lifecycle ────────────────────────────────────────────

  mount(): void {
    if (this.#root) return
    this.#injectStyles()
    this.#refreshLevels()
    ;(document.activeElement as HTMLElement | null)?.blur?.()
    this.#build()
    this.#setupOverworld()
    this.#enterOverworld()
    window.addEventListener('keydown', this.#onKeyDown, true)
    window.addEventListener('keyup', this.#onKeyUp, true)
    window.addEventListener('resize', this.#fit)
    // Designer paint tracks via WINDOW-level pointer events (not canvas-level)
    // so dragging a stroke past the canvas edge keeps painting to the last
    // in-bounds cell instead of freezing until the cursor returns. pointerdown
    // stays on the canvas — a stroke can only START on the grid.
    window.addEventListener('pointermove', this.#onPointerMove)
    window.addEventListener('pointerup', this.#onPointerUp)
    this.#lastTs = 0
    this.#raf = requestAnimationFrame(this.#loop)
  }

  unmount(): void {
    if (this.#raf) cancelAnimationFrame(this.#raf)
    this.#raf = 0
    window.removeEventListener('keydown', this.#onKeyDown, true)
    window.removeEventListener('keyup', this.#onKeyUp, true)
    window.removeEventListener('resize', this.#fit)
    window.removeEventListener('pointermove', this.#onPointerMove)
    window.removeEventListener('pointerup', this.#onPointerUp)
    this.#audio.stopAmbience()
    this.#audio.dispose()
    this.#root?.remove()
    this.#root = null
    this.#canvas = null
    this.#ctx = null
    this.#renderer = null
    this.#engine = null
  }

  // ── DOM construction ─────────────────────────────────────

  #build(): void {
    const root = el('div', { class: 'sol-overlay' }) as HTMLDivElement
    root.style.zIndex = String(Z)

    // ── top bar ──
    const bar = el('div', { class: 'sol-bar' })
    bar.appendChild(el('span', { class: 'sol-logo', text: '✦ Solomon’s Key' }))

    const tabs = el('div', { class: 'sol-tabs' })
    const playTab = el('button', { class: 'sol-tab on', text: 'Play' }) as HTMLButtonElement
    const designTab = el('button', { class: 'sol-tab', text: 'Design' }) as HTMLButtonElement
    playTab.onclick = () => this.#setMode('play')
    designTab.onclick = () => this.#setMode('design')
    tabs.append(playTab, designTab)
    bar.appendChild(tabs)

    // play controls
    const playBar = el('div', { class: 'sol-ctl' }) as HTMLDivElement
    const prev = el('button', { class: 'sol-btn', text: '‹' }) as HTMLButtonElement
    const next = el('button', { class: 'sol-btn', text: '›' }) as HTMLButtonElement
    const label = el('span', { class: 'sol-level-label' }) as HTMLSpanElement
    const restart = el('button', { class: 'sol-btn', text: '↻ Restart' }) as HTMLButtonElement
    const mapBtn = el('button', { class: 'sol-btn', text: '🗺 Map' }) as HTMLButtonElement
    prev.onclick = () => this.#cycleCavern(-1)
    next.onclick = () => this.#cycleCavern(1)
    restart.onclick = () => this.#restartCurrent()
    mapBtn.onclick = () => this.#enterOverworld()
    playBar.append(prev, label, next, restart, mapBtn)
    this.#mapBtn = mapBtn
    bar.appendChild(playBar)
    this.#playBar = playBar
    this.#levelLabel = label

    // design controls
    const designBar = el('div', { class: 'sol-ctl sol-hidden' }) as HTMLDivElement
    const palette = el('div', { class: 'sol-palette' })
    for (const t of TOOLS) {
      const b = el('button', { class: 'sol-tool', title: t.label, text: t.glyph }) as HTMLButtonElement
      b.onclick = () => this.#setTool(t.tool)
      this.#toolButtons.set(t.tool, b)
      palette.appendChild(b)
    }
    designBar.appendChild(palette)
    const nameInput = el('input', { class: 'sol-name', placeholder: 'level name' }) as HTMLInputElement
    nameInput.value = this.#designer.level.name
    designBar.appendChild(nameInput)
    this.#nameInput = nameInput
    const mkBtn = (txt: string, fn: () => void) => { const b = el('button', { class: 'sol-btn', text: txt }) as HTMLButtonElement; b.onclick = fn; return b }
    designBar.appendChild(mkBtn('New', () => this.#designerNew()))
    designBar.appendChild(mkBtn('Save', () => this.#designerSave()))
    designBar.appendChild(mkBtn('▶ Test', () => this.#designerTest()))
    const loadSel = el('select', { class: 'sol-select' }) as HTMLSelectElement
    loadSel.onchange = () => this.#designerLoad(loadSel.value)
    designBar.appendChild(loadSel)
    this.#loadSelect = loadSel
    designBar.appendChild(mkBtn('Delete', () => this.#designerDelete()))
    designBar.appendChild(mkBtn('Export', () => this.#designerExport()))
    designBar.appendChild(mkBtn('Import', () => this.#designerImport()))
    bar.appendChild(designBar)
    this.#designBar = designBar

    const status = el('span', { class: 'sol-status' }) as HTMLSpanElement
    bar.appendChild(status)
    this.#status = status

    const mute = el('button', { class: 'sol-btn', text: this.#audio.muted ? '🔇' : '🔊', title: 'Sound on/off' }) as HTMLButtonElement
    mute.onclick = () => {
      this.#audio.unlock()
      mute.textContent = this.#audio.toggleMuted() ? '🔇' : '🔊'
    }
    bar.appendChild(mute)
    this.#muteBtn = mute

    const close = el('button', { class: 'sol-close', text: '✕', title: 'Close (Esc)' }) as HTMLButtonElement
    close.onclick = () => this.#onClose()
    bar.appendChild(close)

    root.appendChild(bar)

    // ── stage ──
    const stage = el('div', { class: 'sol-stage' }) as HTMLDivElement
    const canvas = el('canvas', { class: 'sol-canvas' }) as HTMLCanvasElement
    canvas.addEventListener('pointerdown', this.#onPointerDown)
    stage.appendChild(canvas)
    const banner = el('div', { class: 'sol-banner sol-hidden' }) as HTMLDivElement
    stage.appendChild(banner)
    root.appendChild(stage)
    this.#stage = stage
    this.#banner = banner

    // ── help ──
    const help = el('div', { class: 'sol-help' })
    help.innerHTML = '<b>Map:</b> <b>← → ↑ ↓</b> walk · <b>↵ / Z</b> enter a cavern &nbsp;&nbsp;|&nbsp;&nbsp; <b>Cavern:</b> <b>← →</b> move · <b>↑</b> jump · <b>↓</b> duck · <b>Z</b> conjure/dispel · <b>X</b> fireball <i>(needs a jar)</i> · <b>M</b> map · <b>R</b> restart · <b>Esc</b> close'
    root.appendChild(help)

    document.body.appendChild(root)
    this.#root = root
    this.#canvas = canvas
    this.#ctx = canvas.getContext('2d')
    if (this.#ctx) { this.#ctx.imageSmoothingEnabled = true; this.#renderer = new Renderer(this.#ctx); this.#owView = new OverworldView(this.#ctx) }
    this.#refreshLoadSelect()
  }

  // ── mode + level control ─────────────────────────────────

  #setMode(mode: Mode): void {
    if (mode === 'design') {
      if (this.#mode === 'design') return
      this.#mode = 'design'
      this.#engine = null
      this.#transition = null
      this.#hideBanner()
      this.#sizeCanvasTo(this.#designer.level)
      this.#updateToolButtons()
      this.#updateModeUI()
    } else {
      this.#enterOverworld() // the "Play" tab is the overworld hub
    }
  }

  /** Sync the top-bar chrome to the current mode (tabs, button visibility, label). */
  #updateModeUI(): void {
    const onPlay = this.#mode !== 'design'
    this.#root?.querySelectorAll('.sol-tab').forEach((t, i) => t.classList.toggle('on', (i === 0) === onPlay))
    this.#playBar?.classList.toggle('sol-hidden', !onPlay)
    this.#designBar?.classList.toggle('sol-hidden', this.#mode !== 'design')
    this.#mapBtn?.classList.toggle('sol-hidden', this.#mode !== 'play') // "to map" only inside a cavern
    if (this.#levelLabel) {
      this.#levelLabel.textContent = this.#mode === 'overworld'
        ? '🗺 Overworld — walk into a cavern'
        : this.#mode === 'design' ? this.#designer.level.name
          : this.#currentCavern === PRINCESS_INDEX ? '👑 Princess Room'
            : `Cavern ${this.#currentCavern + 1} — ${BUILTIN_LEVELS[this.#currentCavern]?.name ?? ''}`
    }
  }

  #refreshLevels(): void {
    this.#levels = [...BUILTIN_LEVELS.map(cloneLevel), ...loadCustomLevels()]
    if (this.#levelIndex >= this.#levels.length) this.#levelIndex = 0
  }

  // ── the overworld journey ────────────────────────────────

  #setupOverworld(): void {
    const defs: NodeDef[] = BUILTIN_LEVELS.map((l, i) => ({ levelIndex: i, name: l.name, label: i + 1 }))
    defs.push({ levelIndex: PRINCESS_INDEX, name: 'Princess Room', label: 0 })
    this.#overworld = new Overworld(defs)
    this.#overworld.unlock(0) // the first cavern is always open
    this.#owView?.reset()
    this.#journey = { score: 0, fairyCount: 0, sealCount: 0, pageTime: false, pageSpace: false }
    this.#currentCavern = 0
  }

  #restartJourney(): void { this.#setupOverworld(); this.#enterOverworld() }

  #enterOverworld(): void {
    if (!this.#overworld) this.#setupOverworld()
    this.#mode = 'overworld'
    this.#engine = null
    this.#testing = false
    this.#transition = null
    this.#ended = false
    this.#intro = null
    this.#hideBanner()
    this.#logicalW = OVIEW_W
    this.#logicalH = OVIEW_H
    this.#fit()
    this.#updateModeUI()
    this.#audio.startAmbience({ level: 0.5 })
    this.#sfx('surface')
  }

  /** Drop into a cavern from the map (or jump there directly via prev/next). */
  #enterCavern(levelIndex: number): void {
    const def = levelIndex === PRINCESS_INDEX ? PRINCESS_ROOM : (BUILTIN_LEVELS[levelIndex] ?? BUILTIN_LEVELS[0])
    if (!def) return
    this.#currentCavern = levelIndex
    this.#inPrincess = levelIndex === PRINCESS_INDEX
    this.#mode = 'play'
    this.#engine = new Engine(cloneLevel(def))
    const e = this.#engine
    e.score = this.#journey.score          // score + meta carry across the journey…
    e.fairyCount = this.#journey.fairyCount
    e.sealCount = this.#journey.sealCount
    e.pageTime = this.#journey.pageTime
    e.pageSpace = this.#journey.pageSpace
    // …lives are a fresh 3 per cavern (the engine default).
    this.#testing = false
    this.#transition = null
    this.#ended = false
    this.#overShown = false
    this.#levelStartScore = e.score
    this.#levelStartLives = e.lives
    this.#syncJuice(e)
    this.#camInit = false   // snap the room camera to the starting room
    this.#acc = 0
    this.#hideBanner()
    this.#sizeCanvasToView(def)
    this.#updateModeUI()
    this.#audio.startAmbience({ level: 1 })
    this.#sfx('descend')
    this.#beginIntro(def.name, this.#inPrincess ? 'RESCUE!' : 'CAVERN ' + (levelIndex + 1))
  }

  /** prev/next cavern — direct nav, ignoring locks (a convenience). */
  #cycleCavern(dir: number): void {
    const base = this.#currentCavern === PRINCESS_INDEX ? BUILTIN_LEVELS.length - 1 : this.#currentCavern
    this.#enterCavern((base + dir + BUILTIN_LEVELS.length) % BUILTIN_LEVELS.length)
  }

  /** A cavern was cleared: bank the journey gains, mark it on the map, unlock the
   *  way forward, and surface back onto the overworld at its mouth. */
  #afterCavernClear(prev: Engine): void {
    this.#journey.score = prev.score
    this.#journey.fairyCount = prev.fairyCount
    this.#journey.sealCount = prev.sealCount
    this.#journey.pageTime = prev.pageTime
    this.#journey.pageSpace = prev.pageSpace
    const ow = this.#overworld
    if (ow) {
      ow.markCleared(this.#currentCavern)
      if (this.#currentCavern !== PRINCESS_INDEX && this.#currentCavern + 1 < BUILTIN_LEVELS.length) ow.unlock(this.#currentCavern + 1)
      if (BUILTIN_LEVELS.every((_, i) => ow.cleared.has(i))) ow.unlock(PRINCESS_INDEX) // all cleared → Princess opens
      ow.spawnAt(this.#currentCavern)
    }
    this.#enterOverworld()
  }

  #sizeCanvasTo(level: { cols: number; rows: number }): void {
    this.#logicalW = level.cols * TILE
    this.#logicalH = level.rows * TILE
    this.#fit()
  }

  /** Size the LOGICAL viewport to the CAVERN viewport — capped so big caverns scroll
   *  while small ones still fit exactly (no letterbox). The backing store is sized in
   *  #fit (logical × cssScale × dpr) for a crisp high-res render. */
  #sizeCanvasToView(level: { cols: number; rows: number }): void {
    this.#logicalW = Math.min(level.cols, VIEW_COLS) * TILE
    this.#logicalH = Math.min(level.rows, VIEW_ROWS) * TILE
    this.#fit()
  }

  /** GHOSTS 'N GOBLINS CAMERA. HORIZONTAL is a smooth follow — the screen glides
   *  sideways to keep Dana framed as he traverses the terrain. VERTICAL flip-scrolls
   *  room-to-room from Dana's GROUNDED position: a jump is a transient hop back to the
   *  same ground, so it never bobs the view; only landing in a new vertical band shifts
   *  it. A big airborne fall drags the vertical anchor so he can't drift off-screen;
   *  death-respawn snaps both axes. */
  #roomCamera(e: Engine, dt: number): { x: number; y: number } {
    const vw = this.#logicalW || e.width, vh = this.#logicalH || e.height
    const init = !this.#camInit
    const px = e.player.x + e.player.w / 2, py = e.player.y + e.player.h / 2
    // Vertical anchor: hold at Dana's grounded centre; catch up on a long fall/leap.
    if (init || e.onGround) this.#anchor.y = py
    else if (Math.abs(py - this.#anchor.y) > vh * 0.55) this.#anchor.y = py

    const maxX = Math.max(0, e.width - vw), maxY = Math.max(0, e.height - vh)
    const tx = maxX <= 0 ? 0 : Math.max(0, Math.min(px - vw / 2, maxX))   // smooth horizontal follow
    const ty = this.#axisCam('y', this.#anchor.y, vh, maxY, e.height, init) // discrete vertical room-shift

    if (init) { this.#cam.x = tx; this.#cam.y = ty; this.#camInit = true }
    else {
      // X eases toward the live target (tight, smooth G'nG scroll); a respawn snaps.
      if (Math.abs(tx - this.#cam.x) > vw * 1.05) this.#cam.x = tx
      else this.#cam.x += (tx - this.#cam.x) * Math.min(1, dt * X_FOLLOW)
      // Y flip-scrolls at the room-slide speed; a multi-room jump (respawn) snaps.
      if (Math.abs(ty - this.#cam.y) > vh * 1.05) this.#cam.y = ty
      else this.#cam.y += Math.max(-(vh / ROOM_SLIDE) * dt, Math.min(ty - this.#cam.y, (vh / ROOM_SLIDE) * dt))
    }
    return { x: this.#cam.x, y: this.#cam.y }
  }

  /** Per-axis room-origin target — ALWAYS discrete (no smooth follow). `maxO` = max
   *  camera offset (level − viewport). Hysteresis (a margin past the boundary) keeps a
   *  seam from jittering. `p` is the grounded anchor, so jumps don't change the band. */
  #axisCam(axis: 'x' | 'y', p: number, view: number, maxO: number, levelDim: number, reset: boolean): number {
    if (maxO <= 0) return 0                                            // level fits this axis
    const rooms = Math.ceil(levelDim / view)
    const band = levelDim / rooms                                      // one room's width in world px
    const m = TILE * 0.8                                               // hysteresis margin
    let idx = reset ? Math.max(0, Math.min(rooms - 1, Math.floor(p / band))) : this.#room[axis]
    while (idx > 0 && p < idx * band - m) idx--
    while (idx < rooms - 1 && p > (idx + 1) * band + m) idx++
    this.#room[axis] = idx
    return Math.round(idx * (maxO / (rooms - 1)))
  }

  /** Fit the LOGICAL viewport into the stage, then size the backing store to the
   *  displayed pixels × dpr (capped at 2) for a crisp, smoothed high-res render.
   *  #scaleBack maps world units → device pixels in the loop's setTransform. */
  #fit = (): void => {
    const c = this.#canvas, s = this.#stage
    if (!c || this.#logicalW <= 0 || this.#logicalH <= 0) return
    const availW = (s?.clientWidth ?? 0) - 24
    const availH = (s?.clientHeight ?? 0) - 24
    // Before the stage has laid out (avail ≤ 0) fall back to a 1:1 fit so the canvas
    // is never 0×0; a later #fit (resize / mode change) refines it.
    const cssScale = availW > 0 && availH > 0 ? Math.min(availW / this.#logicalW, availH / this.#logicalH) : 1
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    c.width = Math.round(this.#logicalW * cssScale * dpr)
    c.height = Math.round(this.#logicalH * cssScale * dpr)
    c.style.width = `${Math.round(this.#logicalW * cssScale)}px`
    c.style.height = `${Math.round(this.#logicalH * cssScale)}px`
    this.#scaleBack = cssScale * dpr
    if (this.#ctx) this.#ctx.imageSmoothingEnabled = true
  }

  // ── the loop ─────────────────────────────────────────────

  #loop = (ts: number): void => {
    if (!this.#root) return
    if (!this.#lastTs) this.#lastTs = ts
    const dt = Math.min((ts - this.#lastTs) / 1000, 0.1)
    this.#lastTs = ts
    this.#time += dt

    const ctx = this.#ctx, r = this.#renderer
    if (!ctx || !r) { this.#raf = requestAnimationFrame(this.#loop); return }

    // Everything is drawn in LOGICAL world units through #scaleBack (cssScale × dpr)
    // for a crisp, smoothed high-res render. Clear the whole backing buffer in device
    // space first (so a shake/camera translate can never smear the trailing edge),
    // then set the world transform per pass: WORLD passes fold in the camera + shake,
    // SCREEN passes (HUD / intro / overworld / designer) use the bare scale.
    const SB = this.#scaleBack
    const view = { w: this.#logicalW, h: this.#logicalH }
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)

    if (this.#mode === 'overworld' && this.#overworld && this.#owView) {
      this.#overworld.update(dt)
      ctx.setTransform(SB, 0, 0, SB, 0, 0)
      this.#owView.draw(this.#overworld, view.w, view.h, this.#time)
    } else if (this.#mode === 'play' && this.#engine) {
      this.#shaker.update(dt)
      const sh = this.#shaker.offset()
      if (this.#transition) {
        // Cavern cleared: the sim is frozen while the score tallies, then we surface.
        ctx.setTransform(SB, 0, 0, SB, 0, 0)
        this.#stepTransition(dt)
        this.#drawTransition(r, view)
      } else {
        // Fixed-timestep sim: deterministic arcs for the block puzzles. At most 4
        // steps per frame (spiral guard — the remainder is dropped on a long stall);
        // camera / shake / particles / tally still integrate with the frame dt.
        this.#acc += dt
        let steps = 0
        while (this.#acc >= SIM_DT && steps < 4) { this.#engine.update(SIM_DT); this.#acc -= SIM_DT; steps++ }
        if (steps === 4) this.#acc = 0
        this.#senseJuice(dt)
        // The room camera locks to Dana's screen and slides between rooms (Zelda);
        // the shake folds into the same world translate.
        const cam = this.#roomCamera(this.#engine, dt)
        ctx.setTransform(SB, 0, 0, SB, (-cam.x + sh.x) * SB, (-cam.y + sh.y) * SB)
        r.drawWorld(this.#engine, this.#time)
        this.#field.update(dt)
        this.#field.draw(ctx)
        // HUD + intro are screen-fixed (no camera, no shake)
        ctx.setTransform(SB, 0, 0, SB, 0, 0)
        r.drawHud(this.#engine, this.#time, view.w, view.h)
        this.#drawIntro(ctx, view, dt)
        if (this.#engine.state === 'won' && !this.#ended) this.#beginClear()
        else if (this.#engine.state === 'gameover' && !this.#overShown) { this.#overShown = true; this.#showGameOver() }
      }
    } else if (this.#mode === 'design') {
      ctx.setTransform(SB, 0, 0, SB, 0, 0)
      r.drawEditor(this.#designer.level, this.#hover, this.#time)
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    this.#raf = requestAnimationFrame(this.#loop)
  }

  // ── juice: shake + particles + level intro ───────────────

  /** Procedural SFX recipes. Each is a couple of tones / filtered noise bursts —
   *  no assets. Intensity `k` scales the impact sounds. */
  #sfx(name: string, k = 1): void {
    const a = this.#audio
    switch (name) {
      case 'conjure': a.tone({ freq: 220, endFreq: 110, type: 'triangle', dur: 0.09, vol: 0.14 }); a.noise({ dur: 0.12, vol: 0.06, filter: 'lowpass', freq: 420 }); break
      case 'dispel': a.tone({ freq: 160, endFreq: 320, type: 'triangle', dur: 0.08, vol: 0.12 }); a.tone({ freq: 1320, dur: 0.05, vol: 0.05, delay: 0.02 }); a.tone({ freq: 1760, dur: 0.05, vol: 0.04, delay: 0.05 }); break
      case 'deny': a.tone({ freq: 110, endFreq: 95, type: 'square', dur: 0.05, vol: 0.05 }); a.noise({ dur: 0.04, vol: 0.03, filter: 'lowpass', freq: 300 }); break
      case 'secret': a.tone({ freq: 880, dur: 0.08, vol: 0.09 }); a.tone({ freq: 1174, dur: 0.1, vol: 0.09, delay: 0.07 }); a.tone({ freq: 1568, dur: 0.16, vol: 0.09, delay: 0.14 }); break
      case 'reveal': a.tone({ freq: 660, dur: 0.06, vol: 0.08 }); a.tone({ freq: 990, dur: 0.1, vol: 0.08, delay: 0.05 }); break
      case 'crack': a.noise({ dur: 0.06, vol: 0.1, filter: 'highpass', freq: 1200 }); a.tone({ freq: 130, endFreq: 70, dur: 0.06, vol: 0.06 }); break
      case 'shatter': a.noise({ dur: 0.2, vol: 0.14, filter: 'bandpass', freq: 500, endFreq: 200, q: 0.8 }); a.tone({ freq: 120, endFreq: 60, type: 'square', dur: 0.09, vol: 0.05 }); break
      case 'jump': a.tone({ freq: 300, endFreq: 430, dur: 0.06, vol: 0.1 }); break
      case 'land': a.tone({ freq: 90, endFreq: 60, dur: 0.08, vol: 0.06 + 0.08 * k }); a.noise({ dur: 0.07, vol: 0.04 + 0.06 * k, filter: 'lowpass', freq: 260 }); break
      case 'fireball': a.noise({ dur: 0.15, vol: 0.1, filter: 'highpass', freq: 2000, endFreq: 600 }); a.tone({ freq: 200, endFreq: 90, dur: 0.14, vol: 0.09 }); break
      case 'pickup': a.tone({ freq: 880, dur: 0.07, vol: 0.09 }); a.tone({ freq: 1320, dur: 0.09, vol: 0.08, delay: 0.05 }); break
      case 'key': a.tone({ freq: 660, dur: 0.08, vol: 0.1 }); a.tone({ freq: 880, dur: 0.08, vol: 0.1, delay: 0.08 }); a.tone({ freq: 1100, dur: 0.14, vol: 0.1, delay: 0.16 }); break
      case 'hourglass': for (let i = 0; i < 4; i++) a.tone({ freq: 700 + i * 160, dur: 0.05, vol: 0.07, delay: i * 0.05 }); break
      case 'doorOpen': a.tone({ freq: 98, dur: 0.8, vol: 0.12, attack: 0.02 }); a.tone({ freq: 784, dur: 0.3, vol: 0.05, delay: 0.15 }); a.tone({ freq: 988, dur: 0.35, vol: 0.05, delay: 0.28 }); a.tone({ freq: 1175, dur: 0.4, vol: 0.05, delay: 0.42 }); break
      case 'clear': for (const [i, f] of [523, 659, 784, 1047].entries()) a.tone({ freq: f, dur: 0.16, vol: 0.11, delay: i * 0.09 }); break
      case 'kill': a.tone({ freq: 260, endFreq: 90, type: 'square', dur: 0.12, vol: 0.09 }); a.noise({ dur: 0.1, vol: 0.07, filter: 'lowpass', freq: 700 }); break
      case 'poof': a.noise({ dur: 0.14, vol: 0.05, filter: 'lowpass', freq: 500 }); break
      case 'spit': a.tone({ freq: 320, endFreq: 180, type: 'sawtooth', dur: 0.09, vol: 0.06 }); a.noise({ dur: 0.05, vol: 0.04, filter: 'highpass', freq: 1600 }); break
      case 'spawn': a.tone({ freq: 110, type: 'sawtooth', dur: 0.14, vol: 0.07 }); a.tone({ freq: 113, type: 'sawtooth', dur: 0.14, vol: 0.06 }); break
      case 'death': a.tone({ freq: 400, endFreq: 60, type: 'sawtooth', dur: 0.35, vol: 0.13 }); a.noise({ dur: 0.18, vol: 0.1, filter: 'lowpass', freq: 300, delay: 0.05 }); a.duck(0.5, 1.2); break
      case 'gameover': a.tone({ freq: 196, dur: 0.4, vol: 0.12 }); a.tone({ freq: 147, dur: 0.7, vol: 0.12, delay: 0.35 }); break
      case 'bell': a.tone({ freq: 1568, dur: 0.2, vol: 0.08 }); a.tone({ freq: 2093, dur: 0.24, vol: 0.06, delay: 0.03 }); break
      case 'fairy': for (let i = 0; i < 3; i++) a.tone({ freq: 1047 + i * 262, dur: 0.07, vol: 0.06, delay: i * 0.05 }); break
      case 'lowLife': a.tone({ freq: 440, endFreq: 436, dur: 0.3, vol: 0.1 }); break
      case 'tick': a.tone({ freq: 1200, type: 'square', dur: 0.018, vol: 0.04 }); break
      case 'ding': a.tone({ freq: 1047, dur: 0.14, vol: 0.09 }); break
      case 'descend': a.noise({ dur: 0.35, vol: 0.08, filter: 'lowpass', freq: 900, endFreq: 200 }); break
      case 'surface': a.noise({ dur: 0.35, vol: 0.07, filter: 'lowpass', freq: 200, endFreq: 900 }); break
    }
  }

  /** Read the post-update engine state and convert meaningful changes into
   *  shake, particles, light spikes and SFX. Pure inference over the engine's
   *  flash counters keeps the sim free of any view concerns. Called inside the
   *  shaken frame, so bursts land in world units under the same translate. */
  #senseJuice(_dt: number): void {
    const e = this.#engine
    const r = this.#renderer
    if (!e) return
    const cellXY = (c: { col: number; row: number }): [number, number] => [c.col * TILE + TILE / 2, c.row * TILE + TILE / 2]

    // Life lost — big kick, sparks, a hurt tint and a master-volume duck.
    if (e.lives < this.#prevLives) {
      this.#shaker.add(0.9)
      r?.spike(0.8)
      r?.punch('hurt')
      this.#sfx('death')
      const px = e.player.x + e.player.w / 2
      const py = e.player.y + e.player.h / 2
      this.#field.burst(px, py, {
        count: 22, speed: 140, gravity: 260, life: 0.6,
        size: 2.6, color: [...ARCADE.spark],
      })
    }

    // Takeoff + landing — feet dust scaled by the impact speed.
    if (e.jumpFlash > this.#prevJump) {
      this.#sfx('jump')
      this.#field.burst(e.player.x + e.player.w / 2, e.player.y + e.player.h, {
        count: 3, speed: 40, gravity: 60, life: 0.3, size: 1.8,
        color: ['#c9b8a0', '#8a7a64'], angle: Math.PI / 2, arc: 1.2,
      })
    }
    if (e.landFlash > this.#prevLand + 1e-4) {
      const k = Math.min(1.4, e.landVy / 400)
      r?.punch('land', k)
      this.#sfx('land', k)
      if (e.landVy > 180) {
        this.#field.burst(e.player.x + e.player.w / 2, e.player.y + e.player.h, {
          count: Math.round(5 + k * 8), speed: 55, gravity: 90, life: 0.5, size: 2,
          color: ['#c9b8a0', '#8a7a64', '#6b5b48'], angle: -Math.PI / 2, arc: 2.4,
        })
      }
    }

    // Conjure / dispel — the wand's stone-dust puff at the target cell.
    if (e.conjureFlash > this.#prevConjure + 1e-4) {
      this.#shaker.add(0.18)
      r?.spike(0.25)
      const [cx, cy] = cellXY(e.targetCell())
      this.#field.burst(cx, cy, {
        count: 10, speed: 90, gravity: 120, life: 0.45,
        size: 2.2, color: [...ARCADE.ember], angle: -Math.PI / 2, arc: 1.6,
      })
    }

    // Brick cracked or shattered (head-butt, goblin punch, ghost/neul smash,
    // enemy shots) — debris at the cell; a lighter tick for a first-hit crack.
    if (e.smashFlash > this.#prevSmash + 1e-4) {
      if (e.smashFlash <= 0.11) this.#sfx('crack')
      else if (e.smashCell) {
        this.#shaker.add(0.34)
        r?.spike(0.3)
        this.#sfx('shatter')
        const [sx, sy] = cellXY(e.smashCell)
        this.#field.burst(sx, sy, {
          count: 16, speed: 130, gravity: 340, life: 0.5,
          size: 2.6, color: [...ARCADE.ember],
        })
      }
    }

    // Item grabbed — sparkle + a per-kind chime (looked up via the pickup cell).
    if (e.pickupFlash > this.#prevPickup && e.pickupCell) {
      const [cx, cy] = cellXY(e.pickupCell)
      this.#field.burst(cx, cy, {
        count: 12, speed: 80, gravity: 30, life: 0.5,
        size: 2.2, color: [...ARCADE.spark],
      })
      const it = e.items.find(i => i.taken && i.col === e.pickupCell!.col && i.row === e.pickupCell!.row)
      const kind = it?.kind
      if (kind === 'key') this.#sfx('key')
      else if (kind === 'hourglass' || kind === 'hourglassHalf') this.#sfx('hourglass')
      else if (kind === 'bell') this.#sfx('bell')
      else if (kind === 'fairy' || kind === 'seal' || kind === 'zodiac') this.#sfx('fairy')
      else this.#sfx('pickup')
    }

    // Enemy killed — a cause-colored squish burst at the cell.
    if (e.killFlash > this.#prevKill && e.killCell) {
      const [kx, ky] = cellXY(e.killCell)
      const colors = e.killCause === 'crush' ? [...ARCADE.ember]
        : e.killCause === 'fire' ? [...ARCADE.spark]
          : e.killCause === 'expire' ? ['#8a6a9a', '#5a4a6a']
            : ['#c9b8a0', '#8a7a64']
      this.#field.burst(kx, ky, { count: e.killCause === 'expire' ? 8 : 14, speed: 110, gravity: 200, life: 0.5, size: 2.4, color: colors })
      if (e.killCause !== 'expire') { this.#shaker.add(0.25); r?.spike(0.3); this.#sfx('kill') }
      else this.#sfx('poof')
    }

    // Enemy shot loosed — muzzle puff at the barrel.
    if (e.shotFlash > this.#prevShot && e.shotCell) {
      const [sx, sy] = cellXY(e.shotCell)
      this.#field.burst(sx, sy, { count: 5, speed: 60, gravity: 20, life: 0.25, size: 1.8, color: ['#ff8a5a', '#ffd08a'] })
      this.#sfx('spit')
    }

    // Mirror emission — violet burst at the glass.
    if (e.spawnFlash > this.#prevSpawn && e.spawnCell) {
      const [mx, my] = cellXY(e.spawnCell)
      this.#field.burst(mx, my, { count: 12, speed: 90, gravity: 20, life: 0.45, size: 2.2, color: ['#b478ff', '#8a5aff', '#e0ccff'] })
      r?.spike(0.2)
      this.#sfx('spawn')
    }

    // A wand-found SECRET — the discovery chime (distinct from a plain reveal).
    if (e.secretFlash > this.#prevSecret && e.secretCell) {
      const [sx, sy] = cellXY(e.secretCell)
      this.#field.burst(sx, sy, { count: 14, speed: 70, gravity: -20, life: 0.6, size: 2, color: ['#ceb8ff', '#e8deff', '#fff'] })
      r?.spike(0.4)
      this.#sfx('secret')
    }

    // A hidden item uncovered by a broken brick.
    if (e.revealFlash > this.#prevReveal && e.revealCell) {
      const [rx, ry] = cellXY(e.revealCell)
      this.#field.burst(rx, ry, { count: 8, speed: 60, gravity: -10, life: 0.5, size: 1.8, color: [...ARCADE.spark] })
      this.#sfx('reveal')
    }

    // Door swings open — gold sparkle + a gong.
    if (!this.#prevDoor && e.doorOpen) {
      const [dx, dy] = cellXY(e.level.door)
      this.#field.burst(dx, dy, { count: 14, speed: 70, gravity: -30, life: 0.7, size: 2.2, color: ['#ffd76a', '#ffe9b0', '#fff'] })
      r?.spike(0.5)
      this.#sfx('doorOpen')
    }

    // A bell freed a fairy; collecting one chimes separately.
    if (e.fairies.length > this.#prevFairies) this.#sfx('bell')
    if (e.fairyCount > this.#prevFairyCount) this.#sfx('fairy')

    // The meter runs low — one warning toll at the threshold.
    const low = e.life > 0 && e.life < 2000
    if (low && !this.#prevLifeLow) this.#sfx('lowLife')

    // Dana's own fireball leaving the wand.
    if (e.fireFlash > this.#prevFire) this.#sfx('fireball')

    // Any score gain — a small proportional shake + light flare.
    const ds = e.score - this.#prevScore
    if (ds > 0) { this.#shaker.add(Math.min(0.5, 0.12 + ds / 1500)); r?.spike(Math.min(0.4, ds / 2000)) }

    this.#prevScore = e.score
    this.#prevLives = e.lives
    this.#prevConjure = e.conjureFlash
    this.#prevSmash = e.smashFlash
    this.#prevPickup = e.pickupFlash
    this.#prevKill = e.killFlash
    this.#prevShot = e.shotFlash
    this.#prevSpawn = e.spawnFlash
    this.#prevSecret = e.secretFlash
    this.#prevReveal = e.revealFlash
    this.#prevJump = e.jumpFlash
    this.#prevLand = e.landFlash
    this.#prevFire = e.fireFlash
    this.#prevDoor = e.doorOpen
    this.#prevFairies = e.fairies.length
    this.#prevFairyCount = e.fairyCount
    this.#prevLifeLow = low
  }

  /** Snap the juice baselines to an engine without firing shake (level swaps),
   *  and reset the shaker + particle field so nothing carries across a level. */
  #syncJuice(e: Engine): void {
    this.#prevScore = e.score
    this.#prevLives = e.lives
    this.#prevConjure = e.conjureFlash
    this.#prevSmash = e.smashFlash
    this.#prevPickup = e.pickupFlash
    this.#prevKill = e.killFlash
    this.#prevShot = e.shotFlash
    this.#prevSpawn = e.spawnFlash
    this.#prevSecret = e.secretFlash
    this.#prevReveal = e.revealFlash
    this.#prevJump = e.jumpFlash
    this.#prevLand = e.landFlash
    this.#prevFire = e.fireFlash
    this.#prevDoor = e.doorOpen
    this.#prevFairies = e.fairies.length
    this.#prevFairyCount = e.fairyCount
    this.#prevLifeLow = false
    this.#tallyTick = -1
    this.#shaker = new Shaker(7, 1.8)
    this.#field.clear()
  }

  #beginIntro(title: string, sub: string): void { this.#intro = { t: 0, title, sub } }

  /** A short, non-blocking title card that pops in (overshoot), holds, then fades.
   *  Drawn in the canvas's world pixels over the live game so play never stalls.
   *  Cyan title + gold sub to match the arcade suite. */
  #drawIntro(ctx: CanvasRenderingContext2D, dims: { w: number; h: number }, dt: number): void {
    const intro = this.#intro
    if (!intro) return
    intro.t += dt
    const DUR = 1.7
    if (intro.t >= DUR) { this.#intro = null; return }
    const p = intro.t / DUR
    const appear = easeOutBack(Math.min(1, p / 0.22))
    const fade = p > 0.72 ? Math.max(0, 1 - (p - 0.72) / 0.28) : 1
    const { w, h } = dims
    ctx.save()
    ctx.globalAlpha = fade
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.translate(w / 2, h * 0.36)
    ctx.scale(0.62 + 0.38 * appear, 0.62 + 0.38 * appear)
    ctx.font = '800 ' + Math.round(h * 0.085) + 'px "Segoe UI", system-ui, sans-serif'
    // additive echo instead of shadowBlur (GPU-less-preview safe): a slightly
    // larger dim copy glows behind the crisp title
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = fade * 0.35
    ctx.scale(1.05, 1.08)
    ctx.fillStyle = 'rgba(126,224,255,0.6)'
    ctx.fillText(intro.title, 0, 0)
    ctx.restore()
    ctx.fillStyle = ARCADE.cyan
    ctx.fillText(intro.title, 0, 0)
    ctx.fillStyle = ARCADE.gold
    ctx.font = '600 ' + Math.round(h * 0.04) + 'px "Segoe UI", system-ui, sans-serif'
    ctx.fillText(intro.sub, 0, h * 0.08)
    ctx.restore()
  }

  // ── input: play ──────────────────────────────────────────

  #onKeyDown = (e: KeyboardEvent): void => {
    // First gesture unlocks audio; ambience level tracks the mode (idempotent).
    this.#audio.unlock()
    this.#audio.startAmbience({ level: this.#mode === 'play' ? 1 : 0.5 })
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); this.#onClose(); return }
    // While typing in the designer's name field, let the field have its keys.
    if (document.activeElement === this.#nameInput) return
    // Let OS/browser shortcuts (Ctrl/Cmd/Alt combos) pass.
    if (e.ctrlKey || e.metaKey || e.altKey) return
    // Otherwise FULLY isolate — stop + preventDefault every plain key so none
    // leaks to the shell beneath this full-screen overlay (a stray key can
    // otherwise flip the app into website/view mode). Matches Bubble + Arkanoid.
    e.preventDefault(); e.stopImmediatePropagation()

    // Overworld: top-down walking + walk-into-a-mouth to enter that cavern.
    if (this.#mode === 'overworld') {
      const ow = this.#overworld
      if (!ow) return
      switch (e.key) {
        case 'ArrowLeft': case 'a': case 'A': ow.input.left = true; break
        case 'ArrowRight': case 'd': case 'D': ow.input.right = true; break
        case 'ArrowUp': case 'w': case 'W': ow.input.up = true; break
        case 'ArrowDown': case 's': case 'S': ow.input.down = true; break
        case 'Enter': case ' ': case 'Spacebar': case 'z': case 'Z': case 'x': case 'X':
          if (!e.repeat) { const n = ow.entranceUnder(); if (n) this.#enterCavern(n.levelIndex) }
          break
      }
      return
    }

    if (this.#mode !== 'play' || !this.#engine) return
    const eng = this.#engine
    if (!GAME_KEYS.has(e.key)) return
    switch (e.key) {
      case 'ArrowLeft': case 'a': case 'A': eng.input.left = true; break
      case 'ArrowRight': case 'd': case 'D': eng.input.right = true; break
      case 'ArrowUp': case 'w': case 'W': case ' ': case 'Spacebar':
        eng.input.jump = true; break   // held — the engine buffers the press edge and cuts on release
      case 'ArrowDown': case 's': case 'S': eng.input.down = true; break
      case 'j': case 'J': case 'z': case 'Z':
        if (!e.repeat) {
          const r = eng.cast()   // conjure / dispel a block (the cast SFX knows which)
          if (r === 'dispel') this.#sfx('dispel')
          else if (r === 'conjure') this.#sfx('conjure')
          else if (eng.state === 'playing') this.#sfx('deny')   // a blocked cast still answers — never a swallowed press
        }
        break
      case 'k': case 'K': case 'x': case 'X': if (!e.repeat) eng.fireball(); break // fireball (needs ammo)
      case 'm': case 'M': this.#enterOverworld(); break                            // back to the map
      case 'r': case 'R': this.#restartCurrent(); break                            // restart this cavern
    }
  }

  #onKeyUp = (e: KeyboardEvent): void => {
    if (document.activeElement === this.#nameInput) return
    if (e.ctrlKey || e.metaKey || e.altKey) return
    e.stopImmediatePropagation()
    if (this.#mode === 'overworld') {
      const ow = this.#overworld
      if (!ow) return
      switch (e.key) {
        case 'ArrowLeft': case 'a': case 'A': ow.input.left = false; break
        case 'ArrowRight': case 'd': case 'D': ow.input.right = false; break
        case 'ArrowUp': case 'w': case 'W': ow.input.up = false; break
        case 'ArrowDown': case 's': case 'S': ow.input.down = false; break
      }
      return
    }
    if (!this.#engine) return
    switch (e.key) {
      case 'ArrowLeft': case 'a': case 'A': this.#engine.input.left = false; break
      case 'ArrowRight': case 'd': case 'D': this.#engine.input.right = false; break
      case 'ArrowDown': case 's': case 'S': this.#engine.input.down = false; break
      case 'ArrowUp': case 'w': case 'W': case ' ': case 'Spacebar':
        this.#engine.input.jump = false; break   // the release signal → variable jump height
    }
  }

  // ── input: designer painting ─────────────────────────────

  #cellFromEvent(e: PointerEvent): { col: number; row: number } | null {
    const c = this.#canvas
    if (!c) return null
    const rect = c.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null
    // CSS px → logical world px (the displayed element spans #logicalW × #logicalH).
    const col = Math.floor((e.clientX - rect.left) / rect.width * this.#logicalW / TILE)
    const row = Math.floor((e.clientY - rect.top) / rect.height * this.#logicalH / TILE)
    return { col, row }
  }

  #onPointerDown = (e: PointerEvent): void => {
    this.#audio.unlock()
    if (this.#mode !== 'design') return
    const cell = this.#cellFromEvent(e)
    if (!cell) return
    this.#painting = true
    this.#lastCell = { col: -1, row: -1 }
    this.#paintAt(cell)
    this.#canvas?.setPointerCapture?.(e.pointerId)
  }

  #onPointerMove = (e: PointerEvent): void => {
    if (this.#mode !== 'design') return
    const cell = this.#cellFromEvent(e)
    this.#hover = cell
    if (this.#painting && cell) this.#paintAt(cell)
  }

  #onPointerUp = (): void => { this.#painting = false }

  #paintAt(cell: { col: number; row: number }): void {
    if (cell.col === this.#lastCell.col && cell.row === this.#lastCell.row) return
    this.#lastCell = cell
    this.#designer.paint(cell.col, cell.row)
  }

  // ── designer actions ─────────────────────────────────────

  #setTool(tool: Tool): void { this.#designer.setTool(tool); this.#updateToolButtons() }

  #updateToolButtons(): void {
    for (const [tool, b] of this.#toolButtons) b.classList.toggle('on', tool === this.#designer.tool)
  }

  #designerNew(): void {
    this.#designer.newLevel('My Level')
    if (this.#nameInput) this.#nameInput.value = this.#designer.level.name
    this.#sizeCanvasTo(this.#designer.level)
    this.#flash('new blank level')
  }

  #designerSave(): void {
    const name = (this.#nameInput?.value ?? '').trim() || 'My Level'
    const level = this.#designer.named(name)
    upsertCustomLevel(level)
    this.#refreshLevels()
    this.#refreshLoadSelect(name)
    this.#flash(`saved “${name}”`)
  }

  #designerTest(): void {
    // Playtest the in-progress level without requiring a save (a one-off cavern,
    // not part of the overworld journey).
    this.#mode = 'play'
    this.#engine = new Engine(cloneLevel(this.#designer.level))
    this.#testing = true
    this.#inPrincess = false
    this.#transition = null
    this.#ended = false
    this.#overShown = false
    this.#levelStartScore = this.#engine.score
    this.#levelStartLives = this.#engine.lives
    this.#syncJuice(this.#engine)
    this.#camInit = false   // snap the room camera to the starting room
    this.#acc = 0
    this.#hideBanner()
    this.#sizeCanvasToView(this.#designer.level)
    this.#playBar?.classList.remove('sol-hidden')
    this.#designBar?.classList.add('sol-hidden')
    this.#mapBtn?.classList.add('sol-hidden') // no "to map" while testing a draft
    this.#root?.querySelectorAll('.sol-tab').forEach((t, i) => t.classList.toggle('on', i === 0))
    if (this.#levelLabel) this.#levelLabel.textContent = `${this.#designer.level.name}  (test)`
    this.#beginIntro(this.#designer.level.name, 'TEST')
  }

  /** Restart whatever we're in: the journey (on the map), the test (in a draft),
   *  or the current cavern. Used by the Restart button + the R key. */
  #restartCurrent(): void {
    if (this.#mode === 'overworld') this.#restartJourney()
    else if (this.#testing) this.#designerTest()
    else this.#enterCavern(this.#currentCavern)
  }

  #designerLoad(name: string): void {
    if (!name) return
    const lvl = loadCustomLevels().find(l => l.name === name)
      ?? BUILTIN_LEVELS.find(l => l.name === name)
    if (!lvl) return
    this.#designer.setLevel(lvl)
    if (this.#nameInput) this.#nameInput.value = lvl.name
    this.#sizeCanvasTo(lvl)
    this.#flash(`editing “${name}”`)
  }

  #designerDelete(): void {
    const name = (this.#nameInput?.value ?? '').trim()
    deleteCustomLevel(name)
    this.#refreshLevels()
    this.#refreshLoadSelect()
    this.#flash(`deleted “${name}”`)
  }

  #designerExport(): void {
    const json = this.#designer.exportJson()
    try {
      void navigator.clipboard?.writeText(json)
      this.#flash('level JSON copied to clipboard')
    } catch { this.#flash('copy failed — see console'); console.log(json) }
  }

  #designerImport(): void {
    const text = window.prompt('Paste level JSON:')
    if (!text) return
    if (this.#designer.importJson(text)) {
      if (this.#nameInput) this.#nameInput.value = this.#designer.level.name
      this.#sizeCanvasTo(this.#designer.level)
      this.#flash('level imported')
    } else this.#flash('import failed — invalid JSON')
  }

  #refreshLoadSelect(selected?: string): void {
    const sel = this.#loadSelect
    if (!sel) return
    const custom = loadCustomLevels()
    sel.innerHTML = ''
    sel.appendChild(opt('', custom.length ? '— load custom —' : '— no custom levels —'))
    for (const b of BUILTIN_LEVELS) sel.appendChild(opt(b.name, `(built-in) ${b.name}`))
    for (const l of custom) sel.appendChild(opt(l.name, l.name))
    if (selected) sel.value = selected
  }

  // ── level clear → tally → pan to next (continuous play) ──

  /** Cavern cleared. Compute the score gain + bonuses and open the tally
   *  interlude. The Princess Room rolls the true ending; every other cavern
   *  surfaces back to the overworld. */
  #beginClear(): void {
    const eng = this.#engine
    if (!eng || this.#transition || this.#ended) return
    const levelScore = Math.max(0, eng.score - this.#levelStartScore)
    const timeBonus = Math.round(eng.life) // life left at the door → time bonus
    const bonus = eng.lives >= this.#levelStartLives ? PERFECT_BONUS : 0
    this.#transition = {
      t: 0, levelScore, timeBonus, bonus, baseScore: this.#levelStartScore,
      prev: eng, princess: this.#inPrincess, testing: this.#testing,
    }
    this.#tallyTick = 0
    this.#sfx('clear')
    this.#hideBanner()
  }

  /** Count the tally up; when it finishes, act on what was cleared. */
  #stepTransition(dt: number): void {
    const tr = this.#transition
    if (!tr) return
    tr.t += dt
    // count-up ticks while the numbers roll, one ding when they settle
    const step = Math.floor(tr.t * 16)
    if (tr.t < TALLY_MS * 0.94 && step !== this.#tallyTick) { this.#tallyTick = step; this.#sfx('tick') }
    else if (tr.t >= TALLY_MS * 0.94 && this.#tallyTick >= 0) { this.#tallyTick = -1; this.#sfx('ding') }
    if (tr.t < TALLY_MS) return
    this.#transition = null
    if (tr.princess) { this.#ended = true; this.#showEnding(tr.prev, true); return } // true ending
    if (tr.testing) { this.#designerTest(); return }                                 // replay the test
    this.#afterCavernClear(tr.prev)                                                  // surface to the map
  }

  /** Draw the cleared cavern (camera-framed) under the score tally. */
  #drawTransition(r: Renderer, view: { w: number; h: number }): void {
    const tr = this.#transition
    const ctx = this.#ctx
    if (!tr || !ctx) return
    // hold on the room Dana cleared in (the camera is already settled there). The
    // loop set the base scale transform; we compose the camera translate on top.
    ctx.save(); ctx.translate(-this.#cam.x, -this.#cam.y); r.drawWorld(tr.prev, this.#time); ctx.restore()
    r.drawHud(tr.prev, this.#time, view.w, view.h)
    this.#drawTally(ctx, { w: view.w, h: view.h }, tr)
  }

  /** The score add-up overlay: level gain counts up first, then any perfect
   *  bonus, with the running total ticking alongside. Drawn in world units. */
  #drawTally(ctx: CanvasRenderingContext2D, dims: { w: number; h: number }, tr: Transition): void {
    const { w, h } = dims
    const cx = w / 2
    const p = Math.min(1, tr.t / TALLY_MS)
    // Count the lines in sequence: level score, then the time bonus, then any
    // perfect-clear bonus — each ticking up as its window opens.
    const clamp = (a: number, b: number) => Math.max(0, Math.min(1, (p - a) / b))
    const levelP = clamp(0, 0.40)
    const timeP = clamp(0.36, 0.30)
    const bonusP = tr.bonus > 0 ? clamp(0.68, 0.26) : 0
    const shownLevel = Math.round(tr.levelScore * levelP)
    const shownTime = Math.round(tr.timeBonus * timeP)
    const shownBonus = Math.round(tr.bonus * bonusP)
    const shownTotal = tr.baseScore + shownLevel + shownTime + shownBonus
    const font = (size: number, weight = 700) =>
      `${weight} ${Math.round(size)}px "Segoe UI", system-ui, sans-serif`

    ctx.save()
    ctx.fillStyle = 'rgba(6,4,14,0.62)'
    ctx.fillRect(0, 0, w, h)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    ctx.fillStyle = '#ffd24d'
    ctx.font = font(h * 0.10, 800)
    ctx.fillText('ROOM CLEAR', cx, h * 0.26)

    ctx.fillStyle = '#ffffff'
    ctx.font = font(h * 0.05)
    ctx.fillText(`Score  +${shownLevel}`, cx, h * 0.42)

    ctx.fillStyle = timeP > 0 ? '#9ee0ff' : 'rgba(158,224,255,0.28)'
    ctx.fillText(`Time Bonus  +${shownTime}`, cx, h * 0.52)

    if (tr.bonus > 0) {
      ctx.fillStyle = bonusP > 0 ? '#ffd76a' : 'rgba(255,215,106,0.28)'
      ctx.fillText(`Perfect Bonus  +${shownBonus}`, cx, h * 0.62)
    }

    ctx.fillStyle = '#cfd2ff'
    ctx.font = font(h * 0.06, 800)
    ctx.fillText(`✦ ${shownTotal}`, cx, h * 0.74)
    ctx.restore()
  }

  // ── banners + status ─────────────────────────────────────

  #showGameOver(): void {
    this.#sfx('gameover')
    const score = this.#engine?.score ?? 0
    this.#showBanner('Game Over', `✦ ${score}`, [
      { label: '↻ Retry cavern', fn: () => this.#enterCavern(this.#currentCavern) },
      { label: '🗺 Map', fn: () => this.#enterOverworld() },
    ])
  }

  /** The final room is cleared — show the victory banner. Collecting every
   *  Solomon's Seal along the way earns the best ending (the Princess rescue). */
  #showEnding(eng: Engine, princess: boolean): void {
    this.#overShown = true // keep the game-over path from firing underneath
    const pages = eng.pageTime && eng.pageSpace
    let title: string, sub: string
    if (princess && pages) {
      title = "✦ You restored Solomon's Key! ✦"
      sub = `Both Pages + all ${SEAL_TOTAL} seals — the true ending  ·  ✦ ${eng.score}`
    } else if (princess) {
      title = '✦ You rescued Princess Lihita! ✦'
      sub = `All ${SEAL_TOTAL} seals  ·  find both Pages for the true ending  ·  ✦ ${eng.score}`
    } else {
      title = "You cleared Solomon's Key!"
      sub = `✦ ${eng.score}  ·  seals ${eng.sealCount}/${SEAL_TOTAL}`
    }
    this.#showBanner(title, sub, [
      { label: '↻ Play again', fn: () => this.#restartJourney() },
    ])
  }

  #showBanner(title: string, sub: string, actions: { label: string; fn: () => void }[]): void {
    const b = this.#banner
    if (!b) return
    b.innerHTML = ''
    b.appendChild(el('div', { class: 'sol-banner-title', text: title }))
    b.appendChild(el('div', { class: 'sol-banner-sub', text: sub }))
    const row = el('div', { class: 'sol-banner-actions' })
    for (const a of actions) {
      const btn = el('button', { class: 'sol-btn sol-btn-lg', text: a.label }) as HTMLButtonElement
      btn.onclick = a.fn
      row.appendChild(btn)
    }
    b.appendChild(row)
    b.classList.remove('sol-hidden')
  }

  #hideBanner(): void { this.#banner?.classList.add('sol-hidden') }

  #flashTimer = 0
  #flash(msg: string): void {
    if (!this.#status) return
    this.#status.textContent = msg
    if (this.#flashTimer) clearTimeout(this.#flashTimer)
    this.#flashTimer = window.setTimeout(() => { if (this.#status) this.#status.textContent = '' }, 2600)
  }

  // ── styles ───────────────────────────────────────────────

  #injectStyles(): void {
    if (document.getElementById(STYLE_ID)) return
    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = CSS
    document.head.appendChild(style)
  }
}

// ── tiny DOM helpers ───────────────────────────────────────

function el(tag: string, props: { class?: string; text?: string; title?: string; placeholder?: string } = {}): HTMLElement {
  const e = document.createElement(tag)
  if (props.class) e.className = props.class
  if (props.text != null) e.textContent = props.text
  if (props.title) e.title = props.title
  if (props.placeholder) (e as HTMLInputElement).placeholder = props.placeholder
  return e
}

function opt(value: string, label: string): HTMLOptionElement {
  const o = document.createElement('option')
  o.value = value; o.textContent = label
  return o
}

const CSS = `
.sol-overlay{position:fixed;inset:0;display:flex;flex-direction:column;
  background:radial-gradient(120% 120% at 50% 0%,#1c1233 0%,#0a0716 60%,#050309 100%);
  font-family:'Segoe UI',system-ui,sans-serif;color:#e7e3ff;user-select:none;
  animation:sol-in .18s ease both}
@keyframes sol-in{from{opacity:0}to{opacity:1}}
.sol-bar{display:flex;align-items:center;gap:.6rem;padding:.45rem .7rem;
  background:rgba(10,7,22,.7);border-bottom:1px solid rgba(126,182,214,.25);flex-wrap:wrap}
.sol-logo{font-weight:700;letter-spacing:.04em;color:#ffd24d;white-space:nowrap}
.sol-tabs{display:flex;gap:.25rem;margin-left:.4rem}
.sol-tab{background:transparent;border:1px solid rgba(126,182,214,.3);color:#c9c4ec;
  padding:.2rem .7rem;border-radius:999px;cursor:pointer;font-size:.85rem}
.sol-tab.on{background:rgba(126,182,214,.22);color:#fff;border-color:rgba(126,182,214,.6)}
.sol-ctl{display:flex;align-items:center;gap:.35rem;flex-wrap:wrap}
.sol-level-label{min-width:9rem;text-align:center;font-size:.85rem;color:#cfd2ff}
.sol-btn{background:rgba(126,182,214,.12);border:1px solid rgba(126,182,214,.3);
  color:#dfe7ff;padding:.22rem .6rem;border-radius:6px;cursor:pointer;font-size:.82rem}
.sol-btn:hover{background:rgba(126,182,214,.26)}
.sol-btn-lg{padding:.5rem 1.1rem;font-size:.95rem}
.sol-palette{display:flex;gap:.2rem}
.sol-tool{width:2rem;height:2rem;display:flex;align-items:center;justify-content:center;
  background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.15);border-radius:6px;
  color:#fff;cursor:pointer;font-size:1rem;line-height:1}
.sol-tool.on{background:rgba(120,220,255,.3);border-color:rgba(120,220,255,.8);box-shadow:0 0 8px rgba(120,220,255,.5)}
.sol-name{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.2);
  color:#fff;border-radius:6px;padding:.25rem .5rem;width:9rem;font-size:.82rem}
.sol-select{background:rgba(20,14,36,.95);border:1px solid rgba(255,255,255,.2);
  color:#fff;border-radius:6px;padding:.22rem .4rem;font-size:.8rem;max-width:11rem}
.sol-status{margin-left:auto;font-size:.8rem;color:#9ad9b0;min-height:1em}
.sol-close{width:2rem;height:2rem;border-radius:50%;border:none;cursor:pointer;
  background:rgba(255,80,80,.18);color:#ff9a9a;font-size:1rem}
.sol-close:hover{background:rgba(255,80,80,.34);color:#fff}
.sol-stage{flex:1;display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden;padding:12px}
.sol-canvas{image-rendering:auto;border-radius:8px;
  box-shadow:0 12px 48px rgba(0,0,0,.6),0 0 0 1px rgba(126,182,214,.2);background:#070512}
.sol-banner{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;
  justify-content:center;gap:.7rem;background:rgba(6,4,14,.78);backdrop-filter:blur(2px)}
.sol-banner-title{font-size:2.2rem;font-weight:800;color:#ffd24d;text-shadow:0 2px 18px rgba(255,180,40,.5)}
.sol-banner-sub{font-size:1.1rem;color:#cfd2ff}
.sol-banner-actions{display:flex;gap:.6rem;margin-top:.4rem}
.sol-help{padding:.4rem .8rem;text-align:center;font-size:.78rem;color:#9c98c4;
  background:rgba(10,7,22,.6);border-top:1px solid rgba(126,182,214,.15)}
.sol-help b{color:#dfe7ff}
.sol-hidden{display:none!important}
`
