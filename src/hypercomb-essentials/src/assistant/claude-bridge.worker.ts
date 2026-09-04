// bridge/claude-bridge.worker.ts
import {
  Worker, EffectBus, normalizeCell, hypercomb, isSignature, SignatureService,
  isLocalClaudeBridgeConfigured,
} from '@hypercomb/core'
import { deliverTurn, readTurns, setConversationGoalReached } from './chat-thread.js'
import { readTilePropertiesAt, writeTilePropertiesAt } from '../editor/tile-properties.js'
import type { HistoryService } from '../history/history.service.js'
import type { LayerSlotRegistry } from '../history/layer-slot-registry.js'
import { inflate } from '../history/inflate.js'
import { extractPageRefSigs, collectSigsDeep } from '../sharing/decoration-closure.js'
import { markAuthored, markLayerAuthoredPageSigs } from '../sharing/authored-sigs.js'
import { mintBuildRecord } from '../history/builds-slot.js'
import { putSummary, listSummaryRuns, type FeedbackSummaryRecord } from './feedback-summaries.js'
import { readPublicBranches } from '../presentation/tiles/tile-actions.drone.js'
import { setHiveRoot } from '../sharing/hive-pointer.js'
import { bridgeMaySetRootKey, PUBLIC_CONTENT_HOSTS } from '../sharing/hive-link.js'

// Bridge protocol — matches @hypercomb/sdk/bridge
const BRIDGE_PORT = 2401
// Optional port override (`?claudeBridgePort=2411`) so a TEST stack — its own
// broker + its own renderer tab — can run the full ask loop in isolation
// without seizing the production broker's single renderer slot on 2401.
// Query-only (never persisted): an override is a per-tab, per-session choice.
const BRIDGE_PORT_QUERY_KEY = 'claudeBridgePort'

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
  /** `agents-announce`: the frontier bridges this machine can spawn, each an
   *  `llm-provider@1` spec with `shape: 'agent-bridge'`. */
  agents?: unknown[]
  /** Decoration record fields (decoration-add). */
  appliesTo?: string[]
  payload?: unknown
  mark?: string
  /** When true (decoration-add), drop existing decorations of the same
   *  kind from the cell's `decorations` slot before appending the new
   *  sig. Preserves the "one per kind" semantic for single-output bees
   *  like /website. */
  replaceKind?: boolean
  /** Build revision name (build-record). */
  label?: string
  /** build-record probe mode: seal + compare, never write (the
   *  atomicity audit's non-mutating check). */
  dryRun?: boolean
  /** How many entries to return (summary-list). Clamped receiver-side. */
  limit?: number
  /** `branch-public`: REFUSED. Marking a branch public is a participant act —
   *  it is the scope input of the signed vocabulary claim — so the op reads
   *  the marks and any attempt to set one is an error. */
  public?: boolean
  /** `hive-root-set`: colon-carrying index key (e.g. `install:essentials`). */
  key?: string
  /** `hive-root-set`: index host override (defaults to the standing public
   *  content endpoint). */
  host?: string
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
   *  attempt an auto-connect. The auto-connect is gated by the shared local
   *  Claude capability
   *  (localhost + opt-in flag via URL query or localStorage), so users who
   *  haven't enabled the bridge see no WS attempt at all. Users who HAVE
   *  enabled it get a renderer registration on every page load — no manual
   *  `connect()` console paste needed for Node scripts (e.g.
   *  `_dolphin-revision.cjs`) to find a renderer. */
  protected override act = async (): Promise<void> => {
    this.onEffect('claude-bridge:connect', () => this.connect())
    // Auto-connect when the shared opt-in says this local tab is configured;
    // everyone else stays silent.
    this.connect()
  }

  /** Open the bridge WebSocket. Gated by the shared host + opt-in decision
   *  and idempotent — safe to call multiple times. */
  public connect(): void {
    if (this.#ws) return
    if (!isLocalClaudeBridgeConfigured()) return
    this.#connect()
  }

  // ------- WebSocket lifecycle -------

  #connected = false

  /** Is a Claude Code actually listening right now?
   *
   *  Public because a chat surface has to be able to SAY so. Every reply in the
   *  chat window arrives over this socket, so with nothing on the other end a
   *  question is not slow — it is never going to be answered. A window that
   *  showed a thinking indicator forever in that case would be lying, and
   *  "I typed and nothing happened" is exactly the confusion the chat window
   *  exists to remove. */
  get connected(): boolean { return this.#connected }

  /** Announce the socket's state. Emitted on every transition AND once on
   *  connect, so a surface that opens later still learns the state from
   *  EffectBus's last-value replay rather than having to poll. */
  #announce(): void {
    EffectBus.emit('bridge:status', { connected: this.#connected })
  }

  #port(): number {
    try {
      const raw = new URLSearchParams(window.location.search).get(BRIDGE_PORT_QUERY_KEY)
      const port = Number(raw)
      if (Number.isInteger(port) && port > 0 && port < 65_536) return port
    } catch { /* fall through to default */ }
    return BRIDGE_PORT
  }

  #connect(): void {
    try {
      const ws = new WebSocket(`ws://localhost:${this.#port()}`)

      ws.onopen = () => {
        this.#connected = true
        ws.send(JSON.stringify({ type: 'renderer' }))
        console.log('[claude-bridge] connected')
        this.#announce()
      }

      ws.onmessage = (event) => {
        void this.#handleMessage(String(event.data))
      }

      ws.onclose = () => {
        const wasConnected = this.#connected
        this.#ws = null
        this.#connected = false
        // Announced even when we never connected: "no Claude is listening" is
        // the state a chat surface most needs to be told, and a failed FIRST
        // attempt is precisely when nobody is. Staying silent here is what
        // leaves a window with no way to tell "thinking" from "nothing there".
        this.#announce()
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
      // Initial connection failed — bridge server not running. Silent on the
      // console, but still announced: a surface must not be left guessing.
      this.#announce()
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

  // ── QUIET LANDING ─────────────────────────────────────────────────
  // Everything this worker writes is somebody's ANSWER — an ask raised
  // from a tile, a drained batch of notes, a generated page. It lands as
  // truth the moment it arrives; nothing here is deferred. What it must
  // not do is repaint the surface the participant is still working in,
  // once per write, for a burst of twenty.
  //
  // So a MUTATING op opens a quiet window and the renderer holds its
  // repaint behind a badge (see show-cell.drone.ts #quietLanding).
  // Read-only ops never open one — a `list` arriving mid-burst must not
  // extend somebody else's window.
  //
  // Depth-counted, because a drain runs many ops at once. And closed on a
  // SETTLE delay rather than at the last op's return: the commit machine
  // flushes its markers just after the handler resolves, so closing on the
  // dot would let that trailing lineage change through as exactly the
  // flicker this exists to prevent. A burst is therefore ONE window.
  static readonly #QUIET_SETTLE_MS = 400

  static readonly #MUTATING_OPS = new Set([
    'update', 'note-add', 'note-delete', 'note-split', 'put-resource',
    'optimization-add', 'optimization-remove', 'decoration-add',
    'bag-add', 'bag-remove', 'bag-set', 'build-record', 'stamp',
    'add', 'remove', 'summary-add', 'chat-reply', 'chat-goal-reached', 'submit',
  ])

  #quietDepth = 0
  #quietClose: ReturnType<typeof setTimeout> | null = null

  /** Mutating ops in the CURRENT window. The badge shows this, not the
   *  renderer's held-paint count: paints coalesce, writes don't, and the
   *  number a person reads has to mean what it says. Reset when a window
   *  actually opens, never while one is running. */
  #quietWrites = 0

  #quietOpen = (): void => {
    if (this.#quietClose) { clearTimeout(this.#quietClose); this.#quietClose = null }
    if (this.#quietDepth++ === 0) this.#quietWrites = 0
    this.#quietWrites++
    EffectBus.emit('landing:quiet', {
      active: true, source: 'bridge', writes: this.#quietWrites,
    })
  }

  #quietDone = (): void => {
    if (this.#quietDepth > 0) this.#quietDepth--
    if (this.#quietDepth > 0) return
    if (this.#quietClose) clearTimeout(this.#quietClose)
    this.#quietClose = setTimeout(() => {
      this.#quietClose = null
      // A new op during the settle re-opened the window — leave it open.
      if (this.#quietDepth === 0) {
        EffectBus.emit('landing:quiet', { active: false, source: 'bridge', writes: 0 })
      }
    }, ClaudeBridgeWorker.#QUIET_SETTLE_MS)
  }

  async #dispatch(req: BridgeRequest): Promise<BridgeResponse> {
    if (!ClaudeBridgeWorker.#MUTATING_OPS.has(String(req.op))) return this.#route(req)
    this.#quietOpen()
    try {
      return await this.#route(req)
    } finally {
      this.#quietDone()
    }
  }

  async #route(req: BridgeRequest): Promise<BridgeResponse> {
    switch (req.op) {
      case 'update':       return this.#update(req)
      case 'note-add':     return this.#noteAdd(req)
      case 'note-list':    return this.#noteList(req)
      case 'note-delete':  return this.#noteDelete(req)
      case 'note-split':   return this.#noteSplit(req)
      case 'notes-digest': return this.#notesDigest(req)
      case 'list-at':      return this.#listAt(req)
      case 'inflate':      return this.#inflate(req)
      case 'layer-at':     return this.#layerAt(req)
      case 'layer-by-sig': return this.#layerBySig(req)
      case 'put-resource': return this.#putResource(req)
      case 'get-resource': return this.#getResource(req)
      case 'optimization-add':    return this.#optimizationAdd(req)
      case 'chat-reply':   return this.#chatReply(req)
      case 'chat-goal-reached': return this.#chatGoalReached(req)
      case 'thread-read':  return this.#threadRead(req)
      case 'agent-progress': return this.#agentProgress(req)
      case 'agents-announce': return this.#agentsAnnounce(req)
      case 'optimization-list':   return this.#optimizationList(req)
      case 'optimization-remove': return this.#optimizationRemove(req)
      case 'feedback-channel-status': return this.#feedbackChannelStatus(req)
      case 'summary-add':  return this.#summaryAdd(req)
      case 'summary-list': return this.#summaryList(req)
      case 'behaviors-list': return this.#behaviorsList(req)
      case 'ui-state': return this.#uiState(req)
      case 'diag-open': return this.#diagOpen(req)
      case 'effect-last': return this.#effectLast(req)
      case 'hit-test': return this.#hitTest(req)
      case 'decoration-add':      return this.#decorationAdd(req)
      case 'bag-add':      return this.#bagMutate(req, 'add')
      case 'bag-remove':   return this.#bagMutate(req, 'remove')
      case 'bag-set':      return this.#bagSet(req)
      case 'build-record': return this.#buildRecord(req)
      case 'hive-root-set': return this.#hiveRootSet(req)
      case 'stamp':        return this.#stamp(req)
      case 'add':          return this.#add(req)        // legacy: delegates to update
      case 'remove':       return this.#remove(req)     // legacy: delegates to update
      case 'list':         return this.#list(req)
      case 'inspect':      return this.#inspect(req)
      case 'history':      return this.#history(req)
      case 'submit':       return this.#submit(req)
      case 'effect-emit':  return this.#effectEmit(req)
      case 'branch-public': return this.#branchPublic(req)
      case 'redrain':      return this.#redrain(req)
      case 'closure-gaps': return this.#closureGaps(req)
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
  // cell's layer slots. The feedback window and state-machine wrappers
  // around base objects pull from here at access/render time.

  /**
   * A BRIDGE FOR EVERY FRONTIER MODEL — the moment this machine has one.
   *
   * A browser cannot read PATH, so it cannot know that `codex` or `gemini` is
   * installed here. `scripts/bridge/bridge-agents.cjs` probes locally and
   * sends the result through this op: one `llm-provider@1` spec per installed
   * CLI, `shape: 'agent-bridge'`. Each is validated by the SAME compiler that
   * accepts a spec published by a domain (provider-spec.ts), registered in the
   * provider registry, and persisted into the `llm:providers` pool — so the
   * bridge keeps its row in `/providers` across reloads, and its model words
   * (`/gemini`, `/codex`) become things the command line offers.
   *
   * Per-spec failure is per-spec: one bad entry is reported by id and the
   * rest still land, because a roster that half-arrives is more useful than
   * one that is refused wholesale.
   */
  async #agentsAnnounce(req: BridgeRequest): Promise<BridgeResponse> {
    const specs = Array.isArray(req.agents) ? req.agents : []
    if (!specs.length) return { id: req.id, ok: false, error: 'agents-announce needs `agents` (array of specs)' }

    const { importProviderSpec } = await import('./providers/provider-discovery.js')
    const registered: string[] = []
    const rejected: { id: string; reason: string }[] = []
    for (const spec of specs) {
      const named = String((spec as { id?: unknown })?.id ?? '(unnamed)')
      try {
        const accepted = await importProviderSpec(spec)
        registered.push(accepted.id)
      } catch (err) {
        rejected.push({ id: named, reason: err instanceof Error ? err.message : String(err) })
      }
    }
    if (registered.length) {
      EffectBus.emit('toast:show', {
        type: 'tip',
        message: registered.length === 1
          ? `${registered[0]} can answer from this machine — see /providers`
          : `${registered.length} model bridges can answer from this machine — see /providers`,
      })
    }
    return { id: req.id, ok: true, data: { registered: registered.length, ids: registered, rejected } }
  }

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
    // Announce it. A record written from OUTSIDE the hive is invisible to
    // everything inside it until something polls — this lets a drone act on
    // its OWN kind the moment it lands (OrganizeDrone applies an
    // `organize-plan` this way) instead of every listener running a timer.
    // Fire-and-forget: the write already succeeded, so a listener that throws
    // must not turn into a failed bridge response.
    try {
      const kind = (JSON.parse(req.text) as { kind?: unknown })?.kind
      EffectBus.emit('optimization:added', { sig, kind: typeof kind === 'string' ? kind : '' })
    } catch { /* parse already validated above; a listener threw — not ours to report */ }
    return { id: req.id, ok: true, data: { sig, bytes: bytes.byteLength } }
  }
  // ─── summary-add / summary-list ────────────────────────────────────
  //
  // The feedback inbox's memory (see feedback-summaries.ts). A live read only
  // ever answers "what is true right now", so nothing could say how long a
  // participant had been waiting or whether the backlog was growing. The
  // responder takes the three buckets at every bridge start and appends one
  // record here; `summary-list` reads them back, collapsed into runs.
  //
  // The record arrives from OUTSIDE the hive and is untrusted third-party
  // data — feedback text reaches the responder over a public channel. Every
  // field is re-derived or clamped here rather than trusted: the caller
  // cannot choose the digest (it is computed from the state it sent), cannot
  // choose the pool, and cannot land a record big enough to wedge a reader.
  async #summaryAdd(req: BridgeRequest): Promise<BridgeResponse> {
    if (typeof req.text !== 'string' || req.text.length === 0) {
      return { id: req.id, ok: false, error: 'summary-add needs `text` (JSON summary)' }
    }
    let raw: Record<string, unknown>
    try { raw = JSON.parse(req.text) as Record<string, unknown> } catch {
      return { id: req.id, ok: false, error: 'summary-add: `text` must be valid JSON' }
    }

    // Drop control and invisible/bidi codepoints — a summary is READ by a
    // human in a list view, and disguised text must not survive the write.
    const str = (v: unknown, cap = 4000): string => {
      const t = typeof v === 'string' ? v : ''
      const clean = t.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')
      return clean.length > cap ? clean.slice(0, cap) : clean
    }
    const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
    const arr = (v: unknown, cap = 200): unknown[] => (Array.isArray(v) ? v.slice(0, cap) : [])
    const segs = (v: unknown): string[] => arr(v, 24).map(x => str(x, 200)).filter(Boolean)

    const totalsRaw = (raw['totals'] ?? {}) as Record<string, unknown>
    const record: Omit<FeedbackSummaryRecord, 'digest'> = {
      kind: 'feedback-summary',
      // The HIVE stamps the time, never the caller: a log whose timestamps
      // come from outside can be written out of order or backdated.
      at: Date.now(),
      totals: {
        feedback: num(totalsRaw['feedback']),
        unseen: num(totalsRaw['unseen']),
        openQuestions: num(totalsRaw['openQuestions']),
        answerRecords: num(totalsRaw['answerRecords']),
        answeredQuestions: num(totalsRaw['answeredQuestions']),
        contested: num(totalsRaw['contested']),
      },
      participants: arr(raw['participants']).map(p => {
        const o = (p ?? {}) as Record<string, unknown>
        return { route: str(o['route'], 300), category: str(o['category'], 60), text: str(o['text']), id: str(o['id'], 120), at: num(o['at']) }
      }),
      host: arr(raw['host']).map(h => {
        const o = (h ?? {}) as Record<string, unknown>
        return { appliesTo: segs(o['appliesTo']), question: str(o['question']), qId: str(o['qId'], 120) }
      }),
      routine: arr(raw['routine']).map(c => {
        const o = (c ?? {}) as Record<string, unknown>
        return { appliesTo: segs(o['appliesTo']), qId: str(o['qId'], 120), count: num(o['count']) }
      }),
      source: str(raw['source'], 60) || 'bridge-start',
    }

    const sig = await putSummary(record)
    if (!sig) return { id: req.id, ok: false, error: 'summary pool unavailable — summary NOT recorded' }
    return { id: req.id, ok: true, data: { sig, at: record.at } }
  }

  async #summaryList(req: BridgeRequest): Promise<BridgeResponse> {
    const runs = await listSummaryRuns()
    const limitRaw = typeof req.limit === 'number' ? req.limit : 20
    const limit = Math.max(1, Math.min(200, Math.floor(limitRaw) || 20))
    return {
      id: req.id, ok: true,
      data: {
        runs: runs.slice(0, limit).map(r => ({
          at: r.record.at,
          since: r.since,
          starts: r.starts,
          digest: r.record.digest,
          totals: r.record.totals,
          participants: r.record.participants,
          host: r.record.host,
          routine: r.record.routine,
          source: r.record.source,
        })),
        runCount: runs.length,
      },
    }
  }

  // ─── chat-reply ────────────────────────────────────────────────────
  //
  // The responder's half of the ASK SCREEN's refinement conversation: a
  // chat-mode ask (payload.mode === 'chat') is answered by sending this op,
  // which surfaces the text INTO the open conversation via the
  // `ask:chat-reply` effect — never as a note. The screen matches on
  // `convoId`; text is capped defensively so a runaway reply can't wedge
  // the UI.
  async #chatReply(req: BridgeRequest): Promise<BridgeResponse> {
    const convoId = typeof req.cell === 'string' ? req.cell.trim() : ''
    const text = typeof req.text === 'string' ? req.text.slice(0, 20_000) : ''
    if (!convoId) return { id: req.id, ok: false, error: 'chat-reply requires `cell` (the convoId)' }
    if (!text) return { id: req.id, ok: false, error: 'chat-reply requires `text`' }
    // WRITE THE RECORD, THEN ANNOUNCE IT. This used to emit and return ok
    // without storing anything: with the conversation window closed the reply
    // went nowhere and the responder was told it had landed, so it retired the
    // ask believing the answer was delivered. `ok` now reflects the WRITE, so
    // an unstorable reply is a failed reply the responder can act on.
    const stored = await deliverTurn(convoId, 'assistant', text)
    if (!stored) return { id: req.id, ok: false, error: 'chat-reply could not be stored — reply NOT delivered' }
    return { id: req.id, ok: true }
  }

  /** Durable "goals attained" receipt for one chat. `text` names the goals
   * that were achieved; the surface shows them and offers Archive. */
  async #chatGoalReached(req: BridgeRequest): Promise<BridgeResponse> {
    const convoId = typeof req.cell === 'string' ? req.cell.trim() : ''
    const details = typeof req.text === 'string' ? req.text.trim() : ''
    if (!convoId) return { id: req.id, ok: false, error: 'chat-goal-reached requires `cell` (the convoId)' }
    if (!details) return { id: req.id, ok: false, error: 'chat-goal-reached requires attained goals in `text`' }
    const stored = await setConversationGoalReached(convoId, details)
    return stored
      ? { id: req.id, ok: true, data: { convoId } }
      : { id: req.id, ok: false, error: 'chat-goal-reached could not be stored' }
  }

  // ─── thread-read ───────────────────────────────────────────────────
  //
  // The whole stored conversation, oldest first — the durable thread the ask
  // record's inline transcript window only approximates. A responder that
  // wants more history than the 12-turn window rides this instead of asking
  // for fatter ask records; it is also the op the mid-stage doctrine pass
  // (turns as contentSig manifests) will keep unchanged on the wire.
  async #threadRead(req: BridgeRequest): Promise<BridgeResponse> {
    const convoId = typeof req.cell === 'string' ? req.cell.trim() : ''
    if (!convoId) return { id: req.id, ok: false, error: 'thread-read requires `cell` (the convoId)' }
    const turns = await readTurns(convoId)
    return {
      id: req.id, ok: true,
      data: { convoId, turns: turns.map(t => ({ role: t.role, text: t.text, at: t.at })) },
    }
  }

  // ─── agent-progress ────────────────────────────────────────────────
  //
  // What a bee is DOING. The hive draws one bee per agent in flight
  // (presentation/avatars/agent-bee.drone.ts); without this op the bee can
  // only ever say "pending", because the work happens in another process.
  // A responder sends `{ cell: <ask sig or agent id>, text: <activity>,
  // kind: <status> }` as it goes, and the panel behind the bee shows it live.
  //
  // Read-only as far as the hive is concerned: this writes no layer, no note
  // and no record — it moves a UI needle and nothing else, so a chatty
  // responder can report as often as it likes.
  async #agentProgress(req: BridgeRequest): Promise<BridgeResponse> {
    const id = typeof req.cell === 'string' ? req.cell.trim() : ''
    if (!id) return { id: req.id, ok: false, error: 'agent-progress requires `cell` (the agent id / ask sig)' }
    const activity = typeof req.text === 'string' ? req.text.slice(0, 400) : ''
    const status = typeof req.kind === 'string' ? req.kind.trim() : ''
    const allowed = new Set(['pending', 'working', 'done', 'failed'])
    EffectBus.emit('agent:progress', {
      id,
      activity,
      ...(allowed.has(status) ? { status } : {}),
    })
    return { id: req.id, ok: true, data: { id } }
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
    const store = get<{
      removeOptimization?: (sig: string) => Promise<boolean>
      getOptimization?: (sig: string) => Promise<Blob | null>
    }>('@hypercomb.social/Store')
    if (!store?.removeOptimization) return { id: req.id, ok: false, error: 'Store.removeOptimization not available' }
    const sig = typeof req.sig === 'string' ? req.sig.trim() : ''
    if (!isSignature(sig)) return { id: req.id, ok: false, error: 'optimization-remove requires `sig` (64-hex)' }

    // Peek at the record before it goes: retiring an ASK is the "your answer
    // has landed" moment — the responder writes the note first, then retires
    // (the drain contract) — so this is where the UI learns the wait is over.
    // CHAT-mode asks are excluded: their replies route into the ask screen's
    // conversation (the `chat-reply` op), not to notes, so the "note added"
    // moment never happens for them. Best-effort: a read failure never blocks
    // the removal.
    let askAnswered: { appliesTo: unknown } | null = null
    try {
      const blob = await store.getOptimization?.(sig)
      if (blob) {
        const parsed = JSON.parse(await blob.text()) as { kind?: string; appliesTo?: unknown; payload?: { mode?: string } }
        if (parsed?.kind === 'ask' && parsed?.payload?.mode !== 'chat') askAnswered = { appliesTo: parsed.appliesTo }
      }
    } catch { /* unreadable record — still remove it */ }

    const removed = await store.removeOptimization(sig)
    if (removed && askAnswered) {
      EffectBus.emit('ask:answered', { sig, appliesTo: askAnswered.appliesTo })
    }
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

  // ─── behaviors-list ────────────────────────────────────────────────
  //
  // The hive's capability inventory: every registered visual bee
  // (behavior package) as {view, slashCommand, decorationKind, adoptable}.
  // Read-only. The meaning-loop sweep grounds its option suggestions in
  // this list — a capability that is PRESENT shapes "build X here"
  // options; one that is ABSENT shapes "look for / adopt X" options
  // (documentation/meaning-loop.md, "Capability-aware options").
  async #behaviorsList(req: BridgeRequest): Promise<BridgeResponse> {
    const registry = get<{ all?: () => readonly Record<string, unknown>[] }>('@diamondcoreprocessor.com/VisualBeeRegistry')
    if (!registry?.all) return { id: req.id, ok: false, error: 'VisualBeeRegistry not available' }
    const items = registry.all().map(b => ({
      view: String(b['view'] ?? ''),
      slashCommand: String(b['slashCommand'] ?? ''),
      decorationKind: String(b['decorationKind'] ?? ''),
      adoptable: b['adoptable'] === true,
    }))
    return { id: req.id, ok: true, data: items }
  }

  // ─── ui-state ──────────────────────────────────────────────────────
  //
  // Read-only snapshot of the renderer tab's TRANSIENT input state — the
  // things that can silently eat tile clicks (a stuck selection routes
  // clicks to `tile:click`; a locked input gate swallows the gesture; a
  // non-hexagon view mode isn't showing tiles at all). Diagnosis surface
  // for the driver; nothing here mutates.
  async #uiState(req: BridgeRequest): Promise<BridgeResponse> {
    const lineage = get<{ explorerSegments?: () => readonly string[] }>('@hypercomb.social/Lineage')
    const selection = get<{ count?: number }>('@diamondcoreprocessor.com/SelectionService')
    const gate = get<{ active?: boolean; locked?: boolean; owner?: string | null }>('@diamondcoreprocessor.com/InputGate')
    const viewMode = get<{ mode?: string }>('@hypercomb.social/ViewMode')
    return {
      id: req.id,
      ok: true,
      data: {
        segments: (lineage?.explorerSegments?.() ?? []).map(s => String(s)),
        selectionCount: selection?.count ?? null,
        gateActive: gate?.active ?? null,
        gateLocked: gate?.locked ?? null,
        gateOwner: gate?.owner ?? null,
        viewMode: viewMode?.mode ?? null,
      },
    }
  }

  // ─── effect-last ───────────────────────────────────────────────────
  //
  // Read the LAST STICKY VALUE of an EffectBus effect (the bus replays
  // the last emission synchronously to a new subscriber — that replay IS
  // the read; the momentary subscription is removed immediately).
  // Diagnosis surface: "did a tile:hover / tile:action / render:cell-count
  // ever fire in this tab, and with what payload?"
  async #effectLast(req: BridgeRequest): Promise<BridgeResponse> {
    const name = typeof req.cell === 'string' ? req.cell.trim() : ''
    if (!name) return { id: req.id, ok: false, error: 'effect-last requires `cell` (effect name)' }
    let captured: unknown = undefined
    const off = EffectBus.on(name, (payload: unknown) => { captured = payload })
    try { if (typeof off === 'function') off() } catch { /* unsubscribe best-effort */ }
    return { id: req.id, ok: true, data: { name, last: captured === undefined ? null : captured } }
  }

  // ─── hit-test ──────────────────────────────────────────────────────
  //
  // What is the TOPMOST element at a viewport point? The tile overlay's
  // click handler silently drops any click whose target is not the Pixi
  // canvas (`e.target !== #canvas`), while hover is computed from raw
  // coordinates and pierces covers — so "hover works, clicks are dead"
  // means something invisible sits over the canvas. This op names it.
  // Defaults to the canvas center when x/y are not given.
  async #hitTest(req: BridgeRequest): Promise<BridgeResponse> {
    const canvas = document.querySelector('canvas')
    const rect = canvas?.getBoundingClientRect()
    const point = req as unknown as { x?: unknown; y?: unknown }
    const x = typeof point.x === 'number' ? point.x : rect ? rect.left + rect.width / 2 : 0
    const y = typeof point.y === 'number' ? point.y : rect ? rect.top + rect.height / 2 : 0
    const stack = document.elementsFromPoint(x, y).slice(0, 5).map(el => ({
      tag: el.tagName.toLowerCase(),
      id: el.id || null,
      className: String((el as HTMLElement).className ?? '').slice(0, 80) || null,
      isTheCanvas: el === canvas,
    }))
    return { id: req.id, ok: true, data: { x, y, top: stack[0] ?? null, stack } }
  }

  // ─── diag-open ─────────────────────────────────────────────────────
  //
  // Emit the default `open` tile action for `label` exactly as a body
  // click on a leaf tile would — driving any
  // other tile:action consumer) from the bridge. Diagnosis: when this
  // opens the QA card but a real click does not, the break is in the
  // click gesture/guards, not the open pipeline.
  async #diagOpen(req: BridgeRequest): Promise<BridgeResponse> {
    const label = typeof req.cell === 'string' ? req.cell.trim() : ''
    if (!label) return { id: req.id, ok: false, error: 'diag-open requires `cell` (tile label)' }
    EffectBus.emit('tile:action', { action: 'open', label, q: 0, r: 0, index: 0 })
    return { id: req.id, ok: true, data: { emitted: 'open', label } }
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
      commitSlotSet?: (segments: readonly string[], slot: string, sigs: readonly string[]) => Promise<void>
    }>('@diamondcoreprocessor.com/LayerCommitter')
    if (!committer?.commitSlotSet) {
      return { id: req.id, ok: false, error: 'LayerCommitter.commitSlotSet not available' }
    }

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
    // — except group decorations: payload.sig is a group signature (pure
    // identity, sha256('group:'+meaning)); no bytes exist for it anywhere,
    // so declaring it would send every closure walker on a permanent 404.
    // — and creation decorations for the same reason: payload.id is a pure
    // identity (sha256 of the act's descriptor — see creation.ts), never a
    // stored resource. Harvesting it into `refs` poisons the closure walk
    // with a permanent 404 that blocks publishing the whole branch.
    if (kind !== 'group' && kind !== 'creation') for (const s of collectSigsDeep(payload)) refs.add(s)
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

    // 5. Cascade — SLOT-SCOPED. `committer.update` would take this
    //    `{ name, decorations }` as the cell's FULL new layer state and wipe
    //    every slot not named, `children` included: adding one decoration
    //    would orphan the cell's whole subtree, silently and without error.
    //    See #bagSet for the long version.
    if (!committer.commitSlotSet) {
      return { id: req.id, ok: false, error: 'LayerCommitter.commitSlotSet not available' }
    }
    await committer.commitSlotSet(segments, 'decorations', next)

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
      commitSlotSet?: (segments: readonly string[], slot: string, sigs: readonly string[]) => Promise<void>
    }>('@diamondcoreprocessor.com/LayerCommitter')
    if (!committer?.update) return { id: req.id, ok: false, error: 'LayerCommitter.update not available' }

    // Record locally-authored page sigs written to a page slot (parity with
    // #bagSet / #update / #decorationAdd) so the gate never quarantines them.
    markLayerAuthoredPageSigs({ [slot]: next })
    // SET ONE SLOT, TOUCH NO OTHER — see #bagSet. `committer.update` reads a
    // `{ name, [slot] }` object as the cell's FULL new layer state ("absent ≡
    // empty"), so mutating one bag wiped `children` and every other slot the
    // cell was wearing. `children` already took the slot-scoped path for its
    // own reason (it is a NAME slot there, and a 64-hex "name" reads a cold
    // bag that auto-mints a husk tile); every other slot needs it too.
    if (!committer.commitSlotSet) {
      return { id: req.id, ok: false, error: 'LayerCommitter.commitSlotSet not available' }
    }
    await committer.commitSlotSet(segments, slot, next)
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
      commitSlotSet?: (segments: readonly string[], slot: string, sigs: readonly string[]) => Promise<void>
    }>('@diamondcoreprocessor.com/LayerCommitter')
    if (!committer?.update) return { id: req.id, ok: false, error: 'LayerCommitter.update not available' }

    // A page written to a page-bearing slot (`website`/`context`) is locally-
    // authored content — record its sigs so the gate treats your own pages as
    // own. One helper across every local slot-writer keeps coverage from drifting.
    markLayerAuthoredPageSigs({ [slot]: next })
    // SET ONE SLOT, TOUCH NO OTHER — via `commitSlotSet`, never `update`.
    //
    // `LayerCommitter.update` is the layer-as-primitive write: the caller
    // passes the FULL new layer state and "absent ≡ empty", so every slot the
    // caller did not name is WIPED. Naming one slot in a `{ name, [slot] }`
    // object therefore silently erased the cell's `children` — and its notes,
    // and everything else it was wearing. A `bag-set properties` on a tile
    // with seven children left seven orphans: still resolvable by their own
    // path, simply gone from their parent's membership, so nothing draws them
    // and nothing errors. You only notice by eye. (Same shape as the
    // inflate-on-the-write-side orphaning, arriving through a different door.)
    //
    // `children` already took this path, for its own reason: it is a NAME slot
    // in `update`, so a 64-hex sig would be resolved as a tile NAME, reading a
    // cold bag that auto-mints a `{name:<sig>}` husk tile. Children carry sigs
    // already. That special case was right and was hiding how wrong the
    // general case was — every OTHER slot needs the same commit, for the
    // opposite reason.
    if (!committer.commitSlotSet) {
      return { id: req.id, ok: false, error: 'LayerCommitter.commitSlotSet not available' }
    }
    await committer.commitSlotSet(segments, slot, next)
    return { id: req.id, ok: true, data: { slot, count: next.length } }
  }

  /** Mint a build revision for the subtree at `segments` — the LAST call
   *  of every multi-file build pass (documentation/build-revisions.md).
   *  Seals the subtree, no-ops when the head record already names that
   *  seal (idempotent rebuild), else writes the record and appends its
   *  sig to the `builds` slot. `{ op: 'build-record', segments, label? }`. */
  async #buildRecord(req: BridgeRequest): Promise<BridgeResponse> {
    const segments = (req.segments ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
    if (segments.length === 0) {
      return { id: req.id, ok: false, error: 'build-record requires `segments` (for the whole hive, use /snapshot)' }
    }
    const result = await mintBuildRecord(
      segments,
      typeof req.label === 'string' ? req.label : undefined,
      req.dryRun === true ? { dryRun: true } : undefined,
    )
    if ('error' in result) return { id: req.id, ok: false, error: result.error }
    return { id: req.id, ok: true, data: result }
  }

  /** Merge ONE colon-keyed root into the publisher's OWN signed hive
   *  index — the install-channel producer (install-by-replication.md,
   *  steps 2+6): `{ op: 'hive-root-set', key, sig, host? }`. The deploy
   *  drives this over the bridge after upload, so signing stays in the
   *  browser's NostrSigner (custody: browser-over-bridge, decided
   *  2026-08-30). Colon-less keys are REFUSED at this surface: a folded
   *  site lineage can never carry a colon, so the bridge can stamp
   *  install channels but never clobber a published site. All index
   *  safety (404-only empty baseline, refuse-on-unreadable, one-key
   *  merge, unchanged no-op) lives in setHiveRoot. */
  async #hiveRootSet(req: BridgeRequest): Promise<BridgeResponse> {
    const key = String(req.key ?? '').trim()
    const sig = String(req.sig ?? '').trim().toLowerCase()
    if (!key.includes(':')) {
      return { id: req.id, ok: false, error: 'hive-root-set requires a colon-carrying key (e.g. install:essentials) — site lineage roots are not settable over the bridge' }
    }
    // A COLON IS NOT A LICENCE. The colon rule only proves the key is not a
    // site lineage; it says nothing about whether advancing it is a DEPLOY
    // STAMP (install:<channel>, which is what this op exists for) or a
    // PARTICIPANT ACT. `vocabulary:hive` is the second kind — publishing what
    // words you hold is something the participant does, at their own gesture,
    // or the scope model is decoration. Refused as DATA, in hive-link.ts, so
    // the list extends without touching this worker again.
    if (!bridgeMaySetRootKey(key)) {
      return { id: req.id, ok: false, error: `hive-root-set refuses '${key}' — only an install:<channel> stamp is settable over the bridge; everything else is a participant act` }
    }
    const host = String(req.host ?? '').trim().toLowerCase() || PUBLIC_CONTENT_HOSTS[0] || ''
    if (!host) return { id: req.id, ok: false, error: 'no index host configured' }
    const result = await setHiveRoot(host, key, sig)
    if (!result.ok) return { id: req.id, ok: false, error: result.reason ?? 'hive-root-set failed' }
    return {
      id: req.id, ok: true,
      data: {
        key: result.key, sig: result.sig, host: result.host,
        pubkey: result.pubkey, createdAt: result.createdAt,
        ...(result.reason === 'unchanged' ? { unchanged: true } : {}),
      },
    }
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
    // The props index follows via writeTilePropertiesAt's central
    // layer-keyed seed, and the render derives from canonical on a miss —
    // no location write needed (Phase C sweep, visuals-across-lineages.md).
    await writeTilePropertiesAt(parentSegments, cellName, updates)
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
  // (e.g. a Q&A pass needs the qa-slot resource sig so the
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

  // Raw layer read BY SIGNATURE — the sig-addressed twin of `layer-at`.
  //
  // A parent's `children` slot holds LAYER sigs, and a layer sig is NOT a
  // resource: `get-resource` on one answers "resource not found: <sig>".
  // Bridge callers that wanted a child's NAME therefore had only `inflate`,
  // which resolves the ENTIRE subtree to read one string — and several
  // scripts instead reached for `get-resource`, silently got nothing back,
  // and concluded the parent had no children. This is the one-hop read:
  // slots stay as sigs, exactly as `layer-at` leaves them.
  async #layerBySig(req: BridgeRequest): Promise<BridgeResponse> {
    const sig = typeof req.cell === 'string' ? req.cell.trim() : ''
    if (!isSignature(sig)) {
      return { id: req.id, ok: false, error: 'layer-by-sig requires a 64-hex layer sig in `cell`' }
    }
    const history = get<HistoryService>('@diamondcoreprocessor.com/HistoryService')
    if (!history) return { id: req.id, ok: false, error: 'HistoryService not available' }
    const layer = await history.getLayerBySig(sig)
    if (!layer) return { id: req.id, ok: false, error: `no layer for sig ${sig}` }
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
  //
  // `mark` is the icon from the participant's own palette, and it is what
  // decides whether the row reads as a POINT (a constrained line carrying
  // structure) or a NOTE (prose) — the role lives on the palette entry, not
  // here, so this passes the icon through and classifies nothing itself.
  // Optional: without it the row is unmarked, exactly as before.
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
    const mark = typeof (req as { mark?: unknown }).mark === 'string'
      ? (req as { mark: string }).mark
      : null
    const notes = get<{
      addAtSegments?: (
        s: readonly string[], c: string, t: string,
        shape?: unknown, mark?: string | null,
      ) => Promise<void>
    }>('@diamondcoreprocessor.com/NotesService')
    if (!notes?.addAtSegments) {
      return { id: req.id, ok: false, error: 'NotesService.addAtSegments not available' }
    }
    // NotesService normalizes the icon name and drops anything malformed, so
    // a bad mark degrades to an unmarked note rather than failing the write.
    await notes.addAtSegments(segments, cell, text, null, mark)
    return { id: req.id, ok: true }
  }

  // Break one note into a one-line head plus a sub-note per part, IN PLACE —
  // the note keeps its slot position, its mark and any children it already
  // had, and the whole split is ONE layer no matter how many parts it makes.
  // This is how a LIST gets authored over the bridge: the head is the point,
  // the parts are the points and prose notes hanging under it.
  //
  //   { op: 'note-split', cell, segments, sig: <noteId>, head: '…',
  //     parts: [ 'plain text', { text: '…', mark: 'notes' } ] }
  //
  // Purely additive: it never deletes a note. A note that shouldn't be split
  // is simply never passed here, and a split that can't be honoured (blank
  // head, no usable parts, unknown note) leaves the tree untouched and mints
  // no layer — see NotesService.splitAtSegments.
  async #noteSplit(req: BridgeRequest): Promise<BridgeResponse> {
    const cell = req.cell
    const segments = req.segments ?? []
    const noteId = typeof req.sig === 'string' ? req.sig.trim() : ''
    const rawHead = (req as unknown as { head?: unknown }).head
    const head = typeof rawHead === 'string' ? rawHead : ''
    const parts = (req as { parts?: unknown }).parts
    if (typeof cell !== 'string' || !cell) {
      return { id: req.id, ok: false, error: 'missing cell label' }
    }
    if (!noteId) {
      return { id: req.id, ok: false, error: 'missing noteId (pass via `sig` field)' }
    }
    if (!Array.isArray(parts)) {
      return { id: req.id, ok: false, error: 'missing parts (array of strings or {text, mark})' }
    }
    const notes = get<{
      splitAtSegments?: (
        s: readonly string[], c: string, id: string, head: string,
        parts: readonly (string | { text: string; mark?: string | null })[],
      ) => Promise<void>
      getNotesAtSegments?: (s: readonly string[]) => Promise<unknown[]>
    }>('@diamondcoreprocessor.com/NotesService')
    if (!notes?.splitAtSegments) {
      return { id: req.id, ok: false, error: 'NotesService.splitAtSegments not available' }
    }
    await notes.splitAtSegments(
      segments, cell, noteId, head,
      parts as readonly (string | { text: string; mark?: string | null })[],
    )
    // Report the note's NEW sig — the split rewrote its bytes, so the caller's
    // noteId is stale the moment this resolves. Without this a caller walking
    // a list would have to re-read the whole cell to keep going.
    let sig: string | null = null
    try {
      const after = await notes.getNotesAtSegments?.([...segments, cell]) ?? []
      const hit = (after as { id?: string; text?: string }[])
        .find(n => n.text === head.trim())
      sig = hit?.id ?? null
    } catch { /* the split landed; reporting the new sig is best-effort */ }
    return { id: req.id, ok: true, data: { cell, sig } }
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
    // slots (e.g. a page refresh writing context:[htmlSig,...] alongside
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

  // Emits one allowlisted UI intent — the same effects the matching panel
  // buttons emit — so a remote session can drive an action that today has
  // only a pointer path (e.g. the publish panel's per-row Publish). The
  // allowlist is the whole contract: intents only, never truth-minting
  // effects, and `synchronize` stays processor-only by doctrine.
  static readonly #REMOTE_INTENTS = new Set([
    'publish:run', 'publish:unpublish', 'publish:refresh', 'publish:inspect',
    'publish:view-toggle', 'publish:close', 'publish:opens-as',
    // A responder that just created parts over the bridge owes them each an
    // appearance (website-artifact paradigm, rules 10 and 11) and cannot cut
    // an image from out there. It hands the act back to the hive, which holds
    // the pixels. See assistant/visual-distribution.drone.ts.
    'parts:distribute-visual',
  ])

  async #effectEmit(req: BridgeRequest): Promise<BridgeResponse> {
    const name = typeof req.cell === 'string' ? req.cell : ''
    if (!ClaudeBridgeWorker.#REMOTE_INTENTS.has(name)) {
      return { id: req.id, ok: false, error: `effect not allowlisted: ${name}` }
    }
    EffectBus.emit(name, req.payload ?? {})
    return { id: req.id, ok: true, data: { name } }
  }

  // READS the public-branch marks. WRITING THEM IS A PARTICIPANT ACT AND IS
  // REFUSED HERE.
  //
  // This op used to WRITE the mark with no gesture at all — the same
  // class of hole `hive-root-set` had, and one step worse in consequence.
  // `hc:public-branches` is not merely a panel row: it is the SCOPE INPUT of
  // the signed vocabulary claim (`molecule/vocabulary-publish.ts` derives the
  // declared words from exactly these marks), and `swarm.drone.ts` fires
  // `markPublic` off the same list during a publish walk. An agent driving the
  // bridge could therefore choose which subtrees a later — properly confirmed
  // — publish declares, so "the participant chose the scope" would be false
  // while the confirmation still said it was true.
  //
  // A caller that genuinely needs a first publish asks the participant to mark
  // the branch; the toggle is one click and it is the whole consent gesture.
  async #branchPublic(req: BridgeRequest): Promise<BridgeResponse> {
    if (req.public !== undefined) {
      return {
        id: req.id,
        ok: false,
        error: 'branch-public is read-only over the bridge: marking a branch public is a participant act (it is the scope input of the signed vocabulary claim). Ask the participant to use the tile toggle.',
      }
    }
    return { id: req.id, ok: true, data: { branches: readPublicBranches() } }
  }

  // Runs HostSyncService.reDrain() and returns its summary verbatim. The
  // summary's `skippedMissingLocal` is the ONLY surface that names the
  // genuine closure holes (refs no local store holds and no receipt
  // covers) — the exact sigs a stuck availability gate is tripping on.
  async #redrain(req: BridgeRequest): Promise<BridgeResponse> {
    const hostSync = window.ioc.get<{
      reDrain?: () => Promise<{ queued: number; pushed: number; failed: number; skippedMissingLocal: string[] }>
    }>('@diamondcoreprocessor.com/HostSyncService')
    if (!hostSync?.reDrain) return { id: req.id, ok: false, error: 'HostSyncService.reDrain unavailable' }
    const summary = await hostSync.reDrain()
    return { id: req.id, ok: true, data: summary }
  }

  // Names the exact holes a stuck availability gate is tripping on:
  // HostSyncService.closureGaps turns "the closure isn't fully served" into
  // "these objects are missing" — the only actionable form.
  async #closureGaps(req: BridgeRequest): Promise<BridgeResponse> {
    const sig = typeof req.sig === 'string' ? req.sig : ''
    const hostSync = window.ioc.get<{
      closureGaps?: (sig: string, kind?: string, closure?: boolean, limit?: number) => Promise<string[]>
    }>('@diamondcoreprocessor.com/HostSyncService')
    if (!hostSync?.closureGaps) return { id: req.id, ok: false, error: 'HostSyncService.closureGaps unavailable' }
    const gaps = await hostSync.closureGaps(sig, 'layer', true, 100)
    return { id: req.id, ok: true, data: { sig, gaps } }
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

