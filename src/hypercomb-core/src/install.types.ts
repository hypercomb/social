// core/install.types.ts
//
// WHAT LOADS HERE, AS A PORT. The contract, in core, where a module can reach
// it without importing whoever implements it — the same seam as HostProvider
// and for the same reason: essentials imports core and nothing else, and the
// host directory that turns packages on and off is a module.
//
// A package is a NAMED layer of the served tree, at any depth — `games`,
// `games/arkanoid` — its name path is its identity and its layer signature its
// version. On/off is a set of paths that survives every update. What runs is
// the trunk (the installed root) with PICKS laid over it: at a path, a layer
// from a root that carries it. The implementation (the layer walk, the
// activation record, the acquisition) is runtime's, which owns the io and
// registers itself under the key below. Core holds the shape and does no io.

/** IoC key for the install port. Implemented in runtime, resolved anywhere. */
export const INSTALL_IOC_KEY = '@hypercomb.social/Install'

export interface InstallUnit {
  name: string
  layerSig: string
  bees: string[]
  description: string
}

/** One package at any depth of a tree. */
export interface InstallNode {
  path: string
  name: string
  layerSig: string
  /** The bees this layer declares itself. */
  bees: string[]
  children: string[]
  description: string
  /** The layer the parent names here before any pick. */
  base: string
}

export interface InstallPick {
  layer: string
  root: string
  /** Taken over newer parts beneath it: the picks under it are kept but
   *  hidden until this one is replaced. */
  hides: boolean
  at: number
}

/** What runs here: the trunk, the picks over it, and the tree they make. */
export interface InstallSelection {
  trunk: string | null
  picks: Record<string, InstallPick>
  applied: string[]
  eclipsed: string[]
  nodes: InstallNode[]
}

export interface InstallRevisionSource {
  root: string
  zone: string
  at: string
}

/** One version of one path — a signature, whichever domain carries it. */
export interface InstallRevision {
  layer: string
  at: string
  sources: InstallRevisionSource[]
}

export interface InstallOutcomeInfo {
  ok: boolean
  fetched: number
  present: number
  error?: string
}

export interface InstallProvider {
  /** The package this shell runs, or null before any activation. */
  installedSig(): string | null
  /** The units of one root, read from held layers first and the domains given
   *  (plus this origin) for what is not held. Empty when the root cannot be read. */
  unitsOf(root: string, zones: readonly string[]): Promise<InstallUnit[]>
  /** Every package in one root's tree, at every depth. */
  nodesOf(root: string, zones: readonly string[]): Promise<InstallNode[]>
  /** The signature a domain publishes as its head, or null. */
  headOf(zone: string): Promise<string | null>
  /** The units a newer root moves, by name — through their own layers or
   *  through their namespace dependencies. */
  movedUnits(installedRoot: string, nextRoot: string, zones: readonly string[]): Promise<string[]>
  /** The paths a newer root moves against what runs here — and every branch
   *  above each, so the way down to a change is marked. */
  movedPaths(nextRoot: string, zones: readonly string[]): Promise<string[]>
  /** The selection held here, composed from held layers alone. */
  selection(): Promise<InstallSelection>
  /** One path's revisions, newest first: the roots given (a head, the trunk)
   *  and each domain's recent roots. */
  revisionsOf(path: string, zones: readonly string[], roots?: readonly string[]): Promise<InstallRevision[]>
  /** The tree of one revision of a path, read from one of its roots. */
  revisionNodes(path: string, root: string, zones: readonly string[]): Promise<InstallNode[]>
  /** Take one revision at one path: admitted through the authority gate,
   *  recorded, and the selection re-activated. */
  pick(
    path: string,
    /** `root` is tried first, then `roots` — any root carrying the layer at
     *  that path is a source for it, and the first the gate admits is taken. */
    revision: { layer: string; root: string; roots?: readonly string[] },
    zones: readonly string[],
    options?: { hides?: boolean },
  ): Promise<InstallOutcomeInfo>
  /** Drop the pick at a path — the trunk's layer runs there again. */
  unpick(path: string): Promise<InstallOutcomeInfo>
  /** Make a root yours through the one verified, gated acquisition. */
  acquire(root: string, zones: readonly string[]): Promise<InstallOutcomeInfo>
  /** Re-write the activation record from what is held — the repoint a toggle
   *  needs. False when the held selection does not resolve. */
  applyUnits(): Promise<boolean>
  /** The paths that are off. */
  offUnits(): Set<string>
  setOffUnits(names: Iterable<string>): void
}
