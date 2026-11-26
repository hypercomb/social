// hypercomb-essentials/src/presentation/background/plaster-wall.ts
//
// THE DARK SCREEN IS A PLASTER WALL THAT CRACKS (jwize, 2026-11-26). He
// picked the concept page's look over the thinner overlay membrane: "this is
// better, let's do this instead, and have random strikes up to 3 then reset".
// Concept: https://claude.ai/artifact/PmvKS87errgj6i5GM4q2Uv
//
// THE WALL. Computed, not a picture. Pass one draws a relief (broad trowel
// swells, grain, pinhole pits) into a texture once per size. Pass two lights
// it per pixel with a soft light that follows the pointer, and cuts the cracks
// in: a sharp mask is the void at the bottom of the crack, a blurred copy is
// extra depth, and the blur's slope tilts the plaster normals into the crack —
// the lip facing the light catches it, the far lip falls into shadow.
//
// THE CYCLE. The wall opens clean. Strikes land at random places, thirty
// seconds apart, up to three. Thirty seconds after the third the cracks fade
// out, the wall is clean again, and after another thirty it starts over. The first strike of a cycle lands
// soon after the wall appears, so switching to dark is itself an impact.
//
// STACKING. Like the aurora: a fixed `z-index:-1` layer, so the body must not
// paint while it shows (CanvasBackgroundService sets it transparent). The
// layer reaches 16px past every edge so the shake never uncovers one.
//
// COST. The frame loop runs only while something moves: the light easing
// toward the pointer, a crack growing, debris falling, the shake, the fade.
// An idle wall draws nothing.

const DPR_CAP = 1.25
const LIGHT_HEIGHT = 420
const PAD = 16
/** Strikes in one cycle before the wall mends. */
const MAX_STRIKES = 3
/** THE INTERMISSION (jwize: "30 second intermission"): the wait between
 *  strikes, between the third strike and the mend, and before a new cycle.
 *  Only the first strike of a showing comes quickly. */
const INTERMISSION = 30000
const FIRST_DELAY: [number, number] = [700, 1400]
const NEXT_DELAY: [number, number] = [INTERMISSION, INTERMISSION]
const HOLD_AFTER_LAST = INTERMISSION
const MEND_MS = 1600
const REST_DELAY: [number, number] = [INTERMISSION, INTERMISSION]

const VS = `attribute vec2 p; void main(){ gl_Position = vec4(p,0.,1.); }`

// Pass one: the relief, in CSS pixels. r = height, gb = normal xy.
const RELIEF_FS = `precision highp float;
uniform vec2 uRes; uniform float uDpr;
float hash(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
float noise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),u.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x), u.y); }
float fbm(vec2 p){ float v=0., a=.5; mat2 m=mat2(1.6,1.2,-1.2,1.6); for(int i=0;i<5;i++){ v+=a*noise(p); p=m*p; a*=.5; } return v; }
float height(vec2 p){
  float swell = fbm(p*.0028);
  float trowel = fbm(vec2(p.x*.006 + swell*3., p.y*.0016));
  float grain = fbm(p*.09);
  float pits = smoothstep(.78,.86, noise(p*.21)) * .35;
  return swell*.55 + trowel*.35 + grain*.16 - pits;
}
void main(){
  vec2 P = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uDpr;
  float h = height(P), hx = height(P+vec2(1.,0.)), hy = height(P+vec2(0.,1.));
  vec2 n = clamp(vec2(-(hx-h)*9., (hy-h)*9.), -1., 1.);
  gl_FragColor = vec4(clamp(h,0.,1.), n*.5+.5, 1.);
}`

// Pass two: light, cracks, flash — the concept page's shading.
const LIGHT_FS = `precision highp float;
uniform vec2 uRes; uniform float uDpr; uniform vec2 uLight; uniform vec2 uImpact; uniform float uFlash; uniform float uFade;
uniform sampler2D uRelief; uniform sampler2D uSharp; uniform sampler2D uSoft;
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 px = gl_FragCoord.xy / uDpr;
  float H = uRes.y / uDpr;
  vec4 R = texture2D(uRelief, uv);
  float h = R.r;
  vec3 n = normalize(vec3(R.gb*2.-1., 1.));

  vec2 tuv = vec2(uv.x, 1.-uv.y);
  vec2 texel = uDpr / uRes;
  float keep = 1. - uFade;
  float sh = texture2D(uSharp, tuv).r * keep;
  float so = texture2D(uSoft, tuv).r * keep;
  float gx = (texture2D(uSoft, tuv+vec2(2.*texel.x,0.)).r - texture2D(uSoft, tuv-vec2(2.*texel.x,0.)).r) * keep;
  float gy = (texture2D(uSoft, tuv+vec2(0.,2.*texel.y)).r - texture2D(uSoft, tuv-vec2(0.,2.*texel.y)).r) * keep;
  n = normalize(n + vec3(gx*3.2, -gy*3.2, 0.)*(1.-sh));

  vec3 Lp = vec3(uLight.x, H - uLight.y, ${LIGHT_HEIGHT}.);
  vec3 L = normalize(Lp - vec3(px, 0.));
  float d = length(Lp.xy - px);
  float fall = 1. / (1. + d*d/(950.*950.));
  float diff = max(dot(n,L), 0.);
  float spec = pow(max(dot(reflect(-L,n), vec3(0.,0.,1.)),0.), 28.);

  vec3 base = vec3(.112,.118,.128) * (.86 + .3*h);
  vec3 col = base * (.32 + 1.05*diff*fall) + spec*.05*fall;
  col *= 1. - so*.62;
  col = mix(col, vec3(.010,.011,.014), smoothstep(.25,.85,sh));

  vec2 I = vec2(uImpact.x, H - uImpact.y);
  float fd = length(px - I);
  col += vec3(1.,.72,.45) * uFlash * (.55/(1.+fd*fd/(160.*160.)));

  vec2 q = uv - .5; col *= 1. - dot(q,q)*.75;
  float dither = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898,78.233)))*43758.5453) - .5;
  gl_FragColor = vec4(col + dither/255., 1.);
}`

type Rand = () => number
type Strike = { x: number; y: number; seed: number }
type Branch = { x: number; y: number; a: number; a0: number; w: number; left: number; reach: number; rnd: Rand; live: boolean }
type Particle = { chip: boolean; x: number; y: number; vx: number; vy: number; life: number; decay: number; r: number; rot: number; vr: number }

const mulberry = (seed: number): Rand => () => {
  seed |= 0; seed = seed + 0x6D2B79F5 | 0
  let t = Math.imul(seed ^ seed >>> 15, 1 | seed)
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
  return ((t ^ t >>> 14) >>> 0) / 4294967296
}
const between = ([lo, hi]: [number, number]): number => lo + Math.random() * (hi - lo)

export class PlasterWall {
  #root: HTMLDivElement | null = null
  #glCanvas: HTMLCanvasElement | null = null
  #fx: CanvasRenderingContext2D | null = null
  #fxCanvas: HTMLCanvasElement | null = null
  #gl: WebGLRenderingContext | null = null
  #failed = false
  #relief: { prog: WebGLProgram; tex: WebGLTexture; fbo: WebGLFramebuffer; uRes: WebGLUniformLocation | null; uDpr: WebGLUniformLocation | null } | null = null
  #light: { prog: WebGLProgram; u: Record<string, WebGLUniformLocation | null>; sharp: WebGLTexture; soft: WebGLTexture } | null = null
  #sharp = document.createElement('canvas')
  #soft = document.createElement('canvas')
  #visible = false
  #raf = 0
  #w = 0
  #h = 0
  #dpr = 1
  #reliefDirty = true
  #maskDirty = true
  #strikes: Strike[] = []
  #branches: Branch[] = []
  #particles: Particle[] = []
  #lightAt = { x: 0, y: 0 }
  #lightTo = { x: 0, y: 0 }
  #impact = { x: 0, y: 0 }
  #flash = 0
  #shake = 0
  /** 0 = cracks showing, rising to 1 while they mend. */
  #fade = 0
  #mending = false
  #last = 0
  #reduce = false
  #cycle: ReturnType<typeof setTimeout> | null = null
  #onMove = (e: PointerEvent): void => { this.#lightTo = { x: e.clientX + PAD, y: e.clientY + PAD }; this.#wake() }
  #onResize = (): void => { this.#resize(); this.#wake() }

  get visible(): boolean { return this.#visible }

  /** Show the wall and start its cycle. False when it cannot draw (no
   *  WebGL); the body then keeps painting the plain surface. */
  show(): boolean {
    if (this.#failed) return false
    if (this.#visible) return true
    if (!this.#ensure()) return false
    this.#visible = true
    this.#root!.style.display = 'block'
    this.#reduce = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    window.addEventListener('pointermove', this.#onMove, { passive: true })
    window.addEventListener('resize', this.#onResize)
    this.#resize()
    this.#wake()
    this.#schedule(FIRST_DELAY)
    return true
  }

  hide(): void {
    if (!this.#visible) return
    this.#visible = false
    this.#stopCycle()
    if (this.#root) { this.#root.style.display = 'none'; this.#root.style.transform = '' }
    window.removeEventListener('pointermove', this.#onMove)
    window.removeEventListener('resize', this.#onResize)
    if (this.#raf) cancelAnimationFrame(this.#raf)
    this.#raf = 0
    // Leaving is a clean slate: the next time the wall shows, it opens unbroken.
    this.#clear()
  }

  /** One impact now, at a random place (or a given one, as fractions of the
   *  screen). Counts toward the cycle's three. */
  strike(x?: number, y?: number): void {
    if (!this.#visible) return
    if (this.#strikes.length >= MAX_STRIKES || this.#mending) this.#clear()
    this.#stopCycle()
    this.#land(x, y)
    this.#afterStrike()
  }

  /** Mend now: the cracks fade and the cycle starts over. */
  mend(): void {
    if (!this.#visible) return
    this.#stopCycle()
    this.#beginMend()
  }

  // ── the cycle ───────────────────────────────────────────────────────

  #schedule(delay: [number, number]): void {
    this.#stopCycle()
    this.#cycle = setTimeout(() => {
      this.#cycle = null
      if (!this.#visible) return
      this.#land()
      this.#afterStrike()
    }, between(delay))
  }

  #afterStrike(): void {
    if (this.#strikes.length < MAX_STRIKES) { this.#schedule(NEXT_DELAY); return }
    this.#cycle = setTimeout(() => { this.#cycle = null; this.#beginMend() }, HOLD_AFTER_LAST)
  }

  #beginMend(): void {
    if (!this.#strikes.length) { this.#schedule(FIRST_DELAY); return }
    this.#mending = true
    this.#wake()
  }

  #finishMend(): void {
    this.#clear()
    this.#schedule(REST_DELAY)
  }

  #stopCycle(): void {
    if (this.#cycle) clearTimeout(this.#cycle)
    this.#cycle = null
  }

  #clear(): void {
    this.#strikes = []
    this.#branches = []
    this.#particles = []
    this.#mending = false
    this.#fade = 0
    this.#paintMask()
    this.#wake()
  }

  /** Somewhere on the visible screen, kept off the very edges. */
  #land(x?: number, y?: number): void {
    const vw = this.#w - PAD * 2, vh = this.#h - PAD * 2
    const px = PAD + (x ?? .15 + Math.random() * .7) * vw
    const py = PAD + (y ?? .15 + Math.random() * .7) * vh
    const s: Strike = { x: px / this.#w, y: py / this.#h, seed: (Math.random() * 2 ** 31) | 0 }
    this.#strikes.push(s)
    this.#grow(s, !this.#reduce)
    if (this.#reduce) while (this.#branches.length) this.#step(999)
    this.#impact = { x: px, y: py }
    this.#flash = 1
    if (!this.#reduce) {
      this.#shake = 1
      this.#dust(px, py, 70)
      for (let i = 0; i < 18; i++) this.#chip(px, py, Math.random() * Math.PI * 2, 3)
    }
    this.#wake()
  }

  // ── setup ───────────────────────────────────────────────────────────

  #ensure(): boolean {
    if (this.#gl) return true
    let gl: WebGLRenderingContext | null = null
    const glc = document.createElement('canvas')
    try { gl = glc.getContext('webgl', { antialias: false, alpha: false, premultipliedAlpha: false }) } catch { gl = null }
    const probe = this.#sharp.getContext('2d') as CanvasRenderingContext2D | null
    if (!gl || !probe || typeof probe.drawImage !== 'function') { this.#failed = true; return false }

    const compile = (type: number, src: string): WebGLShader | null => {
      const sh = gl!.createShader(type)
      if (!sh) return null
      gl!.shaderSource(sh, src); gl!.compileShader(sh)
      return gl!.getShaderParameter(sh, gl!.COMPILE_STATUS) ? sh : null
    }
    const link = (fs: string): WebGLProgram | null => {
      const v = compile(gl!.VERTEX_SHADER, VS), f = compile(gl!.FRAGMENT_SHADER, fs)
      const p = gl!.createProgram()
      if (!v || !f || !p) return null
      gl!.attachShader(p, v); gl!.attachShader(p, f)
      gl!.bindAttribLocation(p, 0, 'p')
      gl!.linkProgram(p)
      return gl!.getProgramParameter(p, gl!.LINK_STATUS) ? p : null
    }
    const reliefProg = link(RELIEF_FS), lightProg = link(LIGHT_FS)
    if (!reliefProg || !lightProg) { this.#failed = true; return false }

    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)

    const texture = (): WebGLTexture => {
      const t = gl!.createTexture()!
      gl!.bindTexture(gl!.TEXTURE_2D, t)
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, gl!.LINEAR)
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, gl!.LINEAR)
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE)
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE)
      return t
    }
    this.#relief = {
      prog: reliefProg, tex: texture(), fbo: gl.createFramebuffer()!,
      uRes: gl.getUniformLocation(reliefProg, 'uRes'), uDpr: gl.getUniformLocation(reliefProg, 'uDpr'),
    }
    const u: Record<string, WebGLUniformLocation | null> = {}
    for (const k of ['uRes', 'uDpr', 'uLight', 'uImpact', 'uFlash', 'uFade', 'uRelief', 'uSharp', 'uSoft']) u[k] = gl.getUniformLocation(lightProg, k)
    this.#light = { prog: lightProg, u, sharp: texture(), soft: texture() }

    const root = document.createElement('div')
    root.id = 'hc-plaster'
    root.setAttribute('aria-hidden', 'true')
    Object.assign(root.style, { position: 'fixed', inset: `-${PAD}px`, zIndex: '-1', pointerEvents: 'none', display: 'none', overflow: 'hidden' })
    const fxc = document.createElement('canvas')
    for (const c of [glc, fxc]) Object.assign(c.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block' })
    root.append(glc, fxc)
    glc.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.#failed = true; this.hide() })
    document.body.appendChild(root)

    this.#root = root
    this.#glCanvas = glc
    this.#fxCanvas = fxc
    this.#fx = fxc.getContext('2d')
    this.#gl = gl
    return true
  }

  #resize(): void {
    if (!this.#glCanvas || !this.#fxCanvas) return
    const w = Math.max(1, Math.round(window.innerWidth + PAD * 2))
    const h = Math.max(1, Math.round(window.innerHeight + PAD * 2))
    const dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP)
    if (w === this.#w && h === this.#h && dpr === this.#dpr) return
    const first = this.#w === 0
    this.#w = w; this.#h = h; this.#dpr = dpr
    for (const c of [this.#glCanvas, this.#fxCanvas]) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr) }
    this.#sharp.width = this.#soft.width = w
    this.#sharp.height = this.#soft.height = h
    if (first) { this.#lightAt = { x: w * .32, y: h * .22 }; this.#lightTo = { ...this.#lightAt } }
    this.#reliefDirty = true
    // Replay every strike to completion: a seed and a point grow the same cracks.
    this.#branches = []
    this.#paintMask()
    for (const s of this.#strikes) { this.#grow(s, false); while (this.#branches.length) this.#step(999) }
  }

  #paintMask(): void {
    const c = this.#sharp.getContext('2d')
    if (!c) return
    c.fillStyle = '#000'
    c.fillRect(0, 0, this.#sharp.width, this.#sharp.height)
    this.#maskDirty = true
  }

  // ── crack growth ────────────────────────────────────────────────────

  #grow(s: Strike, live: boolean): void {
    const rnd = mulberry(s.seed)
    const x = s.x * this.#w, y = s.y * this.#h
    const reach = Math.hypot(this.#w, this.#h) * (.32 + rnd() * .2)
    const rays = 5 + Math.floor(rnd() * 5)
    const off = rnd() * Math.PI * 2
    for (let i = 0; i < rays; i++) {
      const a = off + i / rays * Math.PI * 2 + (rnd() - .5) * .9
      this.#branches.push({ x, y, a, a0: a, w: 3.4 + rnd() * 2.4, left: reach * (.45 + rnd() * .65), reach, rnd, live })
    }
    // a ring of hairlines spalled around the impact
    for (let i = 0; i < 14; i++) {
      const a = rnd() * Math.PI * 2, r0 = 5 + rnd() * 18
      const na = a + Math.PI / 2 + (rnd() - .5)
      this.#branches.push({ x: x + Math.cos(a) * r0, y: y + Math.sin(a) * r0, a: na, a0: na, w: .9, left: 10 + rnd() * 26, reach, rnd, live })
    }
  }

  #step(steps: number): void {
    const c = this.#sharp.getContext('2d')
    if (!c) { this.#branches = []; return }
    c.strokeStyle = c.fillStyle = '#fff'
    c.lineCap = 'round'
    c.lineJoin = 'miter'
    for (let k = 0; k < steps && this.#branches.length; k++) {
      const next: Branch[] = []
      for (const b of this.#branches) {
        const r = b.rnd
        const seg = 3 + r() * 4
        b.a += (r() - .5) * .7 + (b.a0 - b.a) * .08
        const nx = b.x + Math.cos(b.a) * seg, ny = b.y + Math.sin(b.a) * seg
        c.lineWidth = Math.max(.6, b.w)
        c.beginPath(); c.moveTo(b.x, b.y); c.lineTo(nx, ny); c.stroke()
        if (b.w > 1.4 && r() < .14) {                     // a chip off the lip
          const side = r() < .5 ? -1 : 1, pa = b.a + side * Math.PI / 2, cl = b.w * (1 + r() * 1.6)
          c.beginPath(); c.moveTo(b.x, b.y); c.lineTo(nx, ny)
          c.lineTo((b.x + nx) / 2 + Math.cos(pa) * cl, (b.y + ny) / 2 + Math.sin(pa) * cl)
          c.closePath(); c.fill()
          if (b.live && !this.#reduce && r() < .5) this.#chip(nx, ny, pa, b.w)
        }
        if (b.live && !this.#reduce && r() < .03) this.#dust(nx, ny, 2)
        b.x = nx; b.y = ny; b.left -= seg; b.w *= .987
        if (b.w > 1.1 && r() < .045) {
          const na = b.a + (r() < .5 ? -1 : 1) * (.45 + r() * .6)
          next.push({ ...b, a: na, a0: na, w: b.w * .58, left: b.left * (.35 + r() * .35) })
        }
        if (b.left > 0 && b.w > .45 && nx > -20 && ny > -20 && nx < this.#w + 20 && ny < this.#h + 20) next.push(b)
      }
      this.#branches = next
    }
    this.#maskDirty = true
  }

  #dust(x: number, y: number, n: number): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = Math.random() * 1.2
      this.#particles.push({ chip: false, x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - .3, life: 1, decay: .006 + Math.random() * .01, r: 1 + Math.random() * 2.5, rot: 0, vr: 0 })
    }
  }

  #chip(x: number, y: number, a: number, w: number): void {
    const s = 1.5 + Math.random() * 3.5
    this.#particles.push({ chip: true, x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 2, life: 1, decay: .012, r: 1.2 + w * .6 + Math.random() * 2, rot: Math.random() * 6, vr: (Math.random() - .5) * .4 })
  }

  // ── the loop: runs only while something moves ───────────────────────

  #wake(): void {
    if (!this.#visible || this.#raf) return
    this.#last = performance.now()
    this.#raf = requestAnimationFrame(this.#tick)
  }

  #tick = (now: number): void => {
    this.#raf = 0
    if (!this.#visible) return
    const dt = Math.min(50, now - this.#last) / 16.67
    this.#last = now

    if (this.#branches.length) this.#step(Math.max(1, Math.round(3 * dt)))

    const dx = this.#lightTo.x - this.#lightAt.x, dy = this.#lightTo.y - this.#lightAt.y
    const easing = Math.abs(dx) + Math.abs(dy) > .5
    if (easing) { this.#lightAt.x += dx * Math.min(1, .1 * dt); this.#lightAt.y += dy * Math.min(1, .1 * dt) }
    else this.#lightAt = { ...this.#lightTo }

    this.#flash = this.#flash > .004 ? this.#flash * Math.pow(.88, dt) : 0
    if (this.#shake > .01) {
      this.#shake *= Math.pow(.82, dt)
      const m = this.#shake * 7
      this.#root!.style.transform = `translate(${((Math.random() - .5) * m).toFixed(1)}px, ${((Math.random() - .5) * m).toFixed(1)}px)`
    } else if (this.#shake) { this.#shake = 0; this.#root!.style.transform = '' }

    let mended = false
    if (this.#mending) {
      this.#fade = Math.min(1, this.#fade + (16.67 * dt) / MEND_MS)
      if (this.#fade >= 1) mended = true
    }

    this.#draw()
    this.#drawDebris(dt)
    if (mended) this.#finishMend()

    if (easing || this.#branches.length || this.#particles.length || this.#flash || this.#shake || this.#mending) {
      this.#raf = requestAnimationFrame(this.#tick)
    }
  }

  #draw(): void {
    const gl = this.#gl, relief = this.#relief, light = this.#light, glc = this.#glCanvas
    if (!gl || !relief || !light || !glc) return
    const W = glc.width, H = glc.height

    if (this.#reliefDirty) {
      gl.bindTexture(gl.TEXTURE_2D, relief.tex)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
      gl.bindFramebuffer(gl.FRAMEBUFFER, relief.fbo)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, relief.tex, 0)
      gl.viewport(0, 0, W, H)
      gl.useProgram(relief.prog)
      gl.uniform2f(relief.uRes, W, H)
      gl.uniform1f(relief.uDpr, this.#dpr)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      this.#reliefDirty = false
    }

    if (this.#maskDirty) {
      const f = this.#soft.getContext('2d')
      if (f) {
        f.clearRect(0, 0, this.#soft.width, this.#soft.height)
        f.filter = 'blur(3.5px)'
        f.drawImage(this.#sharp, 0, 0)
        f.filter = 'none'
      }
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, light.sharp)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.#sharp)
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, light.soft)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.#soft)
      this.#maskDirty = false
    }

    gl.viewport(0, 0, W, H)
    gl.useProgram(light.prog)
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, relief.tex)
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, light.sharp)
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, light.soft)
    const u = light.u
    gl.uniform1i(u['uRelief'], 0); gl.uniform1i(u['uSharp'], 1); gl.uniform1i(u['uSoft'], 2)
    gl.uniform2f(u['uRes'], W, H)
    gl.uniform1f(u['uDpr'], this.#dpr)
    gl.uniform2f(u['uLight'], this.#lightAt.x, this.#lightAt.y)
    gl.uniform2f(u['uImpact'], this.#impact.x, this.#impact.y)
    gl.uniform1f(u['uFlash'], this.#flash)
    gl.uniform1f(u['uFade'], this.#fade)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  #drawDebris(dt: number): void {
    const fx = this.#fx
    if (!fx) return
    fx.setTransform(this.#dpr, 0, 0, this.#dpr, 0, 0)
    fx.clearRect(0, 0, this.#w, this.#h)
    if (!this.#particles.length) return
    this.#particles = this.#particles.filter(p => p.life > 0 && p.y < this.#h + 20)
    for (const p of this.#particles) {
      p.x += p.vx * dt; p.y += p.vy * dt; p.life -= p.decay * dt
      if (!p.chip) {
        p.vx *= .97; p.vy = p.vy * .97 + .015 * dt
        fx.fillStyle = `rgba(150,148,142,${(p.life * .35).toFixed(3)})`
        fx.beginPath(); fx.arc(p.x, p.y, p.r * (2 - p.life), 0, 7); fx.fill()
      } else {
        p.vy += .22 * dt; p.rot += p.vr * dt
        fx.save(); fx.translate(p.x, p.y); fx.rotate(p.rot)
        fx.fillStyle = `rgba(52,55,60,${Math.min(1, p.life * 1.4).toFixed(3)})`
        fx.strokeStyle = `rgba(120,122,126,${(p.life * .6).toFixed(3)})`
        fx.beginPath(); fx.moveTo(-p.r, -p.r * .6); fx.lineTo(p.r, -p.r * .3); fx.lineTo(p.r * .3, p.r); fx.closePath(); fx.fill(); fx.stroke()
        fx.restore()
      }
    }
  }
}
