// diamondcoreprocessor.com/nostr/nostr-mesh.drone.ts
//
// Live bootstrap relay (wss://jwize.com) shipped 2026-05-29; default-ON
// for real hosts since 2026-06-10 (see LIVE_RELAY notes below). Local
// origins seed the loopback dev relay instead; hc:nostrmesh:use-live-relay
// ('1'/'0') and hc:nostrmesh:relays override.
import { Drone } from '@hypercomb/core'

const LOCAL_RELAY = 'ws://localhost:7777'
// Live bootstrap relay.
//
// ⚠️ This constant is referenced in EXACTLY ONE runtime branch — the
// seed expression in `loadRelays()` below. Keep it that way so the
// relay policy stays auditable in one place.
//
// Policy (since 2026-06-10): real hosts seed LIVE_RELAY by DEFAULT.
// A deployed origin must never dial loopback — nothing listens on a
// visitor's machine, and a public origin touching localhost trips
// Chrome's Local Network Access permission prompt at page open.
// Local origins seed LOCAL_RELAY for the self-contained dev loop.
//
//   localStorage['hc:nostrmesh:use-live-relay'] = '1'   force LIVE_RELAY
//   localStorage['hc:nostrmesh:use-live-relay'] = '0'   opt out (real host
//                                                       idles, no loopback)
//   localStorage['hc:nostrmesh:relays']        = '[…]'  manual override, wins
const LIVE_RELAY = 'wss://jwize.com'

// Force the literal into the bundle via a globalThis assignment.
// esbuild treats global property writes as side effects and will not
// DCE them. Multiple gentler anchors (exported const, frozen object,
// IIFE) were insufficient — the constant kept getting tree-shaken out
// when the loadRelays ternary's LIVE_RELAY branch was optimized away.
// A globalThis write is the bluntest object esbuild won't touch.
//
// Bracket access: strict TS (`noPropertyAccessFromIndexSignature`)
// forbids dot-access on `Record<string, unknown>` types.
;(globalThis as Record<string, unknown>)['__HYPERCOMB_RELAYS__'] = Object.freeze({
  local: LOCAL_RELAY,
  live: LIVE_RELAY,
})

type NostrEvent = { id?: string; pubkey?: string; created_at: number; kind: number; tags: string[][]; content: string; sig?: string }
type MeshEvt = { relay: string; sig: string; event: NostrEvent; payload: any }
type MeshCb = (e: MeshEvt) => void
type MeshSub = { close: () => void }

type Bucket = { sig: string; subId: string; cbs: Set<MeshCb> }

type MeshStats = {
  startedAtMs: number
  socketsOpened: number
  socketsClosed: number
  socketsErrors: number
  reqSent: number
  closeSent: number
  eventSent: number
  localFanout: number
  msgIn: number
  msgEventIn: number
  msgNoticeIn: number
  msgOtherIn: number
  parseFail: number
  noBucket: number
  sendSkippedNoSigner: number
  dupDrop: number
}

type MeshLog = { atMs: number; type: string; relay?: string; sig?: string; subId?: string; kind?: number; note?: string; data?: any }

type RelayBackoff = { attempts: number; nextAtMs: number; timer?: number }
type SigReadyWaiter = { resolve: () => void; timer?: number }

type CachedItem = { relay: string; sig: string; event: NostrEvent; payload: any; receivedAtMs: number; createdAtMs: number }
type MeshExpiryRule = {
  id: string
  ttlMs: number
  sigPrefix?: string
  kind?: number
}

export class NostrMeshDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'sharing'

  public override description =
    'Maintains WebSocket connections to Nostr relays and routes mesh subscribe/publish events.'
  public override effects = ['network'] as const

  protected override deps = { signer: '@diamondcoreprocessor.com/NostrSigner' }
  protected override listens = ['mesh:ensure-started', 'mesh:subscribe', 'mesh:publish']
  protected override emits = ['mesh:ready', 'mesh:items-updated']

  // -----------------------------
  // config
  // -----------------------------

  // note: no default relay — user must configure their own (or use local dev relay)
  private relays: string[] = []

  // note: set to null to accept any kind matching x
  // Default to null (no kind filter) so the relay returns every event
  // matching the #x tag — caller drones (SwarmDrone, PairedChannelDrone)
  // narrow via configureKinds() once they finish loading. The previous
  // default [29010] hard-coded the paired-channel kind and silently
  // dropped swarm layer/resource/hide events (30200/30201/30202) on
  // any fresh localStorage profile (every incognito session, every
  // browser-data clear). The resubscribeAll() that fires when swarm
  // later calls configureKinds is racy on incognito; defaulting null
  // makes the filter universally permissive until something explicitly
  // narrows it.
  private kinds: number[] | null = null

  // note: expiry rules live here
  private ttlMs = 600_000
  private perSigCap = 128
  private expiryRules: MeshExpiryRule[] = [
    { id: 'default', ttlMs: 600_000 }
  ]

  // -----------------------------
  // state
  // -----------------------------

  private started = false
  private stopped = false

  private networkEnabled = this.loadNetworkEnabled()

  private sockets = new Map<string, WebSocket>()
  private backoff = new Map<string, RelayBackoff>()

  private bucketsBySig = new Map<string, Bucket>()
  private bucketsBySubId = new Map<string, Bucket>()

  // note: ttl-backed cache per sig
  private itemsBySig = new Map<string, CachedItem[]>()
  private readyWaitersBySig = new Map<string, SigReadyWaiter[]>()

  // note: dedupe across relays (drops repeated ids)
  private recentIds: string[] = []
  private recentIdsSet = new Set<string>()
  private readonly recentCap = 2048

  // -----------------------------
  // debug (off by default)
  // -----------------------------

  private debug = false
  private stats: MeshStats = this.newStats()
  private logs: MeshLog[] = []
  private readonly logCap = 200

  #initialized = false

  protected override sense = () => true

  protected override heartbeat = async (): Promise<void> => {
    if (!this.#initialized) {
      this.#initialized = true

      this.ensureStartedNow()

      // effect bus listeners — allow other drones to coordinate via effects
      this.onEffect<{ signature: string }>('mesh:ensure-started', async ({ signature }) => {
        this.ensureStartedForSig(signature)
        this.emitEffect('mesh:ready', { signature })
      })

      this.onEffect<{ signature: string, onItems: (e: any) => void }>('mesh:subscribe', ({ signature, onItems }) => {
        this.subscribe(signature, onItems)
      })

      this.onEffect<{ kind: number, sig: string, payload: any, extraTags?: string[][] }>('mesh:publish', async ({ kind, sig, payload, extraTags }) => {
        await this.publish(kind, sig, payload, extraTags)
      })
    }

    this.pruneAllExpired()
    this.ensureSocketHealth()
  }

  // -----------------------------
  // public api
  // -----------------------------

  public configureRelays = (urls: string[], persist = true): void => {
    const next = (Array.isArray(urls) ? urls : [])
      .map(u => String(u ?? '').trim())
      .filter(u => u.startsWith('ws://') || u.startsWith('wss://'))

    this.relays = Array.from(new Set(next))
    if (persist) this.saveRelays(this.relays)
    this.reconnectAll()
  }

  private loadRelayConfig = (): void => {
    this.relays = this.loadRelays(this.relays)
  }

  public configureKinds = (kinds: number[] | null, persist = true): void => {
    this.ensureStartedNow()

    if (kinds === null) {
      this.kinds = null
      if (persist) this.saveKinds(null)

      this.note('kinds:set', undefined, undefined, undefined, undefined, null)
      this.resubscribeAll()
      return
    }

    if (!Array.isArray(kinds) || kinds.length === 0) return

    const next = kinds
      .map(k => Number(k))
      .filter(k => Number.isFinite(k) && k > 0)
      .sort((a, b) => a - b)

    const uniq = Array.from(new Set(next))
    if (uniq.length === 0) return

    this.kinds = uniq
    if (persist) this.saveKinds(uniq)

    this.note('kinds:set', undefined, undefined, undefined, undefined, this.kinds)
    this.resubscribeAll()
  }

  // note: expiry tuning is mesh-owned
  public configureExpiry = (ttlMs: number, perSigCap = 128): void => {
    const ttl = Number(ttlMs ?? 0)
    if (Number.isFinite(ttl) && ttl > 0) this.ttlMs = ttl

    const cap = Number(perSigCap ?? 0)
    if (Number.isFinite(cap) && cap >= 16) this.perSigCap = Math.floor(cap)

    this.ensureDefaultExpiryRule()

    this.pruneAllExpired()
    this.note('expiry:set', undefined, undefined, undefined, undefined, { ttlMs: this.ttlMs, perSigCap: this.perSigCap })
  }

  // note: array-based expiry rules (first match wins, fallback is default ttl)
  public configureExpiryRules = (rules: MeshExpiryRule[]): void => {
    if (!Array.isArray(rules)) return

    const next = this.sanitizeExpiryRules(rules)
    this.expiryRules = next
    this.ensureDefaultExpiryRule()

    this.pruneAllExpired()
    this.note('expiry-rules:set', undefined, undefined, undefined, undefined, this.expiryRules)
  }

  public getExpiryRules = (): MeshExpiryRule[] => {
    this.ensureDefaultExpiryRule()
    return this.expiryRules.map(r => ({ ...r }))
  }

  // note: count distinct publisher IDs in non-expired cache for a signature
  public getSwarmSize = (sig: string): number => {
    const s = String(sig ?? '').trim()
    if (!s) return 0

    this.pruneSigExpired(s)
    const items = this.itemsBySig.get(s)
    if (!items || items.length === 0) return 0

    const publishers = new Set<string>()
    for (const item of items) {
      const tags = item.event?.tags
      if (!Array.isArray(tags)) continue
      for (const t of tags) {
        if (Array.isArray(t) && t.length >= 2 && String(t[0]) === 'publisher') {
          const v = String(t[1] ?? '').trim()
          if (v) publishers.add(v)
        }
      }
    }
    return publishers.size
  }

  // note: creates a bucket (zero consumers) so relays are queried and cache fills
  public ensureStartedForSig = (sig: string): void => {
    this.ensureStartedNow()

    const s = String(sig ?? '').trim()
    if (!s) return

    const existing = this.bucketsBySig.get(s)
    if (existing) return

    const bucket: Bucket = { sig: s, subId: this.makeSubId(), cbs: new Set<MeshCb>() }
    this.bucketsBySig.set(s, bucket)
    this.bucketsBySubId.set(bucket.subId, bucket)

    this.note('sub:hidden', undefined, s, bucket.subId, undefined, { consumers: 0 })
    this.sendReqToAll(bucket)
  }

  // note: returns newest-first cached items that are not expired (mesh ttl rules)
  public getNonExpired = (sig: string): MeshEvt[] => {
    this.ensureStartedNow()

    const s = String(sig ?? '').trim()
    if (!s) return []

    this.pruneSigExpired(s)

    const items = this.itemsBySig.get(s)
    if (!items || items.length === 0) return []

    const sorted = items
      .slice()
      .sort((a, b) => (b.createdAtMs || b.receivedAtMs) - (a.createdAtMs || a.receivedAtMs))

    return sorted.map(i => ({ relay: i.relay, sig: i.sig, event: i.event, payload: i.payload }))
  }

  // note: one-shot READ-BACK query.
  // Forces a fresh REQ for `sig` on a TRANSIENT subId so relays replay their
  // STORED matching events — including our OWN, which a relay does not echo
  // back live to the sender (relay.js broadcast excludes the sending socket),
  // so a long-lived subscription never re-sees what it published. Waits briefly
  // for the replay, closes the transient sub, and returns the cached items —
  // each tagged with the `relay` it arrived from ('local' = our own unconfirmed
  // fanout). A caller treats any item from a NON-'local' relay as a confirmed
  // read-back: the same "never trust a bare send-ok" discipline HostSyncService
  // uses for HTTP backup. Leaves the keyed subscription untouched (separate
  // subId, no cbs) so it never perturbs live delivery to subscribers.
  public query = async (sig: string, timeoutMs = 1800): Promise<MeshEvt[]> => {
    this.ensureStartedNow()
    const s = String(sig ?? '').trim()
    if (!s) return []
    if (!this.networkEnabled) return this.getNonExpired(s)
    const bucket: Bucket = { sig: s, subId: this.makeSubId(), cbs: new Set<MeshCb>() }
    this.bucketsBySubId.set(bucket.subId, bucket)
    this.sendReqToAll(bucket)
    const t = Math.max(200, Math.min(Number(timeoutMs) || 1800, 8000))
    await new Promise<void>(r => setTimeout(r, t))
    this.sendCloseToAll(bucket.subId)
    this.bucketsBySubId.delete(bucket.subId)
    return this.getNonExpired(s)
  }

  // note: await initial cache readiness for a signature
  // resolves when first matching event arrives, relay sends EOSE, or timeout elapses
  public awaitReadyForSig = async (sig: string, timeoutMs = 900): Promise<void> => {
    this.ensureStartedNow()

    const s = String(sig ?? '').trim()
    if (!s) return

    this.ensureStartedForSig(s)
    this.pruneSigExpired(s)

    const existing = this.itemsBySig.get(s)
    if (existing && existing.length > 0) return

    await new Promise<void>((resolve) => {
      const list = this.readyWaitersBySig.get(s) ?? []
      const waiter: SigReadyWaiter = { resolve }

      const t = Number(timeoutMs ?? 0)
      if (Number.isFinite(t) && t > 0) {
        waiter.timer = window.setTimeout(() => {
          this.removeReadyWaiter(s, waiter)
          resolve()
        }, Math.floor(t))
      }

      list.push(waiter)
      this.readyWaitersBySig.set(s, list)
    })
  }

  public stop = (): void => {
    this.stopped = true

    for (const [url, st] of this.backoff.entries()) {
      if (st.timer) clearTimeout(st.timer)
      this.backoff.delete(url)
    }

    for (const [url, ws] of this.sockets.entries()) {
      try { ws.onopen = null; ws.onmessage = null; ws.onerror = null; ws.onclose = null } catch { /* ignore */ }
      try { ws.close() } catch { /* ignore */ }
      this.sockets.delete(url)
      this.note('socket:stop', url)
    }
  }

  public setDebug = (enabled: boolean): void => {
    this.debug = !!enabled
    try { localStorage.setItem('hc:nostrmesh:debug', this.debug ? '1' : '0') } catch { /* ignore */ }
    this.note('debug:set', undefined, undefined, undefined, undefined, this.debug)
  }

  public clearDebug = (): void => {
    this.stats = this.newStats()
    this.stats.startedAtMs = Date.now()
    this.logs = []
    this.note('debug:clear')
  }

  public getDebug = (): any => {
    // note: self-start on first introspection so debug doesn't lie
    this.ensureStartedNow()

    return {
      debug: this.debug,
      relays: this.relays.slice(),
      kinds: this.kinds ? this.kinds.slice() : null,
      ttlMs: this.ttlMs,
      perSigCap: this.perSigCap,
      expiryRules: this.getExpiryRules(),
      sockets: Array.from(this.sockets.entries()).map(([url, ws]) => ({ url, readyState: ws.readyState })),
      buckets: Array.from(this.bucketsBySig.values()).map(b => ({ sig: b.sig, subId: b.subId, consumers: b.cbs.size })),
      cached: Array.from(this.itemsBySig.entries()).map(([sig, items]) => ({ sig, count: items.length })),
      stats: { ...this.stats },
      logs: this.logs.slice()
    }
  }


  public isNetworkEnabled = (): boolean => this.networkEnabled

  public setNetworkEnabled = (enabled: boolean, persist = true): void => {
  const next = !!enabled
  if (next === this.networkEnabled) return

  this.networkEnabled = next
  if (persist) {
    try { localStorage.setItem('hc:nostrmesh:network', next ? '1' : '0') } catch {}
  }

  this.note('network:set', undefined, undefined, undefined, undefined, this.networkEnabled)

  if (!this.networkEnabled) {
    this.pauseNetwork()
    return
  }

  // coming back online
  this.ensureStartedNow()
  this.reconnectAll()
}

  // note: signature-only subscription
  // - sig is used as the x tag value
  // - multiple consumers share one network subscription per sig
  public subscribe = (sig: string, cb: MeshCb): MeshSub => {
    this.ensureStartedNow()

    const s = String(sig ?? '').trim()
    if (!s) return { close: () => void 0 }

    const existing = this.bucketsBySig.get(s)
    if (existing) {
      existing.cbs.add(cb)
      this.note('sub:join', undefined, s, existing.subId, undefined, { consumers: existing.cbs.size })
      return { close: () => this.unsubscribe(s, cb) }
    }

    const bucket: Bucket = { sig: s, subId: this.makeSubId(), cbs: new Set<MeshCb>() }
    bucket.cbs.add(cb)

    this.bucketsBySig.set(s, bucket)
    this.bucketsBySubId.set(bucket.subId, bucket)

    this.note('sub:new', undefined, s, bucket.subId, undefined, { consumers: 1 })

    // note: asks relays for matching events
    this.sendReqToAll(bucket)

    return { close: () => this.unsubscribe(s, cb) }
  }

  // note: publish a payload
  // - always local fanout immediately (even if signer is missing)
  // - best-effort to sign + send to relays
  public publish = async (kind: number, sig: string, payload: any, extraTags?: string[][]): Promise<boolean> => {
    this.ensureStartedNow()

    const k = Number(kind ?? 0)
    if (!k || !Number.isFinite(k)) return false

    const s = String(sig ?? '').trim()
    if (!s) return false

    // Sig tag is always present. Expiration is opt-in: if the caller
    // didn't supply one in extraTags, the event lives until the relay
    // purges it (or never, on in-memory / friendly relays). Share
    // events are state-driven — host's dashboard or source-node
    // toggle revokes them — so a time-based default would lie.
    const tags: string[][] = [['x', s]]

    const callerHasExpiration = Array.isArray(extraTags) &&
      extraTags.some(t => Array.isArray(t) && t[0] === 'expiration')

    if (Array.isArray(extraTags)) {
      for (const t of extraTags) {
        if (!Array.isArray(t) || t.length < 2) continue
        tags.push(t.map(x => String(x)))
      }
    }
    void callerHasExpiration  // surface for future opt-in hardening

    const content = typeof payload === 'string' ? payload : JSON.stringify(payload ?? {})

    const evt: NostrEvent = {
      created_at: Math.floor(Date.now() / 1000),
      kind: k,
      tags,
      content
    }

    // critical: always deliver locally
    this.fanoutToSig('local', s, evt)
    this.note('publish:local', undefined, s, undefined, k)

    // best-effort: sign and send
    const signed = await this.trySign(evt)
    if (!signed) {
      this.stats.sendSkippedNoSigner++
      this.note('publish:send-skipped-nosigner', undefined, s, undefined, k)
      return true
    }

    this.sendEventToAll(signed)
    this.note('publish:sent', undefined, s, undefined, k)

    return true
  }

  // note: publish a fully-formed event (signed elsewhere)
  public publishEvent = async (evt: NostrEvent): Promise<boolean> => {
    this.ensureStartedNow()

    if (!evt || !evt.kind || !Array.isArray(evt.tags)) return false

    // note: always local fanout
    const sig = this.readX(evt.tags)
    if (sig) this.fanoutToSig('local', sig, evt)

    // note: if not signed, try to sign for network
    const signed = (evt.id && evt.pubkey && evt.sig) ? evt : await this.trySign(evt)
    if (!signed) {
      this.stats.sendSkippedNoSigner++
      return true
    }

    this.sendEventToAll(signed)
    return true
  }

  // -----------------------------
  // startup
  // -----------------------------

  private ensureStartedNow = (): void => {
    if (this.started) return
    this.started = true

    this.debug = this.loadDebugFlag()
    this.stats.startedAtMs = Date.now()

    // note: allow config from localstorage without rebuilding
    this.relays = this.loadRelays(this.relays)
    this.kinds = this.loadKinds(this.kinds)

    this.note('mesh:started', undefined, undefined, undefined, undefined, { relays: this.relays, kinds: this.kinds })

    this.connectAll()
  }

  // -----------------------------
  // connections
  // -----------------------------

  private connectAll = (): void => {
  if (!this.networkEnabled) return
  for (const url of this.relays) this.ensureSocket(url)
}

  private ensureSocketHealth = (): void => {
    if (!this.networkEnabled || this.stopped) return

    // reset backoff for relays stuck at max attempts for over 30s
    const now = Date.now()
    for (const [url, st] of this.backoff.entries()) {
      if (st.attempts >= 10 && st.nextAtMs > 0 && (now - st.nextAtMs) > 30_000) {
        st.attempts = 0
        st.nextAtMs = 0
        if (st.timer) { clearTimeout(st.timer); st.timer = undefined }
        this.note('socket:backoff-reset', url)
      }
    }

    // reconnect any configured relays that are missing
    for (const url of this.relays) {
      if (!this.sockets.has(url)) this.ensureSocket(url)
    }
  }

  private reconnectAll = (): void => {
    if (this.stopped) return

    for (const [url, st] of this.backoff.entries()) {
      if (st.timer) clearTimeout(st.timer)
      this.backoff.delete(url)
    }

    for (const [url, ws] of this.sockets.entries()) {
      try { ws.close() } catch { /* ignore */ }
      this.sockets.delete(url)
      this.note('socket:close-requested', url)
    }

    this.connectAll()
  }

  private resubscribeAll = (): void => {
    for (const b of this.bucketsBySig.values()) {
      this.sendCloseToAll(b.subId)
      this.sendReqToAll(b)
    }
  }

  private ensureSocket = (relay: string): void => {
    if (!this.networkEnabled) return
    if (this.stopped) return
    if (this.sockets.has(relay)) return
    if (!this.canAttemptRelay(relay)) return

    const now = Date.now()
    const st = this.backoff.get(relay)
    if (st && st.nextAtMs > now) {
      this.scheduleEnsure(relay, st.nextAtMs - now)
      return
    }

    let ws: WebSocket
    try { ws = new WebSocket(relay) } catch { return }

    this.sockets.set(relay, ws)
    this.note('socket:create', relay)

    ws.onopen = () => {
      this.stats.socketsOpened++
      this.note('socket:open', relay)

      const b = this.backoff.get(relay)
      if (b) { b.attempts = 0; b.nextAtMs = 0 }

      // note: resubscribe everything on connect
      for (const bucket of this.bucketsBySig.values()) this.sendReq(relay, bucket)
    }

    ws.onmessage = (msg) => {
      this.onMessage(relay, msg?.data)
    }

    ws.onclose = () => {
      this.stats.socketsClosed++
      this.note('socket:closed', relay)

      this.sockets.delete(relay)
      if (!this.networkEnabled || this.stopped) return

      this.bumpBackoff(relay)
      this.ensureSocket(relay)
    }

    ws.onerror = () => {
      this.stats.socketsErrors++
      this.note('socket:error', relay)

      try { ws.close() } catch { /* ignore */ }
    }
  }

  private scheduleEnsure = (relay: string, delayMs: number): void => {
    if (this.stopped) return
    const st = this.backoff.get(relay)
    if (!st) return
    if (st.timer) return

    st.timer = window.setTimeout(() => {
      st.timer = undefined
      this.ensureSocket(relay)
    }, Math.max(0, delayMs))
  }

  private bumpBackoff = (relay: string): void => {
    const now = Date.now()
    const st = this.backoff.get(relay) ?? { attempts: 0, nextAtMs: 0 }

    st.attempts = Math.min(10, st.attempts + 1)

    const base = Math.min(15000, 250 * (2 ** (st.attempts - 1)))
    const jitter = Math.floor(Math.random() * 250)
    st.nextAtMs = now + base + jitter

    this.backoff.set(relay, st)
    this.note('socket:backoff', relay, undefined, undefined, undefined, { attempts: st.attempts, waitMs: base + jitter })
  }

  private canAttemptRelay = (relay: string): boolean => {
    if (!this.isLoopbackRelay(relay)) return true
    // Loopback is fine when the app itself runs on a local origin. From a
    // real host it needs an EXPLICIT signal: the user-configured
    // hc:nostrmesh:relays list or the allow-loopback flag. Membership in
    // this.relays is not a signal — every relay we are asked about came
    // from this.relays, so that check passed unconditionally and let the
    // seeded loopback default through on production.
    if (this.isLocalContext()) return true
    if (this.userConfiguredRelays().includes(relay)) return true
    if (this.allowLoopbackRelay()) return true

    this.note('socket:skip-loopback-relay', relay)
    return false
  }

  private userConfiguredRelays = (): string[] => {
    // Only the explicit hc:nostrmesh:relays override counts — never seeds.
    try {
      const raw = localStorage.getItem('hc:nostrmesh:relays')
      const parsed = raw ? JSON.parse(raw) : null
      if (!Array.isArray(parsed)) return []
      return parsed.filter((u: any) => typeof u === 'string').map((u: string) => u.trim())
    } catch { return [] }
  }

  private isLocalContext = (): boolean => {
    // True when the app itself is being served from a local-development
    // origin. Used by loadRelays to prefer LOCAL_RELAY over LIVE_RELAY
    // when the operator is testing on the same machine that hosts the
    // relay — avoids round-tripping their own events through Cloudflare.
    try {
      const host = String(window?.location?.hostname ?? '').toLowerCase()
      if (!host) return false
      if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true
      if (host.endsWith('.local')) return true
      return false
    } catch {
      return false
    }
  }

  private isLoopbackRelay = (relay: string): boolean => {
    try {
      const u = new URL(relay)
      const h = String(u.hostname ?? '').trim().toLowerCase()
      return h === 'localhost' || h === '127.0.0.1' || h === '::1'
    } catch {
      return false
    }
  }

  private allowLoopbackRelay = (): boolean => {
    try { return localStorage.getItem('hc:nostrmesh:allow-loopback') === '1' } catch { return false }
  }

  // -----------------------------
  // inbound routing
  // -----------------------------

  private onMessage = (relay: string, data: any): void => {
    if (typeof data !== 'string' || !data) return

    this.stats.msgIn++

    const msg = this.tryJson(data)
    if (!Array.isArray(msg) || msg.length < 1) {
      this.stats.parseFail++
      this.note('in:parse-fail', relay, undefined, undefined, undefined, data)
      return
    }

    const type = String(msg[0] ?? '')

    if (type === 'NOTICE') {
      this.stats.msgNoticeIn++
      this.note('in:notice', relay, undefined, undefined, undefined, msg[1])
      // Drop NOTICEs are the relay telling us our events are being thrown
      // away ('rate-limited', 'message too large'). Swallowing them is how
      // the swarm union silently went one-sided — a publisher's layer
      // events vanished and nothing anywhere said so. Loud in the console;
      // the note() ring above keeps the full history for diagnostics.
      const noticeText = String(msg[1] ?? '')
      if (/rate-limited|too large/i.test(noticeText)) {
        console.warn(`[nostr-mesh] relay ${relay} is DROPPING our messages: "${noticeText}" — published events are not reaching peers`)
      }
      return
    }

    if (type === 'EOSE') {
      const subId = String(msg[1] ?? '')
      const bucket = this.bucketsBySubId.get(subId)
      if (bucket) this.resolveReadyWaiters(bucket.sig)

      this.stats.msgOtherIn++
      if (this.debug) this.note('in:eose', relay, bucket?.sig, subId)
      return
    }

    if (type !== 'EVENT') {
      this.stats.msgOtherIn++
      if (this.debug) this.note('in:other', relay, undefined, undefined, undefined, msg)
      return
    }

    this.stats.msgEventIn++

    const subId = String(msg[1] ?? '')
    const evt = msg[2] as NostrEvent | undefined
    if (!subId || !evt) return

    const bucket = this.bucketsBySubId.get(subId)
    if (!bucket) {
      this.stats.noBucket++
      if (this.debug) this.note('in:no-bucket', relay, undefined, subId, undefined, evt)
      return
    }

    // note: optional kind filter
    if (Array.isArray(this.kinds) && this.kinds.length > 0) {
      if (!this.kinds.includes(Number(evt.kind ?? 0))) return
    }

    // note: dedupe by event id across relays
    if (evt.id) {
      const id = String(evt.id)
      if (this.recentIdsSet.has(id)) {
        this.stats.dupDrop++
        return
      }
      this.pushRecentId(id)
    }

    const payload = this.parsePayload(evt)

    // note: cache first so heartbeat queries see it immediately
    this.cacheItem(relay, bucket.sig, evt, payload)
    this.resolveReadyWaiters(bucket.sig)

    const out: MeshEvt = { relay, sig: bucket.sig, event: evt, payload }

    for (const cb of bucket.cbs) {
      try { cb(out) } catch { /* ignore */ }
    }
  }

  private cacheItem = (relay: string, sig: string, evt: NostrEvent, payload: any): void => {
    const now = Date.now()
    const createdAtMs = Number(evt?.created_at ?? 0) > 0 ? Number(evt.created_at) * 1000 : now
    const item: CachedItem = { relay, sig, event: evt, payload, receivedAtMs: now, createdAtMs }

    const list = this.itemsBySig.get(sig) ?? []
    list.push(item)

    // note: cap newest by created time
    if (list.length > this.perSigCap) {
      list.sort((a, b) => (b.createdAtMs || b.receivedAtMs) - (a.createdAtMs || a.receivedAtMs))
      list.splice(this.perSigCap)
    }

    this.itemsBySig.set(sig, list)
    this.pruneSigExpired(sig)
  }

  private pushRecentId = (id: string): void => {
    this.recentIds.push(id)
    this.recentIdsSet.add(id)

    if (this.recentIds.length <= this.recentCap) return

    const drop = this.recentIds.splice(0, this.recentIds.length - this.recentCap)
    for (const d of drop) this.recentIdsSet.delete(d)
  }

  private parsePayload = (evt: NostrEvent): any => {
    const c = String(evt?.content ?? '')
    if (!c) return null

    const j = this.tryJson(c)
    if (j != null) return j

    return c
  }

  private readX = (tags: string[][]): string => {
    for (const t of tags) {
      if (!Array.isArray(t) || t.length < 2) continue
      if (String(t[0]) !== 'x') continue
      return String(t[1] ?? '')
    }
    return ''
  }

  // -----------------------------
  // outbound
  // -----------------------------

  private sendReqToAll = (b: Bucket): void => {
    if (!this.networkEnabled) return
    for (const url of this.sockets.keys()) this.sendReq(url, b)
  }

  private sendReq = (url: string, b: Bucket): void => {
    const ws = this.sockets.get(url)
    if (!ws || ws.readyState !== WebSocket.OPEN) return

    const filter: any = { '#x': [b.sig], since: Math.floor(Date.now() / 1000) - 900 }
    if (Array.isArray(this.kinds) && this.kinds.length > 0) filter.kinds = this.kinds

    this.stats.reqSent++
    this.note('out:req', url, b.sig, b.subId, undefined, filter)

    try { ws.send(JSON.stringify(['REQ', b.subId, filter])) } catch { /* ignore */ }
  }

  private sendCloseToAll = (subId: string): void => {
    for (const url of this.sockets.keys()) this.sendClose(url, subId)
  }

  private sendClose = (url: string, subId: string): void => {
    const ws = this.sockets.get(url)
    if (!ws || ws.readyState !== WebSocket.OPEN) return

    this.stats.closeSent++
    this.note('out:close', url, undefined, subId)

    try { ws.send(JSON.stringify(['CLOSE', subId])) } catch { /* ignore */ }
  }

  private sendEventToAll = (evt: NostrEvent): void => {
    const frame = JSON.stringify(['EVENT', evt])

    this.stats.eventSent++

    for (const ws of this.sockets.values()) {
      if (!this.networkEnabled) return
      if (ws.readyState !== WebSocket.OPEN) continue
      try { ws.send(frame) } catch { /* ignore */ }
    }
  }

  /**
   * Host-driven nuke. Sends `["HC_CLEAR"]` to every connected relay and
   * wipes our own in-memory item cache so the local view immediately
   * reflects the empty store. The HC_CLEAR message is a dev-only
   * extension recognised by `scripts/local-relay.ts`; compliant public
   * relays will treat it as an unknown frame and ignore it. The local
   * cache wipe is unconditional and helps when the user was looking at
   * cached peer state that had drifted from the relay.
   *
   * Public so MeshClearQueenBee (the `/clear-mesh` slash command) can
   * invoke it directly without going through the effect bus.
   */
  /**
   * Host-driven block. Sends `["HC_BLOCK", pubkey]` to every relay so
   * the relay drops every cached event from that pubkey and refuses
   * future EVENT messages from it. Pubkey may be a full 64-hex or a
   * short prefix (8–16 hex) — the relay handles both. Wipes any
   * matching events from our local cache too. Idempotent.
   */
  public sendHcBlock = (pubkey: string): { sent: number; cachedWiped: number } => {
    const pk = String(pubkey ?? '').trim().toLowerCase()
    if (!/^[0-9a-f]{8,64}$/.test(pk)) {
      console.warn('[nostr-mesh] sendHcBlock: invalid pubkey', pk)
      return { sent: 0, cachedWiped: 0 }
    }
    const frame = JSON.stringify(['HC_BLOCK', pk])
    let sent = 0
    for (const ws of this.sockets.values()) {
      if (ws.readyState !== WebSocket.OPEN) continue
      try { ws.send(frame); sent++ } catch { /* ignore */ }
    }
    // Wipe matching events from our own cache so the swarm view drops
    // immediately. Mirror the relay's prefix-matching behaviour.
    let cachedWiped = 0
    for (const [sig, arr] of this.itemsBySig) {
      const filtered = arr.filter(it => {
        const evtPk = String(it?.event?.pubkey ?? '').toLowerCase()
        const match = pk.length === 64 ? evtPk === pk : evtPk.startsWith(pk)
        if (match) cachedWiped++
        return !match
      })
      if (filtered.length !== arr.length) this.itemsBySig.set(sig, filtered)
    }
    this.note('hc-block:sent', undefined, undefined, undefined, undefined)
    return { sent, cachedWiped }
  }

  public sendHcClear = (): { sent: number; cachedBefore: number } => {
    const cachedBefore = this.itemsBySig.size
    const frame = JSON.stringify(['HC_CLEAR'])
    let sent = 0
    for (const ws of this.sockets.values()) {
      if (ws.readyState !== WebSocket.OPEN) continue
      try { ws.send(frame); sent++ } catch { /* ignore */ }
    }
    // Wipe local cache so peer views drop immediately (don't wait for
    // the relay's broadcast NOTICE — that's an opportunistic UI hint).
    this.itemsBySig.clear()
    this.note('hc-clear:sent', undefined, undefined, undefined, undefined)
    return { sent, cachedBefore }
  }

  private fanoutToSig = (relay: string, sig: string, evt: NostrEvent): void => {
    // note: always cache local fanout too so heartbeat queries see local publishes
    const payload = this.parsePayload(evt)
    this.cacheItem(relay, sig, evt, payload)

    const bucket = this.bucketsBySig.get(sig)
    if (!bucket || bucket.cbs.size === 0) return

    this.stats.localFanout++

    const out: MeshEvt = { relay, sig, event: evt, payload }

    for (const cb of bucket.cbs) {
      try { cb(out) } catch { /* ignore */ }
    }
  }

  private closeBucket = (b: Bucket): void => {
    this.sendCloseToAll(b.subId)
    this.bucketsBySig.delete(b.sig)
    this.bucketsBySubId.delete(b.subId)
    this.note('sub:closed', undefined, b.sig, b.subId)
  }

  private unsubscribe = (sig: string, cb: MeshCb): void => {
    const b = this.bucketsBySig.get(sig)
    if (!b) return

    b.cbs.delete(cb)
    this.note('sub:leave', undefined, sig, b.subId, undefined, { consumers: b.cbs.size })

    if (b.cbs.size > 0) return
    this.closeBucket(b)
  }

  // -----------------------------
  // expiry (mesh-owned)
  // -----------------------------

  private pruneAllExpired = (): void => {
    for (const sig of this.itemsBySig.keys()) this.pruneSigExpired(sig)
  }

  private pruneSigExpired = (sig: string): void => {
    const list = this.itemsBySig.get(sig)
    if (!list || list.length === 0) return

    const now = Date.now()
    const keep = list.filter(i => {
      const t = i.receivedAtMs || i.createdAtMs || 0
      const ttlMs = this.resolveTtlMs(sig, i.event)
      return t > 0 && (now - t) <= ttlMs
    })

    if (keep.length === 0) {
      this.itemsBySig.delete(sig)
      return
    }

    this.itemsBySig.set(sig, keep)
  }

  // -----------------------------
  // signing (delegated)
  // -----------------------------

  private trySign = async (evt: NostrEvent): Promise<NostrEvent | null> => {
    // note: if already signed, pass through
    if (evt?.id && evt?.pubkey && evt?.sig) return evt

    // note: nip-07 if available
    const anyWin = window as any
    if (anyWin?.nostr?.signEvent) {
      try {
        const signed = await anyWin.nostr.signEvent(evt)
        return signed ?? null
      } catch { /* ignore */ }
    }

    const signer = this.resolve<any>('signer')
    if (signer?.signEvent) {
      try {
        const signed = await signer.signEvent(evt)
        return signed ?? null
      } catch { /* ignore */ }
    }

    return null
  }

  // -----------------------------
  // helpers
  // -----------------------------


  private loadNetworkEnabled(): boolean {
  try {
    // Master privacy switch. Private mode (`hc:mesh-public` not set
    // to 'true') means zero mesh network — no relay subscriptions,
    // no publishes, no boot-time WebSocket bootstrap. The local
    // `hc:nostrmesh:network` key is a finer-grained opt-OUT, never
    // an opt-IN: when mesh-public is true the user has already
    // consented to mesh networking, so the network defaults ON
    // unless they explicitly disabled it via the `'0'` value.
    //
    // Why the asymmetry: the OLD behaviour was "mesh-public on AND
    // hc:nostrmesh:network='1' AND `hc:nostrmesh:relays` set". A fresh
    // incognito tab with mesh-public toggled on via UI would have
    // `hc:nostrmesh:network` UNSET → fall through → networkEnabled
    // stayed false, mesh never opened sockets, no peer events ever
    // arrived. The user saw their tiles never sync and concluded "the
    // mesh is broken". Treating absence as opt-in (default ON when
    // mesh-public is true) makes the public switch self-sufficient.
    // Users who want fine-grained off without flipping privacy still
    // have the explicit `'0'` value.
    if (localStorage.getItem('hc:mesh-public') !== 'true') return false
    const v = localStorage.getItem('hc:nostrmesh:network')
    if (v === '0') return false
    return true
  } catch {}
  // Storage unavailable: default to OFF so we never surprise-connect.
  return false
}


  private pauseNetwork = (): void => {
  for (const [url, st] of this.backoff.entries()) {
    if (st.timer) clearTimeout(st.timer)
    this.backoff.delete(url)
  }

  for (const [url, ws] of this.sockets.entries()) {
    try { ws.onopen = null; ws.onmessage = null; ws.onerror = null; ws.onclose = null } catch {}
    try { ws.close() } catch {}
    this.sockets.delete(url)
    this.note('socket:pause', url)
  }

  // Reset the across-relay event-id dedupe set on pause. The
  // replaceable-event slot at the relay survives our disconnect;
  // when we come back online (re-toggle to public) the relay
  // replays its latest stored event for our resubscribe — but the
  // publisher's heartbeat may not have re-fired yet, so the event
  // ID is identical to the one we already saw in the previous
  // session. Without this clear, `onMessage` would treat it as a
  // duplicate and silently drop it, leaving SwarmDrone's peer
  // cache empty until the publisher's next heartbeat (up to 30s).
  // Clearing here means the replay always reaches consumers; the
  // worst case is a single duplicate emission if the user toggles
  // rapidly, which is benign — replaceable caches converge.
  this.recentIds = []
  this.recentIdsSet.clear()
}

  private loadDebugFlag = (): boolean => {
    try { return localStorage.getItem('hc:nostrmesh:debug') === '1' } catch { return false }
  }

  private loadRelays = (fallback: string[]): string[] => {
    // Seed policy is origin-aware:
    //
    //   local origin → LOCAL_RELAY. The dev relay (scripts/local-relay.ts)
    //   serves the WS mesh AND HTTP content on one port and persists content
    //   across restarts, so two loopback tabs share a fully self-contained
    //   swarm with no per-tab setup.
    //
    //   real host → LIVE_RELAY. Seeding LOCAL_RELAY here was a bug twice
    //   over: every visitor dialed a dead loopback socket on infinite
    //   backoff, AND a public origin touching localhost trips Chrome's
    //   Local Network Access permission prompt at page open.
    //
    //   'hc:nostrmesh:use-live-relay' — '1' forces LIVE_RELAY anywhere,
    //   '0' opts out of it: a real host then idles with ZERO relays
    //   (publishes hit local fanout only) rather than falling back to
    //   loopback. 'hc:nostrmesh:relays' (explicit list) wins over both.
    //
    // IIFE on purpose: an inlined `let` here lets esbuild constant-propagate
    // the flag into the seed expression, dead-code-eliminating a LIVE_RELAY
    // or LOCAL_RELAY branch and removing the literal from the bundle.
    // Wrapping the read in an IIFE makes the value opaque to constant
    // propagation — esbuild cannot statically evaluate the return.
    const flag = ((): string | null => {
      try { return localStorage.getItem('hc:nostrmesh:use-live-relay') } catch { return null }
    })()
    const seed =
      flag === '1' ? [LIVE_RELAY]
      : this.isLocalContext() ? [LOCAL_RELAY]
      : flag === '0' ? []
      : [LIVE_RELAY]
    const defaults = fallback.length > 0 ? fallback : seed
    try {
      const raw = localStorage.getItem('hc:nostrmesh:relays')
      if (!raw) return defaults.slice()

      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) return defaults.slice()

      const next = parsed
        .filter((u: any) => typeof u === 'string')
        .map((u: string) => u.trim())
        .filter((u: string) => u.startsWith('ws://') || u.startsWith('wss://'))

      if (next.length === 0) return defaults.slice()
      return Array.from(new Set(next))
    } catch {
      return defaults.slice()
    }
  }

  private saveRelays = (urls: string[]): void => {
    try { localStorage.setItem('hc:nostrmesh:relays', JSON.stringify(urls)) } catch { /* ignore */ }
  }

  private loadKinds = (fallback: number[] | null): number[] | null => {
    try {
      const raw = localStorage.getItem('hc:nostrmesh:kinds')
      if (!raw) return fallback

      const parsed = JSON.parse(raw)
      if (parsed === null) return null
      if (!Array.isArray(parsed)) return fallback

      const next = parsed
        .map((k: any) => Number(k))
        .filter((k: number) => Number.isFinite(k) && k > 0)
        .sort((a: number, b: number) => a - b)

      const uniq = Array.from(new Set(next))
      return uniq.length ? uniq : fallback
    } catch {
      return fallback
    }
  }

  private saveKinds = (kinds: number[] | null): void => {
    try { localStorage.setItem('hc:nostrmesh:kinds', JSON.stringify(kinds)) } catch { /* ignore */ }
  }

  // fix: must be a real method (not an arrow-field) so it can be used during field initialization
  private newStats(): MeshStats {
    return {
      startedAtMs: 0,
      socketsOpened: 0,
      socketsClosed: 0,
      socketsErrors: 0,
      reqSent: 0,
      closeSent: 0,
      eventSent: 0,
      localFanout: 0,
      msgIn: 0,
      msgEventIn: 0,
      msgNoticeIn: 0,
      msgOtherIn: 0,
      parseFail: 0,
      noBucket: 0,
      sendSkippedNoSigner: 0,
      dupDrop: 0
    }
  }

  private note = (type: string, relay?: string, sig?: string, subId?: string, kind?: number, data?: any): void => {
    if (!this.debug) return

    const entry: MeshLog = { atMs: Date.now(), type, relay, sig, subId, kind, data }

    this.logs.push(entry)
    if (this.logs.length > this.logCap) this.logs.splice(0, this.logs.length - this.logCap)
  }

  private makeSubId = (): string => {
    const r = Math.random().toString(16).slice(2)
    const t = Date.now().toString(16)
    return `hc-${t}-${r}`
  }

  private tryJson = (s: string): any => {
    try { return JSON.parse(s) } catch { return null }
  }

  private sanitizeExpiryRules = (rules: MeshExpiryRule[]): MeshExpiryRule[] => {
    const out: MeshExpiryRule[] = []

    for (let i = 0; i < rules.length; i++) {
      const src = rules[i]
      if (!src || typeof src !== 'object') continue

      const ttl = Number((src as any).ttlMs ?? 0)
      if (!Number.isFinite(ttl) || ttl <= 0) continue

      const idRaw = String((src as any).id ?? '').trim()
      const id = idRaw || `rule-${i + 1}`

      const sigPrefixRaw = String((src as any).sigPrefix ?? '').trim()
      const sigPrefix = sigPrefixRaw ? sigPrefixRaw : undefined

      const kindNum = Number((src as any).kind)
      const kind = Number.isFinite(kindNum) && kindNum > 0 ? Math.floor(kindNum) : undefined

      out.push({
        id,
        ttlMs: Math.floor(ttl),
        sigPrefix,
        kind
      })
    }

    return out
  }

  private ensureDefaultExpiryRule = (): void => {
    const idx = this.expiryRules.findIndex(r => r.id === 'default')
    if (idx >= 0) {
      this.expiryRules[idx] = { id: 'default', ttlMs: this.ttlMs }
      return
    }

    this.expiryRules.push({ id: 'default', ttlMs: this.ttlMs })
  }

  private resolveTtlMs = (sig: string, evt: NostrEvent): number => {
    this.ensureDefaultExpiryRule()

    const kind = Number(evt?.kind ?? 0)
    const s = String(sig ?? '')

    for (const rule of this.expiryRules) {
      if (!rule || !Number.isFinite(rule.ttlMs) || rule.ttlMs <= 0) continue
      if (rule.sigPrefix && !s.startsWith(rule.sigPrefix)) continue
      if (typeof rule.kind === 'number' && Number.isFinite(rule.kind) && rule.kind > 0 && rule.kind !== kind) continue
      return Math.floor(rule.ttlMs)
    }

    return this.ttlMs
  }

  private resolveReadyWaiters = (sig: string): void => {
    const list = this.readyWaitersBySig.get(sig)
    if (!list || list.length === 0) return

    this.readyWaitersBySig.delete(sig)

    for (const waiter of list) {
      if (waiter.timer) {
        try { clearTimeout(waiter.timer) } catch { /* ignore */ }
      }
      try { waiter.resolve() } catch { /* ignore */ }
    }
  }

  private removeReadyWaiter = (sig: string, waiter: SigReadyWaiter): void => {
    const list = this.readyWaitersBySig.get(sig)
    if (!list || list.length === 0) return

    const idx = list.indexOf(waiter)
    if (idx < 0) return

    list.splice(idx, 1)
    if (list.length === 0) this.readyWaitersBySig.delete(sig)
  }
}

const meshDrone = new NostrMeshDrone()
window.ioc.register('@diamondcoreprocessor.com/NostrMeshDrone', meshDrone)