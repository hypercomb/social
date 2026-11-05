// meeting/hive/meeting-hive.view.ts
//
// z 59990: above the hive canvas (#pixi-host, 59989) and its banners, below
// the controls (59999) and the command line (60000), which stay usable.
// The flower dock sits inside this frame, above the speaker.
//
// THE PARTICIPANTS' FLOWER, docked on the left, and the speaker's rectangle
// filling the rest of the screen (jwize, 2026-11-03). Everyone in the meeting
// is a hexagon: their name, and their picture when they have one, until their
// camera is on. The person speaking is not a hexagon — they fill the screen
// as a rectangle. Clicking YOUR flower turns your camera on. Hovering it
// shows a camera, or an off control when the video is already on. The dock
// hides to an icon on the left edge. The speaker stays up.
//
// A reader of two effects and nothing else: `meeting:presence` (who sits
// where, who leads, who is you, the name and picture) and `meeting:streams`
// (the videos, in seat order). Its videos are muted: the sound is played
// once, by meeting-video.drone.ts, never twice.

import { EffectBus } from '@hypercomb/core'
import { speakerId } from '../meeting-feeds.js'
import { showsPicture, watchPicture } from '../meeting-picture.js'

type Seat = {
  seat: number
  id: string
  you: boolean
  leads: boolean
  originator?: boolean
  name?: string
  picture?: string
}
type Presence = { joined?: boolean; here?: number; seats?: readonly Seat[]; following?: string }
/** What the meeting's video has cost, from the meeting point's one ledger —
 *  every client in the meeting reads the same figures (hive-meeting.drone.ts). */
type Spend = { monthGb: number; capGb: number; meetingGb: number; byMember: Readonly<Record<string, number>>; leftGb: number }

/** GB as a person reads it: megabytes below a gigabyte. */
export const gbText = (gb: number): string =>
  gb < 0.001 ? '0 MB' : gb < 1 ? `${Math.round(gb * 1000)} MB` : `${gb < 10 ? gb.toFixed(2) : gb.toFixed(1)} GB`

const TAG = 'hc-meeting-hive'

const t = (key: string, fallback: string): string => {
  try {
    const said = (window as { ioc?: { get: <T>(k: string) => T | undefined } }).ioc
      ?.get<{ t?: (k: string) => string }>('@hypercomb.social/I18n')?.t?.(key)
    return typeof said === 'string' && said && said !== key ? said : fallback
  } catch { return fallback }
}

/** An address a flower may load: https, or http on this machine. */
const safePicture = (raw: string | undefined): string => {
  try {
    const url = new URL(String(raw ?? '').trim())
    if (url.protocol === 'https:') return url.href
    if (url.protocol === 'http:' && /^(localhost|127\.0\.0\.1|\[::1\])(?::|$)/.test(url.host)) return url.href
  } catch { /* not an address */ }
  return ''
}

const CAM_ON = '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path fill="currentColor" d="M8 7.5h6.2a1.6 1.6 0 0 1 1.6 1.6v5.8a1.6 1.6 0 0 1-1.6 1.6H8a1.6 1.6 0 0 1-1.6-1.6V9.1A1.6 1.6 0 0 1 8 7.5zm8.2 2.2 3.2-1.9v8.4l-3.2-1.9v-4.6z"/></svg>'
const CAM_OFF = '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path fill="currentColor" d="M8 7.5h6.2a1.6 1.6 0 0 1 1.6 1.6v.7l2.2-1.3v6.3l-1.5.9 1.4 1.4-1.2 1.2L4.2 5.4 5.4 4.2 8 6.8V7.5zm0 3.1v4.3h5.4l-5.4-5.4v1.1zm8.2-.9v3.2l2.2 2.2V9.7l-2.2 1.3V9.7z"/></svg>'

/** Seat index → axial position: the centre, then ring after ring, the same
 *  spiral meeting-video.drone.ts draws faces in. */
const axialOf = (index: number): { q: number; r: number } => {
  if (index === 0) return { q: 0, r: 0 }
  let ring = 1
  let total = 1
  while (total + ring * 6 <= index) { total += ring * 6; ring++ }
  const pos = index - total
  const side = Math.floor(pos / ring)
  const offset = pos % ring
  const dirs = [[1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1], [1, 0]] as const
  let q = 0
  let r = -ring
  for (let s = 0; s < side; s++) { q += dirs[s]![0] * ring; r += dirs[s]![1] * ring }
  q += dirs[side]![0] * offset
  r += dirs[side]![1] * offset
  return { q, r }
}

const LOUD_GATE = 0.06
const LOUD_HOLD_MS = 1500

const STYLES = `
${TAG}{position:fixed;left:0;right:0;top:var(--hc-header-bottom,2.75rem);bottom:0;z-index:59990;display:none;
  pointer-events:none;box-sizing:border-box;background:transparent;color:var(--hc-window-ink,#f4f1ea);font:inherit;}
${TAG}[data-open="true"]{display:block;}
${TAG} .mh-speaker{position:absolute;inset:0;background:#000;pointer-events:auto;overflow:hidden;}
${TAG} .mh-speaker[hidden]{display:none;}
${TAG} .mh-speaker video,${TAG} .mh-speaker .mh-speaker-portrait{position:absolute;inset:0;width:100%;height:100%;
  object-fit:contain;background:#000;}
${TAG} .mh-speaker-mark{position:absolute;inset:0;display:grid;place-items:center;font-size:4rem;color:#fff;opacity:.8;}
${TAG} .mh-speaker-name{position:absolute;left:calc(min(17.5rem,86vw) + 0.8rem);bottom:1rem;max-width:50vw;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.95rem;padding:.25em .7em;border-radius:999px;
  background:color-mix(in srgb,#000 55%,transparent);color:#fff;}
${TAG}[data-collapsed="true"] .mh-speaker-name{left:4rem;}
${TAG}:fullscreen .mh-speaker-name,${TAG} .mh-speaker:fullscreen .mh-speaker-name{left:1rem;bottom:1.2rem;}
${TAG} .mh-tab{display:none;position:absolute;left:var(--hc-controls-left,0px);top:.35rem;z-index:3;
  width:2.75rem;height:2.75rem;border-radius:999px;border:0;cursor:pointer;color:inherit;pointer-events:auto;
  background:color-mix(in srgb, var(--hc-window-ground, #0d0f12) 92%, transparent);
  box-shadow:0 4px 16px color-mix(in srgb, #000 35%, transparent);place-items:center;}
${TAG}[data-collapsed="true"] .mh-tab{display:grid;}
${TAG} .mh-dock{position:absolute;left:var(--hc-controls-left,0px);top:.35rem;bottom:.6rem;width:min(17.5rem,86vw);
  z-index:2;pointer-events:auto;display:flex;flex-direction:column;min-height:0;box-sizing:border-box;
  background:color-mix(in srgb, var(--hc-window-ground, #0d0f12) 88%, transparent);
  backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);
  border-right:1px solid color-mix(in srgb, currentColor 16%, transparent);
  box-shadow:4px 0 24px color-mix(in srgb, #000 28%, transparent);}
${TAG}[data-collapsed="true"] .mh-dock{display:none;}
${TAG} .mh-head{display:flex;align-items:center;gap:.4rem;padding:.45rem .6rem .2rem;}
${TAG} .mh-title{flex:1;font-size:.78rem;letter-spacing:.04em;text-transform:lowercase;opacity:.8;}
${TAG} .mh-hide{appearance:none;border:0;background:transparent;color:inherit;cursor:pointer;font:inherit;font-size:.78rem;opacity:.75;padding:.2rem .35rem;}
${TAG} .mh-hide:hover{opacity:1;}
${TAG} .mh-stage{position:relative;flex:1;min-height:0;overflow:hidden;}
${TAG} .mh-hex{position:absolute;width:var(--mh-w);height:calc(var(--mh-w) * 1.1547);
  transform:translate(-50%,-50%);clip-path:polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%);
  background:color-mix(in srgb, currentColor 10%, transparent);transition:left .35s ease, top .35s ease;}
${TAG} .mh-hex[data-you="true"][data-camera="off"]{cursor:pointer;}
${TAG} .mh-hex video,${TAG} .mh-portrait{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;}
${TAG} .mh-hex[data-leads="true"]{background:color-mix(in srgb, var(--hc-accent, #e0a440) 30%, transparent);}
${TAG} .mh-mark{position:absolute;inset:0;display:grid;place-items:center;font-size:calc(var(--mh-w) * 0.28);opacity:.7;}
${TAG} .mh-name{position:absolute;left:50%;bottom:14%;transform:translateX(-50%);max-width:86%;overflow:hidden;
  text-overflow:ellipsis;white-space:nowrap;font-size:.72rem;letter-spacing:.02em;padding:.15em .55em;border-radius:999px;
  background:color-mix(in srgb, #000 55%, transparent);color:#fff;}
${TAG} .mh-cam{position:absolute;left:50%;top:42%;transform:translate(-50%,-50%);width:2.6rem;height:2.6rem;
  display:none;place-items:center;border:0;border-radius:999px;cursor:pointer;color:#fff;padding:0;
  background:color-mix(in srgb, #000 62%, transparent);opacity:0;pointer-events:none;transition:opacity .15s ease;}
${TAG} .mh-hex[data-you="true"] .mh-cam{display:grid;}
${TAG} .mh-hex[data-you="true"]:hover .mh-cam,${TAG} .mh-hex[data-you="true"]:focus-within .mh-cam{opacity:1;pointer-events:auto;}
${TAG} .mh-foot{display:flex;flex-wrap:wrap;align-items:center;gap:.35rem;padding:.4rem .5rem .55rem;}
${TAG} .mh-note{flex:1 1 100%;font-size:.72rem;opacity:.75;line-height:1.35;}
${TAG} .mh-btn{appearance:none;border:0;font:inherit;font-size:.75rem;cursor:pointer;padding:.4em .7em;border-radius:3px;
  background:color-mix(in srgb, currentColor 12%, transparent);color:inherit;}
${TAG} .mh-btn:hover{background:color-mix(in srgb, currentColor 20%, transparent);}
@media (prefers-reduced-motion: reduce){${TAG} .mh-hex{transition:none;}}
`

export class MeetingHiveElement extends HTMLElement {
  #stage!: HTMLElement
  #note!: HTMLElement
  #full!: HTMLButtonElement
  #onFullscreen = (): void => {
    const on = !!document.fullscreenElement
    this.#full.textContent = on ? t('meeting.exit-full-screen', 'exit full screen') : t('meeting.full-screen', 'full screen')
    this.#full.setAttribute('aria-pressed', String(on))
  }
  #shared = false
  #presence: Presence = {}
  #spend: Spend | null = null
  #streams = new Map<string, MediaStream>()
  #videos = new Map<string, HTMLVideoElement>()
  #speaker!: HTMLElement
  #speakerVideo!: HTMLVideoElement
  #loudId = ''
  #loudAt = 0
  #audio: AudioContext | null = null
  #meters = new Map<string, { stream: MediaStream; source: MediaStreamAudioSourceNode; analyser: AnalyserNode }>()
  #loudTimer = 0
  #off: (() => void)[] = []
  #resize = (): void => this.#paint()

  connectedCallback(): void {
    if (!document.getElementById(`${TAG}-styles`)) {
      const style = document.createElement('style')
      style.id = `${TAG}-styles`
      style.textContent = STYLES
      document.head.append(style)
    }
    this.setAttribute('role', 'region')
    this.setAttribute('aria-label', t('meeting.hive', 'meeting'))
    const dock = document.createElement('div')
    dock.className = 'mh-dock'
    const head = document.createElement('div')
    head.className = 'mh-head'
    const title = document.createElement('span')
    title.className = 'mh-title'
    title.textContent = t('meeting.hive', 'meeting')
    const hide = document.createElement('button')
    hide.type = 'button'
    hide.className = 'mh-hide'
    hide.textContent = t('meeting.hive-hide', 'hide')
    hide.addEventListener('click', () => this.#collapse(true))
    head.append(title, hide)
    this.#stage = document.createElement('div')
    this.#stage.className = 'mh-stage'
    const foot = document.createElement('div')
    foot.className = 'mh-foot'
    this.#note = document.createElement('span')
    this.#note.className = 'mh-note'
    const copy = this.#button(t('meeting.copy-link', 'copy link'), () => EffectBus.emitTransient('meeting:copy-link', { how: 'copy' }))
    const share = this.#button(t('meeting.share-link', 'share link'), () => EffectBus.emitTransient('meeting:copy-link', { how: 'share' }))
    const leave = this.#button(t('meeting.leave', 'leave'), () => EffectBus.emitTransient('meeting:leave', {}))
    this.#full = this.#button(t('meeting.full-screen', 'full screen'), () => {
      if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => { /* not ours to leave */ })
      else void this.#speaker.requestFullscreen?.().catch(() => { /* refused: the rectangle stays in the page */ })
    })
    foot.append(this.#note, this.#full, copy, share, leave)
    dock.append(head, this.#stage, foot)
    const speaker = document.createElement('div')
    speaker.className = 'mh-speaker'
    speaker.hidden = true
    this.#speakerVideo = document.createElement('video')
    this.#speakerVideo.autoplay = true
    this.#speakerVideo.playsInline = true
    this.#speakerVideo.muted = true
    const speakerPortrait = document.createElement('img')
    speakerPortrait.className = 'mh-speaker-portrait'
    speakerPortrait.alt = ''
    speakerPortrait.hidden = true
    const speakerMark = document.createElement('div')
    speakerMark.className = 'mh-speaker-mark'
    const speakerName = document.createElement('span')
    speakerName.className = 'mh-speaker-name'
    speaker.append(this.#speakerVideo, speakerPortrait, speakerMark, speakerName)
    this.#speaker = speaker
    const tab = document.createElement('button')
    tab.type = 'button'
    tab.className = 'mh-tab'
    tab.innerHTML = CAM_ON
    tab.setAttribute('aria-label', t('meeting.hive-show', 'Show the meeting'))
    tab.addEventListener('click', () => this.#collapse(false))
    this.replaceChildren(speaker, dock, tab)
    this.#loudTimer = window.setInterval(this.#pollLoud, 200)

    this.#off.push(
      EffectBus.on<Presence>('meeting:presence', p => { this.#presence = p ?? {}; this.#paint() }),
      EffectBus.on<{ on?: boolean }>('meeting:local-camera', p => {
        this.#shared = p?.on === true
        this.#paint()
      }),
      EffectBus.on<{ streams?: Map<string, MediaStream> }>('meeting:streams', p => {
        this.#streams = p?.streams instanceof Map ? p.streams : new Map()
        this.#paint()
      }),
      EffectBus.on<Spend | null>('meeting:spend', p => { this.#spend = p ?? null; this.#paint() }),
    )
    window.addEventListener('resize', this.#resize)
    document.addEventListener('fullscreenchange', this.#onFullscreen)
    this.#onFullscreen()
    this.#holdBand(false)
    this.#paint()
  }

  disconnectedCallback(): void {
    for (const off of this.#off.splice(0)) off()
    window.removeEventListener('resize', this.#resize)
    document.removeEventListener('fullscreenchange', this.#onFullscreen)
    window.clearInterval(this.#loudTimer)
    for (const video of this.#videos.values()) video.srcObject = null
    this.#videos.clear()
    this.#speakerVideo.srcObject = null
    for (const id of [...this.#meters.keys()]) this.#dropMeter(id)
    void this.#audio?.close().catch(() => { /* already closed */ })
    this.#audio = null
    this.#holdBand(false)
  }

  set open(on: boolean) {
    this.dataset['open'] = String(on)
    if (on) this.dataset['collapsed'] = 'false'
    this.#holdBand(false)
    if (on) requestAnimationFrame(() => this.#paint())
  }

  /** The flower is a left dock, so it no longer holds a band along the bottom. */
  #holdBand(_on: boolean): void {
    try {
      if (document.documentElement.style.getPropertyValue('--hc-band-bottom')) {
        document.documentElement.style.setProperty('--hc-band-bottom', '0px')
      }
    } catch { /* no document */ }
  }

  get open(): boolean { return this.dataset['open'] === 'true' }

  #collapse(on: boolean): void {
    this.dataset['collapsed'] = String(on)
    if (!on) requestAnimationFrame(() => this.#paint())
  }

  #button(label: string, act: () => void): HTMLButtonElement {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'mh-btn'
    b.textContent = label
    b.addEventListener('click', act)
    return b
  }

  /** The loudest other voice, held for a moment after they stop so the
   *  screen does not flicker between people. */
  #pollLoud = (): void => {
    if (!this.open) return
    const you = this.#presence.seats?.find(seat => seat.you)?.id ?? ''
    let best = ''
    let bestLevel = 0
    const live = new Set<string>()
    for (const [id, stream] of this.#streams) {
      if (id === you || !stream.getAudioTracks().some(track => track.readyState === 'live')) continue
      live.add(id)
      const level = this.#level(id, stream)
      if (level > bestLevel) { bestLevel = level; best = id }
    }
    for (const id of [...this.#meters.keys()]) if (!live.has(id)) this.#dropMeter(id)
    const now = performance.now()
    if (best && bestLevel >= LOUD_GATE) {
      this.#loudAt = now
      if (this.#loudId !== best) { this.#loudId = best; this.#paint() }
    } else if (this.#loudId && now - this.#loudAt > LOUD_HOLD_MS) {
      this.#loudId = ''
      this.#paint()
    }
  }

  #level(id: string, stream: MediaStream): number {
    const Ctx = window.AudioContext
    if (!Ctx) return 0
    if (!this.#audio) this.#audio = new Ctx()
    if (this.#audio.state === 'suspended') void this.#audio.resume().catch(() => { /* needs a gesture */ })
    let meter = this.#meters.get(id)
    if (meter && meter.stream !== stream) { this.#dropMeter(id); meter = undefined }
    if (!meter) {
      try {
        const source = this.#audio.createMediaStreamSource(stream)
        const analyser = this.#audio.createAnalyser()
        analyser.fftSize = 256
        source.connect(analyser)
        meter = { stream, source, analyser }
        this.#meters.set(id, meter)
      } catch { return 0 }
    }
    const data = new Uint8Array(meter.analyser.fftSize)
    meter.analyser.getByteTimeDomainData(data)
    let sum = 0
    for (let i = 0; i < data.length; i++) {
      const v = ((data[i] ?? 128) - 128) / 128
      sum += v * v
    }
    return Math.sqrt(sum / data.length)
  }

  #dropMeter(id: string): void {
    const meter = this.#meters.get(id)
    if (!meter) return
    try { meter.source.disconnect() } catch { /* already gone */ }
    this.#meters.delete(id)
  }

  /** The speaker, as a rectangle. A picture until their camera is on. */
  #paintSpeaker(seats: readonly Seat[]): void {
    const speaker = this.#speaker
    if (!speaker) return
    const id = speakerId(seats, this.#loudId)
    const seat = seats.find(item => item.id === id)
    if (!seat) { speaker.hidden = true; this.#speakerVideo.srcObject = null; return }
    speaker.hidden = false
    const who = seat.name?.trim() || (seat.you ? t('meeting.you', 'you') : seat.id.slice(0, 6))
    const lead = seat.leads ? ` · ${t('meeting.leads', 'leads')}` : ''
    speaker.querySelector('.mh-speaker-name')!.textContent = `${who}${lead}`
    const stream = this.#streams.get(seat.id)
    const picture = !!(stream && showsPicture(stream))
    const portrait = speaker.querySelector<HTMLImageElement>('.mh-speaker-portrait')!
    const mark = speaker.querySelector<HTMLElement>('.mh-speaker-mark')!
    if (picture && stream) {
      if (this.#speakerVideo.srcObject !== stream) {
        this.#speakerVideo.srcObject = stream
        void this.#speakerVideo.play().catch(() => { /* autoplay */ })
      }
      this.#speakerVideo.hidden = false
      portrait.hidden = true
      portrait.removeAttribute('src')
      mark.textContent = ''
      return
    }
    this.#speakerVideo.srcObject = null
    this.#speakerVideo.hidden = true
    const face = safePicture(seat.picture)
    if (face) {
      if (portrait.getAttribute('src') !== face) portrait.src = face
      portrait.hidden = false
      mark.textContent = ''
    } else {
      portrait.removeAttribute('src')
      portrait.hidden = true
      mark.textContent = who.slice(0, 1).toUpperCase() || String(seat.seat)
    }
  }

  /** One hexagon per seat, placed like the hive; the video where it is. */
  #paint(): void {
    if (!this.#stage || !this.open) return
    const seats: Seat[] = [...(this.#presence.seats ?? [])]
    for (const id of this.#streams.keys()) {
      if (!seats.some(s => s.id === id)) seats.push({ seat: seats.length + 1, id, you: false, leads: false })
    }
    this.#paintSpeaker(seats)
    if (this.dataset['collapsed'] === 'true') return
    const rings = seats.length <= 1 ? 0 : seats.length <= 7 ? 1 : 2
    const box = this.#stage.getBoundingClientRect()
    if (box.width < 8 || box.height < 8) return
    const across = rings * 2 + 1
    const fit = Math.min(box.width / (across + 0.6), (box.height / (across * 0.75 + 0.6)) / 1.1547, 168)
    const w = Math.max(28, fit)
    this.style.setProperty('--mh-w', `${w}px`)
    const h = w * 1.1547

    const keep = new Set<string>()
    seats.forEach((seat, index) => {
      keep.add(seat.id)
      const { q, r } = axialOf(index)
      let hex = this.#stage.querySelector<HTMLElement>(`.mh-hex[data-id="${CSS.escape(seat.id)}"]`)
      if (!hex) {
        hex = document.createElement('div')
        hex.className = 'mh-hex'
        hex.dataset['id'] = seat.id
        const portrait = document.createElement('img')
        portrait.className = 'mh-portrait'
        portrait.alt = ''
        portrait.hidden = true
        const mark = document.createElement('div')
        mark.className = 'mh-mark'
        const name = document.createElement('span')
        name.className = 'mh-name'
        const cam = document.createElement('button')
        cam.type = 'button'
        cam.className = 'mh-cam'
        cam.addEventListener('click', event => {
          event.stopPropagation()
          if (hex!.dataset['you'] !== 'true') return
          EffectBus.emitTransient('meeting:toggle-camera', {})
        })
        hex.addEventListener('click', () => {
          if (hex!.dataset['you'] !== 'true' || hex!.dataset['camera'] === 'on') return
          EffectBus.emitTransient('meeting:toggle-camera', {})
        })
        hex.append(portrait, mark, name, cam)
        this.#stage.append(hex)
      }
      hex.style.left = `${box.width / 2 + w * (q + r / 2)}px`
      hex.style.top = `${box.height / 2 + h * 0.75 * r}px`
      hex.dataset['leads'] = String(seat.leads)
      hex.dataset['you'] = String(seat.you)
      const camera = seat.you && this.#shared ? 'on' : 'off'
      hex.dataset['camera'] = seat.you ? camera : 'off'
      const who = seat.name?.trim() || (seat.you ? t('meeting.you', 'you') : seat.id.slice(0, 6))
      const used = this.#spend?.byMember[seat.id]
      const lead = seat.leads ? ` · ${t('meeting.leads', 'leads')}` : ''
      const spend = used === undefined ? '' : ` · ${gbText(used)}`
      hex.querySelector('.mh-name')!.textContent = `${who}${lead}${spend}`
      const stream = this.#streams.get(seat.id)
      let video = this.#videos.get(seat.id)
      if (stream) watchPicture(stream, this.#resize)
      const picture = stream && showsPicture(stream)
      const portrait = hex.querySelector<HTMLImageElement>('.mh-portrait')!
      const face = picture ? '' : safePicture(seat.picture)
      if (face) {
        if (portrait.getAttribute('src') !== face) portrait.src = face
        portrait.hidden = false
      } else {
        portrait.removeAttribute('src')
        portrait.hidden = true
      }
      if (picture && stream) {
        if (!video) {
          video = document.createElement('video')
          video.autoplay = true
          video.playsInline = true
          video.muted = true
          hex.prepend(video)
          this.#videos.set(seat.id, video)
        }
        if (video.srcObject !== stream) { video.srcObject = stream; void video.play().catch(() => { /* autoplay */ }) }
        hex.querySelector<HTMLElement>('.mh-mark')!.textContent = ''
      } else {
        if (video) { video.srcObject = null; video.remove(); this.#videos.delete(seat.id) }
        hex.querySelector<HTMLElement>('.mh-mark')!.textContent = face ? '' : (who.slice(0, 1).toUpperCase() || String(seat.seat))
      }
      const cam = hex.querySelector<HTMLButtonElement>('.mh-cam')!
      const mode = seat.you && this.#shared ? 'off' : 'on'
      if (seat.you && cam.dataset['mode'] !== mode) {
        cam.dataset['mode'] = mode
        cam.innerHTML = mode === 'off' ? CAM_OFF : CAM_ON
        cam.setAttribute('aria-label', mode === 'off' ? t('meeting.camera-off', 'Turn your camera off') : t('meeting.camera-on', 'Turn your camera on'))
      }
      cam.hidden = !seat.you
    })
    for (const hex of [...this.#stage.querySelectorAll<HTMLElement>('.mh-hex')]) {
      const id = hex.dataset['id'] ?? ''
      if (keep.has(id)) continue
      const video = this.#videos.get(id)
      if (video) { video.srcObject = null; this.#videos.delete(id) }
      hex.remove()
    }

    const n = seats.length
    const count = !this.#presence.joined
      ? t('meeting.hive-not-in', 'You are not in the meeting.')
      : n <= 1
        ? t('meeting.hive-alone', 'Only you so far. Copy the link to bring someone in.')
        : `${n} in the meeting.`
    const hint = this.#presence.joined && !this.#shared ? ` ${t('meeting.hive-camera-hint', 'Click your flower to turn your camera on.')}` : ''
    this.#note.textContent = `${count}${hint}`
    const spend = this.#spend
    if (spend && this.#presence.joined) {
      const left = spend.leftGb > 0.001 ? ` (${gbText(spend.leftGb)} ${t('meeting.spend-left', 'from people who left')})` : ''
      this.#note.textContent += ` ${t('meeting.spend-meeting', 'Video this meeting')}: ${gbText(spend.meetingGb)}${left}.`
    }
  }
}

export const MEETING_HIVE_TAG = TAG
