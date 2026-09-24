// hypercomb-runtime/src/package-tree.ts
//
// A PACKAGE IS A BRANCH, AND A BRANCH IS RECURSIVE. The root a publisher signs
// names one layer per feature directory; each of those names its own child
// layers, and so on down (`games` → `games/arkanoid` → `games/arkanoid/themes`).
// Every one of them is a package: its NAME PATH is its identity, its layer
// signature is its version, and a change deep in the tree moves exactly the
// layers on the way down to it — which is how an update mark can say where a
// change is, and how a participant can walk down to it and take only that.
//
// THE SELECTION. What runs is the trunk you are on (the root you installed)
// with PICKS laid over it: a pick says "at this path, this layer, from that
// root". A pick is decoupled from where it came from — a revision is a
// signature, and any root carrying it is a source for it. Taking an older
// revision is applying something from an earlier date; nothing is ever moved
// or deleted, and dropping the pick puts the trunk's layer back.
//
// A DOWNGRADE THAT HIDES. Taking an older revision of a branch replaces
// everything under it. When the participant does that knowingly, the pick
// HIDES: the picks beneath it stop applying (they are kept, not deleted) until
// the branch is back on a revision that does not hide.
//
// Pure where it can be: the walk takes an io, the records take a storage, and
// nothing here activates anything — acquire.ts does that.

import { resolveSignatureClosure, type ReplicationIo } from './replication-walker.js'
import { SignatureService } from '@hypercomb/core'

/** localStorage key holding the participant's picks, by name path. */
export const PICKS_KEY = 'hc:install:picks'

const SIG_RE = /^[a-f0-9]{64}$/
const SEGMENT_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i
const ESSENTIALS = '@hypercomb/essentials/'

export type PackageNode = {
  /** `games/arkanoid` — the identity. */
  path: string
  name: string
  /** The version: this layer's signature, which covers its whole subtree. */
  layerSig: string
  /** The bees this layer declares ITSELF — never its children's. */
  bees: string[]
  /** Child paths, in the order the layer names them. */
  children: string[]
  description: string
  /** The layer the parent names at this path, before any pick. Equal to
   *  `layerSig` unless a pick replaced it. */
  base: string
}

export type PackagePick = {
  layer: string
  /** A root that carries `layer` at this path — where its namespace
   *  dependencies are read from. */
  root: string
  /** Taken knowingly over newer parts beneath it: the picks under it stop
   *  applying until this one is replaced. */
  hides: boolean
  /** When it was taken — orders picks, never dates a revision. */
  at: number
  /** Picked by hand from a root nothing here vouches for (the gate's HAND
   *  door): what it brought waits in the brood until it is accepted. */
  byHand?: boolean
}

export type Picks = Record<string, PackagePick>

export const isPath = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.split('/').every(segment => SEGMENT_RE.test(segment))

export const parentOf = (path: string): string =>
  path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''

/** Is `path` the ancestor itself or somewhere beneath it? `''` is the root. */
export const within = (path: string, ancestor: string): boolean =>
  ancestor === '' || path === ancestor || path.startsWith(`${ancestor}/`)

const bare = (value: unknown): string =>
  String(value ?? '').trim().toLowerCase().replace(/\.(?:js|json)$/, '')

export const sigsOf = (list: unknown): string[] =>
  (Array.isArray(list) ? list : [])
    .map(entry => bare(typeof entry === 'string' ? entry : (entry as { sig?: unknown })?.sig))
    .filter(sig => SIG_RE.test(sig))

type LayerRecord = { name?: unknown; cells?: unknown; bees?: unknown; dependencies?: unknown; docs?: { description?: unknown } }

const parseLayer = (bytes: Uint8Array | null): LayerRecord | null => {
  if (!bytes) return null
  try {
    const record = JSON.parse(new TextDecoder().decode(bytes)) as LayerRecord
    return record && typeof record === 'object' ? record : null
  } catch { return null }
}

/** One layer, held or admitted, and only ever parsed once it hashed to its own name. */
const readLayer = async (sig: string, io: ReplicationIo): Promise<LayerRecord | null> => {
  const held = await io.read(sig)
  if (held && (await SignatureService.sign(held.buffer.slice(held.byteOffset, held.byteOffset + held.byteLength) as ArrayBuffer)) === sig) return parseLayer(held)
  const result = await resolveSignatureClosure(sig, io, { children: () => [] })
  return result.held.includes(sig) ? parseLayer(await io.read(sig)) : null
}

export type TreeWalk = {
  nodes: PackageNode[]
  /** Every layer the walked tree names, the root included. */
  layers: string[]
  /** The bees the root layer declares itself. */
  rootBees: string[]
  /** The dependencies the root layer lists. */
  rootDependencies: string[]
  /** Picks that shaped the tree. */
  applied: string[]
  /** Picks kept but not applied, because a pick above them hides. */
  eclipsed: string[]
  /** Every named layer was read. A walk that is not complete must never
   *  become an activation. */
  complete: boolean
}

/**
 * Walk a root's tree, laying picks over it by path. A pick at a path the tree
 * does not have yet is added under its parent, so a package only some other
 * root carries can be taken into the trunk.
 */
export const walkTree = async (rootSig: string, io: ReplicationIo, picks: Picks = {}): Promise<TreeWalk> => {
  const hiding = Object.entries(picks).filter(([, pick]) => pick.hides).map(([path]) => path)
  const eclipsed = new Set(Object.keys(picks).filter(path => hiding.some(above => above !== path && within(path, above))))
  const applies = (path: string): boolean => !!picks[path] && !eclipsed.has(path)

  const records = new Map<string, Promise<LayerRecord | null>>()
  const load = (sig: string): Promise<LayerRecord | null> => {
    let pending = records.get(sig)
    if (!pending) { pending = readLayer(sig, io).catch(() => null); records.set(sig, pending) }
    return pending
  }

  const nodes = new Map<string, PackageNode>()
  const layers = new Set<string>()
  const applied = new Set<string>()
  let complete = true

  const visit = async (layerSig: string, path: string, base: string): Promise<void> => {
    const record = await load(layerSig)
    if (!record) { complete = false; return }
    layers.add(layerSig)
    const node: PackageNode = {
      path,
      name: path.slice(path.lastIndexOf('/') + 1),
      layerSig,
      bees: sigsOf(record.bees),
      children: [],
      description: String(record.docs?.description ?? '').trim(),
      base,
    }
    if (path) nodes.set(path, node)
    if (path && applies(path)) applied.add(path)

    const children = await Promise.all(sigsOf(record.cells).map(async sig => ({ sig, record: await load(sig) })))
    const named = new Set<string>()
    const next: [string, string, string][] = []
    for (const child of children) {
      if (!child.record) { complete = false; continue }
      const name = String(child.record.name ?? '').trim()
      if (!SEGMENT_RE.test(name) || named.has(name)) continue
      named.add(name)
      const childPath = path ? `${path}/${name}` : name
      next.push([applies(childPath) ? picks[childPath]!.layer : child.sig, childPath, child.sig])
    }
    // A picked package this tree does not have yet joins under its parent.
    for (const [pickPath, pick] of Object.entries(picks)) {
      if (parentOf(pickPath) !== path || !applies(pickPath)) continue
      const name = pickPath.slice(pickPath.lastIndexOf('/') + 1)
      if (named.has(name)) continue
      named.add(name)
      next.push([pick.layer, pickPath, ''])
    }
    node.children = next.map(([, childPath]) => childPath)
    await Promise.all(next.map(([sig, childPath, childBase]) => visit(sig, childPath, childBase)))
  }

  const root = await load(rootSig)
  if (!root) {
    return { nodes: [], layers: [], rootBees: [], rootDependencies: [], applied: [], eclipsed: [...eclipsed].sort(), complete: false }
  }
  await visit(rootSig, '', rootSig)

  return {
    nodes: [...nodes.values()].sort((a, b) => a.path.localeCompare(b.path)),
    layers: [...layers],
    rootBees: sigsOf(root.bees),
    rootDependencies: sigsOf(root.dependencies),
    applied: [...applied].sort(),
    eclipsed: [...eclipsed].sort(),
    complete,
  }
}

/** The layer a root names at a path, or `''` — read down the path alone,
 *  never the whole tree. */
export const layerAt = async (rootSig: string, path: string, io: ReplicationIo): Promise<string> => {
  if (!isPath(path)) return ''
  let at = rootSig
  for (const segment of path.split('/')) {
    const record = await readLayer(at, io).catch(() => null)
    if (!record) return ''
    const children = await Promise.all(sigsOf(record.cells).map(async sig => ({ sig, record: await readLayer(sig, io).catch(() => null) })))
    const next = children.find(child => String(child.record?.name ?? '').trim() === segment)
    if (!next) return ''
    at = next.sig
  }
  return at
}

/**
 * WHAT "UPDATE ALL" TAKES. The participant chose every update the followed
 * publisher offers, so a pick the new root moves past is released and the
 * root's own layer runs there — that is the update the row's mark offered.
 * Kept: a pick whose path the new root does not name (it adds, it does not
 * lag), a downgrade the participant confirmed with "Take it anyway" (`hides`),
 * and a pick taken by hand from a root nothing vouches for (`byHand`, a
 * trial). A pick of the very layer the root names is dropped as a no-op.
 * Nothing is deleted: the bytes stay held and the revisions list takes any of
 * them back.
 */
export const releasedByTakeAll = async (
  picks: Picks,
  layerOfNewRoot: (path: string) => Promise<string>,
): Promise<{ kept: Picks; released: string[] }> => {
  const kept: Picks = {}
  const released: string[] = []
  for (const [path, pick] of Object.entries(picks)) {
    if (pick.hides || pick.byHand) { kept[path] = pick; continue }
    const now = await layerOfNewRoot(path).catch(() => '')
    if (!now) { kept[path] = pick; continue }
    if (now !== pick.layer) released.push(path)
  }
  return { kept, released: released.sort() }
}

/** Is this path off — itself, or any branch above it? */
export const isOff = (path: string, off: ReadonlySet<string>): boolean => {
  for (const above of off) if (within(path, above)) return true
  return false
}

/**
 * The bees that load: the root's own, and every bee a layer that is not off
 * declares itself. A bee two layers both declare loads while either is on.
 */
export const enabledBees = (walk: Pick<TreeWalk, 'nodes' | 'rootBees'>, off: ReadonlySet<string>): string[] => {
  const kept = new Set(walk.rootBees)
  for (const node of walk.nodes) if (!isOff(node.path, off)) for (const bee of node.bees) kept.add(bee)
  return [...kept].sort()
}

/**
 * THE CODE A TREE NAMES, BY WHERE IT SITS — from its layers alone, for a
 * trial audit to set against what runs here (essentials module-audit.ts):
 * every bee at the path of the layer that declares it (`''` for the root's
 * own), and each dependency bundle with the alias `aliasOf` reads for it —
 * `''` when its bytes are not held. Nothing here fetches a module. `runs`,
 * when given, keeps only what may run: WHAT RUNS HERE never counts code the
 * brood holds, or an audit would skip it and read other code against it.
 */
export const modulesOfWalk = async (
  walk: Pick<TreeWalk, 'nodes' | 'rootBees'>,
  dependencies: readonly string[],
  aliasOf: (sig: string) => Promise<string>,
  runs: (sig: string) => Promise<boolean> = async () => true,
): Promise<{ bees: { sig: string; path: string }[]; dependencies: { sig: string; alias: string }[] }> => {
  const kept = async <T extends { sig: string }>(modules: T[]): Promise<T[]> => {
    const may = await Promise.all(modules.map(module => runs(module.sig).catch(() => false)))
    return modules.filter((_, index) => may[index])
  }
  return {
    bees: await kept([
      ...walk.rootBees.map(sig => ({ sig, path: '' })),
      ...walk.nodes.flatMap(node => node.bees.map(sig => ({ sig, path: node.path }))),
    ]),
    dependencies: await kept(await Promise.all([...new Set(dependencies)].map(async sig => ({ sig, alias: await aliasOf(sig).catch(() => '') })))),
  }
}

/** The namespace path a dependency's alias names, from its first line:
 *  `// @hypercomb/essentials/presentation/tiles` → `presentation/tiles`.
 *  `''` when it names none. */
export const namespaceOf = (bytes: Uint8Array | null): string => {
  if (!bytes) return ''
  const line = new TextDecoder().decode(bytes.subarray(0, 240)).split('\n')[0] ?? ''
  const alias = line.replace(/^\s*\/\/\s*/, '').trim()
  const ns = alias.startsWith(ESSENTIALS) ? alias.slice(ESSENTIALS.length) : ''
  return isPath(ns) ? ns : ''
}

/** The deepest applied pick a namespace falls under, or `''` for the trunk. */
export const ownerOf = (ns: string, applied: readonly string[]): string => {
  let owner = ''
  if (!ns) return owner
  for (const path of applied) if (within(ns, path) && path.length > owner.length) owner = path
  return owner
}

/**
 * THE DEPENDENCIES A SELECTION RUNS. A queen, a view or a service builds into
 * its namespace's dependency bundle, which only the root lists — so a pick
 * takes the bundles under its path from the root it was picked from, and the
 * trunk supplies every other one. A namespace under two picks belongs to the
 * deeper. A bundle whose namespace cannot be read stays with the trunk when
 * the trunk lists it and is left out when only a pick's root does.
 */
export const composeDependencies = async (
  trunk: readonly string[],
  sources: readonly { path: string; dependencies: readonly string[] }[],
  applied: readonly string[],
  readNamespace: (sig: string) => Promise<string | null>,
  /** May this bundle run (core mayRunBee)? A picked bundle held in the brood
   *  WAITS: it is not composed, and the trunk's bundle for its namespace
   *  keeps running until it is accepted. */
  mayRun: (sig: string) => Promise<boolean> = async () => true,
): Promise<string[]> => {
  const kept = new Set<string>()
  const waiting = new Set<string>()
  const supplied = new Set<string>()
  for (const source of sources) {
    for (const sig of source.dependencies) {
      const ns = await readNamespace(sig)
      if (!ns || ownerOf(ns, applied) !== source.path) continue
      supplied.add(ns)
      if (await mayRun(sig)) kept.add(sig)
      else waiting.add(ns)
    }
  }
  // The trunk supplies what no pick does: everything outside the picks, a
  // namespace whose picked bundle waits in the brood, and a namespace UNDER a
  // pick's path that the pick's root never listed. That last one is a trunk
  // that moved past the pick — `assistant` split into `assistant/…` atoms after
  // the pick was taken — and dropping the trunk's atoms there left every bee
  // that imports them refused as "nothing on the trunk carries".
  for (const sig of trunk) {
    const ns = await readNamespace(sig)
    if (ownerOf(ns ?? '', applied) === '' || waiting.has(ns ?? '') || !supplied.has(ns ?? '')) kept.add(sig)
  }
  return [...kept].sort()
}

/**
 * THE SIDEWAYS CHECK. A module that imports a namespace the selection does not
 * run would die at evaluation, so the namespaces every module names are
 * checked against the ones the selected dependencies provide — and the missing
 * ones are named, so a refusal can say what to take with it.
 */
export const missingNamespaces = async (
  modules: readonly string[],
  provided: ReadonlySet<string>,
  read: (sig: string) => Promise<Uint8Array | null>,
): Promise<string[]> => {
  const missing = new Set<string>()
  const pattern = /["'`]@hypercomb\/essentials\/([a-z0-9._/-]+)["'`]/gi
  for (const sig of modules) {
    const bytes = await read(sig)
    if (!bytes) continue
    for (const match of new TextDecoder().decode(bytes).matchAll(pattern)) {
      const ns = match[1] ?? ''
      if (isPath(ns) && !provided.has(ns)) missing.add(ns)
    }
  }
  return [...missing].sort()
}

/** Which paths a newer tree moves: a layer that differs, or one that is new. */
export const movedPaths = (mine: readonly PackageNode[], next: readonly PackageNode[]): Set<string> => {
  const before = new Map(mine.map(node => [node.path, node.layerSig]))
  return new Set(next.filter(node => before.get(node.path) !== node.layerSig).map(node => node.path))
}

/** A path and every branch above it — the way down to a change. */
export const withAncestors = (paths: Iterable<string>): Set<string> => {
  const all = new Set<string>()
  for (const path of paths) {
    let at = path
    while (at) { all.add(at); at = parentOf(at) }
  }
  return all
}

/** What a newer tree changes BENEATH a path, against what runs there now:
 *  the descendants a revision would replace. */
export const changedBeneath = (path: string, current: readonly PackageNode[], revision: readonly PackageNode[]): string[] => {
  const now = new Map(current.filter(node => node.path !== path && within(node.path, path)).map(node => [node.path, node.layerSig]))
  const then = new Map(revision.filter(node => node.path !== path && within(node.path, path)).map(node => [node.path, node.layerSig]))
  const changed = new Set<string>()
  for (const [child, sig] of now) if (then.get(child) !== sig) changed.add(child)
  return [...changed].sort()
}

// ── revisions ───────────────────────────────────────────────────────────────

export type RevisionSource = {
  root: string
  /** The domain that listed the root, `''` for a root held here. */
  zone: string
  /** When that domain received it, `''` when unknown. */
  at: string
  /** Its place in that domain's newest-first list. */
  rank: number
  /** The name it was published under — the member's label; absent when held
   *  here or when the member names nothing. */
  name?: string
}

export type Revision = {
  layer: string
  /** The earliest date any source gives — when this revision first appeared. */
  at: string
  sources: RevisionSource[]
}

/**
 * One path's revisions, newest first. A revision is a SIGNATURE: every root
 * that carries the same layer at the path is a source for the same revision,
 * whichever domain listed it. Ordered by when it first appeared — its oldest
 * date, else its oldest place in a list.
 */
export const orderRevisions = (found: readonly { layer: string; source: RevisionSource }[]): Revision[] => {
  const byLayer = new Map<string, RevisionSource[]>()
  for (const { layer, source } of found) {
    if (!SIG_RE.test(layer)) continue
    const list = byLayer.get(layer) ?? []
    if (!list.some(s => s.root === source.root && s.zone === source.zone)) list.push(source)
    byLayer.set(layer, list)
  }
  // Ordered by the NEWEST root carrying each revision, never the first: a
  // layer a later build returned to is the current one, and must not sort
  // under the revisions it replaced (found live 2026-09-13 — the running
  // games/solomon listed below four it had superseded). A root held here but
  // listed by no domain dates nothing and sorts after every listed one.
  const revisions = [...byLayer].map(([layer, sources]) => {
    const listed = sources.filter(s => s.zone)
    const dates = listed.map(s => s.at).filter(Boolean).sort()
    return { layer, at: dates[dates.length - 1] ?? '', sources, newest: listed.length ? Math.min(...listed.map(s => s.rank)) : Number.POSITIVE_INFINITY }
  })
  revisions.sort((a, b) => (a.at && b.at && a.at !== b.at)
    ? b.at.localeCompare(a.at)
    : a.newest === b.newest ? 0 : a.newest < b.newest ? -1 : 1)
  return revisions.map(({ layer, at, sources }) => ({ layer, at, sources }))
}

// ── the records ─────────────────────────────────────────────────────────────

export const readPicks = (storage: Pick<Storage, 'getItem'> = localStorage): Picks => {
  try {
    const raw = JSON.parse(storage.getItem(PICKS_KEY) ?? '{}') as Record<string, Partial<PackagePick>>
    const picks: Picks = {}
    for (const [path, pick] of Object.entries(raw && typeof raw === 'object' ? raw : {})) {
      if (!isPath(path) || !SIG_RE.test(String(pick?.layer)) || !SIG_RE.test(String(pick?.root))) continue
      picks[path] = { layer: pick.layer!, root: pick.root!, hides: pick.hides === true, at: Number(pick.at) || 0, ...(pick.byHand === true ? { byHand: true } : {}) }
    }
    return picks
  } catch { return {} }
}

export const writePicks = (picks: Picks, storage: Pick<Storage, 'setItem' | 'removeItem'> = localStorage): void => {
  const clean: Picks = {}
  for (const path of Object.keys(picks).sort()) {
    const pick = picks[path]!
    if (isPath(path) && SIG_RE.test(pick.layer) && SIG_RE.test(pick.root)) clean[path] = pick
  }
  try {
    if (Object.keys(clean).length) storage.setItem(PICKS_KEY, JSON.stringify(clean))
    else storage.removeItem(PICKS_KEY)
  } catch { /* storage unavailable */ }
}
