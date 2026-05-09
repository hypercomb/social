// diamondcoreprocessor.com/bridge/claude-bridge.worker.ts
import { Worker, EffectBus, normalizeCell, hypercomb, isSignature } from '@hypercomb/core'
import { readCellProperties, writeCellProperties } from '../editor/tile-properties.js'
import type { HistoryService } from '../history/history.service.js'
import type { LayerSlotRegistry } from '../history/layer-slot-registry.js'
import { inflate } from '../history/inflate.js'

// Bridge protocol — matches @hypercomb/sdk/bridge
const BRIDGE_PORT = 2401
const BRIDGE_ENABLED_QUERY_KEY = 'claudeBridge'
const BRIDGE_ENABLED_STORAGE_KEY = 'hypercomb.claudeBridge.enabled'

/** Per-cell context bag slot — value is a sig array. Each entry is a
 *  resource sig in __resources__/ that the LLM should see when working
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

  protected override act = async (): Promise<void> => {
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
      case 'list-at':      return this.#listAt(req)
      case 'inflate':      return this.#inflate(req)
      case 'put-resource': return this.#putResource(req)
      case 'get-resource': return this.#getResource(req)
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

    const nextLayer: { name: string; [slot: string]: unknown } = { name: cellName, [slot]: next }
    await committer.update(segments, nextLayer)
    return { id: req.id, ok: true, data: { slot, count: next.length } }
  }

  // ─── property stamp ────────────────────────────────────────────────
  //
  // Write a key=value into the cell's 0000 properties JSON. Used for
  // legacy paths still living on cell properties (websiteSig, custom
  // renderer overrides). Slot-based authors should prefer `update` /
  // `bag-add`. Property writes go through `writeCellProperties` so the
  // nurse cache invalidation event fires correctly.
  async #stamp(req: BridgeRequest): Promise<BridgeResponse> {
    const segments = (req.segments ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
    if (segments.length === 0) return { id: req.id, ok: false, error: 'stamp requires `segments`' }

    const layer = req.layer
    if (!layer || typeof layer !== 'object') {
      return { id: req.id, ok: false, error: 'stamp requires `layer` with property key→value pairs' }
    }

    const store = get<{ hypercombRoot?: FileSystemDirectoryHandle | null }>('@hypercomb.social/Store')
    let dir = store?.hypercombRoot ?? null
    if (!dir) return { id: req.id, ok: false, error: 'no hypercombRoot' }

    for (const seg of segments) {
      const clean = normalizeCell(seg)
      if (!clean) continue
      try {
        dir = await dir.getDirectoryHandle(clean, { create: false })
      } catch {
        return { id: req.id, ok: false, error: `path not found: ${segments.join('/')}` }
      }
    }

    // Strip non-scalar values so callers can't accidentally smuggle a
    // nested object that would round-trip through JSON.stringify but
    // confuse downstream readers expecting flat property scalars.
    const updates: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(layer)) {
      if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) updates[k] = v
    }
    await writeCellProperties(dir, updates)
    return { id: req.id, ok: true, data: { keys: Object.keys(updates) } }
  }

  // Recursive sig → JSON inflater. Caller hands a 64-hex sig (or a
  // segments path that resolves to the current layer sig at that
  // location) and receives the fully-inflated merkle subtree as a
  // self-contained JSON value. Mechanical primitive — the LLM
  // composes by passing sigs around, this returns the content.
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
  // so the bridge can read instructions without temporarily navigating.
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
    const store = get<{ hypercombRoot?: FileSystemDirectoryHandle | null }>('@hypercomb.social/Store')
    let dir = store?.hypercombRoot ?? null
    if (!dir) return { id: req.id, ok: false, error: 'no hypercombRoot' }

    const segments = (req.segments ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
    for (const seg of segments) {
      const clean = normalizeCell(seg)
      if (!clean) continue
      try {
        dir = await dir.getDirectoryHandle(clean, { create: false })
      } catch {
        return { id: req.id, ok: false, error: `path not found: ${segments.join('/')}` }
      }
    }
    const cells = await this.#listCellFolders(dir)
    return { id: req.id, ok: true, data: cells }
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

    // Walk from the absolute hypercombRoot, NOT lineage.explorerDir.
    // The bridge is headless — segments must be interpreted as a path
    // from root, identical regardless of where the user is currently
    // navigated. Same fix as #listAt; the legacy explorerDir-relative
    // semantics broke any caller that didn't first navigate the user.
    const store = get<{ hypercombRoot?: FileSystemDirectoryHandle | null }>('@hypercomb.social/Store')
    let dir: FileSystemDirectoryHandle | null = store?.hypercombRoot ?? null
    if (!dir) return { id: req.id, ok: false, error: 'no hypercombRoot' }

    // Walk to / create the parent path so OPFS reflects the segments.
    const parentSegments: string[] = []
    if (req.segments?.length) {
      for (const raw of req.segments) {
        const seg = normalizeCell(raw)
        if (!seg) continue
        dir = await dir.getDirectoryHandle(seg, { create: true })
        parentSegments.push(seg)
      }
    }

    // Mirror children list to OPFS folders. Create any named child that
    // isn't already a directory; existing folders not in children remain
    // (orphan removal is a separate sweep, out of scope here).
    const childrenRaw = (layer as { children?: unknown }).children
    const children = Array.isArray(childrenRaw) ? childrenRaw.map(c => normalizeCell(String(c))).filter(Boolean) : []
    for (const name of children) {
      await dir.getDirectoryHandle(name, { create: true })
    }

    // Hand the whole layer to the committer's awaited update path.
    const committer = get<{
      update?: (segments: readonly string[], layer: object) => Promise<void>
    }>('@diamondcoreprocessor.com/LayerCommitter')

    if (!committer?.update) {
      return { id: req.id, ok: false, error: 'committer.update not available' }
    }

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

    let dir = await this.#explorerDir()
    if (!dir) return { id: req.id, ok: false, error: 'no explorer directory' }

    // Walk to optional parent path. Children are added there with segments-aware
    // cell:added events so the cascade starts at the correct depth regardless of
    // the user's current navigation. One awaited cascade for the whole batch.
    const parentSegments: string[] = []
    if (req.segments?.length) {
      for (const raw of req.segments) {
        const seg = normalizeCell(raw)
        if (!seg) continue
        dir = await dir.getDirectoryHandle(seg, { create: true })
        parentSegments.push(seg)
      }
    }

    let count = 0
    for (const name of cells) {
      const normalized = normalizeCell(name)
      if (!normalized) continue
      await dir.getDirectoryHandle(normalized, { create: true })
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
    const name = req.cell ? normalizeCell(req.cell) : ''
    if (!name) return { id: req.id, ok: false, error: 'no cell name' }

    const dir = await this.#explorerDir()
    if (!dir) return { id: req.id, ok: false, error: 'no explorer directory' }

    try {
      const cellDir = await dir.getDirectoryHandle(name, { create: false })
      const props = await readCellProperties(cellDir)
      return { id: req.id, ok: true, data: props }
    } catch {
      return { id: req.id, ok: false, error: `cell not found: ${name}` }
    }
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
      if (name.startsWith('__') && name.endsWith('__')) continue
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
