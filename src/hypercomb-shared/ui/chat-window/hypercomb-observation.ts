// hypercomb-observation.ts
//
// READS SPEAK GRAMMAR TOO. A model asks the hive a question in the hive's
// own grammar and the hive answers with content (Jaime, 2026-09-12: "ask the
// hive, to run queries and learn stuff"). The transport is the work fence's
// `hypercomb-read` block (hypercomb-work-fence.ts); parsing, budgets,
// receipts and the reader interface never depended on how the lines arrived,
// which is why the function-calling envelope could be shed without touching
// them.

/** Reads per request — also what the work fence teaches a model. */
export const MAX_OBSERVATIONS = 2
const MAX_GRAMMAR_LENGTH = 1_000
const MAX_PATH_SEGMENTS = 32
const MAX_SEGMENT_LENGTH = 256
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/

/** The hive's read-only verbs (documentation/anatomy-context-need.md
 *  §3). `tree` is structure-only and predates the gate; the other three
 *  return signatures and content, and only ever reach the participant's
 *  local model or a provider they granted (llm-hive-access.ts). */
export type HypercombObservationVerb = 'tree' | 'read' | 'list' | 'history' | 'summary' | 'find' | 'code'
const VERBS: readonly HypercombObservationVerb[] = ['tree', 'read', 'list', 'history', 'summary', 'find', 'code']
const SIG = /^[0-9a-f]{64}$/
const MAX_QUERY_LENGTH = 64
/** Modules and dependencies named per `/code` answer; `total` says how many matched. */
const CODE_ENTRIES = 60
/** A structural ceiling on `projection`, independent of the caller's byte
 *  budget — matches the cap the writer enforces (assistant/llm-context.ts),
 *  with slack for a record minted by an older build. */
const MAX_PROJECTION_LENGTH = 8_000

/** Shared consumes modules through IoC at runtime and never imports an
 *  essentials path (CLAUDE.md's dependency direction) — this is the one
 *  lookup, kept local rather than exported so nothing outside this file can
 *  mistake it for a stable import. */
const ioc = <T>(key: string): T | undefined =>
  (window as unknown as { ioc?: { get?: <V>(k: string) => V | undefined } }).ioc?.get?.<T>(key)

export type HypercombObservation = {
  readonly grammar: string
  readonly verb: HypercombObservationVerb
  /** The route asked about; the current page when the verb stood alone. */
  readonly segments: readonly string[]
  /** `/read <sig>` / `/list <sig>`: a layer addressed by signature — an
   *  earlier version from `/history`, or a child sig from `/list`. */
  readonly sig?: string
  /** `/find <word>`: the name fragment to look for under `segments`;
   *  `/code <word>`: the fragment to look for among the running code. */
  readonly query?: string
  /** `/read <sig> <from>`: where to continue a long resource or module. */
  readonly from?: number
}

/** `/read <sig>` on anything that is not a layer: the module, dependency or
 *  resource the signature names, as text a page at a time. */
export type HypercombBytesRead =
  | {
    readonly ok: true
    readonly root: string
    readonly sig: string
    readonly of: 'resource' | 'bee' | 'dependency'
    readonly type: string
    readonly size: number
    readonly from: number
    /** Absent when the bytes are not text (an image, say). */
    readonly text?: string
    readonly truncated: boolean
    /** Where `/read <sig> <next>` continues, when there is more. */
    readonly next?: number
  }
  | { readonly ok: false; readonly root: string; readonly code: string }

/** `/code`: the modules and dependencies running in this hive, by name. */
export type HypercombCodeRead =
  | {
    readonly ok: true
    readonly root: string
    readonly query: string
    readonly entries: readonly { readonly name: string; readonly sig: string; readonly of: 'bee' | 'dependency' }[]
    readonly total: number
    readonly truncated: boolean
  }
  | { readonly ok: false; readonly root: string; readonly code: string }

export type HypercombFindRead =
  | {
    readonly ok: true
    readonly root: string
    readonly query: string
    readonly matches: readonly { readonly name: string; readonly path: string }[]
    readonly truncated: boolean
    readonly snapshot: string
  }
  | { readonly ok: false; readonly root: string; readonly code: string }

export type HypercombNodeRead =
  | {
    readonly ok: true
    readonly root: string
    readonly name: string
    readonly layerSig: string
    readonly children: readonly { readonly name: string; readonly sig: string }[]
    readonly content?: Record<string, unknown>
    /** A token-compact rendering of the tile in place of `content`, from the
     *  hive's LLM context cache (assistant/llm-context.ts). Present only on
     *  a `/read` (never `/list`) whose layer sig had — or could derive — a
     *  projection; when present, `content` is omitted, which is the saving. */
    readonly projection?: string
    readonly truncated?: boolean
    /** Children the layer declares whose layers are not on this device —
     *  listed by signature rather than failing the whole read. */
    readonly unresolved?: readonly string[]
    /** Absent on a sig-addressed read: a layer by sig has no live head to
     *  revalidate — it is immutable content, which is the whole point. */
    readonly snapshot?: string
  }
  | { readonly ok: false; readonly root: string; readonly code: string }

export type HypercombHistoryRead =
  | {
    readonly ok: true
    readonly root: string
    readonly total: number
    readonly markers: readonly { readonly index: number; readonly layerSig: string; readonly at: number; readonly name: string }[]
  }
  | { readonly ok: false; readonly root: string; readonly code: string }

export type HypercombSummaryRead =
  | {
    readonly ok: true
    readonly root: string
    readonly name: string
    readonly layerSig: string
    readonly model: string
    readonly text: string
    readonly minted: boolean
  }
  | { readonly ok: false; readonly root: string; readonly code: string }

export type HypercombRead =
  | { readonly kind: 'tree'; readonly read: HypercombTreeRead }
  | { readonly kind: 'node'; readonly read: HypercombNodeRead }
  | { readonly kind: 'history'; readonly read: HypercombHistoryRead }
  | { readonly kind: 'summary'; readonly read: HypercombSummaryRead }
  | { readonly kind: 'find'; readonly read: HypercombFindRead }
  | { readonly kind: 'bytes'; readonly read: HypercombBytesRead }
  | { readonly kind: 'code'; readonly read: HypercombCodeRead }

export type HypercombObservationPlan = {
  readonly observations: readonly HypercombObservation[]
}

export type HypercombObservedNode = {
  readonly path: string
  readonly name: string
  readonly depth: number
  readonly childCount: number
}

export type HypercombTreeRead =
  | {
    readonly ok: true
    readonly root: string
    readonly nodes: readonly HypercombObservedNode[]
    readonly truncated: boolean
    readonly snapshot: string
  }
  | {
    readonly ok: false
    readonly root: string
    readonly code: 'not-found' | 'incomplete-read' | 'stale-read' | 'budget-exceeded' | 'unavailable'
  }

export type HypercombTreeReader = {
  readTree(segments: readonly string[], options: {
    readonly maxDepth: number
    readonly maxNodes: number
    readonly maxBytes: number
    readonly signal?: AbortSignal
  }): Promise<HypercombTreeRead>
  validateSnapshots(ids: readonly string[], signal?: AbortSignal): Promise<boolean>
  /** `/read` and `/list` — absent on a reader that can only do `/tree`. */
  readNode?(segments: readonly string[], options: {
    readonly maxBytes: number
    readonly withContent: boolean
    readonly signal?: AbortSignal
  }): Promise<HypercombNodeRead>
  /** `/history` — absent on a reader that can only do `/tree`. */
  readHistory?(segments: readonly string[], options: {
    readonly limit: number
    readonly signal?: AbortSignal
  }): Promise<HypercombHistoryRead>
  /** `/summary` — absent on a reader with no compaction behind it. */
  readSummary?(segments: readonly string[], options: {
    readonly maxBytes: number
    readonly signal?: AbortSignal
  }): Promise<HypercombSummaryRead>
  /** `/read <sig>` and `/list <sig>` — immutable content by signature. */
  readNodeBySig?(sig: string, options: {
    readonly maxBytes: number
    readonly withContent: boolean
    readonly signal?: AbortSignal
  }): Promise<HypercombNodeRead>
  /** `/find <word>` — names under a route, bounded like `/tree`. */
  find?(query: string, segments: readonly string[], options: {
    readonly maxNodes: number
    readonly signal?: AbortSignal
  }): Promise<HypercombFindRead>
  /** `/read <sig>` when the signature is not a layer, and `/read <sig> <from>`. */
  readBytesBySig?(sig: string, options: {
    readonly from: number
    readonly maxBytes: number
    readonly signal?: AbortSignal
  }): Promise<HypercombBytesRead>
  /** `/code` and `/code <word>` — the running code by name. */
  listCode?(query: string, options: {
    readonly maxEntries: number
    readonly signal?: AbortSignal
  }): Promise<HypercombCodeRead>
}

export type HypercombObservationReceipt = {
  readonly results: readonly ({ readonly grammar: string } & HypercombRead)[]
  /** Kept by the host and never accepted from model output. */
  readonly snapshots: readonly string[]
  /** What each read resolved to — the signatures, kept as lookup keys so the
   *  same content opens again by signature without walking to it. */
  readonly signatures: readonly { readonly grammar: string; readonly sig: string }[]
}

export class HypercombObservationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HypercombObservationError'
  }
}

const parseObservation = (
  raw: unknown,
  currentSegments: readonly string[],
  index: number,
): HypercombObservation => {
  if (typeof raw !== 'string') {
    throw new HypercombObservationError(`observation ${index + 1} must be a string`)
  }
  if (raw.length > MAX_GRAMMAR_LENGTH || CONTROL_CHARACTER.test(raw)) {
    throw new HypercombObservationError(`observation ${index + 1} must be one bounded printable line`)
  }
  const grammar = raw.trim()
  // /code and /code <word>: the running code by name. Not a place, so no route.
  const code = /^\/code(?:\s+(\S.*))?$/.exec(grammar)
  if (code) {
    if (code[1] === undefined) return { grammar, verb: 'code', segments: [] }
    const query = code[1].trim()
    if (!query || query.length > MAX_QUERY_LENGTH || query.includes('\\') || CONTROL_CHARACTER.test(query)) {
      throw new HypercombObservationError('/code takes one short name fragment')
    }
    return { grammar, verb: 'code', segments: [], query }
  }
  const bare = /^\/(tree|read|list|history|summary)$/.exec(grammar)
  if (bare) {
    return { grammar, verb: bare[1] as HypercombObservationVerb, segments: [...currentSegments] }
  }
  // /read <sig> and /list <sig>: content by signature. Only those two — a
  // signature names a layer or bytes, not a place, so it has no tree, history
  // or summary (the summary is keyed by the sig, but asked for via the route).
  // `/read <sig> <from>` continues a long resource or module where the last
  // page stopped.
  const bySig = /^\/(read|list)\s+([0-9a-f]{64})(?:\s+(\d{1,9}))?$/.exec(grammar)
  if (bySig) {
    if (bySig[3] !== undefined && bySig[1] !== 'read') {
      throw new HypercombObservationError('only /read <sig> takes a place to continue from')
    }
    const from = bySig[3] === undefined ? 0 : Number(bySig[3])
    return { grammar, verb: bySig[1] as HypercombObservationVerb, segments: [], sig: bySig[2], ...(from > 0 ? { from } : {}) }
  }
  // /find <word>: names under the current page.
  const find = /^\/find\s+(\S.*)$/.exec(grammar)
  if (find) {
    const query = find[1].trim()
    if (!query || query.length > MAX_QUERY_LENGTH || query.includes('/') || query.includes('\\')
      || CONTROL_CHARACTER.test(query)) {
      throw new HypercombObservationError('/find takes one short name fragment, no slashes')
    }
    return { grammar, verb: 'find', segments: [...currentSegments], query }
  }
  const match = /^\/(tree|read|list|history|summary)\s+(\/.*)$/.exec(grammar)
  if (!match || !VERBS.includes(match[1] as HypercombObservationVerb)) {
    throw new HypercombObservationError('hive observations use /tree, /read, /list, /history or /summary (alone or followed by /absolute/path), /read <sig> [from], /list <sig>, /find <word>, or /code [word]')
  }
  const verb = match[1] as HypercombObservationVerb
  const absolute = match[2]
  const segments = absolute === '/' ? [] : absolute.slice(1).split('/')
  if (segments.length > MAX_PATH_SEGMENTS || segments.some(segment =>
    !segment || segment !== segment.trim() || segment.length > MAX_SEGMENT_LENGTH
    || segment === '.' || segment === '..' || segment.includes('\\')
    || CONTROL_CHARACTER.test(segment))) {
    throw new HypercombObservationError('the observation path is not a bounded canonical Hypercomb path')
  }
  return { grammar, verb, segments }
}

/** The stable parser: one plan from ordered lines, validated whole. */
export const parseHypercombObservationGrammars = (
  grammars: readonly unknown[],
  currentSegments: readonly string[],
): HypercombObservationPlan => {
  if (grammars.length < 1 || grammars.length > MAX_OBSERVATIONS) {
    throw new HypercombObservationError(`grammars must contain between 1 and ${MAX_OBSERVATIONS} observations`)
  }
  const observations = grammars.map((grammar, index) =>
    parseObservation(grammar, currentSegments, index))
  const roots = observations.map(observation =>
    JSON.stringify([observation.verb, observation.segments, observation.sig ?? '', observation.query ?? '', observation.from ?? 0]))
  if (new Set(roots).size !== roots.length) {
    throw new HypercombObservationError('an observation sequence cannot ask the same question twice')
  }
  return { observations }
}

const safeRead = (
  read: HypercombTreeRead,
  expectedRoot: string,
  maxNodes: number,
): HypercombTreeRead => {
  if (!read || read.root !== expectedRoot) {
    throw new HypercombObservationError('the tree reader returned a mismatched root')
  }
  if (!read.ok) {
    const codes = new Set(['not-found', 'incomplete-read', 'stale-read', 'budget-exceeded', 'unavailable'])
    return { ok: false, root: expectedRoot, code: codes.has(read.code) ? read.code : 'unavailable' }
  }
  if (typeof read.snapshot !== 'string' || !read.snapshot || read.snapshot.length > 128
    || !Array.isArray(read.nodes) || read.nodes.length > maxNodes) {
    throw new HypercombObservationError('the tree reader returned malformed bounded data')
  }
  const nodes = read.nodes.map(node => {
    if (typeof node?.path !== 'string' || !node.path.startsWith('/') || node.path.length > 2_000
      || CONTROL_CHARACTER.test(node.path) || typeof node.name !== 'string'
      || !node.name || node.name.length > MAX_SEGMENT_LENGTH || CONTROL_CHARACTER.test(node.name)
      || !Number.isInteger(node.depth) || node.depth < 0 || node.depth > 3
      || !Number.isInteger(node.childCount) || node.childCount < 0 || node.childCount > 1_000_000) {
      throw new HypercombObservationError('the tree reader returned a malformed node')
    }
    return {
      path: node.path,
      name: node.name,
      depth: node.depth,
      childCount: node.childCount,
    }
  })
  return { ok: true, root: expectedRoot, nodes, truncated: read.truncated === true, snapshot: read.snapshot }
}

/** `/read` node results only — never `/list`, which never sets `withContent`.
 *  Optional: a hive with no LLM context service (or one that yields nothing
 *  for this layer) answers exactly as it always did. When it yields text,
 *  `content` is dropped in favour of `projection` — that omission is the
 *  saving the whole cache exists for — while `truncated` is kept. */
const withProjection = async (read: HypercombNodeRead): Promise<HypercombNodeRead> => {
  if (!read.ok) return read
  const service = ioc<{ project?: (layerSig: string) => Promise<{ readonly text: string } | null> }>(
    '@diamondcoreprocessor.com/LlmContext',
  )
  if (!service?.project) return read
  const projected = await service.project(read.layerSig).catch(() => null)
  if (!projected?.text) return read
  const { content: _content, ...rest } = read
  return { ...rest, projection: projected.text }
}

export const executeHypercombObservationPlan = async (
  plan: HypercombObservationPlan,
  reader: HypercombTreeReader,
  options: {
    readonly maxDepth?: number
    readonly maxNodes?: number
    readonly maxBytes?: number
    readonly signal?: AbortSignal
  } = {},
): Promise<HypercombObservationReceipt> => {
  const maxDepth = Math.max(0, Math.min(3, Math.floor(options.maxDepth ?? 2)))
  const maxNodes = Math.max(1, Math.min(64, Math.floor(options.maxNodes ?? 48)))
  const maxBytes = Math.max(1_024, Math.min(12_000, Math.floor(options.maxBytes ?? 8_000)))
  const results: Array<{ grammar: string } & HypercombRead> = []
  const snapshots: string[] = []

  for (const observation of plan.observations) {
    if (options.signal?.aborted) {
      throw new DOMException('The Hypercomb tree read was stopped', 'AbortError')
    }
    const { grammar, verb, segments, sig, query, from } = observation
    const root = verb === 'code' ? 'code' : sig ? sig : segments.length ? `/${segments.join('/')}` : '/'
    // OPEN WHAT A SIGNATURE NAMES (Jaime, 2026-09-13: "open and review every
    // resource and including the code"): a sig that is no layer is a module,
    // a dependency or a resource, and its bytes come back a page at a time.
    const openBytes = async (start: number): Promise<HypercombBytesRead> => {
      if (!reader.readBytesBySig) throw new HypercombObservationError('this hive cannot open resources or code by signature')
      return safeBytes(await reader.readBytesBySig(sig!, { from: start, maxBytes, signal: options.signal }), root, maxBytes)
    }
    if (verb === 'code') {
      if (!reader.listCode) throw new HypercombObservationError('this hive cannot list its code')
      const read = safeCode(await reader.listCode(query ?? '', { maxEntries: CODE_ENTRIES, signal: options.signal }), root, CODE_ENTRIES)
      results.push({ grammar, kind: 'code', read })
    } else if (sig && verb === 'read' && (from ?? 0) > 0) {
      results.push({ grammar, kind: 'bytes', read: await openBytes(from!) })
    } else if (sig) {
      if (!reader.readNodeBySig) throw new HypercombObservationError(`this hive cannot answer /${verb} by signature`)
      const read = safeNode(await reader.readNodeBySig(sig, {
        maxBytes, withContent: verb === 'read', signal: options.signal,
      }), root, maxNodes)
      const notALayer = !read.ok && (read.code === 'not-found' || read.code === 'incomplete-read')
      if (verb === 'read' && notALayer && reader.readBytesBySig) {
        results.push({ grammar, kind: 'bytes', read: await openBytes(0) })
      } else {
        results.push({ grammar, kind: 'node', read: verb === 'read' ? await withProjection(read) : read })
      }
    } else if (verb === 'find') {
      if (!reader.find) throw new HypercombObservationError('this hive cannot answer /find')
      const read = safeFind(await reader.find(query ?? '', segments, { maxNodes, signal: options.signal }), root, maxNodes)
      results.push({ grammar, kind: 'find', read })
      if (read.ok) snapshots.push(read.snapshot)
    } else if (verb === 'tree') {
      const read = safeRead(await reader.readTree(segments, {
        maxDepth, maxNodes, maxBytes, signal: options.signal,
      }), root, maxNodes)
      results.push({ grammar, kind: 'tree', read })
      if (read.ok) snapshots.push(read.snapshot)
    } else if (verb === 'history') {
      if (!reader.readHistory) throw new HypercombObservationError('this hive cannot answer /history')
      const read = safeHistory(await reader.readHistory(segments, { limit: 12, signal: options.signal }), root)
      results.push({ grammar, kind: 'history', read })
    } else if (verb === 'summary') {
      if (!reader.readSummary) throw new HypercombObservationError('this hive cannot answer /summary')
      const read = safeSummary(await reader.readSummary(segments, { maxBytes, signal: options.signal }), root)
      results.push({ grammar, kind: 'summary', read })
    } else {
      if (!reader.readNode) throw new HypercombObservationError(`this hive cannot answer /${verb}`)
      const read = safeNode(await reader.readNode(segments, {
        maxBytes, withContent: verb === 'read', signal: options.signal,
      }), root, maxNodes)
      results.push({ grammar, kind: 'node', read: verb === 'read' ? await withProjection(read) : read })
      if (read.ok && read.snapshot) snapshots.push(read.snapshot)
    }
  }
  const signatures: { grammar: string; sig: string }[] = []
  for (const result of results) {
    if (result.kind === 'node' && result.read.ok) signatures.push({ grammar: result.grammar, sig: result.read.layerSig })
    else if (result.kind === 'summary' && result.read.ok) signatures.push({ grammar: result.grammar, sig: result.read.layerSig })
    else if (result.kind === 'bytes' && result.read.ok) signatures.push({ grammar: result.grammar, sig: result.read.sig })
  }
  return { results, snapshots, signatures }
}

const safeFind = (read: HypercombFindRead, expectedRoot: string, maxMatches: number): HypercombFindRead => {
  if (!read || read.root !== expectedRoot) {
    throw new HypercombObservationError('the hive reader returned a mismatched root')
  }
  if (!read.ok) return { ok: false, root: expectedRoot, code: String(read.code || 'unavailable') }
  if (typeof read.snapshot !== 'string' || !read.snapshot || read.snapshot.length > 128
    || typeof read.query !== 'string' || !Array.isArray(read.matches) || read.matches.length > maxMatches) {
    throw new HypercombObservationError('the hive reader returned malformed find data')
  }
  const matches = read.matches.map(match => {
    if (!safeName(match?.name) || !match.name || typeof match?.path !== 'string' || !match.path.startsWith('/')
      || match.path.length > 2_000 || CONTROL_CHARACTER.test(match.path)) {
      throw new HypercombObservationError('the hive reader returned a malformed match')
    }
    return { name: match.name, path: match.path }
  })
  return { ok: true, root: expectedRoot, query: read.query, matches, truncated: read.truncated === true, snapshot: read.snapshot }
}

const safeName = (name: unknown): name is string =>
  typeof name === 'string' && name.length <= MAX_SEGMENT_LENGTH && !CONTROL_CHARACTER.test(name)

const BYTE_KINDS = new Set(['resource', 'bee', 'dependency'])

const safeBytes = (read: HypercombBytesRead, expectedRoot: string, maxBytes: number): HypercombBytesRead => {
  if (!read || read.root !== expectedRoot) {
    throw new HypercombObservationError('the hive reader returned a mismatched root')
  }
  if (!read.ok) return { ok: false, root: expectedRoot, code: String(read.code || 'unavailable') }
  if (!SIG.test(read.sig) || !BYTE_KINDS.has(read.of) || typeof read.type !== 'string' || read.type.length > 128
    || CONTROL_CHARACTER.test(read.type) || !Number.isInteger(read.size) || read.size < 0
    || !Number.isInteger(read.from) || read.from < 0
    || (read.text !== undefined && (typeof read.text !== 'string' || read.text.length > maxBytes))
    || (read.next !== undefined && (!Number.isInteger(read.next) || read.next <= read.from))) {
    throw new HypercombObservationError('the hive reader returned malformed resource data')
  }
  return {
    ok: true, root: expectedRoot, sig: read.sig, of: read.of, type: read.type, size: read.size, from: read.from,
    ...(read.text !== undefined ? { text: read.text } : {}),
    truncated: read.truncated === true,
    ...(read.next !== undefined ? { next: read.next } : {}),
  }
}

const safeCode = (read: HypercombCodeRead, expectedRoot: string, maxEntries: number): HypercombCodeRead => {
  if (!read || read.root !== expectedRoot) {
    throw new HypercombObservationError('the hive reader returned a mismatched root')
  }
  if (!read.ok) return { ok: false, root: expectedRoot, code: String(read.code || 'unavailable') }
  if (typeof read.query !== 'string' || !Array.isArray(read.entries) || read.entries.length > maxEntries
    || !Number.isInteger(read.total) || read.total < read.entries.length) {
    throw new HypercombObservationError('the hive reader returned malformed code data')
  }
  const entries = read.entries.map(entry => {
    if (!safeName(entry?.name) || !entry.name || !SIG.test(entry?.sig) || (entry.of !== 'bee' && entry.of !== 'dependency')) {
      throw new HypercombObservationError('the hive reader returned a malformed code entry')
    }
    return { name: entry.name, sig: entry.sig, of: entry.of }
  })
  return { ok: true, root: expectedRoot, query: read.query, entries, total: read.total, truncated: read.truncated === true }
}

const safeNode = (read: HypercombNodeRead, expectedRoot: string, maxChildren: number): HypercombNodeRead => {
  if (!read || read.root !== expectedRoot) {
    throw new HypercombObservationError('the hive reader returned a mismatched root')
  }
  if (!read.ok) return { ok: false, root: expectedRoot, code: String(read.code || 'unavailable') }
  const snapshotOk = read.snapshot === undefined
    || (typeof read.snapshot === 'string' && !!read.snapshot && read.snapshot.length <= 128)
  const projectionOk = read.projection === undefined
    || (typeof read.projection === 'string' && read.projection.length > 0
      && read.projection.length <= MAX_PROJECTION_LENGTH && !CONTROL_CHARACTER.test(read.projection.replace(/\n/g, '')))
  if (!snapshotOk || !projectionOk
    || !safeName(read.name) || !read.name || !SIG.test(read.layerSig)
    || !Array.isArray(read.children) || read.children.length > Math.max(maxChildren, 1_000)) {
    throw new HypercombObservationError('the hive reader returned malformed node data')
  }
  const children = read.children.map(child => {
    if (!safeName(child?.name) || !SIG.test(child?.sig)) {
      throw new HypercombObservationError('the hive reader returned a malformed child')
    }
    return { name: child.name, sig: child.sig }
  })
  const unresolved = read.unresolved === undefined ? [] : read.unresolved
  if (!Array.isArray(unresolved) || unresolved.length > 1_000 || unresolved.some(sig => !SIG.test(sig))) {
    throw new HypercombObservationError('the hive reader returned malformed unresolved children')
  }
  return {
    ok: true,
    root: expectedRoot,
    name: read.name,
    layerSig: read.layerSig,
    children,
    ...(unresolved.length ? { unresolved: [...unresolved] } : {}),
    ...(read.projection !== undefined
      ? { projection: read.projection, truncated: read.truncated === true }
      : read.content && typeof read.content === 'object' ? { content: read.content, truncated: read.truncated === true } : {}),
    ...(read.snapshot ? { snapshot: read.snapshot } : {}),
  }
}

const safeSummary = (read: HypercombSummaryRead, expectedRoot: string): HypercombSummaryRead => {
  if (!read || read.root !== expectedRoot) {
    throw new HypercombObservationError('the hive reader returned a mismatched root')
  }
  if (!read.ok) return { ok: false, root: expectedRoot, code: String(read.code || 'unavailable') }
  if (!safeName(read.name) || !read.name || !SIG.test(read.layerSig) || typeof read.text !== 'string'
    || !read.text || read.text.length > 4_000 || CONTROL_CHARACTER.test(read.text.replace(/\n/g, ''))
    || typeof read.model !== 'string' || read.model.length > 128) {
    throw new HypercombObservationError('the hive reader returned malformed summary data')
  }
  return { ok: true, root: expectedRoot, name: read.name, layerSig: read.layerSig, model: read.model, text: read.text, minted: read.minted === true }
}

const safeHistory = (read: HypercombHistoryRead, expectedRoot: string): HypercombHistoryRead => {
  if (!read || read.root !== expectedRoot) {
    throw new HypercombObservationError('the hive reader returned a mismatched root')
  }
  if (!read.ok) return { ok: false, root: expectedRoot, code: String(read.code || 'unavailable') }
  if (!Number.isInteger(read.total) || read.total < 0 || !Array.isArray(read.markers) || read.markers.length > 64) {
    throw new HypercombObservationError('the hive reader returned malformed history data')
  }
  const markers = read.markers.map(marker => {
    if (!Number.isInteger(marker?.index) || !SIG.test(marker?.layerSig) || !Number.isFinite(marker?.at)
      || !safeName(marker?.name)) {
      throw new HypercombObservationError('the hive reader returned a malformed marker')
    }
    return { index: marker.index, layerSig: marker.layerSig, at: marker.at, name: marker.name }
  })
  return { ok: true, root: expectedRoot, total: read.total, markers }
}

/** JSON keeps hostile labels data-shaped. Snapshot handles stay host-private. */
export const formatHypercombObservationReceipt = (
  receipt: HypercombObservationReceipt,
): string => JSON.stringify({
  kind: 'hypercomb-tree-observation',
  structureOnly: receipt.results.every(result => result.kind === 'tree'),
  observations: receipt.results.map(result => {
    const { grammar, read } = result
    if (!read.ok) return { grammar, root: read.root, error: read.code }
    if (result.kind === 'tree') {
      return { grammar, root: read.root, nodes: result.read.ok ? result.read.nodes : [], truncated: result.read.ok && result.read.truncated }
    }
    if (result.kind === 'history') {
      const history = result.read
      return history.ok ? { grammar, root: history.root, total: history.total, markers: history.markers } : { grammar, root: read.root, error: history.code }
    }
    if (result.kind === 'find') {
      const found = result.read
      return found.ok
        ? { grammar, root: found.root, query: found.query, matches: found.matches, truncated: found.truncated }
        : { grammar, root: read.root, error: found.code }
    }
    if (result.kind === 'summary') {
      const summary = result.read
      return summary.ok
        ? { grammar, root: summary.root, name: summary.name, sig: summary.layerSig, summary: summary.text, summarisedBy: summary.model, minted: summary.minted }
        : { grammar, root: read.root, error: summary.code }
    }
    if (result.kind === 'bytes') {
      const opened = result.read
      return opened.ok
        ? {
          grammar, root: opened.root, sig: opened.sig, of: opened.of, type: opened.type, size: opened.size, from: opened.from,
          ...(opened.text !== undefined ? { text: opened.text } : { text: null, note: 'not text; only its type and size can be shown' }),
          truncated: opened.truncated,
          ...(opened.next !== undefined ? { next: opened.next } : {}),
        }
        : { grammar, root: read.root, error: opened.code }
    }
    if (result.kind === 'code') {
      const listed = result.read
      return listed.ok
        ? { grammar, root: listed.root, query: listed.query, code: listed.entries, total: listed.total, truncated: listed.truncated }
        : { grammar, root: read.root, error: listed.code }
    }
    const node = result.read
    if (!node.ok) return { grammar, root: read.root, error: node.code }
    return {
      grammar, root: node.root, name: node.name, sig: node.layerSig, children: node.children,
      ...(node.unresolved?.length
        ? { unresolved: node.unresolved, unresolvedNote: 'children whose layers are not on this device yet; read <signature> may still open one' }
        : {}),
      ...(node.projection !== undefined
        ? { projection: node.projection, truncated: node.truncated === true }
        : node.content ? { content: node.content, truncated: node.truncated === true } : {}),
    }
  }),
})

