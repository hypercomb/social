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

import { SignatureService, isSectionPath, replaceSection, sectionOf } from '@hypercomb/core'
import { applySelection, installedPackageSig, layersIoFor, unpickRevision, type SelectionOutcome } from './acquire.js'
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
}

/** Everything the draft door touches, so a spec can hand it a world. */
export type ModuleDraftDeps = {
  readonly trunk: () => string | null
  readonly store: () => StoreLike | undefined
  readonly layers: () => Promise<ReplicationIo | null>
  readonly picks: () => Picks
  readonly apply: (trunk: string, admitted: readonly string[], picks: Picks) => Promise<SelectionOutcome>
  readonly now: () => number
}

const liveDeps = (): ModuleDraftDeps => ({
  trunk: installedPackageSig,
  store: () => window.ioc?.get?.<StoreLike>(STORE_KEY),
  layers: () => layersIoFor([]),
  picks: readPicks,
  apply: applySelection,
  now: Date.now,
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
