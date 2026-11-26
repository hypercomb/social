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

import { EffectBus, MODULE_DRAFTS_IOC_KEY, SignatureService, broodRecord, broodRecordOnDisk, flagInBrood, isSectionPath, mayRunBee, newReaches, reachPhrase, registerPoolMeaning, replaceSection, sectionIndex, sectionOf, type BroodRecord, type CarriedModuleDraft, type CodeReach, type DraftRestoreOutcome, type ModuleCommitOutcome, type ModuleDraftsProvider } from '@hypercomb/core'
import { applySelection, installedPackageSig, layersIoFor, unpickRevision, type SelectionOutcome } from './acquire.js'
import { HOST_PACKAGES_MEANING, formatMember, markerIndices, poolEntryName } from './host-pool.js'
import { composeDependencies, isOff, namespaceOf, ownerOf, readPicks, sigsOf, walkTree, within, type Picks, type TreeWalk } from './package-tree.js'
import { readOffUnits, writeOffUnits } from './package-units.js'
import type { ReplicationIo } from './replication-walker.js'
import { reminifyRegistered } from './reminify.js'
import { managedPage } from './chat-window/core/managed-page.js'
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
  /** OR the changes to make to the body as it runs now, each found exactly
   *  once. A model asked to change one line of a long section wrote the whole
   *  file, ran out of room, and left the block unclosed three times (jwize's
   *  drive session, 2026-10-01). When present, `body` is ignored. */
  readonly edits?: readonly SectionEdit[]
}

export type SectionEdit = { readonly find: string; readonly replace: string }

/** The section body with every edit made, or why it cannot be. Each `find`
 *  must occur exactly once in the body as it stands after the edits before
 *  it — an edit that matches twice is ambiguous, and one that matches
 *  nothing was written against code that is not running. */
export const applySectionEdits = (current: string, edits: readonly SectionEdit[]): { readonly body: string } | { readonly error: string } => {
  if (!edits.length) return { error: 'the write block has no edits' }
  let body = current
  for (const [index, edit] of edits.entries()) {
    const find = String(edit.find ?? '')
    if (!find.trim()) return { error: `edit ${index + 1} has nothing to find` }
    const at = body.indexOf(find)
    if (at < 0) return { error: `edit ${index + 1}: the text to find is not in the section as it runs now; read the section again and copy it exactly` }
    if (body.indexOf(find, at + 1) >= 0) return { error: `edit ${index + 1}: the text to find occurs more than once; include more of the lines around it` }
    body = body.slice(0, at) + String(edit.replace ?? '') + body.slice(at + find.length)
  }
  return { body }
}

/** A section's body as `replaceSection` takes it: the header line excluded. */
const bodyOf = (text: string, section: { readonly from: number; readonly to: number }): string =>
  text.slice(text.indexOf('\n', section.from) + 1, section.to)

/** The request with its body made, whichever way it was written. */
const withBody = (request: ModuleDraftRequest, current: string): ModuleDraftRequest | { readonly error: string } => {
  if (!request.edits) return request
  const made = applySectionEdits(current, request.edits)
  if ('error' in made) return made
  if (made.body.length > MAX_DRAFT_BODY) return { error: `the section body must be text under ${MAX_DRAFT_BODY} characters` }
  return { ...request, body: made.body }
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
    /** The file was new: a bee added to the folder, nothing renamed. */
    readonly created?: true
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
  /** Why the drafted module would not even parse, or undefined. Absent:
   *  nothing is checked. */
  readonly parseProblem?: (text: string, before?: string) => Promise<string | undefined>
  /** The brood record for a module (core broodRecord). Absent: nothing is
   *  known to be this hive's own draft, so nothing is carried or restored. */
  readonly held?: (sig: string) => Promise<BroodRecord | null>
  /** Hold a carried draft (core flagInBrood). Throws when it cannot. Absent:
   *  nothing is restored. */
  readonly hold?: typeof flagInBrood
  /** The record as stored, past the session copy (core broodRecordOnDisk).
   *  Absent: no hold can be proved, so nothing is restored. */
  readonly heldOnDisk?: (sig: string) => Promise<BroodRecord | null>
}

/**
 * DOES IT PARSE? A model's edit left a parenthesis open and the draft would
 * have stopped the whole game from loading on the next reload, with nothing
 * said until then (jwize's drive session, 2026-10-01).
 *
 * The browser's own parser answers, without running a line: the module's
 * import and export statements — one line each in a bundled module — are
 * blanked or unwrapped, `import.meta` becomes an object, and the rest is
 * handed to the async-function constructor, which parses and returns a
 * function that is never called. A module worker cannot answer this:
 * Chromium reports its parse errors with no message at all.
 *
 * The transform is a reading, not a parser, so it is held to the module it
 * drafts from: when the module running now does not pass the same reading,
 * the reading cannot speak for this module and the draft goes through as
 * before. Only a draft of a module that parsed, which no longer parses, is
 * refused.
 */
/** A bundler wraps a long import or export list over several lines; each
 *  statement becomes as many blank lines, so line numbers hold. */
const LISTED_STATEMENT = /^[ \t]*(?:import|export)[ \t]*(?:type[ \t]+)?\{[^}]*\}[ \t]*(?:from[ \t]*["'][^"'\n]+["'])?[ \t]*;?[ \t]*$/gm
const blanked = (statement: string): string => statement.replace(/[^\n]/g, '')

const asFunctionBody = (text: string): string => text.replace(LISTED_STATEMENT, blanked).split('\n').map(line => {
  if (/^\s*import\s[^;]*\bfrom\s*["'][^"']+["']\s*;?\s*$/.test(line) || /^\s*import\s*["'][^"']+["']\s*;?\s*$/.test(line)) return ''
  if (/^\s*export\s*\{[^}]*\}\s*(?:from\s*["'][^"']+["'])?\s*;?\s*$/.test(line)) return ''
  if (/^\s*export\s*\*\s*(?:as\s+\w+\s+)?from\s*["'][^"']+["']\s*;?\s*$/.test(line)) return ''
  return line
    .replace(/^(\s*)export\s+default\s+/, '$1void ')
    .replace(/^(\s*)export\s+(?=(?:var|let|const|function|class|async)\b)/, '$1')
}).join('\n').replace(/\bimport\.meta\b/g, '({})')

const bodyParseProblem = (text: string): string | undefined => {
  const AsyncFunction = Object.getPrototypeOf(async function () { /* constructor only */ }).constructor as new (body: string) => unknown
  try {
    new AsyncFunction(asFunctionBody(text))
    return undefined
  } catch (error) {
    return error instanceof SyntaxError ? `SyntaxError: ${error.message}` : undefined
  }
}

export const parseProblemAsBody = async (text: string, before?: string): Promise<string | undefined> => {
  const problem = bodyParseProblem(text)
  if (!problem) return undefined
  if (before !== undefined && bodyParseProblem(before)) return undefined
  return problem
}

/** A draft about to be made live, as the brood records it. */
export type DraftAdmission = {
  readonly sig: string
  readonly from: string
  readonly section: string
  readonly path: string
  readonly reaches: readonly CodeReach[]
}

/** WHY AN UNTRIED DRAFT WAITS — the reason every draft carries until a hand rules. */
export const UNTRIED_REASON = 'a model wrote it and nobody has tried it yet: commit it to a trial, try it there, then accept it here'

/** WHY IT WAITS ON A MANAGED SITE PAGE. That page has no trial and no try-
 *  address (core managedRule: "the card on this page is where it is seen"),
 *  so the reason a hive gives sent the owner to a door that page does not
 *  have. There, the draft waits only for the owner's reading and hand. */
export const UNACCEPTED_REASON = 'a model wrote it on this page and you have not accepted it yet: read it, then accept it to let it run after a reload, or refuse it'

/** The reason a draft that reaches nothing new is held, for this page. */
export const untriedReason = (onManagedPage: boolean = !!managedPage()): string =>
  onManagedPage ? UNACCEPTED_REASON : UNTRIED_REASON

/** EVERY DRAFT IS HELD UNTIL YOU ACCEPT IT (jwize, 2026-10-26: "I have to
 *  decide whether to accept the changes always" · "there is no bot accepting
 *  going live in the hive" · "it is a human door"). A draft used to run here
 *  at once unless the scan found it newly reaching something; now it is
 *  flagged either way, and a flag clears only by a ruling, which only the
 *  participant's hand makes (`brood accept`, a word no machine may say). It
 *  still rides into a trial (commitSelection), which is where it is tried. */
const admitInBrood = async ({ sig, section, path, reaches }: DraftAdmission): Promise<void> => {
  const source = { kind: 'own' as const, how: `a draft of ${section} at ${path}` }
  if (reaches.length) await flagInBrood(sig, { by: 'scan', reason: `it newly reaches ${reachPhrase(reaches)}`, reaches }, source, section)
  else await flagInBrood(sig, { by: 'trial', reason: untriedReason() }, source, section)
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
  parseProblem: parseProblemAsBody,
  held: broodRecord,
  hold: flagInBrood,
  heldOnDisk: broodRecordOnDisk,
})

/** The refusal for a draft that does not parse, or null. */
const unparsable = async (deps: ModuleDraftDeps, text: string, before: string, section: string): Promise<string | null> => {
  const problem = await deps.parseProblem?.(text, before).catch(() => undefined)
  return problem
    ? `the drafted module does not parse, so nothing was written: ${problem}. Read ${section} again and fix the edit (an unbalanced bracket or a missing comma is the usual cause)`
    : null
}

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
  if (!request.edits && (typeof request.body !== 'string' || request.body.length > MAX_DRAFT_BODY)) return fail(`the section body must be text under ${MAX_DRAFT_BODY} characters`)

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
  if (!replaced) {
    // A SECTION THE MODULE DOES NOT HAVE IS A NEW FILE (jwize, 2026-10-21:
    // "why can't we add the import once in the folder"). The folder is the
    // layer, and the layer names its bees, so a new file is a new bee
    // appended to the layer beside the module that was named — the same
    // act as a rename, one entry longer.
    if (request.edits) return fail(`the module has no section ${request.section} to edit; to add it as a new file, write its whole text`)
    return draftNewBee(request, beeSig, text, node, { deps, store, local, trunk, picks, walk, dependenciesAt })
  }
  const made = withBody(request, bodyOf(text, replaced))
  if ('error' in made) return fail(made.error)
  request = made
  const nextText = replaceSection(text, request.section, request.body)
  if (nextText === null) return fail('the section could not be replaced')
  const broken = await unparsable(deps, nextText, text, request.section)
  if (broken) return fail(broken)
  const nextBytes = encode(nextText)
  const nextBeeSig = await sigOf(nextBytes)
  if (nextBeeSig === beeSig) return fail('the draft is byte-identical to the module it drafts from')
  if (runsInWalk(walk, nextBeeSig)) return fail('a module with exactly this text already runs elsewhere in the package')

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
 * A NEW FILE IN THE FOLDER. The body is a whole module of its own — it must
 * import only what the import map carries (`@hypercomb/core`, the namespace
 * bundles) — headed by its section line so `read <sig> <section>` opens it.
 * It becomes a new bee appended to the layer that names `besideSig`, with
 * nothing renamed: the folder gained a file. Everything the new code reaches
 * is new, so the brood reads all of it before it runs.
 */
const draftNewBee = async (request: ModuleDraftRequest, besideSig: string, besideText: string, node: TreeWalk['nodes'][number], context: DraftContext): Promise<ModuleDraftOutcome> => {
  const fail = (error: string): ModuleDraftOutcome => ({ ok: false, error })
  const { deps, store, local, trunk, picks, dependenciesAt } = context
  if (!request.body.trim()) return fail(`the module has no section ${request.section}, and the body is empty, so there is nothing to add`)
  if (sectionIndex(request.body).length) return fail('a new file carries no section headers of its own; write its text without a `// src/…` line')
  const text = `// ${request.section}\n${request.body.replace(/\s+$/, '')}\n`
  const broken = await unparsable(deps, text, '', request.section)
  if (broken) return fail(broken.replace(`Read ${request.section} again and fix the edit`, 'Fix the file'))
  const bytes = encode(text)
  const sig = await sigOf(bytes)
  if (node.bees.includes(sig)) return fail('a module with exactly this text is already in the folder')
  if (runsInWalk(context.walk, sig)) return fail('a module with exactly this text already runs elsewhere in the package')

  const layerBytes = await local.read(node.layerSig)
  let record: LayerRecord
  try { record = JSON.parse(decode(layerBytes!)) as LayerRecord } catch { return fail(`the layer at ${node.path} could not be read`) }
  const nextLayerBytes = encode(JSON.stringify(appendBee(record, besideSig, sig, text)))
  const nextLayerSig = await sigOf(nextLayerBytes)

  const dependencies = await dependenciesAt(node.path)
  if (!dependencies) return fail(`the pick at ${node.path} could not be read`)
  const at = deps.now()
  const rootBytes = encode(JSON.stringify({
    draft: { of: trunk, path: node.path, section: request.section, from: '', to: sig, beside: besideSig, kind: 'bee', at },
    dependencies,
  }))
  const rootSig = await sigOf(rootBytes)

  const admission: DraftAdmission = { sig, from: '', section: request.section, path: node.path, reaches: newReaches('', text) }
  const refused = await admitDraft(deps, admission)
  if (refused) return fail(refused)
  await store.writeBeeBytes!(sig, bytes)
  await store.writeLayerBytes!(nextLayerSig, nextLayerBytes.buffer)
  await store.writeLayerBytes!(rootSig, rootBytes.buffer)
  const outcome = await deps.apply(trunk, [sig, nextLayerSig, rootSig], {
    ...picks,
    [node.path]: { layer: nextLayerSig, root: rootSig, hides: false, at },
  })
  if (!outcome.ok) return fail(outcome.error)
  announce({ ...admission, of: 'bee', at })
  void besideText
  return { ok: true, beeSig: sig, of: 'bee', created: true, layerSig: nextLayerSig, rootSig, path: node.path, reload: true, reaches: admission.reaches }
}

/** The layer with one more bee, listed after `beside` in the spelling the
 *  list already uses, and a doc entry naming its class when the layer keeps
 *  docs — so the command line and the listing see the new file as they see
 *  every other. */
const appendBee = (record: LayerRecord, beside: string, sig: string, text: string): LayerRecord => {
  const list = Array.isArray(record.bees) ? record.bees : []
  const spelt = (entry: unknown): string => typeof entry === 'string' ? entry.replace(/\.js$/, '').toLowerCase() : ''
  const suffix = list.some(entry => typeof entry === 'string' && entry.endsWith('.js')) ? '.js' : ''
  const at = list.findIndex(entry => spelt(entry) === beside)
  const bees = [...list.slice(0, at + 1), `${sig}${suffix}`, ...list.slice(at + 1)]
  const docs = record.docs && typeof record.docs === 'object' ? { ...record.docs } : undefined
  if (docs?.bees && typeof docs.bees === 'object') {
    const className = /\bclass\s+([A-Za-z_$][\w$]*)/.exec(text)?.[1]
    docs.bees = { ...docs.bees, [sig]: className ? { className } : {} }
  }
  return { ...record, bees, ...(docs ? { docs } : {}) }
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
  const made = withBody(request, bodyOf(text, replaced))
  if ('error' in made) return fail(made.error)
  request = made
  const nextText = replaceSection(text, request.section, request.body)
  if (nextText === null) return fail('the section could not be replaced')
  const broken = await unparsable(deps, nextText, text, request.section)
  if (broken) return fail(broken)
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
  /** The module the draft wrote ('' when the record names none). */
  readonly to: string
  /** 'bee' (a section rewritten, or a new file: `from` is '') or 'dependency'. */
  readonly kind: string
  /** The trunk the draft was made over. */
  readonly of: string
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
      const record = bytes ? JSON.parse(decode(bytes)) as { draft?: DraftRecord } : null
      if (!record?.draft) continue
      out.push({
        path, layerSig: pick.layer, rootSig: pick.root,
        section: String(record.draft.section ?? ''), from: String(record.draft.from ?? ''),
        to: String(record.draft.to ?? ''), kind: String(record.draft.kind ?? ''), of: String(record.draft.of ?? ''),
        at: Number(record.draft.at) || pick.at,
      })
    } catch { /* not a draft, or not readable — not listed */ }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path))
}

/** Drop the draft at a path: the trunk's layer runs there again after a reload. */
export const dropDraft = (path: string): Promise<SelectionOutcome> => unpickRevision(path)

// HOME, HELD (jwize, 2026-11-20). Publish on a card carries the owner's
// drafts with it; where the card arrives on the owner's hive or another of his
// devices, each draft is put back HELD in the brood until he accepts it there.
// Visitors never run it, and acceptance never travels: the hold is written
// fresh on every device, and only that device's hand rules past it.

/** How a draft put back from a card is recorded in the brood: after its
 *  ordinary "a draft of …" words, so it still waits for the owner's hand
 *  (site-code-review.ts), and it can be told from work written here. */
const CARRIED_HOME = ', carried home with '

/** A brood record that says the module is a draft of this hive's own. */
const ownDraft = (record: BroodRecord | null | undefined): record is BroodRecord & { source: { how: string } } =>
  !!record && record.source.kind === 'own' && !!record.source.how?.startsWith('a draft of ')

/** The trunk's own walk, read from what is held here (no picks). */
const trunkWalk = async (deps: ModuleDraftDeps, trunk: string): Promise<TreeWalk | null> => {
  const io = await deps.layers()
  if (!io) return null
  const walk = await walkTree(trunk, { ...io, fetch: async () => null })
  return walk.complete ? walk : null
}

/** Canonical JSON: object keys sorted at every depth. */
const canonical = (value: unknown): string => JSON.stringify(value, (_key, v: unknown) =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
    : v)

/** A layer record with its modules (`bees`, `docs.bees`) left out, canonical:
 *  what a draft may not change in the trunk's layer it is laid over. */
const withoutModules = (record: LayerRecord): string => {
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('not a layer')
  const { bees: _bees, docs, ...rest } = record
  const otherDocs = docs && typeof docs === 'object' ? Object.fromEntries(Object.entries(docs).filter(([key]) => key !== 'bees')) : undefined
  return canonical({ ...rest, ...(otherDocs && Object.keys(otherDocs).length ? { docs: otherDocs } : {}) })
}

/** Does a walk already run this module, on its root or in any folder? A
 *  draft whose module is one of those would hold it, and stop it running
 *  there, with no hand having acted on it. */
const runsInWalk = (walk: TreeWalk, sig: string): boolean =>
  walk.rootBees.includes(sig) || walk.nodes.some(node => node.bees.includes(sig))

/** The modules a layer names that the trunk's layer at the same path does not. */
const partsOver = (named: readonly string[], node: TreeWalk['nodes'][number]): string[] =>
  [...new Set(named.filter(sig => !node.bees.includes(sig)))].sort()

/** The drafts a card may carry: this hive's own drafts over the trunk that
 *  runs here, whose modules the brood records as drafts of this hive's own
 *  and that no hand here refused. Unruled and accepted drafts both travel;
 *  the acceptance does not. A draft that came home with a card is marked
 *  `carried`.
 *
 *  A BEE DRAFT (a section rewritten, or a new file): a pick is a whole folder
 *  layer, so every module that layer names beyond the trunk's travels with it
 *  (`parts`): two drafts in one folder are one pick, and the earlier one's
 *  module must come home too. One whose root's dependencies are not the
 *  trunk's (written over a dependency draft at the same path) is not carried:
 *  it could not land anywhere (restoreDraft step 2).
 *
 *  A DEPENDENCY DRAFT, only when asked for (`dependencies: true`), marked
 *  `kind: 'dependency'`: its pick keeps the trunk's layer and swaps
 *  dependencies in its root, so its parts are every dependency that root
 *  lists beyond the trunk's — stacked swaps at one path travel together. Not
 *  asked for, none is given, so an older caller never puts one where an
 *  older reader settles it as tampered. */
export const carryableDrafts = async (deps: ModuleDraftDeps = liveDeps(), options: { readonly dependencies?: boolean } = {}): Promise<CarriedModuleDraft[]> => {
  const trunk = deps.trunk()
  if (!trunk || !deps.held) return []
  const walk = await trunkWalk(deps, trunk)
  const io = await deps.layers()
  if (!walk || !io) return []
  const trunkDependencies = new Set(walk.rootDependencies)
  const out: CarriedModuleDraft[] = []
  for (const draft of await listDrafts(deps)) {
    const isDependency = draft.kind === 'dependency'
    if (!(draft.kind === 'bee' || (isDependency && options.dependencies === true))) continue
    if (draft.of !== trunk || !SIG_RE.test(draft.to)) continue
    const node = walk.nodes.find(candidate => candidate.path === draft.path)
    if (!node) continue
    let rootDependencies: string[]
    try { rootDependencies = sigsOf((JSON.parse(decode((await io.read(draft.rootSig))!)) as { dependencies?: unknown }).dependencies) } catch { continue }
    let parts: string[]
    if (isDependency) {
      if (draft.layerSig !== node.layerSig) continue
      parts = [...new Set(rootDependencies.filter(sig => !trunkDependencies.has(sig)))].sort()
    } else {
      if (!sameSet(rootDependencies, walk.rootDependencies)) continue
      let named: string[]
      try { named = sigsOf((JSON.parse(decode((await io.read(draft.layerSig))!)) as LayerRecord).bees) } catch { continue }
      parts = partsOver(named, node)
    }
    if (!parts.includes(draft.to)) continue
    let carried = false
    let travels = true
    for (const part of parts) {
      const record = await deps.held(part).catch(() => null)
      if (!ownDraft(record) || record.ruling?.verdict === 'refused') { travels = false; break }
      if (part === draft.to && record.source.how.includes(CARRIED_HOME)) carried = true
    }
    if (!travels) continue
    out.push({
      root: draft.rootSig, layer: draft.layerSig, to: draft.to, from: draft.from, parts,
      ...(carried ? { carried: true as const } : {}), ...(isDependency ? { kind: 'dependency' as const } : {}),
    })
  }
  return out
}

/** The same signatures, in any order and with any repeats. */
const sameSet = (a: readonly string[], b: readonly string[]): boolean =>
  JSON.stringify([...new Set(a)].sort()) === JSON.stringify([...new Set(b)].sort())

type DraftRecord = { of?: unknown; path?: unknown; section?: unknown; from?: unknown; to?: unknown; kind?: unknown; at?: unknown }

/**
 * PUT ONE CARRIED DRAFT BACK, HELD. In this order, stopping at the first step
 * that fails:
 *
 *   1. it is a bee or a dependency draft whose parts hold together and hash
 *      to their names (else `tampered`; a part that could not be read is
 *      `incomplete`); a dependency draft names the module it was written
 *      from, and the module it wrote names the same namespace, inside its
 *      path;
 *   2. it was made over the trunk that runs here, and over nothing else (else
 *      `other-build`, nothing written; it comes back once Update all levels
 *      the trunks — or `older-build` when the draft's build is one this
 *      device holds but does not run: said once by the caller, and still
 *      tried again, since holding a build's layers never proves it ran here).
 *      A bee draft's root lists the trunk's dependencies. A dependency
 *      draft's root lists the trunk's with swaps only: every dependency it
 *      adds is a carried part inside its path, and takes the place of exactly
 *      one trunk dependency of the same namespace, and it leaves out no other;
 *   3. a bee draft's layer is the trunk's layer at its path with only carried
 *      modules added: every module it names that the trunk's does not is a
 *      part the card lists, and each is held below; every other field is the
 *      trunk layer's own (no child layer grafted in); and it leaves out no
 *      more trunk modules than it puts carried ones in, each one it leaves
 *      out being the module the draft was written from or one a carried
 *      module is a section rewrite of. A dependency draft's layer IS the
 *      trunk's layer at its path. Neither puts in a module the trunk already
 *      runs elsewhere (each else `tampered`);
 *   4. no hand here refused any of its modules, read from disk (`refused-here`,
 *      asked before the path: a refused draft settles, never `path-busy` or
 *      `present`); a hand here that accepted one stands, and it is not
 *      flagged again;
 *   5. its path is free here (`present` when this very draft is picked there).
 *      A pick there that this draft was written on top of, or one that itself
 *      came home with a card, gives way; any other pick is local work, which
 *      wins: `path-busy`;
 *   6. every module is HELD: flagged in the brood, with the scan's reasons or
 *      as untried, and the hold read back from disk (else `unheld`, and
 *      nothing is written: code is never put where a reload runs it on a hold
 *      that did not land);
 *   7. the bytes are written: only the modules the draft adds (into the bees
 *      pool, or the dependencies pool for a dependency draft), never the one
 *      a draft was written into; then a bee draft's layer, and the root; and
 *   8. the pick is made through every selection gate (`gate` when one refuses;
 *      the selection is left as it was). A held dependency waits as a held
 *      bee does: the selection leaves it out of the bag, and the import map's
 *      scans never map it (held-dependencies.ts), so the trunk's bundle for
 *      that namespace keeps running until a hand here accepts it.
 *
 * Never throws, and never writes a ruling.
 */
export const restoreDraft = async (
  carried: { readonly root: string; readonly layer: string },
  refs: readonly string[],
  bytes: (sig: string) => Promise<Uint8Array | null>,
  lineage: string,
  deps: ModuleDraftDeps = liveDeps(),
  siblings: ReadonlySet<string> = new Set(),
): Promise<DraftRestoreOutcome> => {
  try {
    const listed = new Set(refs)
    const { root, layer } = carried
    if (!SIG_RE.test(root) || !SIG_RE.test(layer) || !listed.has(root) || !listed.has(layer)) return 'tampered'
    // Every part is hashed to its name here: the reader's word is not taken for it.
    const part: HashedPart = async sig => {
      const held = await bytes(sig).catch(() => null)
      if (!held) return null
      const copy = new Uint8Array(held) as Uint8Array<ArrayBuffer>
      return (await sigOf(copy)) === sig ? copy : 'forged'
    }

    // 1. A DRAFT THAT HOLDS TOGETHER.
    const rootBytes = await part(root)
    if (rootBytes === 'forged') return 'tampered'
    if (!rootBytes) return 'incomplete'
    let rootRecord: { draft?: DraftRecord; dependencies?: unknown }
    try { rootRecord = JSON.parse(decode(rootBytes)) as { draft?: DraftRecord; dependencies?: unknown } } catch { return 'tampered' }
    const draft = rootRecord?.draft
    if (!draft || typeof draft !== 'object' || (draft.kind !== 'bee' && draft.kind !== 'dependency')) return 'tampered'
    const ofDependency = draft.kind === 'dependency'
    const of = String(draft.of ?? ''), path = String(draft.path ?? ''), section = String(draft.section ?? '')
    const from = String(draft.from ?? ''), to = String(draft.to ?? '')
    const at = Number(draft.at) || 0
    if (!SIG_RE.test(of) || !path || !isSectionPath(section) || !SIG_RE.test(to) || !listed.has(to)) return 'tampered'
    if (from && (!SIG_RE.test(from) || !listed.has(from))) return 'tampered'
    // A dependency draft is always written from a module: a namespace has no new file.
    if (ofDependency && !from) return 'tampered'
    const layerBytes = await part(layer)
    const toBytes = await part(to)
    const fromBytes = from ? await part(from) : null
    if (layerBytes === 'forged' || toBytes === 'forged' || fromBytes === 'forged') return 'tampered'
    if (!layerBytes || !toBytes || (from && !fromBytes)) return 'incomplete'
    let named: string[]
    try { named = sigsOf((JSON.parse(decode(layerBytes)) as LayerRecord).bees) } catch { return 'tampered' }
    if (!ofDependency && !named.includes(to)) return 'tampered'
    //    A dependency's first line names its namespace: the draft may not move
    //    it (draftDependency refuses that), nor carry it outside its path.
    if (ofDependency) {
      const ns = namespaceOf(toBytes)
      if (!ns || ns !== namespaceOf(fromBytes) || !within(ns, path)) return 'tampered'
    }
    const toText = decode(toBytes)
    const fromText = fromBytes ? decode(fromBytes) : ''
    const toSection = sectionOf(toText, section)
    if (!toSection || await unparsable(deps, toText, fromText, section)) return 'tampered'
    const fromSection = fromBytes ? sectionOf(fromText, section) : null
    if (fromBytes && !fromSection) return 'tampered'
    const reaches = fromSection ? newReaches(bodyOf(fromText, fromSection), bodyOf(toText, toSection)) : newReaches('', toText)

    // 2. THE TRUNK THAT RUNS HERE, and nothing laid over it. A build this
    //    device holds but does not run is said so (`older-build`); holding its
    //    layers never proves it ran here, so the caller tries it again.
    const trunk = deps.trunk()
    if (!trunk) return 'other-build'
    if (of !== trunk) return (await (await deps.layers())?.read(of).catch(() => null)) ? 'older-build' : 'other-build'
    const walk = await trunkWalk(deps, trunk)
    if (!walk) return 'incomplete'
    const rootDependencies = sigsOf(rootRecord.dependencies)
    const node = walk.nodes.find(candidate => candidate.path === path)
    const modules: HeldModule[] = [{ sig: to, bytes: toBytes, section, reaches }]
    if (ofDependency) {
      const swapped = await dependencySwaps(deps, walk, rootDependencies, to, path, listed, part)
      if (typeof swapped === 'string') return swapped
      // 3. THE TRUNK'S OWN LAYER: a dependency draft changes no folder.
      if (!node || layer !== node.layerSig) return 'tampered'
      if (swapped.some(added => runsInWalk(walk, added.sig))) return 'tampered'
      for (const added of swapped) {
        if (added.sig === to) continue
        const text = decode(added.bytes)
        if (await unparsable(deps, text, '', section)) return 'tampered'
        modules.push({ sig: added.sig, bytes: added.bytes, section: sectionIndex(text)[0]?.path ?? section, reaches: newReaches('', text) })
      }
    } else {
      if (!sameSet(rootDependencies, walk.rootDependencies)) return 'other-build'
      // 3. THE TRUNK'S LAYER, with only carried modules added.
      const shaped = await beeLayerOverTrunk(deps, walk, node, { named, layerBytes, to, toBytes, from, section, listed, part })
      if (typeof shaped === 'string') return shaped
      modules.push(...shaped)
    }

    // 4. NO HAND HERE REFUSED IT, read from disk, never from this tab's copy:
    //    another tab's hand may have ruled since. Asked before the path, so a
    //    refused draft settles whatever is picked there.
    if (!deps.heldOnDisk) return 'unheld'
    const onDisk = new Map<string, BroodRecord | null>()
    for (const module of modules) {
      const record = await deps.heldOnDisk(module.sig)
      if (record?.ruling?.verdict === 'refused') return 'refused-here'
      onDisk.set(module.sig, record)
    }

    // 5. A FREE PATH: local work wins.
    const there = deps.picks()[path]
    if (there) {
      if (there.root === root) return 'present'
      if (!(await givesWay(deps, there.root, ofDependency ? rootDependencies : named, from, siblings))) return 'path-busy'
    }

    // 6. HELD, and proved held on disk, before any byte is written.
    const store = deps.store()
    const writeModule = ofDependency ? store?.writeDependencyBytes?.bind(store) : store?.writeBeeBytes?.bind(store)
    if (!writeModule || !store?.writeLayerBytes || !deps.hold) return 'unheld'
    for (const module of modules) {
      const record = onDisk.get(module.sig)
      if (record?.ruling?.verdict === 'accepted') continue
      if (!record?.flags?.length) {
        const flag = module.reaches.length
          ? { by: 'scan', reason: `it newly reaches ${reachPhrase(module.reaches)}`, reaches: module.reaches }
          : { by: 'trial', reason: untriedReason() }
        await deps.hold(module.sig, flag, { kind: 'own', how: `a draft of ${module.section} at ${path}${CARRIED_HOME}${lineage}` }, module.section)
      }
      const stored = await deps.heldOnDisk(module.sig)
      if (!stored?.flags?.length || stored.ruling) return 'unheld'
    }

    // 7. THE BYTES: the modules the draft adds, then a bee draft's layer (a
    //    dependency draft's is the trunk's own, held already), then the root.
    for (const module of modules) await writeModule(module.sig, module.bytes)
    if (!ofDependency) await store.writeLayerBytes(layer, layerBytes.buffer)
    await store.writeLayerBytes(root, rootBytes.buffer)

    // 8. THE PICK, through every gate. The root is not admitted as trusted:
    //    only its draft fields and dependencies were checked, never the rest
    //    of its tree, so it never vouches for any other revision here.
    const admitted = ofDependency ? modules.map(module => module.sig) : [...modules.map(module => module.sig), layer]
    const outcome = await deps.apply(trunk, admitted, { ...deps.picks(), [path]: { layer, root, hides: false, at } })
    if (!outcome.ok) return 'gate'
    // Announced as now, not as when it was drafted, so the reading starts fresh here.
    announce({ sig: to, from, section, path, reaches, of: ofDependency ? 'dependency' : 'bee', at: deps.now() })
    return 'applied'
  } catch {
    return 'unheld'
  }
}

/** A part of a carried draft, read and hashed to its name ('forged' when it does not). */
type HashedPart = (sig: string) => Promise<Uint8Array<ArrayBuffer> | null | 'forged'>

/** A module a carried draft puts back, as it is held and written. */
type HeldModule = { sig: string; bytes: Uint8Array<ArrayBuffer>; section: string; reaches: readonly CodeReach[] }

/**
 * STEP 2 FOR A DEPENDENCY DRAFT: the root lists the trunk's dependencies with
 * swaps only. `added` is what it lists beyond the trunk's, `removed` the
 * trunk's it leaves out. Every added one is a listed part that hashes to its
 * name, `to` among them, its namespace inside the path; every removed one is a
 * trunk dependency of the same namespace as exactly one added one, and every
 * added one takes the place of exactly one. Stacked swaps at one path (two
 * namespaces, or one drafted twice) hold to this; anything else was made over
 * some other list (`other-build`). A part that is not listed or does not hash
 * is `tampered`; one that cannot be read, `incomplete`.
 */
const dependencySwaps = async (
  deps: ModuleDraftDeps, walk: TreeWalk, rootDependencies: readonly string[], to: string, path: string,
  listed: ReadonlySet<string>, part: HashedPart,
): Promise<{ sig: string; bytes: Uint8Array<ArrayBuffer> }[] | DraftRestoreOutcome> => {
  const trunkDependencies = new Set(walk.rootDependencies)
  const rootSet = new Set(rootDependencies)
  const added = [...rootSet].filter(sig => !trunkDependencies.has(sig)).sort()
  const removed = [...trunkDependencies].filter(sig => !rootSet.has(sig)).sort()
  if (!added.includes(to) || added.some(sig => !listed.has(sig))) return 'tampered'
  if (added.length !== removed.length) return 'other-build'
  const out: { sig: string; bytes: Uint8Array<ArrayBuffer> }[] = []
  const addedSpaces: string[] = []
  for (const sig of added) {
    const held = await part(sig)
    if (held === 'forged') return 'tampered'
    if (!held) return 'incomplete'
    const ns = namespaceOf(held)
    if (!ns || !within(ns, path)) return 'tampered'
    addedSpaces.push(ns)
    out.push({ sig, bytes: held })
  }
  // The trunk's own bundles, read from this device: they run here now.
  const store = deps.store()
  const removedSpaces: string[] = []
  for (const sig of removed) {
    const held = await store?.getDependencyBytes?.(sig).catch(() => null)
    if (!held) return 'incomplete'
    removedSpaces.push(namespaceOf(held))
  }
  const key = (spaces: readonly string[]): string => JSON.stringify([...spaces].sort())
  if (new Set(addedSpaces).size !== addedSpaces.length || key(addedSpaces) !== key(removedSpaces)) return 'other-build'
  return out
}

/**
 * STEP 3 FOR A BEE DRAFT: its layer is the trunk's layer at its path with only
 * carried modules added (restoreDraft, step 3). The modules beyond `to` it
 * adds, read and hashed, or the outcome that stops it.
 */
const beeLayerOverTrunk = async (
  deps: ModuleDraftDeps, walk: TreeWalk, node: TreeWalk['nodes'][number] | undefined,
  draft: {
    readonly named: readonly string[]; readonly layerBytes: Uint8Array; readonly to: string; readonly toBytes: Uint8Array<ArrayBuffer>
    readonly from: string; readonly section: string; readonly listed: ReadonlySet<string>; readonly part: HashedPart
  },
): Promise<HeldModule[] | DraftRestoreOutcome> => {
  const { named, layerBytes, to, toBytes, from, section, listed, part } = draft
  if (!node) return 'tampered'
  const added = partsOver(named, node)
  if (!added.includes(to) || added.some(sig => !listed.has(sig))) return 'tampered'
  //    None of them is a module the trunk already runs elsewhere (on its
  //    root, or at another path): holding it would stop that module here.
  if (added.some(sig => runsInWalk(walk, sig))) return 'tampered'
  //    Nothing else in it differs from the trunk's layer: no child layer
  //    grafted in (the walk follows `cells`, and what it reaches would run
  //    unheld), no other field changed, and no trunk module left out that
  //    a carried one does not take the place of.
  const trunkLayer = await (await deps.layers())?.read(node.layerSig)
  if (!trunkLayer) return 'incomplete'
  let carriedShape: string, trunkShape: string
  try {
    carriedShape = withoutModules(JSON.parse(decode(layerBytes)) as LayerRecord)
    trunkShape = withoutModules(JSON.parse(decode(trunkLayer)) as LayerRecord)
  } catch { return 'tampered' }
  if (carriedShape !== trunkShape) return 'tampered'
  //    The drafted module takes the place of at most the one it was written
  //    from (a trunk module, or an earlier draft that took one's place); any
  //    other carried module (an earlier draft in the folder) at most one each.
  const replaceable = (from && !named.includes(from) ? 1 : 0) + added.length - 1
  if (node.bees.filter(sig => !named.includes(sig)).length > replaceable) return 'tampered'
  //    And WHICH ones: each trunk module it leaves out is the one the draft
  //    was written from, or one a carried module is a section rewrite of
  //    (the same source sections, in order), one each. Never an unrelated
  //    trunk module dropped beside an extra part: that would stop running
  //    here with no hand here having accepted anything.
  const leftOut = node.bees.filter(sig => !named.includes(sig) && sig !== from)
  if (leftOut.length) {
    const sectionsOf = (bytes: Uint8Array): string => sectionIndex(decode(bytes)).map(s => s.path).join('\n')
    const takesFrom = !!from && node.bees.includes(from) && !named.includes(from)
    const free: string[] = []
    for (const sig of added) {
      if (sig === to && takesFrom) continue
      const held = sig === to ? toBytes : await part(sig)
      if (held === 'forged') return 'tampered'
      if (!held) return 'incomplete'
      free.push(sectionsOf(held))
    }
    const trunkStore = deps.store()
    for (const sig of leftOut) {
      const held = await trunkStore?.getBeeBytes?.(sig).catch(() => null)
      if (!held) return 'incomplete'
      const key = sectionsOf(held)
      const at = key ? free.indexOf(key) : -1
      if (at < 0) return 'tampered'
      free.splice(at, 1)
    }
  }
  const modules: HeldModule[] = []
  for (const sig of added) {
    if (sig === to) continue
    const held = await part(sig)
    if (held === 'forged') return 'tampered'
    if (!held) return 'incomplete'
    const text = decode(held)
    if (await unparsable(deps, text, '', section)) return 'tampered'
    modules.push({ sig, bytes: held, section: sectionIndex(text)[0]?.path ?? section, reaches: newReaches('', text) })
  }
  return modules
}

/** Does the pick at a path give way to a carried draft? Only when it is not
 *  local work: the carried draft was written on top of it (its layer — for a
 *  dependency draft, its root's dependencies — still names the busy draft's
 *  module, or it drafts from that module), or the busy draft itself came home
 *  with a card — but not with this one: two drafts of one path the same card
 *  carried, neither written on the other, do not take turns replacing each
 *  other; the first runs, the other waits. */
const givesWay = async (deps: ModuleDraftDeps, busyRoot: string, named: readonly string[], from: string, siblings: ReadonlySet<string>): Promise<boolean> => {
  try {
    const io = await deps.layers()
    const bytes = await io?.read(busyRoot)
    const busy = bytes ? (JSON.parse(decode(bytes)) as { draft?: DraftRecord }).draft : undefined
    if (!busy || (busy.kind !== 'bee' && busy.kind !== 'dependency')) return false
    const busyTo = String(busy.to ?? '')
    if (!SIG_RE.test(busyTo)) return false
    if (named.includes(busyTo) || from === busyTo) return true
    if (siblings.has(busyRoot)) return false
    const record = (await deps.heldOnDisk?.(busyTo)) ?? null
    return ownDraft(record) && record.source.how.includes(CARRIED_HOME)
  } catch { return false }
}

/** Every draft a card carried, put back one after another. */
export const restoreDrafts = async (
  carried: { readonly refs: readonly string[]; readonly drafts: readonly { readonly root: string; readonly layer: string }[] },
  bytes: (sig: string) => Promise<Uint8Array | null>,
  lineage: string,
  deps: ModuleDraftDeps = liveDeps(),
): Promise<{ readonly root: string; readonly outcome: DraftRestoreOutcome }[]> => {
  const out: { root: string; outcome: DraftRestoreOutcome }[] = []
  const siblings = new Set(carried.drafts.map(draft => draft.root))
  for (const draft of carried.drafts) {
    const others = new Set([...siblings].filter(root => root !== draft.root))
    out.push({ root: draft.root, outcome: await restoreDraft(draft, carried.refs, bytes, lineage, deps, others) })
  }
  return out
}

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
  // above it hides it) changes nothing and is not folded. Somebody else's
  // code taken by hand that still waits in the brood is not folded: a commit
  // publishes under this hive's key, and a stranger's code nobody here has
  // accepted never rides out under it. It stays a pick, and the outcome names
  // it. This hive's own drafts are folded held — every draft is held until
  // accepted (admitInBrood), and the trial is where it is tried.
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
    // A DRAFT RIDES INTO THE TRIAL HELD: a commit opens a trial (`try-…`),
    // the one place a held draft is tried, and it still runs nowhere in this
    // hive until the hand accepts it. Somebody else's code taken by hand and
    // not yet accepted stays out — a trial is signed with this hive's key.
    if (!draft && await stillHeld(pick.layer, path, dependencies, local, readNamespace, deps.mayRun)) { held.push(path); continue }
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
  const minified = await reminifyRegistered(rootSig, {
    read: async sig => (await io.read(sig)) ?? (await store.getBeeBytes?.(sig).catch(() => null)) ?? (await store.getDependencyBytes?.(sig).catch(() => null)) ?? null,
    write: async (sig, bytes) => {
      const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
      await writeLayer(sig, copy)
    },
  })
  return { ok: true, rootSig, index, ...(minified?.root ? { minified: minified.root } : {}), atoms: await newAtoms(trunk, rootSig, io), files: await packageFiles(rootSig, io), drafts: [...drafts.keys()].sort(), off: [...off].sort(),
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
  carry: options => carryableDrafts(liveDeps(), options),
  restoresDependencies: true,
  restore: (carried, bytes, lineage) => restoreDrafts(carried, bytes, lineage),
}
try {
  ;(globalThis as { ioc?: { register?: (k: string, v: unknown) => void } }).ioc?.register?.(MODULE_DRAFTS_IOC_KEY, provider)
} catch { /* no ioc in this environment — direct importers still work */ }
