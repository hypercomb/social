// meeting/hive/meeting-hive.view.ts
//
// z 59995: above the hive canvas (#pixi-host, 59989) and its banners, below
// the controls (59999) and the command line (60000), which stay usable.
//
// THE PARTICIPANTS' HIVE (jwize, 2026-11-02: "show a hive of just the
// participants and their videos, we can toggle that as we like"). One hexagon
// per person in the meeting, laid out the way the hive is: the leader in the
// middle, the ring around them in seat order. Each carries the person's video
// when it has arrived, else their seat and a mark. It sits just below the
// command line, which stays on top and usable, over the hive it hides; the
// meeting icon at the top toggles it.
//
// A reader of two effects and nothing else: `meeting:presence` (who sits
// where, who leads, who is you) and `meeting:streams` (the videos, in seat
// order). Its videos are muted: the sound is played once, by
// meeting-video.drone.ts, never twice.

import { EffectBus } from '@hypercomb/core'
import { showsPicture, watchPicture } from '../meeting-picture.js'

type Seat = { seat: number; id: string; you: boolean; leads: boolean; originator?: boolean }
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

const STYLES = `
${TAG}{position:fixed;left:var(--hc-controls-left,0px);right:var(--hc-inset-right,0px);bottom:0;top:calc(var(--hc-header-bottom,2.75rem) + 0.35rem);
  z-index:59995;display:none;pointer-events:auto;
  background:color-mix(in srgb, var(--hc-window-ground, #0d0f12) 82%, transparent);
  backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);
  color:var(--hc-window-ink, #f4f1ea);font:inherit;}
${TAG}[data-open="true"]{display:block;}
${TAG} .mh-stage{position:absolute;inset:0 0 3.4rem 0;overflow:hidden;}
${TAG} .mh-hex{position:absolute;width:var(--mh-w);height:calc(var(--mh-w) * 1.1547);
  transform:translate(-50%,-50%);clip-path:polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%);
  background:color-mix(in srgb, currentColor 10%, transparent);transition:left .35s ease, top .35s ease;}
${TAG} .mh-hex video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;}
${TAG} .mh-hex[data-leads="true"]{background:color-mix(in srgb, var(--hc-accent, #e0a440) 30%, transparent);}
${TAG} .mh-mark{position:absolute;inset:0;display:grid;place-items:center;font-size:calc(var(--mh-w) * 0.22);opacity:.55;}
${TAG} .mh-name{position:absolute;left:50%;bottom:16%;transform:translateX(-50%);white-space:nowrap;
  font-size:.72rem;letter-spacing:.02em;padding:.15em .55em;border-radius:999px;
  background:color-mix(in srgb, #000 55%, transparent);color:#fff;}
${TAG} .mh-foot{position:absolute;left:0;right:0;bottom:0;height:3.4rem;display:flex;align-items:center;gap:.6rem;
  padding:0 1rem;box-shadow:inset 0 1px 0 color-mix(in srgb, currentColor 14%, transparent);}
${TAG} .mh-note{flex:1;font-size:.8rem;opacity:.75;}
${TAG} .mh-btn{appearance:none;border:0;font:inherit;font-size:.82rem;cursor:pointer;padding:.45em .9em;border-radius:3px;
  background:color-mix(in srgb, currentColor 12%, transparent);color:inherit;}
${TAG} .mh-btn:hover{background:color-mix(in srgb, currentColor 20%, transparent);}
@media (prefers-reduced-motion: reduce){${TAG} .mh-hex{transition:none;}}
`

export class MeetingHiveElement extends HTMLElement {
  #stage!: HTMLElement
  #note!: HTMLElement
  #camera!: HTMLButtonElement
  #presence: Presence = {}
  #spend: Spend | null = null
  #streams = new Map<string, MediaStream>()
  #videos = new Map<string, HTMLVideoElement>()
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
    this.#stage = document.createElement('div')
    this.#stage.className = 'mh-stage'
    const foot = document.createElement('div')
    foot.className = 'mh-foot'
    this.#note = document.createElement('span')
    this.#note.className = 'mh-note'
    // Video is off by default: the camera is turned on here, by the person.
    this.#camera = this.#button(t('meeting.camera-on', 'camera on'), () => EffectBus.emitTransient('meeting:toggle-camera', {}))
    const copy = this.#button(t('meeting.copy-link', 'copy link'), () => EffectBus.emitTransient('meeting:copy-link', {}))
    const leave = this.#button(t('meeting.leave', 'leave'), () => EffectBus.emitTransient('meeting:leave', {}))
    const close = this.#button(t('meeting.hive-close', 'back to the hive'), () => EffectBus.emitTransient('meeting:view-toggle', { open: false }))
    foot.append(this.#note, this.#camera, copy, leave, close)
    this.replaceChildren(this.#stage, foot)

    this.#off.push(
      EffectBus.on<Presence>('meeting:presence', p => { this.#presence = p ?? {}; this.#paint() }),
      EffectBus.on<{ on?: boolean }>('meeting:local-camera', p => {
        const on = p?.on === true
        this.#camera.textContent = on ? t('meeting.camera-off', 'camera off') : t('meeting.camera-on', 'camera on')
        this.#camera.setAttribute('aria-pressed', String(on))
      }),
      EffectBus.on<{ streams?: Map<string, MediaStream> }>('meeting:streams', p => {
        this.#streams = p?.streams instanceof Map ? p.streams : new Map()
        this.#paint()
      }),
      EffectBus.on<Spend | null>('meeting:spend', p => { this.#spend = p ?? null; this.#paint() }),
    )
    window.addEventListener('resize', this.#resize)
    this.#paint()
  }

  disconnectedCallback(): void {
    for (const off of this.#off.splice(0)) off()
    window.removeEventListener('resize', this.#resize)
    for (const video of this.#videos.values()) video.srcObject = null
    this.#videos.clear()
  }

  set open(on: boolean) {
    this.dataset['open'] = String(on)
    if (on) this.#paint()
  }

  get open(): boolean { return this.dataset['open'] === 'true' }

  #button(label: string, act: () => void): HTMLButtonElement {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'mh-btn'
    b.textContent = label
    b.addEventListener('click', act)
    return b
  }

  /** One hexagon per seat, placed like the hive; the video where it is. */
  #paint(): void {
    if (!this.#stage || !this.open) return
    const seats: Seat[] = [...(this.#presence.seats ?? [])]
    // Anyone with a video but no seat yet (a beat behind) still shows.
    for (const id of this.#streams.keys()) {
      if (!seats.some(s => s.id === id)) seats.push({ seat: seats.length + 1, id, you: false, leads: false })
    }
    const rings = seats.length <= 1 ? 0 : seats.length <= 7 ? 1 : 2
    const box = this.#stage.getBoundingClientRect()
    const across = rings * 2 + 1
    const w = Math.max(80, Math.min(box.width / (across + 0.5), (box.height / (across * 0.75 + 0.5)) / 1.1547, 300))
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
        const mark = document.createElement('div')
        mark.className = 'mh-mark'
        const name = document.createElement('span')
        name.className = 'mh-name'
        hex.append(mark, name)
        this.#stage.append(hex)
      }
      hex.style.left = `${box.width / 2 + w * (q + r / 2)}px`
      hex.style.top = `${box.height / 2 + h * 0.75 * r}px`
      hex.dataset['leads'] = String(seat.leads)
      const who = seat.you ? t('meeting.you', 'you') : seat.id.slice(0, 6)
      const used = this.#spend?.byMember[seat.id]
      hex.querySelector('.mh-name')!.textContent =
        `${seat.seat} · ${who}${seat.leads ? ` · ${t('meeting.leads', 'leads')}` : ''}${used === undefined ? '' : ` · ${gbText(used)}`}`
      const stream = this.#streams.get(seat.id)
      let video = this.#videos.get(seat.id)
      // A face only where a picture is: a camera that is off still sends a
      // (muted) video track, and the seat stays until it carries frames.
      if (stream) watchPicture(stream, this.#resize)
      if (stream && showsPicture(stream)) {
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
        hex.querySelector<HTMLElement>('.mh-mark')!.textContent = seat.leads ? '★' : String(seat.seat)
      }
    })
    for (const hex of [...this.#stage.querySelectorAll<HTMLElement>('.mh-hex')]) {
      const id = hex.dataset['id'] ?? ''
      if (keep.has(id)) continue
      const video = this.#videos.get(id)
      if (video) { video.srcObject = null; this.#videos.delete(id) }
      hex.remove()
    }

    const n = seats.length
    this.#note.textContent = !this.#presence.joined
      ? t('meeting.hive-not-in', 'You are not in the meeting.')
      : n <= 1
        ? t('meeting.hive-alone', 'Only you so far. Copy the link to bring someone in.')
        : t('meeting.hive-count', `${n} in the meeting. Whoever is in the middle leads; the rest follow.`)
    const spend = this.#spend
    if (spend && this.#presence.joined) {
      const left = spend.leftGb > 0.001 ? ` (${gbText(spend.leftGb)} ${t('meeting.spend-left', 'from people who left')})` : ''
      this.#note.textContent += ` ${t('meeting.spend-meeting', 'Video this meeting')}: ${gbText(spend.meetingGb)}${left} · ` +
        `${t('meeting.spend-month', 'this month')}: ${gbText(spend.monthGb)} / ${gbText(spend.capGb)}.`
    }
  }
}

export const MEETING_HIVE_TAG = TAG
