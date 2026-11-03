// sharing/device-link.ts
//
// THE CONVERSATION TWO OF A PARTICIPANT'S DEVICES HAVE once something carries
// text between them (documentation/device-sync.md). It does not know whether
// that something is a WebRTC data channel, a socket or a test's in-memory pipe:
// it takes a `LinkChannel` and speaks three things over it.
//
//   1. THE PROOF — both sides send `hello` (their key and a fresh challenge),
//      each answers the other's challenge with a `proof` (device-handshake.ts),
//      each tells the other `ok` once it accepts. Nothing else is honoured
//      before that: a `get` from a peer that has not proved it belongs to the
//      same participant is answered with `deny` and the channel is closed.
//   2. THE ASK — `get` names one signature and the peer answers `atom` (the
//      bytes, in chunks small enough for a data channel) or `none`.
//   3. NOTHING ELSE. There is no push: a device only ever asks for what it
//      lacks, which is how replication already works (install-by-replication.md).
//
// A link serves only what its owner's store reads for a bare signature, and a
// reader admits what it fetched through the replication walker, which hashes
// every atom against its own name. So an authenticated peer still cannot slip
// a wrong byte into the heap — authentication decides who may ASK, content
// addressing decides what is TRUE.

import {
  newChallenge,
  proveDevice,
  verifyDeviceProof,
  type ProofFailure,
} from './device-handshake.js'
import type { EventSigner, NostrEventLike } from './device-delegation.js'

/** One lineage bag's head: the highest marker's name and the layer it names. */
export type BagHead = { bag: string; name: string; layer: string }

/** What a link serves its peer, all by bare signature or bag. `heads` and `marker` are optional: a device
 *  that serves only atoms (the first generation) still answers `get`. */
export type Serve = ((signature: string) => Promise<Uint8Array | null>) | {
  atom(signature: string): Promise<Uint8Array | null>
  heads?(): Promise<BagHead[]>
  marker?(bag: string, name: string): Promise<string | null>
}

/** Rows per `heads` page — a few hundred bytes each, so a page stays well inside a data-channel message. */
export const HEADS_PAGE = 200
/** The most heads a link will assemble from one peer. */
export const MAX_HEADS = 200_000

/** What a link needs of a pipe. WebRTC's data channel satisfies this through device-rtc.ts. */
export interface LinkChannel {
  send(text: string): void
  close(): void
  onmessage: ((text: string) => void) | null
  onclose: (() => void) | null
}

export type LinkIdentity = {
  signer: EventSigner
  /** This device's key. */
  self: string
  /** The participant both devices belong to. */
  master: string
  /** This device's own grant; null on the master device. */
  grant: NostrEventLike | null
  /** Every master-signed event this device knows (device-pairing.ts `knownEvents`). */
  known: () => readonly NostrEventLike[]
}

export type LinkOptions = {
  /** The device signalling said this is; a hello from anyone else is turned away. */
  expectedPeer?: string
  handshakeMs?: number
  fetchMs?: number
  now?: () => number
}

export type LinkFailure = ProofFailure | 'timeout' | 'closed' | 'wrong peer' | 'denied' | 'protocol'

export type LinkVerdict =
  | { ok: true; peer: string; via: 'master' | 'delegation' }
  | { ok: false; reason: LinkFailure }

/** Raw bytes per `atom` frame. Base64 makes it ~16 KB on the wire — inside every data-channel limit. */
export const CHUNK_BYTES = 12 * 1024
/** The largest atom a link will assemble. */
export const MAX_ATOM_BYTES = 16 * 1024 * 1024

const HEX64 = /^[0-9a-f]{64}$/

const toBase64 = (bytes: Uint8Array): string => {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

const fromBase64 = (text: string): Uint8Array<ArrayBuffer> | null => {
  try {
    const binary = atob(text)
    const out = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
    return out
  } catch { return null }
}

type Pending = {
  chunks: (Uint8Array<ArrayBuffer> | undefined)[]
  total: number
  received: number
  bytes: number
  resolve: (bytes: Uint8Array<ArrayBuffer> | null) => void
  timer: ReturnType<typeof setTimeout>
}

/** An ask whose answer is not bytes: the peer's heads (in pages) or one marker's layer. */
type PendingRows = {
  kind: 'heads' | 'marker'
  pages: (string[][] | undefined)[]
  total: number
  received: number
  rows: number
  resolve: (answer: BagHead[] | string | null) => void
  timer: ReturnType<typeof setTimeout>
}

export class DeviceLink {
  readonly #channel: LinkChannel
  readonly #id: LinkIdentity
  readonly #serve: Exclude<Serve, (...args: never[]) => unknown>
  readonly #options: LinkOptions
  readonly #challenge = newChallenge()
  readonly #pending = new Map<number, Pending>()
  readonly #pendingRows = new Map<number, PendingRows>()
  #nextId = 1
  #peerKey: string | null = null
  #peerProved = false
  #peerAccepted = false
  #answered = false
  #settled = false
  #resolve!: (verdict: LinkVerdict) => void
  #timer: ReturnType<typeof setTimeout> | null = null

  /** Settles once both sides have accepted each other, or the link fails. */
  readonly ready: Promise<LinkVerdict>

  constructor(
    channel: LinkChannel,
    identity: LinkIdentity,
    serve: Serve,
    options: LinkOptions = {},
  ) {
    this.#channel = channel
    this.#id = identity
    this.#serve = typeof serve === 'function' ? { atom: serve } : serve
    this.#options = options
    this.ready = new Promise(resolve => { this.#resolve = resolve })
    channel.onmessage = text => { void this.#receive(text) }
    channel.onclose = () => this.#fail('closed')
    this.#timer = setTimeout(() => this.#fail('timeout'), options.handshakeMs ?? 15_000)
  }

  /** Say hello. Call once the channel is open; both ends call it. */
  start(): void {
    this.#send({ t: 'hello', key: this.#id.self, challenge: this.#challenge })
  }

  get peer(): string | null { return this.#peerProved && this.#peerAccepted ? this.#peerKey : null }

  /** Ask the peer for one signature. Null when it has nothing, would not, or the link is not up. */
  fetch(signature: string): Promise<Uint8Array<ArrayBuffer> | null> {
    if (!this.peer || !HEX64.test(signature)) return Promise.resolve(null)
    const id = this.#nextId++
    return new Promise(resolve => {
      const timer = setTimeout(() => this.#settle(id, null), this.#options.fetchMs ?? 20_000)
      this.#pending.set(id, { chunks: [], total: -1, received: 0, bytes: 0, resolve, timer })
      this.#send({ t: 'get', id, sig: signature })
    })
  }

  /** Ask the peer for the head of every lineage bag it holds. Null when it would not, or the link is not up. */
  heads(): Promise<BagHead[] | null> {
    if (!this.peer) return Promise.resolve(null)
    return this.#askRows('heads', { t: 'heads?' }) as Promise<BagHead[] | null>
  }

  /** Ask the peer which layer one marker of a bag names. Null when it has no such marker. */
  marker(bag: string, name: string): Promise<string | null> {
    if (!this.peer || !HEX64.test(bag) || !/^\d{8}$/.test(name)) return Promise.resolve(null)
    return this.#askRows('marker', { t: 'marker?', bag, name }) as Promise<string | null>
  }

  #askRows(kind: 'heads' | 'marker', frame: Record<string, unknown>): Promise<BagHead[] | string | null> {
    const id = this.#nextId++
    return new Promise(resolve => {
      const timer = setTimeout(() => this.#settleRows(id, null), (this.#options.fetchMs ?? 20_000) * (kind === 'heads' ? 3 : 1))
      this.#pendingRows.set(id, { kind, pages: [], total: -1, received: 0, rows: 0, resolve, timer })
      this.#send({ ...frame, id })
    })
  }

  close(): void {
    this.#fail('closed')
  }

  // --- receiving -------------------------------------------------------------

  async #receive(text: string): Promise<void> {
    if (this.#settled && !this.peer) return
    let frame: any
    try { frame = JSON.parse(text) } catch { return this.#fail('protocol') }
    if (!frame || typeof frame !== 'object') return this.#fail('protocol')

    switch (frame.t) {
      case 'hello': return this.#onHello(frame)
      case 'proof': return this.#onProof(frame)
      case 'ok': this.#peerAccepted = true; return this.#maybeReady()
      case 'deny': return this.#fail('denied')
      case 'get': return this.#onGet(frame)
      case 'atom': return this.#onAtom(frame)
      case 'heads?': return this.#onHeads(frame)
      case 'heads': return this.#onHeadsPage(frame)
      case 'marker?': return this.#onMarker(frame)
      case 'marker': return this.#settleRows(Number(frame.id), typeof frame.layer === 'string' && HEX64.test(frame.layer) ? frame.layer : null)
      case 'none': this.#settleRows(Number(frame.id), null); return this.#settle(Number(frame.id), null)
      default: return this.#fail('protocol')
    }
  }

  async #onHello(frame: { key?: unknown; challenge?: unknown }): Promise<void> {
    if (this.#answered) return this.#fail('protocol')
    const key = String(frame.key ?? '').toLowerCase()
    const challenge = String(frame.challenge ?? '')
    if (!HEX64.test(key) || !HEX64.test(challenge)) return this.#fail('protocol')
    if (this.#options.expectedPeer && key !== this.#options.expectedPeer.toLowerCase()) return this.#deny('wrong peer')
    this.#answered = true
    this.#peerKey = key
    // Answer the peer's question — bound to the peer's key, so it cannot be replayed on.
    const proof = await proveDevice(this.#id.signer, { challenge, verifier: key, delegation: this.#id.grant, now: this.#now() })
    if (!proof) return this.#deny('protocol')
    this.#send({ t: 'proof', event: proof })
  }

  async #onProof(frame: { event?: NostrEventLike }): Promise<void> {
    if (this.#peerProved || !this.#peerKey) return this.#fail('protocol')
    const verdict = verifyDeviceProof(frame.event, {
      challenge: this.#challenge,
      self: this.#id.self,
      master: this.#id.master,
      now: this.#now(),
      known: this.#id.known(),
    })
    if (!verdict.ok) return this.#deny(verdict.reason)
    // The key that proved must be the key that said hello.
    if (verdict.device !== this.#peerKey) return this.#deny('wrong peer')
    this.#peerProved = true
    this.#send({ t: 'ok' })
    this.#maybeReady()
  }

  async #onGet(frame: { id?: unknown; sig?: unknown }): Promise<void> {
    // Nothing is served to a peer that has not proved it belongs to the participant.
    if (!this.#peerProved) return this.#deny('protocol')
    const id = Number(frame.id)
    const sig = String(frame.sig ?? '')
    if (!Number.isInteger(id) || !HEX64.test(sig)) return this.#fail('protocol')
    let bytes: Uint8Array | null = null
    try { bytes = await this.#serve.atom(sig) } catch { bytes = null }
    if (!bytes || bytes.length > MAX_ATOM_BYTES) { this.#send({ t: 'none', id }); return }
    const total = Math.max(1, Math.ceil(bytes.length / CHUNK_BYTES))
    for (let i = 0; i < total; i++) {
      this.#send({ t: 'atom', id, i, n: total, d: toBase64(bytes.subarray(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES)) })
    }
  }

  #onAtom(frame: { id?: unknown; i?: unknown; n?: unknown; d?: unknown }): void {
    const id = Number(frame.id)
    const pending = this.#pending.get(id)
    if (!pending) return // an answer to nothing we asked
    const i = Number(frame.i)
    const n = Number(frame.n)
    const chunk = typeof frame.d === 'string' ? fromBase64(frame.d) : null
    if (!chunk || !Number.isInteger(i) || !Number.isInteger(n) || n < 1 || i < 0 || i >= n
        || n > Math.ceil(MAX_ATOM_BYTES / CHUNK_BYTES) || (pending.total !== -1 && pending.total !== n)) {
      return this.#settle(id, null)
    }
    pending.total = n
    if (!pending.chunks[i]) { pending.chunks[i] = chunk; pending.received += 1; pending.bytes += chunk.length }
    if (pending.bytes > MAX_ATOM_BYTES) return this.#settle(id, null)
    if (pending.received < n) return
    const whole = new Uint8Array(pending.bytes)
    let offset = 0
    for (const part of pending.chunks) { whole.set(part!, offset); offset += part!.length }
    this.#settle(id, whole)
  }

  async #onHeads(frame: { id?: unknown }): Promise<void> {
    if (!this.#peerProved) return this.#deny('protocol')
    const id = Number(frame.id)
    if (!Number.isInteger(id)) return this.#fail('protocol')
    let rows: BagHead[] = []
    try { rows = (await this.#serve.heads?.()) ?? [] } catch { rows = [] }
    if (!this.#serve.heads) { this.#send({ t: 'none', id }); return }
    rows = rows.filter(row => HEX64.test(row.bag) && /^\d{8}$/.test(row.name) && HEX64.test(row.layer)).slice(0, MAX_HEADS)
    const total = Math.max(1, Math.ceil(rows.length / HEADS_PAGE))
    for (let i = 0; i < total; i++) {
      this.#send({ t: 'heads', id, i, n: total, rows: rows.slice(i * HEADS_PAGE, (i + 1) * HEADS_PAGE).map(row => [row.bag, row.name, row.layer]) })
    }
  }

  #onHeadsPage(frame: { id?: unknown; i?: unknown; n?: unknown; rows?: unknown }): void {
    const id = Number(frame.id)
    const pending = this.#pendingRows.get(id)
    if (!pending || pending.kind !== 'heads') return
    const i = Number(frame.i)
    const n = Number(frame.n)
    const rows = Array.isArray(frame.rows) ? (frame.rows as unknown[]).filter((row): row is string[] =>
      Array.isArray(row) && row.length === 3 && HEX64.test(String(row[0])) && /^\d{8}$/.test(String(row[1])) && HEX64.test(String(row[2]))) : null
    if (!rows || !Number.isInteger(i) || !Number.isInteger(n) || n < 1 || i < 0 || i >= n
        || n > Math.ceil(MAX_HEADS / HEADS_PAGE) || (pending.total !== -1 && pending.total !== n)) {
      return this.#settleRows(id, null)
    }
    pending.total = n
    if (!pending.pages[i]) { pending.pages[i] = rows; pending.received += 1; pending.rows += rows.length }
    if (pending.rows > MAX_HEADS) return this.#settleRows(id, null)
    if (pending.received < n) return
    this.#settleRows(id, pending.pages.flat().map(row => ({ bag: row![0]!, name: row![1]!, layer: row![2]! })))
  }

  async #onMarker(frame: { id?: unknown; bag?: unknown; name?: unknown }): Promise<void> {
    if (!this.#peerProved) return this.#deny('protocol')
    const id = Number(frame.id)
    const bag = String(frame.bag ?? '')
    const name = String(frame.name ?? '')
    if (!Number.isInteger(id) || !HEX64.test(bag) || !/^\d{8}$/.test(name)) return this.#fail('protocol')
    let layer: string | null = null
    try { layer = (await this.#serve.marker?.(bag, name)) ?? null } catch { layer = null }
    if (layer && HEX64.test(layer)) this.#send({ t: 'marker', id, layer })
    else this.#send({ t: 'none', id })
  }

  // --- settling --------------------------------------------------------------

  #settleRows(id: number, answer: BagHead[] | string | null): void {
    const pending = this.#pendingRows.get(id)
    if (!pending) return
    clearTimeout(pending.timer)
    this.#pendingRows.delete(id)
    pending.resolve(answer)
  }

  #settle(id: number, bytes: Uint8Array<ArrayBuffer> | null): void {
    const pending = this.#pending.get(id)
    if (!pending) return
    clearTimeout(pending.timer)
    this.#pending.delete(id)
    pending.resolve(bytes)
  }

  #maybeReady(): void {
    if (this.#settled || !this.#peerProved || !this.#peerAccepted || !this.#peerKey) return
    this.#settled = true
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = null
    this.#resolve({ ok: true, peer: this.#peerKey, via: this.#id.grant ? 'delegation' : 'master' })
  }

  #deny(reason: LinkFailure): void {
    this.#send({ t: 'deny', reason })
    this.#fail(reason)
  }

  #fail(reason: LinkFailure): void {
    for (const id of [...this.#pending.keys()]) this.#settle(id, null)
    for (const id of [...this.#pendingRows.keys()]) this.#settleRows(id, null)
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = null
    this.#peerProved = false
    this.#peerAccepted = false
    if (!this.#settled) { this.#settled = true; this.#resolve({ ok: false, reason }) }
    try { this.#channel.close() } catch { /* already closed */ }
  }

  #send(frame: Record<string, unknown>): void {
    try { this.#channel.send(JSON.stringify(frame)) } catch { /* the close handler settles it */ }
  }

  #now(): number { return this.#options.now ? this.#options.now() : Math.floor(Date.now() / 1000) }
}

/**
 * A `ReplicationIo` (hypercomb-runtime/src/replication-walker.ts) whose `fetch`
 * asks the peer: `replicate(root)` then pulls from the other device and admits
 * through the walker, which hashes every atom against its name.
 */
export const peerIo = (
  link: DeviceLink,
  local: {
    read(signature: string): Promise<Uint8Array<ArrayBuffer> | null>
    write(signature: string, bytes: Uint8Array<ArrayBuffer>): Promise<void>
  },
): {
  read(signature: string): Promise<Uint8Array<ArrayBuffer> | null>
  fetch(signature: string): Promise<Uint8Array<ArrayBuffer> | null>
  write(signature: string, bytes: Uint8Array<ArrayBuffer>): Promise<void>
} => ({
  read: signature => local.read(signature),
  fetch: signature => link.fetch(signature),
  write: (signature, bytes) => local.write(signature, bytes),
})
