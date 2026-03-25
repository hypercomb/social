// diamondcoreprocessor.com/meeting/meeting-peer.ts

/**
 * WebRTC peer connection wrapper for HypercombMeeting.
 *
 * Features:
 *  - Simulcast: 3 quality layers (low/mid/high)
 *  - Adaptive bitrate: polls RTCStatsReport every 2s
 *  - Opus tuning: 48kHz, 64kbps, DTX, echo cancellation
 */

export type PeerCallbacks = {
  onRemoteStream: (stream: MediaStream) => void
  onIceCandidate: (candidate: RTCIceCandidateInit) => void
  onDisconnected: () => void
}

const ICE_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
}

const SIMULCAST_ENCODINGS: RTCRtpEncodingParameters[] = [
  { rid: 'low',  maxBitrate: 150_000, scaleResolutionDownBy: 4 },
  { rid: 'mid',  maxBitrate: 500_000, scaleResolutionDownBy: 2 },
  { rid: 'high', maxBitrate: 1_500_000 },
]

const STATS_INTERVAL_MS = 2_000
const LOSS_THRESHOLD = 0.05
const JITTER_THRESHOLD = 0.050  // 50ms

export class MeetingPeer {
  #pc: RTCPeerConnection
  #remotePeerId: string
  #remoteStream: MediaStream | null = null
  #callbacks: PeerCallbacks
  #statsTimer: number | null = null
  #lastPacketsReceived = 0
  #lastPacketsLost = 0

  constructor(remotePeerId: string, localStream: MediaStream, callbacks: PeerCallbacks) {
    this.#remotePeerId = remotePeerId
    this.#callbacks = callbacks
    this.#pc = new RTCPeerConnection(ICE_CONFIG)

    // add local tracks with simulcast
    for (const track of localStream.getTracks()) {
      if (track.kind === 'video') {
        this.#pc.addTransceiver(track, {
          direction: 'sendrecv',
          sendEncodings: SIMULCAST_ENCODINGS,
          streams: [localStream],
        })
      } else {
        this.#pc.addTrack(track, localStream)
      }
    }

    // receive remote tracks
    this.#pc.ontrack = (e) => {
      if (!this.#remoteStream) {
        this.#remoteStream = new MediaStream()
        this.#callbacks.onRemoteStream(this.#remoteStream)
      }
      this.#remoteStream.addTrack(e.track)
    }

    // ICE candidates
    this.#pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.#callbacks.onIceCandidate(e.candidate.toJSON())
      }
    }

    // connection state
    this.#pc.onconnectionstatechange = () => {
      const state = this.#pc.connectionState
      if (state === 'disconnected' || state === 'failed' || state === 'closed') {
        this.#callbacks.onDisconnected()
      }
    }

    // tune Opus after connection
    this.#pc.onconnectionstatechange = () => {
      if (this.#pc.connectionState === 'connected') {
        this.#tuneOpus()
        this.#startStatsMonitor()
      }
    }
  }

  get remotePeerId(): string { return this.#remotePeerId }
  get remoteStream(): MediaStream | null { return this.#remoteStream }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    const offer = await this.#pc.createOffer()
    await this.#pc.setLocalDescription(offer)
    return offer
  }

  async acceptOffer(sdp: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> {
    await this.#pc.setRemoteDescription(sdp)
    const answer = await this.#pc.createAnswer()
    await this.#pc.setLocalDescription(answer)
    return answer
  }

  async acceptAnswer(sdp: RTCSessionDescriptionInit): Promise<void> {
    await this.#pc.setRemoteDescription(sdp)
  }

  async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    await this.#pc.addIceCandidate(candidate)
  }

  close(): void {
    if (this.#statsTimer != null) {
      clearInterval(this.#statsTimer)
      this.#statsTimer = null
    }
    this.#pc.close()
    this.#remoteStream = null
  }

  // ── Opus tuning ──────────────────────────────────────────

  #tuneOpus(): void {
    const sender = this.#pc.getSenders().find(s => s.track?.kind === 'audio')
    if (!sender) return

    const params = sender.getParameters()
    if (!params.encodings?.length) return

    params.encodings[0].maxBitrate = 64_000
    // @ts-expect-error -- dtx is valid for Opus but not in all TS defs
    params.encodings[0].dtx = true
    sender.setParameters(params).catch(() => { /* best effort */ })
  }

  // ── adaptive bitrate ─────────────────────────────────────

  #startStatsMonitor(): void {
    this.#statsTimer = setInterval(() => this.#checkStats(), STATS_INTERVAL_MS) as unknown as number
  }

  async #checkStats(): Promise<void> {
    try {
      const stats = await this.#pc.getStats()
      let totalPacketsReceived = 0
      let totalPacketsLost = 0
      let jitter = 0

      stats.forEach((report) => {
        if (report.type === 'inbound-rtp' && report.kind === 'video') {
          totalPacketsReceived += report.packetsReceived ?? 0
          totalPacketsLost += report.packetsLost ?? 0
          jitter = Math.max(jitter, report.jitter ?? 0)
        }
      })

      const deltaReceived = totalPacketsReceived - this.#lastPacketsReceived
      const deltaLost = totalPacketsLost - this.#lastPacketsLost
      this.#lastPacketsReceived = totalPacketsReceived
      this.#lastPacketsLost = totalPacketsLost

      if (deltaReceived <= 0) return

      const lossRate = deltaLost / (deltaReceived + deltaLost)

      // request appropriate simulcast layer from senders
      const senders = this.#pc.getSenders().filter(s => s.track?.kind === 'video')
      for (const sender of senders) {
        const params = sender.getParameters()
        if (!params.encodings?.length) continue

        if (lossRate > LOSS_THRESHOLD || jitter > JITTER_THRESHOLD) {
          // degrade: disable high layer
          for (const enc of params.encodings) {
            if (enc.rid === 'high') enc.active = false
            if (lossRate > LOSS_THRESHOLD * 2 && enc.rid === 'mid') enc.active = false
          }
        } else {
          // recover: enable all layers
          for (const enc of params.encodings) enc.active = true
        }
        sender.setParameters(params).catch(() => { /* best effort */ })
      }
    } catch { /* stats unavailable */ }
  }
}
