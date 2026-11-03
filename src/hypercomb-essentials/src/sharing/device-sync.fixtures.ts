// sharing/device-sync.fixtures.ts — test doubles shared by the device-sync
// specs: an in-memory origin-private filesystem, a store over it, a relay, and
// WebRTC peers that link through their descriptions. Nothing here ships: no
// production file imports it.

import { SignatureService } from '@hypercomb/core'

// --- an in-memory FileSystemDirectoryHandle ----------------------------------

const domError = (name: string) => new DOMException(name, name)

export class MemFile {
  readonly kind = 'file' as const
  bytes = new Uint8Array(0)
  constructor(readonly name: string) {}
  async getFile() {
    const bytes = this.bytes
    return {
      size: bytes.length,
      text: async () => new TextDecoder().decode(bytes),
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    }
  }
  async createWritable() {
    let written = new Uint8Array(0)
    return {
      write: async (data: ArrayBuffer | Uint8Array) => { written = new Uint8Array(data instanceof Uint8Array ? data : new Uint8Array(data)) },
      close: async () => { this.bytes = written },
      abort: async () => {},
    }
  }
}

export class MemDir {
  readonly kind = 'directory' as const
  readonly children = new Map<string, MemFile | MemDir>()
  constructor(readonly name = '') {}
  async *entries(): AsyncIterable<[string, MemFile | MemDir]> { for (const entry of [...this.children]) yield entry }
  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<MemDir> {
    const found = this.children.get(name)
    if (found) { if (found.kind !== 'directory') throw domError('TypeMismatchError'); return found }
    if (!options?.create) throw domError('NotFoundError')
    const made = new MemDir(name); this.children.set(name, made); return made
  }
  async getFileHandle(name: string, options?: { create?: boolean }): Promise<MemFile> {
    const found = this.children.get(name)
    if (found) { if (found.kind !== 'file') throw domError('TypeMismatchError'); return found }
    if (!options?.create) throw domError('NotFoundError')
    const made = new MemFile(name); this.children.set(name, made); return made
  }
}

// --- a store over it: just what device sync and pairing touch -----------------

export const sha = async (bytes: Uint8Array): Promise<string> =>
  SignatureService.sign(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)

export const memStore = () => {
  const root = new MemDir('root')
  const docs = new Map<string, ArrayBuffer>()
  const handle = (meaning: string) => ({ name: meaning }) as unknown as FileSystemDirectoryHandle
  return {
    root,
    hypercombRoot: root as unknown as FileSystemDirectoryHandle,
    initialize: async () => {},
    async getResourceLocal(signature: string): Promise<Blob | null> {
      try {
        const file = await root.getFileHandle(signature)
        return file.bytes.length ? new Blob([file.bytes]) : null
      } catch { return null }
    },
    async putResource(blob: Blob): Promise<string> {
      const bytes = new Uint8Array(await blob.arrayBuffer())
      const signature = await sha(bytes)
      const file = await root.getFileHandle(signature, { create: true })
      file.bytes = bytes
      return signature
    },
    // pools of documents, for the pairing record
    openPool: async (meaning: string) => docs.has(meaning) ? handle(meaning) : null,
    getPool: async (meaning: string) => handle(meaning),
    getPoolDoc: async (pool: { name: string } | undefined) => (pool ? docs.get(pool.name) : null) ?? null,
    putPoolDoc: async (pool: { name: string }, bytes: ArrayBuffer) => { docs.set(pool.name, bytes); return 'f'.repeat(64) },
  }
}

/** Put text into the store as an atom; returns its signature. */
export const putAtom = async (store: ReturnType<typeof memStore>, text: string): Promise<string> =>
  store.putResource(new Blob([new TextEncoder().encode(text)]))

/** Lay a marker file down by hand — how a lineage looks on disk. */
export const lay = async (store: ReturnType<typeof memStore>, bag: string, index: number, layer: string): Promise<void> => {
  const dir = await store.root.getDirectoryHandle(bag, { create: true })
  const file = await dir.getFileHandle(String(index).padStart(8, '0'), { create: true })
  file.bytes = new TextEncoder().encode(JSON.stringify({ layer }))
}

export const markersOf = (store: ReturnType<typeof memStore>, bag: string): string[] => {
  const dir = store.root.children.get(bag)
  return dir && dir.kind === 'directory' ? [...dir.children.keys()].sort() : []
}

// --- a relay and WebRTC peers ---------------------------------------------------

export const relay = () => {
  const listeners = new Map<string, Set<(e: unknown) => void>>()
  const subscriptions: string[] = []
  const meshFor = (pubkey: string) => ({
    async publish(kind: number, sig: string, payload: unknown, extraTags: string[][] = []) {
      const event = { pubkey, kind, tags: [['x', sig], ...extraTags], content: String(payload) }
      for (const cb of listeners.get(sig) ?? []) queueMicrotask(() => cb({ event }))
      return true
    },
    subscribe(sig: string, cb: (e: any) => void) {
      subscriptions.push(sig)
      const set = listeners.get(sig) ?? new Set(); set.add(cb); listeners.set(sig, set)
      return { close: () => set.delete(cb) }
    },
  })
  return { meshFor, subscriptions }
}

const peers = new Map<string, FakePeer>()
let counter = 0

class FakeChannel {
  readyState = 'connecting'
  onopen: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onclose: (() => void) | null = null
  other: FakeChannel | null = null
  constructor(readonly label: string) {}
  send(text: string) { const to = this.other; queueMicrotask(() => to?.onmessage?.({ data: text })) }
  close() { if (this.readyState === 'closed') return; this.readyState = 'closed'; const to = this.other; queueMicrotask(() => { if (to && to.readyState !== 'closed') { to.readyState = 'closed'; to.onclose?.() } }) }
}

export class FakePeer {
  readonly id = `peer${++counter}`
  onicecandidate: ((event: { candidate: { toJSON(): RTCIceCandidateInit } | null }) => void) | null = null
  ondatachannel: ((event: { channel: any }) => void) | null = null
  onconnectionstatechange: (() => void) | null = null
  connectionState = 'new'
  #remote: FakePeer | null = null
  #channel: FakeChannel | null = null
  #candidates = 0
  #hasRemote = false
  constructor() { peers.set(this.id, this) }
  createDataChannel(label: string) { this.#channel = new FakeChannel(label); return this.#channel }
  async createOffer() { return { type: 'offer' as const, sdp: this.id } }
  async createAnswer() { return { type: 'answer' as const, sdp: this.id } }
  async setLocalDescription() { queueMicrotask(() => this.onicecandidate?.({ candidate: { toJSON: () => ({ candidate: `cand:${this.id}` }) } })) }
  async setRemoteDescription(description: RTCSessionDescriptionInit) { this.#remote = peers.get(String(description.sdp)) ?? null; this.#hasRemote = true; this.#maybeConnect() }
  async addIceCandidate() { if (!this.#hasRemote) throw new Error('InvalidStateError'); this.#candidates++; this.#maybeConnect() }
  close() { this.connectionState = 'closed' }
  #maybeConnect() {
    const remote = this.#remote
    if (!remote || this.#candidates < 1 || remote.#candidates < 1 || !this.#hasRemote || !remote.#hasRemote) return
    const dialler = this.#channel ? this : remote
    const answerer = dialler === this ? remote : this
    const mine = dialler.#channel!
    if (mine.other) return
    const theirs = new FakeChannel(mine.label)
    mine.other = theirs; theirs.other = mine
    mine.readyState = 'open'; theirs.readyState = 'open'
    queueMicrotask(() => { answerer.ondatachannel?.({ channel: theirs }); mine.onopen?.() })
  }
}
