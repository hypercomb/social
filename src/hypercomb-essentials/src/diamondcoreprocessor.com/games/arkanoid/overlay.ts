// diamondcoreprocessor.com/games/arkanoid/overlay.ts
//
// The full-screen Arkanoid shell. Owns the DOM (backdrop, toolbar, canvas,
// banners), the requestAnimationFrame loop, and input (keyboard + pointer for
// play, pointer painting for the level designer). Self-contained mini-app: it
// never touches the hex grid or Pixi — it mounts above everything as a fixed
// overlay and tears itself fully down on close. ArkanoidDrone owns its
// lifecycle. The canvas is drawn at device-pixel resolution (DPR transform) so
// the art stays crisp. Keyboard input is FULLY isolated while mounted so no
// keystroke leaks to the shell.
//
// Pointer note: the bat follows the mouse via a WINDOW-level pointermove (not a
// canvas-level one) so sliding the cursor past the canvas edge — or anywhere
// over the chrome — still drives the bat to the wall instead of freezing it.
// Clicking the play field also engages Pointer Lock: the cursor is hidden and
// captured, and the bat then tracks RELATIVE motion (movementX) so it never
// freezes even when the mouse would leave the browser window entirely. Esc
// releases the lock; ending the game or opening the designer releases it too.

import { Engine, W, H, BRICK_W, BRICK_H, BRICK_TOP } from './engine.js'
import { Renderer } from './renderer.js'
import { LEVELS, cloneLevel, loadCustomLevels, upsertCustomLevel, deleteCustomLevel, type ArkanoidLevel } from './levels.js'
import { Designer, TOOLS, type Tool } from './designer.js'

const STYLE_ID = 'ark-overlay-styles'
const Z = 2147483000

const GAME_KEYS = new Set([
  'ArrowLeft', 'ArrowRight', 'a', 'A', 'd', 'D', ' ', 'ArrowUp', 'r', 'R',
])

type Mode = 'play' | 'design'

export class ArkanoidOverlay {
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
  #levelIndex = 0

  // designer pointer paint state
  #painting = false
  #lastCell = { col: -1, row: -1 }
  #hover: { col: number; row: number } | null = null

  #raf = 0
  #lastTs = 0
  #time = 0
  #scaleBack = 1
  #wonShown = false
  #overShown = false
  #ro: ResizeObserver | null = null

  // Pointer Lock: while locked the cursor is hidden + captured by the canvas and
  // the bat tracks RELATIVE movement (movementX), so it never freezes when the
  // mouse would leave the canvas/window. #paddleTargetX accumulates that motion
  // in world units (the engine's movePaddleTo takes an absolute X).
  #locked = false
  #paddleTargetX = W / 2

  #onClose: () => void
  constructor(onClose: () => void) { this.#onClose = onClose }

  isMounted(): boolean { return !!this.#root }

  /** Jump straight to the level designer (used by `/arkanoid design`). */
  showDesigner(): void { this.#setMode('design') }

  // ── lifecycle ────────────────────────────────────────────
  mount(): void {
    if (this.#root) return
    this.#injectStyles()
    ;(document.activeElement as HTMLElement | null)?.blur?.()
    this.#build()
    this.#startPlay(this.#levelIndex)
    window.addEventListener('keydown', this.#onKeyDown, true)
    window.addEventListener('keyup', this.#onKeyUp, true)
    window.addEventListener('resize', this.#fit)
    window.addEventListener('pointermove', this.#onPointerMove)
    window.addEventListener('pointerup', this.#onPointerUp)
    document.addEventListener('pointerlockchange', this.#onLockChange)
    this.#ro = new ResizeObserver(() => this.#fit())
    if (this.#stage) this.#ro.observe(this.#stage)
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
    document.removeEventListener('pointerlockchange', this.#onLockChange)
    this.#exitLock()
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
    const root = el('div', { class: 'ark-overlay' }) as HTMLDivElement
    root.style.zIndex = String(Z)

    const bar = el('div', { class: 'ark-bar' })
    bar.appendChild(el('span', { class: 'ark-logo', text: '◗ Arkanoid' }))

    const tabs = el('div', { class: 'ark-tabs' })
    const playTab = el('button', { class: 'ark-tab on', text: 'Play' }) as HTMLButtonElement
    const designTab = el('button', { class: 'ark-tab', text: 'Design' }) as HTMLButtonElement
    playTab.onclick = () => this.#setMode('play')
    designTab.onclick = () => this.#setMode('design')
    tabs.append(playTab, designTab)
    bar.appendChild(tabs)

    // play controls
    const playBar = el('div', { class: 'ark-ctl' }) as HTMLDivElement
    const prev = el('button', { class: 'ark-btn', text: '‹' }) as HTMLButtonElement
    const next = el('button', { class: 'ark-btn', text: '›' }) as HTMLButtonElement
    const label = el('span', { class: 'ark-level-label' }) as HTMLSpanElement
    const restart = el('button', { class: 'ark-btn', text: '↻ Restart' }) as HTMLButtonElement
    prev.onclick = () => this.#cycleLevel(-1)
    next.onclick = () => this.#cycleLevel(1)
    restart.onclick = () => this.#startPlay(this.#levelIndex)
    playBar.append(prev, label, next, restart)
    bar.appendChild(playBar)
    this.#playBar = playBar
    this.#levelLabel = label

    // design controls
    const designBar = el('div', { class: 'ark-ctl ark-hidden' }) as HTMLDivElement
    const palette = el('div', { class: 'ark-palette' })
    for (const t of TOOLS) {
      const b = el('button', { class: 'ark-tool', title: t.label, text: t.label }) as HTMLButtonElement
      b.style.setProperty('--tool-color', t.color)
      b.onclick = () => this.#setTool(t.tool)
      this.#toolButtons.set(t.tool, b)
      palette.appendChild(b)
    }
    designBar.appendChild(palette)
    const nameInput = el('input', { class: 'ark-name', placeholder: 'level name' }) as HTMLInputElement
    nameInput.value = this.#designer.name
    designBar.appendChild(nameInput)
    this.#nameInput = nameInput
    const mkBtn = (txt: string, fn: () => void) => { const b = el('button', { class: 'ark-btn', text: txt }) as HTMLButtonElement; b.onclick = fn; return b }
    designBar.appendChild(mkBtn('New', () => this.#designerNew()))
    designBar.appendChild(mkBtn('Save', () => this.#designerSave()))
    designBar.appendChild(mkBtn('▶ Test', () => this.#designerTest()))
    const loadSel = el('select', { class: 'ark-select' }) as HTMLSelectElement
    loadSel.onchange = () => this.#designerLoad(loadSel.value)
    designBar.appendChild(loadSel)
    this.#loadSelect = loadSel
    designBar.appendChild(mkBtn('Delete', () => this.#designerDelete()))
    designBar.appendChild(mkBtn('Export', () => this.#designerExport()))
    designBar.appendChild(mkBtn('Import', () => this.#designerImport()))
    bar.appendChild(designBar)
    this.#designBar = designBar

    const status = el('span', { class: 'ark-status' }) as HTMLSpanElement
    bar.appendChild(status)
    this.#status = status

    const close = el('button', { class: 'ark-close', text: '✕', title: 'Close (Esc)' }) as HTMLButtonElement
    close.onclick = () => this.#onClose()
    bar.appendChild(close)
    root.appendChild(bar)

    const stage = el('div', { class: 'ark-stage' }) as HTMLDivElement
    const canvas = el('canvas', { class: 'ark-canvas' }) as HTMLCanvasElement
    canvas.addEventListener('pointerdown', this.#onPointerDown)
    stage.appendChild(canvas)
    const banner = el('div', { class: 'ark-banner ark-hidden' }) as HTMLDivElement
    stage.appendChild(banner)
    root.appendChild(stage)
    this.#stage = stage
    this.#banner = banner

    const help = el('div', { class: 'ark-help' })
    help.innerHTML = '<b>← →</b> / <b>mouse</b> move the bat &nbsp;·&nbsp; <b>Space</b> / click: launch &amp; fire &nbsp;·&nbsp; click captures the mouse &nbsp;·&nbsp; pills: <b>O</b>scillate <b>B</b>reak <b>L</b>aser <b>E</b>xpand <b>G</b>un &nbsp;·&nbsp; <b>R</b> restart &nbsp;·&nbsp; <b>Esc</b> release / close'
    root.appendChild(help)

    document.body.appendChild(root)
    this.#root = root
    this.#canvas = canvas
    this.#ctx = canvas.getContext('2d')
    if (this.#ctx) this.#renderer = new Renderer(this.#ctx)
    this.#refreshLoadSelect()
    this.#updateToolButtons()
  }

  // ── mode + level control ──────────────────────────────────
  #setMode(mode: Mode): void {
    if (this.#mode === mode) return
    this.#mode = mode
    this.#syncTabs()
    this.#playBar?.classList.toggle('ark-hidden', mode !== 'play')
    this.#designBar?.classList.toggle('ark-hidden', mode !== 'design')
    this.#hideBanner()
    if (this.#canvas) this.#canvas.style.cursor = mode === 'design' ? 'crosshair' : 'none'
    if (mode === 'play') { this.#startPlay(this.#levelIndex) }
    else {
      this.#exitLock()
      if (this.#nameInput) this.#nameInput.value = this.#designer.name
      this.#refreshLoadSelect()
      this.#updateToolButtons()
    }
  }

  #syncTabs(): void {
    const tabs = this.#root?.querySelectorAll('.ark-tab')
    tabs?.forEach((t, i) => t.classList.toggle('on', (i === 0) === (this.#mode === 'play')))
  }

  #startPlay(index: number): void {
    const level = LEVELS[index]
    if (!level) return
    this.#levelIndex = index
    this.#startPlayLevel(cloneLevel(level), `${level.name}  (${index + 1}/${LEVELS.length})`)
  }

  #startPlayLevel(level: ArkanoidLevel, label: string): void {
    this.#mode = 'play'
    this.#syncTabs()
    this.#playBar?.classList.remove('ark-hidden')
    this.#designBar?.classList.add('ark-hidden')
    if (this.#canvas) this.#canvas.style.cursor = 'none'
    this.#engine = new Engine(level.rows)
    this.#paddleTargetX = this.#engine.paddle.x
    this.#wonShown = this.#overShown = false
    this.#hideBanner()
    this.#fit()
    if (this.#levelLabel) this.#levelLabel.textContent = label
  }

  #cycleLevel(dir: number): void {
    const n = (this.#levelIndex + dir + LEVELS.length) % LEVELS.length
    this.#startPlay(n)
  }

  // Crisp scaling: back the canvas with device pixels and draw the world
  // through a single scale transform. The renderer works in world units.
  #fit = (): void => {
    const c = this.#canvas, s = this.#stage
    if (!c || !s) return
    const availW = s.clientWidth - 28
    const availH = s.clientHeight - 28
    if (availW <= 0 || availH <= 0) return
    const cssScale = Math.min(availW / W, availH / H)
    const dispW = W * cssScale, dispH = H * cssScale
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
    const dt = Math.min((ts - this.#lastTs) / 1000, 1 / 30)
    this.#lastTs = ts
    this.#time += dt

    const ctx = this.#ctx, r = this.#renderer
    if (ctx && r) {
      ctx.setTransform(this.#scaleBack, 0, 0, this.#scaleBack, 0, 0)
      ctx.clearRect(0, 0, W, H)
      if (this.#mode === 'play' && this.#engine) {
        this.#engine.update(dt)
        r.draw(this.#engine, this.#time)
        if (this.#engine.state === 'won' && !this.#wonShown) { this.#wonShown = true; this.#showWin() }
        if (this.#engine.state === 'gameover' && !this.#overShown) { this.#overShown = true; this.#showGameOver() }
      } else if (this.#mode === 'design') {
        r.drawEditor(this.#designer.grid, this.#hover)
      }
    }
    this.#raf = requestAnimationFrame(this.#loop)
  }

  // ── input (fully isolated) ───────────────────────────────
  #onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); this.#onClose(); return }
    if (e.ctrlKey || e.metaKey || e.altKey) return       // let OS/browser shortcuts pass
    if (document.activeElement === this.#nameInput) return // typing the level name
    e.preventDefault(); e.stopImmediatePropagation()
    if (this.#mode !== 'play') return
    const eng = this.#engine
    if (!eng || !GAME_KEYS.has(e.key)) return
    switch (e.key) {
      case 'ArrowLeft': case 'a': case 'A': eng.input.left = true; break
      case 'ArrowRight': case 'd': case 'D': eng.input.right = true; break
      case ' ': case 'ArrowUp': eng.shoot(); break
      case 'r': case 'R': this.#startPlay(this.#levelIndex); break
    }
  }

  #onKeyUp = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    if (document.activeElement === this.#nameInput) return
    e.stopImmediatePropagation()
    const eng = this.#engine
    if (!eng) return
    switch (e.key) {
      case 'ArrowLeft': case 'a': case 'A': eng.input.left = false; break
      case 'ArrowRight': case 'd': case 'D': eng.input.right = false; break
    }
  }

  #worldXFromEvent(e: PointerEvent): number | null {
    const c = this.#canvas
    if (!c) return null
    const rect = c.getBoundingClientRect()
    if (rect.width <= 0) return null
    return ((e.clientX - rect.left) / rect.width) * W   // may fall outside [0,W]; the engine clamps
  }

  #cellFromEvent(e: PointerEvent): { col: number; row: number } | null {
    const c = this.#canvas
    if (!c) return null
    const rect = c.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null
    const wx = ((e.clientX - rect.left) / rect.width) * W
    const wy = ((e.clientY - rect.top) / rect.height) * H
    return { col: Math.floor(wx / BRICK_W), row: Math.floor((wy - BRICK_TOP) / BRICK_H) }
  }

  #onPointerMove = (e: PointerEvent): void => {
    if (this.#mode === 'play') {
      if (this.#locked) {
        // Relative: accumulate captured motion (clientX is meaningless under lock).
        this.#paddleTargetX = Math.max(0, Math.min(W, this.#paddleTargetX + e.movementX * this.#worldPerCssPx()))
        this.#engine?.movePaddleTo(this.#paddleTargetX)
      } else {
        const x = this.#worldXFromEvent(e)
        if (x !== null) this.#engine?.movePaddleTo(x)
      }
    } else {
      const cell = this.#cellFromEvent(e)
      this.#hover = cell
      if (this.#painting && cell) this.#paintAt(cell)
    }
  }

  // ── pointer lock ─────────────────────────────────────────
  // CSS px → world units, so a 1px mouse move travels the same world distance
  // regardless of how big the canvas is scaled on screen.
  #worldPerCssPx(): number {
    const c = this.#canvas
    if (!c) return 1
    const rect = c.getBoundingClientRect()
    return rect.width > 0 ? W / rect.width : 1
  }

  #requestLock(): void {
    if (this.#mode !== 'play') return
    if (document.pointerLockElement === this.#canvas) return
    try { void this.#canvas?.requestPointerLock?.() } catch { /* gesture/permission — ignore */ }
  }

  #exitLock(): void {
    if (document.pointerLockElement === this.#canvas) {
      try { document.exitPointerLock?.() } catch { /* ignore */ }
    }
  }

  #onLockChange = (): void => {
    this.#locked = document.pointerLockElement === this.#canvas
    // Re-seed the accumulator from the live bat so capture never jumps.
    if (this.#locked && this.#engine) this.#paddleTargetX = this.#engine.paddle.x
  }

  #onPointerDown = (e: PointerEvent): void => {
    e.preventDefault()
    if (this.#mode === 'play') {
      this.#requestLock()                                   // capture + hide the cursor
      if (!this.#locked) {                                  // lock is async — place the bat this once
        const x = this.#worldXFromEvent(e)
        if (x !== null) this.#engine?.movePaddleTo(x)
      }
      this.#engine?.shoot()
    } else {
      const cell = this.#cellFromEvent(e)
      if (!cell) return
      this.#painting = true
      this.#lastCell = { col: -1, row: -1 }
      this.#paintAt(cell)
      this.#canvas?.setPointerCapture?.(e.pointerId)
    }
  }

  #onPointerUp = (): void => { this.#painting = false }

  #paintAt(cell: { col: number; row: number }): void {
    if (cell.col === this.#lastCell.col && cell.row === this.#lastCell.row) return
    this.#lastCell = cell
    this.#designer.paint(cell.col, cell.row)
  }

  // ── designer actions ──────────────────────────────────────
  #setTool(tool: Tool): void { this.#designer.setTool(tool); this.#updateToolButtons() }

  #updateToolButtons(): void {
    for (const [tool, b] of this.#toolButtons) b.classList.toggle('on', tool === this.#designer.tool)
  }

  #designerNew(): void {
    this.#designer.newLevel('My Level')
    if (this.#nameInput) this.#nameInput.value = this.#designer.name
    this.#flash('new blank level')
  }

  #designerSave(): void {
    const name = (this.#nameInput?.value ?? '').trim() || 'My Level'
    upsertCustomLevel(this.#designer.named(name))
    this.#refreshLoadSelect(name)
    this.#flash(`saved “${name}”`)
  }

  #designerTest(): void {
    const name = (this.#nameInput?.value ?? '').trim() || 'My Level'
    this.#startPlayLevel(this.#designer.named(name), `${name}  (test)`)
  }

  #designerLoad(name: string): void {
    if (!name) return
    const lvl = loadCustomLevels().find(l => l.name === name) ?? LEVELS.find(l => l.name === name)
    if (!lvl) return
    this.#designer.setLevel(cloneLevel(lvl))
    if (this.#nameInput) this.#nameInput.value = lvl.name
    this.#flash(`editing “${name}”`)
  }

  #designerDelete(): void {
    const name = (this.#nameInput?.value ?? '').trim()
    if (!name) return
    deleteCustomLevel(name)
    this.#refreshLoadSelect()
    this.#flash(`deleted “${name}”`)
  }

  #designerExport(): void {
    const json = this.#designer.exportJson()
    try { void navigator.clipboard?.writeText(json); this.#flash('level JSON copied to clipboard') }
    catch { this.#flash('copy failed — see console'); console.log(json) }
  }

  #designerImport(): void {
    const text = window.prompt('Paste level JSON:')
    if (!text) return
    if (this.#designer.importJson(text)) {
      if (this.#nameInput) this.#nameInput.value = this.#designer.name
      this.#flash('level imported')
    } else this.#flash('import failed — invalid JSON')
  }

  #refreshLoadSelect(selected?: string): void {
    const sel = this.#loadSelect
    if (!sel) return
    const custom = loadCustomLevels()
    sel.innerHTML = ''
    sel.appendChild(opt('', custom.length ? '— load —' : '— no custom levels —'))
    for (const b of LEVELS) sel.appendChild(opt(b.name, `(built-in) ${b.name}`))
    for (const l of custom) sel.appendChild(opt(l.name, l.name))
    if (selected) sel.value = selected
  }

  // ── banners + status ──────────────────────────────────────
  #showWin(): void {
    this.#exitLock()                                        // free the cursor for the banner buttons
    const score = this.#engine?.score ?? 0
    const hasNext = this.#levelIndex + 1 < LEVELS.length && this.#mode === 'play'
    this.#showBanner('Level Clear!', `✦ ${score}`, [
      ...(hasNext ? [{ label: 'Next ▶', fn: () => this.#cycleLevel(1) }] : []),
      { label: '↻ Replay', fn: () => this.#startPlay(this.#levelIndex) },
      { label: 'Design', fn: () => this.#setMode('design') },
    ])
  }

  #showGameOver(): void {
    this.#exitLock()                                        // free the cursor for the banner buttons
    const score = this.#engine?.score ?? 0
    this.#showBanner('Game Over', `✦ ${score}`, [
      { label: '↻ Retry', fn: () => this.#startPlay(this.#levelIndex) },
    ])
  }

  #showBanner(title: string, sub: string, actions: { label: string; fn: () => void }[]): void {
    const b = this.#banner
    if (!b) return
    b.innerHTML = ''
    b.appendChild(el('div', { class: 'ark-banner-title', text: title }))
    b.appendChild(el('div', { class: 'ark-banner-sub', text: sub }))
    const row = el('div', { class: 'ark-banner-actions' })
    for (const a of actions) {
      const btn = el('button', { class: 'ark-btn ark-btn-lg', text: a.label }) as HTMLButtonElement
      btn.onclick = a.fn
      row.appendChild(btn)
    }
    b.appendChild(row)
    b.classList.remove('ark-hidden')
  }

  #hideBanner(): void { this.#banner?.classList.add('ark-hidden') }

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
.ark-overlay{position:fixed;inset:0;display:flex;flex-direction:column;
  background:radial-gradient(120% 120% at 50% 0%,#10204a 0%,#0a1230 60%,#04060f 100%);
  font-family:'Segoe UI',system-ui,sans-serif;color:#e9eeff;user-select:none;
  animation:ark-in .2s ease both}
@keyframes ark-in{from{opacity:0}to{opacity:1}}
.ark-bar{display:flex;align-items:center;gap:.5rem;padding:.45rem .7rem;
  background:rgba(8,12,26,.7);border-bottom:1px solid rgba(126,182,214,.25);flex-wrap:wrap}
.ark-logo{font-weight:800;letter-spacing:.02em;color:#7ee0ff;white-space:nowrap;
  text-shadow:0 0 14px rgba(126,224,255,.45)}
.ark-tabs{display:flex;gap:.25rem;margin-left:.3rem}
.ark-tab{background:transparent;border:1px solid rgba(126,182,214,.3);color:#c9d4ec;
  padding:.2rem .7rem;border-radius:999px;cursor:pointer;font-size:.85rem}
.ark-tab.on{background:rgba(126,224,255,.2);color:#fff;border-color:rgba(126,224,255,.6)}
.ark-ctl{display:flex;align-items:center;gap:.35rem;flex-wrap:wrap}
.ark-level-label{min-width:10rem;text-align:center;font-size:.85rem;color:#cfd2ff}
.ark-btn{background:rgba(126,182,214,.12);border:1px solid rgba(126,182,214,.3);
  color:#dfe7ff;padding:.22rem .6rem;border-radius:7px;cursor:pointer;font-size:.82rem;
  transition:background .15s ease}
.ark-btn:hover{background:rgba(126,182,214,.26)}
.ark-btn-lg{padding:.5rem 1.15rem;font-size:.95rem}
.ark-palette{display:flex;gap:.2rem}
.ark-tool{width:2rem;height:2rem;display:flex;align-items:center;justify-content:center;
  background:rgba(255,255,255,.05);border:2px solid var(--tool-color,rgba(255,255,255,.2));
  border-radius:6px;color:var(--tool-color,#fff);cursor:pointer;font-size:.95rem;font-weight:700;line-height:1}
.ark-tool.on{background:color-mix(in srgb,var(--tool-color) 30%,transparent);
  box-shadow:0 0 8px var(--tool-color);color:#fff}
.ark-name{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.2);
  color:#fff;border-radius:6px;padding:.25rem .5rem;width:8rem;font-size:.82rem}
.ark-select{background:rgba(14,20,40,.96);border:1px solid rgba(255,255,255,.2);
  color:#fff;border-radius:6px;padding:.22rem .4rem;font-size:.8rem;max-width:11rem}
.ark-status{margin-left:auto;font-size:.8rem;color:#9ad9b0;min-height:1em}
.ark-close{width:2rem;height:2rem;border-radius:50%;border:none;cursor:pointer;
  background:rgba(255,80,80,.18);color:#ff9a9a;font-size:1rem}
.ark-close:hover{background:rgba(255,80,80,.34);color:#fff}
.ark-stage{flex:1;display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden;padding:14px}
.ark-canvas{border-radius:12px;
  box-shadow:0 16px 60px rgba(0,0,0,.6),0 0 0 1px rgba(126,182,214,.22),0 0 40px rgba(80,140,255,.12);
  background:#060a18;touch-action:none;cursor:none}
.ark-banner{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;
  justify-content:center;gap:.7rem;background:rgba(6,8,18,.72);backdrop-filter:blur(3px)}
.ark-banner-title{font-size:2.4rem;font-weight:800;color:#7ee0ff;text-shadow:0 2px 22px rgba(120,220,255,.55)}
.ark-banner-sub{font-size:1.1rem;color:#ffd76a}
.ark-banner-actions{display:flex;gap:.6rem;margin-top:.4rem}
.ark-help{padding:.45rem .8rem;text-align:center;font-size:.78rem;color:#9aa0c8;
  background:rgba(8,12,26,.6);border-top:1px solid rgba(126,182,214,.15)}
.ark-help b{color:#dfe7ff}
.ark-hidden{display:none!important}
`
