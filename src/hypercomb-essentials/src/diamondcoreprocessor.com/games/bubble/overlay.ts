// diamondcoreprocessor.com/games/bubble/overlay.ts
//
// The full-screen game shell. Owns the DOM (backdrop, toolbar, canvas, banners),
// the requestAnimationFrame loop, keyboard input for play, and pointer input for
// the level designer. It's a self-contained mini-app: it never touches the hex
// grid or Pixi — it mounts above everything as a fixed overlay and tears itself
// fully down on close. The BubbleDrone owns its lifecycle (open/close). The
// canvas is drawn at device-pixel resolution (DPR transform) so the art stays
// crisp. Keyboard input is FULLY isolated while mounted — no keystroke leaks to
// the shell (a stray key can otherwise flip the app into website/view mode).

import { Engine, TILE, type LevelDef } from './engine.js'
import { Renderer, themeFor, THEME_NAMES } from './renderer.js'
import { Designer, TOOLS, type Tool } from './designer.js'
import { BUILTIN_LEVELS, DIAMOND_ROOM, loadCustomLevels, upsertCustomLevel, deleteCustomLevel, cloneLevel } from './levels.js'
import { Shaker, easeOutBack, ARCADE } from '../juice.js'

const STYLE_ID = 'bub-overlay-styles'
const Z = 2147483000

// High score — participant-local UI data (localStorage, same class as the
// custom-level store; never layer state).
const HISCORE_KEY = 'hc:bubble-hiscore'

// On-screen zoom. The canvas auto-fits the level to the stage, so the tile size
// is invisible (it cancels in the fit) — THIS is the real lever for how big the
// whole game (player + bubbles + platforms, together) renders. < 1 zooms out:
// everything daintier, sitting on more of the dark backdrop. 1 = fill the stage.
const ZOOM = 0.8

// DESIGNER zoom. Play auto-fits the whole screen; the designer must not, because
// the geometry grid is a 15px brick — fitting a 40×26 room to the stage paints
// each cell at ~12 CSS px, which is far too small to click accurately. These are
// multipliers ON the fit scale, so ×1 is "show me the whole room" and anything
// above it trades overview for a cell you can actually hit. The stage scrolls
// once the grid outgrows it.
const DESIGN_ZOOMS = [1, 2, 3, 4] as const
const DESIGN_ZOOM_DEFAULT = 2
const PHYSICS_STEP = 1 / 120
const MAX_PHYSICS_STEPS = 8

// Keys that drive PLAY. Movement + K (jump) + J (blow a bubble) + R (restart).
// Up no longer jumps — jump is K. (All keys are isolated anyway; this set only
// decides which ones trigger a game action.)
const GAME_KEYS = new Set([
  'ArrowLeft', 'ArrowRight', 'a', 'A', 'd', 'D', 'j', 'J', 'k', 'K', 'r', 'R',
])

type Mode = 'play' | 'design'

// Level-clear flow (continuous play, à la the arcade original): on clearing a
// screen we tally the level's score (+ any perfect bonus) counting up, then
// scroll the next level UP from the bottom — no button press, you just keep
// playing. Score + lives carry across levels; the toolbar still has prev / next
// / restart for jumping around manually.
const TALLY_MS = 1.7          // how long the score add-up reads
const PAN_MS = 0.85           // how long the next level takes to slide in
const PERFECT_BONUS = 1000    // awarded when a level is cleared without dying
const BONUS_EVERY = 5         // clear this many rounds → the DIAMOND ROOM drops in

/** One in-flight level-clear transition: first 'tally' (count the score up),
 *  then 'pan' (slide the cleared level off the top while the next rises from
 *  below). `prev` is the cleared engine, kept so it can be drawn scrolling out. */
interface Transition {
  phase: 'tally' | 'pan'
  t: number               // seconds into the current phase
  levelScore: number      // points earned on the just-cleared level
  bonus: number           // perfect-clear bonus (0 if a life was lost)
  baseScore: number       // running total at the start of the cleared level
  nextLevel: LevelDef     // the level rising in
  nextIndex: number       // its index in #levels (for the toolbar label)
  testing: boolean        // cleared a designer test (re-pans the same level)
  warp: number            // rounds skipped by an umbrella (0 = a normal clear)
  intoBonus: boolean      // the level rising in is the DIAMOND ROOM
  prev: Engine            // the cleared engine — drawn scrolling out during 'pan'
}

/** easeInOut cubic — slow start, slow settle; reads as the screen easing up. */
function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

export class BubbleOverlay {
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
  #themeSelect: HTMLSelectElement | null = null
  #zoomSelect: HTMLSelectElement | null = null
  #designZoom: number = DESIGN_ZOOM_DEFAULT
  #toolButtons = new Map<Tool, HTMLButtonElement>()

  #mode: Mode = 'play'
  #engine: Engine | null = null
  #designer = new Designer()

  #levels: LevelDef[] = []
  #levelIndex = 0

  #raf = 0
  #lastTs = 0
  #physicsTime = 0
  #time = 0
  #scaleBack = 1
  #overShown = false
  #ro: ResizeObserver | null = null

  // juice: trauma screen-shake + a short level-intro title card. Shake is driven
  // by score/lives deltas read after each engine.update() so the engine stays pure.
  #shaker = new Shaker()
  #prevScore = 0
  #prevLives = 3
  #intro: { t: number; title: string; sub: string } | null = null

  // Continuous-play state. The engine's score is the RUNNING total (carried
  // across levels); #levelStartScore / #levelStartLives snapshot the totals when
  // the current level began, so the clear tally can show the level's own gain
  // and award a perfect bonus only when no life was lost.
  #transition: Transition | null = null
  #levelStartScore = 0
  #levelStartLives = 3
  #testing = false   // playing a designer test (not part of the level list)
  // In a DIAMOND ROOM, #levelIndex already points at the round we resume on —
  // the bonus screen isn't in #levels, it's something that happens between.
  #inBonus = false

  // High score: tracked live, persisted on clear / game over / unmount.
  #hiscore = 0
  #hiscoreDirty = false

  // designer pointer-paint state
  #painting = false
  #lastCell = { col: -1, row: -1 }
  #hover: { col: number; row: number } | null = null

  #onClose: () => void

  constructor(onClose: () => void) {
    this.#onClose = onClose
  }

  isMounted(): boolean { return !!this.#root }

  /** Jump straight to the level designer (used by `/bubble design`). */
  showDesigner(): void { this.#setMode('design') }

  // ── lifecycle ────────────────────────────────────────────

  mount(): void {
    if (this.#root) return
    this.#injectStyles()
    this.#hiscore = this.#loadHiscore()
    this.#refreshLevels()
    ;(document.activeElement as HTMLElement | null)?.blur?.()
    this.#build()
    this.#startPlay(this.#levels[this.#levelIndex] ?? this.#levels[0])
    window.addEventListener('keydown', this.#onKeyDown, true)
    window.addEventListener('keyup', this.#onKeyUp, true)
    window.addEventListener('resize', this.#fit)
    // Designer paint tracks via WINDOW-level pointer events (not canvas-level)
    // so dragging a stroke past the canvas edge keeps painting to the last
    // in-bounds cell instead of freezing until the cursor returns. pointerdown
    // stays on the canvas — a stroke can only START on the grid.
    window.addEventListener('pointermove', this.#onPointerMove)
    window.addEventListener('pointerup', this.#onPointerUp)
    // Re-fit whenever the stage's layout settles or changes — guards against
    // mounting before the browser has laid the overlay out. Same self-sizing
    // pattern as the Pixi host.
    this.#ro = new ResizeObserver(() => this.#fit())
    if (this.#stage) this.#ro.observe(this.#stage)
    this.#lastTs = 0
    this.#physicsTime = 0
    this.#raf = requestAnimationFrame(this.#loop)
  }

  unmount(): void {
    if (this.#raf) cancelAnimationFrame(this.#raf)
    this.#raf = 0
    this.#saveHiscore()
    window.removeEventListener('keydown', this.#onKeyDown, true)
    window.removeEventListener('keyup', this.#onKeyUp, true)
    window.removeEventListener('resize', this.#fit)
    window.removeEventListener('pointermove', this.#onPointerMove)
    window.removeEventListener('pointerup', this.#onPointerUp)
    this.#ro?.disconnect()
    this.#ro = null
    this.#root?.remove()
    this.#root = null
    this.#canvas = null
    this.#ctx = null
    this.#renderer = null
    this.#engine = null
  }

  // ── DOM ──────────────────────────────────────────────────

  #build(): void {
    const root = el('div', { class: 'bub-overlay' }) as HTMLDivElement
    root.style.zIndex = String(Z)

    const bar = el('div', { class: 'bub-bar' })
    bar.appendChild(el('span', { class: 'bub-logo', text: '🫧 Bubble Bobble' }))

    // tabs
    const tabs = el('div', { class: 'bub-tabs' })
    const playTab = el('button', { class: 'bub-tab on', text: 'Play' }) as HTMLButtonElement
    const designTab = el('button', { class: 'bub-tab', text: 'Design' }) as HTMLButtonElement
    playTab.onclick = () => this.#setMode('play')
    designTab.onclick = () => this.#setMode('design')
    tabs.append(playTab, designTab)
    bar.appendChild(tabs)

    // play controls
    const playBar = el('div', { class: 'bub-ctl' }) as HTMLDivElement
    const prev = el('button', { class: 'bub-btn', text: '‹' }) as HTMLButtonElement
    const next = el('button', { class: 'bub-btn', text: '›' }) as HTMLButtonElement
    const label = el('span', { class: 'bub-level-label' }) as HTMLSpanElement
    const restart = el('button', { class: 'bub-btn', text: '↻ Restart' }) as HTMLButtonElement
    prev.onclick = () => this.#cycleLevel(-1)
    next.onclick = () => this.#cycleLevel(1)
    restart.onclick = () => this.#startPlay(this.#levels[this.#levelIndex])
    playBar.append(prev, label, next, restart)
    bar.appendChild(playBar)
    this.#playBar = playBar
    this.#levelLabel = label

    // design controls
    const designBar = el('div', { class: 'bub-ctl bub-hidden' }) as HTMLDivElement
    const palette = el('div', { class: 'bub-palette' })
    for (const t of TOOLS) {
      const b = el('button', { class: 'bub-tool', title: t.label, text: t.glyph }) as HTMLButtonElement
      b.onclick = () => this.#setTool(t.tool)
      this.#toolButtons.set(t.tool, b)
      palette.appendChild(b)
    }
    designBar.appendChild(palette)
    const nameInput = el('input', { class: 'bub-name', placeholder: 'level name' }) as HTMLInputElement
    nameInput.value = this.#designer.level.name
    designBar.appendChild(nameInput)
    this.#nameInput = nameInput
    // world picker — repaints the editor live so you author in the real skin
    const themeSel = el('select', { class: 'bub-select', title: 'World — palette, masonry + backdrop' }) as HTMLSelectElement
    THEME_NAMES.forEach((n, i) => themeSel.appendChild(opt(String(i), n)))
    themeSel.onchange = () => {
      const i = Number(themeSel.value)
      this.#designer.setTheme(i)
      this.#flash(`world: ${THEME_NAMES[i]}`)
    }
    designBar.appendChild(themeSel)
    this.#themeSelect = themeSel
    // zoom — the grid is a 15px brick, so this is what makes a cell clickable
    const zoomSel = el('select', { class: 'bub-select bub-zoom', title: 'Zoom — the grid is a fine 15px brick; zoom in to place it precisely' }) as HTMLSelectElement
    for (const z of DESIGN_ZOOMS) zoomSel.appendChild(opt(String(z), z === 1 ? 'Fit' : `Zoom ×${z}`))
    zoomSel.value = String(this.#designZoom)
    zoomSel.onchange = () => { this.#designZoom = Number(zoomSel.value); this.#fit() }
    designBar.appendChild(zoomSel)
    this.#zoomSelect = zoomSel
    const mkBtn = (txt: string, fn: () => void) => { const b = el('button', { class: 'bub-btn', text: txt }) as HTMLButtonElement; b.onclick = fn; return b }
    designBar.appendChild(mkBtn('New', () => this.#designerNew()))
    designBar.appendChild(mkBtn('Save', () => this.#designerSave()))
    designBar.appendChild(mkBtn('▶ Test', () => this.#designerTest()))
    const loadSel = el('select', { class: 'bub-select' }) as HTMLSelectElement
    loadSel.onchange = () => this.#designerLoad(loadSel.value)
    designBar.appendChild(loadSel)
    this.#loadSelect = loadSel
    designBar.appendChild(mkBtn('Delete', () => this.#designerDelete()))
    designBar.appendChild(mkBtn('Export', () => this.#designerExport()))
    designBar.appendChild(mkBtn('Import', () => this.#designerImport()))
    bar.appendChild(designBar)
    this.#designBar = designBar

    const status = el('span', { class: 'bub-status' }) as HTMLSpanElement
    bar.appendChild(status)
    this.#status = status

    const close = el('button', { class: 'bub-close', text: '✕', title: 'Close (Esc)' }) as HTMLButtonElement
    close.onclick = () => this.#onClose()
    bar.appendChild(close)
    root.appendChild(bar)

    // stage
    const stage = el('div', { class: 'bub-stage' }) as HTMLDivElement
    const canvas = el('canvas', { class: 'bub-canvas' }) as HTMLCanvasElement
    canvas.addEventListener('pointerdown', this.#onPointerDown)
    stage.appendChild(canvas)
    const banner = el('div', { class: 'bub-banner bub-hidden' }) as HTMLDivElement
    stage.appendChild(banner)
    root.appendChild(stage)
    this.#stage = stage
    this.#banner = banner

    const help = el('div', { class: 'bub-help' })
    help.innerHTML = '<b>← →</b> move &nbsp;·&nbsp; <b>K</b> jump &nbsp;·&nbsp; <b>J</b> blow a bubble &nbsp;·&nbsp; AIM your shots — a bubble only traps a foe <i>while it still has momentum</i>, then it floats up and gathers under the ceiling &nbsp;·&nbsp; <i>touch a bubble to pop it</i> — pops <i>cascade</i> through the whole touching cluster, so trapped foes burst together into bouncing fruit &nbsp;·&nbsp; jump <i>up through</i> the platforms island to island; <b>hold K</b> on a bubble’s crown to bounce and ride the foam up the tall shafts &nbsp;·&nbsp; a <span style="color:#ff5a5a">red-flashing</span> bubble is about to burst — its foe escapes angry &nbsp;·&nbsp; pop the drifting elementals: 💧 <span style="color:#6fc0ff">water</span> floods the platforms, ⚡ <span style="color:#ffe27a">lightning</span> fires <i>opposite the way you face</i> &nbsp;·&nbsp; the cast: <span style="color:#4aa3ff">Zen-Chan</span>, <span style="color:#ff8a3d">Mighta</span> (dodge his boulders!), <span style="color:#6fe06a">Banebou</span> &amp; the flying <span style="color:#ff9ad5">Monsta</span> &nbsp;·&nbsp; sweets: 👟 <span style="color:#4aa3ff">shoes</span> (run faster) · 🍬 <span style="color:#ff5d8f">candy</span> (blow faster) &nbsp;·&nbsp; grab an <b>umbrella</b> to <i>warp ahead</i>: <span style="color:#4aa3ff">blue</span> 3 · <span style="color:#ff4d5e">red</span> 5 · <span style="color:#ff7ad5">pink</span> 7 rounds — chain your pops to earn the better ones &nbsp;·&nbsp; every 5 rounds the <span style="color:#7fdcff">◆ Diamond Room</span> drops in: no foes, sweep every gem before the clock dies &nbsp;·&nbsp; <b>R</b> restart &nbsp;·&nbsp; <b>Esc</b> close'
    root.appendChild(help)

    document.body.appendChild(root)
    this.#root = root
    this.#canvas = canvas
    this.#ctx = canvas.getContext('2d')
    if (this.#ctx) this.#renderer = new Renderer(this.#ctx)
    this.#refreshLoadSelect()
  }

  // ── mode + level control ─────────────────────────────────

  #setMode(mode: Mode): void {
    if (this.#mode === mode) return
    this.#mode = mode
    const tabs = this.#root?.querySelectorAll('.bub-tab')
    tabs?.forEach((t, i) => t.classList.toggle('on', (i === 0) === (mode === 'play')))
    this.#playBar?.classList.toggle('bub-hidden', mode !== 'play')
    this.#designBar?.classList.toggle('bub-hidden', mode !== 'design')
    // a zoomed-in grid overflows the stage — let it scroll while designing
    this.#stage?.classList.toggle('bub-design', mode === 'design')
    this.#hideBanner()
    if (mode === 'play') this.#startPlay(this.#levels[this.#levelIndex])
    else { this.#fit(); this.#updateToolButtons() }
  }

  #refreshLevels(): void {
    this.#levels = [...BUILTIN_LEVELS.map(cloneLevel), ...loadCustomLevels()]
    if (this.#levelIndex >= this.#levels.length) this.#levelIndex = 0
  }

  #cycleLevel(dir: number): void {
    this.#refreshLevels()
    if (!this.#levels.length) return
    this.#levelIndex = (this.#levelIndex + dir + this.#levels.length) % this.#levels.length
    this.#startPlay(this.#levels[this.#levelIndex])
  }

  #startPlay(level: LevelDef | undefined): void {
    if (!level) return
    this.#mode = 'play'
    this.#engine = new Engine(cloneLevel(level))
    // Fresh run from this level: score back to 0, full lives, no carry-over.
    this.#testing = false
    this.#inBonus = false
    this.#transition = null
    this.#overShown = false
    this.#levelStartScore = this.#engine.score
    this.#levelStartLives = this.#engine.lives
    this.#syncJuice(this.#engine)
    this.#hideBanner()
    this.#fit()
    this.#updateLevelLabel(level.name, false)
    this.#beginIntro(level.name, this.#introSub(level))
  }

  /** The intro card's subtitle: the world this round belongs to, then its
   *  number — the worlds run in themed sets, so name the one you're entering. */
  #introSub(level: LevelDef): string {
    if (level.bonus) return 'GRAB THE TREASURE!'
    return `${themeFor(level).name.toUpperCase()}  ·  LEVEL ${this.#levelIndex + 1}`
  }

  // The toolbar level caption: "Name (n/total)" in play, "Name (test)" while
  // playtesting a designer level.
  #updateLevelLabel(name: string, testing: boolean): void {
    if (!this.#levelLabel) return
    this.#levelLabel.textContent = testing
      ? `${name}  (test)`
      : this.#inBonus
        ? `${name}  (bonus)`
        : `${name}  (${this.#levelIndex + 1}/${this.#levels.length})`
  }

  /** World pixel size of whatever the canvas is currently showing. */
  #worldDims(): { w: number; h: number } | null {
    if (this.#mode === 'design') return { w: this.#designer.level.cols * TILE, h: this.#designer.level.rows * TILE }
    if (this.#engine) return { w: this.#engine.width, h: this.#engine.height }
    return null
  }

  // Crisp scaling: back the canvas with device pixels and draw the world
  // through a single scale transform. The renderer works in world units.
  #fit = (): void => {
    const c = this.#canvas, s = this.#stage, dims = this.#worldDims()
    if (!c || !s || !dims) return
    const availW = s.clientWidth - 28
    const availH = s.clientHeight - 28
    if (availW <= 0 || availH <= 0) return
    // Play zooms OUT a touch for the aesthetic; the designer zooms IN, because
    // fitting the fine 15px brick grid to the stage leaves a cell far too small
    // to click. Both are multipliers on the fit scale.
    const fit = Math.min(availW / dims.w, availH / dims.h)
    const cssScale = this.#mode === 'play' ? fit * ZOOM : fit * this.#designZoom
    const dispW = dims.w * cssScale, dispH = dims.h * cssScale
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    c.width = Math.round(dispW * dpr)
    c.height = Math.round(dispH * dpr)
    c.style.width = `${Math.round(dispW)}px`
    c.style.height = `${Math.round(dispH)}px`
    this.#scaleBack = cssScale * dpr
    if (this.#ctx) this.#ctx.imageSmoothingEnabled = true
  }

  // ── loop ─────────────────────────────────────────────────

  #loop = (ts: number): void => {
    if (!this.#root) return
    if (!this.#lastTs) this.#lastTs = ts
    const dt = Math.min((ts - this.#lastTs) / 1000, PHYSICS_STEP * MAX_PHYSICS_STEPS)
    this.#lastTs = ts
    this.#time += dt

    const ctx = this.#ctx, r = this.#renderer, dims = this.#worldDims()
    if (ctx && r && dims) {
      this.#shaker.update(dt)
      const sh = this.#shaker.offset()
      // Clear the whole backing buffer in device space first so a shake translate
      // can never smear the trailing edge; then draw the world through the scale
      // transform with the shake folded into its translation.
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
      ctx.setTransform(this.#scaleBack, 0, 0, this.#scaleBack, sh.x * this.#scaleBack, sh.y * this.#scaleBack)
      if (this.#mode === 'play' && this.#engine) {
        if (this.#transition) {
          // A level was cleared: the simulation is frozen while the score tallies
          // and the next screen scrolls in.
          this.#stepTransition(dt)
          this.#drawTransition(ctx, r, dims)
        } else {
          this.#physicsTime = Math.min(
            this.#physicsTime + dt,
            PHYSICS_STEP * MAX_PHYSICS_STEPS,
          )
          while (this.#physicsTime >= PHYSICS_STEP) {
            this.#engine.update(PHYSICS_STEP)
            this.#physicsTime -= PHYSICS_STEP
          }
          this.#senseJuice()
          if (this.#engine.score > this.#hiscore) { this.#hiscore = this.#engine.score; this.#hiscoreDirty = true }
          r.draw(this.#engine, this.#time, this.#hiscore)
          this.#drawIntro(ctx, dims, dt)
          if (this.#engine.state === 'won') this.#beginClear()
          else if (this.#engine.state === 'gameover' && !this.#overShown) { this.#overShown = true; this.#saveHiscore(); this.#showGameOver() }
        }
      } else if (this.#mode === 'design') {
        r.drawEditor(this.#designer.level, this.#hover, this.#time)
      }
    }
    this.#raf = requestAnimationFrame(this.#loop)
  }

  // ── juice: shake + level intro ───────────────────────────

  /** Read the post-update engine state and convert meaningful changes into shake.
   *  Pure inference (score/lives deltas) keeps the engine free of view concerns. */
  #senseJuice(): void {
    const e = this.#engine
    if (!e) return
    if (e.lives < this.#prevLives) this.#shaker.add(0.8)               // a life lost — big kick
    const ds = e.score - this.#prevScore
    if (ds > 0) this.#shaker.add(Math.min(0.5, 0.1 + ds / 3500))       // pop / capture / fruit
    this.#prevScore = e.score
    this.#prevLives = e.lives
  }

  /** Snap the juice baselines to an engine without firing shake (level swaps). */
  #syncJuice(e: Engine): void {
    this.#prevScore = e.score
    this.#prevLives = e.lives
    this.#shaker = new Shaker()
  }

  #beginIntro(title: string, sub: string): void { this.#intro = { t: 0, title, sub } }

  /** A short, non-blocking title card that pops in (overshoot), holds, then fades.
   *  Drawn in world units over the live game so play never stalls behind it. */
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
    ctx.shadowColor = 'rgba(126,224,255,0.6)'
    ctx.shadowBlur = 20
    ctx.fillStyle = ARCADE.cyan
    ctx.font = '800 ' + Math.round(h * 0.085) + 'px "Segoe UI", system-ui, sans-serif'
    ctx.fillText(intro.title, 0, 0)
    ctx.shadowBlur = 0
    ctx.fillStyle = '#eef4ff'
    ctx.font = '600 ' + Math.round(h * 0.04) + 'px "Segoe UI", system-ui, sans-serif'
    ctx.fillText(intro.sub, 0, h * 0.08)
    ctx.restore()
  }

  // ── input: play (fully isolated) ─────────────────────────

  #onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); this.#onClose(); return }
    // While typing a level name, let the field receive keys untouched.
    if (document.activeElement === this.#nameInput) return
    // Let OS/browser shortcuts (Ctrl/Cmd/Alt combos — refresh, devtools, …) pass.
    if (e.ctrlKey || e.metaKey || e.altKey) return
    // Otherwise FULLY isolate — stop + preventDefault every plain key so none
    // reaches the shell (a leaked key can flip the app into website/view mode).
    e.preventDefault(); e.stopImmediatePropagation()
    if (this.#mode !== 'play') return
    const eng = this.#engine
    if (!eng || !GAME_KEYS.has(e.key)) return
    switch (e.key) {
      case 'ArrowLeft': case 'a': case 'A': eng.input.left = true; break
      case 'ArrowRight': case 'd': case 'D': eng.input.right = true; break
      // K = jump. The impulse is edge-triggered; the HELD state is what lets
      // Bub bounce off bubble crowns instead of popping them (the arcade move).
      case 'k': case 'K': eng.input.jump = true; if (!e.repeat) eng.jump(); break
      case 'j': case 'J': if (!e.repeat) eng.blow(); break        // J = blow a bubble
      case 'r': case 'R': this.#startPlay(this.#levels[this.#levelIndex]); break
    }
  }

  #onKeyUp = (e: KeyboardEvent): void => {
    if (document.activeElement === this.#nameInput) return
    if (e.ctrlKey || e.metaKey || e.altKey) return
    e.stopImmediatePropagation()
    const eng = this.#engine
    if (!eng || this.#mode !== 'play') return
    switch (e.key) {
      case 'ArrowLeft': case 'a': case 'A': eng.input.left = false; break
      case 'ArrowRight': case 'd': case 'D': eng.input.right = false; break
      case 'k': case 'K': eng.input.jump = false; break
    }
  }

  // ── input: designer painting ─────────────────────────────

  #cellFromEvent(e: PointerEvent): { col: number; row: number } | null {
    const c = this.#canvas, dims = this.#worldDims()
    if (!c || !dims) return null
    const rect = c.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null
    const wx = ((e.clientX - rect.left) / rect.width) * dims.w
    const wy = ((e.clientY - rect.top) / rect.height) * dims.h
    return { col: Math.floor(wx / TILE), row: Math.floor(wy / TILE) }
  }

  #onPointerDown = (e: PointerEvent): void => {
    if (this.#mode !== 'design') return
    const cell = this.#cellFromEvent(e)
    if (!cell) return
    this.#painting = true
    this.#lastCell = { col: -1, row: -1 }
    this.#paintAt(cell)
    // Capture keeps a stroke alive past the canvas edge. It throws if the
    // pointer is already gone by the time we ask — never let that abort a paint.
    try { this.#canvas?.setPointerCapture?.(e.pointerId) } catch { /* pointer already released */ }
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
    this.#syncThemeSelect()
    this.#fit()
    this.#flash('new blank level')
  }

  /** Point the world picker at whatever level the designer now holds. */
  #syncThemeSelect(): void {
    if (this.#themeSelect) this.#themeSelect.value = String(this.#designer.level.theme ?? 0)
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
    // A level with no enemies can never be cleared — don't drop into an
    // unwinnable playtest; nudge the author to place a foe first.
    if (this.#designer.level.enemies.length === 0) { this.#flash('place an enemy before testing'); return }
    // Playtest the in-progress level without requiring a save.
    this.#refreshLevels()
    this.#mode = 'play'
    this.#playBar?.classList.remove('bub-hidden')
    this.#designBar?.classList.add('bub-hidden')
    this.#stage?.classList.remove('bub-design')   // playtests never scroll
    const tabs = this.#root?.querySelectorAll('.bub-tab')
    tabs?.forEach((t, i) => t.classList.toggle('on', i === 0))
    this.#engine = new Engine(cloneLevel(this.#designer.level))
    this.#testing = true
    this.#transition = null
    this.#overShown = false
    this.#levelStartScore = this.#engine.score
    this.#levelStartLives = this.#engine.lives
    this.#syncJuice(this.#engine)
    this.#hideBanner()
    this.#fit()
    this.#updateLevelLabel(this.#designer.level.name, true)
    this.#beginIntro(this.#designer.level.name, 'TEST')
  }

  #designerLoad(name: string): void {
    if (!name) return
    const lvl = loadCustomLevels().find(l => l.name === name)
      ?? BUILTIN_LEVELS.find(l => l.name === name)
    if (!lvl) return
    this.#designer.setLevel(lvl)
    if (this.#nameInput) this.#nameInput.value = lvl.name
    this.#syncThemeSelect()
    this.#fit()
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
      this.#syncThemeSelect()
      this.#fit()
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

  // ── banners + status ─────────────────────────────────────

  // ── level clear → tally → pan to next (continuous play) ──

  /** Level cleared. Compute the level's score gain + any perfect bonus and open
   *  the tally→pan transition. Levels wrap, so play never stops on a clear. */
  #beginClear(): void {
    const eng = this.#engine
    if (!eng || this.#transition) return
    const levelScore = Math.max(0, eng.score - this.#levelStartScore)
    // lives only ever fall within a level, so "same as we started" ⇒ no deaths.
    // But a diamond room has nothing that can kill you, and an umbrella cuts the
    // round short rather than clearing it — neither earns the perfect bonus.
    const perfect = !this.#inBonus && eng.warp === 0 && eng.lives >= this.#levelStartLives
    const bonus = perfect ? PERFECT_BONUS : 0

    const count = Math.max(1, this.#levels.length)
    // Where a cleared round hands off to, in priority order: a designer test
    // re-runs itself; leaving a diamond room resumes the round it interrupted;
    // an umbrella skips ahead; otherwise every BONUS_EVERY rounds the diamond
    // room drops in, and failing all that we simply advance.
    let nextIndex: number
    let nextLevel: LevelDef
    let intoBonus = false
    if (this.#testing) {
      nextIndex = this.#levelIndex
      nextLevel = this.#designer.level
    } else if (this.#inBonus) {
      nextIndex = this.#levelIndex           // already points at the resume round
      nextLevel = this.#levels[nextIndex] ?? eng.level
    } else if (eng.warp > 0) {
      nextIndex = (this.#levelIndex + eng.warp) % count
      nextLevel = this.#levels[nextIndex] ?? eng.level
    } else {
      nextIndex = (this.#levelIndex + 1) % count
      if ((this.#levelIndex + 1) % BONUS_EVERY === 0) {
        intoBonus = true
        nextLevel = cloneLevel(DIAMOND_ROOM)  // nextIndex stays the resume round
      } else {
        nextLevel = this.#levels[nextIndex] ?? eng.level
      }
    }

    this.#transition = {
      phase: 'tally', t: 0,
      levelScore, bonus, baseScore: this.#levelStartScore,
      nextLevel, nextIndex, testing: this.#testing,
      warp: eng.warp, intoBonus, prev: eng,
    }
    this.#saveHiscore()
    this.#hideBanner()
  }

  // ── high score (participant-local) ───────────────────────

  #loadHiscore(): number {
    try {
      const n = parseInt(localStorage.getItem(HISCORE_KEY) ?? '0', 10)
      return Number.isFinite(n) && n > 0 ? n : 0
    } catch { return 0 }
  }

  #saveHiscore(): void {
    if (!this.#hiscoreDirty) return
    this.#hiscoreDirty = false
    try { localStorage.setItem(HISCORE_KEY, String(this.#hiscore)) } catch { /* quota / disabled */ }
  }

  /** Advance the active transition: count the tally, then build + scroll in the
   *  next level (carrying the running score — bonus included — and lives). */
  #stepTransition(dt: number): void {
    const tr = this.#transition
    if (!tr) return
    tr.t += dt
    if (tr.phase === 'tally') {
      if (tr.t < TALLY_MS) return
      const carriedScore = tr.baseScore + tr.levelScore + tr.bonus
      const e = new Engine(cloneLevel(tr.nextLevel))
      e.lives = tr.prev.lives
      // seed (not assign) so a clear bonus crossing an extra-life threshold
      // between screens still awards the 1UP
      e.seedScore(carriedScore, tr.prev.score)
      e.carryLifePowersFrom(tr.prev)   // sweets (shoes / candy) persist across screens, lost only on death
      this.#engine = e
      this.#levelIndex = tr.nextIndex
      this.#inBonus = tr.intoBonus   // set before the label reads it
      this.#levelStartScore = e.score
      this.#levelStartLives = e.lives
      this.#syncJuice(e)
      this.#updateLevelLabel(e.level.name, tr.testing)
      this.#fit()
      tr.phase = 'pan'
      tr.t = 0
    } else if (tr.t >= PAN_MS) {
      this.#transition = null   // hand control back — play resumes on the new level
      const lvl = this.#engine?.level
      this.#beginIntro(lvl?.name ?? '', lvl ? this.#introSub(lvl) : '')
    }
  }

  /** Render the transition: the frozen cleared level under the score tally, then
   *  the cleared level sliding off the top while the next rises from the bottom. */
  #drawTransition(ctx: CanvasRenderingContext2D, r: Renderer, dims: { w: number; h: number }): void {
    const tr = this.#transition
    if (!tr) return
    if (tr.phase === 'tally') {
      r.draw(tr.prev, this.#time, this.#hiscore)
      this.#drawTally(ctx, dims, tr)
    } else {
      // Pan: the outgoing level scrolls up and off while the next rises from
      // below. Each is drawn through its OWN fit transform (not the shared one)
      // so a pan between DIFFERENT-sized levels — e.g. a 20×12 screen handing
      // off to a 28×18 one — stays correctly scaled and fully scrolls clear.
      const p = easeInOut(Math.min(1, tr.t / PAN_MS))
      const ch = ctx.canvas.height
      this.#drawLevelFitted(r, tr.prev, -p * ch)             // outgoing → off the top
      this.#drawLevelFitted(r, this.#engine!, (1 - p) * ch)  // incoming ← up from below
    }
  }

  /** Draw one level fit + centred into the current backing buffer, shifted
   *  vertically by `dyDevice` device pixels. Sets its own transform so each
   *  level in a pan uses its own scale, independent of #scaleBack. */
  #drawLevelFitted(r: Renderer, eng: Engine, dyDevice: number): void {
    const ctx = this.#ctx
    if (!ctx) return
    const cw = ctx.canvas.width, chh = ctx.canvas.height
    const scale = Math.min(cw / eng.width, chh / eng.height)
    const ox = (cw - eng.width * scale) / 2
    const oy = (chh - eng.height * scale) / 2 + dyDevice
    ctx.setTransform(scale, 0, 0, scale, ox, oy)
    r.draw(eng, this.#time, this.#hiscore)
  }

  /** The score add-up overlay: level gain counts up first, then any perfect
   *  bonus, with the running total ticking alongside. Drawn in world units so it
   *  scales with the canvas. */
  #drawTally(ctx: CanvasRenderingContext2D, dims: { w: number; h: number }, tr: Transition): void {
    const { w, h } = dims
    const cx = w / 2
    const p = Math.min(1, tr.t / TALLY_MS)
    // Count the level score over the first ~62%, then the bonus over the rest.
    const levelP = Math.min(1, p / 0.62)
    const bonusP = tr.bonus > 0 ? Math.max(0, Math.min(1, (p - 0.62) / 0.30)) : 0
    const shownLevel = Math.round(tr.levelScore * levelP)
    const shownBonus = Math.round(tr.bonus * bonusP)
    const shownTotal = tr.baseScore + shownLevel + shownBonus
    const font = (size: number, weight = 700) =>
      `${weight} ${Math.round(size)}px "Segoe UI", system-ui, sans-serif`

    ctx.save()
    ctx.fillStyle = 'rgba(6,4,18,0.62)'
    ctx.fillRect(0, 0, w, h)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    ctx.fillStyle = tr.warp > 0 ? '#ff9ad5' : '#7ee0ff'
    ctx.font = font(h * 0.10, 800)
    ctx.fillText(tr.warp > 0 ? 'WARP!' : 'LEVEL CLEAR', cx, h * 0.30)

    // what's coming: an umbrella's skip, or the diamond room dropping in
    if (tr.warp > 0 || tr.intoBonus) {
      ctx.fillStyle = '#ffd76a'
      ctx.font = font(h * 0.045, 700)
      ctx.fillText(tr.warp > 0 ? `SKIP ${tr.warp} ROUNDS` : '◆  DIAMOND ROOM  ◆', cx, h * 0.385)
    }

    ctx.fillStyle = '#ffffff'
    ctx.font = font(h * 0.052)
    ctx.fillText(`Level  +${shownLevel}`, cx, h * 0.46)

    if (tr.bonus > 0) {
      ctx.fillStyle = bonusP > 0 ? '#ffd76a' : 'rgba(255,215,106,0.28)'
      ctx.fillText(`Perfect Bonus  +${shownBonus}`, cx, h * 0.555)
    }

    ctx.fillStyle = '#bfe3ff'
    ctx.font = font(h * 0.062, 800)
    ctx.fillText(`✦ ${shownTotal}`, cx, h * 0.69)
    ctx.restore()
  }

  #showGameOver(): void {
    const score = this.#engine?.score ?? 0
    this.#showBanner('Game Over', `✦ ${score}`, [
      { label: '↻ Retry', fn: () => this.#startPlay(this.#levels[this.#levelIndex]) },
    ])
  }

  #showBanner(title: string, sub: string, actions: { label: string; fn: () => void }[]): void {
    const b = this.#banner
    if (!b) return
    b.innerHTML = ''
    b.appendChild(el('div', { class: 'bub-banner-title', text: title }))
    b.appendChild(el('div', { class: 'bub-banner-sub', text: sub }))
    const row = el('div', { class: 'bub-banner-actions' })
    for (const a of actions) {
      const btn = el('button', { class: 'bub-btn bub-btn-lg', text: a.label }) as HTMLButtonElement
      btn.onclick = a.fn
      row.appendChild(btn)
    }
    b.appendChild(row)
    b.classList.remove('bub-hidden')
  }

  #hideBanner(): void { this.#banner?.classList.add('bub-hidden') }

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
.bub-overlay{position:fixed;inset:0;display:flex;flex-direction:column;
  background:radial-gradient(120% 120% at 50% 0%,#1b1450 0%,#0b0826 60%,#050314 100%);
  font-family:'Segoe UI',system-ui,sans-serif;color:#e9e6ff;user-select:none;
  animation:bub-in .2s ease both}
@keyframes bub-in{from{opacity:0}to{opacity:1}}
.bub-bar{display:flex;align-items:center;gap:.6rem;padding:.45rem .7rem;
  background:rgba(10,8,26,.7);border-bottom:1px solid rgba(126,182,214,.25);flex-wrap:wrap}
.bub-logo{font-weight:800;letter-spacing:.02em;color:#7ee0ff;white-space:nowrap;
  text-shadow:0 0 14px rgba(126,224,255,.45)}
.bub-tabs{display:flex;gap:.25rem;margin-left:.4rem}
.bub-tab{background:transparent;border:1px solid rgba(126,182,214,.3);color:#c9c4ec;
  padding:.2rem .7rem;border-radius:999px;cursor:pointer;font-size:.85rem}
.bub-tab.on{background:rgba(126,224,255,.22);color:#fff;border-color:rgba(126,224,255,.6)}
.bub-ctl{display:flex;align-items:center;gap:.35rem;flex-wrap:wrap}
.bub-level-label{min-width:11rem;text-align:center;font-size:.85rem;color:#cfd2ff}
.bub-btn{background:rgba(126,182,214,.12);border:1px solid rgba(126,182,214,.3);
  color:#dfe7ff;padding:.22rem .6rem;border-radius:7px;cursor:pointer;font-size:.82rem;
  transition:background .15s ease}
.bub-btn:hover{background:rgba(126,182,214,.26)}
.bub-btn-lg{padding:.5rem 1.15rem;font-size:.95rem}
.bub-palette{display:flex;gap:.2rem}
.bub-tool{width:2rem;height:2rem;display:flex;align-items:center;justify-content:center;
  background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.15);border-radius:6px;
  color:#fff;cursor:pointer;font-size:1rem;line-height:1}
.bub-tool.on{background:rgba(126,224,255,.3);border-color:rgba(126,224,255,.8);box-shadow:0 0 8px rgba(126,224,255,.5)}
.bub-name{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.2);
  color:#fff;border-radius:6px;padding:.25rem .5rem;width:9rem;font-size:.82rem}
.bub-select{background:rgba(20,14,36,.95);border:1px solid rgba(255,255,255,.2);
  color:#fff;border-radius:6px;padding:.22rem .4rem;font-size:.8rem;max-width:11rem}
.bub-status{margin-left:.4rem;font-size:.8rem;color:#9ad9b0;min-height:1em}
.bub-close{margin-left:auto;width:2rem;height:2rem;border-radius:50%;border:none;cursor:pointer;
  background:rgba(255,80,80,.18);color:#ff9a9a;font-size:1rem}
.bub-close:hover{background:rgba(255,80,80,.34);color:#fff}
.bub-stage{flex:1;display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden;padding:14px}
/* Designing: the zoomed grid is bigger than the stage, so it has to scroll. The
   centring switches to auto-margins — flexbox centring makes overflow on the
   top/left edge unreachable, which would strand part of the room. */
.bub-stage.bub-design{overflow:auto;align-items:flex-start;justify-content:flex-start}
.bub-stage.bub-design .bub-canvas{margin:auto}
.bub-zoom{max-width:6.5rem}
.bub-canvas{border-radius:12px;
  box-shadow:0 16px 60px rgba(0,0,0,.6),0 0 0 1px rgba(126,182,214,.22),0 0 40px rgba(80,140,255,.12);
  background:#080620;touch-action:none}
.bub-banner{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;
  justify-content:center;gap:.7rem;background:rgba(6,4,18,.72);backdrop-filter:blur(3px)}
.bub-banner-title{font-size:2.4rem;font-weight:800;color:#7ee0ff;text-shadow:0 2px 22px rgba(120,220,255,.55)}
.bub-banner-sub{font-size:1.1rem;color:#ffd76a}
.bub-banner-actions{display:flex;gap:.6rem;margin-top:.4rem}
.bub-help{padding:.45rem .8rem;text-align:center;font-size:.78rem;color:#9c98c4;
  background:rgba(10,8,26,.6);border-top:1px solid rgba(126,182,214,.15)}
.bub-help b{color:#dfe7ff}
.bub-hidden{display:none!important}
`
