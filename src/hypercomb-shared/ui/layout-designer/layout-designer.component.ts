// hypercomb-shared/ui/layout-designer/layout-designer.component.ts
//
// THE LAYOUT DESIGNER — a docked palette, and a workspace it points at.
//
// Opened by `/template` (`template:open`). It docks LEFT and PUSHES THE
// WORKSPACE IN from that edge, so the two never overlap: the panel reserves
// its width through `hcDockInset`, and the workspace pins its own left edge to
// `--hc-inset-left`. What is left over is the whole of the rest of the
// viewport, and everything centres in THAT — not in the viewport, which would
// put the middle of the design underneath the palette.
//
// ── THREE THINGS, AND ONLY ONE OF THEM IS THIS WINDOW ───────────────────
//
//   THE WORKSPACE  flush to the remaining viewport, like a canvas
//                  application. It is the ground.
//   THE PANE       the TARGET CONTAINER you are designing — a rectangle
//                  centred in the workspace, resized from the one grip at its
//                  bottom right. Its size is chrome: nothing about it is
//                  stored in the hive.
//   THE LAYOUTS    generic pieces. They depend on nothing; they only hold
//                  other pieces. Drag one onto a hole and it nests there — to
//                  any depth, and whether or not anything is in that hole.
//
// Content is not designed here and this window never touches it.
//
// ── THE HIVE IS NOT UNDERNEATH, BUT THE HEADER STAYS ────────────────────
//
// A design surface with hex tiles showing through it is unreadable, and the
// tiles are not what is being designed. But the header — and the command line
// inside it — has to stay above: this window is a place you work, not a place
// you are trapped.
//
// So the canvas is covered rather than suppressed. `ModeRegistry`'s
// `view:active` would hide it, and take the header with it; there is no
// "keeps-header" mode. The workspace is already ABOVE the reparented canvas
// (the surface host sits at z-index 100002, the canvas at 59989), so an opaque
// ground is all it takes — and it is not the thing `_canvas-suppress.scss`
// forbids, which is a per-widget `#pixi-host` rule. Nothing here touches the
// canvas at all; it simply is not on top.
//
// ── THE DRAG MUST BE INVISIBLE TO THE HIVE ──────────────────────────────
//
// `LinkDropWorker` listens on `document` and claims ANY drag whose types
// include `text/plain` — it then arms the landing ring and the ghost tile, so
// dragging a layout chip made the hive offer to make a tile out of it. The
// opt-out is type-based and already established in this codebase: carry a
// PRIVATE MIME and never set `text/plain`. Every other document-level listener
// gates on `Files` or on its own custom type, so one non-matching type silences
// all of them. `stopPropagation` alone is not enough — the latch is set by the
// first dragover that reaches `document` — but it is added too, because a drag
// inside this window is nobody else's business.
//
// ── IT READS NOTHING ITSELF ─────────────────────────────────────────────
//
// Shell UI must not import essentials, and a second reader of an arrangement
// would drift from the renderer's. TemplateAuthorDrone is the one reader; this
// window renders `template:state` (sticky, so opening mid-session hydrates)
// and emits intents back. Every write is an effect, never a layer touch.

import { registerShellSurface } from '../../core/shell-surface-registry'
import {
  Component, ElementRef, computed, effect, signal, untracked, viewChild,
  type OnDestroy,
} from '@angular/core'
import { EffectBus } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'
import { DockInsetDirective } from '../dock-inset/dock-inset.directive'
import { HcDockedPanelDirective } from '../docked-panel/hc-docked-panel.directive'
import { RawHtmlDirective } from './raw-html.directive'
import { signalSession } from '../window-session'
import type { SettingRow } from '../docked-panel/panel-settings'
import {
  DEFAULT_BOX, boxStyle, parseBox, resizeCentred,
  type CanvasBox, type Handle,
} from './canvas-box'
import {
  drillByWheel, drillSelection, stepForKey, walkSelection, wheelNotch,
  type Selectable,
} from './select-walk'

/** Keyed so overlapping suppressions do not release one another. */
const KEYBOARD_REASON = 'layout-pane'

/** One level of the arrangement, addressed by the hole path that reaches it. */
interface LevelState {
  path: string[]
  layout: string
  flow: string
  /** Which quarter this level stands at — 0 for the way its layout is drawn,
   *  then one per clockwise turn. The arrow on the turn button is this times
   *  ninety degrees, and nothing here decides what a turn means. */
  turn: number
  /** This level drawn small, wearing its own configuration. Handed over
   *  rather than looked up: the palette holds the arrangement as DRAWN, and a
   *  level standing on its side is not that. */
  glyph: string
  variables: { name: string; value: string }[]
}

/** ONE AXIS OF THE FLEXBOX CONFIGURATION, with a live preview of THIS
 *  container under each of its values. The picture is the control: choosing
 *  between `space-around` and `space-evenly` is a matter of looking at them.
 *  Built by the one reader (template-author.drone.ts) from the same pure
 *  builder that draws the real container, so a preview can never advertise an
 *  arrangement the layout does not make. */
/** One draggable layout, of either type.
 *
 *  A `piece` is a built-in arrangement — what you build out of. A `creation`
 *  is one you built and dragged back onto the shelf, kept whole. The shelf
 *  shows one type at a time (see `shelf`), because a wall of chips where two
 *  different kinds of thing look alike is the thing this filter exists to
 *  stop. */
interface AssetState {
  kind?: 'piece' | 'creation'
  name: string
  glyph: string
  holes: number
}

/** Which half of the shelf is showing. */
type ShelfType = 'piece' | 'creation'

interface TemplateStateMsg {
  segments?: string[]
  cell?: string
  layout?: string
  container?: string
  levels?: LevelState[]
  assets?: AssetState[]
  dormant?: boolean
}

const BOX_KEY = 'hc:layout-canvas-box'
const COLUMNS_KEY = 'hc:layout-columns'
/** Which half of the shelf you were last looking at. Chrome, not design. */
const SHELF_KEY = 'hc:layout-shelf'
/** How tall the properties are, in pixels. Chrome, not design: it says how
 *  much of the window you are giving the shelf, and it never reaches the hive. */
const INSPECTOR_KEY = 'hc:layout-inspector-h'

/** The properties may not eat the whole window, and they may not be crushed
 *  out of usefulness either — the map plus one slider has a floor. */
const INSPECTOR_MIN = 150
/** What the shelf keeps for itself no matter how far the split is dragged. */
const SHELF_MIN = 120

/** THE TWO TYPES OF PROPERTY.
 *
 *  A container's own measurements are FLEXBOX: the gap between its panes and
 *  the padding around them. Everything else a level declares is named after a
 *  HOLE — one pane's measurement — and that is the second type. `variablesOf`
 *  (layout-template.ts) emits them in exactly that order, so the split is a
 *  membership test against this pair rather than a positional guess. */
const CONTAINER_MEASURES: readonly string[] = ['space', 'padding']

/** How many layouts sit across the shelf. `auto` fits as many as the panel is
 *  wide enough for; a number pins it.
 *
 *  It is a setting of THE TOOL WINDOW, not of the layout being designed —
 *  which is why it lives in the panel's own gear popover rather than anywhere
 *  near the properties. Nothing about it reaches the hive. */
const COLUMN_CHOICES: readonly { value: string; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: '2', label: '2' },
  { value: '3', label: '3' },
  { value: '4', label: '4' },
  { value: '6', label: '6' },
  { value: '8', label: '8' },
]

/** THE DRAG'S OWN TYPE. Deliberately not `text/plain` — see the header. It
 *  carries the layout name only so a drag starts at all (Firefox needs one
 *  non-empty entry); every handler here reads `dragging()` instead. */
const LAYOUT_DRAG_TYPE = 'application/x-hypercomb-layout'

/** THE OTHER DIRECTION. A drag that carries the PANE — what you have designed
 *  — back to the shelf, where letting go makes it one asset. Its own type, so
 *  a design can never be dropped into one of its own holes and a layout chip
 *  can never be dropped on the shelf. */
const CREATION_DRAG_TYPE = 'application/x-hypercomb-creation'

/** Slider bounds per variable, in rem. Gutters are small, rails are not. */
const RANGE: Readonly<Record<string, readonly [number, number]>> = {
  space: [0, 4],
  padding: [0, 6],
}
const DEFAULT_RANGE: readonly [number, number] = [0, 32]

/** The smallest a chip may be drawn. Small enough for a dense row of icons —
 *  pin the column count and they scale to whatever is asked for — and large
 *  enough that an arrangement is still legible at the floor. In `auto` the 31%
 *  share dominates above about 100px of shelf, so this is the hard bottom
 *  rather than the usual answer. */
const MIN_CHIP = 32

/** ONE handle, bottom right.
 *
 *  Eight was a reflex from window chrome, and window chrome moves edges. This
 *  pane does not: every handle did the same thing — change the size about a
 *  fixed centre — so seven of them were the same control drawn seven more
 *  times, cluttering the corners of the very thing being looked at. */
const HANDLES: readonly Handle[] = ['se']

@Component({
  selector: 'hc-layout-designer',
  standalone: true,
  imports: [TranslatePipe, DockInsetDirective, HcDockedPanelDirective, RawHtmlDirective],
  templateUrl: './layout-designer.component.html',
  styleUrls: ['./layout-designer.component.scss'],
})
export class LayoutDesignerComponent implements OnDestroy {

  readonly visible = signal(false)

  /** Parked while the hive is covered — the pane size and the selected level
   *  both survive being put away. */
  readonly session = signalSession(
    this.visible,
    open => EffectBus.emit('template:view-state', { open }),
    { dismiss: () => this.dismiss(), close: () => this.close() },
  )

  // ── what the drone tells us ───────────────────────────────────────
  readonly segments = signal<string[]>([])
  readonly cell = signal('')
  readonly layout = signal('')
  readonly levels = signal<LevelState[]>([])
  readonly assets = signal<AssetState[]>([])
  /** How the active container BEHAVES — direction, wrap, justify, align.
   *  These used to be a second window docked on the far side of the screen;
   *  they are properties of the selected container, so they are in the
   *  properties. */
  readonly dormant = signal(false)
  readonly #container = signal('')

  // ── this window's own state ───────────────────────────────────────
  readonly box = signal<CanvasBox>(DEFAULT_BOX)
  /** Which level the properties are editing, as a hole path. Empty = the root.
   *  Participant-local: where you are looking is not part of the design. */
  readonly selectedPath = signal<string[]>([])
  readonly dragging = signal<string | null>(null)
  /** True while the PANE is being dragged towards the shelf. The shelf lights
   *  up as a target only then — every other drag is going the other way. */
  readonly offering = signal(false)

  /** WHICH TYPE THE SHELF IS SHOWING. Pieces are what you build out of;
   *  creations are what you built. One at a time, remembered. */
  readonly shelf = signal<ShelfType>(
    safeRead(SHELF_KEY) === 'creation' ? 'creation' : 'piece',
  )

  /** The shelf's own contents. An asset that predates the two types is a
   *  piece — that is what everything was. */
  readonly shownAssets = computed(() =>
    this.assets().filter(asset => (asset.kind ?? 'piece') === this.shelf()))

  /** How many of each, for the tabs. A tab that says nothing about whether
   *  there is anything behind it makes you press it to find out. */
  readonly pieceCount = computed(() =>
    this.assets().filter(asset => (asset.kind ?? 'piece') === 'piece').length)
  readonly creationCount = computed(() =>
    this.assets().filter(asset => asset.kind === 'creation').length)

  /** Columns across the shelf: `auto`, or a pinned count. */
  readonly columns = signal(safeRead(COLUMNS_KEY) ?? 'auto')

  /** How tall the properties stand, in pixels. `null` is their natural
   *  height — the shape the window had before anybody dragged the split. */
  readonly inspectorHeight = signal<number | null>(number(safeRead(INSPECTOR_KEY)))

  /** WHICH MEASURE THE ONE SLIDER IS DRIVING, when you picked it by hand.
   *  Cleared whenever a pane is picked, because picking a pane IS picking its
   *  measure — the slider follows the thing you are pointing at, and a
   *  remembered chip that quietly outranks the pane would make it stop. */
  readonly picked = signal<string | null>(null)

  readonly handles = HANDLES
  readonly bound = computed(() => this.layout() !== '')
  readonly paneStyle = computed(() => boxStyle(this.box()))

  /** `auto` asks for as many columns as fit, with a floor of 110px and a
   *  ceiling of three (three at 31% each is 93% plus gaps). The percentage is
   *  of the SHELF, not the viewport — a docked panel is resized by hand, and a
   *  viewport query would answer a question nobody asked. */
  readonly columnTemplate = computed(() => {
    const pinned = Number(this.columns())
    return Number.isInteger(pinned) && pinned > 0
      ? `repeat(${pinned}, 1fr)`
      : `repeat(auto-fill, minmax(max(${MIN_CHIP}px, 31%), 1fr))`
  })

  /** What this window puts in its own gear popover. A thunk, because the
   *  directive re-reads it on every repaint and the value has to be current. */
  readonly settingsRows = (): SettingRow[] => [{
    kind: 'choice',
    key: 'layout-columns',
    label: 'Layout columns',
    value: this.columns(),
    options: COLUMN_CHOICES,
    hint: 'How many layouts sit across the shelf.',
    pick: (value: string) => {
      this.columns.set(value)
      safeWrite(COLUMNS_KEY, value)
    },
  }]

  /** THE ACTIVE CONTAINER — the level the properties are about.
   *
   *  A hole path either names a level (something is nested there) or it names
   *  a PANE of the level above it. So the active container is the DEEPEST
   *  level the path passes through, and one click on a hole means both things
   *  at once: walk into the layout nested there, or point at the pane that is
   *  there instead. That is what makes the workspace and the properties map
   *  agree without either of them knowing about the other.
   *
   *  It used to be an exact match with a fall back to the root, which quietly
   *  wrote a nested container's measurements onto the root whenever an empty
   *  hole was selected. */
  readonly selectedLevel = computed<LevelState | null>(() => {
    const want = this.selectedPath()
    const all = this.levels()
    let deepest: LevelState | null = all[0] ?? null
    for (const level of all) {
      if (level.path.length > want.length) continue
      if (level.path.some((key, index) => key !== want[index])) continue
      if (!deepest || level.path.length > deepest.path.length) deepest = level
    }
    return deepest
  })

  /** The PANE being pointed at inside the active container, if the path went
   *  one step past it. Nothing when a level was selected outright. */
  readonly focusedPane = computed<string | null>(() => {
    const level = this.selectedLevel()
    const path = this.selectedPath()
    if (!level || path.length <= level.path.length) return null
    return path[level.path.length] ?? null
  })

  /** TYPE ONE — the container's own flexbox measurements. */
  readonly containerMeasures = computed(() =>
    (this.selectedLevel()?.variables ?? []).filter(v => CONTAINER_MEASURES.includes(v.name)))

  /** TYPE TWO — the pane being pointed at. `measured: false` says the pane
   *  takes the remainder and has nothing to move, which is an answer rather
   *  than an empty row. */
  readonly divisionMeasure = computed(() => {
    const pane = this.focusedPane()
    if (!pane) return null
    const found = (this.selectedLevel()?.variables ?? []).find(v => v.name === pane)
    return found ? { ...found, measured: true } : { name: pane, value: '', measured: false }
  })

  /** WHAT THE ONE SLIDER IS ON. The pane you are pointing at wins, then the
   *  chip you pressed, then the container's first measurement — so the slider
   *  always has something under it the moment a container is selected. */
  readonly activeVariable = computed<{ name: string; value: string } | null>(() => {
    const division = this.divisionMeasure()
    if (division?.measured) return { name: division.name, value: division.value }
    const all = this.containerMeasures()
    const want = this.picked()
    return all.find(v => v.name === want) ?? all[0] ?? null
  })

  /** The active container drawn small — the same pure builder the palette chip
   *  uses, so the map can never advertise a shape the layout does not make.
   *
   *  IT COMES FROM THE LEVEL, not from the palette. Looking the layout's NAME
   *  up on the shelf found the arrangement as DRAWN — every primitive is a row
   *  — so a level that had been turned was mapped lying the wrong way, and
   *  every pane in the map was then somewhere the pane on the workspace was
   *  not. A level is the only thing that knows how it stands. */
  readonly mapGlyph = computed(() => this.selectedLevel()?.glyph ?? '')

  /** How far the turn button's arrow is rotated: one quarter per turn,
   *  clockwise, which is exactly the order flexbox spells the four
   *  directions in. */
  readonly turnDegrees = computed(() => (this.selectedLevel()?.turn ?? 0) * 90)

  /** The properties keep their natural height until the split is dragged. */
  readonly inspectorStyle = computed(() => {
    const height = this.inspectorHeight()
    return height === null ? '' : `${height}px`
  })

  /** Angular refuses `viewChild` on an ES-private field (NG1053), so this is
   *  the one member here that cannot wear the house `#` — `protected` keeps it
   *  off the public surface without breaking the compiler's rule. */
  protected readonly stage = viewChild<ElementRef<HTMLElement>>('stage')
  /** Where the active container's miniature is mounted — see `stage` for why
   *  this one cannot wear the house `#` either. */
  protected readonly map = viewChild<ElementRef<HTMLElement>>('map')
  /** The properties half itself — the thing the split drag measures against.
   *  It stands whether or not anything is bound, which the map does not. */
  protected readonly inspector = viewChild<ElementRef<HTMLElement>>('inspector')

  #holeCleanup: (() => void)[] = []
  #mapCleanup: (() => void)[] = []
  #resizeCleanup: (() => void) | null = null
  #splitCleanup: (() => void) | null = null
  /** Whether the pane currently holds the hive's shortcuts down. */
  #keyboardHeld = false

  /** Wheel movement not yet spent on a step. See `wheelNotch`. */
  #wheelCarried = 0

  #busCleanup: (() => void)[] = []

  /** THE ONE DOOR for selection. Every place that changes which level is
   *  active comes through here, so the flex editor on the other side can never
   *  be looking at a different container than the one lit on the canvas. */
  #select(path: readonly string[]): void {
    this.selectedPath.set([...path])
    EffectBus.emit('template:select', { segments: this.segments(), path: [...path] })
  }

  constructor() {
    this.box.set(parseBox(safeRead(BOX_KEY)))

    // The bus replays its last value to late subscribers, so a reload would
    // otherwise re-deliver the last `/template` and the window would open by
    // itself. The stamp separates "you just asked" from "you asked once".
    //
    // And the payload is an INTENT, not a flip: a toggle carried on a
    // replaying bus can get out of parity, and then every press means the
    // opposite of what it says. Setting a stated value is idempotent.
    this.#busCleanup.push(EffectBus.on<{ open?: boolean; at?: number }>('template:open', payload => {
      if (Math.abs(Date.now() - (payload?.at ?? 0)) > 10_000) return
      const open = payload?.open === true
      if (open === this.visible()) return
      this.visible.set(open)
      EffectBus.emit('template:view-state', { open })
      if (open) this.#select(this.selectedPath())
    }))

    this.#busCleanup.push(EffectBus.on<TemplateStateMsg>('template:state', state => {
      this.segments.set((state?.segments ?? []).map(String))
      this.cell.set(String(state?.cell ?? ''))
      this.layout.set(String(state?.layout ?? ''))
      this.levels.set(state?.levels ?? [])
      this.assets.set(state?.assets ?? [])
      this.dormant.set(state?.dormant === true)
      this.#container.set(String(state?.container ?? ''))
      // Re-announce on every state change: the level is the same, but what it
      // says about itself may not be.
      this.#select(this.selectedPath())
    }))

    // Mount the arrangement and wire its holes as drop targets. It depends on
    // the STATE ONLY.
    //
    // `selectedPath` is read through `untracked` on purpose. Angular tracks
    // signal reads through every call made inside a reactive function, so
    // reading it in `#bindHoles` would make a plain hole click tear down
    // `host.innerHTML` and rebuild every listener — and mid-drag it would
    // destroy the very element sitting between `dragenter` and `drop`. A
    // highlight is not a reason to rebuild the thing being highlighted, so it
    // is painted imperatively instead.
    effect(() => {
      const html = this.#container()
      const cell = this.cell()
      const host = this.stage()?.nativeElement
      if (!host) return
      const picked = untracked(() => this.selectedPath()).join('/')
      this.#unbindHoles()
      host.innerHTML = html
      if (html) this.#bindHoles(host, cell, picked)
      this.#paintSelection()
    })

    // THE ACTIVE CONTAINER, INSIDE THE PROPERTIES. Same rule as the stage: the
    // glyph is what rebuilds it, and the highlight is painted rather than
    // bound — a pane lighting up must not tear down the element a drop is
    // being aimed at.
    effect(() => {
      const glyph = this.mapGlyph()
      const host = this.map()?.nativeElement
      if (!host) return
      const base = untracked(() => this.selectedLevel()?.path ?? [])
      const pane = untracked(() => this.focusedPane())
      this.#unbindMap()
      host.innerHTML = glyph
      if (glyph) this.#bindMap(host, base, pane)
    })

    // The highlight alone. Cheap, and it never touches the tree.
    effect(() => {
      const pane = this.focusedPane()
      const host = this.map()?.nativeElement
      if (!host) return
      for (const node of Array.from(host.querySelectorAll<HTMLElement>('[data-hc-hole]'))) {
        node.classList.toggle('is-picked', node.getAttribute('data-hc-hole') === pane)
      }
    })
  }

  ngOnDestroy(): void {
    this.#releaseKeyboard()
    for (const off of this.#busCleanup) off()
    this.#busCleanup = []
    this.#unbindHoles()
    this.#unbindMap()
    this.#resizeCleanup?.()
    this.#splitCleanup?.()
  }

  // ── the pane ──────────────────────────────────────────────────────

  /** Wire every hole the arrangement declares. The only contract is the
   *  attributes the composer writes, so this never has to know a layout. */
  #bindHoles(host: HTMLElement, cell: string, picked: string): void {
    const nodes = Array.from(host.querySelectorAll<HTMLElement>('[data-hc-hole]'))
    for (const node of nodes) {
      const path = (node.getAttribute('data-hc-path') ?? '').split('/').filter(Boolean)
      node.classList.add('ld-hole')
      if (path.join('/') === picked) node.classList.add('is-picked')

      // A hole with a layout nested in it already shows that layout; one
      // without shows its name, so an empty arrangement still reads.
      if (node.hasAttribute('data-hc-self')) {
        node.classList.add('is-self')
        node.appendChild(face('ld-hole-fill', cell || 'this page'))
      } else if (!node.querySelector('[data-hc-container]')) {
        node.appendChild(face('ld-hole-name', path.at(-1) ?? ''))
      }

      const enter = (event: DragEvent): void => {
        event.preventDefault()
        event.stopPropagation()
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
        for (const other of nodes) other.classList.remove('is-over')
        node.classList.add('is-over')
      }
      const leave = (event: DragEvent): void => {
        event.stopPropagation()
        node.classList.remove('is-over')
      }
      const drop = (event: DragEvent): void => {
        event.preventDefault()
        event.stopPropagation()
        node.classList.remove('is-over')
        this.#nest(path)
      }
      const pick = (event: MouseEvent): void => {
        event.stopPropagation()
        // CLICK AGAIN TO GO ONE LAYER IN. A point is over a stack of
        // containers, not one, so the click advances down that stack rather
        // than guessing which layer was meant — see drillSelection.
        //
        // A HOLE PATH IS NOT ALWAYS A LEVEL: it names one only when something
        // is nested there, otherwise the level is the container the hole is
        // IN. The stack is built from the elements themselves for exactly that
        // reason — selecting a raw hole path let `selectedLevel` fall back to
        // the root, and the properties then quietly edited a different
        // container than the one that lit up.
        //
        // Take the keyboard too: someone who clicks a container and then
        // presses an arrow means to move from THERE, and a first press that
        // goes nowhere reads as the keys not working at all.
        node.closest<HTMLElement>('.ld-pane')?.focus()
        const next = drillSelection(this.#stackAt(node), this.selectedPath())
        this.#select(next ?? path.slice(0, -1))
        for (const other of nodes) other.classList.toggle('is-picked', other === node)
        this.#paintSelection()
      }

      node.addEventListener('dragover', enter)
      node.addEventListener('dragenter', enter)
      node.addEventListener('dragleave', leave)
      node.addEventListener('drop', drop)
      node.addEventListener('click', pick)
      this.#holeCleanup.push(() => {
        node.removeEventListener('dragover', enter)
        node.removeEventListener('dragenter', enter)
        node.removeEventListener('dragleave', leave)
        node.removeEventListener('drop', drop)
        node.removeEventListener('click', pick)
      })
    }
  }

  /** THE SELECTED CONTAINER IS UNMISTAKABLE.
   *
   *  Painted, not bound — the same reason the hover highlight is: making it
   *  reactive would rebuild the pane and destroy whatever the pointer is in
   *  the middle of. Exactly one container carries the mark, and it is the one
   *  the properties and the flex editor are both pointed at. */
  #paintSelection(): void {
    const host = this.stage()?.nativeElement
    if (!host) return
    for (const node of Array.from(host.querySelectorAll<HTMLElement>('[data-hc-container]'))) {
      node.classList.remove('is-selected')
    }
    this.#levelElement()?.classList.add('is-selected')
  }

  /**
   * TAB AND THE ARROWS MOVE THE SELECTION.
   *
   * Only while the pane itself has focus, and only for the six keys it
   * actually uses — everything else is left alone, including every key a
   * participant might be typing somewhere. Taking Tab is deliberate: on a
   * surface whose whole content is one arrangement, "the next thing" IS the
   * next container, and handing it to the browser's focus order would step out
   * of the design and onto the chrome.
   *
   * The arrows ask geometry, not the tree — see select-walk.ts.
   */
  onKey(event: KeyboardEvent): void {
    // A press inside a control belongs to that control. The resize grips are
    // buttons sitting in the pane, and someone on one of those is aiming at
    // the pane's SIZE, not at which container is selected.
    const from = event.target as HTMLElement | null
    if (from?.closest('button, input, textarea, select, [contenteditable]')) return

    // TURN THE SELECTION. Free to take: the pane holds the hive's shortcuts
    // down while it has focus (see `paneFocus`), and a bare letter here is a
    // letter nobody else is listening for. With a modifier it belongs to the
    // browser — reload is Ctrl+R.
    if ((event.key === 'r' || event.key === 'R')
      && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault()
      event.stopPropagation()
      this.rotate()
      return
    }

    const step = stepForKey(event.key, event.shiftKey)
    if (!step) return
    const items = this.#selectables()
    if (items.length === 0) return
    const next = walkSelection(items, this.selectedPath(), step)
    // A move with nowhere to go is not a key we should have swallowed — let
    // Tab out of the pane rather than trapping focus in it.
    if (!next) { if (step !== 'next' && step !== 'previous') event.preventDefault(); return }
    event.preventDefault()
    event.stopPropagation()
    this.#select(next)
    this.#paintSelection()
  }

  /**
   * WHILE THE PANE HAS FOCUS, THE HIVE'S SHORTCUTS STAND DOWN.
   *
   * The arrows are not free: `KeyMapService` binds them in the default layer
   * to `navigation.move*`, and `TileSelectionDrone` walks the leader tile one
   * hex per press. That listener is on `window` in the CAPTURE phase, so
   * `stopPropagation` on this element cannot reach it — without this, every
   * arrow moved the design AND the hive underneath it.
   *
   * Suppression is the existing answer and the honest one. The keymap already
   * stands down for a focused text field, because someone working inside a
   * surface is not aiming shortcuts at the hive; a pane you are walking with
   * the keyboard is exactly that surface, and it stands down as a class rather
   * than by unbinding four commands and hoping the list stays right.
   *
   * Reason-keyed, the way the command palette does it, so overlapping
   * suppressions do not release each other. Tab needs none of this — nothing
   * global claims it.
   */
  paneFocus(): void {
    if (this.#keyboardHeld) return
    this.#keyboardHeld = true
    EffectBus.emit('keymap:suppress', { reason: KEYBOARD_REASON })
  }

  /** Moving between the pane's own children is not leaving it. */
  paneBlur(event: FocusEvent): void {
    const to = event.relatedTarget as Node | null
    if (to && (event.currentTarget as HTMLElement).contains(to)) return
    this.#releaseKeyboard()
  }

  /** Unconditional, and called from close and teardown as well as blur: a
   *  suppression left behind deafens the whole hive, and `focusout` never
   *  arrives when the window is destroyed out from under the focus. */
  #releaseKeyboard(): void {
    if (!this.#keyboardHeld) return
    this.#keyboardHeld = false
    EffectBus.emit('keymap:unsuppress', { reason: KEYBOARD_REASON })
  }

  /** The containers standing over one point, OUTERMOST FIRST — what a click
   *  and the wheel both walk. Built from the elements rather than from the
   *  arrangement because a hole holds a container only sometimes, and the DOM
   *  is where that is already settled.
   *
   *  Takes whatever the pointer was actually on, so the same reader serves a
   *  click bound to a hole and a wheel that landed on a label inside one. */
  #stackAt(from: HTMLElement): readonly (readonly string[])[] {
    const host = this.stage()?.nativeElement
    if (!host?.contains(from)) return []
    const stack: (readonly string[])[] = []
    const seen = new Set<string>()
    const add = (node: HTMLElement): void => {
      const path = this.#pathOfContainer(node)
      if (seen.has(path.join('/'))) return
      seen.add(path.join('/'))
      stack.push(path)
    }
    // Anything nested in the hole under the pointer is the deepest step of
    // all, and it is a CHILD of that hole rather than an ancestor of the
    // pointer — which is the one step the walk upward cannot reach.
    const nested = from.closest<HTMLElement>('.ld-hole')
      ?.querySelector<HTMLElement>('[data-hc-container]')
    if (nested) add(nested)
    for (let el: HTMLElement | null = from; el && host.contains(el); el = el.parentElement) {
      if (el.matches('[data-hc-container]')) add(el)
    }
    return stack.reverse()
  }

  /**
   * THE WHEEL DRILLS, WITHOUT ANYTHING BEING SELECTED FIRST.
   *
   * Put the pointer anywhere in the design and turn the wheel: down goes into
   * the stack under it, up comes back out, and it stops at both ends rather
   * than coming round. Nothing has to be clicked first — see `drillByWheel`.
   *
   * The pane takes the keyboard on the way, because a selection made here is
   * a selection the arrows should carry on from.
   *
   * The wheel is always consumed, including at the ends: this is the hive's
   * zoom gesture, and letting a spent scroll through would zoom the world out
   * from under a design you were only inspecting.
   */
  onWheel(event: WheelEvent): void {
    event.preventDefault()
    event.stopPropagation()
    const turn = wheelNotch(this.#wheelCarried, event.deltaY)
    this.#wheelCarried = turn.carried
    if (turn.step === 0) return
    const stack = this.#stackAt(event.target as HTMLElement)
    if (stack.length === 0) return
    const next = drillByWheel(stack, this.selectedPath(), turn.step > 0 ? 'in' : 'out')
    if (!next) return
    ;(event.currentTarget as HTMLElement).focus()
    this.#select(next)
    this.#paintSelection()
  }

  /** Where a container sits: the hole path that reaches it, empty for the
   *  root. The same reading `#selectables` and `#levelElement` agree on. */
  #pathOfContainer(node: HTMLElement): readonly string[] {
    const hole = node.parentElement?.closest<HTMLElement>('[data-hc-path]')
    return (hole?.getAttribute('data-hc-path') ?? '').split('/').filter(Boolean)
  }

  /** Every container the keyboard can land on, in document order, with where
   *  it is drawn. Read from the DOM because that is where the truth about
   *  position is — the arrangement is data, but its geometry is not. */
  #selectables(): readonly Selectable[] {
    const host = this.stage()?.nativeElement
    if (!host) return []
    return Array.from(host.querySelectorAll<HTMLElement>('[data-hc-container]')).map(node => {
      const rect = node.getBoundingClientRect()
      return {
        path: this.#pathOfContainer(node),
        rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
      }
    })
  }

  #unbindHoles(): void {
    for (const off of this.#holeCleanup) off()
    this.#holeCleanup = []
  }

  // ── the map ───────────────────────────────────────────────────────

  /** Wire the panes of the miniature. A miniature carries hole KEYS and no
   *  paths — it is one container, drawn on its own — so the path is the active
   *  container's path plus the key, which is exactly the path the workspace
   *  would have handed back for the same pane. The two surfaces therefore
   *  select the same thing without either importing the other's idea of one. */
  #bindMap(host: HTMLElement, base: readonly string[], pane: string | null): void {
    const nodes = Array.from(host.querySelectorAll<HTMLElement>('[data-hc-hole]'))
    for (const node of nodes) {
      const key = node.getAttribute('data-hc-hole') ?? ''
      node.classList.add('ld-map-pane')
      if (key === pane) node.classList.add('is-picked')
      node.setAttribute('title', key)

      const pick = (event: MouseEvent): void => {
        event.stopPropagation()
        // Picking a pane IS picking its measure — drop any chip that was
        // pressed earlier so the slider follows the pointer.
        this.picked.set(null)
        this.#select([...base, key])
      }
      const over = (event: DragEvent): void => {
        event.preventDefault()
        event.stopPropagation()
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
        for (const other of nodes) other.classList.remove('is-over')
        node.classList.add('is-over')
      }
      const leave = (event: DragEvent): void => {
        event.stopPropagation()
        node.classList.remove('is-over')
      }
      const drop = (event: DragEvent): void => {
        event.preventDefault()
        event.stopPropagation()
        node.classList.remove('is-over')
        this.#nest([...base, key])
      }

      node.addEventListener('click', pick)
      node.addEventListener('dragover', over)
      node.addEventListener('dragenter', over)
      node.addEventListener('dragleave', leave)
      node.addEventListener('drop', drop)
      this.#mapCleanup.push(() => {
        node.removeEventListener('click', pick)
        node.removeEventListener('dragover', over)
        node.removeEventListener('dragenter', over)
        node.removeEventListener('dragleave', leave)
        node.removeEventListener('drop', drop)
      })
    }
  }

  #unbindMap(): void {
    for (const off of this.#mapCleanup) off()
    this.#mapCleanup = []
  }

  // ── the drag ──────────────────────────────────────────────────────

  startDrag(asset: AssetState, event: DragEvent): void {
    event.stopPropagation()
    this.dragging.set(asset.name)
    // The private type, and ONLY the private type. Adding `text/plain` back
    // "for compatibility" is exactly the bug — see the header.
    event.dataTransfer?.setData(LAYOUT_DRAG_TYPE, asset.name)
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy'
  }

  endDrag(event: DragEvent): void {
    event.stopPropagation()
    this.dragging.set(null)
    this.offering.set(false)
  }

  // ── the drag that makes a thing ───────────────────────────────────
  //
  // Everything above carries a shape from the shelf to the pane. This carries
  // the PANE to the shelf: what you have designed — every level, every
  // measurement — becomes one asset you can drop somewhere else whole.

  /** The pane's grip took a drag. */
  offerDesign(event: DragEvent): void {
    event.stopPropagation()
    if (!this.bound()) { event.preventDefault(); return }
    this.offering.set(true)
    event.dataTransfer?.setData(CREATION_DRAG_TYPE, this.cell() || this.layout())
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy'
  }

  /** The shelf accepts the pane, and nothing else. */
  allowKeep(event: DragEvent): void {
    if (!this.offering()) return
    event.preventDefault()
    event.stopPropagation()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
  }

  /**
   * The shelf took the design. It is named after the container it was designed
   * on, which is the name you would have typed; the drone makes it unique, and
   * a name is a thing you can change afterwards — a dialog in the middle of a
   * drag is not.
   */
  keepDesign(event: DragEvent): void {
    if (!this.offering()) return
    event.preventDefault()
    event.stopPropagation()
    this.offering.set(false)
    EffectBus.emit('template:save', {
      segments: this.segments(),
      name: this.cell() || this.layout(),
    })
    this.shelf.set('creation')
    safeWrite(SHELF_KEY, 'creation')
  }

  /** Show one half of the shelf. */
  showShelf(type: ShelfType): void {
    this.shelf.set(type)
    safeWrite(SHELF_KEY, type)
  }

  /** Take a creation off the shelf. The arrangement itself is untouched —
   *  other containers may still be reading it, and a signature is nobody's to
   *  delete. */
  forget(asset: AssetState, event: Event): void {
    event.preventDefault()
    event.stopPropagation()
    EffectBus.emit('template:forget', { name: asset.name })
  }

  allowDrop(event: DragEvent): void {
    event.preventDefault()
    event.stopPropagation()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
  }

  /** A hole took the drop: the layout nests there. Nothing has to be in that
   *  hole first — a hole is a place a shape can go, and a shape is a thing
   *  that has holes, which is the whole of why the nesting is unbounded. */
  #nest(path: readonly string[]): void {
    const name = this.dragging()
    this.dragging.set(null)
    if (!name || path.length === 0) return
    EffectBus.emit('template:nest', { segments: this.segments(), path: [...path], name })
    this.#select(path)
  }

  /** The workspace or the pane's own ground took the drop — outside every
   *  hole. That sets the ROOT arrangement, which is how a design starts. */
  dropOnPane(event: DragEvent): void {
    event.preventDefault()
    event.stopPropagation()
    const name = this.dragging()
    this.dragging.set(null)
    if (!name) return
    EffectBus.emit('template:target', { segments: this.segments(), name })
    this.#select([])
  }

  // ── the handles ───────────────────────────────────────────────────

  /**
   * Resize from a handle. The pane stays centred in the workspace, so this
   * only ever changes how big it is — never where it is, and never what is in
   * it. Nothing about the size reaches the hive: it is how close you are
   * standing, not part of the design.
   */
  grabHandle(handle: Handle, event: PointerEvent): void {
    event.preventDefault()
    event.stopPropagation()
    // A second press before the first release would otherwise strand the
    // earlier listeners on `window` forever.
    this.#resizeCleanup?.()
    ;(event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId)
    const start = { x: event.clientX, y: event.clientY }
    const from = this.box()

    const move = (moved: PointerEvent): void => {
      this.box.set(resizeCentred(from, handle, moved.clientX - start.x, moved.clientY - start.y, {
        width: this.#workspaceWidth(), height: this.#workspaceHeight(),
      }))
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      this.#resizeCleanup = null
      safeWrite(BOX_KEY, JSON.stringify(this.box()))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    this.#resizeCleanup = up
  }

  /** The pane's fractions are of the WORKSPACE, not the viewport — the panel
   *  has already pushed the workspace in from the left, and a drag measured
   *  against the whole screen would move the pane at the wrong rate. */
  #workspaceWidth(): number {
    const el = this.stage()?.nativeElement?.closest('.ld-workspace') as HTMLElement | null
    return el?.clientWidth || window.innerWidth
  }

  #workspaceHeight(): number {
    const el = this.stage()?.nativeElement?.closest('.ld-workspace') as HTMLElement | null
    return el?.clientHeight || window.innerHeight
  }

  // ── the split ─────────────────────────────────────────────────────

  /**
   * Drag the line between the shelf and the properties.
   *
   * The window still does not scroll as a whole — this moves where its two
   * halves meet, which is the thing that was actually wanted whenever the
   * properties ran off the bottom: a deep arrangement has more levels to point
   * at than a shallow one, and how much room that needs is not something the
   * layout can be asked.
   */
  grabSplit(event: PointerEvent): void {
    event.preventDefault()
    event.stopPropagation()
    this.#splitCleanup?.()
    ;(event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId)
    const from = this.#inspectorPixels()
    const startY = event.clientY

    const move = (moved: PointerEvent): void => {
      // Dragging UP grows the properties: the grip is on their top edge.
      this.#setInspector(from + (startY - moved.clientY))
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      this.#splitCleanup = null
      const height = this.inspectorHeight()
      if (height !== null) safeWrite(INSPECTOR_KEY, String(height))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    this.#splitCleanup = up
  }

  /** Back to the natural height — the shape before anybody dragged. */
  resetSplit(): void {
    this.inspectorHeight.set(null)
    safeWrite(INSPECTOR_KEY, '')
  }

  onSplitKey(event: KeyboardEvent): void {
    const step = event.key === 'ArrowUp' ? 16 : event.key === 'ArrowDown' ? -16 : 0
    if (!step) return
    event.preventDefault()
    this.#setInspector(this.#inspectorPixels() + step)
    const height = this.inspectorHeight()
    if (height !== null) safeWrite(INSPECTOR_KEY, String(height))
  }

  /** Clamped so neither half can be dragged out of existence. The ceiling is
   *  measured against the PANEL, not the viewport — the panel has a header the
   *  split may not climb into. */
  #setInspector(height: number): void {
    const panel = this.inspector()?.nativeElement?.closest('.ld-panel') as HTMLElement | null
    const room = (panel?.clientHeight ?? window.innerHeight) - SHELF_MIN
    this.inspectorHeight.set(Math.round(Math.max(INSPECTOR_MIN, Math.min(height, Math.max(INSPECTOR_MIN, room)))))
  }

  /** What the properties measure right now — the pinned height, or whatever
   *  their natural height turned out to be, so the first drag starts from
   *  where the pointer already is rather than jumping. */
  #inspectorPixels(): number {
    const pinned = this.inspectorHeight()
    if (pinned !== null) return pinned
    return this.inspector()?.nativeElement?.clientHeight || INSPECTOR_MIN
  }

  // ── the properties ────────────────────────────────────────────────

  /**
   * TURN THE ACTIVE CONTAINER A QUARTER.
   *
   * The panel presses a button that says "turn" and says nothing about what a
   * turn is — the layouts decide that (layout-template.ts), and the drone
   * works out which direction comes next. Otherwise the four quarters would be
   * spelled here as well, and two lists of the same four values in two
   * projects is one list that eventually disagrees with itself.
   *
   * It is aimed at the SELECTED LEVEL, so turning is the same gesture at every
   * depth: the level's own path, never the root, never the hole path that
   * happens to point at one of its panes.
   */
  rotate(): void {
    if (!this.bound()) return
    EffectBus.emit('template:turn', {
      segments: this.segments(),
      path: this.selectedLevel()?.path ?? [],
    })
  }

  /** Press a container measure. Only ever one of the two flexbox measures —
   *  a pane is picked on the map, not here. */
  pickMeasure(name: string): void {
    this.picked.set(name)
    // Step back out of the pane so the container's own measure is what the
    // slider is on; the active container itself does not change.
    const level = this.selectedLevel()
    if (level) this.#select(level.path)
  }

  min(name: string): number { return (RANGE[name] ?? DEFAULT_RANGE)[0] }
  max(name: string): number { return (RANGE[name] ?? DEFAULT_RANGE)[1] }

  /** The slider position for a value like `10rem`. A value a slider cannot
   *  represent — a `calc()` — reads as 0 and is shown as typed, never rounded
   *  into something the author did not write. */
  amount(value: string): number {
    return Number(/^(-?[\d.]+)/.exec(String(value ?? '').trim())?.[1] ?? 0)
  }

  unit(value: string): string {
    return /^-?[\d.]+([a-z%]*)$/i.exec(String(value ?? '').trim())?.[1] || 'rem'
  }

  /** Under the pointer the property is written straight onto the live level,
   *  so the layout moves under your hand with no round trip. */
  previewVar(name: string, event: Event, current: string): void {
    const next = `${(event.target as HTMLInputElement).value}${this.unit(current)}`
    this.#levelElement()?.style.setProperty(`--hc-layout-${name}`, next)
  }

  /** Letting go is the act. A measurement belongs to the LEVEL that declares
   *  it — the active container — never to the hole path that happened to point
   *  at one of its panes. */
  commitVar(name: string, event: Event, current: string): void {
    EffectBus.emit('template:set-var', {
      segments: this.segments(),
      path: this.selectedLevel()?.path ?? [],
      name,
      value: `${(event.target as HTMLInputElement).value}${this.unit(current)}`,
    })
  }

  /** The container element for the selected level — the root's own element, or
   *  the one drawn inside the hole the path names. */
  #levelElement(): HTMLElement | null {
    const host = this.stage()?.nativeElement
    if (!host) return null
    const path = this.selectedLevel()?.path ?? []
    if (path.length === 0) return host.firstElementChild as HTMLElement | null
    const hole = host.querySelector<HTMLElement>(`[data-hc-path="${cssEscape(path.join('/'))}"]`)
    return hole?.querySelector<HTMLElement>('[data-hc-container]') ?? null
  }

  // ── chrome ────────────────────────────────────────────────────────

  plug(name: string): void {
    EffectBus.emit('template:target', { segments: this.segments(), name })
    this.#select([])
  }

  /** Take the selected level back out. The root is unplugged instead — there
   *  is no level above it to leave it in. */
  removeLevel(): void {
    const path = this.selectedLevel()?.path ?? []
    if (path.length === 0) { EffectBus.emit('template:clear', { segments: this.segments() }); return }
    EffectBus.emit('template:unnest', { segments: this.segments(), path })
    this.#select(path.slice(0, -1))
  }

  /** Open the targets window on this container. An INTENT with a stamp, never
   *  a toggle — the bus replays its last value, and a flip carried on a
   *  replaying bus gets out of parity (see the designer's own `template:open`
   *  handler). */
  openTargets(): void {
    EffectBus.emit('targets:open', { open: true, at: Date.now() })
  }

  close(): void {
    this.#releaseKeyboard()
    this.visible.set(false)
    EffectBus.emit('template:view-state', { open: false })
  }

  /** One level back per press: climb out of the selected level, then close. */
  dismiss(): boolean {
    if (this.selectedPath().length === 0) return false
    this.#select(this.selectedPath().slice(0, -1))
    // The highlight is painted, not bound — clear it the same way it was set.
    const host = this.stage()?.nativeElement
    for (const node of Array.from(host?.querySelectorAll<HTMLElement>('.is-picked') ?? [])) {
      node.classList.remove('is-picked')
    }
    return true
  }
}

const face = (className: string, text: string): HTMLElement => {
  const span = document.createElement('span')
  span.className = className
  span.textContent = text
  return span
}

/** A hole key is a slug, but the path comes back off an attribute and a
 *  selector built from unescaped input is a selector somebody can break.
 *  `CSS.escape` is universal in every browser this ships to — a fallback here
 *  would be dead code pretending to be caution. */
const cssEscape = (value: string): string => CSS.escape(value)

/** Storage can throw outright in a private window or with site data blocked,
 *  and a pane that will not open because a preference could not be read is a
 *  worse failure than a pane at its default size. */
function safeRead(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}
/** A stored pixel height, or `null` for "never dragged". Anything unreadable
 *  is the same as never dragged — a pane that will not open because a
 *  preference is corrupt is the worse failure. */
function number(value: string | null): number | null {
  const parsed = Number(value)
  return value && Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function safeWrite(key: string, value: string): void {
  try { localStorage.setItem(key, value) } catch { /* nothing to do about it */ }
}

// Registry-fed shell surface — mounted by <hc-shell-surfaces>, never by an
// app.html tag (see shell-surface-registry.ts).
registerShellSurface({
  name: 'hc-layout-designer',
  owner: '@hypercomb.shared/LayoutDesignerComponent',
  component: LayoutDesignerComponent,
  order: 136,
})
