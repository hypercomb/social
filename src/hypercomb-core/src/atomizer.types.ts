// hypercomb-core/src/atomizer.types.ts
//
// Atomizer contract. An atomizer is a pluggable module that knows how to
// break apart a specific type of control into its configurable properties.
// Community members can create and share atomizers — signed modules that
// expose property-setting interfaces for any target type.
//
// Controls register as atomizable drop targets with their type. When an
// atomizer is dragged over a matching target, the target lights up. On
// drop, the atomizer's property descriptors appear in a sidebar for editing.

// ---------------------------------------------------------------------------
// Property descriptor — one configurable knob exposed by an atomizer
// ---------------------------------------------------------------------------

export interface AtomizerProperty {
  /** Property key, e.g. "border-radius", "placeholder-text", "font-size" */
  readonly key: string

  /** Human-readable label for the sidebar */
  readonly label: string

  /** Property type determines which editor widget renders in the sidebar */
  readonly type: 'color' | 'number' | 'text' | 'select' | 'boolean' | 'range' | 'spacing'

  /** Current value (read from the target) */
  value: string | number | boolean

  /** Default value (for reset) */
  readonly defaultValue: string | number | boolean

  /** For 'select' type: available options */
  readonly options?: readonly { label: string; value: string }[]

  /** For 'range' type: min/max/step */
  readonly min?: number
  readonly max?: number
  readonly step?: number

  /** Optional group name — properties with the same group render together */
  readonly group?: string
}

// ---------------------------------------------------------------------------
// Atomizer — a pluggable decomposition/configuration module
// ---------------------------------------------------------------------------

export interface Atomizer {
  /** Unique identifier, e.g. 'input-atomizer', 'tile-style-atomizer' */
  readonly atomizerId: string

  /** Human-readable name for the toolbar */
  readonly name: string

  /** Short description */
  readonly description: string

  /** SVG icon markup for the toolbar */
  readonly icon: string

  /** Target types this atomizer can be dropped on */
  readonly targetTypes: readonly string[]

  /**
   * Discover configurable properties for a given target element.
   * Called when the atomizer is dropped on a valid target.
   */
  discover(target: AtomizableTarget): AtomizerProperty[]

  /**
   * Apply a property change to the target.
   * Called when the user edits a value in the sidebar.
   */
  apply(target: AtomizableTarget, key: string, value: string | number | boolean): void

  /**
   * Reset all properties to defaults.
   */
  reset(target: AtomizableTarget): void
}

// ---------------------------------------------------------------------------
// Atomizable target — any control that can receive an atomizer drop
// ---------------------------------------------------------------------------

export interface AtomizableTarget {
  /** The target type, e.g. 'input', 'tile', 'container', 'button' */
  readonly targetType: string

  /** Unique identifier for this specific target instance */
  readonly targetId: string

  /** The DOM element (for computing bounds, applying styles) */
  readonly element: Element

  /** Optional: the tile label if this is a hex tile */
  readonly tileLabel?: string
}

// ---------------------------------------------------------------------------
// IoC keys & constants
// ---------------------------------------------------------------------------

/** Prefix for atomizer module registrations: @hypercomb.social/Atomizer:{id} */
export const ATOMIZER_IOC_PREFIX = '@hypercomb.social/Atomizer:'

/** Prefix for atomizable target registrations: @hypercomb.social/AtomizableTarget:{id} */
export const ATOMIZABLE_TARGET_PREFIX = '@hypercomb.social/AtomizableTarget:'
