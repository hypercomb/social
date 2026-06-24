// diamondcoreprocessor.com/games/tutor/shell.ts
//
// The tutor study shell. A self-contained mini-app that runs a study
// SESSION over a deck: it owns the canvas + RAF loop + isolated input, a
// slim toolbar (progress + game switcher + exit), and the round loop that
// ties the scheduler to the games.
//
//   scheduler.next() → item → pick a game → run it → game reports a grade
//   → scheduler.record() → next round … until the deck is cleared.
//
// The shell is "dumb": the scheduler decides WHAT to study and the
// registry supplies HOW (which games). Adding games 3–10 needs no change
// here. Unlike the arcade overlays this is NOT a transient takeover — it
// is the body of a ViewMode render surface, mounted by TutorViewDrone into
// a fixed host below the Pixi layer. Keyboard input is fully isolated
// (capture phase) so a typed answer never leaks to the command line.

import './game-registry.js'                          // registers the TutorGameRegistry singleton
import './letter-reveal/letter-reveal.game.js'       // self-registers a game
import './flashcard/flashcard.game.js'               // self-registers a game
import './multiple-choice/multiple-choice.game.js'   // self-registers a game
import './scramble/scramble.game.js'                 // self-registers a game
import './hangman/hangman.game.js'                   // self-registers a game
import { TutorScheduler } from './scheduler.js'
import { Shaker, ParticleField } from '../juice.js'
import { I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import type { StudyItem, Grade } from './deck.types.js'
import type { GameContext, TutorGame, TutorGameDescriptor } from './game-registry.js'

interface RegistryLike {
  all(): TutorGameDescriptor[]
  get(id: string): TutorGameDescriptor | undefined
  suitableFor(item: StudyItem, pool?: readonly StudyItem[]): TutorGameDescriptor[]
  addEventListener(t: string, cb: () => void): void
  removeEventListener(t: string, cb: () => void): void
}

const STYLE_ID = 'hc-tutor-shell-styles'

function t(key: string, params?: Record<string, string | number>): string {
  const i18n = (window as any).ioc?.get?.(I18N_IOC_KEY) as I18nProvider | undefined
  return i18n?.t(key, params) ?? key
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, opts: { class?: string; text?: string; title?: string } = {}): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag)
  if (opts.class) n.className = opts.class
  if (opts.text != null) n.textContent = opts.text
  if (opts.title) n.title = opts.title
  return n
}

export class TutorShell {
  readonly #items: readonly StudyItem[]
  readonly #scheduler: TutorScheduler
  readonly #onExit: () => void
  readonly #registry: RegistryLike | undefined

  #host: HTMLElement | null = null
  #canvas: HTMLCanvasElement | null = null
  #ctx: CanvasRenderingContext2D | null = null
  #toolbar: HTMLDivElement | null = null
  #progressLabel: HTMLSpanElement | null = null
  #chips: HTMLDivElement | null = null
  #complete: HTMLDivElement | null = null

  #raf = 0
  #lastTs = 0
  #time = 0
  #dpr = 1
  #w = 0
  #h = 0
  #ro: ResizeObserver | null = null

  #shaker = new Shaker()
  #particles = new ParticleField()

  #game: TutorGame | null = null
  #item: StudyItem | null = null
  #lastGameId: string | null = null
  #pinnedGameId: string | null = null
  /** Brief pause between rounds so a result reads before the next item. */
  #cooldown = 0

  /**
   * @param items       the deck's study items (resolved from the cell's `tutor`
   *                    slot — an array of content-addressed item resources).
   * @param progressKey stable per-deck localStorage namespace (the cell's
   *                    location signature) — survives deck regeneration.
   */
  constructor(items: readonly StudyItem[], progressKey: string, onExit: () => void) {
    this.#items = items
    this.#onExit = onExit
    this.#scheduler = new TutorScheduler(items, progressKey)
    this.#registry = (window as { ioc?: { get: <T>(k: string) => T | undefined } }).ioc?.get<RegistryLike>('@diamondcoreprocessor.com/TutorGameRegistry')
  }

  // ── lifecycle ──────────────────────────────────────────────

  mount(host: HTMLElement): void {
    this.#host = host
    this.#injectStyles()
    this.#build()
    window.addEventListener('keydown', this.#onKeyDown, true)
    this.#ro = new ResizeObserver(() => this.#fit())
    if (this.#canvas) this.#ro.observe(this.#canvas)
    this.#registry?.addEventListener('change', this.#onRegistryChange)
    this.#fit()
    this.#renderChips()
    this.#startNextRound()
    this.#lastTs = 0
    this.#raf = requestAnimationFrame(this.#loop)
  }

  unmount(): void {
    if (this.#raf) cancelAnimationFrame(this.#raf)
    this.#raf = 0
    window.removeEventListener('keydown', this.#onKeyDown, true)
    this.#ro?.disconnect(); this.#ro = null
    this.#registry?.removeEventListener('change', this.#onRegistryChange)
    try { this.#game?.dispose?.() } catch { /* noop */ }
    this.#game = null
    this.#host?.replaceChildren()
    this.#host = null
    this.#canvas = null
    this.#ctx = null
  }

  // ── DOM ────────────────────────────────────────────────────

  #build(): void {
    const host = this.#host!
    host.replaceChildren()

    const toolbar = el('div', { class: 'hc-tutor-bar' })
    toolbar.appendChild(el('span', { class: 'hc-tutor-logo', text: `🎓 ${t('tutor.logo')}` }))
    const progress = el('span', { class: 'hc-tutor-progress' })
    toolbar.appendChild(progress)
    this.#progressLabel = progress

    const chips = el('div', { class: 'hc-tutor-chips' })
    toolbar.appendChild(chips)
    this.#chips = chips

    const exit = el('button', { class: 'hc-tutor-exit', text: '✕', title: t('tutor.exit.title') })
    exit.onclick = () => this.#onExit()
    toolbar.appendChild(exit)
    host.appendChild(toolbar)
    this.#toolbar = toolbar

    const canvas = el('canvas', { class: 'hc-tutor-canvas' })
    canvas.addEventListener('pointerdown', this.#onPointer)
    canvas.addEventListener('pointermove', this.#onPointer)
    canvas.addEventListener('pointerup', this.#onPointer)
    host.appendChild(canvas)
    this.#canvas = canvas
    this.#ctx = canvas.getContext('2d')
  }

  #renderChips(): void {
    const chips = this.#chips
    if (!chips) return
    chips.replaceChildren()
    const games = this.#registry?.all() ?? []
    // "Auto" clears the pin and returns to scheduler-driven game choice.
    const auto = el('button', { class: `hc-tutor-chip${this.#pinnedGameId == null ? ' on' : ''}`, text: 'Auto', title: t('tutor.auto.title') })
    auto.onclick = () => { this.#pinnedGameId = null; this.#renderChips(); this.#restartRound() }
    chips.appendChild(auto)
    for (const g of games) {
      const usable = this.#item ? g.suits(this.#item, this.#items) : true
      const chip = el('button', { class: `hc-tutor-chip${this.#pinnedGameId === g.id ? ' on' : ''}${usable ? '' : ' off'}`, text: `${g.glyph} ${g.label}`, title: g.label })
      chip.disabled = !usable
      chip.onclick = () => { this.#pinnedGameId = g.id; this.#renderChips(); this.#restartRound() }
      chips.appendChild(chip)
    }
  }

  #updateProgress(): void {
    if (!this.#progressLabel) return
    const s = this.#scheduler.stats()
    this.#progressLabel.textContent = t('tutor.progress', { learned: s.learned, total: s.total, due: s.due })
  }

  // ── round loop ─────────────────────────────────────────────

  #startNextRound(): void {
    this.#updateProgress()
    const item = this.#scheduler.next()
    if (!item) { this.#showComplete(); return }
    this.#item = item
    const gameId = this.#pickGameId(item)
    this.#lastGameId = gameId
    this.#startGame(gameId, item)
    this.#renderChips()
  }

  /** Re-run the current item under the (possibly newly pinned) game pick. */
  #restartRound(): void {
    if (this.#complete) return
    const item = this.#item
    if (!item) { this.#startNextRound(); return }
    const gameId = this.#pickGameId(item)
    this.#lastGameId = gameId
    this.#startGame(gameId, item)
  }

  #startGame(gameId: string, item: StudyItem): void {
    try { this.#game?.dispose?.() } catch { /* noop */ }
    const desc = this.#registry?.get(gameId)
    if (!desc) { this.#game = null; return }
    const ctx: GameContext = {
      item,
      pool: this.#items,
      shaker: this.#shaker,
      particles: this.#particles,
      done: (r) => this.#onRoundDone(item.id, r.grade),
    }
    this.#game = desc.create(ctx)
    this.#cooldown = 0
  }

  #onRoundDone(itemId: string, grade: Grade): void {
    this.#scheduler.record(itemId, grade)
    this.#updateProgress()
    // Short cooldown lets the win/miss feedback read before the next item.
    this.#cooldown = 0.55
  }

  /**
   * Choose a game for the item. A pinned game wins when it suits; else a
   * stage-biased weighted pick among suitable games — production-recall
   * games (type the answer) for new/lapsed items, recognition for mature
   * ones — avoiding an immediate repeat of the last game when possible.
   */
  #pickGameId(item: StudyItem): string {
    const reg = this.#registry
    if (this.#pinnedGameId && reg?.get(this.#pinnedGameId)?.suits(item, this.#items)) return this.#pinnedGameId
    const candidates = reg?.suitableFor(item, this.#items) ?? []
    if (candidates.length === 0) return 'flashcard'
    if (candidates.length === 1) return candidates[0].id

    const stage = this.#scheduler.stageOf(item)
    const wanted = stage === 'review' ? 'recognition' : 'production'
    const weighted = candidates.map(g => {
      let wgt = g.weight ?? 1
      if (g.recall === wanted) wgt *= 2.2
      if (g.id === this.#lastGameId) wgt *= 0.35 // discourage repeats
      return { id: g.id, wgt }
    })
    const total = weighted.reduce((s, c) => s + c.wgt, 0)
    let r = Math.random() * total
    for (const c of weighted) { if ((r -= c.wgt) <= 0) return c.id }
    return weighted[weighted.length - 1].id
  }

  // ── completion ─────────────────────────────────────────────

  #showComplete(): void {
    this.#game = null
    this.#item = null
    const s = this.#scheduler.stats()
    const panel = el('div', { class: 'hc-tutor-complete' })
    panel.appendChild(el('div', { class: 'hc-tutor-complete-title', text: this.#scheduler.complete ? `✓ ${t('tutor.complete.cleared')}` : `✓ ${t('tutor.complete.caught-up')}` }))
    panel.appendChild(el('div', { class: 'hc-tutor-complete-stat', text: t('tutor.complete.stat', { learned: s.learned, total: s.total }) }))
    const row = el('div', { class: 'hc-tutor-complete-row' })
    const again = el('button', { class: 'hc-tutor-btn', text: t('tutor.again') })
    again.onclick = () => { this.#scheduler.reset(); this.#dismissComplete() }
    const drill = el('button', { class: 'hc-tutor-btn', text: t('tutor.drill') })
    drill.onclick = () => { this.#scheduler.enableDrill(); this.#dismissComplete() }
    const exit = el('button', { class: 'hc-tutor-btn primary', text: t('tutor.done') })
    exit.onclick = () => this.#onExit()
    row.append(again, drill, exit)
    panel.appendChild(row)
    this.#host?.appendChild(panel)
    this.#complete = panel
  }

  #dismissComplete(): void {
    this.#complete?.remove()
    this.#complete = null
    this.#startNextRound()
  }

  // ── input ──────────────────────────────────────────────────

  readonly #onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); this.#onExit(); return }
    // Let OS / browser chords (Ctrl/Cmd/Alt) through; isolate everything else
    // so a typed answer never reaches the command line or keymap service.
    if (e.ctrlKey || e.metaKey || e.altKey) return
    e.preventDefault()
    e.stopImmediatePropagation()
    if (this.#complete) return
    this.#game?.key?.(e)
  }

  readonly #onPointer = (e: PointerEvent): void => {
    if (!this.#canvas || !this.#game || this.#complete) return
    const rect = this.#canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const phase = e.type === 'pointerdown' ? 'down' : e.type === 'pointerup' ? 'up' : 'move'
    this.#game.pointer?.(x, y, phase)
  }

  readonly #onRegistryChange = (): void => { this.#renderChips() }

  // ── canvas fit + loop ──────────────────────────────────────

  #fit = (): void => {
    const canvas = this.#canvas
    const ctx = this.#ctx
    if (!canvas || !ctx) return
    const rect = canvas.getBoundingClientRect()
    this.#dpr = Math.min(window.devicePixelRatio || 1, 2.5)
    this.#w = Math.max(1, rect.width)
    this.#h = Math.max(1, rect.height)
    canvas.width = Math.round(this.#w * this.#dpr)
    canvas.height = Math.round(this.#h * this.#dpr)
  }

  readonly #loop = (ts: number): void => {
    if (!this.#host) return
    const dt = this.#lastTs ? Math.min((ts - this.#lastTs) / 1000, 1 / 30) : 0
    this.#lastTs = ts
    this.#time += dt

    this.#shaker.update(dt)
    this.#particles.update(dt)
    if (this.#game) this.#game.update(dt)

    // Advance to the next round after the cooldown elapses.
    if (this.#cooldown > 0) {
      this.#cooldown -= dt
      if (this.#cooldown <= 0 && !this.#complete) this.#startNextRound()
    }

    const ctx = this.#ctx
    const canvas = this.#canvas
    if (ctx && canvas) {
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      const g = ctx.createLinearGradient(0, 0, 0, canvas.height)
      g.addColorStop(0, '#0a0a18')
      g.addColorStop(1, '#05040f')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      const sh = this.#shaker.offset()
      ctx.setTransform(this.#dpr, 0, 0, this.#dpr, sh.x * this.#dpr, sh.y * this.#dpr)
      if (this.#game && !this.#complete) this.#game.draw(ctx, this.#w, this.#h, this.#time)
      this.#particles.draw(ctx)
    }

    this.#raf = requestAnimationFrame(this.#loop)
  }

  // ── styles ─────────────────────────────────────────────────

  #injectStyles(): void {
    if (document.getElementById(STYLE_ID)) return
    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = `
.hc-tutor-bar{position:absolute;top:0;left:0;right:0;height:46px;display:flex;align-items:center;gap:14px;
  padding:0 14px;background:rgba(10,14,28,0.72);backdrop-filter:blur(10px);
  border-bottom:1px solid rgba(126,182,214,0.22);z-index:2;font:500 14px system-ui,sans-serif;color:#cfe6f5}
.hc-tutor-logo{font-weight:700;letter-spacing:.02em;color:#eaf6ff}
.hc-tutor-progress{color:rgba(191,233,255,0.7);font-size:13px}
.hc-tutor-chips{display:flex;gap:8px;margin-left:auto;flex-wrap:wrap}
.hc-tutor-chip{appearance:none;border:1px solid rgba(126,182,214,0.3);background:rgba(255,255,255,0.03);
  color:#bfe9ff;border-radius:999px;padding:5px 12px;font:600 12px system-ui,sans-serif;cursor:pointer}
.hc-tutor-chip:hover{background:rgba(126,224,255,0.12)}
.hc-tutor-chip.on{border-color:#7ee0ff;color:#eaf6ff;background:rgba(126,224,255,0.16)}
.hc-tutor-chip.off{opacity:.35;cursor:default}
.hc-tutor-exit{appearance:none;border:1px solid rgba(126,182,214,0.3);background:transparent;color:#bfe9ff;
  width:30px;height:30px;border-radius:8px;cursor:pointer;font-size:14px;line-height:1}
.hc-tutor-exit:hover{background:rgba(255,93,143,0.18);border-color:#ff5d8f;color:#fff}
.hc-tutor-canvas{position:absolute;top:46px;left:0;right:0;bottom:0;width:100%;height:calc(100% - 46px);display:block;touch-action:none}
.hc-tutor-complete{position:absolute;inset:46px 0 0 0;z-index:3;display:flex;flex-direction:column;align-items:center;
  justify-content:center;gap:18px;background:radial-gradient(120% 120% at 50% 30%,rgba(14,18,38,0.7),rgba(5,4,15,0.92))}
.hc-tutor-complete-title{font:700 30px system-ui,sans-serif;color:#7ee0ff}
.hc-tutor-complete-stat{font:500 18px system-ui,sans-serif;color:#bfe9ff}
.hc-tutor-complete-row{display:flex;gap:12px;margin-top:6px}
.hc-tutor-btn{appearance:none;border:1px solid rgba(126,182,214,0.35);background:rgba(255,255,255,0.04);
  color:#cfe6f5;border-radius:10px;padding:10px 18px;font:600 15px system-ui,sans-serif;cursor:pointer}
.hc-tutor-btn:hover{background:rgba(126,224,255,0.14)}
.hc-tutor-btn.primary{border-color:#7ee0ff;color:#eaf6ff;background:rgba(126,224,255,0.18)}
`
    document.head.appendChild(style)
  }
}
