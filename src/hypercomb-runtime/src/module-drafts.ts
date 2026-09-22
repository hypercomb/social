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
import { isOff, readPicks, sigsOf, walkTree, type Picks, type TreeWalk } from './package-tree.js'
import { readOffUnits, writeOffUnits } from './package-units.js'
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
  getDependencyBytes?(sig: string): Promise<Uint8Array | null>
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
  /** The paths this browser has turned off, and the write that replaces them. */
  readonly off: () => ReadonlySet<string>
  readonly setOff: (paths: readonly string[]) => void
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
  off: readOffUnits,
  setOff: paths => writeOffUnits(paths),
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
 * COMMIT WHAT RUNS HERE — "deploy later", from inside the hive (jwize,
 * 2026-09-21: "create new files and run them locally and then perhaps deploy
 * them later"; "if you turn something off it should be … not reachable" —
 * "roots can be there but not served").
 *
 * The selection this browser runs becomes the package: every DRAFT picked
 * over the trunk takes its path, and every path turned OFF is left out of the
 * new tree, so the published root no longer reaches it. Each layer that
 * changes is re-minted, from the leaves up to a new root; the new root is
 * appended to this host's `host:packages` pool under `label` (the member a
 * build's publish writes) and becomes the trunk here.
 *
 * Nothing is removed. The old root, its layers and every module stay held and
 * stay valid — a turned-off unit is unreachable from the new root, not gone,
 * and turning it back on is taking an older revision at its path. The pool is
 * append-only. A revision picked from a publisher is not committed: it stays
 * a pick over the new trunk, its dependencies theirs to carry.
 *
 * Stamping the install channel so followers take it is the caller's act: the
 * signing key lives in essentials (hive-pointer.ts), not here.
 */
export const commitSelection = async (label: string, deps: ModuleDraftDeps = liveDeps()): Promise<ModuleCommitOutcome> => {
  const fail = (error: string): ModuleCommitOutcome => ({ ok: false, error })
  const trunk = deps.trunk()
  if (!trunk) return fail('nothing is installed here to commit onto')
  const store = deps.store()
  if (!store?.writeLayerBytes) return fail('the store cannot hold a commit here')
  const writeLayer = store.writeLayerBytes.bind(store)
  const io = await deps.layers()
  if (!io) return fail('the layers are not readable here')
  const read = async (sig: string): Promise<CellRecord | null> => {
    const bytes = await io.read(sig)
    if (!bytes) return null
    try { return JSON.parse(decode(bytes)) as CellRecord } catch { return null }
  }

  // WHAT CHANGES: the drafts (picks whose root says it is a draft) and the paths turned off.
  const picks = deps.picks()
  const drafts = new Map<string, string>()
  const sections = new Map<string, { section: string; from: string }>()
  for (const [path, pick] of Object.entries(picks)) {
    const draft = (await read(pick.root))?.['draft'] as { section?: unknown; from?: unknown } | undefined
    if (!draft) continue
    drafts.set(path, pick.layer)
    sections.set(path, { section: String(draft.section ?? ''), from: String(draft.from ?? '') })
  }
  const off = new Set([...deps.off()].filter(path => !drafts.has(path)))
  if (!drafts.size && !off.size) return fail('nothing to commit: no draft is picked and nothing is turned off')
  const touches = (path: string): boolean =>
    [...drafts.keys(), ...off].some(changed => changed === path || changed.startsWith(`${path}/`))

  // THE MODULES THE DRAFTS RENAMED, and the modules the new root still
  // reaches. The root's render-priority hint (`criticalBees`) names bees by
  // sig, so it follows a rename and drops what the new root no longer
  // reaches; left alone it would name modules the package does not carry.
  const renames = new Map<string, string>()
  const walk = await walkTree(trunk, { ...io, fetch: async () => null })
  if (!walk.complete) return fail('the installed package cannot be walked here')
  for (const [path, layer] of drafts) {
    const before = walk.nodes.find(candidate => candidate.path === path)?.bees ?? []
    const after = sigsOf((await read(layer))?.['bees'])
    const gone = before.filter(sig => !after.includes(sig))
    const came = after.filter(sig => !before.includes(sig))
    if (gone.length === 1 && came.length === 1) renames.set(gone[0]!, came[0]!)
  }
  const kept = new Set([...walk.rootBees, ...walk.nodes.filter(node => !isOff(node.path, off)).flatMap(node => node.bees)])

  // RE-MINTED FROM THE LEAVES UP: a layer is written again only when something
  // beneath it changed; everything else keeps its signature.
  const minted: string[] = []
  const found = new Set<string>()
  const mint = async (sig: string, path: string): Promise<string> => {
    const record = await read(sig)
    if (!record) throw new Error(`the layer ${sig.slice(0, 12)}… is not held here`)
    const cells: unknown[] = []
    let changed = false
    for (const entry of Array.isArray(record.cells) ? record.cells : []) {
      const child = bareSig(entry)
      const name = String((await read(child))?.name ?? '').trim()
      const at = path ? `${path}/${name}` : name
      if (off.has(at)) { found.add(at); changed = true; continue }
      let next = child
      if (drafts.has(at)) { found.add(at); next = await mint(drafts.get(at)!, at) }
      else if (name && touches(at)) next = await mint(child, at)
      if (next !== child) changed = true
      cells.push(next === child || typeof entry !== 'string' ? entry : entry.replace(child, next))
    }
    const critical = !path && Array.isArray(record['criticalBees'])
      ? (record['criticalBees'] as unknown[]).flatMap(entry => {
        if (typeof entry !== 'string') return [entry]
        const bee = bareSig(entry)
        if (renames.has(bee)) return [entry.replace(bee, renames.get(bee)!)]
        return kept.has(bee) ? [entry] : []
      })
      : undefined
    if (critical && JSON.stringify(critical) !== JSON.stringify(record['criticalBees'])) changed = true
    if (!changed) return sig
    const bytes = encode(JSON.stringify({ ...record, cells, ...(critical ? { criticalBees: critical } : {}) }))
    const next = await sigOf(bytes)
    await writeLayer(next, bytes.buffer)
    minted.push(next)
    return next
  }
  let rootSig: string
  try { rootSig = await mint(trunk, '') } catch (error) { return fail(error instanceof Error ? error.message : 'the package could not be re-minted') }
  const missing = [...drafts.keys(), ...off].filter(path => !found.has(path))
  if (missing.length) return fail(`the installed package has no ${missing.join(', ')}`)

  // LIVE FIRST, PUBLISHED SECOND: a selection that fails to compose publishes
  // nothing. The committed drafts are part of the trunk now, so they are no
  // longer picks; the committed off paths no longer exist to be off.
  const rest = Object.fromEntries(Object.entries(picks).filter(([path]) => !drafts.has(path)))
  const outcome = await deps.apply(rootSig, minted, rest)
  if (!outcome.ok) return fail(outcome.error)
  deps.setOff([...deps.off()].filter(path => !off.has(path)))

  const pool = await deps.pool()
  if (!pool) return fail(`the package runs here now, but this shell holds no ${HOST_PACKAGES_MEANING} pool to publish it into`)
  const index = (markerIndices(await pool.names()).pop() ?? -1) + 1
  await pool.write(poolEntryName(index), formatMember(rootSig, label))
  return { ok: true, rootSig, index, atoms: await newAtoms(trunk, rootSig, io), files: await packageFiles(rootSig, io), drafts: [...drafts.keys()].sort(), off: [...off].sort(),
    // WHAT CHANGED, file by file: the section each draft wrote, the module it
    // was written into, and the module that replaced it — what a reviewer reads.
    changes: [...sections].sort(([a], [b]) => a.localeCompare(b)).map(([path, { section, from }]) => ({ path, section, from, to: renames.get(from) ?? '' })) }
}

/** The files the new package holds that the old one did not — layers, modules
 *  and namespace bundles — read from what is held here. The old package was
 *  replicated from a host, so everything it names is already served there;
 *  only these must be uploaded before a follower can take the new one. */
export const newAtoms = async (trunk: string, rootSig: string, io: ReplicationIo): Promise<string[]> => {
  const [old, next] = await Promise.all([packageFiles(trunk, io), packageFiles(rootSig, io)])
  return next.filter(sig => !old.includes(sig))
}

/** Every file a package holds — its layers, modules and namespace bundles —
 *  read from what is held here. A sandbox door serves a package whole, so a
 *  commit publishes all of it; the host skips what it already has. */
export const packageFiles = async (rootSig: string, io: ReplicationIo): Promise<string[]> => {
  const walk = await walkTree(rootSig, { ...io, fetch: async () => null })
  return [...new Set([...walk.layers, ...walk.rootBees, ...walk.rootDependencies, ...walk.nodes.flatMap(node => node.bees)])].sort()
}

/** The bytes this store holds for a signature: a layer at the root, or a
 *  module in the bees pool. */
const bytesOf = async (sig: string, deps: ModuleDraftDeps = liveDeps()): Promise<Uint8Array | null> => {
  if (!SIG_RE.test(sig)) return null
  const io = await deps.layers()
  const layer = await io?.read(sig).catch(() => null)
  if (layer) return layer
  const store = deps.store()
  return (await store?.getBeeBytes?.(sig).catch(() => null)) ?? (await store?.getDependencyBytes?.(sig).catch(() => null)) ?? null
}

// THE PORT. Registered under the key core declares, so a queen that imports
// core and nothing else can list, drop and commit drafts.
const provider: ModuleDraftsProvider = {
  list: () => listDrafts(),
  drop: async path => {
    const outcome = await dropDraft(path)
    return outcome.ok ? { ok: true } : { ok: false, error: outcome.error }
  },
  commit: label => commitSelection(label),
  offPaths: () => [...readOffUnits()].sort(),
  bytesOf: sig => bytesOf(sig),
}
try {
  ;(globalThis as { ioc?: { register?: (k: string, v: unknown) => void } }).ioc?.register?.(MODULE_DRAFTS_IOC_KEY, provider)
} catch { /* no ioc in this environment — direct importers still work */ }
