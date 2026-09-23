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
//
// THE DRAFT AUDIT (jwize, 2026-09-23: "a code safety audit so we can author
// our own new code in real time"). What IS checked before a draft can run is
// what it newly reaches: core code-reach.ts compares the section it replaces
// with the one it writes, and anything the new code reaches that the old did
// not — the network, stored data, secrets and keys, text run as code, a way
// out of the page, disguise — holds it in the brood (core flagInBrood) BEFORE
// the pick is made, so there is no reload at which it runs unread. Every
// draft is recorded there as your own code, which is where JEV's reading of
// it lands (essentials safety/brood-audit.ts auditDraft, on `module:drafted`);
// that reading may hold it too. Only the participant's hand lets held code
// run, and a commit never folds it.

import { EffectBus, MODULE_DRAFTS_IOC_KEY, SignatureService, flagInBrood, holdInBrood, isSectionPath, mayRunBee, newReaches, reachPhrase, registerPoolMeaning, replaceSection, sectionOf, type CodeReach, type ModuleCommitOutcome, type ModuleDraftsProvider } from '@hypercomb/core'
import { applySelection, installedPackageSig, layersIoFor, unpickRevision, type SelectionOutcome } from './acquire.js'
import { HOST_PACKAGES_MEANING, formatMember, markerIndices, poolEntryName } from './host-pool.js'
import { composeDependencies, isOff, namespaceOf, ownerOf, readPicks, sigsOf, walkTree, within, type Picks, type TreeWalk } from './package-tree.js'
import { readOffUnits, writeOffUnits } from './package-units.js'
import type { ReplicationIo } from './replication-walker.js'
import { encodeTransferPack, gzipBytes } from './transfer-pack.js'

const SIG_RE = /^[a-f0-9]{64}$/
const STORE_KEY = '@hypercomb.social/Store'
/** One section a model writes back may not grow past this. */
export const MAX_DRAFT_BODY = 400_000

export type ModuleDraftRequest = {
  /** The module to draft from, as it runs now: a bee, or a dependency — an
   *  atom (atomic-modules-plan.md, step 5) or a namespace bundle. */
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
    /** A bee's draft renames it in its layer; a dependency's draft swaps it in
     *  the pick's dependencies and leaves the layer as it was. */
    readonly of: 'bee' | 'dependency'
    readonly layerSig: string
    readonly rootSig: string
    /** The package path the draft is picked at (`games/solomon`). */
    readonly path: string
    /** The running code is unchanged until the page reloads. */
    readonly reload: true
    /** What the new section reaches that the old one did not. Non-empty: the
     *  draft is HELD in the brood and does not run until it is accepted. */
    readonly reaches: readonly CodeReach[]
  }
  | { readonly ok: false; readonly error: string }

type StoreLike = {
  getBeeBytes?(sig: string): Promise<Uint8Array | null>
  getDependencyBytes?(sig: string): Promise<Uint8Array | null>
  writeBeeBytes?(sig: string, bytes: Uint8Array): Promise<void>
  writeDependencyBytes?(sig: string, bytes: Uint8Array): Promise<void>
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
  /** May this module run here (core mayRunBee)? Code still held in the brood
   *  is never folded into a commit. Absent: everything may. */
  readonly mayRun?: (sig: string) => Promise<boolean>
  /** Record a draft in the brood BEFORE its pick is made — held when it
   *  newly reaches anything. Throws when a hold cannot be recorded. Absent: a
   *  draft that reaches nothing new applies, and one that does is refused. */
  readonly admit?: (draft: DraftAdmission) => Promise<void>
}

/** A draft about to be made live, as the brood records it. */
export type DraftAdmission = {
  readonly sig: string
  readonly from: string
  readonly section: string
  readonly path: string
  readonly reaches: readonly CodeReach[]
}

/** Every draft is your own code; one that newly reaches something is held
 *  for a reason until you accept it. */
const admitInBrood = async ({ sig, section, path, reaches }: DraftAdmission): Promise<void> => {
  const source = { kind: 'own' as const, how: `a draft of ${section} at ${path}` }
  if (reaches.length) await flagInBrood(sig, { by: 'scan', reason: `it newly reaches ${reachPhrase(reaches)}`, reaches }, source, section)
  else await holdInBrood(sig, source, section)
}

/** Record the draft; null when it may be made live, else why not. */
const admitDraft = async (deps: ModuleDraftDeps, draft: DraftAdmission): Promise<string | null> => {
  const refused = `it newly reaches ${reachPhrase(draft.reaches)} and could not be held for you to read first, so nothing was applied`
  if (!deps.admit) return draft.reaches.length ? refused : null
  try {
    await deps.admit(draft)
    return null
  } catch {
    return draft.reaches.length ? refused : null
  }
}

/** Tell the hive a draft landed — the reading (auditDraft) starts from here. */
const announce = (draft: DraftAdmission & { readonly of: 'bee' | 'dependency'; readonly at: number }): void => {
  try { EffectBus.emit('module:drafted', draft) } catch { /* nobody listening */ }
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
  mayRun: sig => mayRunBee(sig),
  admit: admitInBrood,
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
  // THE DEPENDENCIES A PICK AT `path` RUNS NOW: its own root's when a pick is
  // already there (so drafts at one path stack), else the trunk's.
  const trunkBytes = await local.read(trunk)
  let trunkRecord: { dependencies?: unknown } = {}
  try { trunkRecord = JSON.parse(decode(trunkBytes!)) as { dependencies?: unknown } } catch { return fail('the installed package record could not be read') }
  const dependenciesAt = async (path: string): Promise<string[] | null> => {
    const pick = picks[path]
    if (!pick) return sigsOf(trunkRecord.dependencies)
    try { return sigsOf((JSON.parse(decode((await local.read(pick.root))!)) as { dependencies?: unknown }).dependencies) } catch { return null }
  }

  const node = nodeNaming(walk, beeSig)
  if (!node) {
    if (walk.rootBees.includes(beeSig)) return fail('that module sits on the package root, which has no path to pick at')
    return draftDependency(request, beeSig, { deps, store, local, trunk, picks, walk, dependenciesAt })
  }

  const held = await store.getBeeBytes(beeSig)
  if (!held) return fail('the module\'s bytes are not held here')
  const text = decode(held)
  const replaced = sectionOf(text, request.section)
  if (!replaced) return fail(`the module has no section ${request.section}; list <sig> names its sections`)
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
  // It carries the ones this path runs now, since a section edit changes no
  // imports, and says what it is so a listing can tell a draft from a
  // publisher's revision.
  const dependencies = await dependenciesAt(node.path)
  if (!dependencies) return fail(`the pick at ${node.path} could not be read`)
  const at = deps.now()
  const rootBytes = encode(JSON.stringify({
    draft: { of: trunk, path: node.path, section: request.section, from: beeSig, to: nextBeeSig, kind: 'bee', at },
    dependencies,
  }))
  const rootSig = await sigOf(rootBytes)

  // AUDITED, WRITTEN, THEN MADE LIVE. The brood hears of the draft before
  // the pick exists, so the selection that makes it live already holds it
  // when it reaches anything new. Every atom is sig-named, so a draft that
  // fails the selection gates leaves only unreferenced bytes behind — content,
  // not state — and the running selection is exactly what it was.
  const admission: DraftAdmission = {
    sig: nextBeeSig, from: beeSig, section: request.section, path: node.path,
    reaches: newReaches(text.slice(replaced.from, replaced.to), request.body),
  }
  const refused = await admitDraft(deps, admission)
  if (refused) return fail(refused)
  await store.writeBeeBytes(nextBeeSig, nextBytes)
  await store.writeLayerBytes(nextLayerSig, nextLayerBytes.buffer)
  await store.writeLayerBytes(rootSig, rootBytes.buffer)
  const outcome = await deps.apply(trunk, [nextBeeSig, nextLayerSig, rootSig], {
    ...picks,
    [node.path]: { layer: nextLayerSig, root: rootSig, hides: false, at },
  })
  if (!outcome.ok) return fail(outcome.error)
  announce({ ...admission, of: 'bee', at })
  return { ok: true, beeSig: nextBeeSig, of: 'bee', layerSig: nextLayerSig, rootSig, path: node.path, reload: true, reaches: admission.reaches }
}

type DraftContext = {
  readonly deps: ModuleDraftDeps
  readonly store: StoreLike
  readonly local: ReplicationIo
  readonly trunk: string
  readonly picks: Picks
  readonly walk: TreeWalk
  readonly dependenciesAt: (path: string) => Promise<string[] | null>
}

/**
 * A DEPENDENCY IS DRAFTED WHERE ITS NAMESPACE LIVES (atomic-modules-plan.md,
 * step 5). An atom — or a namespace bundle — is not in any layer; the root
 * lists it, and a pick takes the dependencies under its path from its own
 * root. So the draft picks at the atom's directory: the layer there stays as
 * it runs, and the pick's root carries the same dependencies with this one
 * swapped. The bee that imports it is untouched and reaches the new atom
 * through the import map, which follows the selection.
 */
const draftDependency = async (request: ModuleDraftRequest, fromSig: string, context: DraftContext): Promise<ModuleDraftOutcome> => {
  const fail = (error: string): ModuleDraftOutcome => ({ ok: false, error })
  const { deps, store, local, trunk, picks, walk, dependenciesAt } = context
  const held = await store.getDependencyBytes?.(fromSig).catch(() => null)
  if (!held) return fail('that signature is not a module of the installed package')
  if (!store.writeDependencyBytes) return fail('the store cannot hold a draft of a dependency here')
  const ns = namespaceOf(held)
  if (!ns) return fail('that dependency names no namespace on its first line, so it has no path to pick at')

  // The pick that already owns the namespace, else the deepest layer above it.
  const owner = ownerOf(ns, walk.applied)
  const node = owner
    ? walk.nodes.find(candidate => candidate.path === owner)
    : walk.nodes.filter(candidate => within(ns, candidate.path)).sort((a, b) => b.path.length - a.path.length)[0]
  if (!node) return fail(`no layer of the installed package holds ${ns}`)
  const dependencies = await dependenciesAt(node.path)
  if (!dependencies) return fail(`the pick at ${node.path} could not be read`)
  if (!dependencies.includes(fromSig)) return fail(`that dependency is not what runs at ${node.path} now`)

  const text = decode(held)
  const replaced = sectionOf(text, request.section)
  if (!replaced) return fail(`the module has no section ${request.section}; list <sig> names its sections`)
  const nextText = replaceSection(text, request.section, request.body)
  if (nextText === null) return fail('the section could not be replaced')
  const nextBytes = encode(nextText)
  if (namespaceOf(nextBytes) !== ns) return fail('the draft changed the line that names the dependency')
  const nextSig = await sigOf(nextBytes)
  if (nextSig === fromSig) return fail('the draft is byte-identical to the module it drafts from')

  const at = deps.now()
  const rootBytes = encode(JSON.stringify({
    draft: { of: trunk, path: node.path, section: request.section, from: fromSig, to: nextSig, kind: 'dependency', at },
    dependencies: dependencies.map(sig => sig === fromSig ? nextSig : sig),
  }))
  const rootSig = await sigOf(rootBytes)

  const admission: DraftAdmission = {
    sig: nextSig, from: fromSig, section: request.section, path: node.path,
    reaches: newReaches(text.slice(replaced.from, replaced.to), request.body),
  }
  const refused = await admitDraft(deps, admission)
  if (refused) return fail(refused)
  await store.writeDependencyBytes(nextSig, nextBytes)
  await store.writeLayerBytes!(rootSig, rootBytes.buffer)
  const outcome = await deps.apply(trunk, [nextSig, rootSig], {
    ...picks,
    [node.path]: { layer: node.layerSig, root: rootSig, hides: false, at },
  })
  if (!outcome.ok) return fail(outcome.error)
  announce({ ...admission, of: 'dependency', at })
  return { ok: true, beeSig: nextSig, of: 'dependency', layerSig: node.layerSig, rootSig, path: node.path, reload: true, reaches: admission.reaches }
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

  // WHAT CHANGES: every pick that shapes what runs here — the drafts (picks
  // whose root says it is a draft), a trial taken by hand, a revision picked
  // in Packages — and the paths turned off. A pick that does not apply (a pick
  // above it hides it) changes nothing and is not folded. A pick whose code
  // still waits in the brood is not folded either — a draft the audit held
  // as much as a trial taken by hand: a commit publishes under this hive's
  // key, and code nobody here has accepted never rides out under it. It stays
  // a pick, and the outcome names it.
  const picks = deps.picks()
  const local: ReplicationIo = { ...io, fetch: async () => null }
  const shape = await walkTree(trunk, local, picks)
  if (!shape.complete) return fail('the selection names a layer that is not held here')
  const readNamespace = async (sig: string): Promise<string | null> =>
    namespaceOf((await store?.getDependencyBytes?.(sig).catch(() => null)) ?? null) || null
  const drafts = new Map<string, string>()
  const folded = new Map<string, string>()
  const sections = new Map<string, { section: string; from: string; to: string }>()
  const sources: { path: string; dependencies: string[] }[] = []
  const taken: { path: string; root: string }[] = []
  const held: string[] = []
  for (const path of shape.applied) {
    const pick = picks[path]!
    const root = await read(pick.root)
    const draft = root?.['draft'] as { section?: unknown; from?: unknown; to?: unknown } | undefined
    const dependencies = sigsOf(root?.['dependencies'])
    if (await stillHeld(pick.layer, path, dependencies, local, readNamespace, deps.mayRun)) { held.push(path); continue }
    if (draft) {
      drafts.set(path, pick.layer)
      sections.set(path, { section: String(draft.section ?? ''), from: String(draft.from ?? ''), to: String(draft.to ?? '') })
    } else {
      taken.push({ path, root: pick.root })
    }
    folded.set(path, pick.layer)
    sources.push({ path, dependencies })
  }
  const off = new Set([...deps.off()].filter(path => !folded.has(path)))
  if (!folded.size && !off.size) {
    return fail(held.length
      ? `nothing to commit: the code at ${held.join(', ')} still waits in the brood — accept it there first`
      : 'nothing to commit: no draft is picked and nothing is turned off')
  }
  const touches = (path: string): boolean =>
    [...folded.keys(), ...off].some(changed => changed === path || changed.startsWith(`${path}/`))

  // THE MODULES THE DRAFTS RENAMED, and the modules the new root still
  // reaches. The root's render-priority hint (`criticalBees`) and its boot
  // lane (`bootBees`) name bees by sig, so each follows a rename and drops
  // what the new root no longer reaches; left alone they would name modules
  // the package does not carry — and a boot bee left on its old sig would
  // load first and register first, so the draft's copy would never win.
  const renames = new Map<string, string>()
  const walk = await walkTree(trunk, local)
  if (!walk.complete) return fail('the installed package cannot be walked here')
  for (const [path, layer] of folded) {
    const before = walk.nodes.find(candidate => candidate.path === path)?.bees ?? []
    const after = sigsOf((await read(layer))?.['bees'])
    const gone = before.filter(sig => !after.includes(sig))
    const came = after.filter(sig => !before.includes(sig))
    if (gone.length === 1 && came.length === 1) renames.set(gone[0]!, came[0]!)
  }
  // What the new root reaches: the trunk with every folded pick laid in.
  const after = await walkTree(trunk, local, Object.fromEntries([...folded.keys()].map(path => [path, picks[path]!])))
  const kept = new Set([...after.rootBees, ...after.nodes.filter(node => !isOff(node.path, off)).flatMap(node => node.bees)])

  // THE DEPENDENCIES THE NEW ROOT LISTS are the ones this selection runs: the
  // trunk's, with every folded path taking its own from the root it was
  // picked from. A dependency draft changes no layer, only this list, so
  // without it the commit would publish the old atom.
  const composed = sources.length
    ? await composeDependencies(walk.rootDependencies, sources, [...folded.keys()], readNamespace)
    : walk.rootDependencies
  const dependenciesMoved = JSON.stringify([...composed].sort()) !== JSON.stringify([...walk.rootDependencies].sort())

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
      if (folded.has(at)) { found.add(at); next = await mint(folded.get(at)!, at) }
      else if (name && touches(at)) next = await mint(child, at)
      if (next !== child) changed = true
      cells.push(next === child || typeof entry !== 'string' ? entry : entry.replace(child, next))
    }
    const follow = (field: 'criticalBees' | 'bootBees'): unknown[] | undefined => !path && Array.isArray(record[field])
      ? (record[field] as unknown[]).flatMap(entry => {
        if (typeof entry !== 'string') return [entry]
        const bee = bareSig(entry)
        if (renames.has(bee)) return [entry.replace(bee, renames.get(bee)!)]
        return kept.has(bee) ? [entry] : []
      })
      : undefined
    const critical = follow('criticalBees')
    const boot = follow('bootBees')
    if (critical && JSON.stringify(critical) !== JSON.stringify(record['criticalBees'])) changed = true
    if (boot && JSON.stringify(boot) !== JSON.stringify(record['bootBees'])) changed = true
    // The root's dependency list, spelled as the trunk spells it (`<sig>.js`).
    const listed = Array.isArray(record['dependencies']) ? record['dependencies'] as unknown[] : []
    const suffix = typeof listed[0] === 'string' && listed[0].endsWith('.js') ? '.js' : ''
    const dependencies = !path && dependenciesMoved ? [...composed].sort().map(sig => `${sig}${suffix}`) : undefined
    if (dependencies) changed = true
    if (!changed) return sig
    const bytes = encode(JSON.stringify({ ...record, cells, ...(critical ? { criticalBees: critical } : {}), ...(boot ? { bootBees: boot } : {}), ...(dependencies ? { dependencies } : {}) }))
    const next = await sigOf(bytes)
    await writeLayer(next, bytes.buffer)
    minted.push(next)
    return next
  }
  let rootSig: string
  try { rootSig = await mint(trunk, '') } catch (error) { return fail(error instanceof Error ? error.message : 'the package could not be re-minted') }
  const missing = [...folded.keys(), ...off].filter(path => !found.has(path))
  if (missing.length) return fail(`the installed package has no ${missing.join(', ')}`)
  if (rootSig === trunk) return fail('nothing to commit: what runs here is already the package')

  // LIVE FIRST, PUBLISHED SECOND: a selection that fails to compose publishes
  // nothing. The folded picks are part of the trunk now, so they are no
  // longer picks; the committed off paths no longer exist to be off.
  const rest = Object.fromEntries(Object.entries(picks).filter(([path]) => !folded.has(path)))
  const outcome = await deps.apply(rootSig, minted, rest)
  if (!outcome.ok) return fail(outcome.error)
  deps.setOff([...deps.off()].filter(path => !off.has(path)))

  const pool = await deps.pool()
  if (!pool) return fail(`the package runs here now, but this shell holds no ${HOST_PACKAGES_MEANING} pool to publish it into`)
  const index = (markerIndices(await pool.names()).pop() ?? -1) + 1
  await pool.write(poolEntryName(index), formatMember(rootSig, label))
  return { ok: true, rootSig, index, atoms: await newAtoms(trunk, rootSig, io), files: await packageFiles(rootSig, io), drafts: [...drafts.keys()].sort(), off: [...off].sort(),
    taken: taken.sort((a, b) => a.path.localeCompare(b.path)), held: held.sort(),
    // WHAT CHANGED, file by file: the section each draft wrote, the module it
    // was written into, and the module that replaced it — what a reviewer reads.
    changes: [...sections].sort(([a], [b]) => a.localeCompare(b)).map(([path, { section, from, to }]) => ({ path, section, from, to: renames.get(from) ?? to })) }
}

/** Does a picked branch bring code that still waits in the brood? Its layer's
 *  modules, and the namespace bundles its root lists under the path. */
const stillHeld = async (
  layer: string, path: string, dependencies: readonly string[], io: ReplicationIo,
  readNamespace: (sig: string) => Promise<string | null>, mayRun?: (sig: string) => Promise<boolean>,
): Promise<boolean> => {
  if (!mayRun) return false
  const branch = await walkTree(layer, io)
  const modules = [...branch.rootBees, ...branch.nodes.flatMap(node => node.bees)]
  for (const sig of dependencies) {
    const ns = await readNamespace(sig)
    if (ns && within(ns, path)) modules.push(sig)
  }
  for (const sig of new Set(modules)) if (!(await mayRun(sig))) return true
  return false
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

/** A TRANSFER PACK of these files (transfer-pack.ts), minted in memory for a
 *  publish and never written into the hive. Complete or absent: null when
 *  any file is not held here or does not hash to its name, so a door never
 *  serves a pack that silently lacks part of the package. */
const PACK_READ_BATCH = 32

export const packFiles = async (
  files: readonly string[],
  deps: ModuleDraftDeps = liveDeps(),
): Promise<{ sig: string; bytes: Uint8Array } | null> => {
  try {
    const members: Array<[string, Uint8Array]> = []
    for (let at = 0; at < files.length; at += PACK_READ_BATCH) {
      const read = await Promise.all(files.slice(at, at + PACK_READ_BATCH).map(async sig => [sig, await bytesOf(sig, deps)] as const))
      for (const [sig, bytes] of read) {
        if (!bytes || (await SignatureService.sign(bytes.slice().buffer as ArrayBuffer)) !== sig) return null
        members.push([sig, bytes])
      }
    }
    if (!members.length) return null
    const bytes = await gzipBytes(encodeTransferPack(members))
    return { sig: await SignatureService.sign(bytes.buffer), bytes }
  } catch {
    return null
  }
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
  draft: async ({ sig, section, body }) => {
    const outcome = await draftModule({ beeSig: sig, section, body })
    return outcome.ok ? { ok: true, sig: outcome.beeSig, of: outcome.of, path: outcome.path, reaches: outcome.reaches } : { ok: false, error: outcome.error }
  },
  pack: files => packFiles(files),
}
try {
  ;(globalThis as { ioc?: { register?: (k: string, v: unknown) => void } }).ioc?.register?.(MODULE_DRAFTS_IOC_KEY, provider)
} catch { /* no ioc in this environment — direct importers still work */ }
