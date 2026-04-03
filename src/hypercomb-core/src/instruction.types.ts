/**
 * Instruction overlay types — protocol for bees to declare UI annotations.
 *
 * Bees declare `instructions` on their class to describe what their UI elements do.
 * The InstructionDrone collects these, builds a signature-addressed manifest,
 * and the InstructionOverlayComponent renders them as floating labels.
 *
 * @see documentation/signature-expansion-doctrine.md
 * @see documentation/signature-node-pattern.md
 */

/** A single instruction annotation anchored to a DOM element */
export interface InstructionAnchor {
  /** Stable selector: [data-instruction="dcp.zoom-in"] or canvas:hexGrid */
  readonly selector: string
  /** i18n key for the label text */
  readonly labelKey: string
  /** i18n key for optional detail text (shown on hover/expand) */
  readonly detailKey?: string
  /** Position relative to anchor element */
  readonly placement: 'top' | 'bottom' | 'left' | 'right' | 'auto'
  /** Category for grouped filtering */
  readonly category?: string
  /** Optional keyboard shortcut hint */
  readonly shortcut?: string
  /** Optional slash command hint */
  readonly command?: string
}

/** A set of instructions owned by a single bee */
export interface InstructionSet {
  /** The bee's iocKey */
  readonly owner: string
  /** Human-readable group name (defaults to bee.name) */
  readonly label: string
  /** The individual annotations this bee provides */
  readonly anchors: readonly InstructionAnchor[]
}

/** The full catalog of all instructions — signature-addressed resource */
export interface InstructionManifest {
  readonly version: 1
  /** Locale at the time of manifest creation */
  readonly locale: string
  /** Epoch ms when manifest was built */
  readonly timestamp: number
  /** Instruction sets from all registered bees */
  readonly sets: readonly InstructionSet[]
}

/** User's visibility choices — signature-addressed resource */
export interface InstructionSettings {
  readonly version: 1
  /** Signature of the manifest this settings file applies to */
  readonly manifestSig: string
  /** Anchor selectors the user has dismissed */
  readonly hidden: readonly string[]
  /** Epoch ms of last change */
  readonly at: number
}
