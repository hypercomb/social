// diamondcoreprocessor.com/games/audio.ts
//
// Shared procedural WebAudio kit for the arcade games — the audio sibling of
// juice.ts. No asset files, no network: every sound is synthesized from
// oscillators + a shared noise buffer, so modules stay signature-clean.
//
// Lifecycle: construct once per overlay; call unlock() from the first user
// gesture (autoplay policy); dispose() on unmount (Chrome caps ~6 live
// AudioContexts per page, so overlays must not leak them). The mute toggle is
// a participant-local preference in localStorage — UI config, NOT layer state.

export interface ToneOpts {
  freq: number
  endFreq?: number
  type?: OscillatorType
  dur: number
  attack?: number
  vol?: number
  delay?: number
}

export interface NoiseOpts {
  dur: number
  vol?: number
  delay?: number
  filter?: BiquadFilterType
  freq?: number
  endFreq?: number
  q?: number
  attack?: number
}

const MASTER_LEVEL = 0.9
const VOICE_CAP = 14   // concurrent one-shots; extras are silently skipped

export class GameAudio {
  #ctx: AudioContext | null = null
  #master: GainNode | null = null
  #muted: boolean
  #muteKey: string
  #voices = 0
  #noiseBuf: AudioBuffer | null = null
  #ambience: { gain: GainNode; stops: (() => void)[]; timer: number } | null = null
  #onVisibility: (() => void) | null = null

  constructor(muteKey = 'hc:games-muted') {
    this.#muteKey = muteKey
    let saved = false
    try { saved = localStorage.getItem(muteKey) === '1' } catch { /* disabled */ }
    this.#muted = saved
  }

  get muted(): boolean { return this.#muted }

  toggleMuted(): boolean {
    this.#muted = !this.#muted
    try { localStorage.setItem(this.#muteKey, this.#muted ? '1' : '0') } catch { /* quota / disabled */ }
    if (this.#master && this.#ctx) {
      this.#master.gain.setTargetAtTime(this.#muted ? 0 : MASTER_LEVEL, this.#ctx.currentTime, 0.02)
    }
    return this.#muted
  }

  /** Create (or resume) the context — call from the FIRST user gesture. */
  unlock(): void {
    if (!this.#ctx) {
      try {
        this.#ctx = new AudioContext()
      } catch { return }
      const comp = this.#ctx.createDynamicsCompressor()
      comp.threshold.value = -18
      comp.ratio.value = 6
      comp.connect(this.#ctx.destination)
      this.#master = this.#ctx.createGain()
      this.#master.gain.value = this.#muted ? 0 : MASTER_LEVEL
      this.#master.connect(comp)
      this.#onVisibility = () => { if (document.visibilityState === 'visible') void this.#ctx?.resume() }
      document.addEventListener('visibilitychange', this.#onVisibility)
    }
    if (this.#ctx.state === 'suspended') void this.#ctx.resume()
  }

  /** One synthesized tone: oscillator + exponential envelope, auto-disconnect. */
  tone(o: ToneOpts): void {
    const ctx = this.#ctx, master = this.#master
    if (!ctx || !master || this.#muted || this.#voices >= VOICE_CAP) return
    const t0 = ctx.currentTime + (o.delay ?? 0)
    const osc = ctx.createOscillator()
    osc.type = o.type ?? 'sine'
    osc.frequency.setValueAtTime(Math.max(1, o.freq), t0)
    if (o.endFreq) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.endFreq), t0 + o.dur)
    const g = ctx.createGain()
    const vol = o.vol ?? 0.15
    const attack = o.attack ?? 0.005
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.linearRampToValueAtTime(vol, t0 + attack)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur)
    osc.connect(g)
    g.connect(master)
    this.#voices++
    osc.onended = () => { this.#voices--; osc.disconnect(); g.disconnect() }
    osc.start(t0)
    osc.stop(t0 + o.dur + 0.05)
  }

  /** Filtered noise burst from a shared buffer (impacts, sweeps, wind). */
  noise(o: NoiseOpts): void {
    const ctx = this.#ctx, master = this.#master
    if (!ctx || !master || this.#muted || this.#voices >= VOICE_CAP) return
    const t0 = ctx.currentTime + (o.delay ?? 0)
    const src = ctx.createBufferSource()
    src.buffer = this.#noise(ctx)
    src.loop = o.dur > 0.9
    let head: AudioNode = src
    if (o.filter) {
      const f = ctx.createBiquadFilter()
      f.type = o.filter
      f.frequency.setValueAtTime(o.freq ?? 800, t0)
      if (o.endFreq) f.frequency.exponentialRampToValueAtTime(Math.max(1, o.endFreq), t0 + o.dur)
      if (o.q) f.Q.value = o.q
      src.connect(f)
      head = f
    }
    const g = ctx.createGain()
    const vol = o.vol ?? 0.1
    const attack = o.attack ?? 0.005
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.linearRampToValueAtTime(vol, t0 + attack)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur)
    head.connect(g)
    g.connect(master)
    this.#voices++
    src.onended = () => { this.#voices--; src.disconnect(); g.disconnect() }
    src.start(t0)
    src.stop(t0 + o.dur + 0.05)
  }

  /** Momentarily dip the master level (a death "duck"), then recover. */
  duck(amount: number, secs: number): void {
    const ctx = this.#ctx, master = this.#master
    if (!ctx || !master || this.#muted) return
    const t = ctx.currentTime
    master.gain.cancelScheduledValues(t)
    master.gain.setTargetAtTime(MASTER_LEVEL * (1 - amount), t, 0.03)
    master.gain.setTargetAtTime(MASTER_LEVEL, t + secs * 0.4, secs * 0.3)
  }

  /** A quiet dungeon bed: a low detuned drone that slowly breathes, plus an
   *  occasional water drip or wind swell. Idempotent; `level` scales it. */
  startAmbience(o: { level?: number } = {}): void {
    const ctx = this.#ctx, master = this.#master
    if (!ctx || !master) return
    const level = o.level ?? 1
    if (this.#ambience) { this.#ambience.gain.gain.setTargetAtTime(0.05 * level, ctx.currentTime, 0.5); return }

    const bed = ctx.createGain()
    bed.gain.value = 0.05 * level
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 220
    lp.connect(bed)
    bed.connect(master)

    const stops: (() => void)[] = []
    const drone = (freq: number, type: OscillatorType, detune = 0): void => {
      const osc = ctx.createOscillator()
      osc.type = type
      osc.frequency.value = freq
      osc.detune.value = detune
      osc.connect(lp)
      osc.start()
      stops.push(() => { try { osc.stop() } catch { /* already */ } osc.disconnect() })
    }
    drone(55, 'sine')
    drone(82.5, 'triangle', 3)
    // slow breathing on the bed level
    const lfo = ctx.createOscillator()
    lfo.frequency.value = 0.07
    const lfoGain = ctx.createGain()
    lfoGain.gain.value = 0.015 * level
    lfo.connect(lfoGain)
    lfoGain.connect(bed.gain)
    lfo.start()
    stops.push(() => { try { lfo.stop() } catch { /* already */ } lfo.disconnect(); lfoGain.disconnect() })

    // an occasional drip or wind swell, forever alternating on a loose clock
    let tick = 0
    const schedule = (): number => window.setTimeout(() => {
      tick++
      if (this.#muted) { if (this.#ambience) this.#ambience.timer = schedule(); return }
      if (tick % 3 === 0) this.noise({ dur: 2.5, vol: 0.03 * level, attack: 1, filter: 'lowpass', freq: 400 })
      else {
        this.tone({ freq: 900, endFreq: 320, dur: 0.15, vol: 0.05 * level })
        this.tone({ freq: 900, endFreq: 320, dur: 0.15, vol: 0.02 * level, delay: 0.18 })
      }
      if (this.#ambience) this.#ambience.timer = schedule()
    }, 4000 + ((tick * 2617) % 7000))
    this.#ambience = { gain: bed, stops, timer: schedule() }
    stops.push(() => { lp.disconnect(); bed.disconnect() })
  }

  stopAmbience(): void {
    const a = this.#ambience
    if (!a) return
    this.#ambience = null
    clearTimeout(a.timer)
    for (const stop of a.stops) stop()
  }

  /** Full teardown for overlay unmount. */
  dispose(): void {
    this.stopAmbience()
    if (this.#onVisibility) { document.removeEventListener('visibilitychange', this.#onVisibility); this.#onVisibility = null }
    const ctx = this.#ctx
    this.#ctx = null
    this.#master = null
    this.#noiseBuf = null
    if (ctx) void ctx.close().catch(() => { /* already closed */ })
  }

  #noise(ctx: AudioContext): AudioBuffer {
    if (this.#noiseBuf) return this.#noiseBuf
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
    return this.#noiseBuf = buf
  }
}
