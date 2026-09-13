// core/install.types.ts
//
// WHAT LOADS HERE, AS A PORT. The contract, in core, where a module can reach
// it without importing whoever implements it — the same seam as HostProvider
// and for the same reason: essentials imports core and nothing else, and the
// window that turns packages on and off is a module.
//
// A package is a NAMED top-level layer of the served tree; its version is that
// layer's signature; on/off is a set of names that survives every update. The
// implementation (the layer walk, the activation record, the acquisition) is
// runtime's, which owns the io and registers itself under the key below. Core
// holds the shape and does no io.

/** IoC key for the install port. Implemented in runtime, resolved anywhere. */
export const INSTALL_IOC_KEY = '@hypercomb.social/Install'

export interface InstallUnit {
  name: string
  layerSig: string
  bees: string[]
  description: string
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
  /** The signature a domain publishes as its head, or null. */
  headOf(zone: string): Promise<string | null>
  /** The units a newer root moves, by name — through their own layers or
   *  through their namespace dependencies. */
  movedUnits(installedRoot: string, nextRoot: string, zones: readonly string[]): Promise<string[]>
  /** Make a root yours through the one verified, gated acquisition. */
  acquire(root: string, zones: readonly string[]): Promise<InstallOutcomeInfo>
  /** Re-write the activation record from what is held — the repoint a unit
   *  toggle needs. False when the held tree does not resolve. */
  applyUnits(): Promise<boolean>
  offUnits(): Set<string>
  setOffUnits(names: Iterable<string>): void
}
