// hypercomb-runtime/src/module-drafts.ts
//
// THE SOURCE LIVES IN THE HIVE (jwize, 2026-09-21: "use the API endpoint,
// create new files and run them locally and then perhaps deploy them later";
// "all our context totally living in the hive"). A model reads a bee's code
// by signature, writes one source section back (module-sections.ts), and the
// hive makes the result RUN HERE — no repository, no editor, no build.
//
// A draft is three atoms and one pick:
//
//   the bee     the module with the section replaced      → bees pool
//   the layer   the package layer that named the old bee,
//               naming the new one instead                → root
//   the root    a record that says "a draft of trunk T at
//               path P", carrying T's dependencies        → root
//   the pick    { path P: layer, root } laid over the trunk (package-tree.ts)
//
// Everything is content-addressed, so nothing is overwritten: the old bee,
// the old layer and the trunk are all still there, and dropping the pick puts
// them back (unpickRevision). The pick is this browser's alone until a later
// act publishes it — that is the "deploy later" half, not built here.
//
// What is NOT checked: types and tests. A draft is judged by running it. The
// gates a pick already passes are passed again (applySelection): complete,
// runnable by this shell's core, nothing imported that the selection does not
// carry. A draft that fails them changes nothing.
//
// Modules already imported keep running until the page reloads — the
// activation record is what the loader reads at boot — so a draft that
// applied still needs one reload to run, and the outcome says so.

import { MODULE_DRAFTS_IOC_KEY, SignatureService, isSectionPath, registerPoolMeaning, replaceSection, sectionOf, type ModuleCommitOutcome, type ModuleDraftsProvider } from '@hypercomb/core'
import { applySelection, installedPackageSig, layersIoFor, unpickRevision, type SelectionOutcome } from './acquire.js'
import { HOST_PACKAGES_MEANING, formatMember, markerIndices, poolEntryName } from './host-pool.js'
import { readPicks, sigsOf, walkTree, type Picks, type TreeWalk } from './package-tree.js'
import type { ReplicationIo } from './replication-walker.js'

const SIG_RE = /^[a-f0-9]{64}$/
const STORE_KEY = '@hypercomb.social/Store'
/** One section a model writes back may not grow past this. */
export const MAX_DRAFT_BODY = 400_000

export type ModuleDraftRequest = {
  /** The bee to draft from — the module as it runs now. */
  readonly beeSig: string
  /** `src/games/solomon/labyrinth.ts` — the section to replace. */
  readonly section: string
  /** The section's new body, header line excluded. */
  readonly body: string
}

export type ModuleDraftOutcome =
  | {
    readonly ok: true
    /** The new module's signature — what `read <sig>` opens from now on. */
    readonly beeSig: string
    readonly layerSig: string
    readonly rootSig: string
    /** The package path the draft is picked at (`games/solomon`). */
    readonly path: string
    /** The running code is unchanged until the page reloads. */
    readonly reload: true
  }
  | { readonly ok: false; readonly error: string }

type StoreLike = {
  getBeeBytes?(sig: string): Promise<Uint8Array | null>
  writeBeeBytes?(sig: string, bytes: Uint8Array): Promise<void>
  writeLayerBytes?(sig: string, bytes: ArrayBuffer): Promise<void>
  readonly hypercombRoot?: FileSystemDirectoryHandle
}

/** This host's `host:packages` pool, as a commit appends to it. */
export type PackagePool = {
  /** Entry names held now. */
  names(): Promise<string[]>
  write(name: string, text: string): Promise<void>
}

/** Everything the draft door touches, so a spec can hand it a world. */
export type ModuleDraftDeps = {
  readonly trunk: () => string | null
  readonly store: () => StoreLike | undefined
  readonly layers: () => Promise<ReplicationIo | null>
  readonly picks: () => Picks
  readonly apply: (trunk: string, admitted: readonly string[], picks: Picks) => Promise<SelectionOutcome>
  readonly now: () => number
  /** The pool a commit publishes into; null when this shell holds none. */
  readonly pool: () => Promise<PackagePool | null>
}

const livePool = async (): Promise<PackagePool | null> => {
  const root = window.ioc?.get?.<StoreLike>(STORE_KEY)?.hypercombRoot
  if (!root) return null
  const dir = await root.getDirectoryHandle(await registerPoolMeaning(HOST_PACKAGES_MEANING), { create: true })
  return {
    names: async () => {
      const names: string[] = []
      for await (const name of (dir as unknown as { keys(): AsyncIterable<string> }).keys()) names.push(name)
      return names
    },
    write: async (name, text) => {
      const file = await dir.getFileHandle(name, { create: true })
      const writable = await file.createWritable()
      await writable.write(text)
      await writable.close()
    },
  }
}

const liveDeps = (): ModuleDraftDeps => ({
  trunk: installedPackageSig,
  store: () => window.ioc?.get?.<StoreLike>(STORE_KEY),
  layers: () => layersIoFor([]),
  picks: readPicks,
  apply: applySelection,
  now: Date.now,
  pool: livePool,
})

const encode = (text: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(text) as Uint8Array<ArrayBuffer>
const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes)
const sigOf = (bytes: Uint8Array<ArrayBuffer>): Promise<string> => SignatureService.sign(bytes.buffer)

/** The package node whose layer names this bee — the path the draft is picked at. */
const nodeNaming = (walk: TreeWalk, beeSig: string): TreeWalk['nodes'][number] | null =>
  walk.nodes.find(node => node.bees.includes(beeSig)) ?? null

type LayerRecord = { bees?: unknown; docs?: { bees?: Record<string, unknown> } & Record<string, unknown> } & Record<string, unknown>

/** The layer with one bee renamed, in both the list and its docs. The list
 *  entries keep the spelling they had (`<sig>.js` or bare). */
const renameBee = (record: LayerRecord, from: string, to: string): LayerRecord => {
  const bees = (Array.isArray(record.bees) ? record.bees : []).map(entry => {
    const text = typeof entry === 'string' ? entry : ''
    const bare = text.replace(/\.js$/, '').toLowerCase()
    return bare === from ? text.replace(from, to).replace(from.toUpperCase(), to) : entry
  })
  const docs = record.docs && typeof record.docs === 'object' ? { ...record.docs } : undefined
  if (docs?.bees && typeof docs.bees === 'object' && from in docs.bees) {
    const { [from]: doc, ...rest } = docs.bees
    docs.bees = { ...rest, [to]: doc }
  }
  return { ...record, bees, ...(docs ? { docs } : {}) }
}

/**
 * Write one section of one bee back and make it run here as a pick over the
 * trunk. Never throws for a refusal; the outcome says why.
 */
export const draftModule = async (request: ModuleDraftRequest, deps: ModuleDraftDeps = liveDeps()): Promise<ModuleDraftOutcome> => {
  const fail = (error: string): ModuleDraftOutcome => ({ ok: false, error })
  const beeSig = String(request.beeSig ?? '').trim().toLowerCase()
  if (!SIG_RE.test(beeSig)) return fail('a draft names the module by its 64-character signature')
  if (!isSectionPath(request.section)) return fail('a draft names one source section, like src/games/solomon/labyrinth.ts')
  if (typeof request.body !== 'string' || request.body.length > MAX_DRAFT_BODY) return fail(`the section body must be text under ${MAX_DRAFT_BODY} characters`)

  const trunk = deps.trunk()
  if (!trunk) return fail('nothing is installed here to draft onto — the dev shell imports modules directly and cannot take a draft')
  const store = deps.store()
  if (!store?.getBeeBytes || !store.writeBeeBytes || !store.writeLayerBytes) return fail('the store cannot hold a draft here')
  const io = await deps.layers()
  if (!io) return fail('the layers are not readable here')
  const local: ReplicationIo = { ...io, fetch: async () => null }

  // WHERE THE BEE LIVES in the selection as it runs now — picks included, so
  // a second draft of the same module lands on top of the first.
  const picks = deps.picks()
  const walk = await walkTree(trunk, local, picks)
  if (!walk.complete) return fail('the installed package cannot be walked here')
  const node = nodeNaming(walk, beeSig)
  if (!node) {
    return fail(walk.rootBees.includes(beeSig)
      ? 'that module sits on the package root, which has no path to pick at'
      : 'that signature is not a module of the installed package')
  }

  const held = await store.getBeeBytes(beeSig)
  if (!held) return fail('the module\'s bytes are not held here')
  const text = decode(held)
  if (!sectionOf(text, request.section)) return fail(`the module has no section ${request.section}; list <sig> names its sections`)
  const nextText = replaceSection(text, request.section, request.body)
  if (nextText === null) return fail('the section could not be replaced')
  const nextBytes = encode(nextText)
  const nextBeeSig = await sigOf(nextBytes)
  if (nextBeeSig === beeSig) return fail('the draft is byte-identical to the module it drafts from')

  const layerBytes = await local.read(node.layerSig)
  let record: LayerRecord
  try { record = JSON.parse(decode(layerBytes!)) as LayerRecord } catch { return fail(`the layer at ${node.path} could not be read`) }
  const nextLayerBytes = encode(JSON.stringify(renameBee(record, beeSig, nextBeeSig)))
  const nextLayerSig = await sigOf(nextLayerBytes)

  // THE DRAFT ROOT: the record a pick reads its namespace dependencies from.
  // It carries the trunk's, since a section edit changes no imports, and says
  // what it is so a listing can tell a draft from a publisher's revision.
  const trunkBytes = await local.read(trunk)
  let trunkRecord: { dependencies?: unknown } = {}
  try { trunkRecord = JSON.parse(decode(trunkBytes!)) as { dependencies?: unknown } } catch { return fail('the installed package record could not be read') }
  const at = deps.now()
  const rootBytes = encode(JSON.stringify({
    draft: { of: trunk, path: node.path, section: request.section, from: beeSig, at },
    dependencies: sigsOf(trunkRecord.dependencies),
  }))
  const rootSig = await sigOf(rootBytes)

  // WRITTEN, THEN MADE LIVE. Every atom is sig-named, so a draft that fails
  // the selection gates leaves only unreferenced bytes behind — content, not
  // state — and the running selection is exactly what it was.
  await store.writeBeeBytes(nextBeeSig, nextBytes)
  await store.writeLayerBytes(nextLayerSig, nextLayerBytes.buffer)
  await store.writeLayerBytes(rootSig, rootBytes.buffer)
  const outcome = await deps.apply(trunk, [nextBeeSig, nextLayerSig, rootSig], {
    ...picks,
    [node.path]: { layer: nextLayerSig, root: rootSig, hides: false, at },
  })
  if (!outcome.ok) return fail(outcome.error)
  return { ok: true, beeSig: nextBeeSig, layerSig: nextLayerSig, rootSig, path: node.path, reload: true }
}

export type ModuleDraft = {
  readonly path: string
  readonly layerSig: string
  readonly rootSig: string
  readonly section: string
  readonly from: string
  readonly at: number
}

/** The drafts picked over the trunk right now — picks whose root is a draft record. */
export const listDrafts = async (deps: Pick<ModuleDraftDeps, 'picks' | 'layers'> = liveDeps()): Promise<ModuleDraft[]> => {
  const io = await deps.layers()
  if (!io) return []
  const out: ModuleDraft[] = []
  for (const [path, pick] of Object.entries(deps.picks())) {
    try {
      const bytes = await io.read(pick.root)
      const record = bytes ? JSON.parse(decode(bytes)) as { draft?: { section?: unknown; from?: unknown; at?: unknown } } : null
      if (!record?.draft) continue
      out.push({
        path, layerSig: pick.layer, rootSig: pick.root,
        section: String(record.draft.section ?? ''), from: String(record.draft.from ?? ''),
        at: Number(record.draft.at) || pick.at,
      })
    } catch { /* not a draft, or not readable — not listed */ }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path))
}

/** Drop the draft at a path: the trunk's layer runs there again after a reload. */
export const dropDraft = (path: string): Promise<SelectionOutcome> => unpickRevision(path)

type CellRecord = { name?: unknown; cells?: unknown } & Record<string, unknown>

const bareSig = (entry: unknown): string => (typeof entry === 'string' ? entry : '').replace(/\.js$/, '').toLowerCase()

/**
 * COMMIT A DRAFT — "deploy later", from inside the hive (jwize, 2026-09-21:
 * "create new files and run them locally and then perhaps deploy them
 * later"). The pick at `path` stops being this browser's and becomes the
 * package: every layer from the trunk root down to the draft's parent is
 * re-minted naming the new child, the new root is appended to this host's
 * `host:packages` pool under `label` (the same member a build's publish
 * writes), and the selection is re-composed with the new root as the trunk.
 *
 * Nothing is overwritten: the old root and its chain stay held, and the pool
 * is append-only. Only a DRAFT commits — a revision picked from a publisher
 * already has one, and its dependencies are theirs to carry.
 *
 * Stamping the install channel so followers take it is the caller's act: the
 * signing key lives in essentials (hive-pointer.ts), not here.
 */
export const commitDraft = async (path: string, label: string, deps: ModuleDraftDeps = liveDeps()): Promise<ModuleCommitOutcome> => {
  const fail = (error: string): ModuleCommitOutcome => ({ ok: false, error })
  const trunk = deps.trunk()
  if (!trunk) return fail('nothing is installed here to commit onto')
  const picks = deps.picks()
  const pick = picks[path]
  if (!pick) return fail(`no draft is picked at ${path}`)
  const store = deps.store()
  if (!store?.writeLayerBytes) return fail('the store cannot hold a commit here')
  const io = await deps.layers()
  if (!io) return fail('the layers are not readable here')
  const read = async (sig: string): Promise<CellRecord | null> => {
    const bytes = await io.read(sig)
    if (!bytes) return null
    try { return JSON.parse(decode(bytes)) as CellRecord } catch { return null }
  }
  const root = await read(pick.root)
  if (!root?.['draft']) return fail(`the pick at ${path} is a publisher's revision, not a draft; it commits with theirs`)

  // THE CHAIN from the trunk root to the draft's parent, by name.
  const segments = path.split('/')
  const chain: { sig: string; record: CellRecord }[] = []
  let at = trunk
  for (const segment of segments) {
    const record = await read(at)
    if (!record) return fail(`the layer ${at.slice(0, 12)}… is not held here`)
    chain.push({ sig: at, record })
    let found = ''
    for (const child of sigsOf(record.cells)) {
      if (String((await read(child))?.name ?? '').trim() === segment) { found = child; break }
    }
    if (!found) return fail(`the installed package has no ${segments.slice(0, chain.length).join('/')}`)
    at = found
  }

  // RE-MINTED BOTTOM-UP: each parent names the new child where it named the old.
  const minted: string[] = []
  let oldChild = at
  let newChild = pick.layer
  for (let i = chain.length - 1; i >= 0; i--) {
    const { record } = chain[i]!
    const cells = (Array.isArray(record.cells) ? record.cells : []).map(entry =>
      bareSig(entry) === oldChild ? (typeof entry === 'string' ? entry.replace(oldChild, newChild) : entry) : entry)
    const bytes = encode(JSON.stringify({ ...record, cells }))
    const sig = await sigOf(bytes)
    await store.writeLayerBytes(sig, bytes.buffer)
    minted.push(sig)
    oldChild = chain[i]!.sig
    newChild = sig
  }
  const rootSig = newChild

  // LIVE FIRST, PUBLISHED SECOND: a selection that fails to compose publishes nothing.
  const { [path]: _dropped, ...rest } = picks
  const outcome = await deps.apply(rootSig, minted, rest)
  if (!outcome.ok) return fail(outcome.error)

  const pool = await deps.pool()
  if (!pool) return fail(`the package runs here now, but this shell holds no ${HOST_PACKAGES_MEANING} pool to publish it into`)
  const index = (markerIndices(await pool.names()).pop() ?? -1) + 1
  await pool.write(poolEntryName(index), formatMember(rootSig, label))
  return { ok: true, rootSig, index }
}

// THE PORT. Registered under the key core declares, so a queen that imports
// core and nothing else can list, drop and commit drafts.
const provider: ModuleDraftsProvider = {
  list: () => listDrafts(),
  drop: async path => {
    const outcome = await dropDraft(path)
    return outcome.ok ? { ok: true } : { ok: false, error: outcome.error }
  },
  commit: (path, label) => commitDraft(path, label),
}
try {
  ;(globalThis as { ioc?: { register?: (k: string, v: unknown) => void } }).ioc?.register?.(MODULE_DRAFTS_IOC_KEY, provider)
} catch { /* no ioc in this environment — direct importers still work */ }
