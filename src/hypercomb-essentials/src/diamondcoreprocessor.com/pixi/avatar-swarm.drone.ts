// diamondcoreprocessor.com/pixi/avatar-swarm.drone.ts
// Real-time avatar bee swarm — renders animated bees for live peers.
// GPU-instanced: one draw call for all bees, SDF shapes, flight on GPU.
// JS updates position buffers each frame via Pixi ticker.

import { Drone } from '@hypercomb/core'
import { Application, Container, Geometry, Mesh, Texture } from 'pixi.js'
import { BeeSwarmShader } from './bee-swarm.shader.js'
import { noise2D } from './simplex-noise.js'
import type { HostReadyPayload } from './pixi-host.worker.js'
import type { HexGeometry } from './hex-geometry.js'

type MeshEvt = { relay: string; sig: string; event: any; payload: any }
type MeshSub = { close: () => void }
type MeshApi = {
  ensureStartedForSig: (sig: string) => void
  subscribe?: (sig: string, cb: (e: MeshEvt) => void) => MeshSub
  publish?: (kind: number, sig: string, payload: any, extraTags?: string[][]) => Promise<boolean>
}

interface AvatarParams {
  bodyColor: [number, number, number]
  wingColor: [number, number, number]
  variant: number // 0, 1, or 2
}

interface PeerState {
  publisherId: string
  avatar: AvatarParams
  x: number
  y: number
  targetX: number
  targetY: number
  phase: number
  facing: number
  alpha: number
  fadeTarget: number // 1 = visible, 0 = fading out
  lastSeenMs: number
  slot: number // index into the instance buffers
}

const MAX_BEES = 2048
const QUAD_HALF = 16 // half-size of each bee quad in pixels
const PUBLISH_INTERVAL_MS = 3000
const PEER_EXPIRY_MS = 15_000
const FADE_SPEED = 0.03 // alpha change per frame

/** DJB2 hash → deterministic avatar colors from a string. */
function pubkeyToAvatar(id: string): AvatarParams {
  let h = 5381
  for (let i = 0; i < id.length; i++) h = ((h << 5) + h + id.charCodeAt(i)) | 0
  h = h >>> 0

  const hue1 = (h % 360) / 360
  const hue2 = ((h >>> 8) % 360) / 360
  const variant = ((h >>> 16) % 3)

  return {
    bodyColor: hslToRgb(hue1, 0.7, 0.55),
    wingColor: hslToRgb(hue2, 0.4, 0.75),
    variant,
  }
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h * 6) % 2) - 1))
  const m = l - c / 2
  let r = 0, g = 0, b = 0
  const sector = (h * 6) | 0
  if (sector === 0)      { r = c; g = x }
  else if (sector === 1) { r = x; g = c }
  else if (sector === 2) { g = c; b = x }
  else if (sector === 3) { g = x; b = c }
  else if (sector === 4) { r = x; b = c }
  else                   { r = c; b = x }
  return [r + m, g + m, b + m]
}

export class AvatarSwarmDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'

  public override description =
    'Renders real-time peer avatar cursors on the hex grid from mesh presence events.'
  public override effects = ['render', 'network'] as const

  protected override deps = {
    mesh: '@diamondcoreprocessor.com/NostrMeshDrone',
    lineage: '@hypercomb.social/Lineage',
  }

  protected override listens = ['render:host-ready', 'render:geometry-changed', 'mesh:ensure-started']
  protected override emits = ['swarm:peer-count']

  #app: Application | null = null
  #container: Container | null = null
  #layer: Container | null = null
  #mesh: any | null = null
  #shader: BeeSwarmShader | null = null
  #geom: Geometry | null = null
  #tickerBound = false

  // per-instance buffers (4 verts per bee × MAX_BEES)
  #posBuf = new Float32Array(MAX_BEES * 8)   // aPosition (quad corners relative)
  #uvBuf = new Float32Array(MAX_BEES * 8)    // aUV
  #beePosBuf = new Float32Array(MAX_BEES * 8)  // aBeePos (world pos, duplicated per 4 verts)
  #colorBuf = new Float32Array(MAX_BEES * 12)  // aBeeColor (rgb × 4 verts)
  #wingBuf = new Float32Array(MAX_BEES * 12)   // aWingColor
  #phaseBuf = new Float32Array(MAX_BEES * 4)   // aBeePhase
  #variantBuf = new Float32Array(MAX_BEES * 4) // aBeeVariant
  #alphaBuf = new Float32Array(MAX_BEES * 4)   // aBeeAlpha
  #facingBuf = new Float32Array(MAX_BEES * 4)  // aBeeFacing
  #idxBuf = new Uint32Array(MAX_BEES * 6)      // index buffer

  // peer state
  #peers = new Map<string, PeerState>()
  #freeSlots: number[] = []
  #activeCount = 0

  // hex geometry for axial → pixel
  #hexGeo: HexGeometry = { circumRadiusPx: 32, gapPx: 6, padPx: 10, spacing: 38 }
  #flat = false

  // mesh subscription
  #meshSub: MeshSub | null = null
  #currentSig = ''

  // publish state
  #lastPublishMs = 0
  #viewingSeed = ''
  #viewingQ = 0
  #viewingR = 0

  // own identity
  #publisherId = ''
  #ownAvatar: AvatarParams = { bodyColor: [1, 0.8, 0.2], wingColor: [0.8, 0.9, 1], variant: 0 }

  // time accumulator for shader
  #time = 0

  constructor() {
    super()
    // init free slot list (all slots available)
    for (let i = MAX_BEES - 1; i >= 0; i--) this.#freeSlots.push(i)
    // pre-fill quad corners and UVs (static per slot)
    this.#initStaticBuffers()
  }

  #initStaticBuffers = (): void => {
    const hw = QUAD_HALF
    const hh = QUAD_HALF
    for (let i = 0; i < MAX_BEES; i++) {
      const p = i * 8
      // relative quad positions (centered at origin — aBeePos adds world offset)
      this.#posBuf[p]     = -hw; this.#posBuf[p + 1] = -hh
      this.#posBuf[p + 2] =  hw; this.#posBuf[p + 3] = -hh
      this.#posBuf[p + 4] =  hw; this.#posBuf[p + 5] =  hh
      this.#posBuf[p + 6] = -hw; this.#posBuf[p + 7] =  hh

      // UV: 0,0 → 1,1
      const u = i * 8
      this.#uvBuf[u]     = 0; this.#uvBuf[u + 1] = 0
      this.#uvBuf[u + 2] = 1; this.#uvBuf[u + 3] = 0
      this.#uvBuf[u + 4] = 1; this.#uvBuf[u + 5] = 1
      this.#uvBuf[u + 6] = 0; this.#uvBuf[u + 7] = 1

      // index buffer (two triangles per quad)
      const ii = i * 6
      const base = i * 4
      this.#idxBuf[ii]     = base
      this.#idxBuf[ii + 1] = base + 1
      this.#idxBuf[ii + 2] = base + 2
      this.#idxBuf[ii + 3] = base
      this.#idxBuf[ii + 4] = base + 2
      this.#idxBuf[ii + 5] = base + 3

      // default alpha to 0 (invisible)
      this.#alphaBuf[i * 4]     = 0
      this.#alphaBuf[i * 4 + 1] = 0
      this.#alphaBuf[i * 4 + 2] = 0
      this.#alphaBuf[i * 4 + 3] = 0

      // default facing to right
      this.#facingBuf[i * 4]     = 1
      this.#facingBuf[i * 4 + 1] = 1
      this.#facingBuf[i * 4 + 2] = 1
      this.#facingBuf[i * 4 + 3] = 1
    }
  }

  protected override sense = (): boolean => true

  protected override heartbeat = async (): Promise<void> => {
    this.#ensurePixi()
    this.#ensureMeshSubscription()
    this.#publishOwnPresence()
    this.#pruneExpiredPeers()
  }

  // ─── pixi setup ──────────────────────────────────────────────

  #effectsRegistered = false

  #ensurePixi = (): void => {
    if (this.#effectsRegistered) return
    this.#effectsRegistered = true

    this.onEffect<HostReadyPayload>('render:host-ready', (payload) => {
      if (this.#app) return
      this.#app = payload.app
      this.#container = payload.container
      this.#initRendering()
    })

    this.onEffect<HexGeometry>('render:geometry-changed', (geo) => {
      this.#hexGeo = geo
    })

    // track which tile the local user is hovering / viewing
    this.onEffect<{ label: string; q: number; r: number }>('tile:hover', ({ label, q, r }) => {
      this.#viewingSeed = label
      this.#viewingQ = q
      this.#viewingR = r
    })
  }

  #initRendering = (): void => {
    if (!this.#app || !this.#container) return

    this.#shader = new BeeSwarmShader()
    this.#layer = new Container()
    this.#layer.zIndex = 10 // above honeycomb, below overlays
    this.#layer.visible = false // hidden by default — Ctrl+Shift+B to toggle

    // listen for bee visibility toggle
    this.onEffect<{ visible: boolean }>('render:set-bees-visible', ({ visible }) => {
      if (this.#layer) this.#layer.visible = visible
    })

    this.#buildGeometry()

    const MeshCtor = Mesh as any
    this.#mesh = new MeshCtor({ geometry: this.#geom, shader: this.#shader.shader, texture: Texture.WHITE })
    this.#mesh.blendMode = 'pre-multiply'

    this.#layer.addChild(this.#mesh)
    this.#container.addChild(this.#layer)

    // start ticker for per-frame animation
    if (!this.#tickerBound) {
      this.#tickerBound = true
      this.#app.ticker.add(this.#onTick)
    }
  }

  #buildGeometry = (): void => {
    this.#geom = new Geometry()
    ;(this.#geom as any).addAttribute('aPosition', this.#posBuf, 2)
    ;(this.#geom as any).addAttribute('aUV', this.#uvBuf, 2)
    ;(this.#geom as any).addAttribute('aBeePos', this.#beePosBuf, 2)
    ;(this.#geom as any).addAttribute('aBeeColor', this.#colorBuf, 3)
    ;(this.#geom as any).addAttribute('aWingColor', this.#wingBuf, 3)
    ;(this.#geom as any).addAttribute('aBeePhase', this.#phaseBuf, 1)
    ;(this.#geom as any).addAttribute('aBeeVariant', this.#variantBuf, 1)
    ;(this.#geom as any).addAttribute('aBeeAlpha', this.#alphaBuf, 1)
    ;(this.#geom as any).addAttribute('aBeeFacing', this.#facingBuf, 1)
    ;(this.#geom as any).addIndex(this.#idxBuf)
  }

  // ─── per-frame tick ──────────────────────────────────────────

  #onTick = (): void => {
    if (!this.#shader || !this.#geom || this.#peers.size === 0) return

    const dt = this.#app!.ticker.deltaMS / 1000
    this.#time += dt
    this.#shader.setTime(this.#time)

    let dirty = false

    for (const peer of this.#peers.values()) {
      // lerp toward target
      const dx = (peer.targetX - peer.x) * 0.02
      const dy = (peer.targetY - peer.y) * 0.02

      // simplex noise wander
      const wx = noise2D(this.#time * 0.3 + peer.phase, peer.phase * 10) * 18
      const wy = noise2D(peer.phase * 10, this.#time * 0.3 + peer.phase) * 18

      peer.x += dx + wx * dt
      peer.y += dy + wy * dt

      // facing direction
      const vx = dx + wx * dt
      peer.facing = vx >= 0 ? 1 : -1

      // alpha fade
      if (Math.abs(peer.alpha - peer.fadeTarget) > 0.001) {
        peer.alpha += (peer.fadeTarget - peer.alpha) * FADE_SPEED * (dt * 60)
        if (peer.alpha < 0.005 && peer.fadeTarget === 0) {
          // fully faded — reclaim slot
          this.#removePeer(peer.publisherId)
          continue
        }
      }

      // write to buffers
      this.#writeSlotPosition(peer.slot, peer.x, peer.y)
      this.#writeSlotAlpha(peer.slot, peer.alpha)
      this.#writeSlotFacing(peer.slot, peer.facing)
      dirty = true
    }

    if (dirty) {
      // mark attribute buffers as needing GPU upload
      const g = this.#geom as any
      g.getBuffer('aBeePos')?.update(this.#beePosBuf)
      g.getBuffer('aBeeAlpha')?.update(this.#alphaBuf)
      g.getBuffer('aBeeFacing')?.update(this.#facingBuf)
    }
  }

  // ─── mesh subscription ───────────────────────────────────────

  #ensureMeshSubscription = (): void => {
    // resolve the publisher id from show-honeycomb's shared key
    if (!this.#publisherId) {
      const key = 'hc:show-honeycomb:publisher-id'
      try {
        this.#publisherId = localStorage.getItem(key) ?? ''
      } catch { /* ignore */ }
      if (!this.#publisherId) return
      this.#ownAvatar = pubkeyToAvatar(this.#publisherId)
    }

    this.onEffect<{ signature: string }>('mesh:ensure-started', ({ signature }) => {
      if (signature === this.#currentSig) return
      this.#switchSig(signature)
    })
  }

  #switchSig = (sig: string): void => {
    if (this.#meshSub) {
      try { this.#meshSub.close() } catch { /* ignore */ }
      this.#meshSub = null
    }

    // clear all peers on location change
    for (const peer of this.#peers.values()) {
      this.#clearSlot(peer.slot)
      this.#freeSlots.push(peer.slot)
    }
    this.#peers.clear()
    this.#activeCount = 0
    this.#currentSig = sig

    const mesh = this.resolve<MeshApi>('mesh')
    if (!mesh || typeof mesh.subscribe !== 'function') return

    this.#meshSub = mesh.subscribe(sig, (evt) => this.#onMeshEvent(evt))
  }

  #onMeshEvent = (evt: MeshEvt): void => {
    const p = evt.payload
    if (!p || p.type !== 'swarm-presence') return

    const id = p.publisherId
    if (!id || typeof id !== 'string') return
    if (id === this.#publisherId) return // ignore self

    // validate numeric fields
    const viewingQ = typeof p.viewingQ === 'number' ? p.viewingQ : 0
    const viewingR = typeof p.viewingR === 'number' ? p.viewingR : 0
    const variant = typeof p.avatar?.variant === 'number' ? Math.max(0, Math.min(2, Math.floor(p.avatar.variant))) : 0

    // compute target pixel position from axial coords
    const { x: tx, y: ty } = this.#axialToPixel(viewingQ, viewingR)

    const existing = this.#peers.get(id)
    if (existing) {
      existing.targetX = tx
      existing.targetY = ty
      existing.lastSeenMs = Date.now()
      existing.fadeTarget = 1
      return
    }

    // new peer — allocate slot
    if (this.#freeSlots.length === 0) return // pool exhausted
    const slot = this.#freeSlots.pop()!

    const avatar = this.#parseAvatar(p.avatar, id)
    const phase = (slot * 2.399 + 0.7) % 6.28 // golden angle distribution

    const peer: PeerState = {
      publisherId: id,
      avatar,
      x: tx + (Math.random() - 0.5) * 40,
      y: ty + (Math.random() - 0.5) * 40,
      targetX: tx,
      targetY: ty,
      phase,
      facing: 1,
      alpha: 0,
      fadeTarget: 1,
      lastSeenMs: Date.now(),
      slot,
    }

    this.#peers.set(id, peer)
    this.#activeCount++

    // write static attributes for this slot
    this.#writeSlotColor(slot, avatar.bodyColor, avatar.wingColor)
    this.#writeSlotPhase(slot, phase)
    this.#writeSlotVariant(slot, avatar.variant)
    this.#writeSlotPosition(slot, peer.x, peer.y)
    this.#writeSlotAlpha(slot, 0) // starts invisible, fades in
    this.#writeSlotFacing(slot, 1)

    // update static buffers on GPU
    const g = this.#geom as any
    g.getBuffer('aBeeColor')?.update(this.#colorBuf)
    g.getBuffer('aWingColor')?.update(this.#wingBuf)
    g.getBuffer('aBeePhase')?.update(this.#phaseBuf)
    g.getBuffer('aBeeVariant')?.update(this.#variantBuf)

    this.emitEffect('swarm:peer-count', { count: this.#activeCount })
  }

  #parseAvatar = (raw: any, fallbackId: string): AvatarParams => {
    if (raw && Array.isArray(raw.bodyColor) && raw.bodyColor.length === 3 &&
        Array.isArray(raw.wingColor) && raw.wingColor.length === 3 &&
        typeof raw.variant === 'number') {
      return {
        bodyColor: [clamp01(raw.bodyColor[0]), clamp01(raw.bodyColor[1]), clamp01(raw.bodyColor[2])],
        wingColor: [clamp01(raw.wingColor[0]), clamp01(raw.wingColor[1]), clamp01(raw.wingColor[2])],
        variant: Math.max(0, Math.min(2, Math.floor(raw.variant))),
      }
    }
    return pubkeyToAvatar(fallbackId)
  }

  // ─── publishing own presence ─────────────────────────────────

  #publishOwnPresence = (): void => {
    const now = Date.now()
    if (now - this.#lastPublishMs < PUBLISH_INTERVAL_MS) return
    if (!this.#currentSig || !this.#publisherId) return

    const mesh = this.resolve<MeshApi>('mesh')
    if (!mesh || typeof mesh.publish !== 'function') return

    this.#lastPublishMs = now

    const payload = {
      type: 'swarm-presence',
      publisherId: this.#publisherId,
      avatar: this.#ownAvatar,
      viewingSeed: this.#viewingSeed,
      viewingQ: this.#viewingQ,
      viewingR: this.#viewingR,
      ts: now,
    }

    void mesh.publish(29010, this.#currentSig, payload, [
      ['publisher', this.#publisherId],
      ['mode', 'swarm-presence'],
    ])
  }

  // ─── peer expiry ─────────────────────────────────────────────

  #pruneExpiredPeers = (): void => {
    const now = Date.now()
    for (const [id, peer] of this.#peers) {
      if (now - peer.lastSeenMs > PEER_EXPIRY_MS) {
        peer.fadeTarget = 0 // will be removed when alpha reaches 0 in tick
      }
    }
  }

  #removePeer = (id: string): void => {
    const peer = this.#peers.get(id)
    if (!peer) return
    this.#clearSlot(peer.slot)
    this.#freeSlots.push(peer.slot)
    this.#peers.delete(id)
    this.#activeCount--
    this.emitEffect('swarm:peer-count', { count: this.#activeCount })
  }

  // ─── buffer writers ──────────────────────────────────────────

  #writeSlotPosition = (slot: number, x: number, y: number): void => {
    const o = slot * 8
    // duplicate world position across all 4 verts of the quad
    this.#beePosBuf[o]     = x; this.#beePosBuf[o + 1] = y
    this.#beePosBuf[o + 2] = x; this.#beePosBuf[o + 3] = y
    this.#beePosBuf[o + 4] = x; this.#beePosBuf[o + 5] = y
    this.#beePosBuf[o + 6] = x; this.#beePosBuf[o + 7] = y
  }

  #writeSlotColor = (slot: number, body: [number, number, number], wing: [number, number, number]): void => {
    const o = slot * 12
    for (let v = 0; v < 4; v++) {
      const p = o + v * 3
      this.#colorBuf[p] = body[0]; this.#colorBuf[p + 1] = body[1]; this.#colorBuf[p + 2] = body[2]
      this.#wingBuf[p] = wing[0]; this.#wingBuf[p + 1] = wing[1]; this.#wingBuf[p + 2] = wing[2]
    }
  }

  #writeSlotPhase = (slot: number, phase: number): void => {
    const o = slot * 4
    this.#phaseBuf[o] = this.#phaseBuf[o + 1] = this.#phaseBuf[o + 2] = this.#phaseBuf[o + 3] = phase
  }

  #writeSlotVariant = (slot: number, variant: number): void => {
    const o = slot * 4
    this.#variantBuf[o] = this.#variantBuf[o + 1] = this.#variantBuf[o + 2] = this.#variantBuf[o + 3] = variant
  }

  #writeSlotAlpha = (slot: number, alpha: number): void => {
    const o = slot * 4
    this.#alphaBuf[o] = this.#alphaBuf[o + 1] = this.#alphaBuf[o + 2] = this.#alphaBuf[o + 3] = alpha
  }

  #writeSlotFacing = (slot: number, facing: number): void => {
    const o = slot * 4
    this.#facingBuf[o] = this.#facingBuf[o + 1] = this.#facingBuf[o + 2] = this.#facingBuf[o + 3] = facing
  }

  #clearSlot = (slot: number): void => {
    this.#writeSlotAlpha(slot, 0)
    this.#writeSlotPosition(slot, 0, 0)
  }

  // ─── helpers ─────────────────────────────────────────────────

  #axialToPixel = (q: number, r: number): { x: number; y: number } => {
    const s = this.#hexGeo.spacing
    return this.#flat
      ? { x: 1.5 * s * q, y: Math.sqrt(3) * s * (r + q / 2) }
      : { x: Math.sqrt(3) * s * (q + r / 2), y: s * 1.5 * r }
  }

  protected override dispose = (): void => {
    if (this.#meshSub) {
      try { this.#meshSub.close() } catch { /* ignore */ }
    }
    if (this.#app && this.#tickerBound) {
      this.#app.ticker.remove(this.#onTick)
    }
    if (this.#layer && this.#container) {
      this.#container.removeChild(this.#layer)
    }
  }
}

function clamp01(v: number): number {
  return typeof v === 'number' ? Math.max(0, Math.min(1, v)) : 0
}

const _avatarSwarm = new AvatarSwarmDrone()
window.ioc.register('@diamondcoreprocessor.com/AvatarSwarmDrone', _avatarSwarm)
