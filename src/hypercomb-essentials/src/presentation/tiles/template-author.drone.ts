// THE ONE READER AND WRITER FOR LAYOUT ARRANGEMENTS.
//
// The designer is a docked tool window in the shell (hypercomb-shared/ui/
// layout-designer), and shell UI may not import essentials. So this drone is
// the seam: it reads the hive, publishes `template:state`, and takes intents
// back. Nothing about a layout is read twice — a second reader in the panel
// would drift from the one the renderer uses, and then the canvas and the page
// would disagree about the same tile.
//
// ── WHAT THE DESIGNER CAN DO, AS FOUR INTENTS ───────────────────────────
//
//   template:target     this container reads through <layout>   (the root)
//   template:nest       <layout> goes in the hole at <path>
//   template:unnest     the hole at <path> goes back to being a hole
//   template:set-var    one variable, on the level at <path>
//   template:turn       the level at <path> turns one quarter
//
// Every one of them is a MERKLE UPDATE, not a mutation: the level named by the
// path re-mints, so does the chain above it, and the mark ends up pointing at
// a new root signature. Everything untouched keeps the signature it had, which
// is why an edit twelve levels down costs twelve small records and nothing
// else in the hive moves.
//
// ── THE DESIGNER DOES NOT TOUCH CONTENT ─────────────────────────────────
//
// You design with LAYOUTS. Nothing here seats a tile into a hole, and the
// palette lists no tiles: an arrangement is a shape, and what fills its leaf
// holes arrives from the other side, carrying its own position
// (pheromones/enrollment.ts). Keeping the two apart is what lets a shape be
// designed before there is anything to put in it, and reused where the content
// is completely different.

import { Drone, EffectBus } from '@hypercomb/core'
import { isBehaviorDormant } from '../../sharing/behavior-enablement.js'
import {
  CONFIGURATION_AXES, composeLayout, configurationOf, configurationVarsOf,
  miniatureVars, nodeAt,
  nodeOf, templateContainer, turnOf, turnedDirection, variablesOf, withNodeAt, withVarAt,
  type LayoutNode,
} from './layout-template.js'
import {
  TEMPLATE_TARGET_KIND,
  commitArrangement,
  readArrangement,
  removeTemplateTarget,
  resolveTemplateAt,
} from './template-target.js'
import {
  CREATIONS_CHANGED,
  creationGlyph,
  findCreation,
  forgetCreation,
  knownCreations,
  openHoles,
  saveCreation,
  sweepCreationPool,
} from './layout-creations.js'
import { findTemplate, knownTemplates, targetTemplate } from '../../commands/template.queen.js'
import { targetsIn } from './meaning-target.js'
import {
  DEFAULT_HOLE_FAMILY,
  holeMeaning,
  holeTargetsOf,
  withMeaningAt,
  type HoleTarget,
} from './hole-target.js'
import { divisionGroupOf } from '../../assistant/visual-distribution.js'
import {
  artifactFamilyOf,
  enrolledCells,
  orderIn,
  type CellEnrollment,
} from '../../pheromones/enrollment.js'
import type { VisualBeeRegistry } from '../../commands/visual-bee-registry.js'

/** Published when the designer is open, and again after every intent lands.
 *  Sticky on the bus, so a panel opening mid-session hydrates at once. */
export const TEMPLATE_STATE = 'template:state'
/** The selected level, with a live preview of it under every value of every
 *  flex axis. The flex editor renders this and nothing else. */
export const TEMPLATE_SELECTED = 'template:selected'
/** The panel says whether it is showing; nothing is computed while it is not. */
export const TEMPLATE_VIEW_STATE = 'template:view-state'

/** THE OTHER QUESTION ABOUT AN ARRANGEMENT.
 *
 *  The designer asks what shape this container is. The targets window asks
 *  what BELONGS in it — every hole, what it is named, what that name addresses,
 *  and who is answering. Published on its own channel because it is a separate
 *  window with a separate cost: the seating read walks the hive, and nothing
 *  should pay for it to draw a palette chip. */
export const TARGETS_STATE = 'targets:state'
/** The targets window says whether it is showing. Same contract as the
 *  designer's: nothing is computed while it is not. */
export const TARGETS_VIEW_STATE = 'targets:view-state'
/** Ask the targets window to show itself, or to put itself away — `{ open, at }`.
 *  An INTENT, never a toggle, for the reason TEMPLATE_OPEN states. */
export const TARGETS_OPEN = 'targets:open'

type LineageShape = { explorerSegments?: () => readonly string[] }

/** Only what the seating read needs. Structural, so this drone does not take a
 *  dependency on either service's full surface to ask one question. */
type StoreShape = Parameters<typeof enrolledCells>[1]
type HistoryShape = Parameters<typeof enrolledCells>[0]
type _CellShape = CellEnrollment

/** One level of the arrangement, addressed by the hole path that reaches it.
 *  The root's path is empty. */
export interface LevelState {
  readonly path: readonly string[]
  readonly layout: string
  readonly flow: string
  /** WHICH QUARTER THIS LEVEL STANDS AT — 0 for the way its layout is drawn,
   *  then one per clockwise turn. Resolved, so a level that has never been
   *  turned still answers, and the designer can draw the arrow without
   *  holding a second opinion about what a turn means. */
  readonly turn: number
  /** THIS LEVEL, DRAWN SMALL — the same pure builder the palette chip uses,
   *  wearing this level's own configuration.
   *
   *  The designer used to find its map by looking the layout's NAME up in the
   *  palette, which is the arrangement as DRAWN and not as turned: a level
   *  standing on its side was mapped as the row it came from, and every pane
   *  in the map was then in the wrong place. A level is the only thing that
   *  knows how it stands, so it hands over its own picture. */
  readonly glyph: string
  readonly variables: readonly { name: string; value: string }[]
}

/** One value an axis can take, drawn as YOUR container wearing it.
 *
 *  The preview is the real builder's output at chip scale, so a configuration
 *  is judged by looking at it rather than by reading its name — which is the
 *  only honest way to choose between `space-around` and `space-evenly`. */
export interface AxisValueState {
  readonly value: string
  readonly active: boolean
  readonly preview: string
}

/** One flex axis and everything it can say. */
export interface AxisState {
  readonly name: string
  readonly values: readonly AxisValueState[]
}

/** The level the designer has selected, and its configuration. */
export interface SelectionState {
  readonly segments: readonly string[]
  readonly path: readonly string[]
  readonly layout: string
  readonly axes: readonly AxisState[]
}

/** One asset in the palette. Layouts only — see the header.
 *
 *  TWO TYPES, ONE SHELF. A `piece` is a built-in arrangement — the thing you
 *  build out of. A `creation` is an arrangement you built and dragged back
 *  onto the shelf, kept whole: nesting, measurements and all. They are drawn
 *  the same way and dropped the same way; the type is what the filter reads.
 *  See layout-creations.ts. */
export interface AssetState {
  readonly kind: 'piece' | 'creation'
  readonly name: string
  /** A miniature of the arrangement, drawn by the same pure function that
   *  draws the real container, so a chip can never advertise a shape the
   *  layout does not make. */
  readonly glyph: string
  /** How many holes this asset OFFERS — what a part can be seated into, never
   *  the raw hole count. Both types answer through `openHoles`, so a piece and
   *  a creation of the same shape put the same number on the shelf. */
  readonly holes: number
}

/** One hole, everything the targets window shows about it.
 *
 *  The two "what is in it" answers are deliberately separate fields. `filledBy`
 *  is a FACT — the member of this container seated at this slot right now.
 *  `answers` is an INVITATION — every artifact in the hive declaring this
 *  hole's meaning, most of which are not here and never will be. Folding them
 *  into one list would say a hole is filled when nothing is in it. */
export interface HoleState extends HoleTarget {
  /** The child seated at this slot, by name. Empty when the slot is empty. */
  readonly filledBy: string
  /** That child's location, so the window can offer to walk to it. */
  readonly filledAt: readonly string[]
  /** Everything wearing this hole's meaning, by name. Empty for an unnamed
   *  hole — an unnamed hole asks for nothing, so nothing can answer it. */
  readonly answers: readonly string[]
}

export interface TargetsState {
  readonly segments: readonly string[]
  readonly cell: string
  readonly layout: string
  /** The composed container, for the window to draw and make clickable. */
  readonly container: string
  readonly holes: readonly HoleState[]
  /** The artifact families this hive knows how to make, for the name editor.
   *  Derived from the behaviours actually registered — a family nothing can
   *  produce is guidance towards a dead end. */
  readonly families: readonly string[]
  readonly dormant: boolean
}

export interface TemplateState {
  readonly segments: readonly string[]
  readonly cell: string
  readonly layout: string
  /** The composed container, nested to whatever depth it was designed at. */
  readonly container: string
  readonly levels: readonly LevelState[]
  readonly assets: readonly AssetState[]
  readonly dormant: boolean
}

const get = <T,>(key: string): T | undefined =>
  (window as { ioc?: { get?: (k: string) => T } }).ioc?.get?.(key)

export class TemplateAuthorDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'presentation'
  override description =
    'Layout author — the one reader and writer behind the docked layout tool window.'

  #open = false
  /** Whether the targets window is showing. Its read walks the hive for the
   *  seating, so it is gated exactly like the designer's. */
  #targetsOpen = false
  #bound = false
  #gen = 0
  #targetsGen = 0
  /** Which level the designer is pointing at. Viewing state, not design. */
  #selected: string[] = []

  protected override heartbeat = async (): Promise<void> => {
    if (this.#bound) return
    this.onEffect<{ open?: boolean }>(TEMPLATE_VIEW_STATE, payload => {
      this.#open = payload?.open === true
      if (this.#open) void this.#publish()
    })
    this.onEffect<{ segments?: string[]; name?: string }>('template:target', payload => {
      void this.#target(payload?.segments, payload?.name)
    })
    this.onEffect<{ segments?: string[]; path?: string[]; name?: string }>('template:nest', payload => {
      void this.#nest(payload?.segments, payload?.path, payload?.name)
    })
    this.onEffect<{ segments?: string[]; path?: string[] }>('template:unnest', payload => {
      void this.#unnest(payload?.segments, payload?.path)
    })
    this.onEffect<{ segments?: string[]; path?: string[]; name?: string; value?: string }>(
      'template:set-var', payload => {
        void this.#setVar(payload?.segments, payload?.path, payload?.name, payload?.value)
      })
    this.onEffect<{ segments?: string[]; path?: string[] }>('template:turn', payload => {
      void this.#turn(payload?.segments, payload?.path)
    })
    this.onEffect<{ open?: boolean }>(TARGETS_VIEW_STATE, payload => {
      this.#targetsOpen = payload?.open === true
      if (this.#targetsOpen) void this.#publishTargets()
    })
    this.onEffect<{ segments?: string[]; path?: string[]; family?: string; name?: string }>(
      'targets:name', payload => {
        void this.#name(payload?.segments, payload?.path, payload?.family, payload?.name)
      })
    this.onEffect<{ segments?: string[]; path?: string[] }>('targets:clear', payload => {
      void this.#name(payload?.segments, payload?.path, '', '')
    })
    this.onEffect<{ segments?: string[]; name?: string }>('template:save', payload => {
      void this.#save(payload?.segments, payload?.name)
    })
    this.onEffect<{ name?: string }>('template:forget', payload => {
      void this.#forget(payload?.name)
    })
    this.onEffect(CREATIONS_CHANGED, () => { if (this.#open) void this.#publish() })
    this.onEffect<{ segments?: string[] }>('template:clear', payload => {
      void this.#clear(payload?.segments)
    })
    this.onEffect<{ segments?: string[]; path?: string[] }>('template:select', payload => {
      this.#selected = this.#path(payload?.path)
      void this.#publishSelection(this.#subject(payload?.segments))
    })
    this.onEffect('decorations:changed', () => {
      if (this.#open) void this.#publish()
      // A seating is a decoration. The targets window is the one surface that
      // shows who is answering, so it is the one that has to re-read when the
      // answer changes.
      if (this.#targetsOpen) void this.#publishTargets()
    })
    window.ioc?.get<EventTarget>('@hypercomb.social/Lineage')
      ?.addEventListener?.('change', this.#lineageChange)
    this.#bound = true
    // The creations live in a pool, so they outlive the session that made
    // them. One sweep, here: the roster announces itself when it lands and the
    // panel re-reads through the same door as every other change.
    void sweepCreationPool()
  }

  protected override dispose(): void {
    window.ioc?.get<EventTarget>('@hypercomb.social/Lineage')
      ?.removeEventListener?.('change', this.#lineageChange)
  }

  readonly #lineageChange = (): void => {
    if (this.#open) void this.#publish()
    if (this.#targetsOpen) void this.#publishTargets()
  }

  #here(): string[] {
    return [...(get<LineageShape>('@hypercomb.social/Lineage')?.explorerSegments?.() ?? [])]
  }

  /** The container an intent names, defaulting to the one on screen, so the
   *  panel never has to know where it is. */
  #subject(segments: readonly string[] | undefined): string[] {
    const named = (segments ?? []).map(s => String(s ?? '')).filter(Boolean)
    return named.length ? named : this.#here()
  }

  #path(path: readonly string[] | undefined): string[] {
    return (path ?? []).map(s => String(s ?? '')).filter(Boolean)
  }

  // ── the read ───────────────────────────────────────────────────────

  async #publish(): Promise<void> {
    const gen = ++this.#gen
    const state = await this.#read(this.#here())
    if (gen !== this.#gen) return
    EffectBus.emit(TEMPLATE_STATE, state)
  }

  async #read(segments: readonly string[]): Promise<TemplateState> {
    const assets: AssetState[] = [
      ...knownTemplates().map((template): AssetState => ({
        kind: 'piece',
        name: template.name,
        glyph: templateContainer(template, miniatureVars(template)),
        // THE SAME FUNCTION THE CREATIONS USE. This was `template.holes.length`
        // — every hole, the self hole included — while a creation counted only
        // the holes a part can be seated into, and the two numbers sat side by
        // side on one shelf: a `rail` piece said 2 where a creation saved from
        // a bare `rail` said 1, for the same shape. One rule, one function, so
        // the two halves cannot drift apart again.
        holes: openHoles(nodeOf(template)),
      })),
      ...await this.#creationAssets(),
    ]

    const empty: TemplateState = {
      segments: [...segments],
      cell: segments.at(-1) ?? '',
      layout: '', container: '', levels: [], assets,
      dormant: isBehaviorDormant(TEMPLATE_TARGET_KIND, segments),
    }
    // The ROOT reads like anywhere else. It has a location signature, it can
    // carry a decoration, and it is a container by every test that matters.
    const bound = await resolveTemplateAt(segments)
    if (!bound) return empty

    // Every conventional name resolved in one pass, so the pure composer can
    // write each hole's target without ever awaiting.
    const targets = await targetsIn(bound.node)
    return {
      ...empty,
      layout: bound.template.name,
      container: composeLayout(bound.node, targets).html,
      levels: levelsOf(bound.node),
    }
  }

  /**
   * The shelf's second half — what this participant has made.
   *
   * Each is drawn by resolving its arrangement and shrinking every level, so a
   * creation's chip is the design rather than its name in a box. One whose
   * tree cannot be resolved is not offered at all: a chip that plants nothing
   * is worse than a gap.
   */
  async #creationAssets(): Promise<AssetState[]> {
    const out: AssetState[] = []
    for (const creation of knownCreations()) {
      const node = await readArrangement(creation.pieceSig)
      if (!node) continue
      out.push({
        kind: 'creation',
        name: creation.name,
        glyph: creationGlyph(node),
        holes: openHoles(node),
      })
    }
    return out
  }

  /**
   * THE DRAG THAT MAKES A THING — what is on the pane becomes one asset on the
   * shelf, under a name, with every level and every measurement kept whole.
   *
   * It saves the SIGNATURE the container already reads through, so the
   * creation and what is on screen are the same arrangement rather than a copy
   * that starts drifting the moment either one is touched.
   */
  async #save(segments: readonly string[] | undefined, name: string | undefined): Promise<void> {
    const subject = this.#subject(segments)
    const bound = await resolveTemplateAt(subject)
    if (!bound) return
    const wanted = String(name ?? '').trim() || subject.at(-1) || bound.template.name
    const creation = await saveCreation(wanted, bound.pieceSig)
    if (!creation) return
    EffectBus.emit('activity:log', {
      message: `Saved the ${creation.name} layout`, icon: 'dashboard',
    })
    await this.#publish()
  }

  /** Take one off the shelf. The arrangement itself is untouched — see
   *  layout-creations.ts on why forgetting is not deleting. */
  async #forget(name: string | undefined): Promise<void> {
    if (!name) return
    await forgetCreation(name)
    await this.#publish()
  }

  // ── the targets read ───────────────────────────────────────────────

  async #publishTargets(): Promise<void> {
    const gen = ++this.#targetsGen
    const state = await this.#readTargets(this.#here())
    if (gen !== this.#targetsGen) return
    EffectBus.emit(TARGETS_STATE, state)
  }

  async #readTargets(segments: readonly string[]): Promise<TargetsState> {
    const empty: TargetsState = {
      segments: [...segments],
      cell: segments.at(-1) ?? '',
      layout: '', container: '', holes: [], families: this.#families([]),
      dormant: isBehaviorDormant(TEMPLATE_TARGET_KIND, segments),
    }
    const bound = await resolveTemplateAt(segments)
    if (!bound) return empty

    const holes = await holeTargetsOf(bound.node)
    const [seated, answering] = await Promise.all([
      this.#seating(segments),
      this.#answering(holes),
    ])

    return {
      ...empty,
      layout: bound.template.name,
      container: composeLayout(bound.node, await targetsIn(bound.node)).html,
      families: this.#families(holes.map(hole => hole.family)),
      holes: holes.map((hole): HoleState => {
        const member = seated.get(hole.slot)
        return {
          ...hole,
          filledBy: member?.name ?? '',
          filledAt: member?.segments ?? [],
          answers: hole.target ? (answering.get(hole.target) ?? []) : [],
        }
      }),
    }
  }

  /**
   * Which child is in which hole, right now.
   *
   * The same read `composeDivision` does when it actually seats them —
   * enrolment order within this container's division group IS the slot index.
   * Anything that got this from a different source would tell the participant
   * one thing and the page would show another.
   */
  async #seating(
    segments: readonly string[],
  ): Promise<Map<number, { name: string; segments: readonly string[] }>> {
    const out = new Map<number, { name: string; segments: readonly string[] }>()
    try {
      const store = get<StoreShape>('@hypercomb.social/Store')
      const history = get<HistoryShape>('@diamondcoreprocessor.com/HistoryService')
      if (!store?.getResourceLocal || !history) return out
      const group = await divisionGroupOf(segments)
      if (!group?.sig) return out
      const here = segments.join('\0')
      const wanted = new Set([group.sig])
      for (const cell of await enrolledCells(history, store, [group.sig])) {
        if (cell.segments.join('\0') === here) continue
        const at = orderIn(cell, wanted)
        // A member with no position is not in a hole — it is in the set and
        // unplaced, which is a different thing and must not be drawn as seated.
        if (!Number.isFinite(at) || out.has(at)) continue
        out.set(at, { name: cell.name, segments: cell.segments })
      }
    } catch { /* a cold read means "nothing seated yet", never a broken window */ }
    return out
  }

  /**
   * Who could fill each named hole — every artifact in the hive wearing that
   * hole's meaning.
   *
   * ONE walk for every hole, not one per hole: `enrolledCells` takes a set and
   * memoizes on it, so asking for eight interfaces separately is eight walks
   * of the whole hive to produce what one pass already holds.
   */
  async #answering(
    holes: readonly HoleTarget[],
  ): Promise<Map<string, readonly string[]>> {
    const out = new Map<string, string[]>()
    const sigs = [...new Set(holes.map(hole => hole.target).filter(Boolean))]
    if (sigs.length === 0) return out
    try {
      const store = get<StoreShape>('@hypercomb.social/Store')
      const history = get<HistoryShape>('@diamondcoreprocessor.com/HistoryService')
      if (!store?.getResourceLocal || !history) return out
      const wanted = new Set(sigs)
      for (const cell of await enrolledCells(history, store, sigs)) {
        for (const enrolled of cell.enrollments) {
          if (!wanted.has(enrolled.sig)) continue
          const held = out.get(enrolled.sig) ?? []
          held.push(cell.name)
          out.set(enrolled.sig, held)
        }
      }
    } catch { /* nobody is answering yet — an empty list says exactly that */ }
    return out
  }

  /** The families this hive can actually produce, plus any already in use.
   *  A behaviour declares `visual:<family>:artifact` and is thereby a maker of
   *  that family — there is no registry to keep in step, which is the point of
   *  matching on the kind. */
  #families(inUse: readonly string[]): readonly string[] {
    const found = new Set<string>([DEFAULT_HOLE_FAMILY])
    try {
      const registry = get<VisualBeeRegistry>('@diamondcoreprocessor.com/VisualBeeRegistry')
      for (const bee of registry?.all?.() ?? []) {
        const family = artifactFamilyOf(bee.decorationKind)
        if (family) found.add(family)
      }
    } catch { /* the built-in family alone is a working editor */ }
    for (const family of inUse) if (family) found.add(family)
    return [...found].sort()
  }

  /**
   * Name a hole, or take its name away.
   *
   * A MERKLE UPDATE like every other edit here: the level mints a variant of
   * its layout, the chain above it re-mints, and the layout the variant was
   * made from is not touched — see hole-target.ts on why naming a hole cannot
   * edit a shared template in place.
   */
  async #name(
    segments: readonly string[] | undefined,
    path: readonly string[] | undefined,
    family: string | undefined,
    name: string | undefined,
  ): Promise<void> {
    const subject = this.#subject(segments)
    const where = this.#path(path)
    if (!where.length) return
    const bound = await resolveTemplateAt(subject)
    if (!bound) return
    const meaning = String(name ?? '').trim()
      ? holeMeaning(String(family ?? ''), String(name ?? ''))
      : ''
    const next = withMeaningAt(bound.node, where, meaning)
    if (next === bound.node) return
    await commitArrangement(subject, next)
    await this.#publishTargets()
    if (this.#open) await this.#publish()
  }

  /**
   * The selected level, with a preview of it under every value of every axis.
   *
   * One preview per VALUE, not per combination: twenty-four small renders
   * rather than a combinatorial wall, each holding the other axes at what this
   * level already says. That makes the gallery and the editor the same object —
   * every picture is both an illustration of a value and the control that
   * chooses it.
   */
  async #publishSelection(segments: readonly string[]): Promise<void> {
    const bound = await resolveTemplateAt(segments)
    const node = bound ? nodeAt(bound.node, this.#selected) : null
    if (!node) { EffectBus.emit(TEMPLATE_SELECTED, null); return }

    // The level's own configuration, at chip scale: hole extents as shares so
    // the arrangement reads in a small box, and the container clipped on the
    // one axis a percentage cannot reach.
    const ground = { ...miniatureVars(node.template), ...configurationVarsOf(node.vars) }

    EffectBus.emit<SelectionState>(TEMPLATE_SELECTED, {
      segments: [...segments],
      path: [...this.#selected],
      layout: node.template.name,
      axes: CONFIGURATION_AXES.map(axis => ({
        name: axis.name,
        values: axis.values.map(value => ({
          value,
          active: configurationVarsOf(node.vars)[axis.name] === value
            || (!configurationVarsOf(node.vars)[axis.name]
                && defaultFor(node, axis.name) === value),
          preview: templateContainer(node.template, { ...ground, [axis.name]: value }),
        })),
      })),
    })
  }

  // ── the intents ────────────────────────────────────────────────────

  async #target(segments: readonly string[] | undefined, name: string | undefined): Promise<void> {
    const subject = this.#subject(segments)
    if (!name) return
    // A CREATION LANDS WHOLE. `targetTemplate` starts a fresh one-level
    // arrangement, which is right for a piece and would throw away everything
    // that makes a creation a creation — so a creation is committed as the
    // tree it already is.
    const creation = findCreation(name)
    if (creation) {
      const node = await readArrangement(creation.pieceSig)
      if (node) await commitArrangement(subject, node)
    } else {
      await targetTemplate(subject, name)
    }
    await this.#publish()
  }

  /**
   * Put a layout in the hole at `path`.
   *
   * Deliberately independent of what is IN that hole — nothing has to be there,
   * and nothing that is there is disturbed. That is what makes the nesting
   * unbounded: a hole is a place a shape can go, and a shape is a thing that
   * has holes.
   */
  async #nest(
    segments: readonly string[] | undefined,
    path: readonly string[] | undefined,
    name: string | undefined,
  ): Promise<void> {
    const subject = this.#subject(segments)
    const where = this.#path(path)
    if (!where.length || !name) return
    // A PIECE arrives declaring NOTHING of its own: it inherits every
    // measurement from the level above until somebody changes one here. A
    // CREATION arrives declaring everything, because its measurements ARE the
    // design — that is the whole difference between the two types.
    const planted = await this.#planted(name)
    if (!planted) return
    const bound = await resolveTemplateAt(subject)
    if (!bound) return
    await commitArrangement(subject, withNodeAt(bound.node, where, planted))
    await this.#publish()
  }

  /** What a drop of `name` puts in a hole. A creation can never take a
   *  piece's name (`freeCreationName`), so the two lookups can never both
   *  answer and the order is not a preference. */
  async #planted(name: string): Promise<LayoutNode | null> {
    const creation = findCreation(name)
    if (creation) return readArrangement(creation.pieceSig)
    const template = await findTemplate(name)
    return template ? nodeOf(template, {}) : null
  }

  async #unnest(
    segments: readonly string[] | undefined,
    path: readonly string[] | undefined,
  ): Promise<void> {
    const subject = this.#subject(segments)
    const where = this.#path(path)
    if (!where.length) return
    const bound = await resolveTemplateAt(subject)
    if (!bound) return
    await commitArrangement(subject, withNodeAt(bound.node, where, null))
    await this.#publish()
  }

  async #setVar(
    segments: readonly string[] | undefined,
    path: readonly string[] | undefined,
    name: string | undefined,
    value: string | undefined,
  ): Promise<void> {
    const subject = this.#subject(segments)
    if (!name) return
    const bound = await resolveTemplateAt(subject)
    if (!bound) return
    await commitArrangement(
      subject,
      withVarAt(bound.node, this.#path(path), name, String(value ?? '')),
    )
    await this.#publish()
    await this.#publishSelection(subject)
  }

  /**
   * A QUARTER-TURN OF ONE LEVEL.
   *
   * It writes `direction`, which is all a turn is — see layout-template.ts on
   * why nothing about a hole has to be rewritten on the way round. So this is
   * `#setVar` with the value worked out here instead of handed in, and it is
   * a separate intent for exactly that reason: the panel presses a button that
   * says "turn", and what a turn IS stays on this side, with the layouts.
   */
  async #turn(
    segments: readonly string[] | undefined,
    path: readonly string[] | undefined,
  ): Promise<void> {
    const subject = this.#subject(segments)
    const bound = await resolveTemplateAt(subject)
    if (!bound) return
    const where = this.#path(path)
    // A path names a level only when something is nested there; one that names
    // a PANE has no container to turn, and turning the level above it instead
    // would move a container the participant was not pointing at.
    const level = nodeAt(bound.node, where)
    if (!level) return
    await commitArrangement(
      subject,
      withVarAt(bound.node, where, 'direction', turnedDirection(level.template, level.vars)),
    )
    await this.#publish()
    await this.#publishSelection(subject)
  }

  async #clear(segments: readonly string[] | undefined): Promise<void> {
    const subject = this.#subject(segments)
    await removeTemplateTarget(subject)
    await this.#publish()
  }
}

/** Every level of an arrangement, depth first, each addressed by the hole path
 *  that reaches it. The designer shows the properties of whichever one is
 *  selected, so it needs them all rather than asking for one at a time. */
export function levelsOf(root: LayoutNode): LevelState[] {
  const out: LevelState[] = []
  const walk = (node: LayoutNode, path: readonly string[]): void => {
    out.push({
      path: [...path],
      layout: node.template.name,
      flow: node.template.flow,
      turn: turnOf(node.template, node.vars),
      // Measurements replaced with ones suited to a chip, configuration kept:
      // the first is a length that means nothing at this scale, the second is
      // which way the container runs, which IS the shape.
      glyph: templateContainer(node.template, {
        ...miniatureVars(node.template),
        ...configurationVarsOf(node.vars),
      }),
      variables: variablesOf(node.template).map(name => ({
        name,
        value: node.vars[name] ?? '',
      })),
    })
    for (const [key, child] of Object.entries(node.nested)) walk(child, [...path, key])
  }
  walk(root, [])
  return out
}

const _templateAuthor = new TemplateAuthorDrone()
window.ioc.register('@TemplateAuthorDrone', _templateAuthor)

/** What an axis says when the level says nothing — the flow's own shorthand,
 *  which is what `configurationOf` would resolve to. */
function defaultFor(node: LayoutNode, axis: string): string {
  const config = configurationOf(node.template, {})
  switch (axis) {
    case 'direction': return config.direction
    case 'wrap': return config.wrap
    case 'justify': return config.justify
    case 'align': return config.align
    case 'align-content': return config.alignContent
    default: return ''
  }
}
