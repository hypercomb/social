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
  /** The name the domain published this root under (the pool member's label),
   *  `''` for a root held here or a member that carries none. */
  name?: string
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
  /** Paths whose picks a whole-root take released — the new root runs there. */
  released?: readonly string[]
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
  /** Make a root yours through the one verified, gated acquisition. This is
   *  the participant taking the WHOLE root (Update all): a pick the root moves
   *  past is released, except a confirmed downgrade or a trial taken by hand. */
  acquire(root: string, zones: readonly string[]): Promise<InstallOutcomeInfo>
  /** Re-write the activation record from what is held — the repoint a toggle
   *  needs. False when the held selection does not resolve. */
  applyUnits(): Promise<boolean>
  /** The paths that are off. */
  offUnits(): Set<string>
  setOffUnits(names: Iterable<string>): void
}

// ── MODULE DRAFTS: the source lives in the hive ─────────────────────────────
//
// A model writes one section of a running module back (runtime
// module-drafts.ts): a new bee, a new layer naming it, and a pick over the
// installed package — this browser's alone until committed. The words that
// let the participant see, drop and commit drafts reach the runtime through
// this key, so a queen imports core and nothing else.
export const MODULE_DRAFTS_IOC_KEY = '@hypercomb.social/ModuleDrafts'

export interface ModuleDraftInfo {
  /** The package path the draft is picked at (`games/solomon`). */
  readonly path: string
  readonly layerSig: string
  readonly rootSig: string
  /** `src/games/solomon/labyrinth.ts` — the section that was written. */
  readonly section: string
  /** The module it was drafted from. */
  readonly from: string
  readonly at: number
}

export type ModuleCommitOutcome =
  | {
    readonly ok: true
    /** The new package root — the revision this hive now runs and publishes. */
    readonly rootSig: string
    /** Its index in this host's `host:packages` pool. */
    readonly index: number
    /** Every file the new package holds that the package it replaced did not:
     *  the minted layers, the new root, and the drafted modules. These are
     *  what a host must serve before followers are pointed at the root. */
    readonly atoms: readonly string[]
    /** Every file the new package holds — what a sandbox door serves whole. */
    readonly files: readonly string[]
    /** The draft paths the new package took, and the paths it no longer reaches. */
    readonly drafts: readonly string[]
    /** Each drafted source file: its path in the package, the section, the
     *  module it was written into (`from`) and the module that replaced it (`to`). */
    readonly changes: readonly { readonly path: string; readonly section: string; readonly from: string; readonly to: string }[]
    readonly off: readonly string[]
    /** Picks that were not drafts — a trial taken by hand, a revision picked
     *  in Packages — folded into the new root at their path, with the root
     *  each was picked from. */
    readonly taken?: readonly { readonly path: string; readonly root: string }[]
    /** Picks NOT folded because code they bring still waits in the brood: a
     *  commit publishes under this hive's key, and unaccepted code never rides
     *  out under it. They stay picks. */
    readonly held?: readonly string[]
  }
  | { readonly ok: false; readonly error: string }

export interface ModuleDraftsProvider {
  /** The drafts picked over the trunk right now. */
  list(): Promise<ModuleDraftInfo[]>
  /** Drop the draft at a path: the trunk's layer runs there again after a reload. */
  drop(path: string): Promise<{ ok: true } | { ok: false; error: string }>
  /** COMMIT WHAT RUNS HERE: the trunk re-minted with every draft — and every
   *  other pick whose code may run here — at its path, and every path turned
   *  off left out, so the new root no longer reaches
   *  it (nothing is deleted). It becomes a new package root, appended to this
   *  host's `host:packages` pool under `label` and made the trunk here.
   *  Followers reach it once its files are served and the install channel is
   *  stamped — the caller's acts (essentials host-sync, hive-pointer),
   *  because signing lives there. */
  commit(label: string): Promise<ModuleCommitOutcome>
  /** The paths this browser has turned off — what a commit leaves out. */
  offPaths(): string[]
  /** The bytes this store holds for a layer or module signature, or null. */
  bytesOf(sig: string): Promise<Uint8Array | null>
  /** Write one section of a module back and pick it over the trunk. The
   *  module is a bee or a dependency atom (atomic-modules-plan.md, step 5);
   *  the running code changes on reload. */
  draft?(request: { readonly sig: string; readonly section: string; readonly body: string }):
    Promise<{
      readonly ok: true; readonly sig: string; readonly of: 'bee' | 'dependency'; readonly path: string
      /** What the new section reaches that the old one did not (core
       *  code-reach.ts). Non-empty means the draft is HELD in the brood: it
       *  does not run until the participant accepts it. */
      readonly reaches?: readonly string[]
    } | { readonly ok: false; readonly error: string }>
  /** A TRANSFER PACK of these files (hypercomb-runtime transfer-pack.ts): one
   *  content-addressed file carrying every one of them, minted in memory and
   *  never written into the hive — a publish artifact, so a sandbox door can
   *  install the package in a handful of requests. Complete or absent: null
   *  when any file is not held here or does not hash to its name. Optional,
   *  so a caller asks for it only where the runtime has it. */
  pack?(files: readonly string[]): Promise<{ readonly sig: string; readonly bytes: Uint8Array } | null>
}
