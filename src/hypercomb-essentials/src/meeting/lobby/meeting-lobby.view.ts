// meeting/lobby/meeting-lobby.view.ts
//
// THE MEETING LOBBY: where you check yourself before you walk in. The same desk
// as the tile editor — its slim header, one box, no border — with a single
// hexagon in the middle showing your camera exactly as the hive will cut it,
// and beside it the few choices that matter: which camera, which microphone,
// how sharp. Underneath, the 1+6 circle fills as the others arrive.
//
// Joining hands the camera that is already open to the hive drone, so there is
// no second permission prompt and no gap where the picture drops out: what you
// saw is what is sent. Closing without joining lets the camera go.
//
// This file is the piecing together; the decisions that need no browser live in
// ./lobby-media.ts and the numbers behind the three pictures in ../meeting-quality.ts.

import {
  EffectBus,
  I18N_IOC_KEY,
  attachDockedPanel,
  type DockedPanel,
  type I18nProvider,
  type WindowSession,
} from '@hypercomb/core'
import { QUALITIES, describeQuality, qualityConstraints, type Devices, type Quality } from '../meeting-quality.js'
import { deviceLabel, failureOf, levelOf, seatPositions, seatsTaken, type Failure } from './lobby-media.js'
import { installMeetingLobbyStyles } from './meeting-lobby.styles.js'
import { closeWhenDark, refuseWhileDark } from '../../commands/word-enablement.js'

const LOBBY = 'meeting-lobby'
/** The word this desk belongs to: its light is the desk's (commands/word-enablement.ts). */
const WORD = 'meeting'
const KEYS = {
  modes: '@diamondcoreprocessor.com/ModeRegistry',
  back: '@diamondcoreprocessor.com/BackGesture',
  gate: '@diamondcoreprocessor.com/InputGate',
  invite: '@diamondcoreprocessor.com/InviteQueenBee',
} as const

/** Narrower than this and the desk is one column. */
const NARROW_PX = 640

type State = 'asking' | 'live' | Failure
type ModesShape = { enter(mode: string, owner: string): void; exit(mode: string, owner: string): void; releaseOwner?(owner: string): void }
type BackShape = { register(entry: { owner: string; back: () => void; active?: () => boolean }): () => void }
type GateShape = { lock(reason: string): void; unlock(reason: string): void }
type Say = (key: string, fallback: string, params?: Record<string, string | number>) => string

const ioc = <T,>(key: string): T | undefined =>
  (window as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.(key) as T | undefined

const t: Say = (key, fallback, params) => {
  const fill = (text: string): string =>
    params ? text.replace(/\{(\w+)\}/g, (whole, name) => String(params[name] ?? whole)) : text
  try {
    const text = ioc<I18nProvider>(I18N_IOC_KEY)?.t?.(key, params)
    return text && text !== key ? text : fill(fallback)
  } catch { return fill(fallback) }
}

const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text) node.textContent = text
  return node
}

const glyph = (name: string, className = 'mat-sym'): HTMLElement => {
  const node = make('span', className, name)
  node.setAttribute('aria-hidden', 'true')
  return node
}

const stop = (stream: MediaStream | null): void => {
  for (const track of stream?.getTracks() ?? []) track.stop()
}

/** Pointy-top hexagon corners, the same cut the hive's face mask uses. */
const hexPoints = (cx: number, cy: number, radius: number): string =>
  Array.from({ length: 6 }, (_, i) => {
    const angle = (Math.PI / 3) * i - Math.PI / 6
    return `${(cx + Math.cos(angle) * radius).toFixed(2)},${(cy + Math.sin(angle) * radius).toFixed(2)}`
  }).join(' ')

const SAYINGS: Readonly<Record<Exclude<State, 'live'>, { mark: string; key: string; fallback: string }>> = {
  asking: { mark: 'videocam', key: 'meeting.lobby-asking', fallback: 'Starting your camera…' },
  blocked: { mark: 'lock', key: 'meeting.lobby-blocked', fallback: 'Camera access is blocked. Allow it in the address bar, then try again.' },
  missing: { mark: 'videocam_off', key: 'meeting.lobby-missing', fallback: 'No camera was found.' },
  busy: { mark: 'videocam_off', key: 'meeting.lobby-busy', fallback: 'Another app is using your camera. Close it, then try again.' },
  error: { mark: 'error', key: 'meeting.lobby-error', fallback: 'The camera could not start.' },
}

const QUALITY_WORDS: Readonly<Record<Quality, { key: string; fallback: string }>> = {
  saver: { key: 'meeting.lobby-saver', fallback: 'Saver' },
  auto: { key: 'meeting.lobby-auto', fallback: 'Auto' },
  sharp: { key: 'meeting.lobby-sharp', fallback: 'Sharp' },
}

/** The view's IoC face: the shell's surface host makes the element, so a wish
 *  to open can come before the element does. */
export const meetingLobbyFacade = {
  current: null as MeetingLobbyElement | null,
  wanted: false,
  cell: '',
  open(cell: string): void {
    facade.cell = cell
    facade.wanted = true
    facade.current?.open()
  },
}
const facade = meetingLobbyFacade

export class MeetingLobbyElement extends HTMLElement {

  #panel: HTMLElement | null = null
  #dock: DockedPanel | null = null
  #modes: ModesShape | null = null
  #releaseBack: (() => void) | null = null
  #openCleanup: (() => void)[] = []
  /** Releases the desk's hold on its word's light. */
  #offWord: (() => void) | null = null

  #ring!: HTMLElement
  #video!: HTMLVideoElement
  #say!: HTMLElement
  #sayMark!: HTMLElement
  #sayText!: HTMLElement
  #retry!: HTMLButtonElement
  #sub!: HTMLElement
  #address!: HTMLElement
  #cameraSelect!: HTMLSelectElement
  #micSelect!: HTMLSelectElement
  #meterFill!: HTMLElement
  #hint!: HTMLElement
  #seats: SVGPolygonElement[] = []
  #hereCount!: HTMLElement
  #hereNote!: HTMLElement
  #join!: HTMLButtonElement
  #live!: HTMLElement
  #choices = new Map<Quality, HTMLButtonElement>()

  #state: State = 'asking'
  #quality: Quality = 'auto'
  #devices: Devices = {}
  /** The open camera. Null once it has been handed to the hive. */
  #stream: MediaStream | null = null
  /** Bumped by anything that starts or ends a preview, so an older open cannot land. */
  #attempt = 0
  #audio: { ctx: AudioContext; raf: number } | null = null
  #here = 0
  #needed = 7
  /** Whether this tab is in a swarm at all — the meeting is the swarm's. */
  #inSwarm = true
  /** The room's behaviour requirements, and which of them this person allows. */
  #rules: string[] = ['go']
  #allowed = new Set<string>(['go'])
  #rulesBox!: HTMLElement
  #parked = false

  readonly #session: WindowSession = {
    park: () => { this.#parked = true; this.#close() },
    unpark: () => { if (this.#parked) { this.#parked = false; this.open() } },
    dismiss: () => false,
    close: () => this.#close(),
  }

  connectedCallback(): void {
    installMeetingLobbyStyles()
    facade.current = this
    // THE DESK IS PART OF ITS WORD (commands/word-enablement.ts): switched
    // off in Beehaviors, it closes, and a desk put away stays away.
    this.#offWord = closeWhenDark(WORD, () => { this.#parked = false; this.#close() })
    if (facade.wanted) this.open()
  }

  disconnectedCallback(): void {
    this.#offWord?.()
    this.#offWord = null
    if (this.#panel) this.#teardown()
    if (facade.current === this) facade.current = null
  }

  open(): void {
    // Every door asks first — the word, a tile's join, a return home.
    if (!this.#panel && refuseWhileDark(WORD)) { facade.wanted = false; return }
    facade.wanted = true
    if (this.#panel) { this.#address.textContent = facade.cell; return }
    this.#build()
    void this.#acquire()
  }

  // ── the desk ──────────────────────────────────────────────────

  #build(): void {
    const panel = make('div', 'ml-panel')
    panel.tabIndex = -1
    panel.setAttribute('role', 'dialog')
    panel.setAttribute('aria-label', t('meeting.title', 'meeting'))
    panel.dataset['hcSheet'] = 'full'
    this.#panel = panel

    const body = make('div', 'ml-body')
    body.append(this.#buildStage(), this.#buildSide())

    const live = make('div', 'ml-live')
    live.setAttribute('role', 'status')
    this.#live = live
    panel.append(this.#buildHeader(), body, this.#buildFoot(), live)
    this.appendChild(panel)

    this.#dock = attachDockedPanel(panel, {
      id: LOBBY,
      dockSide: 'right',
      dockExclusive: false,
      ownsSize: false,
      sizeOwner: { panelWidth: () => 400, setPanelWidth: () => undefined },
      defaultText: 1,
      hcSession: this.#session,
      onClose: () => this.#close(),
    })

    this.#claimModes(panel)
    // Held for the whole session: a key typed into a list must not reach the hive.
    EffectBus.emit('keymap:suppress', { reason: LOBBY })
    ioc<GateShape>(KEYS.gate)?.lock(LOBBY)
    this.#releaseBack = ioc<BackShape>(KEYS.back)?.register({
      owner: LOBBY,
      active: () => this.#panel !== null,
      back: () => this.#close(),
    }) ?? null

    panel.addEventListener('keydown', this.#onKeyDown)
    this.#openCleanup.push(
      () => panel.removeEventListener('keydown', this.#onKeyDown),
      EffectBus.on<{ here?: number; needed?: number; swarm?: boolean; rules?: unknown }>('meeting:presence', payload => {
        this.#here = Math.max(0, Number(payload?.here ?? 0))
        this.#needed = Math.max(1, Number(payload?.needed ?? 7))
        this.#inSwarm = payload?.swarm !== false
        const rules = Array.isArray(payload?.rules) ? payload.rules.map(String).filter(Boolean) : ['go']
        // A word the room newly asks for starts allowed; one it stopped asking for is forgotten.
        for (const rule of rules) if (!this.#rules.includes(rule)) this.#allowed.add(rule)
        this.#rules = rules
        for (const rule of [...this.#allowed]) if (!rules.includes(rule)) this.#allowed.delete(rule)
        this.#paintRules()
        this.#paintPresence()
      }),
    )

    const media = navigator.mediaDevices
    if (media?.addEventListener) {
      const changed = (): void => { void this.#listDevices() }
      media.addEventListener('devicechange', changed)
      this.#openCleanup.push(() => media.removeEventListener('devicechange', changed))
    }

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => { panel.dataset['layout'] = panel.clientWidth < NARROW_PX ? 'narrow' : 'wide' })
      observer.observe(panel)
      this.#openCleanup.push(() => observer.disconnect())
    }
    panel.dataset['layout'] = 'wide'

    this.#paintChoices()
    this.#paintPresence()
    this.#setState('asking')
    requestAnimationFrame(() => { if (this.#panel === panel) panel.focus({ preventScroll: true }) })
  }

  #buildHeader(): HTMLElement {
    const head = make('header', 'ml-head')
    const address = make('span', 'ml-address', facade.cell)
    this.#address = address

    const close = make('button', 'ml-icon-btn close')
    close.type = 'button'
    close.setAttribute('aria-label', t('meeting.lobby-close', 'close'))
    close.title = t('meeting.lobby-close', 'close')
    close.append(glyph('close'))
    close.addEventListener('click', () => this.#close())

    head.append(make('span', 'ml-reading', t('meeting.title', 'meeting')), address, make('span', 'ml-grow'), close)
    return head
  }

  /** The hexagon, and what is said under it. */
  #buildStage(): HTMLElement {
    const stage = make('section', 'ml-stage')

    const ring = make('div', 'ml-hex-ring')
    const hex = make('div', 'ml-hex')
    const video = make('video', 'ml-video')
    video.muted = true
    video.autoplay = true
    video.playsInline = true
    video.setAttribute('aria-label', t('meeting.lobby-preview', 'Your camera'))

    const say = make('div', 'ml-say')
    const mark = glyph('videocam', 'mat-sym ml-say-mark')
    const text = make('p', 'ml-say-text')
    const retry = make('button', 'ml-btn', t('meeting.lobby-retry', 'try again'))
    retry.type = 'button'
    retry.addEventListener('click', () => void this.#acquire())
    say.append(mark, text, retry)

    hex.append(video, say)
    ring.append(hex)
    this.#ring = ring
    this.#video = video
    this.#say = say
    this.#sayMark = mark
    this.#sayText = text
    this.#retry = retry

    const caption = make('div', 'ml-caption')
    const sub = make('p', 'ml-sub')
    this.#sub = sub
    caption.append(make('h2', 'ml-title', t('meeting.lobby-title', 'Ready to join?')), sub)

    stage.append(ring, caption)
    return stage
  }

  #buildSide(): HTMLElement {
    const side = make('section', 'ml-side')

    const cameraSelect = make('select', 'ml-select')
    cameraSelect.id = 'ml-camera'
    cameraSelect.addEventListener('change', () => {
      this.#devices = { ...this.#devices, camera: cameraSelect.value || undefined }
      void this.#acquire()
    })
    this.#cameraSelect = cameraSelect

    const micSelect = make('select', 'ml-select')
    micSelect.id = 'ml-microphone'
    micSelect.addEventListener('change', () => {
      this.#devices = { ...this.#devices, microphone: micSelect.value || undefined }
      void this.#acquire()
    })
    this.#micSelect = micSelect

    const meter = make('div', 'ml-meter')
    meter.setAttribute('aria-hidden', 'true')
    const fill = make('div', 'ml-meter-fill')
    meter.append(fill)
    this.#meterFill = fill

    const group = make('div', 'ml-choices')
    group.setAttribute('role', 'radiogroup')
    group.setAttribute('aria-label', t('meeting.lobby-picture', 'Picture'))
    for (const quality of QUALITIES) {
      const word = QUALITY_WORDS[quality]
      const button = make('button', 'ml-choice', t(word.key, word.fallback))
      button.type = 'button'
      button.setAttribute('role', 'radio')
      button.addEventListener('click', () => this.#choose(quality))
      this.#choices.set(quality, button)
      group.append(button)
    }
    group.addEventListener('keydown', event => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      event.preventDefault()
      const at = QUALITIES.indexOf(this.#quality)
      const next = QUALITIES[(at + (event.key === 'ArrowRight' ? 1 : QUALITIES.length - 1)) % QUALITIES.length]
      this.#choose(next)
      this.#choices.get(next)?.focus()
    })
    const hint = make('p', 'ml-hint')
    this.#hint = hint

    // THE ROOM'S BEHAVIOUR REQUIREMENTS: the words the leader's lines use.
    // Each one is allowed or not, here, before joining; a line whose word is
    // allowed runs on its own, one that is not is dropped, and a word the room
    // never stated waits on your `$` line.
    const rulesBox = make('div', 'ml-choices ml-rules')
    rulesBox.setAttribute('role', 'group')
    rulesBox.setAttribute('aria-label', t('meeting.lobby-rules', 'This room asks'))
    this.#rulesBox = rulesBox
    const rulesHint = make('p', 'ml-hint', t('meeting.lobby-rules-hint', 'What the leader says with these words runs for you too. Anything else asks first.'))
    this.#paintRules()

    side.append(
      this.#field(t('meeting.lobby-camera', 'Camera'), 'ml-camera', cameraSelect),
      this.#field(t('meeting.lobby-microphone', 'Microphone'), 'ml-microphone', micSelect, meter),
      this.#field(t('meeting.lobby-picture', 'Picture'), '', group, hint),
      this.#field(t('meeting.lobby-rules', 'This room asks'), '', rulesBox, rulesHint),
    )
    return side
  }

  /** One toggle per word the room asks for: on runs it, off drops it. */
  #paintRules(): void {
    const box = this.#rulesBox
    if (!box) return
    box.replaceChildren()
    box.style.gridTemplateColumns = `repeat(${Math.min(Math.max(this.#rules.length, 1), 4)},1fr)`
    for (const rule of this.#rules) {
      const on = this.#allowed.has(rule)
      const button = make('button', 'ml-choice', `${rule === 'go' ? t('meeting.lobby-rule-go', 'follow (go)') : rule} ${on ? '✓' : '✗'}`)
      button.type = 'button'
      button.setAttribute('aria-pressed', String(on))
      button.setAttribute('aria-checked', String(on))
      button.addEventListener('click', () => {
        if (this.#allowed.has(rule)) this.#allowed.delete(rule)
        else this.#allowed.add(rule)
        this.#paintRules()
      })
      box.append(button)
    }
  }

  #field(label: string, id: string, ...controls: HTMLElement[]): HTMLElement {
    const field = make('div', 'ml-field')
    const name = make(id ? 'label' : 'span', 'ml-label', label)
    if (id) (name as HTMLLabelElement).htmlFor = id
    field.append(name, ...controls)
    return field
  }

  /** Who is here, and the way in. */
  #buildFoot(): HTMLElement {
    const foot = make('footer', 'ml-foot')

    const NS = 'http://www.w3.org/2000/svg'
    const circle = document.createElementNS(NS, 'svg')
    circle.setAttribute('class', 'ml-circle')
    circle.setAttribute('viewBox', '-16 -16 32 32')
    circle.setAttribute('aria-hidden', 'true')
    for (const seat of seatPositions(5)) {
      const polygon = document.createElementNS(NS, 'polygon')
      polygon.setAttribute('class', 'ml-seat')
      polygon.setAttribute('points', hexPoints(seat.x, seat.y, 4.6))
      circle.append(polygon)
      this.#seats.push(polygon)
    }

    const here = make('div', 'ml-here')
    const count = make('span', 'ml-here-count')
    const note = make('span', 'ml-here-note')
    here.append(count, note)
    this.#hereCount = count
    this.#hereNote = note

    // THE WAY TO ASK SOMEONE IN: the swarm's meeting link, exactly as `invite`
    // makes it (signed where the host allows it). Whoever opens it is asked
    // to join the swarm, and `meeting` there brings them to this meeting.
    const copy = make('button', 'ml-btn', t('meeting.lobby-copy-link', 'copy link'))
    copy.type = 'button'
    copy.addEventListener('click', () => {
      void ioc<{ meetingLink?: (how?: 'copy' | 'share') => Promise<void> }>(KEYS.invite)?.meetingLink?.('copy')
    })

    const cancel = make('button', 'ml-btn', t('meeting.lobby-cancel', 'cancel'))
    cancel.type = 'button'
    cancel.addEventListener('click', () => this.#close())

    const join = make('button', 'ml-btn ml-btn-primary', t('meeting.lobby-join', 'join'))
    join.type = 'button'
    join.disabled = true
    join.addEventListener('click', () => this.#joinNow())
    this.#join = join

    foot.append(circle, here, make('span', 'ml-grow'), copy, cancel, join)
    return foot
  }

  // ── the camera ────────────────────────────────────────────────

  /** Open (or reopen) the preview with the current choices. */
  async #acquire(): Promise<void> {
    const attempt = ++this.#attempt
    this.#letGo()
    this.#setState('asking')

    const media = navigator.mediaDevices
    if (!window.isSecureContext || !media?.getUserMedia) { this.#setState('missing'); return }

    let stream: MediaStream
    try {
      const wanted = qualityConstraints(this.#quality, this.#devices)
      try {
        stream = await media.getUserMedia(wanted)
      } catch (error) {
        // No microphone is not a reason to refuse the camera: join without sound.
        if ((error as { name?: string } | null)?.name !== 'NotFoundError') throw error
        stream = await media.getUserMedia({ video: wanted.video })
      }
    } catch (error) {
      if (attempt !== this.#attempt || !this.#panel) return
      // A device chosen earlier is gone: fall back to the defaults, once.
      if ((error as { name?: string } | null)?.name === 'OverconstrainedError' && (this.#devices.camera || this.#devices.microphone)) {
        this.#devices = {}
        void this.#acquire()
        return
      }
      this.#setState(failureOf(error))
      return
    }
    if (attempt !== this.#attempt || !this.#panel) { stop(stream); return }

    this.#stream = stream
    this.#video.srcObject = stream
    try { void Promise.resolve(this.#video.play()).catch(() => { /* autoplay policy: the next frame plays it */ }) } catch { /* no play() here */ }
    this.#setState('live')
    this.#watchLevel(stream)
    this.#paintActual(stream)
    void this.#listDevices()
  }

  /** Let the current preview go: its tracks and its meter. */
  #letGo(): void {
    stop(this.#stream)
    this.#stream = null
    if (this.#video) this.#video.srcObject = null
    this.#stopLevel()
  }

  #watchLevel(stream: MediaStream): void {
    this.#stopLevel()
    if (!stream.getAudioTracks().length) return
    const Context = window.AudioContext
    if (!Context) return
    try {
      const ctx = new Context()
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 512
      ctx.createMediaStreamSource(new MediaStream(stream.getAudioTracks())).connect(analyser)
      void ctx.resume().catch(() => { /* needs a gesture; the meter stays still */ })
      const samples = new Uint8Array(analyser.fftSize)
      let shown = 0
      const loop = (): void => {
        analyser.getByteTimeDomainData(samples)
        shown = Math.max(levelOf(samples), shown * 0.86)
        this.#meterFill.style.transform = `scaleX(${shown.toFixed(3)})`
        if (this.#audio) this.#audio.raf = requestAnimationFrame(loop)
      }
      this.#audio = { ctx, raf: requestAnimationFrame(loop) }
    } catch { /* no meter; the microphone still works */ }
  }

  #stopLevel(): void {
    const audio = this.#audio
    this.#audio = null
    if (audio) {
      cancelAnimationFrame(audio.raf)
      void audio.ctx.close().catch(() => { /* already closed */ })
    }
    if (this.#meterFill) this.#meterFill.style.transform = 'scaleX(0)'
  }

  async #listDevices(): Promise<void> {
    const media = navigator.mediaDevices
    if (!media?.enumerateDevices || !this.#panel) return
    let all: MediaDeviceInfo[]
    try { all = await media.enumerateDevices() } catch { return }
    if (!this.#panel) return
    const settings = this.#stream?.getVideoTracks()[0]?.getSettings()
    const micId = this.#stream?.getAudioTracks()[0]?.getSettings().deviceId
    this.#fill(this.#cameraSelect, all.filter(d => d.kind === 'videoinput'), 'camera', this.#devices.camera ?? settings?.deviceId)
    this.#fill(this.#micSelect, all.filter(d => d.kind === 'audioinput'), 'microphone', this.#devices.microphone ?? micId)
  }

  #fill(select: HTMLSelectElement, devices: MediaDeviceInfo[], kind: 'camera' | 'microphone', current?: string): void {
    select.replaceChildren()
    devices.forEach((device, index) => {
      const option = make('option', '', deviceLabel(device, index, kind))
      option.value = device.deviceId
      select.append(option)
    })
    if (current && devices.some(d => d.deviceId === current)) select.value = current
    select.disabled = devices.length < 2
  }

  // ── what is shown ─────────────────────────────────────────────

  #setState(state: State): void {
    this.#state = state
    this.#ring.dataset['state'] = state
    const live = state === 'live'
    this.#say.hidden = live
    this.#join.disabled = !live
    if (live) {
      this.#live.textContent = t('meeting.lobby-ready', 'Camera ready')
      return
    }
    const saying = SAYINGS[state]
    this.#sayMark.textContent = saying.mark
    this.#sayText.textContent = t(saying.key, saying.fallback)
    this.#retry.hidden = state === 'asking'
    this.#sub.textContent = ''
    this.#live.textContent = this.#sayText.textContent
  }

  #choose(quality: Quality): void {
    if (quality === this.#quality) return
    this.#quality = quality
    this.#paintChoices()
    void this.#acquire()
  }

  #paintChoices(): void {
    for (const [quality, button] of this.#choices) {
      const on = quality === this.#quality
      button.setAttribute('aria-checked', String(on))
      button.tabIndex = on ? 0 : -1
    }
    const d = describeQuality(this.#quality)
    this.#hint.textContent = t('meeting.lobby-hint', '{width}×{height} · {fps} fps · up to {mbps} Mbps to each person', {
      width: d.width, height: d.height, fps: d.fps, mbps: d.maxMbps,
    })
  }

  /** What the camera actually gave, which can be less than was asked for. */
  #paintActual(stream: MediaStream): void {
    const settings = stream.getVideoTracks()[0]?.getSettings()
    this.#sub.textContent = settings?.width && settings?.height
      ? t('meeting.lobby-actual', 'Sending {width}×{height}', { width: settings.width, height: settings.height })
      : ''
  }

  #paintPresence(): void {
    const taken = seatsTaken(this.#here)
    this.#seats.forEach((seat, index) => seat.setAttribute('data-filled', String(taken[index])))
    this.#hereCount.textContent = t('meeting.lobby-here-now', '{here} here', { here: this.#here })
    this.#hereNote.textContent = !this.#inSwarm
      ? t('meeting.lobby-no-swarm', 'You are not in a swarm yet. Copy link asks you to go public first.')
      : this.#here === 0
        ? t('meeting.lobby-first-lead', 'No one else is here yet. Join, and you lead: the others follow you.')
        : t('meeting.lobby-follow', 'The first one in leads. You follow where they go.')
  }

  // ── leaving ───────────────────────────────────────────────────

  /** Hand the open camera to the hive and step aside. The hive owns the tracks
   *  from here, so the teardown below must not stop them. */
  #joinNow(): void {
    const stream = this.#stream
    if (this.#state !== 'live' || !stream) return
    this.#stream = null
    EffectBus.emitTransient('meeting:join', { stream, quality: this.#quality, allowed: [...this.#allowed] })
    this.#close()
  }

  #close(): void {
    facade.wanted = false
    if (this.#panel) this.#teardown()
  }

  #teardown(): void {
    const attempt = (what: () => void): void => {
      try { what() } catch (error) { console.warn('[meeting-lobby] teardown step failed', error) }
    }
    this.#attempt++
    attempt(() => this.#letGo())
    attempt(() => this.#releaseModes())
    attempt(() => EffectBus.emit('keymap:unsuppress', { reason: LOBBY }))
    attempt(() => ioc<GateShape>(KEYS.gate)?.unlock(LOBBY))
    attempt(() => this.#releaseBack?.())
    this.#releaseBack = null
    for (const off of this.#openCleanup.splice(0)) attempt(() => off?.())
    attempt(() => this.#dock?.dispose?.())
    this.#dock = null
    this.#panel?.remove()
    this.#panel = null
    this.#seats = []
    this.#choices.clear()
  }

  #claimModes(panel: HTMLElement): void {
    const claim = (modes: ModesShape): void => {
      this.#modes = modes
      modes.enter('view:keeps-controls', LOBBY)
      modes.enter('view:active', LOBBY)
    }
    const modes = ioc<ModesShape>(KEYS.modes)
    if (modes) { claim(modes); return }
    ;(window as { ioc?: { whenReady?: (k: string, cb: (v: unknown) => void) => void } }).ioc
      ?.whenReady?.(KEYS.modes, value => { if (this.#panel === panel && !this.#modes) claim(value as ModesShape) })
  }

  #releaseModes(): void {
    const modes = this.#modes
    this.#modes = null
    if (!modes) return
    if (modes.releaseOwner) { modes.releaseOwner(LOBBY); return }
    modes.exit('view:active', LOBBY)
    modes.exit('view:keeps-controls', LOBBY)
  }

  // ── keys ──────────────────────────────────────────────────────

  #onKeyDown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || event.isComposing || event.key !== 'Enter') return
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return
    // A control that answers Enter itself keeps it.
    if (event.target instanceof HTMLElement && event.target.closest('button, select')) return
    event.preventDefault()
    this.#joinNow()
  }
}
