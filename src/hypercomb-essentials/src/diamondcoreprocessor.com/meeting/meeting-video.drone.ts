// diamondcoreprocessor.com/meeting/meeting-video.drone.ts
// Renders remote (and local) video streams into hex tiles using Pixi.js.
// Each participant's video is clipped to a hexagonal mask at their tile position.

import { Drone } from '@hypercomb/core'
import { Application, Container, Graphics, Sprite, Texture } from 'pixi.js'
import type { HexGeometry } from '../presentation/grid/hex-geometry.js'
import type { MeetingState } from './hive-meeting.drone.js'

type HostReadyPayload = { app: Application; container: Container; canvas: HTMLCanvasElement; renderer: any }
type CellCountPayload = { count: number; labels: string[] }
type MeetingStreamPayload = { streams: Map<string, MediaStream> }
type MeetingStatePayload = { state: MeetingState; threshold: number }

type VideoSlot = {
  publisherId: string
  video: HTMLVideoElement
  sprite: Sprite
  mask: Graphics
  container: Container
  alpha: number
  fadeTarget: number
}

const FADE_SPEED = 0.04 // per frame

export class MeetingVideoDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'meeting'

  public override description =
    'Renders peer video streams into hex tiles — hex-clipped, faded in/out on connect/disconnect.'
  public override effects = ['render'] as const

  protected override listens = [
    'meeting:streams', 'meeting:state',
    'render:host-ready', 'render:geometry-changed', 'render:cell-count',
  ]

  #app: Application | null = null
  #renderContainer: Container | null = null
  #layer: Container | null = null
  #tickerBound = false

  #hexGeo: HexGeometry = { circumRadiusPx: 32, gapPx: 6, padPx: 10, spacing: 38 }
  #flat = false
  #cellLabels: string[] = []

  #slots = new Map<string, VideoSlot>()
  #meetingActive = false
  #latestStreams = new Map<string, MediaStream>()

  #effectsRegistered = false

  protected override sense = (): boolean => true

  protected override heartbeat = async (): Promise<void> => {
    if (!this.#effectsRegistered) {
      this.#effectsRegistered = true
      this.#registerEffects()
    }
  }

  #registerEffects = (): void => {
    this.onEffect<HostReadyPayload>('render:host-ready', (payload) => {
      if (this.#app) return
      this.#app = payload.app
      this.#renderContainer = payload.container
      this.#initLayer()
    })

    this.onEffect<HexGeometry>('render:geometry-changed', (geo) => {
      this.#hexGeo = geo
      this.#repositionAll()
    })

    this.onEffect<CellCountPayload>('render:cell-count', (payload) => {
      this.#cellLabels = payload.labels
    })

    this.onEffect<MeetingStatePayload>('meeting:state', ({ state }) => {
      this.#meetingActive = state === 'active' || state === 'gathering'
      if (state === 'ended' || state === 'idle') {
        this.#fadeOutAll()
      }
    })

    this.onEffect<MeetingStreamPayload>('meeting:streams', ({ streams }) => {
      this.#latestStreams = streams
      this.#syncSlots()
    })
  }

  // ─── pixi layer ──────────────────────────────────────────────

  #initLayer = (): void => {
    if (!this.#app || !this.#renderContainer) return

    this.#layer = new Container()
    this.#layer.zIndex = 5 // below avatars (10), above base hexes
    this.#layer.label = 'meeting-video-layer'
    this.#renderContainer.addChild(this.#layer)

    if (!this.#tickerBound) {
      this.#tickerBound = true
      this.#app.ticker.add(this.#onTick)
    }
  }

  // ─── sync video slots with streams ───────────────────────────

  #syncSlots = (): void => {
    if (!this.#layer) return

    // remove slots whose stream is gone
    for (const [id, slot] of this.#slots) {
      if (!this.#latestStreams.has(id)) {
        slot.fadeTarget = 0 // fade out, will be cleaned up in tick
      }
    }

    // add/update slots
    let idx = 0
    for (const [id, stream] of this.#latestStreams) {
      const existing = this.#slots.get(id)
      if (existing) {
        // stream may have changed (e.g. renegotiation)
        if (existing.video.srcObject !== stream) {
          existing.video.srcObject = stream
        }
        existing.fadeTarget = 1
      } else {
        this.#createSlot(id, stream, idx)
      }
      idx++
    }
  }

  #createSlot = (publisherId: string, stream: MediaStream, index: number): void => {
    if (!this.#layer) return

    const video = document.createElement('video')
    video.srcObject = stream
    video.autoplay = true
    video.muted = publisherId === this.#getOwnId() // mute own audio to prevent echo
    video.playsInline = true
    video.style.display = 'none'
    document.body.appendChild(video)
    void video.play().catch(() => { /* autoplay policy */ })

    const container = new Container()
    container.label = `video-${publisherId.slice(0, 8)}`

    // hex mask
    const mask = new Graphics()
    this.#drawHexMask(mask)
    container.addChild(mask)

    // video sprite — use canvas as intermediate (safe for Pixi v8)
    const canvas = document.createElement('canvas')
    canvas.width = 256
    canvas.height = 256
    const sprite = new Sprite(Texture.from(canvas))
    sprite.anchor.set(0.5, 0.5)
    sprite.width = this.#hexGeo.circumRadiusPx * 2
    sprite.height = this.#hexGeo.circumRadiusPx * 2
    sprite.mask = mask
    sprite.alpha = 0
    container.addChild(sprite)

    // position at tile index
    const pos = this.#indexToPixel(index)
    container.x = pos.x
    container.y = pos.y

    this.#layer.addChild(container)

    const slot: VideoSlot = {
      publisherId, video, sprite, mask, container,
      alpha: 0, fadeTarget: 1,
    }
    this.#slots.set(publisherId, slot)
  }

  // ─── per-frame tick ──────────────────────────────────────────

  #onTick = (): void => {
    const toRemove: string[] = []

    for (const [id, slot] of this.#slots) {
      // update canvas from video
      this.#updateVideoTexture(slot)

      // fade
      if (Math.abs(slot.alpha - slot.fadeTarget) > 0.001) {
        slot.alpha += (slot.fadeTarget - slot.alpha) * FADE_SPEED * 60 * (this.#app!.ticker.deltaMS / 1000)
        slot.sprite.alpha = slot.alpha

        if (slot.alpha < 0.005 && slot.fadeTarget === 0) {
          toRemove.push(id)
        }
      }
    }

    for (const id of toRemove) this.#removeSlot(id)
  }

  #updateVideoTexture = (slot: VideoSlot): void => {
    if (slot.video.readyState < 2) return // not enough data

    const tex = slot.sprite.texture
    const source = tex.source as any
    const canvas = source?.resource as HTMLCanvasElement | undefined
    if (!canvas || typeof canvas.getContext !== 'function') return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // draw video frame to canvas (center-crop to square)
    const vw = slot.video.videoWidth || 256
    const vh = slot.video.videoHeight || 256
    const side = Math.min(vw, vh)
    const sx = (vw - side) / 2
    const sy = (vh - side) / 2
    ctx.drawImage(slot.video, sx, sy, side, side, 0, 0, canvas.width, canvas.height)

    // tell Pixi the texture source changed
    source.update?.()
  }

  // ─── hex mask ────────────────────────────────────────────────

  #drawHexMask = (g: Graphics): void => {
    const r = this.#hexGeo.circumRadiusPx
    g.clear()
    const verts: number[] = []
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i - Math.PI / 6 // pointy-top
      verts.push(Math.cos(angle) * r, Math.sin(angle) * r)
    }
    g.poly(verts, true)
    g.fill({ color: 0xffffff, alpha: 1 })
  }

  // ─── positioning ─────────────────────────────────────────────

  #indexToPixel = (index: number): { x: number; y: number } => {
    // simple spiral layout matching the hex grid's axial coordinates
    const { q, r } = this.#indexToAxial(index)
    return this.#axialToPixel(q, r)
  }

  #indexToAxial = (index: number): { q: number; r: number } => {
    // hex spiral: center(0), then ring-1 (6), ring-2 (12), etc.
    if (index === 0) return { q: 0, r: 0 }

    let ring = 1
    let total = 1
    while (total + ring * 6 <= index) {
      total += ring * 6
      ring++
    }

    const pos = index - total
    const side = Math.floor(pos / ring)
    const offset = pos % ring

    // six directions for hex ring traversal
    const dirs = [
      { dq: 1, dr: -1 }, { dq: 0, dr: -1 }, { dq: -1, dr: 0 },
      { dq: -1, dr: 1 }, { dq: 0, dr: 1 }, { dq: 1, dr: 0 },
    ]

    // start position of ring
    let q = 0, r = -ring
    // walk to correct side+offset
    for (let s = 0; s < side; s++) {
      q += dirs[s].dq * ring
      r += dirs[s].dr * ring
    }
    q += dirs[side].dq * offset
    r += dirs[side].dr * offset

    return { q, r }
  }

  #axialToPixel = (q: number, r: number): { x: number; y: number } => {
    const s = this.#hexGeo.spacing
    return this.#flat
      ? { x: 1.5 * s * q, y: Math.sqrt(3) * s * (r + q / 2) }
      : { x: Math.sqrt(3) * s * (q + r / 2), y: s * 1.5 * r }
  }

  #repositionAll = (): void => {
    let idx = 0
    for (const [, slot] of this.#slots) {
      const pos = this.#indexToPixel(idx)
      slot.container.x = pos.x
      slot.container.y = pos.y

      // update mask and sprite size
      this.#drawHexMask(slot.mask)
      slot.sprite.width = this.#hexGeo.circumRadiusPx * 2
      slot.sprite.height = this.#hexGeo.circumRadiusPx * 2
      idx++
    }
  }

  // ─── fade all out ────────────────────────────────────────────

  #fadeOutAll = (): void => {
    for (const [, slot] of this.#slots) {
      slot.fadeTarget = 0
    }
  }

  // ─── cleanup ─────────────────────────────────────────────────

  #removeSlot = (id: string): void => {
    const slot = this.#slots.get(id)
    if (!slot) return

    slot.video.pause()
    slot.video.srcObject = null
    slot.video.remove()
    slot.container.destroy({ children: true })
    this.#slots.delete(id)
  }

  #getOwnId = (): string => {
    try { return localStorage.getItem('hc:show-honeycomb:publisher-id') ?? '' }
    catch { return '' }
  }

  protected override dispose = (): void => {
    for (const [id] of this.#slots) this.#removeSlot(id)
    if (this.#app && this.#tickerBound) {
      this.#app.ticker.remove(this.#onTick)
    }
    if (this.#layer && this.#renderContainer) {
      this.#renderContainer.removeChild(this.#layer)
    }
  }
}

const _meetingVideo = new MeetingVideoDrone()
window.ioc.register('@diamondcoreprocessor.com/MeetingVideoDrone', _meetingVideo)
