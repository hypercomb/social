// diamondcoreprocessor.com/tutorial/tutorial-overlay.view.ts
//
// <hc-bee-tutorial> — the bee tour's screen layer. A framework-free custom
// element contributed through the ShellSurfaceRegistry (`element:` shape via
// IoC — never an app.html tag). Hosts AB the bee (the same master SVG the
// GPU swarm bakes its atlas from, with the loved simple wing flap), a speech
// bubble with Continue/Skip, a ghost cursor for demonstrated clicks, and a
// highlight ring. The whole layer is pointer-events:none — only the bubble's
// buttons are interactive — so the participant can always ignore the tour
// and keep using the app directly. Escape asks the drone to end the tour.

const OVERLAY_IOC_KEY = '@diamondcoreprocessor.com/BeeTutorialOverlay'
const SURFACE_NAME = 'hc-bee-tutorial'

export type SayResult = 'continue' | 'secondary' | 'skip'

export type SayOptions = {
  text: string
  /** Small uppercase chip above the text (e.g. "GOING IN"). */
  chip?: string
  continueLabel?: string | null
  secondaryLabel?: string | null
  skipLabel?: string | null
}

type Pt = { x: number; y: number }

// The AB master SVG (source of truth: presentation/avatars/bee-ab-atlas.ts).
// Wings are static groups here; the rAF loop drives the two rotate() angles
// with the loved flap — lAng = -16 + 28·sin²(πp), rAng mirrored, ~1.6 Hz.
const AB_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
  <g data-wing="l">
    <path d="M78,92 C50,76 22,78 18,95 C16,110 44,108 70,100 C76,98 79,95 78,92 Z" fill="rgba(216,232,255,0.56)" stroke="#a7c2e2" stroke-width="1.2"/>
    <path d="M74,94 C52,84 34,84 24,90" fill="none" stroke="#a7c2e2" stroke-width="0.8" opacity="0.6"/>
  </g>
  <g data-wing="r">
    <path d="M122,92 C150,76 178,78 182,95 C184,110 156,108 130,100 C124,98 121,95 122,92 Z" fill="rgba(216,232,255,0.56)" stroke="#a7c2e2" stroke-width="1.2"/>
    <path d="M126,94 C148,84 166,84 176,90" fill="none" stroke="#a7c2e2" stroke-width="0.8" opacity="0.6"/>
  </g>
  <clipPath id="ab-tour"><path d="M100,98 C129,98 142,115 142,134 C142,153 126,166 108,164 C90,162 58,153 58,132 C58,114 71,98 100,98 Z"/></clipPath>
  <g clip-path="url(#ab-tour)">
    <rect x="50" y="95" width="100" height="80" fill="#f7b733"/>
    <path d="M57,118 Q100,128 143,118 L143,131 Q100,141 57,131 Z" fill="#2c1e10"/>
    <path d="M60,144 Q100,153 135,143 L134,155 Q100,164 64,155 Z" fill="#2c1e10"/>
    <ellipse cx="100" cy="114" rx="40" ry="11" fill="#ffd96f" opacity="0.4"/>
    <ellipse cx="100" cy="156" rx="28" ry="8" fill="#b9760f" opacity="0.28"/>
  </g>
  <path d="M108,163 C113,168 117,172 117,172 C113,170 109,168 106,165 Z" fill="#3a2814"/>
  <g stroke="#3a2814" stroke-width="2.6" stroke-linecap="round" fill="none">
    <path d="M90,158 C86,166 86,172 90,177"/><path d="M108,160 C112,168 112,174 108,179"/><path d="M100,162 C99,170 100,176 100,180"/>
  </g>
  <circle cx="100" cy="98" r="20" fill="#c58a38"/><circle cx="94" cy="93" r="11" fill="#e6ae57" opacity="0.5"/>
  <circle cx="100" cy="66" r="36" fill="#c58a38"/>
  <path d="M86,38 C81,25 80,16 82,8" fill="none" stroke="#3a2814" stroke-width="2.6" stroke-linecap="round"/><circle cx="82" cy="6" r="3.8" fill="#3a2814"/>
  <path d="M114,37 C120,24 126,16 131,11" fill="none" stroke="#3a2814" stroke-width="2.6" stroke-linecap="round"/><circle cx="132" cy="9" r="3.8" fill="#3a2814"/>
  <circle cx="73" cy="80" r="6" fill="#ff9d5b" opacity="0.34"/><circle cx="125" cy="78" r="6" fill="#ff9d5b" opacity="0.34"/>
  <ellipse cx="85" cy="69" rx="8.5" ry="11.5" fill="#211710"/><circle cx="88" cy="63.5" r="3.1" fill="#fff"/><circle cx="82" cy="74" r="1.4" fill="#fff" opacity="0.72"/>
  <ellipse cx="116" cy="67" rx="11" ry="14" fill="#211710"/><circle cx="120" cy="60.5" r="4" fill="#fff"/><circle cx="112" cy="73" r="1.8" fill="#fff" opacity="0.72"/>
  <path d="M94,86 q9,7 18,1" fill="none" stroke="#3a2814" stroke-width="1.8" stroke-linecap="round"/>
</svg>`

const CURSOR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22">
  <path d="M5.5 2.2 L5.5 18.6 L9.6 14.9 L12.2 21.2 L15.1 20 L12.5 13.8 L18 13.4 Z"
        fill="#f2f6fa" stroke="#1a2129" stroke-width="1.4" stroke-linejoin="round"/>
</svg>`

const STYLE = `
:host {
  position: fixed;
  inset: 0;
  z-index: 100000;
  pointer-events: none;
  display: none;
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
}
:host(.active) { display: block; }

.ab {
  position: absolute;
  left: 0; top: 0;
  width: 76px; height: 76px;
  margin: -38px 0 0 -38px;
  will-change: transform;
  filter: drop-shadow(0 6px 14px rgba(0, 0, 0, 0.35));
}

.bubble {
  position: absolute;
  max-width: 320px;
  min-width: 200px;
  background: rgba(14, 18, 24, 0.94);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 12px;
  padding: 13px 16px 12px;
  color: #e8edf3;
  font-size: 13.5px;
  line-height: 1.55;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
  pointer-events: auto;
  opacity: 0;
  transform: translateY(4px);
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.bubble.show { opacity: 1; transform: none; }
.bubble .chip {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #8fa1b3;
  margin-bottom: 6px;
}
.bubble .chip::before {
  content: '';
  width: 6px; height: 6px;
  border-radius: 50%;
  background: #d9a441;
}
.bubble .btns {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
}
.bubble .btns:empty { display: none; }
.bubble button {
  font-family: inherit;
  cursor: pointer;
  border: none;
  border-radius: 8px;
}
.bubble button.primary {
  background: #d9a441;
  color: #181208;
  padding: 7px 14px;
  font-weight: 600;
  font-size: 12.5px;
}
.bubble button.primary:hover { background: #e4b455; }
.bubble button.ghost {
  background: transparent;
  color: #8fa1b3;
  padding: 7px 6px;
  font-size: 12px;
}
.bubble button.ghost:hover { color: #c7d2dc; }

.cursor {
  position: absolute;
  left: 0; top: 0;
  width: 22px; height: 22px;
  opacity: 0;
  will-change: transform;
  filter: drop-shadow(0 2px 5px rgba(0, 0, 0, 0.5));
}
.cursor .keycap {
  position: absolute;
  left: 20px; top: 20px;
  padding: 2px 7px;
  font-size: 10px;
  font-weight: 600;
  color: #e8edf3;
  background: rgba(14, 18, 24, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.22);
  border-bottom-width: 2.5px;
  border-radius: 5px;
  white-space: nowrap;
}

.ring {
  position: absolute;
  border: 1.5px solid rgba(217, 164, 65, 0.6);
  box-shadow: 0 0 0 4px rgba(217, 164, 65, 0.12);
  opacity: 0;
  transition: opacity 0.25s ease, left 0.25s ease, top 0.25s ease,
    width 0.25s ease, height 0.25s ease, border-radius 0.25s ease;
}
.ring.show { opacity: 1; }

.ripple {
  position: absolute;
  left: 0; top: 0;
  width: 14px; height: 14px;
  margin: -7px 0 0 -7px;
  border: 2px solid rgba(242, 246, 250, 0.85);
  border-radius: 50%;
  pointer-events: none;
  animation: hc-tut-ripple 0.55s ease-out forwards;
}
@keyframes hc-tut-ripple {
  from { transform: scale(0.4); opacity: 0.9; }
  to { transform: scale(3.2); opacity: 0; }
}
`

const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2

export class BeeTutorialOverlayElement extends HTMLElement {

  /** Set by the drone — invoked on Escape or the Skip button. */
  public onSkipRequested: (() => void) | null = null

  #bee!: HTMLDivElement
  #wingL: SVGGElement | null = null
  #wingR: SVGGElement | null = null
  #bubble!: HTMLDivElement
  #cursor!: HTMLDivElement
  #ring!: HTMLDivElement

  #active = false
  #raf = 0
  #reduced = false

  // bee kinematics
  #pos: Pt = { x: -120, y: 200 }
  #flight: { from: Pt; to: Pt; start: number; dur: number; guard: ReturnType<typeof setTimeout> } | null = null
  #flightDone: (() => void) | null = null
  #facing = 1        // current scaleX
  #facingTarget = 1
  #waggleUntil = 0

  #sayResolve: ((r: SayResult) => void) | null = null

  connectedCallback(): void {
    if (this.shadowRoot) return
    const root = this.attachShadow({ mode: 'open' })

    const style = document.createElement('style')
    style.textContent = STYLE
    root.appendChild(style)

    this.#ring = document.createElement('div')
    this.#ring.className = 'ring'
    root.appendChild(this.#ring)

    this.#bee = document.createElement('div')
    this.#bee.className = 'ab'
    this.#bee.innerHTML = AB_SVG
    root.appendChild(this.#bee)
    this.#wingL = this.#bee.querySelector('[data-wing="l"]')
    this.#wingR = this.#bee.querySelector('[data-wing="r"]')

    this.#cursor = document.createElement('div')
    this.#cursor.className = 'cursor'
    this.#cursor.innerHTML = CURSOR_SVG
    root.appendChild(this.#cursor)

    this.#bubble = document.createElement('div')
    this.#bubble.className = 'bubble'
    root.appendChild(this.#bubble)

    this.#reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false

    const existing = window.ioc.get?.(OVERLAY_IOC_KEY)
    if (!existing) window.ioc.register(OVERLAY_IOC_KEY, this)
  }

  disconnectedCallback(): void {
    this.deactivate()
  }

  // -----------------------------------------------
  // lifecycle
  // -----------------------------------------------

  activate(): void {
    if (this.#active) return
    this.#active = true
    this.classList.add('active')
    this.#pos = { x: -120, y: Math.max(140, window.innerHeight * 0.3) }
    window.addEventListener('keydown', this.#onKeyDown, true)
    this.#raf = requestAnimationFrame(this.#tick)
  }

  deactivate(): void {
    if (!this.#active) return
    this.#active = false
    this.classList.remove('active')
    window.removeEventListener('keydown', this.#onKeyDown, true)
    cancelAnimationFrame(this.#raf)
    this.#settleFlight()
    this.hideBubble()
    this.highlight(null)
    this.#cursor.style.opacity = '0'
  }

  get active(): boolean {
    return this.#active
  }

  #onKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return
    this.#requestSkip()
  }

  /** Programmatic skip (e.g. `/tutorial stop`) — resolves any pending bubble as 'skip'. */
  dismiss(): void {
    this.#requestSkip()
  }

  #requestSkip(): void {
    const resolve = this.#sayResolve
    this.#sayResolve = null
    this.hideBubble()
    resolve?.('skip')
    this.onSkipRequested?.()
  }

  // -----------------------------------------------
  // bee flight
  // -----------------------------------------------

  flyTo(x: number, y: number): Promise<void> {
    this.#settleFlight()
    const from = { ...this.#pos }
    const dist = Math.hypot(x - from.x, y - from.y)
    const dur = this.#reduced ? 120 : Math.min(1600, Math.max(420, dist / 0.55))
    if (Math.abs(x - from.x) > 12) this.#facingTarget = x > from.x ? 1 : -1
    // rAF is throttled or fully suspended in hidden tabs — the guard timer
    // force-settles the flight so a backgrounded tab can never strand the tour.
    const flight = {
      from, to: { x, y }, start: performance.now(), dur,
      guard: setTimeout(() => { if (this.#flight === flight) this.#settleFlight() }, dur + 350),
    }
    this.#flight = flight
    return new Promise(resolve => { this.#flightDone = resolve })
  }

  /** Little figure-8 waggle dance in place. */
  waggle(): Promise<void> {
    this.#waggleUntil = performance.now() + (this.#reduced ? 300 : 2300)
    return new Promise(resolve =>
      setTimeout(resolve, this.#reduced ? 320 : 2350))
  }

  async flyOff(): Promise<void> {
    this.hideBubble()
    this.highlight(null)
    await this.flyTo(window.innerWidth + 130, Math.max(90, window.innerHeight * 0.2))
  }

  #settleFlight(): void {
    const flight = this.#flight
    if (flight) {
      clearTimeout(flight.guard)
      this.#pos = { ...flight.to } // land exactly on target even without a final frame
    }
    const done = this.#flightDone
    this.#flight = null
    this.#flightDone = null
    done?.()
  }

  #tick = (now: number): void => {
    if (!this.#active) return

    // flight easing
    if (this.#flight) {
      const f = this.#flight
      const t = Math.min(1, (now - f.start) / f.dur)
      const e = easeInOutCubic(t)
      this.#pos = {
        x: f.from.x + (f.to.x - f.from.x) * e,
        y: f.from.y + (f.to.y - f.from.y) * e,
      }
      if (t >= 1) this.#settleFlight()
    }

    // idle bob + gentle wander; waggle overrides with a figure-8
    let ox = 0
    let oy = 0
    if (!this.#reduced) {
      const s = now / 1000
      if (now < this.#waggleUntil) {
        ox = Math.sin(s * 7.4) * 30
        oy = Math.sin(s * 14.8) * 11
      } else {
        ox = Math.sin(s * 0.9) * 3
        oy = Math.sin(s * 2.2) * 3.5 + Math.sin(s * 0.7) * 2
      }
    }

    // facing flip eases through ~0.12 so the turn reads as a turn
    if (this.#facing !== this.#facingTarget) {
      const step = 0.14 * Math.sign(this.#facingTarget - this.#facing)
      this.#facing = Math.abs(this.#facingTarget - this.#facing) <= 0.14
        ? this.#facingTarget
        : this.#facing + step
    }
    const scaleX = Math.sign(this.#facing || 1) * Math.max(0.12, Math.abs(this.#facing))

    this.#bee.style.transform =
      `translate3d(${this.#pos.x + ox}px, ${this.#pos.y + oy}px, 0) scaleX(${scaleX.toFixed(3)})`

    // the loved flap: lAng = -16 + 28·sin²(πp), mirrored right, ~1.6 Hz
    const p = (now / 1000) * 1.6 % 1
    const sweep = Math.sin(Math.PI * p) ** 2
    this.#wingL?.setAttribute('transform', `rotate(${(-16 + 28 * sweep).toFixed(2)} 78 92)`)
    this.#wingR?.setAttribute('transform', `rotate(${(16 - 28 * sweep).toFixed(2)} 122 92)`)

    this.#raf = requestAnimationFrame(this.#tick)
  }

  // -----------------------------------------------
  // speech bubble
  // -----------------------------------------------

  say(opts: SayOptions): Promise<SayResult> {
    this.#sayResolve?.('continue') // a superseded bubble never blocks the script
    this.#sayResolve = null
    this.#renderBubble(opts)

    if (!opts.continueLabel && !opts.secondaryLabel && !opts.skipLabel) {
      return Promise.resolve('continue') // sticky note — caller hides it later
    }
    return new Promise<SayResult>(resolve => { this.#sayResolve = resolve })
  }

  hideBubble(): void {
    this.#bubble.classList.remove('show')
  }

  #renderBubble(opts: SayOptions): void {
    const b = this.#bubble
    b.textContent = ''

    if (opts.chip) {
      const chip = document.createElement('div')
      chip.className = 'chip'
      chip.textContent = opts.chip
      b.appendChild(chip)
    }

    const text = document.createElement('div')
    text.textContent = opts.text
    b.appendChild(text)

    const btns = document.createElement('div')
    btns.className = 'btns'
    const addButton = (label: string, cls: string, result: SayResult): void => {
      const el = document.createElement('button')
      el.className = cls
      el.textContent = label
      el.addEventListener('click', () => {
        if (result === 'skip') { this.#requestSkip(); return }
        const resolve = this.#sayResolve
        this.#sayResolve = null
        this.hideBubble()
        resolve?.(result)
      })
      btns.appendChild(el)
    }
    if (opts.continueLabel) addButton(opts.continueLabel, 'primary', 'continue')
    if (opts.secondaryLabel) addButton(opts.secondaryLabel, 'ghost', 'secondary')
    if (opts.skipLabel) addButton(opts.skipLabel, 'ghost', 'skip')
    b.appendChild(btns)

    this.#placeBubble()
    b.classList.add('show')
  }

  /** Beside the bee, flipped and clamped to stay on screen. */
  #placeBubble(): void {
    const b = this.#bubble
    b.style.left = '0px'
    b.style.top = '0px'
    const bw = Math.min(320, b.offsetWidth || 280)
    const bh = b.offsetHeight || 120
    const margin = 12
    const gap = 52

    let x = this.#pos.x + gap
    if (x + bw + margin > window.innerWidth) x = this.#pos.x - gap - bw
    x = Math.max(margin, Math.min(x, window.innerWidth - bw - margin))

    let y = this.#pos.y - bh / 2
    y = Math.max(margin, Math.min(y, window.innerHeight - bh - margin))

    b.style.left = `${Math.round(x)}px`
    b.style.top = `${Math.round(y)}px`
  }

  // -----------------------------------------------
  // ghost cursor + highlight
  // -----------------------------------------------

  /** Demonstration cursor: glides from the bee to (x, y) and presses. The
   *  press is pure theatre — the caller performs the real action when the
   *  returned promise resolves. */
  async ghostClick(x: number, y: number, opts: { shift?: boolean } = {}): Promise<void> {
    const c = this.#cursor
    const from = { x: this.#pos.x + 20, y: this.#pos.y + 26 }

    let keycap: HTMLSpanElement | null = null
    if (opts.shift) {
      keycap = document.createElement('span')
      keycap.className = 'keycap'
      keycap.textContent = '⇧ Shift'
      c.appendChild(keycap)
    }

    c.style.transform = `translate3d(${from.x}px, ${from.y}px, 0)`
    c.style.opacity = '1'

    // race every animation against a timer — hidden tabs may never finish them
    const settled = (anim: Animation, ms: number): Promise<unknown> =>
      Promise.race([anim.finished.catch(() => undefined), new Promise(r => setTimeout(r, ms))])

    const dur = this.#reduced ? 80 : Math.min(700, Math.max(320, Math.hypot(x - from.x, y - from.y) / 1.1))
    const glide = c.animate(
      [
        { transform: `translate3d(${from.x}px, ${from.y}px, 0)` },
        { transform: `translate3d(${x}px, ${y}px, 0)` },
      ],
      { duration: dur, easing: 'ease-in-out', fill: 'forwards' },
    )
    await settled(glide, dur + 350)
    c.style.transform = `translate3d(${x}px, ${y}px, 0)`

    // press
    const press = c.animate(
      [{ transform: `translate3d(${x}px, ${y}px, 0) scale(1)` },
       { transform: `translate3d(${x}px, ${y}px, 0) scale(0.86)` },
       { transform: `translate3d(${x}px, ${y}px, 0) scale(1)` }],
      { duration: 200, easing: 'ease-out' },
    )
    const ripple = document.createElement('div')
    ripple.className = 'ripple'
    ripple.style.left = `${x}px`
    ripple.style.top = `${y}px`
    this.shadowRoot?.appendChild(ripple)
    setTimeout(() => ripple.remove(), 650)
    await settled(press, 550)

    setTimeout(() => {
      c.style.opacity = '0'
      keycap?.remove()
    }, this.#reduced ? 60 : 420)
  }

  /** Circle {x, y, r}, a DOMRect-like box, or null to clear. */
  highlight(target: { x: number; y: number; r: number } | { left: number; top: number; width: number; height: number } | null): void {
    const ring = this.#ring
    if (!target) {
      ring.classList.remove('show')
      return
    }
    if ('r' in target) {
      ring.style.left = `${target.x - target.r}px`
      ring.style.top = `${target.y - target.r}px`
      ring.style.width = `${target.r * 2}px`
      ring.style.height = `${target.r * 2}px`
      ring.style.borderRadius = '50%'
    } else {
      const pad = 6
      ring.style.left = `${target.left - pad}px`
      ring.style.top = `${target.top - pad}px`
      ring.style.width = `${target.width + pad * 2}px`
      ring.style.height = `${target.height + pad * 2}px`
      ring.style.borderRadius = '12px'
    }
    ring.classList.add('show')
  }
}

// Contribute the surface the doctrine way: define the element, then add it
// to the registry — never a template tag in either app.html.
window.ioc.whenReady?.('@hypercomb.social/ShellSurfaceRegistry', (registry: { add(s: unknown): void }) => {
  if (!customElements.get(SURFACE_NAME)) {
    customElements.define(SURFACE_NAME, BeeTutorialOverlayElement)
  }
  try {
    registry.add({
      name: SURFACE_NAME,
      owner: '@diamondcoreprocessor.com/BeeTutorialDrone',
      element: SURFACE_NAME,
      order: 900,
    })
  } catch {
    // duplicate add (hot reload) — the mounted surface is already live
  }
})
