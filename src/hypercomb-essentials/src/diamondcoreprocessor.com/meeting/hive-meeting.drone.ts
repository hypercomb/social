// diamondcoreprocessor.com/meeting/hive-meeting.drone.ts
// Orchestrates hive meetings — state machine, availability tracking, WebRTC signaling.
// When all participants in a honeycomb signal availability, the meeting starts
// and peer-to-peer video connections are established via the Nostr mesh.

import { Drone } from '@hypercomb/core'

type MeshEvt = { relay: string; sig: string; event: any; payload: any }
type MeshSub = { close: () => void }
type MeshApi = {
  ensureStartedForSig: (sig: string) => void
  subscribe?: (sig: string, cb: (e: MeshEvt) => void) => MeshSub
  publish?: (kind: number, sig: string, payload: any, extraTags?: string[][]) => Promise<boolean>
}

export type MeetingState = 'idle' | 'gathering' | 'active' | 'ended'

type PeerAvailability = {
  publisherId: string
  lastSeenMs: number
  cell: string
}

type PeerConnection = {
  publisherId: string
  pc: RTCPeerConnection
  remoteStream: MediaStream
}

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
}

const AVAILABILITY_TTL_MS = 30_000
const AVAILABILITY_PUBLISH_MS = 5_000
const DEFAULT_THRESHOLD = 7

export class HiveMeetingDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'meeting'

  public override description =
    'Orchestrates hive meetings — availability tracking, WebRTC signaling, peer connections.'
  public override effects = ['network'] as const

  protected override deps = {
    mesh: '@diamondcoreprocessor.com/NostrMeshDrone',
  }

  protected override listens = [
    'render:cell-count', 'mesh:ensure-started',
    'meeting:toggle-camera', 'meeting:toggle-available',
  ]
  protected override emits = ['meeting:state', 'meeting:streams', 'meeting:local-camera']

  #state: MeetingState = 'idle'
  #threshold = DEFAULT_THRESHOLD
  #cellCount = 0
  #currentSig = ''
  #meshSub: MeshSub | null = null

  // own identity
  #publisherId = ''
  #localAvailable = false
  #lastAvailPublishMs = 0

  // peer availability tracking
  #availability = new Map<string, PeerAvailability>()

  // WebRTC
  #peers = new Map<string, PeerConnection>()
  #localStream: MediaStream | null = null
  #cameraOn = false

  // effect registration guard
  #effectsRegistered = false

  constructor() {
    super()
    try {
      const override = localStorage.getItem('hc:meeting:threshold')
      if (override) this.#threshold = Math.max(1, parseInt(override, 10) || DEFAULT_THRESHOLD)
    } catch { /* ignore */ }
  }

  protected override sense = (): boolean => true

  protected override heartbeat = async (): Promise<void> => {
    this.#ensureEffects()
    this.#ensureIdentity()
    this.#pruneExpiredAvailability()
    this.#publishAvailability()
    this.#evaluateState()
  }

  // ─── effect subscriptions ────────────────────────────────────

  #ensureEffects = (): void => {
    if (this.#effectsRegistered) return
    this.#effectsRegistered = true

    this.onEffect<{ count: number }>('render:cell-count', ({ count }) => {
      this.#cellCount = count
    })

    this.onEffect<{ signature: string }>('mesh:ensure-started', ({ signature }) => {
      if (signature === this.#currentSig) return
      this.#switchSig(signature)
    })

    const handleToggleAvailable = (preAcquiredStream?: MediaStream): void => {
      this.#localAvailable = !this.#localAvailable
      if (this.#localAvailable) {
        // joining — use pre-acquired stream if provided, otherwise request camera
        if (preAcquiredStream) {
          this.#acceptStream(preAcquiredStream)
        } else {
          void this.#toggleCamera()
        }
      } else {
        this.#endMeeting()
      }
      this.#lastAvailPublishMs = 0 // publish immediately
    }

    const handleToggleCamera = (): void => {
      // camera toggle allowed whenever locally available (not just when active)
      if (!this.#localAvailable) return
      void this.#toggleCamera()
    }

    this.onEffect('meeting:toggle-available', handleToggleAvailable)
    this.onEffect('meeting:toggle-camera', handleToggleCamera)

    // bridge: listen for window custom events from Angular controls bar
    window.addEventListener('meeting:toggle-available', ((e: CustomEvent) => {
      handleToggleAvailable(e.detail?.stream as MediaStream | undefined)
    }) as EventListener)
    window.addEventListener('meeting:toggle-camera', handleToggleCamera)
  }

  #ensureIdentity = (): void => {
    if (this.#publisherId) return
    try {
      this.#publisherId = localStorage.getItem('hc:show-honeycomb:publisher-id') ?? ''
    } catch { /* ignore */ }
  }

  // ─── mesh subscription ───────────────────────────────────────

  #switchSig = (sig: string): void => {
    if (this.#meshSub) {
      try { this.#meshSub.close() } catch { /* ignore */ }
      this.#meshSub = null
    }

    this.#endMeeting()
    this.#availability.clear()
    this.#localAvailable = false
    this.#currentSig = sig

    const mesh = this.resolve<MeshApi>('mesh')
    if (!mesh || typeof mesh.subscribe !== 'function') return

    this.#meshSub = mesh.subscribe(sig, (evt) => this.#onMeshEvent(evt))
  }

  #onMeshEvent = (evt: MeshEvt): void => {
    const p = evt.payload
    if (!p || typeof p.type !== 'string') return

    switch (p.type) {
      case 'meeting-availability':
        this.#handleAvailability(p)
        break
      case 'meeting-signal':
        this.#handleSignal(p)
        break
    }
  }

  // ─── availability ────────────────────────────────────────────

  #handleAvailability = (p: any): void => {
    const id = p.publisherId
    if (!id || typeof id !== 'string') return
    if (id === this.#publisherId) return

    this.#availability.set(id, {
      publisherId: id,
      lastSeenMs: Date.now(),
      cell: p.cell ?? p.seed ?? '',
    })
  }

  #publishAvailability = (): void => {
    if (!this.#localAvailable || !this.#currentSig || !this.#publisherId) return

    const now = Date.now()
    if (now - this.#lastAvailPublishMs < AVAILABILITY_PUBLISH_MS) return
    this.#lastAvailPublishMs = now

    const mesh = this.resolve<MeshApi>('mesh')
    if (!mesh || typeof mesh.publish !== 'function') return

    void mesh.publish(29010, this.#currentSig, {
      type: 'meeting-availability',
      publisherId: this.#publisherId,
      ts: now,
    }, [
      ['publisher', this.#publisherId],
      ['mode', 'meeting-availability'],
    ])
  }

  #pruneExpiredAvailability = (): void => {
    const now = Date.now()
    for (const [id, entry] of this.#availability) {
      if (now - entry.lastSeenMs > AVAILABILITY_TTL_MS) {
        this.#availability.delete(id)
      }
    }
  }

  // ─── state machine ──────────────────────────────────────────

  #evaluateState = (): void => {
    const prev = this.#state

    switch (this.#state) {
      case 'idle':
        if (this.#cellCount >= this.#threshold && this.#localAvailable) {
          this.#setState('gathering')
        }
        break

      case 'gathering': {
        if (!this.#localAvailable) {
          this.#setState('idle')
          break
        }
        // count available peers + self
        const total = this.#availability.size + (this.#localAvailable ? 1 : 0)
        if (total >= this.#threshold) {
          this.#startMeeting()
          this.#setState('active')
        }
        break
      }

      case 'active':
        if (!this.#localAvailable) {
          this.#endMeeting()
          this.#setState('ended')
        }
        break

      case 'ended':
        this.#setState('idle')
        break
    }

    if (this.#state !== prev) {
      this.emitEffect('meeting:state', { state: this.#state, threshold: this.#threshold })
      window.dispatchEvent(new CustomEvent('meeting:state', { detail: { state: this.#state, threshold: this.#threshold } }))
    }
  }

  #setState = (next: MeetingState): void => {
    this.#state = next
  }

  // ─── WebRTC connection management ───────────────────────────

  #startMeeting = (): void => {
    // establish peer connections to all available peers
    for (const [id] of this.#availability) {
      if (this.#peers.has(id)) continue
      this.#createPeerConnection(id, true)
    }
  }

  #endMeeting = (): void => {
    // close all peer connections
    for (const [, peer] of this.#peers) {
      try { peer.pc.close() } catch { /* ignore */ }
    }
    this.#peers.clear()

    // stop local media
    if (this.#localStream) {
      for (const track of this.#localStream.getTracks()) track.stop()
      this.#localStream = null
    }
    this.#cameraOn = false

    this.emitEffect('meeting:streams', { streams: new Map<string, MediaStream>() })
    this.emitEffect('meeting:local-camera', { on: false })
    window.dispatchEvent(new CustomEvent('meeting:local-camera', { detail: { on: false } }))
  }

  #createPeerConnection = (remoteId: string, initiator: boolean): void => {
    const pc = new RTCPeerConnection(RTC_CONFIG)
    const remoteStream = new MediaStream()

    const entry: PeerConnection = { publisherId: remoteId, pc, remoteStream }
    this.#peers.set(remoteId, entry)

    // handle incoming tracks
    pc.ontrack = (e) => {
      for (const track of e.streams[0]?.getTracks() ?? [e.track]) {
        remoteStream.addTrack(track)
      }
      this.#emitStreams()
    }

    // send ICE candidates over mesh
    pc.onicecandidate = (e) => {
      if (!e.candidate) return
      this.#sendSignal(remoteId, {
        subtype: 'ice-candidate',
        candidate: e.candidate.toJSON(),
      })
    }

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        this.#removePeer(remoteId)
      }
    }

    // add local tracks if camera is on
    if (this.#localStream) {
      for (const track of this.#localStream.getTracks()) {
        pc.addTrack(track, this.#localStream)
      }
    }

    if (initiator) {
      // deterministic tie-breaking: lower publisherId initiates
      if (this.#publisherId < remoteId) {
        void this.#createOffer(remoteId, pc)
      }
    }
  }

  #createOffer = async (remoteId: string, pc: RTCPeerConnection): Promise<void> => {
    try {
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      this.#sendSignal(remoteId, { subtype: 'offer', sdp: offer.sdp })
    } catch (e) {
      console.warn('[hive-meeting] offer error:', e)
    }
  }

  #handleSignal = (p: any): void => {
    const from = p.from as string
    const to = p.to as string
    if (!from || !to) return
    if (to !== this.#publisherId) return // not for us
    if (from === this.#publisherId) return

    switch (p.subtype) {
      case 'offer':
        void this.#handleOffer(from, p.sdp)
        break
      case 'answer':
        void this.#handleAnswer(from, p.sdp)
        break
      case 'ice-candidate':
        void this.#handleIceCandidate(from, p.candidate)
        break
    }
  }

  #handleOffer = async (from: string, sdp: string): Promise<void> => {
    if (!this.#peers.has(from)) {
      this.#createPeerConnection(from, false)
    }
    const peer = this.#peers.get(from)
    if (!peer) return

    try {
      await peer.pc.setRemoteDescription({ type: 'offer', sdp })
      const answer = await peer.pc.createAnswer()
      await peer.pc.setLocalDescription(answer)
      this.#sendSignal(from, { subtype: 'answer', sdp: answer.sdp })
    } catch (e) {
      console.warn('[hive-meeting] answer error:', e)
    }
  }

  #handleAnswer = async (from: string, sdp: string): Promise<void> => {
    const peer = this.#peers.get(from)
    if (!peer) return
    try {
      await peer.pc.setRemoteDescription({ type: 'answer', sdp })
    } catch (e) {
      console.warn('[hive-meeting] set-answer error:', e)
    }
  }

  #handleIceCandidate = async (from: string, candidate: any): Promise<void> => {
    const peer = this.#peers.get(from)
    if (!peer) return
    try {
      await peer.pc.addIceCandidate(new RTCIceCandidate(candidate))
    } catch (e) {
      console.warn('[hive-meeting] ice error:', e)
    }
  }

  #sendSignal = (to: string, data: Record<string, any>): void => {
    const mesh = this.resolve<MeshApi>('mesh')
    if (!mesh || typeof mesh.publish !== 'function') return

    void mesh.publish(29010, this.#currentSig, {
      type: 'meeting-signal',
      from: this.#publisherId,
      to,
      ...data,
    }, [
      ['publisher', this.#publisherId],
      ['mode', 'meeting-signal'],
    ])
  }

  #removePeer = (id: string): void => {
    const peer = this.#peers.get(id)
    if (!peer) return
    try { peer.pc.close() } catch { /* ignore */ }
    this.#peers.delete(id)
    this.#emitStreams()
  }

  // ─── camera ──────────────────────────────────────────────────

  /** Accept a pre-acquired MediaStream (from UI user gesture) */
  #acceptStream = (stream: MediaStream): void => {
    if (this.#localStream) {
      for (const track of this.#localStream.getTracks()) track.stop()
    }
    this.#localStream = stream
    this.#cameraOn = true

    // add tracks to all existing peer connections
    for (const [, peer] of this.#peers) {
      for (const track of stream.getTracks()) {
        peer.pc.addTrack(track, stream)
      }
    }

    // renegotiate with all peers
    for (const [id, peer] of this.#peers) {
      if (this.#publisherId < id) {
        void this.#createOffer(id, peer.pc)
      }
    }

    this.emitEffect('meeting:local-camera', { on: true })
    window.dispatchEvent(new CustomEvent('meeting:local-camera', { detail: { on: true } }))
    this.#emitStreams()
  }

  #toggleCamera = async (): Promise<void> => {
    if (this.#cameraOn) {
      // turn off
      if (this.#localStream) {
        for (const track of this.#localStream.getTracks()) track.stop()
        this.#localStream = null
      }
      // remove tracks from all peer connections
      for (const [, peer] of this.#peers) {
        for (const sender of peer.pc.getSenders()) {
          if (sender.track) peer.pc.removeTrack(sender)
        }
      }
      this.#cameraOn = false
    } else {
      // turn on
      try {
        this.#localStream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        })
      } catch (e) {
        console.warn('[hive-meeting] camera access denied:', e)
        this.#cameraOn = false
        this.emitEffect('meeting:local-camera', { on: false })
        window.dispatchEvent(new CustomEvent('meeting:local-camera', { detail: { on: false } }))
        return
      }
      this.#cameraOn = true

      // add tracks to all existing peer connections
      for (const [, peer] of this.#peers) {
        for (const track of this.#localStream.getTracks()) {
          peer.pc.addTrack(track, this.#localStream)
        }
      }

      // renegotiate with all peers
      for (const [id, peer] of this.#peers) {
        if (this.#publisherId < id) {
          void this.#createOffer(id, peer.pc)
        }
      }
    }

    this.emitEffect('meeting:local-camera', { on: this.#cameraOn })
    window.dispatchEvent(new CustomEvent('meeting:local-camera', { detail: { on: this.#cameraOn } }))
    this.#emitStreams()
  }

  #emitStreams = (): void => {
    const streams = new Map<string, MediaStream>()
    for (const [id, peer] of this.#peers) {
      if (peer.remoteStream.getTracks().length > 0) {
        streams.set(id, peer.remoteStream)
      }
    }
    if (this.#localStream && this.#cameraOn) {
      streams.set(this.#publisherId, this.#localStream)
    }
    this.emitEffect('meeting:streams', { streams })
  }

  // ─── public read-only accessors (for IoC consumers) ─────────

  public get meetingState(): MeetingState { return this.#state }
  public get localAvailable(): boolean { return this.#localAvailable }
  public get cameraOn(): boolean { return this.#cameraOn }
  public get peerCount(): number { return this.#peers.size }

  // ─── cleanup ─────────────────────────────────────────────────

  protected override dispose = (): void => {
    this.#endMeeting()
    if (this.#meshSub) {
      try { this.#meshSub.close() } catch { /* ignore */ }
    }
  }
}

const _hiveMeeting = new HiveMeetingDrone()
window.ioc.register('@diamondcoreprocessor.com/HiveMeetingDrone', _hiveMeeting)
