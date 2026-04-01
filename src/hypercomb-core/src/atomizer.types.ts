// hypercomb-core/src/atomizer.types.ts
//
// Atomizer contract. Lets any UI component declare itself atomizable —
// breakable into constituent visual/functional atoms that can be
// restyled, rearranged, or replaced. Display strategies control how
// the decomposed atoms are presented to the user.

// ---------------------------------------------------------------------------
// Atom descriptor — one constituent piece of a UI component
// ---------------------------------------------------------------------------

export interface AtomDescriptor {
  /** Short identifier, e.g. "input-field", "ghost-text", "suggestion-dropdown" */
  readonly name: string

  /** Structural role inside the parent component */
  readonly type: 'container' | 'control' | 'decorator' | 'text' | 'icon'

  /** Nesting level (0 = root container) */
  readonly depth: number

  /** Current computed CSS custom-property overrides */
  readonly styles: Record<string, string>

  /** Bounding rect within the parent component */
  readonly bounds: DOMRect

  /** Nested atoms (recursive decomposition) */
  readonly children?: AtomDescriptor[]
}

// ---------------------------------------------------------------------------
// Atomizer provider — implemented by any component that can be atomized
// ---------------------------------------------------------------------------

export interface AtomizerProvider {
  /** Unique key, e.g. 'command-line', 'controls-bar' */
  readonly atomizerId: string

  /** Introspect and return constituent atoms */
  discover(): AtomDescriptor[]

  /** Apply style overrides to a named atom */
  applyStyle(atomName: string, styles: Record<string, string>): void

  /** Restore the component to its original, pre-atomized state */
  reassemble(): void
}

// ---------------------------------------------------------------------------
// Display strategy — one of 5 selectable visualization modes
// ---------------------------------------------------------------------------

export type DisplayStrategyName =
  | 'shatter'
  | 'orbital'
  | 'blueprint'
  | 'cascade'
  | 'particle'

export interface DisplayStrategy {
  readonly name: DisplayStrategyName

  /** SVG markup for the strategy picker icon */
  readonly icon: string

  /** Activate this strategy with the given atoms */
  enter(target: AtomizerProvider, atoms: AtomDescriptor[]): void

  /** Deactivate and clean up visuals */
  exit(): void

  /** Animate transition from a previously active strategy */
  switchTo(atoms: AtomDescriptor[]): void

  /** Optional: handle atom selection within this strategy */
  onAtomSelect?(atom: AtomDescriptor): void
}

// ---------------------------------------------------------------------------
// Atomizer contract — the runtime session for one atomization
// ---------------------------------------------------------------------------

export interface AtomizerContract {
  /** IoC key or component selector of the atomized target */
  readonly target: string

  /** The provider that describes the target's atoms */
  readonly provider: AtomizerProvider

  /** Discovered atoms for the current target */
  readonly atoms: AtomDescriptor[]

  /** Currently active display strategy */
  activeStrategy: DisplayStrategyName

  /** Switch to a different display strategy (re-animates) */
  setStrategy(name: DisplayStrategyName): void
}

// ---------------------------------------------------------------------------
// IoC keys
// ---------------------------------------------------------------------------

export const ATOMIZER_IOC_PREFIX = '@hypercomb.social/Atomizer:'
