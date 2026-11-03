// sharing/device-rtc.ts
//
// A WEBRTC DATA CHANNEL BETWEEN TWO OF A PARTICIPANT'S DEVICES, dressed as the
// `LinkChannel` device-link.ts speaks over. It does the choreography and nothing
// else: one side DIALS (offer), the other ANSWERS, candidates cross as they are
// found, and when the channel opens it is handed over. Who may be dialled, what
// is said over the channel and what is trusted are not decided here.
//
// The only network a connection may reach besides the peer itself is
// `stun.cloudflare.com` — the single STUN server the web shell's outgoing
// firewall admits (hypercomb-web/src/setup/outgoing-firewall.ts), the same one
// the meeting uses. With no TURN server a pair of devices behind strict NATs
// will not connect; they will say so (a null channel), not fall back to
// relaying the participant's bytes through someone's server.

import type { LinkChannel } from './device-link.js'
import { newSession, type SignalMessage } from './device-signal.js'

export const ICE_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }],
}

/** How long to wait for a channel to open before saying the peer cannot be reached. */
export const CONNECT_MS = 20_000

/** The parts of an RTCPeerConnection this file uses — what a test stands in for. */
export interface RtcPeerLike {
  createDataChannel(label: string, init?: RTCDataChannelInit): RtcChannelLike
  createOffer(): Promise<RTCSessionDescriptionInit>
  createAnswer(): Promise<RTCSessionDescriptionInit>
  setLocalDescription(description: RTCSessionDescriptionInit): Promise<void>
  setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void>
  addIceCandidate(candidate: RTCIceCandidateInit): Promise<void>
  close(): void
  onicecandidate: ((event: { candidate: { toJSON(): RTCIceCandidateInit } | null }) => void) | null
  ondatachannel: ((event: { channel: RtcChannelLike }) => void) | null
  onconnectionstatechange: (() => void) | null
  readonly connectionState: string
}

export interface RtcChannelLike {
  readonly label: string
  readonly readyState: string
  send(text: string): void
  close(): void
  onopen: (() => void) | null
  onmessage: ((event: { data: unknown }) => void) | null
  onclose: (() => void) | null
}

export type RtcSignaler = {
  send(peer: string, message: SignalMessage): Promise<boolean>
  listen(
    allow: (from: string) => boolean,
    onMessage: (from: string, message: SignalMessage) => void,
  ): Promise<() => void>
}

export type RtcOptions = {
  createPeer?: () => RtcPeerLike
  connectMs?: number
}

const LABEL = 'hc-sync'

const defaultPeer = (): RtcPeerLike => new RTCPeerConnection(ICE_CONFIG) as unknown as RtcPeerLike

/**
 * A data channel as a LinkChannel: text frames only; anything else is ignored.
 *
 * The channel is open before anyone has attached to it, and the other end may
 * speak the moment it is (it does: both ends say hello). Frames that arrive
 * with no handler yet are HELD and handed over, in order, when one is attached —
 * as is a close that came first.
 */
const asLink = (channel: RtcChannelLike, peer: RtcPeerLike): LinkChannel => {
  let onmessage: ((text: string) => void) | null = null
  let onclose: (() => void) | null = null
  const early: string[] = []
  let closed = false
  const link: LinkChannel = {
    send: text => channel.send(text),
    close: () => { try { channel.close() } catch { /* closing */ } try { peer.close() } catch { /* closing */ } },
    get onmessage() { return onmessage },
    set onmessage(handler) {
      onmessage = handler
      if (handler) for (const text of early.splice(0)) handler(text)
    },
    get onclose() { return onclose },
    set onclose(handler) {
      onclose = handler
      if (handler && closed) handler()
    },
  }
  channel.onmessage = event => {
    if (typeof event.data !== 'string') return
    if (onmessage) onmessage(event.data)
    else if (early.length < 64) early.push(event.data)
  }
  channel.onclose = () => { closed = true; onclose?.() }
  return link
}

/**
 * One end of one attempt: candidates that arrive before the remote description
 * are held and applied after it, which is the order the browser requires and
 * the order the network does not promise.
 */
class Session {
  readonly peer: RtcPeerLike
  readonly id: string
  readonly #queued: RTCIceCandidateInit[] = []
  readonly #outgoing: RTCIceCandidateInit[] = []
  readonly #send: (candidate: RTCIceCandidateInit) => void
  #remote = false
  #sent = false

  constructor(peer: RtcPeerLike, id: string, remotePeer: string, signaler: RtcSignaler) {
    this.peer = peer
    this.id = id
    this.#send = candidate => { void signaler.send(remotePeer, { t: 'ice', session: id, d: candidate }) }
    // A candidate is found the moment the local description is set — before the
    // offer or answer that carries it has been sealed and sent. Sent first, it
    // would reach a peer that has no such session yet. So it waits for `sent()`.
    peer.onicecandidate = event => {
      if (!event.candidate) return
      const candidate = event.candidate.toJSON()
      if (this.#sent) this.#send(candidate)
      else this.#outgoing.push(candidate)
    }
  }

  /** The offer or answer is on its way: let the candidates that waited follow it. */
  sent(): void {
    this.#sent = true
    for (const candidate of this.#outgoing.splice(0)) this.#send(candidate)
  }

  async remoteDescription(description: RTCSessionDescriptionInit): Promise<void> {
    await this.peer.setRemoteDescription(description)
    this.#remote = true
    for (const candidate of this.#queued.splice(0)) await this.peer.addIceCandidate(candidate).catch(() => {})
  }

  async candidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (!this.#remote) { this.#queued.push(candidate); return }
    await this.peer.addIceCandidate(candidate).catch(() => {})
  }
}

/**
 * Open a channel to `peer`. Null when it cannot be reached within the time —
 * the peer is offline, not listening, or behind a NAT a STUN server cannot
 * cross.
 */
export const dial = async (
  signaler: RtcSignaler,
  peer: string,
  options: RtcOptions = {},
): Promise<LinkChannel | null> => {
  const pc = (options.createPeer ?? defaultPeer)()
  const id = newSession()
  const session = new Session(pc, id, peer, signaler)
  const channel = pc.createDataChannel(LABEL, { ordered: true })

  return new Promise<LinkChannel | null>(resolve => {
    let done = false
    let stop: () => void = () => {}
    const finish = (result: LinkChannel | null): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      stop()
      if (!result) { try { pc.close() } catch { /* closing */ } }
      resolve(result)
    }
    const timer = setTimeout(() => finish(null), options.connectMs ?? CONNECT_MS)

    channel.onopen = () => finish(asLink(channel, pc))
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed') finish(null) }

    void signaler.listen(from => from === peer, (from, message) => {
      if (from !== peer || message.session !== id) return
      if (message.t === 'answer') void session.remoteDescription(message.d as RTCSessionDescriptionInit).catch(() => finish(null))
      else if (message.t === 'ice') void session.candidate(message.d as RTCIceCandidateInit)
      else if (message.t === 'bye') finish(null)
    }).then(async unlisten => {
      stop = unlisten
      if (done) { unlisten(); return }
      // Listening first: an answer that comes back fast must not slip past.
      try {
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        if (!(await signaler.send(peer, { t: 'offer', session: id, d: offer }))) finish(null)
        else session.sent()
      } catch { finish(null) }
    })
  })
}

/**
 * Answer whoever `allow` admits. Each offer opens one session; `onChannel` is
 * handed the channel once it is open. Returns the function that stops answering.
 */
export const answer = async (
  signaler: RtcSignaler,
  allow: (from: string) => boolean,
  onChannel: (peer: string, channel: LinkChannel) => void,
  options: RtcOptions = {},
): Promise<() => void> => {
  const sessions = new Map<string, Session>()
  // Candidates can beat their offer across a relay. Hold a few, for a few
  // sessions, until the offer arrives; a flood of unknown sessions is dropped.
  const early = new Map<string, RTCIceCandidateInit[]>()

  const stop = await signaler.listen(allow, (from, message) => {
    const key = `${from}:${message.session}`
    if (message.t === 'offer') {
      if (sessions.has(key)) return
      const pc = (options.createPeer ?? defaultPeer)()
      const session = new Session(pc, message.session, from, signaler)
      sessions.set(key, session)
      for (const candidate of early.get(key) ?? []) void session.candidate(candidate)
      early.delete(key)
      const forget = (): void => { sessions.delete(key) }
      const timer = setTimeout(() => { forget(); try { pc.close() } catch { /* closing */ } }, options.connectMs ?? CONNECT_MS)
      pc.ondatachannel = event => {
        const channel = event.channel
        if (channel.label !== LABEL) return
        const open = (): void => { clearTimeout(timer); onChannel(from, asLink(channel, pc)) }
        if (channel.readyState === 'open') open()
        else channel.onopen = open
      }
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed') { clearTimeout(timer); forget(); try { pc.close() } catch { /* closing */ } }
      }
      void (async () => {
        try {
          await session.remoteDescription(message.d as RTCSessionDescriptionInit)
          const reply = await pc.createAnswer()
          await pc.setLocalDescription(reply)
          if (await signaler.send(from, { t: 'answer', session: message.session, d: reply })) session.sent()
        } catch { clearTimeout(timer); forget(); try { pc.close() } catch { /* closing */ } }
      })()
    } else if (message.t === 'ice') {
      const session = sessions.get(key)
      if (session) { void session.candidate(message.d as RTCIceCandidateInit); return }
      const held = early.get(key) ?? []
      if (held.length >= 16 || (!early.has(key) && early.size >= 8)) return
      held.push(message.d as RTCIceCandidateInit)
      early.set(key, held)
    } else if (message.t === 'bye') {
      sessions.get(key)?.peer.close()
      sessions.delete(key)
    }
  })
  return stop
}
