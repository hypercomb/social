// tile-mesh.ts — THE TILES THIS PAGE SHARES, AND THE ONES PEERS SHARE WITH
// IT. A branch of the tile renderer (documentation/tile-renderer-tree.md):
// the legacy kind-29010 path on the Nostr mesh, keyed by the location's
// signature. It publishes this page's PUBLIC tiles (a snapshot first, deltas
// after, a snapshot again on demand or on lease renewal), answers a peer's
// sync request, and derives `cells` — the peers' tiles here, newest snapshot
// per publisher winning — for the renderer to paint beside its own.
//
// Opt-in and gated: nothing subscribes or publishes until the mesh is
// enabled AND a room and a secret are both set; clearing either seals it.

import { isCellPublic } from './tile-public.js'
import { isJoinedHere } from '../../sharing/membership.js'

export type MeshEvt = { relay: string; sig: string; event: any; payload: any }
export type MeshSub = { close: () => void }
export type MeshApi = {
  ensureStartedForSig: (sig: string) => void
  awaitReadyForSig?: (sig: string, timeoutMs?: number) => Promise<void>
  getNonExpired: (sig: string) => MeshEvt[]
  getSwarmSize?: (sig: string) => number
  publish?: (kind: number, sig: string, payload: any, extraTags?: string[][]) => Promise<boolean>
  subscribe?: (sig: string, cb: (e: MeshEvt) => void) => MeshSub
}

export interface MeshHost {
  lineage(): any
  mesh(): MeshApi | null
  /** The signature of the location the lineage stands at. */
  signatureOf(lineage: any): Promise<{ key: string; sig: string }>
  emit(effect: string, payload: unknown): void
  requestRender(): void
}

export class TileMesh {
  /** Mesh scoping — the room and the secret feed into who may hear this page. */
  room = ''
  secret = ''
  /** The peers' tiles at this location, derived on each refresh. */
  cells: string[] = []
  /** Bumped whenever `cells` changes, for the renderer's staleness checks. */
  rev = 0
  /** This device's publisher id, stable across reloads. */
  readonly publisherId: string = (() => {
    const key = 'hc:show-honeycomb:publisher-id'
    try {
      const existing = String(localStorage.getItem(key) ?? '').trim()
      if (existing) return existing

      const next = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
        ? crypto.randomUUID()
        : `pub-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

      localStorage.setItem(key, next)
      return next
    } catch {
      return `pub-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
    }
  })()

  #sig = ''
  #sub: MeshSub | null = null
  #snapshotPosted = new Set<string>()
  #lastLocalCells = new Map<string, string[]>()
  #lastGrammarSig = ''
  #lastGrammarCell = ''
  // lease renewal: periodic refresh to keep tiles alive for late joiners
  #lastRefreshAt = new Map<string, number>()
  // sync-request: one-shot per sig arrival
  #syncRequested = new Set<string>()
  // rate-limit triggered republishes from sync-requests
  #lastTriggeredRepublishAt = new Map<string, number>()

  constructor(private readonly host: MeshHost) {}

  /** Both credentials are set: the page may be shared at all. */
  get credentialed(): boolean { return !!this.room && !!this.secret }

  /** Leaving the swarm: no peer tiles until it is joined again. */
  clearPeers(): void {
    this.cells = []
    this.rev++
  }

  /** The renderer is going away: close the subscription. */
  close(): void {
    try { this.#sub?.close() } catch { /* ignore */ }
    this.#sub = null
  }

  refresh = async (grammar: string = '', forceResnapshot = false): Promise<void> => {
    // Mesh is opt-in. Default: dormant. Joining a public session sets the
    // flag below. Without it, no relay connections, no event subscriptions,
    // no per-event secp256k1 verifications. Local-only operation.
    const meshEnabled = (() => {
      try { return localStorage.getItem('hc:mesh-enabled') === 'true' } catch { return false }
    })()
    if (!meshEnabled) return

    const lineage = this.host.lineage()
    const mesh = this.host.mesh()
    if (!lineage || !mesh) return

    const signatureLocation = await this.host.signatureOf(lineage)
    const sig = signatureLocation.sig

    if (sig !== this.#sig) {
      const NOSTR = 'wss://relay.snort.social'
      const nakPayload = '{"cells":["external.alpha","Street Fighter"]}'
      const nakCmd = `nak event ${NOSTR} --kind 29010 --tag "x=${sig}" --content '${nakPayload}'`
      ; (window as any).__showHoneycombNakCommand = nakCmd
      // (debug logs removed — fired on every nav and slowed render with DevTools open)
    }

    if (!sig) return

    // Privacy gate — show-cell's legacy kind-29010 subscribe + publish
    // path was the un-credentialled leak the user reported ("the mesh
    // is sharing even without a location or password"). Without both
    // a room and a secret we MUST NOT subscribe (would receive other
    // peers' cached events from the relay) or publish (would broadcast
    // our local cell list to anyone listening on this lineage sig).
    // SwarmDrone has the same gate for the new kind-30200 path.
    if (!this.room || !this.secret) {
      // If we previously had a subscription open from a session with
      // credentials, close it now so the leak is sealed immediately
      // when the user clears credentials, not just on next lineage
      // change.
      if (this.#sub) {
        try { this.#sub.close() } catch { /* ignore */ }
        this.#sub = null
      }
      this.#sig = ''
      this.cells = []
      this.rev++
      return
    }

    const sigChanged = sig !== this.#sig

    if (sigChanged) {
      if (this.#sub) {
        try { this.#sub.close() } catch { /* ignore */ }
        this.#sub = null
      }

      this.#sig = sig
      this.cells = []
      this.rev++

      if (typeof mesh.subscribe === 'function') {
        this.#sub = mesh.subscribe(sig, (evt) => {
          // Only react to the legacy ephemeral kind that this drone owns.
          // Swarm-layer events (kind 30200) belong to SwarmDrone and don't
          // affect meshCells — re-rendering on every one of them churns
          // show-cell on each peer publish (and on our own local fanout).
          // Peer tiles still update at the next render trigger (navigation
          // / user interaction); they don't need per-event refreshes.
          const kind = Number((evt?.event as { kind?: number } | undefined)?.kind ?? 0)
          if (kind && kind !== 29010) return

          // detect sync-request from another publisher — trigger immediate republish
          this.#handleIncomingSyncRequest(evt, mesh, sig)

          void (async () => {
            await this.refresh()
            this.host.requestRender()
          })()
        })
      }
    }

    // Private mode is a hard boundary: rendering/warm-up must not start mesh
    // consumers as a side effect. In particular, the delayed synchronize pass
    // reaches this method after first paint; emitting mesh:ensure-started here
    // used to wake SwarmDrone, presence, avatars, and meeting consumers even
    // while the UI said private. Keep the mesh completely cold until the user
    // explicitly enters public/swarm mode.
    if (isJoinedHere()) {
      mesh.ensureStartedForSig(sig)
      this.host.emit('mesh:ensure-started', { signature: sig })
    }


    // note: publish local filesystem cells for this sig when changed
    await this.#publishLocalCells(lineage, mesh, sig, grammar, forceResnapshot)

    // note: get non-expired items (mesh owns ttl)
    const items = mesh.getNonExpired(sig)

    // sync-request: if we arrived and see no items from other publishers, ask the swarm to republish
    if (!this.#syncRequested.has(sig) && this.#snapshotPosted.has(sig)) {
      const hasOtherPublishers = items.some(it => {
        const pubId = this.#readPublisherIdFromEvent(it?.event)
        return pubId && pubId !== this.publisherId
      })
      if (!hasOtherPublishers && typeof mesh.publish === 'function') {
        this.#syncRequested.add(sig)
        void mesh.publish(29010, sig, {
          type: 'sync-request',
          publisherId: this.publisherId,
          requestedAtMs: Date.now()
        }, [['publisher', this.publisherId], ['mode', 'sync-request']])
      }
    }

    if (!items || items.length === 0) {
      if (this.cells.length !== 0) {
        this.cells = []
        this.rev++
      }
      return
    }

    // LATEST-SNAPSHOT-WINS per publisher (was: union every non-expired
    // payload). The old union could never RETRACT — a tile flipped private
    // (or removed) lingered in the merged set until its original snapshot
    // aged out of the 10-min cache. Now each publisher's membership is the
    // cells of their NEWEST full snapshot, plus any single-cell deltas
    // published at/after it. A fresh snapshot with the reduced set (forced
    // on tile:public-changed) therefore drops the retracted tile at once.
    // getNonExpired returns items newest-first, so the first full we see
    // for a publisher is their newest; `>=` lets a same-second republish
    // (sorted oldest-received-first within a tie) supersede correctly.
    type PubAgg = { fullCells: string[] | null; fullAtMs: number; deltas: { cell: string; atMs: number }[] }
    const byPublisher = new Map<string, PubAgg>()
    const anonCells = new Set<string>()   // events with no publisher id (e.g. external tools) — unioned

    for (const it of items) {
      const evt = it?.event
      const p = it?.payload

      const tagPublisherId = this.#readPublisherIdFromEvent(evt)
      const payloadPublisherId = String(p?.publisherId ?? p?.publisher ?? p?.clientId ?? '').trim()
      const publisherId = tagPublisherId || payloadPublisherId
      if (publisherId && publisherId === this.publisherId) continue   // our own echo

      // Classify via tags: mode=snapshot/refresh → authoritative full list;
      // mode=delta → additive single cell; mode=sync-request → not cells;
      // grammar heartbeats (no mode) are additive too. Anything else with
      // no mode (explicit list publish, external tooling) is a full list.
      let mode = ''
      let isGrammar = false
      const tags = Array.isArray(evt?.tags) ? evt.tags : []
      for (const t of tags) {
        if (!Array.isArray(t) || t.length < 2) continue
        const k = String(t[0] ?? '').trim().toLowerCase()
        if (k === 'mode') mode = String(t[1] ?? '').trim().toLowerCase()
        else if (k === 'source' && String(t[1] ?? '').trim() === 'show-honeycomb:grammar-heartbeat') isGrammar = true
      }
      if (mode === 'sync-request') continue

      const cells = this.#extractCellsFromEventContent(evt?.content)
      if (cells.length === 0) continue

      const atMs = Number(evt?.created_at ?? 0) > 0 ? Number(evt.created_at) * 1000 : 0

      if (!publisherId) {
        for (const cell of cells) anonCells.add(cell)
        continue
      }

      let agg = byPublisher.get(publisherId)
      if (!agg) { agg = { fullCells: null, fullAtMs: 0, deltas: [] }; byPublisher.set(publisherId, agg) }

      const isFullList = mode === 'snapshot' || mode === 'refresh' || (!mode && !isGrammar)
      if (isFullList) {
        if (agg.fullCells === null || atMs >= agg.fullAtMs) { agg.fullCells = cells; agg.fullAtMs = atMs }
      } else {
        for (const cell of cells) agg.deltas.push({ cell, atMs })
      }
    }

    const set = new Set<string>(anonCells)
    for (const agg of byPublisher.values()) {
      if (agg.fullCells) {
        for (const cell of agg.fullCells) set.add(cell)
        // additions published at/after the chosen snapshot
        for (const d of agg.deltas) if (d.atMs >= agg.fullAtMs) set.add(d.cell)
      } else {
        // No snapshot seen from this publisher (deltas/grammar only) — no
        // baseline to retract against, so union what they sent.
        for (const d of agg.deltas) set.add(d.cell)
      }
    }

    const next = Array.from(set)
    next.sort((a, b) => a.localeCompare(b))

    const sameLen = next.length === this.cells.length
    let same = sameLen
    if (same) {
      for (let i = 0; i < next.length; i++) {
        if (next[i] !== this.cells[i]) { same = false; break }
      }
    }

    if (!same) {
      this.cells = next
      this.rev++
    }
  }

  publishList = async (cells: string[]): Promise<boolean> => {
    const lineage = this.host.lineage()
    const mesh = this.host.mesh()
    if (!lineage || !mesh || typeof mesh.publish !== 'function') return false

    const signatureLocation = await this.host.signatureOf(lineage)
    if (!signatureLocation.sig) return false

    const normalized = Array.isArray(cells)
      ? cells.map(s => String(s ?? '').trim()).filter(s => s.length > 0)
      : []

    const payload = normalized.join(',')
    const ok = await mesh.publish(29010, signatureLocation.sig, payload, [['publisher', this.publisherId]])

    await this.refresh()
    this.host.requestRender()

    return !!ok
  }

  #publishLocalCells = async (lineage: any, mesh: MeshApi, sig: string, grammar: string = '', forceResnapshot = false): Promise<void> => {
    if (typeof mesh.publish !== 'function') return

    // Source the cell list from the current layer's children (layer-as-primitive),
    // not from an OPFS dir walk. Reads via lineage.currentLayer() — the
    // single navigation+state primitive — and resolves child sigs to
    // names via HistoryService.getLayerBySig. If neither is ready we
    // publish an empty children list (same semantic as "I'm here,
    // contributing nothing yet"); we never fall back to OPFS dirs.
    const historyService = (window as any).ioc?.get?.('@diamondcoreprocessor.com/HistoryService') as {
      getLayerBySig: (s: string) => Promise<{ name?: string } | null>
    } | undefined
    let localCells: string[] = []
    if (typeof (lineage as { currentLayer?: () => Promise<unknown> })?.currentLayer === 'function' && historyService?.getLayerBySig) {
      try {
        const layer = await (lineage as { currentLayer: () => Promise<unknown> }).currentLayer()
        const childSigs = Array.isArray((layer as { children?: readonly unknown[] } | null)?.children)
          ? ((layer as { children: readonly unknown[] }).children)
          : []
        const resolved = await Promise.all(childSigs.map(async (cs) => {
          try {
            const child = await historyService.getLayerBySig(String(cs ?? ''))
            return typeof child?.name === 'string' && child.name.length > 0 ? child.name : null
          } catch { return null }
        }))
        localCells = resolved.filter((n): n is string => n !== null)
      } catch { /* keep empty */ }
    }

    // PUBLIC FILTER — broadcast only the public subset on this mesh path too
    // (kind 29010), mirroring swarm.drone's #publishSubtree. Private tiles
    // must never leave the device. isCellPublic is branch-aware.
    const publicLocation = String(lineage?.explorerLabel?.() ?? '/')
    localCells = localCells.filter(name => isCellPublic(publicLocation, name))

    const previousCells = this.#lastLocalCells.get(sig) ?? []

    // A full snapshot is authoritative: the latest-snapshot-wins consumer
    // (refreshMeshCells) treats the newest snapshot per publisher as that
    // publisher's complete membership. Post one on first publish for this
    // sig, or on demand (forceResnapshot) when a tile flips public→private —
    // a fresh snapshot carrying the reduced set is the ONLY way to RETRACT
    // on this kind-29010 path: it isn't a replaceable event, and the delta
    // stream below is add-only. Without it, an un-shared tile lingered in
    // the consumer's union until the original snapshot expired (~10 min).
    if (forceResnapshot || !this.#snapshotPosted.has(sig)) {
      await mesh.publish(29010, sig, {
        cells: localCells,
        publisherId: this.publisherId,
        mode: 'snapshot',
        publishedAtMs: Date.now()
      }, [['publisher', this.publisherId], ['mode', 'snapshot']])
      this.#snapshotPosted.add(sig)
      this.#lastRefreshAt.set(sig, Date.now())
    } else {
      // Steady state: post only newly ADDED items as single-cell deltas so
      // peers see additions instantly without re-sending the whole list.
      // Removals/retractions never travel as deltas — they ride the next
      // snapshot (forced above, or the periodic refresh below).
      const prevSet = new Set(previousCells)
      for (const cell of localCells) {
        if (prevSet.has(cell)) continue
        await mesh.publish(29010, sig, cell, [['publisher', this.publisherId], ['mode', 'delta']])
      }
    }

    this.#lastLocalCells.set(sig, localCells)

    // 3) periodic refresh (lease renewal) — re-publish full cell list so late joiners see tiles
    const now = Date.now()
    const lastRefresh = this.#lastRefreshAt.get(sig) ?? 0
    const refreshInterval = this.#computeRefreshInterval(mesh, sig)
    if (lastRefresh > 0 && (now - lastRefresh) >= refreshInterval) {
      await mesh.publish(29010, sig, {
        cells: localCells,
        publisherId: this.publisherId,
        mode: 'refresh',
        publishedAtMs: now
      }, [['publisher', this.publisherId], ['mode', 'refresh']])
      this.#lastRefreshAt.set(sig, now)
    }

    const grammarCell = this.#toGrammarCell(grammar)
    const grammarIsNew = grammarCell && (sig !== this.#lastGrammarSig || grammarCell !== this.#lastGrammarCell)
    if (grammarIsNew) {
      await mesh.publish(29010, sig, grammarCell, [['publisher', this.publisherId], ['source', 'show-honeycomb:grammar-heartbeat']])

      this.#lastGrammarSig = sig
      this.#lastGrammarCell = grammarCell
    }
  }

  // swarm-adaptive refresh interval: smaller swarms refresh more frequently
  #computeRefreshInterval = (mesh: MeshApi, sig: string): number => {
    const swarmSize = typeof mesh.getSwarmSize === 'function' ? mesh.getSwarmSize(sig) : 0
    const jitter = Math.floor(Math.random() * 5000)
    if (swarmSize > 20) return 90_000 + jitter
    if (swarmSize > 5) return 60_000 + jitter
    return 45_000 + jitter
  }

  // handle incoming sync-request from another publisher — republish snapshot (rate-limited)
  #handleIncomingSyncRequest = (evt: MeshEvt, mesh: MeshApi, sig: string): void => {
    if (typeof mesh.publish !== 'function') return

    const tags = evt?.event?.tags
    if (!Array.isArray(tags)) return

    // check for mode=sync-request tag
    let isSyncRequest = false
    let requestPublisherId = ''
    for (const t of tags) {
      if (!Array.isArray(t) || t.length < 2) continue
      if (String(t[0]) === 'mode' && String(t[1]) === 'sync-request') isSyncRequest = true
      if (String(t[0]) === 'publisher') requestPublisherId = String(t[1] ?? '').trim()
    }

    if (!isSyncRequest) return
    if (requestPublisherId === this.publisherId) return // ignore own sync-request

    // rate-limit: at most one triggered republish per 10s + jitter per sig
    const now = Date.now()
    const lastTriggered = this.#lastTriggeredRepublishAt.get(sig) ?? 0
    const cooldown = 10_000 + Math.floor(Math.random() * 3000)
    if ((now - lastTriggered) < cooldown) return

    this.#lastTriggeredRepublishAt.set(sig, now)

    // republish current local cells as snapshot
    const localCells = this.#lastLocalCells.get(sig) ?? []
    if (localCells.length === 0) return

    void mesh.publish(29010, sig, {
      cells: localCells,
      publisherId: this.publisherId,
      mode: 'snapshot',
      publishedAtMs: now
    }, [['publisher', this.publisherId], ['mode', 'snapshot']])

    // reset refresh timer since we just published
    this.#lastRefreshAt.set(sig, now)
  }

  #readPublisherIdFromEvent = (evt: any): string => {
    const tags = evt?.tags
    if (!Array.isArray(tags)) return ''

    for (const t of tags) {
      if (!Array.isArray(t) || t.length < 2) continue
      const k = String(t[0] ?? '').trim().toLowerCase()
      if (k !== 'publisher' && k !== 'p') continue

      const v = String(t[1] ?? '').trim()
      if (v) return v
    }

    return ''
  }

  #extractCellsFromEventContent = (content: any): string[] => {
    const raw = String(content ?? '').trim()
    if (!raw) return []

    // direct CSV content (preferred): "a,b,c"
    if (!raw.startsWith('{') && !raw.startsWith('[') && !raw.startsWith('"')) {
      return this.#splitCsv(raw)
    }

    // JSON / structured content
    try {
      const parsed = JSON.parse(raw)

      if (typeof parsed === 'string') return this.#splitCsv(parsed)

      if (Array.isArray(parsed)) {
        const out: string[] = []
        for (const x of parsed) out.push(...this.#splitCsv(String(x ?? '')))
        return out
      }

      if (parsed && typeof parsed === 'object') {
        const out: string[] = []
        const cells = (parsed as any).cells ?? (parsed as any).seeds
        if (Array.isArray(cells)) {
          for (const x of cells) out.push(...this.#splitCsv(String(x ?? '')))
        }

        const cell = String((parsed as any).cell ?? (parsed as any).seed ?? '').trim()
        if (cell) out.push(...this.#splitCsv(cell))
        return out
      }
    } catch {
      // tolerant fallback for non-strict object-like payloads:
      // {cells:[hello2,world2],pubs:123}
      const cellsMatch = raw.match(/(?:cells|seeds)\s*:\s*\[([^\]]*)\]/i)
      if (cellsMatch && cellsMatch[1]) {
        return this.#splitCsv(String(cellsMatch[1] ?? ''))
      }

      // do not split structured text blindly into junk tiles
      if (this.#looksStructuredContent(raw)) return []

      // non-structured plain text fallback
      return this.#splitCsv(raw)
    }

    return []
  }

  #looksStructuredContent = (raw: string): boolean => {
    const s = String(raw ?? '').trim()
    if (!s) return false
    return s.startsWith('{') || s.startsWith('[') || s.startsWith('"')
  }

  #splitCsv = (raw: string): string[] => {
    const out: string[] = []
    const parts = String(raw ?? '').split(',')
    for (const part of parts) {
      let cell = String(part ?? '').trim()
      if (cell.startsWith('"') && cell.endsWith('"') && cell.length >= 2) {
        cell = cell.slice(1, -1).trim()
      }
      if (cell.startsWith("'") && cell.endsWith("'") && cell.length >= 2) {
        cell = cell.slice(1, -1).trim()
      }
      if (cell) out.push(cell)
    }
    return out
  }

  #toGrammarCell = (grammar: string): string => {
    const raw = String(grammar ?? '').trim()
    if (!raw) return ''
    if (raw.startsWith('show-honeycomb:')) return ''
    return raw
  }
}
