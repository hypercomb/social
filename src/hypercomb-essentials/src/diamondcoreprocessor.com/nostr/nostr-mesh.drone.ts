// hypercomb-essentials/src/diamondcoreprocessor.com/nostr/nostr-mesh.drone.ts
// upgrade: ttl-backed cache + non-expired query api
// - mesh owns expiry rules
// - consumers compute sig externally and call ensureStartedForSig(sig) + getNonExpired(sig)
// - cache supports both network events and local fanout
// - one network req per sig (shared across consumers)

import { Drone } from '@hypercomb/core'

// const HARD_RELAY = 'wss://nos.lol'
const HARD_RELAY = 'wss://relay.snort.social'

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

  protected override deps = { signer: 'NostrSigner' }
  protected override listens = ['mesh:ensure-started', 'mesh:subscribe', 'mesh:publish']
  protected override emits = ['mesh:ready', 'mesh:items-updated']

  // -----------------------------
  // config
  // -----------------------------

  // note: default public relay (can be overridden by localstorage/configureRelays)
  private relays: string[] = [HARD_RELAY]

  private forceHardRelay = (): void => {
    this.relays = [HARD_RELAY]
    try { localStorage.setItem('hc:nostrmesh:relays', JSON.stringify([HARD_RELAY])) } catch {}
  }

  // note: set to null to accept any kind matching x
  private kinds: number[] | null = [29010]

  // note: expiry rules live here
  private ttlMs = 120_000
  private perSigCap = 128
  private expiryRules: MeshExpiryRule[] = [
    { id: 'default', ttlMs: 120_000 }
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

  protected override heartbeat = async (): Promise<void> => {
    // note: still respects drone lifecycle, but we also self-start when subscribe/publish is used
    this.ensureStartedNow()

    // note: expiry is mesh responsibility
    this.pruneAllExpired()

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

  // -----------------------------
  // public api
  // -----------------------------

  public configureRelays = (_urls: string[], persist = true): void => {
    this.relays = [HARD_RELAY]
    if (persist) {
      try { localStorage.setItem('hc:nostrmesh:relays', JSON.stringify([HARD_RELAY])) } catch {}
    }
    this.reconnectAll()
  }

  private loadRelayConfig = (): void => {
    this.forceHardRelay()
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

    const tags: string[][] = [['x', s]]

    if (Array.isArray(extraTags)) {
      for (const t of extraTags) {
        if (!Array.isArray(t) || t.length < 2) continue
        tags.push(t.map(x => String(x)))
      }
    }

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
  this.forceHardRelay()
  this.ensureSocket(HARD_RELAY)
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
    if (relay !== HARD_RELAY) return
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
    if (this.allowLoopbackRelay()) return true

    this.note('socket:skip-loopback-relay', relay)
    return false
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

    const filter: any = { '#x': [b.sig] }
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
      const t = i.createdAtMs || i.receivedAtMs || 0
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
    const v = localStorage.getItem('hc:nostrmesh:network')
    if (v === '0') return false
    if (v === '1') return true
  } catch {}
  return true
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
}

  private loadDebugFlag = (): boolean => {
    try { return localStorage.getItem('hc:nostrmesh:debug') === '1' } catch { return false }
  }

  private loadRelays = (fallback: string[]): string[] => {
    try {
      const raw = localStorage.getItem('hc:nostrmesh:relays')
      if (!raw) return fallback.slice()

      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) return fallback.slice()

      const next = parsed
        .filter((u: any) => typeof u === 'string')
        .map((u: string) => u.trim())
        .filter((u: string) => u.startsWith('ws://') || u.startsWith('wss://'))

      return Array.from(new Set(next))
    } catch {
      return fallback.slice()
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
window.ioc.register(meshDrone.iocKey, meshDrone, 'NostrMeshDrone')
window.ioc.register('@diamondcoreprocessor.com/MeshDrone', meshDrone, 'MeshDrone')