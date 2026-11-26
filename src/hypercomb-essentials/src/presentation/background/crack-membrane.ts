// hypercomb-essentials/src/presentation/background/crack-membrane.ts
//
// CRACKS IN THE DARK SCREEN (jwize, 2026-11-26): "make the dark view look like
// a cracked wall … the dark theme starts out without cracks … a nice impact".
// Then: "just create the feathered membrane of the cracks and it does it in a
// subtractive way to add light … more subtle, slightly less detail but same
// reach", "it should be selectable and changeable through background", and
// "focus crack in center". Trigger he picked: WHEN DARK SWITCHES ON.
//
// A MEMBRANE, NOT A WALL. The cracks are one feathered mask laid over whatever
// the screen already shows (a drawn look, a picture, or the bare surface), so
// it works with every backdrop instead of replacing it:
//
//   shadow — the membrane itself, darkening what is under it
//   light  — the membrane shifted toward the light, MINUS the membrane: what
//            is left is a thin crescent on the lit lip, screened on top
//
// The light is subtracted out of the shape, never drawn as a second shape, so
// the lip always hugs the crack exactly.
//
// STACKING. The layer is `position:fixed; z-index:0` and goes FIRST in <body>:
// above the body's own backdrop (a negative z-index would paint under it, the
// aurora trap in canvas-background.service.ts), below #pixi-host, which is
// also z-index 0 and is later in the body, so the tiles stay on top.
//
// A strike is a seed and a point: the same pair always grows the same cracks,
// so a resize replays them exactly. Nothing draws once a strike has settled.

const DPR_CAP = 1.5
/** Toward the top left, the way the shell's panels are lit. */
const LIGHT = { x: -0.6, y: -0.8 }
const LIP = 1.6
/** How fast the crack front runs, and the glow that rides it (px per ms). */
const FRONT_SPEED = 0.72
/** One slow pulse along the seams every this many ms, once a crack settles. */
const PULSE_PERIOD = 7000
/** How thick the travelling band of light is, in px. */
const PULSE_BAND = 130

type Rand = () => number
type Strike = { x: number; y: number; seed: number }
type Branch = { x: number; y: number; a: number; a0: number; w: number; left: number; rnd: Rand }

const mulberry = (seed: number): Rand => () => {
  seed |= 0; seed = seed + 0x6D2B79F5 | 0
  let t = Math.imul(seed ^ seed >>> 15, 1 | seed)
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
  return ((t ^ t >>> 14) >>> 0) / 4294967296
}

export class CrackMembrane {
  #root: HTMLDivElement | null = null
  #shadow: HTMLCanvasElement | null = null
  #light: HTMLCanvasElement | null = null
  #flashEl: HTMLDivElement | null = null
  #glow: HTMLCanvasElement | null = null
  #mask = document.createElement('canvas')
  /** The membrane, feathered wider, that the travelling light is cut from. */
  #glowMask = document.createElement('canvas')
  /** The last impact: where, how far it reaches, and when (ms). */
  #origin = { x: 0, y: 0, reach: 0, at: 0 }
  #reduce = false
  #lastPulse = 0
  #visible = false
  #raf = 0
  #w = 0
  #h = 0
  #dpr = 1
  #strikes: Strike[] = []
  #branches: Branch[] = []
  #onResize = (): void => { this.#resize() }

  get visible(): boolean { return this.#visible }
  get struck(): boolean { return this.#strikes.length > 0 }

  show(): void {
    if (this.#visible || !this.#canDraw()) return
    this.#ensure()
    this.#visible = true
    this.#root!.style.display = 'block'
    window.addEventListener('resize', this.#onResize)
    this.#resize()
  }

  hide(): void {
    if (!this.#visible) return
    this.#visible = false
    if (this.#root) this.#root.style.display = 'none'
    window.removeEventListener('resize', this.#onResize)
    if (this.#raf) cancelAnimationFrame(this.#raf)
    this.#raf = 0
  }

  /** Unbroken again. */
  clean(): void {
    this.#strikes = []
    this.#branches = []
    this.#clearMask()
    this.#compose()
    this.#glow?.getContext('2d')?.clearRect(0, 0, this.#glow.width, this.#glow.height)
  }

  /** One impact, at the centre of the screen unless told otherwise
   *  (fractions of the viewport). */
  strike(x = 0.5, y = 0.5): void {
    if (!this.#visible) return
    const s: Strike = { x, y, seed: (Math.random() * 2 ** 31) | 0 }
    this.#strikes.push(s)
    this.#grow(s)
    this.#reduce = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (this.#reduce) { while (this.#branches.length) this.#step(999); this.#compose(); return }
    this.#origin.at = performance.now()
    this.#flash(x, y)
    if (!this.#raf) this.#raf = requestAnimationFrame(this.#tick)
  }

  // ── setup ───────────────────────────────────────────────────────────

  /** A real 2D canvas with filters and compositing — not there in a test
   *  DOM or a stripped-down host, and then the screen simply never cracks. */
  #canDraw(): boolean {
    try {
      const c = this.#mask.getContext('2d') as CanvasRenderingContext2D | null
      return !!c && typeof c.clearRect === 'function' && typeof c.drawImage === 'function' && 'filter' in c
    } catch { return false }
  }

  #ensure(): void {
    if (this.#root) return
    const root = document.createElement('div')
    root.id = 'hc-cracks'
    root.setAttribute('aria-hidden', 'true')
    Object.assign(root.style, { position: 'fixed', inset: '0', zIndex: '0', pointerEvents: 'none', display: 'none', overflow: 'hidden' })
    const shadow = document.createElement('canvas')
    const light = document.createElement('canvas')
    const flash = document.createElement('div')
    const glow = document.createElement('canvas')
    for (const el of [shadow, light, glow, flash]) Object.assign(el.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block' })
    light.style.mixBlendMode = 'screen'
    glow.style.mixBlendMode = 'screen'
    Object.assign(flash.style, { mixBlendMode: 'screen', opacity: '0', transition: 'opacity 900ms ease-out' })
    root.append(shadow, light, glow, flash)
    document.body.prepend(root)
    this.#root = root
    this.#shadow = shadow
    this.#light = light
    this.#flashEl = flash
    this.#glow = glow
  }

  #resize(): void {
    if (!this.#shadow || !this.#light || !this.#glow) return
    const w = Math.max(1, window.innerWidth), h = Math.max(1, window.innerHeight)
    const dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP)
    if (w === this.#w && h === this.#h && dpr === this.#dpr) return
    this.#w = w; this.#h = h; this.#dpr = dpr
    for (const c of [this.#shadow, this.#light, this.#glow, this.#mask, this.#glowMask]) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr) }
    this.#branches = []
    this.#clearMask()
    for (const s of this.#strikes) { this.#grow(s); while (this.#branches.length) this.#step(999) }
    this.#compose()
    // A settled crack keeps its slow pulse after a resize.
    if (this.#strikes.length && !this.#reduce && !this.#raf && this.#visible) this.#raf = requestAnimationFrame(this.#tick)
  }

  #clearMask(): void {
    this.#mask.getContext('2d')?.clearRect(0, 0, this.#mask.width, this.#mask.height)
  }

  // ── growth: fewer, smoother rays, the same reach ────────────────────

  #grow(s: Strike): void {
    const rnd = mulberry(s.seed)
    const x = s.x * this.#w, y = s.y * this.#h
    const reach = Math.hypot(this.#w, this.#h) * (.3 + rnd() * .16)
    this.#origin = { x, y, reach, at: this.#origin.at }
    const rays = 4 + Math.floor(rnd() * 3)
    const off = rnd() * Math.PI * 2
    for (let i = 0; i < rays; i++) {
      const a = off + i / rays * Math.PI * 2 + (rnd() - .5) * .8
      this.#branches.push({ x, y, a, a0: a, w: 1.7 + rnd() * 1.1, left: reach * (.55 + rnd() * .5), rnd })
    }
  }

  #step(steps: number): void {
    const c = this.#mask.getContext('2d')
    if (!c) { this.#branches = []; return }
    c.setTransform(this.#dpr, 0, 0, this.#dpr, 0, 0)
    c.strokeStyle = '#fff'
    c.lineCap = 'round'
    c.lineJoin = 'round'
    for (let k = 0; k < steps && this.#branches.length; k++) {
      const next: Branch[] = []
      for (const b of this.#branches) {
        const r = b.rnd
        const seg = 4 + r() * 4
        b.a += (r() - .5) * .8 + (b.a0 - b.a) * .12
        const nx = b.x + Math.cos(b.a) * seg, ny = b.y + Math.sin(b.a) * seg
        c.lineWidth = Math.max(.6, b.w)
        c.beginPath(); c.moveTo(b.x, b.y); c.lineTo(nx, ny); c.stroke()
        b.x = nx; b.y = ny; b.left -= seg; b.w *= .988
        if (b.w > 1 && r() < .03) {
          const na = b.a + (r() < .5 ? -1 : 1) * (.4 + r() * .5)
          next.push({ ...b, a: na, a0: na, w: b.w * .6, left: b.left * (.35 + r() * .3) })
        }
        if (b.left > 0 && b.w > .4 && nx > -20 && ny > -20 && nx < this.#w + 20 && ny < this.#h + 20) next.push(b)
      }
      this.#branches = next
    }
  }

  // THE LOOP. While a crack grows it runs every frame: a quick burst at the
  // impact, then the front slows as it runs out. Once settled, only the slow
  // pulse is left, drawn at about 30 frames a second. Hidden tabs get no
  // frames at all; reduced motion gets no loop.
  #tick = (now: number): void => {
    this.#raf = 0
    if (!this.#visible) return
    const growing = this.#branches.length > 0
    if (growing) {
      const age = now - this.#origin.at
      this.#step(age < 180 ? 4 : 2)
      this.#compose()
    }
    if (growing || now - this.#lastPulse > 30) { this.#pulse(now); this.#lastPulse = now }
    if (this.#strikes.length && !this.#reduce) this.#raf = requestAnimationFrame(this.#tick)
  }

  /** Light moving along the membrane: a warm band that rides the crack front
   *  out from the impact, then a dim cool band every few seconds. The band is
   *  a ring around the impact, cut to the membrane's shape. */
  #pulse(now: number): void {
    const g = this.#glow?.getContext('2d')
    if (!g || !this.#glow) return
    const W = this.#glow.width, H = this.#glow.height, d = this.#dpr
    g.setTransform(1, 0, 0, 1, 0, 0)
    g.globalCompositeOperation = 'source-over'
    g.clearRect(0, 0, W, H)
    const { x, y, reach, at } = this.#origin
    if (!reach) return
    const far = reach * 1.1
    const age = now - at
    const front = age * FRONT_SPEED
    let r: number, alpha: number, tint: string
    if (front < far) {
      // the first pass: hot at the impact, cooling as it runs out
      r = front
      alpha = .55 * (1 - .6 * front / far)
      tint = '255,196,140'
    } else {
      const phase = ((age - far / FRONT_SPEED) % PULSE_PERIOD) / PULSE_PERIOD
      // travel for the first 60% of the period, then rest
      if (phase > .6) return
      const t = phase / .6
      r = t * far
      alpha = .2 * Math.sin(Math.PI * t)
      tint = '170,200,236'
    }
    if (alpha < .01) return
    g.drawImage(this.#glowMask, 0, 0)
    g.globalCompositeOperation = 'source-in'
    const band = PULSE_BAND
    const ring = g.createRadialGradient(x * d, y * d, Math.max(0, r - band) * d, x * d, y * d, (r + band * .35) * d)
    ring.addColorStop(0, `rgba(${tint},0)`)
    ring.addColorStop(.72, `rgba(${tint},${alpha.toFixed(3)})`)
    ring.addColorStop(1, `rgba(${tint},0)`)
    g.fillStyle = ring
    g.fillRect(0, 0, W, H)
    g.globalCompositeOperation = 'source-over'
  }

  /** A soft warm bloom at the point of contact, fading on its own. */
  #flash(x: number, y: number): void {
    const el = this.#flashEl
    if (!el) return
    el.style.transition = 'none'
    el.style.background = `radial-gradient(circle at ${x * 100}% ${y * 100}%, rgba(255,214,170,.32) 0, rgba(255,214,170,0) 220px)`
    el.style.opacity = '1'
    void el.offsetWidth
    el.style.transition = 'opacity 900ms ease-out'
    el.style.opacity = '0'
  }

  // ── the membrane: shadow, then light subtracted out of it ───────────

  #compose(): void {
    const sh = this.#shadow?.getContext('2d'), li = this.#light?.getContext('2d')
    if (!sh || !li) return
    const W = this.#mask.width, H = this.#mask.height, d = this.#dpr
    sh.setTransform(1, 0, 0, 1, 0, 0); li.setTransform(1, 0, 0, 1, 0, 0)
    sh.clearRect(0, 0, W, H); li.clearRect(0, 0, W, H)
    if (!this.#strikes.length) return

    // shadow: a wide soft halo, then the feathered seam
    sh.globalCompositeOperation = 'source-over'
    sh.filter = `blur(${5 * d}px)`; sh.globalAlpha = .5; sh.drawImage(this.#mask, 0, 0)
    sh.filter = `blur(${1.1 * d}px)`; sh.globalAlpha = 1; sh.drawImage(this.#mask, 0, 0); sh.drawImage(this.#mask, 0, 0)
    sh.filter = 'none'; sh.globalAlpha = 1
    sh.globalCompositeOperation = 'source-in'
    sh.fillStyle = 'rgba(0,0,0,.9)'; sh.fillRect(0, 0, W, H)
    sh.globalCompositeOperation = 'source-over'

    // light: the membrane nudged toward the light, minus the membrane
    li.globalCompositeOperation = 'source-over'
    li.filter = `blur(${0.9 * d}px)`
    li.drawImage(this.#mask, LIGHT.x * LIP * d, LIGHT.y * LIP * d)
    // Subtracted twice: one pass of a feathered shape leaves a faint trace of
    // light along the whole seam; the second leaves only the lip.
    li.globalCompositeOperation = 'destination-out'
    li.filter = `blur(${1.2 * d}px)`
    li.drawImage(this.#mask, 0, 0)
    li.drawImage(this.#mask, 0, 0)
    li.filter = 'none'
    li.globalCompositeOperation = 'source-in'
    li.fillStyle = 'rgba(200,216,236,.34)'; li.fillRect(0, 0, W, H)
    li.globalCompositeOperation = 'source-over'

    // the membrane the travelling light is cut from: the seam, feathered wider
    const gm = this.#glowMask.getContext('2d')
    if (gm) {
      gm.setTransform(1, 0, 0, 1, 0, 0)
      gm.clearRect(0, 0, W, H)
      gm.filter = `blur(${2.4 * d}px)`
      gm.drawImage(this.#mask, 0, 0); gm.drawImage(this.#mask, 0, 0)
      gm.filter = 'none'
    }
  }
}
