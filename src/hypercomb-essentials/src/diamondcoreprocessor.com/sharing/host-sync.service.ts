// diamondcoreprocessor.com/sharing/host-sync.service.ts
//
// Remote backup: signed HTTP push of committed content to the operator's
// OWN host (e.g. jwize.com), with confirmed-read-back receipts.
//
// This is the REMOTE counterpart to PushQueueService's DCP-iframe path.
// Same trigger (`content:wrote`) and the same crash-safe
// queue-with-receipts shape, but a different, fully isolated destination
// and transport:
//
//   transport = HTTP PUT to https://<host>/<typed-path> carrying a NIP-98
//   Authorization header — a kind-27235 Nostr event signed by the
//   participant's key (the same key the mesh uses). The host verifies the
//   signature against its allowed-writers list and that sha256(body)
//   matches the URL sig (relay §21.12). Receipt = confirmed read-back
//   (a fresh GET returns 200), NEVER a bare PUT 200 — that is the exact
//   silent-drop lesson from the deploy pipeline, applied at this boundary.
//   See protocol-spec.md §21.11 / §21.12.
//
// IMPORTANT — this is HTTP-ONLY. It never touches the mesh. The mesh stays
// layer-sigs-only and lightweight (backup is not broadcast). No new event
// kinds, no bytes on the relay's event channel — just HTTP PUT/GET.
//
// On-disk (top-level OPFS), isolated from PushQueueService's dirs so the
// two backup channels never interfere:
//
//   __host_push__/queue/{sig}.{kind}  ← queued bytes (FIFO by mtime)
//   __host_receipts__/{sig}           ← receipt (existence = host serves it)
//
// Inert until the operator names their host via
// localStorage['hc:nostrmesh:self-domain']. No host => nothing to push;
// the queue simply accumulates and drains once a host appears.

import { EffectBus } from '@hypercomb/core'

export type HostSyncKind = 'layer' | 'bee' | 'dependency' | 'resource'

interface SignerLike {
  signEvent: (evt: { kind: number; created_at: number; tags: string[][]; content: string }) => Promise<Record<string, unknown>>
}

const SIG_RE = /^[a-f0-9]{64}$/
const ENTRY_RE = /^([a-f0-9]{64})\.(layer|bee|dependency|resource)$/
const PUSH_DIR = '__host_push__'
const QUEUE_SUBDIR = 'queue'
const RECEIPTS_DIR = '__host_receipts__'
const NOSTR_SIGNER_KEY = '@diamondcoreprocessor.com/NostrSigner'
const STORE_KEY = '@hypercomb.social/Store'
const SELF_DOMAIN_KEY = 'hc:nostrmesh:self-domain'
const NIP98_KIND = 27235
const RETRY_MS = 30_000

export class HostSyncService extends EventTarget {

  #draining = false

  constructor() {
    super()
    // Auto-enqueue every committed sig (same hook PushQueueService uses).
    // Store (shared) and HistoryService (essentials) both emit this after a
    // successful OPFS write; routing through EffectBus keeps shared from
    // importing essentials.
    EffectBus.on<{ sig: string; kind: HostSyncKind; bytes: ArrayBuffer }>(
      'content:wrote',
      ({ sig, kind, bytes }) => { void this.enqueue(sig, kind, bytes) }
    )
    // Periodic retry — the host may be offline, or configured only after
    // content was queued. Cheap: drain() is single-flight and returns
    // immediately on an empty queue or an unconfigured host.
    setInterval(() => { void this.drain() }, RETRY_MS)
  }

  // -------------------------------------------------
  // public API
  // -------------------------------------------------

  /** Queue a sig for remote backup. Idempotent (keyed by {sig}.{kind});
   *  skipped entirely if already receipted. Stores the bytes in the queue
   *  file so drain is self-contained and crash-safe. */
  public readonly enqueue = async (sig: string, kind: HostSyncKind, bytes: ArrayBuffer): Promise<void> => {
    if (!SIG_RE.test(sig)) return
    if (await this.hasReceipt(sig)) return
    const queueDir = await this.#getQueueDir()
    if (!queueDir) return // store not ready — silent no-op; boot drain catches up
    try {
      const handle = await queueDir.getFileHandle(`${sig}.${kind}`, { create: true })
      const writable = await handle.createWritable()
      try { await writable.write(bytes) } finally { await writable.close() }
    } catch { /* best-effort; next enqueue/drain retries */ }
    void this.drain()
  }

  /** Drain the queue to the host. Single-flight. Each entry: signed PUT +
   *  confirmed read-back; on success writes a receipt and drops the entry;
   *  on failure leaves it for the retry timer. No-op when no host is
   *  configured. */
  public readonly drain = async (): Promise<void> => {
    if (this.#draining) return
    const host = this.#hostBase()
    if (!host) return // no host named — stay inert
    this.#draining = true
    try {
      for (;;) {
        const entries = await this.#listQueue()
        if (entries.length === 0) break
        let progressed = false
        for (const entry of entries) {
          if (await this.hasReceipt(entry.sig)) { await this.#removeEntry(entry.fileName); continue }
          const ok = await this.#pushAndReceipt(host, entry)
          if (!ok) continue // leave entry; retry timer handles offline/host-down
          await this.#removeEntry(entry.fileName)
          progressed = true
          this.dispatchEvent(new CustomEvent('receipt', { detail: { sig: entry.sig } }))
          EffectBus.emit('host:receipt', { sig: entry.sig })
        }
        if (!progressed) break // nothing advanced (host unreachable) — stop; timer retries
      }
      const remaining = (await this.#listQueue()).length
      EffectBus.emit('sync:state', { host, pending: remaining, status: remaining === 0 ? 'backed-up' : 'syncing' })
    } finally {
      this.#draining = false
    }
  }

  /** True iff the host has confirmed (read-back) this sig. */
  public readonly hasReceipt = async (sig: string): Promise<boolean> => {
    if (!SIG_RE.test(sig)) return false
    try {
      const dir = await this.#getReceiptsDir()
      if (!dir) return false
      await dir.getFileHandle(sig, { create: false })
      return true
    } catch { return false }
  }

  /** All sigs queued for the host and not yet receipted, in enqueue order. */
  public readonly pending = async (): Promise<string[]> => {
    const queue = await this.#listQueue()
    const out: string[] = []
    for (const entry of queue) {
      if (!(await this.hasReceipt(entry.sig))) out.push(entry.sig)
    }
    return out
  }

  // -------------------------------------------------
  // transport — signed HTTP PUT + confirmed read-back
  // -------------------------------------------------

  readonly #pushAndReceipt = async (host: string, entry: { sig: string; kind: HostSyncKind; fileName: string }): Promise<boolean> => {
    let bytes: ArrayBuffer
    try {
      const dir = await this.#getQueueDir()
      if (!dir) return false
      const handle = await dir.getFileHandle(entry.fileName, { create: false })
      bytes = await (await handle.getFile()).arrayBuffer()
    } catch { return false }

    const path = this.#pathFor(entry.sig, entry.kind)
    if (!path) return false
    const url = `https://${host}${path}`

    const auth = await this.#nip98(url, 'PUT')
    if (!auth) return false // no signer available

    try {
      const put = await fetch(url, { method: 'PUT', headers: { Authorization: auth }, body: bytes })
      if (!put.ok) return false
      // Confirmed read-back: a fresh GET (cache-bypassing) must show the
      // host actually serving the sig. A bare PUT 200 is NOT proof — the
      // silent-drop lesson. Only a served read-back closes the loop.
      const back = await fetch(url, { cache: 'no-store' })
      if (!back.ok) return false
    } catch {
      return false // network/CORS/host-down — retry later
    }

    try {
      const receiptsDir = await this.#getReceiptsDir()
      if (!receiptsDir) return false
      const handle = await receiptsDir.getFileHandle(entry.sig, { create: true })
      const writable = await handle.createWritable()
      try { await writable.write(new Uint8Array(0)) } finally { await writable.close() }
      return true
    } catch { return false }
  }

  /** kind → the host's typed URL path. Matches the relay's content layout
   *  (the relay strips .js/.json to recover the sig and verifies the hash). */
  readonly #pathFor = (sig: string, kind: HostSyncKind): string => {
    switch (kind) {
      case 'layer':      return `/__layers__/${sig}.json`
      case 'bee':        return `/__bees__/${sig}.js`
      case 'dependency': return `/__dependencies__/${sig}.js`
      case 'resource':   return `/__resources__/${sig}`
      default:           return ''
    }
  }

  /** Build a NIP-98 Authorization header: a kind-27235 Nostr event signed
   *  by the participant's key, binding method + url, base64'd. Returns null
   *  if no signer is available. */
  readonly #nip98 = async (url: string, method: string): Promise<string | null> => {
    const signer = this.#getSigner()
    if (!signer?.signEvent) return null
    const evt = {
      kind: NIP98_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['u', url], ['method', method]],
      content: '',
    }
    try {
      const signed = await signer.signEvent(evt)
      const json = JSON.stringify(signed)
      return 'Nostr ' + btoa(unescape(encodeURIComponent(json)))
    } catch {
      return null
    }
  }

  /** The operator's host, scheme/slash stripped (e.g. 'jwize.com'). Empty
   *  string when unconfigured. */
  readonly #hostBase = (): string => {
    let raw = ''
    try { raw = String(localStorage.getItem(SELF_DOMAIN_KEY) ?? '').trim() } catch { return '' }
    return raw.replace(/^wss?:\/\//, '').replace(/^https?:\/\//, '').replace(/\/+$/, '').trim()
  }

  // -------------------------------------------------
  // internal — directory resolution + queue ops
  // (mirrors PushQueueService; isolated dirs)
  // -------------------------------------------------

  readonly #getQueueDir = async (): Promise<FileSystemDirectoryHandle | null> => {
    const root = await this.#getOpfsRoot()
    if (!root) return null
    const push = await root.getDirectoryHandle(PUSH_DIR, { create: true })
    return await push.getDirectoryHandle(QUEUE_SUBDIR, { create: true })
  }

  readonly #getReceiptsDir = async (): Promise<FileSystemDirectoryHandle | null> => {
    const root = await this.#getOpfsRoot()
    if (!root) return null
    return await root.getDirectoryHandle(RECEIPTS_DIR, { create: true })
  }

  readonly #getOpfsRoot = async (): Promise<FileSystemDirectoryHandle | null> => {
    const store = this.#ioc<{ opfsRoot?: FileSystemDirectoryHandle }>(STORE_KEY)
    return store?.opfsRoot ?? null
  }

  readonly #listQueue = async (): Promise<Array<{ sig: string; kind: HostSyncKind; fileName: string; mtime: number }>> => {
    const dir = await this.#getQueueDir()
    if (!dir) return []
    const items: Array<{ sig: string; kind: HostSyncKind; fileName: string; mtime: number }> = []
    for await (const [name, handle] of (dir as unknown as { entries: () => AsyncIterable<[string, FileSystemHandle]> }).entries()) {
      if (handle.kind !== 'file') continue
      const m = name.match(ENTRY_RE)
      if (!m) continue
      try {
        const file = await (handle as FileSystemFileHandle).getFile()
        items.push({ sig: m[1], kind: m[2] as HostSyncKind, fileName: name, mtime: file.lastModified })
      } catch { /* skip unreadable */ }
    }
    items.sort((a, b) => a.mtime - b.mtime)
    return items
  }

  readonly #removeEntry = async (fileName: string): Promise<void> => {
    try {
      const dir = await this.#getQueueDir()
      if (!dir) return
      await dir.removeEntry(fileName)
    } catch { /* already gone */ }
  }

  readonly #getSigner = (): SignerLike | undefined => this.#ioc<SignerLike>(NOSTR_SIGNER_KEY)

  readonly #ioc = <T>(key: string): T | undefined =>
    (window as { ioc?: { get: (k: string) => unknown } }).ioc?.get?.(key) as T | undefined
}

const _hostSync = new HostSyncService()
window.ioc.register('@diamondcoreprocessor.com/HostSyncService', _hostSync)

// On boot, drain anything left from a prior session (crash-safe, single-flight).
void _hostSync.drain()
