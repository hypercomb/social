// diamondcoreprocessor.com/bridge/claude-bridge.worker.ts
import { Worker, EffectBus, normalizeCell, hypercomb, isSignature, SignatureService } from '@hypercomb/core'
import { readTilePropertiesAt, writeTilePropertiesAt, readTilePropsSigAt, cellLocationSig, readTilePropsIndex, writeTilePropsIndex } from '../editor/tile-properties.js'
import type { HistoryService } from '../history/history.service.js'
import type { LayerSlotRegistry } from '../history/layer-slot-registry.js'
import { inflate } from '../history/inflate.js'
import { extractPageRefSigs, collectSigsDeep } from '../sharing/decoration-closure.js'
import { markAuthored, markLayerAuthoredPageSigs } from '../sharing/authored-sigs.js'

// Bridge protocol — matches @hypercomb/sdk/bridge
const BRIDGE_PORT = 2401
const BRIDGE_ENABLED_QUERY_KEY = 'claudeBridge'
const BRIDGE_ENABLED_STORAGE_KEY = 'hypercomb.claudeBridge.enabled'

/** Per-cell context bag slot — value is a sig array. Each entry is a
 *  resource sig (a content file at the flat OPFS root; legacy
 *  `__resources__/` is a read-fallback) that the LLM should see when working
 *  on this cell (prior impls, chrome refs, examples, etc). Add/remove
 *  rewrites the array, the new bag sig replaces the old slot value, one
 *  cascade carries it up. Passive — no triggers; bridge `update` and
 *  `bag-add`/`bag-remove` are the writers. */
const CONTEXT_SLOT = 'context'

type BridgeRequest = {
  id: string
  op: string
  cells?: string[]
  all?: boolean
  cell?: string
  text?: string
  segments?: string[]
  /** Layer-as-primitive update payload. Caller passes `{ name, ...slots }`
   *  where each slot value is an array of strings. The receiver creates OPFS
   *  folders for any names in `children`, then calls `committer.update`. */
  layer?: { name?: string } & { [slot: string]: unknown }
  /** Resource bytes for `put-resource`. One of `text` / `base64` is required. */
  base64?: string
  /** Resource sig for `get-resource`. */
  sig?: string
  /** Bag manipulation. */
  slot?: string
  /** Optimization filter — `optimization-list` returns only entries
   *  whose top-level `kind` matches (e.g. `'qa'`). Layer slots are
   *  unrelated to this filter. Also used by `decoration-add` as the
   *  kind tag on the new decoration record. */
  kind?: string
  /** Decoration record fields (decoration-add). */
  appliesTo?: string[]
  payload?: unknown
  mark?: string
  /** When true (decoration-add), drop existing decorations of the same
   *  kind from the cell's `decorations` slot before appending the new
   *  sig. Preserves the "one per kind" semantic for single-output bees
   *  like /website. */
  replaceKind?: boolean
}
type BridgeResponse = { id: string; ok: boolean; data?: unknown; error?: string }

const RECONNECT_MS = 3_000

export class ClaudeBridgeWorker extends Worker {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'assistant'

  public override description =
    'Claude CLI bridge — receives tile commands over WebSocket and executes against OPFS.'

  public override grammar = [
    { example: 'claude bridge' }
  ]

  public override effects = [] as const

  #ws: WebSocket | null = null
  #timer: ReturnType<typeof setTimeout> | null = null

  /** Warmup: subscribe to the explicit `claude-bridge:connect` event AND
   *  attempt an auto-connect. The auto-connect is gated by `#isEnabled()`
   *  (localhost + opt-in flag via URL query or localStorage), so users who
   *  haven't enabled the bridge see no WS attempt at all. Users who HAVE
   *  enabled it get a renderer registration on every page load — no manual
   *  `connect()` console paste needed for Node scripts (e.g.
   *  `_dolphin-revision.cjs`) to find a renderer. */
  protected override act = async (): Promise<void> => {
    this.onEffect('claude-bridge:connect', () => this.connect())
    // Auto-connect when the opt-in flag is set; #isEnabled() short-circuits
    // for everyone else, keeping the console clean in default dev sessions.
    this.connect()
  }

  /** Open the bridge WebSocket. Gated by `#isEnabled()` (host + opt-in
   *  flag) and idempotent — safe to call multiple times. */
  public connect(): void {
    if (this.#ws) return
    if (!this.#isEnabled()) return
    this.#connect()
  }

  #isEnabled(): boolean {
    try {
      // bridge only operates on localhost — never attempt in production
      const host = window.location.hostname
      if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1') return false

      const queryValue = new URLSearchParams(window.location.search).get(BRIDGE_ENABLED_QUERY_KEY)
      if (queryValue !== null) return /^(1|true|yes|on)$/i.test(queryValue)

      const storedValue = window.localStorage.getItem(BRIDGE_ENABLED_STORAGE_KEY)
      if (storedValue !== null) return /^(1|true|yes|on)$/i.test(storedValue)
    } catch {
      return false
    }

    return false
  }

  // ------- WebSocket lifecycle -------

  #connected = false

  #connect(): void {
    try {
      const ws = new WebSocket(`ws://localhost:${BRIDGE_PORT}`)

      ws.onopen = () => {
        this.#connected = true
        ws.send(JSON.stringify({ type: 'renderer' }))
        console.log('[claude-bridge] connected')
      }

      ws.onmessage = (event) => {
        void this.#handleMessage(String(event.data))
      }

      ws.onclose = () => {
        const wasConnected = this.#connected
        this.#ws = null
        this.#connected = false
        // Only reconnect if we previously had a successful connection.
        // Avoids spamming the console when the bridge server isn't running.
        if (wasConnected) {
          console.log('[claude-bridge] disconnected, will reconnect')
          this.#scheduleReconnect()
        }
      }

      ws.onerror = () => {
        // onclose fires after onerror — reconnect handled there
      }

      this.#ws = ws
    } catch {
      // Initial connection failed — bridge server not running, stay silent
    }
  }

  #scheduleReconnect(): void {
    if (this.#timer) return
    this.#timer = setTimeout(() => {
      this.#timer = null
      this.#connect()
    }, RECONNECT_MS)
  }

  // ------- message handling -------

  async #handleMessage(raw: string): Promise<void> {
    let req: BridgeRequest
    try {
      req = JSON.parse(raw)
    } catch {
      return
    }

    if (!req.id || !req.op) return

    let res: BridgeResponse
    try {
      res = await this.#dispatch(req)
    } catch (err: any) {
      res = { id: req.id, ok: false, error: err?.message ?? 'unknown error' }
    }

    if (this.#ws?.readyState === WebSocket.OPEN) {
      this.#ws.send(JSON.stringify(res))
    }
  }

  async #dispatch(req: BridgeRequest): Promise<BridgeResponse> {
    switch (req.op) {
      case 'update':       return this.#update(req)
      case 'note-add':     return this.#noteAdd(req)
      case 'note-list':    return this.#noteList(req)
      case 'note-delete':  return this.#noteDelete(req)
      case 'notes-digest': return this.#notesDigest(req)
      case 'list-at':      return this.#listAt(req)
      case 'inflate':      return this.#inflate(req)
      case 'layer-at':     return this.#layerAt(req)
      case 'put-resource': return this.#putResource(req)
      case 'get-resource': return this.#getResource(req)
      case 'optimization-add':    return this.#optimizationAdd(req)
      case 'optimization-list':   return this.#optimizationList(req)
      case 'optimization-remove': return this.#optimizationRemove(req)
      case 'feedback-channel-status': return this.#feedbackChannelStatus(req)
      case 'decoration-add':      return this.#decorationAdd(req)
      case 'bag-add':      return this.#bagMutate(req, 'add')
      case 'bag-remove':   return this.#bagMutate(req, 'remove')
      case 'bag-set':      return this.#bagSet(req)
      case 'stamp':        return this.#stamp(req)
      case 'add':          return this.#add(req)        // legacy: delegates to update
      case 'remove':       return this.#remove(req)     // legacy: delegates to update
      case 'list':         return this.#list(req)
      case 'inspect':      return this.#inspect(req)
      case 'history':      return this.#history(req)
      case 'submit':       return this.#submit(req)
      default:             return { id: req.id, ok: false, error: `unknown op: ${req.op}` }
    }
  }

  // ─── resource I/O ──────────────────────────────────────────────────
  //
  // Content-addressed put: bytes in (text or base64), sig out. Mints a
  // resource in __resources__/ via Store.putResource — same path the rest
  // of the system uses, so dedup, OPFS write, and the content:wrote
  // sentinel mirror all happen.
  async #putResource(req: BridgeRequest): Promise<BridgeResponse> {
    const store = get<{ putResource?: (blob: Blob) => Promise<string> }>('@hypercomb.social/Store')
    if (!store?.putResource) return { id: req.id, ok: false, error: 'Store.putResource not available' }

    let bytes: Uint8Array | null = null
    if (typeof req.base64 === 'string' && req.base64.length > 0) {
      try { bytes = base64ToBytes(req.base64) } catch (e: any) {
        return { id: req.id, ok: false, error: `bad base64: ${e?.message ?? 'decode failed'}` }
      }
    } else if (typeof req.text === 'string') {
      bytes = new TextEncoder().encode(req.text)
    } else {
      return { id: req.id, ok: false, error: 'put-resource needs `text` or `base64`' }
    }

    const blob = new Blob([bytes as BlobPart])
    const sig = await store.putResource(blob)
    return { id: req.id, ok: true, data: { sig, bytes: bytes.byteLength } }
  }

  // Content-addressed get: sig in, bytes out. Returns text when the
  // resource is valid UTF-8, otherwise base64. Caller can request a
  // specific encoding via req.text='base64' if it wants raw bytes.
  async #getResource(req: BridgeRequest): Promise<BridgeResponse> {
    const sig = typeof req.sig === 'string' ? req.sig.trim() : ''
    if (!isSignature(sig)) return { id: req.id, ok: false, error: 'get-resource requires `sig` (64-hex)' }

    const store = get<{ getResource?: (sig: string) => Promise<Blob | null> }>('@hypercomb.social/Store')
    if (!store?.getResource) return { id: req.id, ok: false, error: 'Store.getResource not available' }

    const blob = await store.getResource(sig)
    if (!blob) return { id: req.id, ok: false, error: `resource not found: ${sig.slice(0, 12)}…` }

    const buffer = await blob.arrayBuffer()
    const bytes = new Uint8Array(buffer)
    const force64 = req.text === 'base64'
    if (!force64) {
      try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
        return { id: req.id, ok: true, data: { sig, encoding: 'text' as const, text, bytes: bytes.byteLength } }
      } catch { /* fall through to base64 for non-UTF-8 */ }
    }
    return {
      id: req.id,
      ok: true,
      data: { sig, encoding: 'base64' as const, base64: bytesToBase64(bytes), bytes: bytes.byteLength },
    }
  }

  // ─── persistent decoration substrate (sign('optimization') pool) ───
  //
  // Mint, list, and remove optimization objects in the sign('optimization')
  // pool of meaning at the OPFS root (legacy `__optimization__/` is a
  // read-fallback the Store absorb drains). Physical access is the Store
  // pool API (putOptimization/listOptimizations/removeOptimization).
  // Each entry is a content-addressed JSON file (Q&A, comm, future kinds).
  // Layer-untouched: this directory is structurally separate from any
  // cell's layer slots. The dashboard reader and state-machine wrappers
  // around base objects pull from here at access/render time.

  async #optimizationAdd(req: BridgeRequest): Promise<BridgeResponse> {
    const store = get<{ putOptimization?: (blob: Blob) => Promise<string> }>('@hypercomb.social/Store')
    if (!store?.putOptimization) return { id: req.id, ok: false, error: 'Store.putOptimization not available' }
    if (typeof req.text !== 'string' || req.text.length === 0) {
      return { id: req.id, ok: false, error: 'optimization-add needs `text` (JSON payload)' }
    }
    try { JSON.parse(req.text) } catch {
      return { id: req.id, ok: false, error: 'optimization-add: `text` must be valid JSON' }
    }
    const bytes = new TextEncoder().encode(req.text)
    const blob = new Blob([bytes as BlobPart])
    const sig = await store.putOptimization(blob)
    return { id: req.id, ok: true, data: { sig, bytes: bytes.byteLength } }
  }

  async #optimizationList(req: BridgeRequest): Promise<BridgeResponse> {
    const store = get<{
      listOptimizations?: () => Promise<string[]>
      getOptimization?: (sig: string) => Promise<Blob | null>
    }>('@hypercomb.social/Store')
    if (!store?.listOptimizations || !store?.getOptimization) {
      return { id: req.id, ok: false, error: 'Store optimization API not available' }
    }
    const wantKind = typeof req.kind === 'string' && req.kind.trim() ? req.kind.trim() : null
    const sigs = await store.listOptimizations()
    const items: Array<{ sig: string; kind?: string; appliesTo?: unknown; payload?: unknown; mark?: string }> = []
    for (const sig of sigs) {
      const blob = await store.getOptimization(sig)
      if (!blob) continue
      let parsed: any
      try { parsed = JSON.parse(await blob.text()) } catch { continue }
      if (wantKind && parsed?.kind !== wantKind) continue
      items.push({ sig, kind: parsed?.kind, appliesTo: parsed?.appliesTo, payload: parsed?.payload, mark: parsed?.mark })
    }
    return { id: req.id, ok: true, data: { items, count: items.length } }
  }

  async #optimizationRemove(req: BridgeRequest): Promise<BridgeResponse> {
    const store = get<{ removeOptimization?: (sig: string) => Promise<boolean> }>('@hypercomb.social/Store')
    if (!store?.removeOptimization) return { id: req.id, ok: false, error: 'Store.removeOptimization not available' }
    const sig = typeof req.sig === 'string' ? req.sig.trim() : ''
    if (!isSignature(sig)) return { id: req.id, ok: false, error: 'optimization-remove requires `sig` (64-hex)' }
    const removed = await store.removeOptimization(sig)
    return { id: req.id, ok: true, data: { sig, removed } }
  }

  // ─── feedback-channel-status ───────────────────────────────────────
  //
  // Liveness readout for the durable feedback channel. The loop routine calls
  // this in preflight to assert the transport is actually converged (enabled +
  // a channelId) before reading the inbox — so a misconfigured cycle fails
  // loudly instead of silently reporting an empty inbox forever.
  async #feedbackChannelStatus(req: BridgeRequest): Promise<BridgeResponse> {
    const drone = get<{ status?: () => Promise<{ enabled: boolean; channelId: string | null; pending: number; ingested: number }> }>('@diamondcoreprocessor.com/FeedbackChannelDrone')
    if (!drone?.status) return { id: req.id, ok: false, error: 'FeedbackChannelDrone not available' }
    try { return { id: req.id, ok: true, data: await drone.status() } }
    catch (e) { return { id: req.id, ok: false, error: `channel status failed: ${(e as Error)?.message ?? 'unknown'}` } }
  }

  // ─── decoration-add ────────────────────────────────────────────────
  //
  // Composite write: mint a decoration record in `__resources__` AND
  // wire its sig into the cell's `decorations` slot in one bridge call.
  // Equivalent to `put-resource` + `bag-add slot=decorations` but
  // saves a round-trip and atomically applies the cascade.
  //
  // Decoration JSONs live in `__resources__` (not `__optimization__`)
  // so they ride the existing replication/sharing pipeline. Peer adopters
  // resolve decoration sigs through the same getResource path as HTML
  // pages, images, and other shared content. `__optimization__` stays
  // reserved for personal-only decorations (Q&A, comms) that should not
  // leak across peers.
  //
  // Request shape:
  //   {
  //     op: 'decoration-add',
  //     segments: ['dolphin', 'site'],
  //     kind: 'visual:website:page',
  //     appliesTo: ['dolphin', 'site'],   // typically same as segments
  //     payload: { htmlSig: '…', ... },   // bee-specific, any JSON
  //     mark?: 'persistent',
  //     replaceKind?: true,               // remove existing of same kind
  //   }
  //
  // When `replaceKind` is true the worker scans the cell's current
  // `decorations` slot, fetches each entry from `__resources__` to read
  // its kind, drops any whose kind matches `req.kind`, then appends the
  // new sig. This preserves the "one page per cell" semantic for visual
  // bees like /website while leaving decorations of other kinds intact.
  // The dropped decoration JSONs themselves stay in `__resources__`
  // (signature-addressed; deduped against other consumers). GC of
  // orphans is a separate concern.
  async #decorationAdd(req: BridgeRequest): Promise<BridgeResponse> {
    const segments = (req.segments ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
    if (segments.length === 0) return { id: req.id, ok: false, error: 'decoration-add requires `segments`' }

    const kind = typeof req.kind === 'string' ? req.kind.trim() : ''
    if (!kind) return { id: req.id, ok: false, error: 'decoration-add requires `kind`' }

    const appliesTo = Array.isArray(req.appliesTo) ? req.appliesTo.map(s => String(s)) : [...segments]
    const payload = (req.payload && typeof req.payload === 'object') ? req.payload : null
    if (!payload) return { id: req.id, ok: false, error: 'decoration-add requires `payload` (object)' }
    const mark = req.mark === 'persistent' ? 'persistent' : undefined

    const store = get<{
      putResource?: (blob: Blob) => Promise<string>
      getResource?: (sig: string) => Promise<Blob | null>
    }>('@hypercomb.social/Store')
    if (!store?.putResource) return { id: req.id, ok: false, error: 'Store.putResource not available' }

    const history = get<HistoryService>('@diamondcoreprocessor.com/HistoryService')
    if (!history) return { id: req.id, ok: false, error: 'HistoryService not available' }

    const committer = get<{
      update?: (segments: readonly string[], layer: object) => Promise<string>
    }>('@diamondcoreprocessor.com/LayerCommitter')
    if (!committer?.update) return { id: req.id, ok: false, error: 'LayerCommitter.update not available' }

    // 1. Mint the decoration record.
    const record: Record<string, unknown> = { kind, appliesTo, payload }
    if (mark) record['mark'] = mark

    // Record the decoration's resource CLOSURE explicitly. Lineage doctrine: an
    // artifact declares its signature dependencies so the merkle/closure walk
    // carries them — never discovers them late.
    const refs = new Set<string>()
    // (a) Every resource sig nested ANYWHERE in the payload — covers a lightbox
    // gallery's `payload.images[]`, an attachment's `payload.sig`, and any
    // future kind that points straight at resources. Without this the
    // decoration JSON travels but its referenced bytes (the diagram SVGs) 404
    // for a fresh adopter.
    for (const s of collectSigsDeep(payload)) refs.add(s)
    // (b) When the payload names an HTML body, read it NOW (it is local — the
    // caller put-resourced it moments ago) and capture `htmlSig` plus every
    // resource the body embeds (chrome.css, images). This closes the
    // "incomplete-closure" hole where an embedded stylesheet was silently
    // dropped when the body wasn't readable at push time — the exact reason a
    // travelled page rendered unstyled (htmlSig carried, chromeSig lost).
    const htmlSig = String((payload as Record<string, unknown>)['htmlSig'] ?? '').toLowerCase()
    if (/^[0-9a-f]{64}$/.test(htmlSig)) {
      // Locally-authored page content → record it in the participant's own-
      // content allow-set so the verification gate never quarantines your own
      // website (the escape hatch for feature-availability.isLocallyAuthored).
      markAuthored(htmlSig)
      if (store.getResource) {
        try {
          const body = await store.getResource(htmlSig)
          if (body) {
            refs.add(htmlSig)
            for (const s of extractPageRefSigs(await body.text())) refs.add(s)
          }
        } catch { /* body unreadable now → push-time body parse still applies */ }
      }
    }
    if (refs.size) record['refs'] = [...refs]

    const recordBytes = new TextEncoder().encode(JSON.stringify(record))
    const newSig = await store.putResource(new Blob([recordBytes as BlobPart]))

    // 2. Read the cell's current decorations slot.
    const locationSig = await history.sign({ explorerSegments: () => segments })
    const layer = await history.currentLayerAt(locationSig)
    const cellName = layer?.name ?? segments[segments.length - 1] ?? ''
    const priorRaw = (layer as Record<string, unknown> | null)?.['decorations']
    let prior: string[] = Array.isArray(priorRaw) ? priorRaw.map(s => String(s)).filter(s => /^[0-9a-f]{64}$/.test(s)) : []

    // 3. If replaceKind, filter out existing entries of the same kind.
    //    Track dropped sigs so we can notify downstream observers
    //    (decoration-kind-index, etc.) that those entries are gone.
    const dropped: string[] = []
    if (req.replaceKind === true && store.getResource) {
      const kept: string[] = []
      for (const existingSig of prior) {
        if (existingSig === newSig) continue // dedup with new write
        try {
          const blob = await store.getResource(existingSig)
          if (!blob) { kept.push(existingSig); continue }
          const parsed = JSON.parse(await blob.text()) as { kind?: string }
          if (parsed?.kind === kind) { dropped.push(existingSig); continue }
          kept.push(existingSig)
        } catch {
          kept.push(existingSig) // malformed → keep (don't lose data on parse error)
        }
      }
      prior = kept
    }

    // 4. Idempotency: skip the cascade if the sig is already in the slot
    //    and nothing else changed.
    if (prior.includes(newSig) && dropped.length === 0) {
      return { id: req.id, ok: true, data: { sig: newSig, slot: 'decorations', unchanged: true, count: prior.length } }
    }
    const next = prior.includes(newSig) ? prior : [...prior, newSig]

    // 5. Cascade.
    const nextLayer: { name: string; decorations: readonly string[] } = { name: cellName, decorations: next }
    await committer.update(segments, nextLayer)

    // 6. Notify downstream observers. The cascade is already complete;
    //    LayerCommitter's `onTrigger` handler dedups against the
    //    no-op layer state. The decoration-kind-index listens here so
    //    visibleWhen reflects the new state without an OPFS round-trip.
    for (const removedSig of dropped) {
      EffectBus.emit('decorations:changed', { segments, op: 'removeSig', sig: removedSig })
    }
    EffectBus.emit('decorations:changed', { segments, op: 'append', sig: newSig })

    return { id: req.id, ok: true, data: { sig: newSig, slot: 'decorations', count: next.length, dropped: dropped.length } }
  }

  // ─── context-bag helpers ───────────────────────────────────────────
  //
  // Mutate a sig-array slot at `segments`. The slot defaults to
  // `context` (the LLM's per-cell bag) but the same machinery handles
  // any slot whose value is an array of resource sigs — pass req.slot
  // to override.
  //
  // Flow: read current layer at segments → splice the slot's sig array
  // → committer.update commits the new layer (one cascade up to root).
  async #bagMutate(req: BridgeRequest, mode: 'add' | 'remove'): Promise<BridgeResponse> {
    const sig = typeof req.sig === 'string' ? req.sig.trim() : ''
    if (!isSignature(sig)) return { id: req.id, ok: false, error: `bag-${mode} requires \`sig\` (64-hex)` }

    const segments = (req.segments ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
    if (segments.length === 0) return { id: req.id, ok: false, error: `bag-${mode} requires \`segments\`` }

    const slot = (typeof req.slot === 'string' && req.slot.trim()) || CONTEXT_SLOT

    const history = get<HistoryService>('@diamondcoreprocessor.com/HistoryService')
    if (!history) return { id: req.id, ok: false, error: 'HistoryService not available' }

    const locationSig = await history.sign({ explorerSegments: () => segments })
    const layer = await history.currentLayerAt(locationSig)
    const cellName = layer?.name ?? segments[segments.length - 1] ?? ''
    const priorRaw = (layer as Record<string, unknown> | null)?.[slot]
    const prior: string[] = Array.isArray(priorRaw) ? priorRaw.map(s => String(s)) : []

    let next: string[]
    if (mode === 'add') {
      if (prior.includes(sig)) return { id: req.id, ok: true, data: { unchanged: true, slot, count: prior.length } }
      next = [...prior, sig]
    } else {
      if (!prior.includes(sig)) return { id: req.id, ok: true, data: { unchanged: true, slot, count: prior.length } }
      next = prior.filter(s => s !== sig)
    }

    const committer = get<{
      update?: (segments: readonly string[], layer: object) => Promise<string>
    }>('@diamondcoreprocessor.com/LayerCommitter')
    if (!committer?.update) return { id: req.id, ok: false, error: 'LayerCommitter.update not available' }

    // Record locally-authored page sigs written to a page slot (parity with
    // #bagSet / #update / #decorationAdd) so the gate never quarantines them.
    markLayerAuthoredPageSigs({ [slot]: next })
    const nextLayer: { name: string; [slot: string]: unknown } = { name: cellName, [slot]: next }
    await committer.update(segments, nextLayer)
    return { id: req.id, ok: true, data: { slot, count: next.length, mode } }
  }

  /** Replace a slot's sig array atomically. Caller passes
   *  `segments`, optional `slot` (default `context`), and `cells` —
   *  the array of sigs the slot should hold AFTER the call. Other
   *  slots on the cell layer are untouched. Use this when a single
   *  resource per cell is the intent (e.g. one rendered page per
   *  cell): `{ op: 'bag-set', segments, cells: [pageSig] }`. */
  async #bagSet(req: BridgeRequest): Promise<BridgeResponse> {
    const segments = (req.segments ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
    if (segments.length === 0) return { id: req.id, ok: false, error: 'bag-set requires `segments`' }

    const cells = req.cells
    if (!Array.isArray(cells)) return { id: req.id, ok: false, error: 'bag-set requires `cells` (array of sigs)' }
    const next = cells.map(s => String(s ?? '').trim()).filter(s => /^[0-9a-f]{64}$/.test(s))
    if (next.length !== cells.length) {
      return { id: req.id, ok: false, error: 'bag-set: every cell must be a 64-hex sig' }
    }

    const slot = (typeof req.slot === 'string' && req.slot.trim()) || CONTEXT_SLOT

    const history = get<HistoryService>('@diamondcoreprocessor.com/HistoryService')
    if (!history) return { id: req.id, ok: false, error: 'HistoryService not available' }

    const locationSig = await history.sign({ explorerSegments: () => segments })
    const layer = await history.currentLayerAt(locationSig)
    const cellName = layer?.name ?? segments[segments.length - 1] ?? ''

    const committer = get<{
      update?: (segments: readonly string[], layer: object) => Promise<string>
    }>('@diamondcoreprocessor.com/LayerCommitter')
    if (!committer?.update) return { id: req.id, ok: false, error: 'LayerCommitter.update not available' }

    // A page written to a page-bearing slot (`website`/`context`) is locally-
    // authored content — record its sigs so the gate treats your own pages as
    // own. One helper across every local slot-writer keeps coverage from drifting.
    markLayerAuthoredPageSigs({ [slot]: next })
    const nextLayer: { name: string; [slot: string]: unknown } = { name: cellName, [slot]: next }
    await committer.update(segments, nextLayer)
    return { id: req.id, ok: true, data: { slot, count: next.length } }
  }

  // ─── property stamp ────────────────────────────────────────────────
  //
  // Write a key=value into the cell's properties slot on its layer.
  // Used for legacy paths still keyed by cell-property name (websiteSig,
  // custom renderer overrides). Slot-based authors should prefer
  // `update` / `bag-add` for new fields; `stamp` is for the pre-slot
  // property surface that lives in the layer's `properties` slot.
  // Layer-slot writes emit `cell:0000-changed` so nurse cache
  // invalidation fires correctly across both legacy and new paths.
  async #stamp(req: BridgeRequest): Promise<BridgeResponse> {
    const segments = (req.segments ?? [])
      .map(s => normalizeCell(String(s ?? '').trim()))
      .filter(Boolean) as string[]
    if (segments.length === 0) return { id: req.id, ok: false, error: 'stamp requires `segments`' }

    const layer = req.layer
    if (!layer || typeof layer !== 'object') {
      return { id: req.id, ok: false, error: 'stamp requires `layer` with property key→value pairs' }
    }

    const parentSegments = segments.slice(0, -1)
    const cellName = segments[segments.length - 1]

    // Strip non-scalar values so callers can't accidentally smuggle a
    // nested object that would round-trip through JSON.stringify but
    // confuse downstream readers expecting flat property scalars.
    const updates: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(layer)) {
      if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) updates[k] = v
    }
    await writeTilePropertiesAt(parentSegments, cellName, updates)

    // writeTilePropertiesAt updates CANONICAL only. The render + substrate
    // read tile props from the participant-local `hc:tile-props-index`, so
    // without syncing it here a bridge-set property (e.g. a `link`) lands in
    // the layer but stays invisible to the render — no click-to-open, no
    // thumbnail. Mirror resource-attach: point the lineage-keyed index entry
    // at the freshly-committed props sig, then nudge the renderer.
    try {
      const propsSig = await readTilePropsSigAt(parentSegments, cellName)
      if (propsSig) {
        const indexCellKey = await cellLocationSig(parentSegments, cellName)
        const index = readTilePropsIndex()
        index[indexCellKey || cellName] = propsSig
        writeTilePropsIndex(index)
      }
    } catch (err) {
      console.warn('[bridge] tile-props index sync failed', err)
    }
    EffectBus.emit<{ cell: string; segments: readonly string[] }>('tile:saved', { cell: cellName, segments: parentSegments })

    return { id: req.id, ok: true, data: { keys: Object.keys(updates) } }
  }

  // Recursive sig → JSON inflater. Caller hands a 64-hex sig (or a
  // segments path that resolves to the current layer sig at that
  // location) and receives the fully-inflated merkle subtree as a
  // self-contained JSON value. Mechanical primitive — the LLM
  // composes by passing sigs around, this returns the content.
  // Raw layer read — returns slot values with their underlying sig
  // arrays preserved, NOT recursively resolved into their content.
  // Use when the caller needs the canonical sig of a slot entry
  // (e.g. dashboard refresh needs the qa-slot resource sig so the
  // in-page answer composer can `bag-remove` the right entry on
  // submit). `inflate` resolves sigs into their JSON which drops
  // the addressing — this op keeps the addressing intact.
  async #layerAt(req: BridgeRequest): Promise<BridgeResponse> {
    const segments = (req.segments ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
    const history = get<HistoryService>('@diamondcoreprocessor.com/HistoryService')
    if (!history) return { id: req.id, ok: false, error: 'HistoryService not available' }
    const locationSig = await history.sign({ explorerSegments: () => segments })
    const layer = await history.currentLayerAt(locationSig)
    if (!layer) return { id: req.id, ok: false, error: `no layer at /${segments.join('/')}` }
    return { id: req.id, ok: true, data: layer }
  }

  async #inflate(req: BridgeRequest): Promise<BridgeResponse> {
    let sig = typeof req.cell === 'string' ? req.cell.trim() : ''

    // No sig → resolve segments to the current layer at that location.
    if (!sig && req.segments) {
      const segments = req.segments.map(s => String(s ?? '').trim()).filter(Boolean)
      const history = get<HistoryService>('@diamondcoreprocessor.com/HistoryService')
      if (!history) return { id: req.id, ok: false, error: 'HistoryService not available' }
      const locationSig = await history.sign({ explorerSegments: () => segments })
      const layer = await history.currentLayerAt(locationSig)
      if (!layer) return { id: req.id, ok: false, error: `no layer at /${segments.join('/')}` }
      const inflated = await inflate(layer)
      return { id: req.id, ok: true, data: inflated }
    }

    if (!isSignature(sig)) {
      return { id: req.id, ok: false, error: 'inflate requires a 64-hex sig (in `cell`) or `segments`' }
    }

    const inflated = await inflate(sig)
    return { id: req.id, ok: true, data: inflated }
  }

  // Read notes at an EXPLICIT cell location (parentSegments + cellLabel).
  // Headless mirror of `note-add` — uses NotesService.getNotesAtSegments
  // so the bridge can read any cell's notes without temporarily navigating.
  async #noteList(req: BridgeRequest): Promise<BridgeResponse> {
    const segments = (req.segments ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
    if (segments.length === 0) {
      return { id: req.id, ok: false, error: 'no segments provided' }
    }
    const notes = get<{
      getNotesAtSegments?: (s: readonly string[]) => Promise<unknown[]>
    }>('@diamondcoreprocessor.com/NotesService')
    if (!notes?.getNotesAtSegments) {
      return { id: req.id, ok: false, error: 'NotesService.getNotesAtSegments not available' }
    }
    const items = await notes.getNotesAtSegments(segments)
    return { id: req.id, ok: true, data: items }
  }

  // List child cell folders at EXPLICIT segments — bypasses the user's
  // current navigation. Walks from the absolute hypercombRoot (NOT the
  // lineage's current explorerDir) so segments are interpreted as a
  // path from root, identical regardless of where the user is.
  async #listAt(req: BridgeRequest): Promise<BridgeResponse> {
    const store = get<{
      hypercombRoot?: FileSystemDirectoryHandle | null
      legacyHive?: FileSystemDirectoryHandle | null
      legacyHypercombIo?: FileSystemDirectoryHandle | null
    }>('@hypercomb.social/Store')
    if (!store?.hypercombRoot) return { id: req.id, ok: false, error: 'no hypercombRoot' }

    const segments = (req.segments ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
    // Named tile dirs live in the (still-undrained) legacy content roots as
    // well as the flat root — resolve the path root-first, then through the
    // legacy roots (union rule), so a partially-drained boot still lists cells.
    const resolveUnder = async (root: FileSystemDirectoryHandle): Promise<FileSystemDirectoryHandle | null> => {
      let dir: FileSystemDirectoryHandle = root
      for (const seg of segments) {
        const clean = normalizeCell(seg)
        if (!clean) continue
        try { dir = await dir.getDirectoryHandle(clean, { create: false }) }
        catch { return null }
      }
      return dir
    }
    let dir: FileSystemDirectoryHandle | null = null
    for (const root of [store.hypercombRoot, store.legacyHive ?? null, store.legacyHypercombIo ?? null]) {
      if (!root) continue
      dir = await resolveUnder(root)
      if (dir) break
    }
    if (!dir) return { id: req.id, ok: false, error: `path not found: ${segments.join('/')}` }
    const cells = await this.#listCellFolders(dir)
    return { id: req.id, ok: true, data: cells }
  }

  // Compute ONE deterministic signature over every note id in the whole
  // tree — a "notes digest". Walks every cell folder from the content root
  // (reusing #listCellFolders), reads each cell's notes via
  // NotesService.getNotesAtSegments, collects every note id (recursing
  // through note children), sorts them, and signs the canonical JSON.
  // Because note ids ARE content sigs, any note add / edit / delete changes
  // the set → changes the digest. The feedback-loop routine stores the
  // prior digest and re-fires the loop when it differs. Read-only.
  async #notesDigest(req: BridgeRequest): Promise<BridgeResponse> {
    const history = get<HistoryService>('@diamondcoreprocessor.com/HistoryService')
    if (!history) return { id: req.id, ok: false, error: 'HistoryService not available' }

    // Walk the LAYER tree PATH-ADDRESSED — start at root segments [] and
    // recurse by child NAME, reading each location's OWN current head via
    // currentLayerAt. Per-page history retired the leaf→root cascade, so a
    // parent's stored child sig is a STALE hint: descending by re-resolving
    // those sigs (getLayerBySig) would read each child's OLD version and miss
    // deep note edits. Names are immutable, so we resolve the name from the
    // (possibly stale) sig, then re-sign the child's path for a fresh read.
    // At every layer collect its `notes` slot entries: each is a note-layer
    // sig, i.e. the note's stable content-addressed id. Because ids ARE
    // content sigs, any add / edit / delete changes the set, hence the digest.
    const noteIds = new Set<string>()
    const visited = new Set<string>()

    const collectNotes = (layer: { notes?: unknown } | null): void => {
      const notes = layer?.notes
      if (Array.isArray(notes)) {
        for (const s of notes) if (typeof s === 'string' && isSignature(s)) noteIds.add(s)
      }
    }

    const walk = async (segments: readonly string[]): Promise<void> => {
      const locSig = await history.sign({ explorerSegments: () => [...segments] })
      const layer = await history.currentLayerAt(locSig) as
        { notes?: unknown; children?: unknown } | null
      if (!layer) return
      collectNotes(layer)
      const children = Array.isArray(layer.children) ? layer.children : []
      for (const childSig of children) {
        if (typeof childSig !== 'string' || !isSignature(childSig)) continue
        // Name from the (maybe stale) sig is still correct — names never change.
        const childLayer = await history.getLayerBySig(childSig)
        const childName = typeof childLayer?.name === 'string' ? childLayer.name.trim() : ''
        if (!childName) continue
        const childPath = [...segments, childName]
        const key = childPath.join(' ')
        if (visited.has(key)) continue
        visited.add(key)
        await walk(childPath)
      }
    }

    await walk([])

    const sorted = [...noteIds].sort()
    const canonical = JSON.stringify(sorted)
    const digest = await SignatureService.sign(new TextEncoder().encode(canonical).buffer as ArrayBuffer)
    return { id: req.id, ok: true, data: { digest, noteCount: sorted.length, noteIds: sorted } }
  }

  // Append a note to a cell at explicit segments. Calls
  // NotesService.addAtSegments — same upsert path as user-typed notes.
  // Headless: no dependency on the current navigation lineage.
  async #noteAdd(req: BridgeRequest): Promise<BridgeResponse> {
    const cell = req.cell
    const text = req.text
    const segments = req.segments ?? []
    if (typeof cell !== 'string' || !cell) {
      return { id: req.id, ok: false, error: 'missing cell label' }
    }
    if (typeof text !== 'string' || !text) {
      return { id: req.id, ok: false, error: 'missing note text' }
    }
    const notes = get<{
      addAtSegments?: (s: readonly string[], c: string, t: string) => Promise<void>
    }>('@diamondcoreprocessor.com/NotesService')
    if (!notes?.addAtSegments) {
      return { id: req.id, ok: false, error: 'NotesService.addAtSegments not available' }
    }
    await notes.addAtSegments(segments, cell, text)
    return { id: req.id, ok: true }
  }

  // Remove a note by id from a cell at explicit segments. Calls
  // NotesService.deleteAtSegments — same merkle cascade as user-driven
  // delete. Used for migration scripts that retract [Q]-prefixed legacy
  // notes once they've been copied into __optimization__/.
  async #noteDelete(req: BridgeRequest): Promise<BridgeResponse> {
    const cell = req.cell
    const noteId = typeof req.sig === 'string' ? req.sig.trim() : ''
    const segments = req.segments ?? []
    if (typeof cell !== 'string' || !cell) {
      return { id: req.id, ok: false, error: 'missing cell label' }
    }
    if (!noteId) {
      return { id: req.id, ok: false, error: 'missing noteId (pass via `sig` field)' }
    }
    const notes = get<{
      deleteAtSegments?: (s: readonly string[], c: string, n: string) => Promise<void>
    }>('@diamondcoreprocessor.com/NotesService')
    if (!notes?.deleteAtSegments) {
      return { id: req.id, ok: false, error: 'NotesService.deleteAtSegments not available' }
    }
    await notes.deleteAtSegments(segments, cell, noteId)
    return { id: req.id, ok: true, data: { cell, noteId } }
  }

  // Layer-as-primitive update. Caller passes `{ segments, layer }` where
  // layer is `{ name, ...slots }`. Slot names are conventional (children,
  // tags, notes, etc.). Empty arrays wipe the slot. One awaited cascade
  // per parent. The receiver mirrors `children` to OPFS folders so the
  // file tree stays in sync with the merkle layer.
  async #update(req: BridgeRequest): Promise<BridgeResponse> {
    const layer = req.layer
    if (!layer || typeof layer !== 'object') {
      return { id: req.id, ok: false, error: 'no layer provided' }
    }

    // Build parentSegments from the request — no folder walk, no
    // dir minting. Layer is the only source of truth for hierarchy;
    // committer.update is the only write API. The previous folder-mirror
    // step (mint parent dirs + mint each child name) was a parallel-store
    // write that nothing in the render path reads.
    const parentSegments: string[] = []
    if (req.segments?.length) {
      for (const raw of req.segments) {
        const seg = normalizeCell(raw)
        if (seg) parentSegments.push(seg)
      }
    }

    const childrenRaw = (layer as { children?: unknown }).children
    const children = Array.isArray(childrenRaw) ? childrenRaw.map(c => normalizeCell(String(c))).filter(Boolean) : []

    const committer = get<{
      update?: (segments: readonly string[], layer: object) => Promise<void>
    }>('@diamondcoreprocessor.com/LayerCommitter')

    if (!committer?.update) {
      return { id: req.id, ok: false, error: 'committer.update not available' }
    }

    // Raw layer writes can author a page directly into the `website`/`context`
    // slots (e.g. a dashboard refresh writing context:[htmlSig,...] alongside
    // children, which bag-set can't do). Record those page sigs so the gate
    // treats them as the participant's own — the generic-update coverage the
    // decoration / bag-set paths would otherwise miss.
    markLayerAuthoredPageSigs(layer)
    await committer.update(parentSegments, layer)
    return { id: req.id, ok: true, data: { count: children.length, segments: parentSegments } }
  }

  // Mirrors a human keystroke into the in-app command line. Emits the same
  // EffectBus channel a future remote caller would use; the command-line
  // component subscribes and runs the existing submit pipeline. Text is
  // forwarded verbatim so anything the keyboard accepts (slash behaviours,
  // bracket selects, multi-token grammar, plain cell names) just works.
  async #submit(req: BridgeRequest): Promise<BridgeResponse> {
    const text = req.text
    if (typeof text !== 'string') return { id: req.id, ok: false, error: 'no text provided' }
    EffectBus.emit('command-line:remote-submit', { text })
    return { id: req.id, ok: true }
  }

  // ------- operations -------

  async #add(req: BridgeRequest): Promise<BridgeResponse> {
    const cells = req.cells
    if (!cells?.length) return { id: req.id, ok: false, error: 'no cells provided' }

    // Build parentSegments from the request — no folder walk, no
    // dir minting. Layer is the only source of truth for hierarchy.
    const parentSegments: string[] = []
    if (req.segments?.length) {
      for (const raw of req.segments) {
        const seg = normalizeCell(raw)
        if (seg) parentSegments.push(seg)
      }
    }

    // Per-cell `cell:added` events drive LayerCommitter's by-name
    // delta path: each event queues a single APPEND op for the
    // parent's `children` slot (committer resolves name → sig at
    // commit time via `latestMarkerSigFor`). The commit machine
    // batches all queued additions and emits ONE marker per ancestor
    // — preserving every prior child verbatim. Do NOT call
    // `committer.update(parent, { children: [new] })` here: that's a
    // SET op which would replace the slot, wiping prior tiles.
    let count = 0
    for (const name of cells) {
      const normalized = normalizeCell(name)
      if (!normalized) continue
      EffectBus.emit('cell:added', { cell: normalized, segments: parentSegments.slice() })
      count++
    }

    await new hypercomb().act()
    return { id: req.id, ok: true, data: { count } }
  }

  async #remove(req: BridgeRequest): Promise<BridgeResponse> {
    if (req.all) {
      const visible = await this.#visibleCells()
      for (const cell of visible) {
        EffectBus.emit('cell:removed', { cell })
      }
      await new hypercomb().act()
      return { id: req.id, ok: true, data: { count: visible.length } }
    }

    const cells = req.cells
    if (!cells?.length) return { id: req.id, ok: false, error: 'no cells provided' }

    let count = 0
    for (const raw of cells) {
      const cell = normalizeCell(raw)
      if (!cell) continue
      EffectBus.emit('cell:removed', { cell })
      count++
    }

    await new hypercomb().act()
    return { id: req.id, ok: true, data: { count } }
  }

  async #list(req: BridgeRequest): Promise<BridgeResponse> {
    const cells = await this.#visibleCells()
    return { id: req.id, ok: true, data: cells }
  }

  async #inspect(req: BridgeRequest): Promise<BridgeResponse> {
    // Two addressing modes:
    //   - segments: explicit absolute path from hypercombRoot (headless,
    //     same shape #stamp / #update use). Use this from CLI tooling
    //     that wants to verify what stamp wrote without depending on
    //     the user's current navigation.
    //   - cell: legacy single-name lookup relative to explorer segments.
    // Both modes resolve through readTilePropertiesAt, which reads from
    // the layer-slot store (not OPFS folders). Layer is the only source
    // of truth — folder walks are retired.
    const segmentsRaw = (req.segments ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
    if (segmentsRaw.length > 0) {
      const normalized = segmentsRaw.map(s => normalizeCell(s)).filter(Boolean)
      if (normalized.length === 0) return { id: req.id, ok: false, error: 'no segments' }
      const cellName = normalized[normalized.length - 1]
      const parentSegments = normalized.slice(0, -1)
      const props = await readTilePropertiesAt(parentSegments, cellName)
      return { id: req.id, ok: true, data: props }
    }

    const name = req.cell ? normalizeCell(req.cell) : ''
    if (!name) return { id: req.id, ok: false, error: 'no cell name' }

    const lineage = get<{ explorerSegments?: () => readonly string[] }>('@hypercomb.social/Lineage')
    const parentSegments = (lineage?.explorerSegments?.() ?? []).map(s => String(s ?? ''))
    const props = await readTilePropertiesAt(parentSegments, name)
    return { id: req.id, ok: true, data: props }
  }

  async #history(req: BridgeRequest): Promise<BridgeResponse> {
    const historyService = get<HistoryService>('@diamondcoreprocessor.com/HistoryService')
    const lineage = get<any>('@hypercomb.social/Lineage')
    if (!historyService || !lineage) {
      return { id: req.id, ok: false, error: 'history service not available' }
    }

    const sig = await historyService.sign(lineage)
    const ops = await historyService.replay(sig)
    return { id: req.id, ok: true, data: ops }
  }

  // ------- helpers -------

  async #explorerDir(): Promise<FileSystemDirectoryHandle | null> {
    const lineage = get<any>('@hypercomb.social/Lineage')
    return lineage?.explorerDir?.() ?? null
  }

  async #listCellFolders(dir: FileSystemDirectoryHandle): Promise<string[]> {
    const out: string[] = []
    for await (const [name, handle] of (dir as any).entries()) {
      if (handle.kind !== 'directory') continue
      if (!name) continue
      // Cells are NAMED dirs. Skip legacy underscore drain sources, the
      // legacy content root, and any sig-named dir (64-hex: a sign(meaning)
      // pool or a lineage sigbag) — under the flat-root model those all sit
      // at the OPFS root and must never be reported as tiles.
      if (name.startsWith('__') && name.endsWith('__')) continue
      if (name === 'hypercomb.io') continue
      if (/^[0-9a-f]{64}$/.test(name)) continue
      out.push(name)
    }
    out.sort((a, b) => a.localeCompare(b))
    return out
  }

  async #visibleCells(): Promise<string[]> {
    const dir = await this.#explorerDir()
    if (!dir) return []

    const all = await this.#listCellFolders(dir)

    const historyService = get<HistoryService>('@diamondcoreprocessor.com/HistoryService')
    const lineage = get<any>('@hypercomb.social/Lineage')
    if (!historyService || !lineage) return all

    const sig = await historyService.sign(lineage)
    const ops = await historyService.replay(sig)
    const cellState = new Map<string, string>()
    for (const op of ops) cellState.set(op.cell, op.op)

    // Only honor 'remove' for cells whose OPFS directory no longer exists.
    // Every cell in `all` physically exists — if its last op is 'remove' the
    // cell was just recreated and the async HistoryRecorder hasn't caught up.
    const allSet = new Set(all)
    return all.filter(cell => {
      const lastOp = cellState.get(cell)
      return lastOp !== 'remove' || allSet.has(cell)
    })
  }
}

// ─── base64 helpers ────────────────────────────────────────────────
//
// Browser-native base64 round-trip. `btoa`/`atob` only handle binary
// strings (each char 0-255), so we map Uint8Array bytes to such a
// string before encoding and back after decoding.

const base64ToBytes = (b64: string): Uint8Array => {
  // strip whitespace + url-safe variants so callers can paste loosely
  const clean = b64.replace(/[\s]/g, '').replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(clean)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

const bytesToBase64 = (bytes: Uint8Array): string => {
  // Chunk to keep String.fromCharCode happy with large buffers.
  const CHUNK = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, Math.min(i + CHUNK, bytes.length))
    binary += String.fromCharCode.apply(null, slice as unknown as number[])
  }
  return btoa(binary)
}

const _claudeBridgeWorker = new ClaudeBridgeWorker()
window.ioc.register('@diamondcoreprocessor.com/ClaudeBridgeWorker', _claudeBridgeWorker)

// Register the per-cell `context` slot (LLM context bag). Passive —
// no triggers; the bridge `update`, `bag-add`, and `bag-remove` ops
// are the writers. Subscribed via whenReady so this module loads
// independently of LayerSlotRegistry's own load order.
;(window as { ioc?: { whenReady?: <T>(k: string, cb: (v: T) => void) => void } }).ioc?.whenReady?.<LayerSlotRegistry>(
  '@diamondcoreprocessor.com/LayerSlotRegistry',
  (slotRegistry) => {
    slotRegistry.register({ slot: CONTEXT_SLOT, triggers: [] })
  },
)
