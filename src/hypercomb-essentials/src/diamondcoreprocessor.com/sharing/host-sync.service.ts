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
// Inert by default. Two operator-controlled gates must BOTH be on for
// the service to subscribe to content commits, enqueue bytes, or invoke
// the signer:
//
//   1. localStorage['hc:nostrmesh:self-domain'] — the host to push to.
//   2. localStorage['hc:host-sync:enabled']     — explicit opt-in flag.
//
// Both off keeps the service silent: no enqueue, no timer drain, no
// signer call. This is the gate that prevents casual visitors from
// triggering a Nostr-signer permission prompt (the NIP-07 extension
// on desktop; on Android, Amber — whose intent-discovery permission
// is what Android describes as "access other apps and services").
//
// Toggle live via the public enable()/disable() methods; localStorage
// changes take effect on the next event, no reload required.

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
// Explicit opt-in gate. Default false → no `content:wrote` handler
// reaches the signer, so a casual visitor never triggers a Nostr-signer
// prompt. Operators flip to 'true' once they've configured a host AND
// understand each commit will be signed.
const ENABLED_KEY = 'hc:host-sync:enabled'
// Push mode. 'host' = PUT to /__layers__/<sig>.json etc. (operator-owned
// permanent pools, requires being in the relay's writers allowlist).
// 'temp-swarm' = PUT to /__swarm_temp__/<pubkey>/<sig> (the swarm host's
// per-participant staging area — sandboxed to the participant's pubkey,
// TTL-bounded, size-capped; for browser-only members who want to share
// back without running their own host).
const MODE_KEY = 'hc:host-sync:mode'
const NIP98_KIND = 27235
const RETRY_MS = 30_000

export class HostSyncService extends EventTarget {

  #draining = false

  constructor() {
    super()
    // Auto-enqueue every committed sig — gated on #isEnabled(). With the
    // gate off, the handler exits before reaching enqueue/signer, so no
    // permission prompt can fire. Subscription stays live so toggling the
    // gate takes effect without reload.
    EffectBus.on<{ sig: string; kind: HostSyncKind; bytes: ArrayBuffer }>(
      'content:wrote',
      ({ sig, kind, bytes }) => {
        if (!this.#isEnabled()) return
        void this.enqueue(sig, kind, bytes)
      }
    )
    // Periodic retry — skipped while the gate is off so the signer is never
    // invoked for an un-opted-in visitor.
    setInterval(() => {
      if (!this.#isEnabled()) return
      void this.drain()
    }, RETRY_MS)
  }

  /** True iff the operator has both opted in AND configured a self-domain. */
  public readonly isEnabled = (): boolean => this.#isEnabled()

  /** Turn host backup on. Optionally set the self-domain and the push mode
   *  in the same call. Effect is immediate — no reload required. Caller is
   *  responsible for showing the user a clear "we will sign each backup
   *  to <domain> in <mode> mode" dialog BEFORE invoking this.
   *
   *  Modes:
   *   - 'host' (default): you own the host; writes go to permanent typed
   *     pools and require your pubkey to be in the relay's writers list.
   *   - 'temp-swarm': you don't own a host; writes go to the swarm host's
   *     per-participant staging area /__swarm_temp__/<your-pubkey>/<sig>,
   *     which is TTL-bounded and size-capped. Other swarm members fetch
   *     from the same host at /<sig>. */
  public readonly enable = (selfDomain?: string, opts?: { mode?: 'host' | 'temp-swarm' }): void => {
    try {
      if (selfDomain) localStorage.setItem(SELF_DOMAIN_KEY, selfDomain.trim())
      const mode = opts?.mode ?? 'host'
      localStorage.setItem(MODE_KEY, mode)
      localStorage.setItem(ENABLED_KEY, 'true')
    } catch { /* private mode — caller still has to honor in-session */ }
  }

  /** Current push mode — 'host' (default) or 'temp-swarm'. Read fresh
   *  from localStorage so toggling at runtime is honored without reload. */
  public readonly mode = (): 'host' | 'temp-swarm' => {
    try {
      const raw = String(localStorage.getItem(MODE_KEY) ?? '').trim().toLowerCase()
      return raw === 'temp-swarm' ? 'temp-swarm' : 'host'
    } catch { return 'host' }
  }

  /** Turn host backup off. Existing queued entries stay on disk (not
   *  destructive); they resume draining if the gate is flipped back on. */
  public readonly disable = (): void => {
    try { localStorage.setItem(ENABLED_KEY, 'false') } catch { /* ignore */ }
  }

  readonly #isEnabled = (): boolean => {
    let flag = ''
    try { flag = String(localStorage.getItem(ENABLED_KEY) ?? '').trim().toLowerCase() } catch { return false }
    if (flag !== 'true') return false
    return this.#hostBase().length > 0
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

    const path = await this.#pathFor(entry.sig, entry.kind)
    if (!path) return false
    // Loopback hosts use plain http (content-side analog of allow-loopback);
    // real domains use https.
    const scheme = /^(localhost|127(?:\.\d+){3}|\[?::1\]?)(?::\d+)?$/i.test(host) ? 'http' : 'https'
    const url = `${scheme}://${host}${path}`

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

  /** sig+kind → host URL path.
   *
   *  In 'host' mode (default), returns the typed pool path matching the
   *  relay's permanent layout (`/__layers__/<sig>.json` etc.); the writer
   *  must be in the relay's allow-list. In 'temp-swarm' mode, returns the
   *  per-participant staging path `/__swarm_temp__/<pubkey>/<sig>` — pool
   *  is single-namespace (no typed differentiation), and the participant
   *  authenticates as themselves rather than going through an operator
   *  writer-set. Pubkey is fetched once from the signer and cached.
   *
   *  Returns '' if a path cannot be constructed (unknown kind in host
   *  mode, or temp-swarm mode without an available signer pubkey). */
  readonly #pathFor = async (sig: string, kind: HostSyncKind): Promise<string> => {
    if (this.mode() === 'temp-swarm') {
      const pubkey = await this.#getOwnPubkey()
      if (!pubkey) return ''
      return `/__swarm_temp__/${pubkey}/${sig}`
    }
    switch (kind) {
      case 'layer':      return `/__layers__/${sig}.json`
      case 'bee':        return `/__bees__/${sig}.js`
      case 'dependency': return `/__dependencies__/${sig}.js`
      case 'resource':   return `/__resources__/${sig}`
      default:           return ''
    }
  }

  /** Cache for the signer's pubkey. NostrSigner.getPublicKeyHex() is
   *  async (may dial out to a NIP-07 extension); we want #pathFor to be
   *  cheap on the hot path. First lookup pays the cost, subsequent
   *  lookups are O(1). Reset on disable() so a key change between sessions
   *  is respected. */
  #ownPubkey: string | null = null

  readonly #getOwnPubkey = async (): Promise<string> => {
    if (this.#ownPubkey) return this.#ownPubkey
    const signer = this.#getSigner() as (SignerLike & { getPublicKeyHex?: () => Promise<string | null> }) | undefined
    if (!signer?.getPublicKeyHex) return ''
    try {
      const pk = await signer.getPublicKeyHex()
      if (pk && /^[0-9a-f]{64}$/i.test(pk)) {
        this.#ownPubkey = pk.toLowerCase()
        return this.#ownPubkey
      }
    } catch { /* fall through */ }
    return ''
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

  /** The participant's host, scheme/slash stripped (e.g. 'jwize.com').
   *  Read straight from localStorage — the runtime initializer ensures
   *  the key is populated with window.location.origin on first boot, so
   *  this never returns "" except in private-mode storage edge cases. */
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

// On boot, drain anything left from a prior session — only if the operator
// has explicitly opted in. Visitors with no host configured (or who haven't
// flipped the gate) skip the drain entirely, so the signer is never invoked
// at startup and no Nostr-signer prompt appears.
if (_hostSync.isEnabled()) void _hostSync.drain()
