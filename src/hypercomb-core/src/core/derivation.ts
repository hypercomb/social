// hypercomb-core/src/core/derivation.ts
//
// DERIVATIONS (documentation/derivations.md) — one record for everything made
// from something else. This is the `minify` dialect's transform, in core so
// that every party runs the SAME code: the build that ships a published site's
// minified package (hypercomb-runtime minified-package.ts), the verifier
// anyone runs from a terminal (hypercomb-web verify-minified-package.mjs), and
// the hive's `derive verify` word. Two copies would have to stay byte-identical
// forever; one cannot drift.
//
// The tree is derived from the readable ROOT SIGNATURE ALONE: its layers are
// walked (cells), the modules they name are read, each body minified with its
// leading `//` lines kept byte for byte, and every layer re-hashed bottom-up.
// The root gains `derivedFrom` (the readable root) and `derivation` (the
// record: tool, options, every readable → minified pair). The record names the
// readable root, never the derived one — derived → record → readable, acyclic.
//
// The transform itself (`minify`) is passed in: a pinned esbuild on a machine,
// the same esbuild compiled to WebAssembly in a browser. A module it cannot
// handle, or that does not shrink, keeps its readable bytes and signature.

import { registerPoolMeaning } from './pool-registry.js'
import { SignatureService } from './signature.service.js'

const SIG_RE = /^[a-f0-9]{64}$/
const SIG_FILE_RE = /^([a-f0-9]{64})(\.js)?$/

/** What has been derived from one signature. A facet, addressed when a layer is derived. */
const DERIVED_PREFIX = 'derived:'
/** Which dialects exist. Seeded in the pool registry. */
export const DIALECTS_MEANING = 'derivation:dialects'

/** `derived:<signature>`, or null when the subject is not a signature. */
export const derivedMeaning = (inputSig: string): string | null => {
  const sig = String(inputSig ?? '').trim().toLowerCase()
  return SIG_RE.test(sig) ? `${DERIVED_PREFIX}${sig}` : null
}

/** A string signature, or the `sig` a `{ sig }` entry carries. Bare, or with `.js`. */
const cellSig = (entry: unknown): string => {
  const raw = typeof entry === 'string'
    ? entry
    : entry && typeof entry === 'object'
      ? String((entry as { sig?: unknown }).sig ?? '')
      : ''
  const bare = raw.replace(/\.js$/i, '').toLowerCase()
  return SIG_RE.test(bare) ? bare : ''
}

/** The layer fields that name modules; `dependencies` are the aliased ones. */
const BEE_FIELDS = ['bees', 'criticalBees', 'bootBees'] as const
const DEPENDENCY_FIELD = 'dependencies'

/** The transform, and exactly how it was run. */
export type DerivationTool = { readonly name: string; readonly options: Readonly<Record<string, unknown>> }
/** A module body in, its minified body out. Throwing keeps the module as is. */
export type MinifyBody = (body: string) => Promise<string>

export type MinifiedTree = {
  /** The derived root — its root layer's signature. */
  readonly root: string
  /** The readable package as walked from its root. */
  readonly readable: { readonly layers: readonly string[]; readonly bees: readonly string[]; readonly dependencies: readonly string[] }
  /** Every file the derivation adds: minified modules, rewritten layers, the record. */
  readonly files: ReadonlyMap<string, Uint8Array>
  /** The derivation record, by its signature. */
  readonly derivation: { readonly sig: string; readonly bytes: Uint8Array }
  /** readable → minified, for every module the transform changed. */
  readonly modules: ReadonlyMap<string, string>
  /** readable → derived, for every layer. */
  readonly layers: ReadonlyMap<string, string>
}

const encode = (text: string): Uint8Array => new TextEncoder().encode(text)
const signBytes = (bytes: Uint8Array): Promise<string> =>
  SignatureService.sign(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)

/** A module's leading `//` lines (alias, lazy marker, source path) and the
 *  rest. The head is kept byte for byte: an install reads lines 1 and 2. */
export const splitHead = (text: string): { head: string; body: string } => {
  let at = 0
  while (text.startsWith('//', at)) {
    const end = text.indexOf('\n', at)
    if (end < 0) return { head: text, body: '' }
    at = end + 1
  }
  return { head: text.slice(0, at), body: text.slice(at) }
}

/** Every signature a value names — strings and keys, bare or `.js` — through `map`. */
const remap = (value: unknown, map: ReadonlyMap<string, string>): unknown => {
  if (typeof value === 'string') {
    const hit = SIG_FILE_RE.exec(value)
    const to = hit ? map.get(hit[1]!) : undefined
    return to ? to + (hit![2] ?? '') : value
  }
  if (Array.isArray(value)) return value.map(item => remap(item, map))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      const hit = SIG_FILE_RE.exec(key)
      const to = hit ? map.get(hit[1]!) : undefined
      out[to ? to + (hit![2] ?? '') : key] = remap(item, map)
    }
    return out
  }
  return value
}

/** The readable package, from its root signature alone: its layers (cells),
 *  and the bees and dependencies they name. */
export const walkPackage = async (
  rootSig: string,
  read: (signature: string) => Promise<Uint8Array | null>,
): Promise<{ layers: string[]; bees: string[]; dependencies: string[]; parsed: Map<string, Record<string, unknown>> }> => {
  const layers: string[] = []
  const bees = new Set<string>()
  const dependencies = new Set<string>()
  const parsed = new Map<string, Record<string, unknown>>()
  const visit = async (sig: string, trail: ReadonlySet<string>): Promise<void> => {
    if (parsed.has(sig)) return
    if (trail.has(sig)) throw new Error(`layer cycle at ${sig.slice(0, 12)}`)
    const bytes = await read(sig)
    if (!bytes) throw new Error(`layer ${sig.slice(0, 12)} is not reachable`)
    const layer = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>
    parsed.set(sig, layer)
    layers.push(sig)
    for (const field of BEE_FIELDS) {
      for (const entry of Array.isArray(layer[field]) ? layer[field] as unknown[] : []) { const s = cellSig(entry); if (s) bees.add(s) }
    }
    for (const entry of Array.isArray(layer[DEPENDENCY_FIELD]) ? layer[DEPENDENCY_FIELD] as unknown[] : []) { const s = cellSig(entry); if (s) dependencies.add(s) }
    const next = new Set(trail).add(sig)
    for (const cell of Array.isArray(layer['cells']) ? layer['cells'] as unknown[] : []) {
      const child = cellSig(cell)
      if (child) await visit(child, next)
    }
  }
  await visit(rootSig, new Set())
  return { layers, bees: [...bees], dependencies: [...dependencies], parsed }
}

/** Layers re-hashed bottom-up. The root names its readable self and the record.
 *  A child named by a string or by `{ sig }` is rewritten before its parent. */
const rewriteDerivedLayers = async (
  rootSig: string,
  walked: { layers: readonly string[]; parsed: ReadonlyMap<string, Record<string, unknown>> },
  modules: ReadonlyMap<string, string>,
  derivationSig: string,
  files: Map<string, Uint8Array>,
): Promise<{ root: string; layers: Map<string, string> }> => {
  const layers = new Map<string, string>()
  const deriveLayer = async (sig: string): Promise<string> => {
    const done = layers.get(sig)
    if (done) return done
    const layer = walked.parsed.get(sig)!
    for (const cell of Array.isArray(layer['cells']) ? layer['cells'] as unknown[] : []) {
      const child = cellSig(cell)
      if (child && walked.parsed.has(child)) await deriveLayer(child)
    }
    const rewritten = remap(layer, new Map([...modules, ...layers])) as Record<string, unknown>
    const named = sig === rootSig ? { ...rewritten, derivedFrom: rootSig, derivation: derivationSig } : rewritten
    const out = encode(JSON.stringify(named))
    const to = await signBytes(out)
    layers.set(sig, to)
    files.set(to, out)
    return to
  }
  const root = await deriveLayer(rootSig)
  for (const sig of walked.layers) await deriveLayer(sig)
  return { root, layers }
}

/** Derive the minified tree of a readable package. `read` answers any file of
 *  the readable package by signature. The same walk derives one layer: pass
 *  that layer's signature. */
export const deriveMinifiedTree = async (
  rootSig: string,
  read: (signature: string) => Promise<Uint8Array | null>,
  minify: MinifyBody,
  tool: DerivationTool,
): Promise<MinifiedTree> => {
  const walked = await walkPackage(rootSig, read)
  const files = new Map<string, Uint8Array>()
  const modules = new Map<string, string>()
  const decoder = new TextDecoder()

  // 1. THE MODULES: the body minified, the head kept, renamed by its hash.
  for (const sig of [...walked.bees, ...walked.dependencies]) {
    if (modules.has(sig)) continue
    const bytes = await read(sig)
    if (!bytes) continue
    const { head, body } = splitHead(decoder.decode(bytes))
    let small: string
    try { small = await minify(body) } catch { continue }
    const out = encode(head + small)
    if (out.byteLength >= bytes.byteLength) continue
    const to = await signBytes(out)
    modules.set(sig, to)
    files.set(to, out)
  }

  // 2. THE RECORD — readable root, tool, every pair; never the derived root.
  const derivationBytes = encode(JSON.stringify({
    v: 1,
    kind: 'minify',
    from: rootSig,
    tool: tool.name,
    options: tool.options,
    modules: Object.fromEntries([...modules].sort(([a], [b]) => a.localeCompare(b))),
  }))
  const derivation = { sig: await signBytes(derivationBytes), bytes: derivationBytes }
  files.set(derivation.sig, derivationBytes)

  // 3. THE LAYERS, bottom-up: a child's new signature is known before its
  //    parent is rewritten, so the whole tree re-hashes to a new root.
  const { root, layers } = await rewriteDerivedLayers(rootSig, walked, modules, derivation.sig, files)

  return {
    root,
    readable: { layers: walked.layers, bees: walked.bees, dependencies: walked.dependencies },
    files, derivation, modules, layers,
  }
}

export type DerivedMembership = {
  /** `derived:<the readable signature>`. */
  readonly pool: string
  /** The derivation record. The pool's member is this signature. */
  readonly member: string
  /** `derivation:dialects`. */
  readonly dialects: typeof DIALECTS_MEANING
  /** The dialect record: kind, the transform's signature, the mode. */
  readonly dialect: string
  readonly dialectBytes: Uint8Array
}

/** The pool membership of one derivation. Registers both meanings for this
 *  session, so a root walk can tell the directories from lineage bags. */
export const derivedMembership = async (
  from: string,
  derivation: { readonly sig: string; readonly bytes: Uint8Array },
): Promise<DerivedMembership | null> => {
  const pool = derivedMeaning(from)
  if (!pool || !SIG_RE.test(derivation.sig)) return null
  let tool = ''
  try { tool = String((JSON.parse(new TextDecoder().decode(derivation.bytes)) as { tool?: unknown }).tool ?? '') } catch { return null }
  if (!tool) return null
  const dialectBytes = encode(JSON.stringify({ v: 1, kind: 'minify', tool, mode: 'reproduce' }))
  const dialect = await signBytes(dialectBytes)
  await registerPoolMeaning(pool)
  await registerPoolMeaning(DIALECTS_MEANING)
  return { pool, member: derivation.sig, dialects: DIALECTS_MEANING, dialect, dialectBytes }
}

/** Minify one layer. Ancestors of that layer are not rewritten. The record is
 *  the member of `derived:<that layer>`. */
export const deriveMinifiedLayer = async (
  layerSig: string,
  read: (signature: string) => Promise<Uint8Array | null>,
  minify: MinifyBody,
  tool: DerivationTool,
): Promise<MinifiedTree & { readonly membership: DerivedMembership }> => {
  const tree = await deriveMinifiedTree(layerSig, read, minify, tool)
  const membership = await derivedMembership(layerSig, tree.derivation)
  if (!membership) throw new Error('a layer signature is 64 hex')
  return { ...tree, membership }
}

/** The derived root, from the readable layers and the record's module map.
 *  No minifier. The result matches a derivation that used this map. */
export const remapMinifiedRoot = async (
  rootSig: string,
  read: (signature: string) => Promise<Uint8Array | null>,
  modules: ReadonlyMap<string, string>,
  derivationSig: string,
): Promise<string> => {
  const walked = await walkPackage(rootSig, read)
  const { root } = await rewriteDerivedLayers(rootSig, walked, modules, derivationSig, new Map())
  return root
}
