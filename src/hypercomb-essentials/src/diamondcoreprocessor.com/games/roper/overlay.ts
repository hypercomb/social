// diamondcoreprocessor.com/games/roper/overlay.ts
//
// The full-screen Roper shell. Owns the DOM (backdrop, toolbar, canvas, banner),
// the requestAnimationFrame loop, and input (keyboard for moving/roping, mouse
// for aiming + charging the throw). Self-contained mini-app: it never touches
// the hex grid or Pixi — it mounts above everything as a fixed overlay and tears
// itself fully down on close. RoperDrone owns its lifecycle. Sibling in shape to
// the arkanoid / bubble / solomon overlays.
//
// The arena is sized to the stage at start so the playfield fills the screen
// height: world height is fixed (H) and the world WIDTH is chosen to match the
// stage's aspect ratio, then the whole world is scaled to fit. There is no
// scrolling camera — one screen, the border framing it.
//
// Keyboard is FULLY isolated while mounted so no keystroke leaks to the shell.

import { RoperEngine, H, WEAPON_ORDER, WEAPON_META, type WeaponKind } from './engine.js'
import { Renderer } from './renderer.js'

const STYLE_ID = 'roper-overlay-styles'
const Z = 2147483000
const CHARGE_RAMP = 1.25       // seconds from a tap to full power

const MOVE_KEYS = new Set([
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
  'a', 'A', 'd', 'D', 'w', 'W', 's', 'S', ' ',
])

export class RoperOverlay {
  #root: HTMLDivElement | null = null
  #canvas: HTMLCanvasElement | null = null
  #ctx: CanvasRenderingContext2D | null = null
  #renderer: Renderer | null = null
  #stage: HTMLDivElement | null = null
  #banner: HTMLDivElement | null = null
  #status: HTMLSpanElement | null = null
  #weaponButtons = new Map<WeaponKind, HTMLButtonElement>()

  #engine: RoperEngine | null = null
  #raf = 0
  #lastTs = 0
  #time = 0
  #scaleBack = 1
  #overShown = false
  #sizedReal = false                  // was the arena generated against a real stage size?
  #ro: ResizeObserver | null = null

  #charging = false
  #loggedError = false                 // guards the per-frame error log so it fires once
  #lastWeapon: WeaponKind | null = null
  #lastTeam = -1

  #onClose: () => void
  constructor(onClose: () => void) { this.#onClose = onClose }

  isMounted(): boolean { return !!this.#root }

  // ── lifecycle ────────────────────────────────────────────
  mount(): void {
    if (this.#root) return
    this.#injectStyles()
    ;(document.activeElement as HTMLElement | null)?.blur?.()
    this.#build()
    this.#startGame()
    window.addEventListener('keydown', this.#onKeyDown, true)
    window.addEventListener('keyup', this.#onKeyUp, true)
    window.addEventListener('resize', this.#fit)
    window.addEventListener('pointermove', this.#onPointerMove)
    window.addEventListener('pointerup', this.#onPointerUp)
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
    const root = el('div', { class: 'rp-overlay' }) as HTMLDivElement
    root.style.zIndex = String(Z)

    const bar = el('div', { class: 'rp-bar' })
    bar.appendChild(el('span', { class: 'rp-logo', text: '⟜ Roper' }))

    // weapon picker
    const weapons = el('div', { class: 'rp-weapons' })
    for (const kind of WEAPON_ORDER) {
      const meta = WEAPON_META[kind]
      const b = el('button', { class: 'rp-weapon', title: meta.desc }) as HTMLButtonElement
      b.innerHTML = `<span class="rp-wkey">${meta.letter}</span>${meta.name}`
      b.style.setProperty('--wcol', meta.color)
      b.onclick = () => { this.#engine?.selectWeapon(kind); this.#syncToolbar(true) }
      this.#weaponButtons.set(kind, b)
      weapons.appendChild(b)
    }
    bar.appendChild(weapons)

    const restart = el('button', { class: 'rp-btn', text: '↻ New arena' }) as HTMLButtonElement
    restart.onclick = () => this.#startGame()
    bar.appendChild(restart)

    const status = el('span', { class: 'rp-status' }) as HTMLSpanElement
    bar.appendChild(status)
    this.#status = status

    const close = el('button', { class: 'rp-close', text: '✕', title: 'Close (Esc)' }) as HTMLButtonElement
    close.onclick = () => this.#onClose()
    bar.appendChild(close)
    root.appendChild(bar)

    const stage = el('div', { class: 'rp-stage' }) as HTMLDivElement
    const canvas = el('canvas', { class: 'rp-canvas' }) as HTMLCanvasElement
    canvas.addEventListener('pointerdown', this.#onPointerDown)
    canvas.addEventListener('contextmenu', e => e.preventDefault())   // right-click fires the rope
    stage.appendChild(canvas)
    const banner = el('div', { class: 'rp-banner rp-hidden' }) as HTMLDivElement
    stage.appendChild(banner)
    root.appendChild(stage)
    this.#stage = stage
    this.#banner = banner

    const help = el('div', { class: 'rp-help' })
    help.innerHTML =
      '<b>Mouse</b> aim &nbsp;·&nbsp; <b>hold left-click</b> charge & throw &nbsp;·&nbsp; ' +
      '<b>Space</b>/<b>right-click</b> fire / release rope &nbsp;·&nbsp; ' +
      'roped: <b>← →</b> swing, <b>↑</b> shorten (faster) <b>↓</b> lengthen (slower) &nbsp;·&nbsp; ' +
      'on foot: <b>← →</b> walk, <b>↑</b> jump &nbsp;·&nbsp; ' +
      '<b>1</b> grenade <b>2</b> bomb &nbsp;·&nbsp; <b>R</b> new arena &nbsp;·&nbsp; <b>Esc</b> close'
    root.appendChild(help)

    document.body.appendChild(root)
    this.#root = root
    this.#canvas = canvas
    this.#ctx = canvas.getContext('2d')
    if (this.#ctx) this.#renderer = new Renderer(this.#ctx)
  }

  // ── game start / sizing ──────────────────────────────────
  /** Build a fresh arena sized to the current stage aspect so it fills height. */
  #startGame(): void {
    const aspect = this.#stageAspect()
    this.#sizedReal = this.#hasRealStage()
    this.#engine = new RoperEngine({ width: Math.round(H * aspect) })
    this.#overShown = false
    this.#charging = false
    this.#lastWeapon = null
    this.#lastTeam = -1
    this.#hideBanner()
    this.#fit()
    this.#flash('New arena — Blue starts')
  }

  #hasRealStage(): boolean {
    const s = this.#stage
    return !!s && s.clientWidth - 28 > 0 && s.clientHeight - 28 > 0
  }

  #stageAspect(): number {
    const s = this.#stage
    const w = (s?.clientWidth ?? 16) - 28
    const h = (s?.clientHeight ?? 9) - 28
    if (w <= 0 || h <= 0) return 16 / 9
    return Math.max(1.1, Math.min(2.4, w / h))
  }

  // Crisp scaling: back the canvas with device pixels and draw the world through
  // a single scale transform. The renderer works in world units.
  #fit = (): void => {
    const c = this.#canvas, s = this.#stage, eng = this.#engine
    if (!c || !s || !eng) return
    const availW = s.clientWidth - 28
    const availH = s.clientHeight - 28
    if (availW <= 0 || availH <= 0) return
    // If the arena was first built before the stage had laid out (aspect
    // fallback), regenerate it now against the real size so it fills the height.
    if (!this.#sizedReal) { this.#startGame(); return }
    const cssScale = Math.min(availW / eng.width, availH / eng.height)
    const dispW = eng.width * cssScale, dispH = eng.height * cssScale
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    c.width = Math.round(dispW * dpr)
    c.height = Math.round(dispH * dpr)
    c.style.width = `${Math.round(dispW)}px`
    c.style.height = `${Math.round(dispH)}px`
    this.#scaleBack = cssScale * dpr
    if (this.#ctx) this.#ctx.imageSmoothingEnabled = false   // crisp terrain bitmap
  }

  // ── loop ─────────────────────────────────────────────────
  #loop = (ts: number): void => {
    if (!this.#root) return
    if (!this.#lastTs) this.#lastTs = ts
    const dt = Math.min((ts - this.#lastTs) / 1000, 1 / 30)
    this.#lastTs = ts
    this.#time += dt

    const ctx = this.#ctx, r = this.#renderer, eng = this.#engine
    if (ctx && r && eng) {
      // charge the throw while the button is held
      if (this.#charging && eng.state === 'aim') {
        eng.charging = true
        eng.power = Math.min(1, eng.power + dt / CHARGE_RAMP)
      }
      // A thrown error anywhere in the sim or a draw layer must never freeze the
      // whole game — log it once and keep the loop alive (skip the bad frame).
      try {
        eng.update(dt)
        r.sync(eng)
        ctx.setTransform(this.#scaleBack, 0, 0, this.#scaleBack, 0, 0)
        ctx.clearRect(0, 0, eng.width, eng.height)
        r.draw(eng, this.#time)
        this.#syncToolbar(false)
        if (eng.state === 'over' && !this.#overShown) { this.#overShown = true; this.#showGameOver() }
      } catch (err) {
        if (!this.#loggedError) { this.#loggedError = true; console.error('[roper] frame error', err) }
      }
    }
    this.#raf = requestAnimationFrame(this.#loop)
  }

  // ── input: keyboard (fully isolated) ─────────────────────
  #onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); this.#onClose(); return }
    if (e.ctrlKey || e.metaKey || e.altKey) return        // let OS/browser shortcuts pass
    const eng = this.#engine
    if (!eng) return
    const k = e.key
    const consume = MOVE_KEYS.has(k) || k === 'Enter' || k === 'r' || k === 'R' ||
      k === 'Tab' || k === '1' || k === '2'
    if (consume) { e.preventDefault(); e.stopImmediatePropagation() }
    if (e.repeat) return

    switch (k) {
      case 'ArrowLeft': case 'a': case 'A': eng.input.left = true; break
      case 'ArrowRight': case 'd': case 'D': eng.input.right = true; break
      case 'ArrowUp': case 'w': case 'W':
        if (eng.attached) eng.input.up = true; else eng.jump()
        break
      case 'ArrowDown': case 's': case 'S': eng.input.down = true; break
      case ' ': eng.toggleRope(); break
      case 'Enter': this.#beginCharge(); break
      case '1': eng.selectWeapon('grenade'); this.#syncToolbar(true); break
      case '2': eng.selectWeapon('bomb'); this.#syncToolbar(true); break
      case 'Tab': eng.cycleWeapon(); this.#syncToolbar(true); break
      case 'r': case 'R': this.#startGame(); break
    }
  }

  #onKeyUp = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    e.stopImmediatePropagation()
    const eng = this.#engine
    if (!eng) return
    switch (e.key) {
      case 'ArrowLeft': case 'a': case 'A': eng.input.left = false; break
      case 'ArrowRight': case 'd': case 'D': eng.input.right = false; break
      case 'ArrowUp': case 'w': case 'W': eng.input.up = false; break
      case 'ArrowDown': case 's': case 'S': eng.input.down = false; break
      case 'Enter': this.#releaseCharge(); break
    }
  }

  // ── input: mouse ─────────────────────────────────────────
  #worldFromEvent(e: PointerEvent): { x: number; y: number } | null {
    const c = this.#canvas, eng = this.#engine
    if (!c || !eng) return null
    const rect = c.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null
    return {
      x: ((e.clientX - rect.left) / rect.width) * eng.width,
      y: ((e.clientY - rect.top) / rect.height) * eng.height,
    }
  }

  #aimAt(p: { x: number; y: number }): void {
    const eng = this.#engine
    const w = eng?.active
    if (!eng || !w) return
    eng.aimAngle = Math.atan2(p.y - w.y, p.x - w.x)
    eng.facingFromAim()
  }

  #onPointerMove = (e: PointerEvent): void => {
    const p = this.#worldFromEvent(e)
    if (p) this.#aimAt(p)
  }

  #onPointerDown = (e: PointerEvent): void => {
    e.preventDefault()
    const p = this.#worldFromEvent(e)
    if (p) this.#aimAt(p)
    const eng = this.#engine
    if (!eng) return
    if (e.button === 2) { eng.toggleRope(); return }    // right-click → rope
    if (e.button === 0) this.#beginCharge()              // left hold → charge throw
  }

  #onPointerUp = (e: PointerEvent): void => {
    if (e.button === 0) this.#releaseCharge()
  }

  #beginCharge(): void {
    const eng = this.#engine
    if (!eng || eng.state !== 'aim') return
    this.#charging = true
    eng.charging = true
    eng.power = 0
  }

  #releaseCharge(): void {
    const eng = this.#engine
    if (!this.#charging || !eng) return
    this.#charging = false
    const power = eng.power
    eng.charging = false
    if (eng.state === 'aim') eng.throwWeapon(power)
  }

  // ── toolbar sync ─────────────────────────────────────────
  #syncToolbar(force: boolean): void {
    const eng = this.#engine
    if (!eng) return
    if (force || eng.weapon !== this.#lastWeapon) {
      this.#lastWeapon = eng.weapon
      for (const [kind, b] of this.#weaponButtons) b.classList.toggle('on', kind === eng.weapon)
    }
    const team = eng.active?.team ?? -1
    if (team !== this.#lastTeam) {
      this.#lastTeam = team
      this.#root?.style.setProperty('--turn-col', team === 0 ? '#4ea8ff' : team === 1 ? '#ff5b6e' : '#888')
    }
  }

  // ── banners + status ─────────────────────────────────────
  #showGameOver(): void {
    const eng = this.#engine
    const winner = eng?.winner ?? null
    const title = winner === 0 ? 'Blue wins!' : winner === 1 ? 'Red wins!' : 'Mutual destruction'
    const sub = winner === -1 ? 'Both teams wiped out' : 'Last worm standing'
    this.#showBanner(title, sub, [{ label: '↻ New arena', fn: () => this.#startGame() }])
  }

  #showBanner(title: string, sub: string, actions: { label: string; fn: () => void }[]): void {
    const b = this.#banner
    if (!b) return
    b.innerHTML = ''
    b.appendChild(el('div', { class: 'rp-banner-title', text: title }))
    b.appendChild(el('div', { class: 'rp-banner-sub', text: sub }))
    const row = el('div', { class: 'rp-banner-actions' })
    for (const a of actions) {
      const btn = el('button', { class: 'rp-btn rp-btn-lg', text: a.label }) as HTMLButtonElement
      btn.onclick = a.fn
      row.appendChild(btn)
    }
    b.appendChild(row)
    b.classList.remove('rp-hidden')
  }

  #hideBanner(): void { this.#banner?.classList.add('rp-hidden') }

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

// ── tiny DOM helper ────────────────────────────────────────
function el(tag: string, props: { class?: string; text?: string; title?: string } = {}): HTMLElement {
  const e = document.createElement(tag)
  if (props.class) e.className = props.class
  if (props.text != null) e.textContent = props.text
  if (props.title) e.title = props.title
  return e
}

const CSS = `
.rp-overlay{position:fixed;inset:0;display:flex;flex-direction:column;
  background:radial-gradient(120% 120% at 50% 0%,#16284e 0%,#0a1124 60%,#04060f 100%);
  font-family:'Segoe UI',system-ui,sans-serif;color:#e9eeff;user-select:none;
  --turn-col:#4ea8ff;animation:rp-in .2s ease both}
@keyframes rp-in{from{opacity:0}to{opacity:1}}
.rp-bar{display:flex;align-items:center;gap:.55rem;padding:.45rem .7rem;
  background:rgba(8,12,26,.7);border-bottom:1px solid rgba(126,182,214,.25);flex-wrap:wrap}
.rp-logo{font-weight:800;letter-spacing:.02em;color:var(--turn-col);white-space:nowrap;
  text-shadow:0 0 14px rgba(126,224,255,.4);transition:color .3s ease}
.rp-weapons{display:flex;gap:.3rem;margin-left:.3rem}
.rp-weapon{display:flex;align-items:center;gap:.4rem;background:rgba(255,255,255,.05);
  border:1px solid var(--wcol,rgba(255,255,255,.25));color:#e6ecff;
  padding:.22rem .6rem .22rem .35rem;border-radius:8px;cursor:pointer;font-size:.82rem;
  transition:background .15s ease,box-shadow .15s ease}
.rp-weapon:hover{background:rgba(255,255,255,.1)}
.rp-weapon.on{background:color-mix(in srgb,var(--wcol) 28%,transparent);
  box-shadow:0 0 10px var(--wcol);color:#fff}
.rp-wkey{display:inline-flex;align-items:center;justify-content:center;width:1.1rem;height:1.1rem;
  border-radius:4px;background:var(--wcol,#789);color:#0a0c1a;font-weight:800;font-size:.72rem}
.rp-btn{background:rgba(126,182,214,.12);border:1px solid rgba(126,182,214,.3);
  color:#dfe7ff;padding:.22rem .6rem;border-radius:7px;cursor:pointer;font-size:.82rem;
  transition:background .15s ease}
.rp-btn:hover{background:rgba(126,182,214,.26)}
.rp-btn-lg{padding:.5rem 1.15rem;font-size:.95rem}
.rp-status{margin-left:auto;font-size:.8rem;color:#9ad9b0;min-height:1em}
.rp-close{width:2rem;height:2rem;border-radius:50%;border:none;cursor:pointer;
  background:rgba(255,80,80,.18);color:#ff9a9a;font-size:1rem}
.rp-close:hover{background:rgba(255,80,80,.34);color:#fff}
.rp-stage{flex:1;display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden;padding:14px}
.rp-canvas{border-radius:12px;
  box-shadow:0 16px 60px rgba(0,0,0,.6),0 0 0 1px rgba(126,182,214,.22),0 0 40px rgba(80,140,255,.12);
  background:#0a1430;touch-action:none;cursor:crosshair}
.rp-banner{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;
  justify-content:center;gap:.6rem;background:rgba(6,8,18,.72);backdrop-filter:blur(3px)}
.rp-banner-title{font-size:2.6rem;font-weight:800;color:#7ee0ff;text-shadow:0 2px 22px rgba(120,220,255,.55)}
.rp-banner-sub{font-size:1.05rem;color:#ffd76a}
.rp-banner-actions{display:flex;gap:.6rem;margin-top:.4rem}
.rp-help{padding:.45rem .8rem;text-align:center;font-size:.76rem;color:#9aa0c8;
  background:rgba(8,12,26,.6);border-top:1px solid rgba(126,182,214,.15)}
.rp-help b{color:#dfe7ff}
.rp-hidden{display:none!important}
`
