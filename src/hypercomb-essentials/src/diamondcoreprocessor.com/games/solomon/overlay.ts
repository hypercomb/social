// diamondcoreprocessor.com/games/solomon/overlay.ts
//
// The full-screen game shell. Owns the DOM (backdrop, toolbar, canvas, banners),
// the requestAnimationFrame loop, keyboard input for play, and pointer input for
// the designer. It's a self-contained mini-app: it never touches the hex grid or
// Pixi — it mounts above everything as a fixed overlay and tears itself fully
// down on close. The SolomonDrone owns its lifecycle (open/close).

import { Engine, TILE, type LevelDef } from './engine.js'
import { Renderer } from './renderer.js'
import { Designer, TOOLS, type Tool } from './designer.js'
import { BUILTIN_LEVELS, loadCustomLevels, upsertCustomLevel, deleteCustomLevel, cloneLevel } from './levels.js'
import { Shaker, ParticleField, easeOutBack, ARCADE } from '../juice.js'

const STYLE_ID = 'sol-overlay-styles'
const Z = 2147483000

const GAME_KEYS = new Set([
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', 'Spacebar',
  'a', 'A', 'd', 'D', 'w', 'W', 's', 'S',
  'j', 'J', 'k', 'K', 'z', 'Z', 'x', 'X', 'r', 'R',
])

type Mode = 'play' | 'design'

// Level-clear flow (continuous play — identical to the Bubble overlay so every
// game advances the same way): on clearing a screen we tally the level's score
// (+ any perfect bonus) counting up, then scroll the next level UP from the
// bottom — no button press, you just keep playing. Score + lives carry across
// levels; the toolbar still has prev / next / restart for jumping around.
const TALLY_MS = 1.7          // how long the score add-up reads
const PAN_MS = 0.85           // how long the next level takes to slide in
const PERFECT_BONUS = 1000    // awarded when a level is cleared without dying

/** One in-flight level-clear transition: first 'tally' (count the score up),
 *  then 'pan' (slide the cleared level off the top while the next rises from
 *  below). `prev` is the cleared engine, kept so it can be drawn scrolling out. */
interface Transition {
  phase: 'tally' | 'pan'
  t: number               // seconds into the current phase
  levelScore: number      // points earned on the just-cleared level
  timeBonus: number       // remaining life-meter converted to score (NES time bonus)
  bonus: number           // perfect-clear bonus (0 if a life was lost)
  baseScore: number       // running total at the start of the cleared level
  nextLevel: LevelDef     // the level rising in
  nextIndex: number       // its index in #levels (for the toolbar label)
  testing: boolean        // cleared a designer test (re-pans the same level)
  prev: Engine            // the cleared engine — drawn scrolling out during 'pan'
}

/** easeInOut cubic — slow start, slow settle; reads as the screen easing up. */
function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
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

  #raf = 0
  #lastTs = 0
  #time = 0
  #overShown = false

  // juice: trauma screen-shake + a short additive particle field + a level-intro
  // title card — the shared "modern vector arcade" kit, mirroring the Bubble
  // overlay. Solomon is pixel-crisp (no scale transform, smoothing OFF), so the
  // shaker runs SMALL and its offset is ROUNDED into the frame each draw. Shake
  // is driven purely by score/lives/conjure deltas read after engine.update().
  #shaker = new Shaker(7, 1.8)
  #field = new ParticleField()
  #prevScore = 0
  #prevLives = 3
  #prevConjure = 0
  #prevSmash = 0
  #prevPickup = 0
  #intro: { t: number; title: string; sub: string } | null = null

  // Continuous-play state (see the Transition note above). The engine's score is
  // the RUNNING total carried across levels; the snapshots below record where the
  // current level began so a clear can show its own gain + award a perfect bonus.
  #transition: Transition | null = null
  #levelStartScore = 0
  #levelStartLives = 3
  #testing = false   // playing a designer test (not part of the level list)

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
    prev.onclick = () => this.#cycleLevel(-1)
    next.onclick = () => this.#cycleLevel(1)
    restart.onclick = () => this.#startPlay(this.#levels[this.#levelIndex])
    playBar.append(prev, label, next, restart)
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
    help.innerHTML = '<b>← →</b> move &nbsp;·&nbsp; <b>↑</b> jump (head-butt bricks) &nbsp;·&nbsp; <b>↓</b> duck &nbsp;·&nbsp; <b>Z</b> conjure / dispel a block &nbsp;·&nbsp; <b>X</b> fireball <i>(needs a jar)</i> &nbsp;·&nbsp; drop foes off ledges, grab the key, beat the timer &nbsp;·&nbsp; <b>R</b> restart &nbsp;·&nbsp; <b>Esc</b> close'
    root.appendChild(help)

    document.body.appendChild(root)
    this.#root = root
    this.#canvas = canvas
    this.#ctx = canvas.getContext('2d')
    if (this.#ctx) { this.#ctx.imageSmoothingEnabled = false; this.#renderer = new Renderer(this.#ctx) }
    this.#refreshLoadSelect()
  }

  // ── mode + level control ─────────────────────────────────

  #setMode(mode: Mode): void {
    if (this.#mode === mode) return
    this.#mode = mode
    const tabs = this.#root?.querySelectorAll('.sol-tab')
    tabs?.forEach((t, i) => t.classList.toggle('on', (i === 0) === (mode === 'play')))
    this.#playBar?.classList.toggle('sol-hidden', mode !== 'play')
    this.#designBar?.classList.toggle('sol-hidden', mode !== 'design')
    this.#hideBanner()
    if (mode === 'play') this.#startPlay(this.#levels[this.#levelIndex])
    else { this.#sizeCanvasTo(this.#designer.level); this.#updateToolButtons() }
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
    this.#transition = null
    this.#overShown = false
    this.#levelStartScore = this.#engine.score
    this.#levelStartLives = this.#engine.lives
    this.#syncJuice(this.#engine)
    this.#hideBanner()
    this.#sizeCanvasTo(level)
    if (this.#levelLabel) {
      const n = this.#levelIndex + 1, total = this.#levels.length
      this.#levelLabel.textContent = `${level.name}  (${n}/${total})`
    }
    this.#beginIntro(level.name, 'LEVEL ' + (this.#levelIndex + 1))
  }

  #sizeCanvasTo(level: { cols: number; rows: number }): void {
    if (!this.#canvas) return
    this.#canvas.width = level.cols * TILE
    this.#canvas.height = level.rows * TILE
    if (this.#ctx) this.#ctx.imageSmoothingEnabled = false
    this.#fit()
  }

  #fit = (): void => {
    const c = this.#canvas, s = this.#stage
    if (!c || !s) return
    const availW = s.clientWidth - 24
    const availH = s.clientHeight - 24
    if (availW <= 0 || availH <= 0) return
    const scale = Math.max(1, Math.floor(Math.min(availW / c.width, availH / c.height) * 100) / 100)
    c.style.width = `${c.width * scale}px`
    c.style.height = `${c.height * scale}px`
  }

  // ── the loop ─────────────────────────────────────────────

  #loop = (ts: number): void => {
    if (!this.#root) return
    if (!this.#lastTs) this.#lastTs = ts
    const dt = Math.min((ts - this.#lastTs) / 1000, 1 / 30)
    this.#lastTs = ts
    this.#time += dt

    const ctx = this.#ctx, r = this.#renderer
    if (!ctx || !r) { this.#raf = requestAnimationFrame(this.#loop); return }

    // The canvas is sized in world pixels (no scale transform; smoothing OFF), so
    // screen shake is just a small translate folded into the frame. Clear the WHOLE
    // canvas first so a shake offset can never smear the trailing edge, then draw
    // the frame inside a save/translate(rounded shake)/restore — rounding keeps the
    // pixel art crisp. Shake stays at rest in the designer (never advanced/added).
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)

    if (this.#mode === 'play' && this.#engine) {
      this.#shaker.update(dt)
      const sh = this.#shaker.offset()
      ctx.save()
      ctx.translate(Math.round(sh.x), Math.round(sh.y))
      if (this.#transition) {
        // A level was cleared: the simulation is frozen while the score tallies
        // and the next screen scrolls in.
        this.#stepTransition(dt)
        this.#drawTransition(r)
      } else {
        this.#engine.update(dt)
        this.#senseJuice(dt)
        r.draw(this.#engine, this.#time)
        this.#field.update(dt)
        this.#field.draw(ctx)
        this.#drawIntro(ctx, { w: this.#engine.width, h: this.#engine.height }, dt)
        if (this.#engine.state === 'won') this.#beginClear()
        else if (this.#engine.state === 'gameover' && !this.#overShown) { this.#overShown = true; this.#showGameOver() }
      }
      ctx.restore()
    } else if (this.#mode === 'design') {
      r.drawEditor(this.#designer.level, this.#hover, this.#time)
    }
    this.#raf = requestAnimationFrame(this.#loop)
  }

  // ── juice: shake + particles + level intro ───────────────

  /** Read the post-update engine state and convert meaningful changes into shake
   *  and particle bursts. Pure inference (score / lives / conjure deltas) keeps
   *  the engine free of any view concerns. Called inside the shaken frame, so the
   *  bursts it spawns land in world units under the same translate. */
  #senseJuice(_dt: number): void {
    const e = this.#engine
    if (!e) return

    // Life lost — big kick + a spray of sparks at Dana's centre.
    if (e.lives < this.#prevLives) {
      this.#shaker.add(0.9)
      const px = e.player.x + e.player.w / 2
      const py = e.player.y + e.player.h / 2
      this.#field.burst(px, py, {
        count: 22, speed: 140, gravity: 260, life: 0.6,
        size: 2.6, color: [...ARCADE.spark],
      })
    }

    // Conjure / dispel / fireball muzzle — engine sets conjureFlash on its rising
    // edge. A small nudge + a short upward stone-dust puff at the target cell.
    if (e.conjureFlash > this.#prevConjure + 1e-4) {
      this.#shaker.add(0.18)
      const cell = e.targetCell()
      const cx = cell.col * TILE + TILE / 2
      const cy = cell.row * TILE + TILE / 2
      this.#field.burst(cx, cy, {
        count: 10, speed: 90, gravity: 120, life: 0.45,
        size: 2.2, color: [...ARCADE.ember], angle: -Math.PI / 2, arc: 1.6,
      })
    }

    // Head-butt — a BRICK shattered overhead. A sharp kick plus stone debris
    // bursting from the broken cell and tumbling down under gravity.
    if (e.smashFlash > this.#prevSmash + 1e-4 && e.smashCell) {
      this.#shaker.add(0.34)
      const sx = e.smashCell.col * TILE + TILE / 2
      const sy = e.smashCell.row * TILE + TILE / 2
      this.#field.burst(sx, sy, {
        count: 16, speed: 130, gravity: 340, life: 0.5,
        size: 2.6, color: [...ARCADE.ember],
      })
    }

    // Item grabbed — a quick bright sparkle at the pickup cell (the engine bumps
    // pickupFlash on its rising edge and records the cell).
    if (e.pickupFlash > this.#prevPickup && e.pickupCell) {
      const cx = e.pickupCell.col * TILE + TILE / 2
      const cy = e.pickupCell.row * TILE + TILE / 2
      this.#field.burst(cx, cy, {
        count: 12, speed: 80, gravity: 30, life: 0.5,
        size: 2.2, color: [...ARCADE.spark],
      })
    }

    // Any score gain (kill / jewel / key / door) — a small proportional shake. We
    // don't have exact positions for most of these, so a kick alone is enough.
    const ds = e.score - this.#prevScore
    if (ds > 0) this.#shaker.add(Math.min(0.5, 0.12 + ds / 1500))

    this.#prevScore = e.score
    this.#prevLives = e.lives
    this.#prevConjure = e.conjureFlash
    this.#prevSmash = e.smashFlash
    this.#prevPickup = e.pickupFlash
  }

  /** Snap the juice baselines to an engine without firing shake (level swaps),
   *  and reset the shaker + particle field so nothing carries across a level. */
  #syncJuice(e: Engine): void {
    this.#prevScore = e.score
    this.#prevLives = e.lives
    this.#prevConjure = e.conjureFlash
    this.#prevSmash = e.smashFlash
    this.#prevPickup = e.pickupFlash
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
    ctx.shadowColor = 'rgba(126,224,255,0.55)'
    ctx.shadowBlur = 18
    ctx.fillStyle = ARCADE.cyan
    ctx.font = '800 ' + Math.round(h * 0.085) + 'px "Segoe UI", system-ui, sans-serif'
    ctx.fillText(intro.title, 0, 0)
    ctx.shadowBlur = 0
    ctx.fillStyle = ARCADE.gold
    ctx.font = '600 ' + Math.round(h * 0.04) + 'px "Segoe UI", system-ui, sans-serif'
    ctx.fillText(intro.sub, 0, h * 0.08)
    ctx.restore()
  }

  // ── input: play ──────────────────────────────────────────

  #onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); this.#onClose(); return }
    // While typing in the designer's name field, let the field have its keys.
    if (document.activeElement === this.#nameInput) return
    // Let OS/browser shortcuts (Ctrl/Cmd/Alt combos) pass.
    if (e.ctrlKey || e.metaKey || e.altKey) return
    // Otherwise FULLY isolate — stop + preventDefault every plain key so none
    // leaks to the shell beneath this full-screen overlay (a stray key can
    // otherwise flip the app into website/view mode). Matches Bubble + Arkanoid.
    e.preventDefault(); e.stopImmediatePropagation()
    if (this.#mode !== 'play' || !this.#engine) return
    const eng = this.#engine
    if (!GAME_KEYS.has(e.key)) return
    switch (e.key) {
      case 'ArrowLeft': case 'a': case 'A': eng.input.left = true; break
      case 'ArrowRight': case 'd': case 'D': eng.input.right = true; break
      case 'ArrowUp': case 'w': case 'W': case ' ': case 'Spacebar':
        if (!e.repeat) eng.jump(); break
      case 'ArrowDown': case 's': case 'S': eng.input.down = true; break
      case 'j': case 'J': case 'z': case 'Z': if (!e.repeat) eng.cast(); break    // conjure / dispel a block
      case 'k': case 'K': case 'x': case 'X': if (!e.repeat) eng.fireball(); break // fireball (needs ammo)
      case 'r': case 'R': this.#startPlay(this.#levels[this.#levelIndex]); break
    }
  }

  #onKeyUp = (e: KeyboardEvent): void => {
    if (document.activeElement === this.#nameInput) return
    if (e.ctrlKey || e.metaKey || e.altKey) return
    e.stopImmediatePropagation()
    if (!this.#engine) return
    switch (e.key) {
      case 'ArrowLeft': case 'a': case 'A': this.#engine.input.left = false; break
      case 'ArrowRight': case 'd': case 'D': this.#engine.input.right = false; break
      case 'ArrowDown': case 's': case 'S': this.#engine.input.down = false; break
    }
  }

  // ── input: designer painting ─────────────────────────────

  #cellFromEvent(e: PointerEvent): { col: number; row: number } | null {
    const c = this.#canvas
    if (!c) return null
    const rect = c.getBoundingClientRect()
    const sx = c.width / rect.width, sy = c.height / rect.height
    const col = Math.floor(((e.clientX - rect.left) * sx) / TILE)
    const row = Math.floor(((e.clientY - rect.top) * sy) / TILE)
    return { col, row }
  }

  #onPointerDown = (e: PointerEvent): void => {
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
    // Playtest the in-progress level without requiring a save.
    this.#levels = [...BUILTIN_LEVELS.map(cloneLevel), ...loadCustomLevels()]
    this.#setMode('play')
    this.#engine = new Engine(cloneLevel(this.#designer.level))
    this.#testing = true
    this.#transition = null
    this.#overShown = false
    this.#levelStartScore = this.#engine.score
    this.#levelStartLives = this.#engine.lives
    this.#syncJuice(this.#engine)
    this.#hideBanner()
    this.#sizeCanvasTo(this.#designer.level)
    const tabs = this.#root?.querySelectorAll('.sol-tab')
    tabs?.forEach((t, i) => t.classList.toggle('on', i === 0))
    if (this.#levelLabel) this.#levelLabel.textContent = `${this.#designer.level.name}  (test)`
    this.#beginIntro(this.#designer.level.name, 'TEST')
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

  /** Level cleared. Compute the level's score gain + any perfect bonus and open
   *  the tally→pan transition. Levels wrap, so play never stops on a clear. */
  #beginClear(): void {
    const eng = this.#engine
    if (!eng || this.#transition) return
    const levelScore = Math.max(0, eng.score - this.#levelStartScore)
    // The life meter that's left when you reach the door becomes a time bonus —
    // the NES rewards beating the clock with margin to spare.
    const timeBonus = Math.round(eng.life)
    // lives only ever fall within a level, so "same as we started" ⇒ no deaths.
    const bonus = eng.lives >= this.#levelStartLives ? PERFECT_BONUS : 0

    const count = Math.max(1, this.#levels.length)
    const nextIndex = this.#testing ? this.#levelIndex : (this.#levelIndex + 1) % count
    const nextLevel = this.#testing
      ? this.#designer.level
      : (this.#levels[nextIndex] ?? eng.level)

    this.#transition = {
      phase: 'tally', t: 0,
      levelScore, timeBonus, bonus, baseScore: this.#levelStartScore,
      nextLevel, nextIndex, testing: this.#testing, prev: eng,
    }
    this.#hideBanner()
  }

  /** Advance the active transition: count the tally, then build + scroll in the
   *  next level (carrying the running score — bonus included — and lives). */
  #stepTransition(dt: number): void {
    const tr = this.#transition
    if (!tr) return
    tr.t += dt
    if (tr.phase === 'tally') {
      if (tr.t < TALLY_MS) return
      const carriedScore = tr.baseScore + tr.levelScore + tr.timeBonus + tr.bonus
      const e = new Engine(cloneLevel(tr.nextLevel))
      e.score = carriedScore
      e.lives = tr.prev.lives
      this.#engine = e
      this.#levelIndex = tr.nextIndex
      this.#levelStartScore = e.score
      this.#levelStartLives = e.lives
      this.#syncJuice(e)
      this.#sizeCanvasTo(e.level)
      if (this.#levelLabel) {
        this.#levelLabel.textContent = tr.testing
          ? `${e.level.name}  (test)`
          : `${e.level.name}  (${this.#levelIndex + 1}/${this.#levels.length})`
      }
      tr.phase = 'pan'
      tr.t = 0
    } else if (tr.t >= PAN_MS) {
      this.#transition = null   // hand control back — play resumes on the new level
      const e = this.#engine
      if (e) {
        this.#beginIntro(e.level.name, tr.testing ? 'TEST' : 'LEVEL ' + (this.#levelIndex + 1))
      }
    }
  }

  /** Render the transition: the frozen cleared level under the score tally, then
   *  the cleared level sliding off the top while the next rises from the bottom.
   *  The canvas is sized in world pixels (no scale transform), so we translate in
   *  world units directly. */
  #drawTransition(r: Renderer): void {
    const tr = this.#transition
    const ctx = this.#ctx
    if (!tr || !ctx) return
    if (tr.phase === 'tally') {
      r.draw(tr.prev, this.#time)
      this.#drawTally(ctx, { w: tr.prev.width, h: tr.prev.height }, tr)
    } else {
      const p = easeInOut(Math.min(1, tr.t / PAN_MS))
      const H = this.#engine!.height
      // The loop already cleared the full canvas before this translated frame.
      ctx.save(); ctx.translate(0, -p * H); r.draw(tr.prev, this.#time); ctx.restore()
      ctx.save(); ctx.translate(0, (1 - p) * H); r.draw(this.#engine!, this.#time); ctx.restore()
    }
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
    const score = this.#engine?.score ?? 0
    this.#showBanner('Game Over', `✦ ${score}`, [
      { label: '↻ Retry', fn: () => this.#startPlay(this.#levels[this.#levelIndex]) },
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
.sol-canvas{image-rendering:pixelated;border-radius:8px;
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
