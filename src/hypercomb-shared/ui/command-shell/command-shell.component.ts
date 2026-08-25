// hypercomb-shared/ui/command-shell/command-shell.component.ts
//
// Shared presentational command-line shell — owns the visual layer (input,
// ghost text, suggestion dropdown, keyboard navigation) while delegating
// all business logic to the parent via inputs/outputs.

import { Component, computed, effect, ElementRef, inject, input, output, signal, ViewChild, type AfterViewInit, type OnDestroy } from '@angular/core'
import { TranslatePipe } from '../../core/i18n.pipe'

/** How long a view toggle must be held (no modifier) to count as a disable —
 *  the touch-friendly equivalent of a cmd/ctrl-click. */
const VIEW_TOGGLE_LONG_PRESS_MS = 500

@Component({
  selector: 'hc-command-shell',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './command-shell.component.html',
  styleUrls: ['./command-shell.component.scss']
})
export class CommandShellComponent implements AfterViewInit, OnDestroy {

  @ViewChild('shellInput', { read: ElementRef })
  private inputRef?: ElementRef<HTMLInputElement>

  /** Host element — used to anchor the fixed-position dropdown to the bar's
   *  on-screen rect (the dropdown must be fixed to escape the header chrome's
   *  overflow:hidden chain). */
  readonly #host = inject(ElementRef<HTMLElement>)
  #reflowTeardown?: () => void

  constructor() {
    // Re-anchor the dropdown each time it opens or switches single↔two-pane.
    // queueMicrotask defers to after the @if has rendered the element.
    effect(() => {
      if (this.effectiveShowCompletions()) {
        this.activeDetail()
        this.value()   // re-anchor to the caret as it advances with each keystroke
        queueMicrotask(() => this.#positionIntel())
      }
    })

    // Keep the highlighted row in view when navigating with the arrow keys —
    // otherwise the selection scrolls past the panel's edge and you can't see
    // what you're on. Standard autocomplete behaviour.
    effect(() => {
      this.activeIndex()
      if (!this.effectiveShowCompletions()) return
      queueMicrotask(() => {
        const el = this.#host.nativeElement.querySelector('.command-results li.active') as HTMLElement | null
        el?.scrollIntoView({ block: 'nearest' })
      })
    })

    // Whenever the OPTIONS change, the highlight goes back to the top match.
    // Clamping instead of resetting leaves the highlight parked on whatever
    // row that ordinal happens to hold in the new list — so Tab accepts an
    // item the user never looked at. Reset is the only stable rule.
    effect(() => {
      const key = this.#listKey()
      if (key === this.#lastListKey) return
      this.#lastListKey = key
      this.activeIndex.set(0)
    })
  }

  /** Last list fingerprint seen by the highlight-reset effect. */
  #lastListKey = ''

  /** Compute the dropdown's fixed screen coordinates from the command bar's
   *  rect and feed them in as CSS vars. Opens DOWN when the bar is in the top
   *  half of the viewport, UP when it's in the bottom half (the dev/web shells
   *  pin the bar to the bottom), so the list is always on-screen. */
  #positionIntel(): void {
    const host = this.#host.nativeElement
    const bar = host.querySelector('.command-bar') as HTMLElement | null
    const r = (bar ?? host).getBoundingClientRect()
    if (r.width === 0 && r.height === 0) return
    const vw = window.innerWidth || document.documentElement.clientWidth
    const vh = window.innerHeight || document.documentElement.clientHeight
    const isPhone = vw <= 599

    // Horizontal: line up the dropdown's left edge with the text CARET. With no
    // text the caret sits at the input start, so the list opens flush at the left
    // (against the controls); as you type it tracks the cursor. On phone it spans
    // the bar from the left instead (no room to offset).
    const anchorX = isPhone ? null : this.#caretScreenX()
    let left = anchorX ?? r.left
    left = Math.max(8, Math.min(left, vw - 224))   // keep ~14rem on-screen
    host.style.setProperty('--intel-left', `${Math.round(left)}px`)
    host.style.setProperty('--intel-width', `${Math.round(r.width)}px`)
    // Cap the panel to the space between its left edge and the viewport's right
    // edge so the two-pane (list + detail) can never run off the side.
    host.style.setProperty('--intel-maxw', `${Math.round(vw - left - 8)}px`)

    // Vertical: open UP off a bottom-anchored bar (dev/web pin it to the bottom),
    // DOWN off a top-anchored one. Snug (2px) against the bar.
    const openUp = r.top > vh / 2
    if (openUp) {
      host.style.setProperty('--intel-top', 'auto')
      host.style.setProperty('--intel-bottom', `${Math.round(vh - r.top + 10)}px`)
    } else {
      host.style.setProperty('--intel-bottom', 'auto')
      host.style.setProperty('--intel-top', `${Math.round(r.bottom + 2)}px`)
    }
  }

  /** Screen x-coordinate of the text caret inside the input — measured with a
   *  hidden mirror span carrying the input's resolved font, so the dropdown
   *  anchors under the cursor (at the input start when empty). Null when the
   *  input isn't available. */
  #caretScreenX(): number | null {
    const input = this.inputElement
    if (!input) return null
    const rect = input.getBoundingClientRect()
    const cs = getComputedStyle(input)
    const mirror = document.createElement('span')
    const s = mirror.style
    s.position = 'absolute'
    s.visibility = 'hidden'
    s.whiteSpace = 'pre'
    // Copy the longhands (the `font` shorthand reads back empty from computed style).
    s.fontFamily = cs.fontFamily
    s.fontSize = cs.fontSize
    s.fontWeight = cs.fontWeight
    s.fontStyle = cs.fontStyle
    s.letterSpacing = cs.letterSpacing
    const caret = input.selectionStart ?? input.value.length
    mirror.textContent = input.value.slice(0, caret)
    document.body.appendChild(mirror)
    const textWidth = mirror.getBoundingClientRect().width
    mirror.remove()
    const padLeft = parseFloat(cs.paddingLeft) || 0
    return rect.left + padLeft + textWidth - input.scrollLeft
  }

  private get inputElement(): HTMLInputElement | undefined {
    return this.inputRef?.nativeElement
  }

  // ── inputs from parent ──────────────────────────────────

  /** Filtered suggestion list to display in the dropdown. */
  readonly suggestions = input<readonly string[]>([])

  /** Placeholder text when input is empty. */
  readonly placeholder = input('')

  /** Full ghost text (overlaid as dim autocomplete hint). */
  readonly ghostValue = input('')

  /**
   * Name of the tile the pointer is currently over, echoed live in the line.
   * Empty string = nothing hovered (the parent clears it off `tile:hover`'s
   * "pointer left the grid" broadcast). Presentational only — the shell never
   * reads the hover itself.
   */
  readonly hoverEcho = input('')

  /** Whether to show the suggestion dropdown. Parent controls this. */
  readonly showSuggestions = input(false)

  /** Prefix of each suggestion that the user has typed (for highlight split). */
  readonly typedPrefix = input('')

  /** Optional descriptions keyed by suggestion name (shown right-aligned). */
  readonly descriptionMap = input<ReadonlyMap<string, string>>(new Map())

  /**
   * Detail for the CURRENTLY-ACTIVE suggestion, rendered in the right-hand
   * pane of the intellisense (the "to the right and vertically down" surface).
   * Null collapses the dropdown back to a single column — used for plain
   * cell-create where there's nothing extra to say. The parent recomputes it
   * from the active index, so arrowing up/down updates the pane live.
   */
  readonly activeDetail = input<{
    name: string
    kind?: string
    description?: string
    icon?: string
    /** Overlap metric — how many entities share this one. */
    count?: number
    /** Sub-options for a behaviour, listed vertically under the detail. */
    options?: readonly string[]
  } | null>(null)

  /** Optional color swatches keyed by suggestion name (CSS color string). */
  readonly colorMap = input<ReadonlyMap<string, string>>(new Map())

  /** Render the swatches as wide picture chips instead of colour dots — for
   *  maps whose values are whole backdrops (`/canvas`) rather than one colour. */
  readonly wideSwatches = input<boolean>(false)

  /** Active status indicators shown as pills on the right side of the input.
   *  `actionable` indicators are producer-owned attention entries: clicking
   *  activates their workflow without dismissing the underlying state. */
  readonly indicators = input<readonly {
    key: string
    icon: string
    label: string
    dismissable?: boolean
    actionable?: boolean
  }[]>([])

  /**
   * Whether the "open for subscribers" floating icon is rendered. When
   * false the slot is hidden entirely (no whitespace) — used to gate
   * the toggle on swarm-capable contexts only. Backed by SwarmDrone
   * via the parent; the shell stays presentational.
   */
  readonly showOpenForSubscribersToggle = input<boolean>(false)

  /** Current state of the open-for-subscribers toggle. */
  readonly openForSubscribers = input<boolean>(false)

  /** Optional aria-label override for the open-for-subscribers button. */
  readonly openForSubscribersLabel = input<string>('Allow anyone to subscribe to my hive')

  /** Whether the notes strip is currently open — lights the notes toggle. */
  readonly notesPanelOpen = input<boolean>(false)

  /** Aria-label / tooltip for the notes toggle. */
  readonly notesLabel = input<string>('notes')


  /** The chat window's open state — its toggle LEADS the standing-tools group
   *  (the chat window is the default companion view, so its switch comes
   *  first; the per-cell behaviour icons stay in their own group to the left). */
  readonly chatPanelOpen = input<boolean>(false)
  readonly chatLabel = input<string>('chat')

  /** The Beehaviors window's open state — lights the toggle that sits
   *  immediately right of views. Standing tool, never gated: the layer you
   *  are on always has beehaviors to look at, even if the answer is none. */
  readonly featuresPanelOpen = input<boolean>(false)
  readonly featuresLabel = input<string>('features')

  /** Material Symbol readout of the current pheromone reach — page /
   *  children / global. Same vocabulary as the controls-bar tag-scope
   *  button at the bottom; the parent owns the `tags:filter` mirror. */
  readonly pheromoneScopeIcon = input<string>('blur_on')

  /** Whether the pheromone panel is currently open — lights the pheromones toggle. */
  readonly pheromonePanelOpen = input<boolean>(false)

  /** Aria-label / tooltip for the pheromones button. */
  readonly pheromonesLabel = input<string>('pheromones')

  /** Show the MIC on the rail. Mobile only: dictation used to live on the
   *  mobile control bar, but the words it produces land in this text box, so
   *  the control belongs on the same rail as the other standing tools — where
   *  it rides the portrait icon row and stays reachable in landscape whenever
   *  the command line is open. Desktop keeps push-to-talk on the separate
   *  flush-right button (command-line's own `.mic-btn`). */
  readonly showMic = input<boolean>(false)

  /** Whether dictation is running — lights the mic. */
  readonly micActive = input<boolean>(false)

  /** Aria-label / tooltip for the mic. */
  readonly micLabel = input<string>('voice')

  /**
   * Available view-behavior toggles for the current node (e.g. website).
   * Rendered as stateful on/off Material icons on the right side, sourced
   * from VisualBeeRegistry via the parent's ViewBee subscription. The shell
   * stays presentational — it never reads the registry itself.
   */
  readonly viewToggles = input<readonly {
    view: string; icon: string; label: string; active: boolean
    /** The layer's `view:default` mark names this view — what it OPENS AS.
     *  Optional because the toggles come from a RUNTIME-LOADED bee: a shell
     *  running against an older essentials bundle simply reads undefined and
     *  marks nothing. */
    isDefault?: boolean
  }[]>([])

  // Arcade game toggles (Solomon's Key, Bubble Bobble, Arkanoid, …) are no
  // longer per-game header icons — they aggregate under the "games" launch
  // group, reached at /games or from `/sets`. See games-group.ts.

  /**
   * Briefly true when the user tried to pan or zoom while the view is held
   * in place (the pin toggle is on, or an overlay like the editor is open).
   * Drives a pin icon that flashes to the left of the right-side icons,
   * then fades. Parent owns the timing; the shell just renders the current
   * state.
   */
  readonly lockedFlash = input<boolean>(false)

  /** Aria-label / tooltip for the locked-flash icon. */
  readonly lockedLabel = input<string>('Pinned — unpin to pan or zoom')

  /**
   * Optional armed-resource preview — when set, the chevron is replaced
   * with this thumbnail (same box, no reflow). Clicking it dismisses the arm.
   */
  readonly armedResource = input<{ previewUrl: string; type: 'image' | 'youtube' | 'link' | 'document' } | null>(null)

  /**
   * WHAT THIS LINE IS ABOUT — the thing a gesture composed the command from,
   * shown in the same glyph slot as an armed resource.
   *
   * Deliberately NOT folded into `armedResource`, which the two share a box
   * with but nothing else: an armed resource is CARGO (bytes that attach to the
   * cell on Enter, and which make `#completeOnEnter` treat the typed text as a
   * finished name), whereas a subject is a LABEL — it commits nothing, and the
   * line it decorates wants its completions working normally. One slot, two
   * meanings, kept apart so neither inherits the other's commit behaviour.
   *
   * They can never both be live: arming is a drop that mints a tile HERE, a
   * subject is a drop that composed a command. Armed wins if it ever happens.
   */
  readonly subject = input<{ previewUrl?: string; label: string; icon?: string } | null>(null)

  /**
   * Which sigil the prompt slot wears when nothing is armed and no subject is
   * set: the chevron (tile mode — text lays tiles) or a slash (command stance —
   * the line is a register of commands). The parent owns the stance machine;
   * the shell only dresses for it, exactly as it does for armed/subject.
   */
  readonly promptSigil = input<'chevron' | 'slash' | 'question'>('chevron')

  /**
   * The utterance reading, as render segments covering the ENTIRE input text
   * in order (spans and the whitespace gaps between them). Non-null activates
   * the marks overlay: the input's own glyphs go transparent and this mirror
   * paints them instead — action words lit (each in its behaviour's own
   * color), ambiguity dashed, filler receding. The light is the contract:
   * what is lit is what fires. Null = no reading, input paints itself.
   */
  readonly readingMarks = input<readonly { text: string; role: string; color?: string }[] | null>(null)

  // ── outputs to parent ───────────────────────────────────

  /** Emitted on every input change (after leading-space strip). */
  readonly valueChange = output<string>()

  /** Emitted when Enter is pressed (not Shift+Enter). */
  readonly commit = output<string>()

  /** Emitted when a suggestion is accepted by CLICK — the user picked that
   *  exact rendered row, so the string they saw is the truth. */
  readonly completionAccepted = output<string>()

  /**
   * Emitted when a suggestion is accepted from the KEYBOARD (Tab/ArrowRight).
   * Deliberately carries no payload: `suggestions` is a template-bound input,
   * so it only refreshes when change detection runs — a keystroke landing
   * before that flush leaves the shell holding the PREVIOUS keystroke's list.
   * Accepting from it replaced the line with a completion of text the user had
   * already typed past. The parent owns the computed and is never stale, so it
   * resolves the item itself; the shell only reports WHICH row is highlighted.
   */
  readonly completionAcceptRequested = output<number>()

  /**
   * Emitted for keydown events the shell does NOT consume internally
   * (i.e. everything except Escape/Up/Down/Tab/ArrowRight when suggestions
   * are visible). Parent can handle Shift+Enter, special modes, etc.
   */
  readonly shellKeydown = output<KeyboardEvent>()

  /** The caret entered (true) or left (false) the input. The hive stands its
   *  hover down while the caret is here — see `command:composing`. */
  readonly caretPresence = output<boolean>()

  /** Emitted when an indicator pill is clicked (to turn it off). */
  readonly indicatorDismiss = output<string>()

  /** Emitted when a producer-owned attention indicator is activated. */
  readonly indicatorActivate = output<string>()

  /** Emitted when the user clicks the armed-resource thumbnail to dismiss it. */
  readonly armedResourceDismiss = output<void>()

  /** Emitted when the bare prompt sigil is clicked — one click toggles the
   *  stance (chevron ↔ slash). Fires only when nothing is armed and no
   *  subject occupies the slot; the parent owns the stance machine. */
  readonly promptSigilToggle = output<void>()

  /** Emitted when the subject chip is clicked — "this line is no longer about
   *  that". Clears the chip only; the composed text stays, because deleting
   *  what someone is midway through typing is not what dismissing a label means. */
  readonly subjectDismiss = output<void>()

  /** Emitted when the open-for-subscribers icon is clicked. Parent
   *  flips swarm.setOpenForSubscribers — the shell never touches IoC. */
  readonly openForSubscribersToggle = output<void>()

  /** Emitted when the notes toggle is clicked. Parent flips the strip
   *  via the `notes:panel` command channel — the shell stays presentational. */
  readonly notesToggle = output<void>()


  readonly chatToggle = output<void>()

  readonly featuresToggle = output<void>()

  /** Emitted when the pheromones button is clicked. Parent toggles the
   *  pheromone panel (`tags:view-open` / `tags:view-close`) — the shell
   *  stays presentational. */
  readonly pheromonesToggle = output<void>()

  /** Mic pressed / released. The parent owns the dictation state machine
   *  (tap = toggle listening, hold = push-to-talk) — the shell only reports
   *  the press, exactly as it does for every other rail control. */
  readonly micPress = output<void>()
  readonly micRelease = output<void>()

  /**
   * Emitted when a view toggle is clicked. `view` is the view name (e.g.
   * `'website'`); `disable` is true for a long-press — the "back to tiles,
   * permanently" gesture that turns the view OFF for the tile. A plain click
   * (`disable:false`) just enters / leaves the view while keeping the tile
   * sticky. Parent forwards it to ViewBee.
   */
  readonly viewToggle = output<{ view: string; disable: boolean }>()

  /**
   * A cmd/ctrl-click on a view toggle: make this view the LAYER'S DEFAULT —
   * the face it opens as when you walk in — or clear the mark when it is
   * already the default. Three gestures, three meanings, on one icon: click
   * enters, ctrl-click decides how the place opens, long-press turns the
   * view off here. The parent owns the write (it knows where we stand).
   */
  readonly viewDefault = output<{ view: string }>()

  /** Pending long-press timer for the view toggle, and a latch so the
   *  mouseup that follows a long-press / modifier-click doesn't ALSO emit a
   *  plain toggle. */
  #viewTogglePressTimer: ReturnType<typeof setTimeout> | null = null
  #viewToggleDisabled = false

  /** Pointer-down on the mic. Capture the pointer so a finger that slides off
   *  the button still delivers its release — otherwise a hold that drifts
   *  leaves dictation running with nothing to stop it. `preventDefault` keeps
   *  the press from stealing focus out of the text box. */
  onMicDown(e: PointerEvent): void {
    e.preventDefault()
    ;(e.target as HTMLElement)?.setPointerCapture?.(e.pointerId)
    this.micPress.emit()
  }

  /** Pointer-down on a view toggle. A cmd/ctrl-click sets (or clears) this
   *  layer's default view immediately; a plain press starts the long-press
   *  timer and defers the toggle to mouseup.
   *
   *  The modifier used to be a second way to say "off", duplicating the
   *  long-press that is still here. Deciding what the place OPENS AS had no
   *  gesture at all outside the Beehaviors panel — and the panel refuses
   *  inherited rows, so on many children it could not be reached. The
   *  modifier now carries the meaning that had nowhere to live. */
  onViewToggleDown(e: MouseEvent, view: string): void {
    e.preventDefault()
    this.#viewToggleDisabled = false
    if (e.metaKey || e.ctrlKey) {
      this.#viewToggleDisabled = true
      this.viewDefault.emit({ view })
      return
    }
    this.#viewTogglePressTimer = setTimeout(() => {
      this.#viewToggleDisabled = true
      this.#viewTogglePressTimer = null
      this.viewToggle.emit({ view, disable: true })
    }, VIEW_TOGGLE_LONG_PRESS_MS)
  }

  /** Pointer-up on a view toggle. Emits the plain toggle unless a long-press
   *  or modifier-click already fired the disable. */
  onViewToggleUp(view: string): void {
    this.#clearViewTogglePress()
    if (this.#viewToggleDisabled) { this.#viewToggleDisabled = false; return }
    this.viewToggle.emit({ view, disable: false })
  }

  /** Pointer left the toggle before release — cancel the pending long-press. */
  onViewToggleCancel(): void {
    this.#clearViewTogglePress()
    this.#viewToggleDisabled = false
  }

  #clearViewTogglePress(): void {
    if (this.#viewTogglePressTimer) {
      clearTimeout(this.#viewTogglePressTimer)
      this.#viewTogglePressTimer = null
    }
  }

  /** Template handler for clicks on the prompt-glyph slot: armed resource
   *  dismisses, subject dismisses, and the bare sigil toggles the stance. */
  onArmedGlyphMouseDown = (e: MouseEvent): void => {
    if (this.armedResource()) {
      e.preventDefault()
      this.armedResourceDismiss.emit()
      return
    }
    if (this.subject()) {
      e.preventDefault()
      this.subjectDismiss.emit()
      return
    }
    e.preventDefault()
    this.promptSigilToggle.emit()
  }

  /** Initial(s) for a subject with no picture — the same fallback the portals
   *  index draws, so a row that reads as its monogram there still reads as
   *  itself here rather than collapsing to a generic glyph. */
  subjectMonogram(): string {
    const label = this.subject()?.label ?? ''
    const w = label.trim().split(/\s+/).filter(Boolean)
    if (!w.length) return '·'
    if (w.length === 1) return [...w[0]].slice(0, 2).join('').toUpperCase()
    return ([...w[0]][0] + [...w[1]][0]).toUpperCase()
  }

  /** Badge glyph for armed-resource type (shown as small corner overlay). */
  armedBadge(): string {
    const t = this.armedResource()?.type
    if (t === 'youtube') return '▶'
    if (t === 'link') return '↗'
    if (t === 'document') return '📄'
    return ''
  }

  // ── internal state ────────────────────────────────���─────

  readonly value = signal('')
  readonly activeIndex = signal(0)
  readonly suppressed = signal(false)

  /**
   * Invisible spacer that pushes the hover echo to the caret's column: the
   * typed text, or the ghost completion when one is showing (the echo must
   * clear the dim suggestion, not sit on top of it), plus one space.
   */
  /**
   * The placeholder actually handed to the input. A hovered tile takes the
   * line's empty space for as long as the pointer is on it: "share intent…"
   * and the echo occupy the SAME column, and the two on top of each other are
   * unreadable. The prompt comes straight back when the pointer leaves.
   */
  readonly effectivePlaceholder = computed(() => (this.hoverEcho() || this.ghostSuffix()) ? '' : this.placeholder())

  /**
   * The ONLY part of the ghost that is ever painted: what the completion adds
   * BEYOND the typed text. The typed prefix is carried by an invisible mirror
   * (.ghost-pad = the live input value), so the input's own glyphs and the
   * ghost can never be drawn on top of each other — the alignment bug class
   * (doubled letters, ghost mashed into the placeholder) is structurally
   * impossible rather than tuned away. Empty unless the ghost genuinely
   * extends the current value, and while the input is scrolled (the pad can't
   * mirror scrollLeft, so the column would lie).
   */
  readonly ghostSuffix = computed(() => {
    const ghost = this.ghostValue()
    if (!ghost) return ''
    const typed = this.value()
    if (ghost.length <= typed.length || !ghost.startsWith(typed)) return ''
    if (this.inputScrollLeft() > 0) return ''
    return ghost.slice(typed.length)
  })

  /** Horizontal scroll of the input — a scrolled line hides the ghost. */
  readonly inputScrollLeft = signal(0)

  readonly echoPad = computed(() => {
    const typed = this.value()
    const ghost = this.ghostValue()
    const base = ghost.length > typed.length && ghost.startsWith(typed) ? ghost : typed
    return base ? `${base} ` : ''
  })

  readonly effectiveShowCompletions = computed(() =>
    this.showSuggestions() && this.suggestions().length > 0 && !this.suppressed()
  )

  /**
   * Content fingerprint of the suggestion list. The list recomputes (new array
   * identity) on unrelated signal churn, so identity is useless for deciding
   * "did the options actually change?" — the CONTENT is what matters.
   * The separator is NUL so no suggestion can forge another list's key.
   */
  readonly #listKey = computed(() => this.suggestions().join('\u0000'))

  // ── lifecycle ───────────────────────────────────────────

  ngAfterViewInit(): void {
    this.inputElement?.focus()
    // Keep the fixed dropdown anchored if the viewport changes while it's open.
    const reflow = (): void => { if (this.effectiveShowCompletions()) this.#positionIntel() }
    window.addEventListener('resize', reflow)
    window.addEventListener('scroll', reflow, true)
    this.#reflowTeardown = (): void => {
      window.removeEventListener('resize', reflow)
      window.removeEventListener('scroll', reflow, true)
    }
  }

  ngOnDestroy(): void {
    this.#reflowTeardown?.()
  }

  // ── public API for parent ───────────────────────────────

  getActiveIndex = (): number => this.activeIndex()

  /** Set the input value programmatically (e.g. after completion). */
  setValue(v: string): void {
    const el = this.inputElement
    if (!el) return
    el.value = v
    // A programmatic value change means a NEW set of options — start the
    // highlight at the top match rather than wherever the last list left it.
    this.activeIndex.set(0)
    this.syncSignalsFromDom()
  }

  /** Clear the input and reset state. */
  clear(): void {
    const el = this.inputElement
    if (el) el.value = ''
    this.value.set('')
    this.activeIndex.set(0)
    this.suppressed.set(false)
  }

  /** Focus the input element. */
  focus(): void {
    this.inputElement?.focus()
  }

  /** Blur the input element — used to exit "command-line mode" (e.g. Escape
   *  on an empty line) so keystrokes go back to the canvas. */
  blur(): void {
    this.inputElement?.blur()
  }

  /** Place caret at end of input. */
  placeCaretAtEnd(): void {
    const el = this.inputElement
    if (!el) return
    queueMicrotask(() => el.setSelectionRange(el.value.length, el.value.length))
  }

  /** Select the entire current value — used when entering capture mode with a prefill. */
  selectAll(): void {
    const el = this.inputElement
    if (!el) return
    queueMicrotask(() => el.setSelectionRange(0, el.value.length))
  }

  /** Select PART of the current value. Used when a gesture composes a command
   *  and leaves one word for the participant to overwrite — dragging a
   *  reference onto the hive writes `/reference people = a/b/people` and
   *  selects the name, so pressing Enter keeps it and typing renames it.
   *  Clamped rather than trusted: the caller composed the string, but the
   *  input may have been re-set in between. */
  selectRange(start: number, end: number): void {
    const el = this.inputElement
    if (!el) return
    queueMicrotask(() => {
      const max = el.value.length
      el.setSelectionRange(Math.max(0, Math.min(start, max)), Math.max(0, Math.min(end, max)))
    })
  }

  /** Suppress the suggestion dropdown (e.g. after an explicit accept). */
  suppress(): void {
    this.suppressed.set(true)
  }

  /** Un-suppress the suggestion dropdown. */
  unsuppress(): void {
    this.suppressed.set(false)
  }

  // ── template helpers ────────────────────────────────────

  typedPart = (suggestion: string): string => {
    const prefix = this.typedPrefix()
    if (!prefix) return ''
    return suggestion.slice(0, Math.min(prefix.length, suggestion.length))
  }

  restPart = (suggestion: string): string => {
    const prefix = this.typedPrefix()
    if (!prefix) return suggestion
    return suggestion.slice(Math.min(prefix.length, suggestion.length))
  }

  descriptionFor = (suggestion: string): string => {
    return this.descriptionMap().get(suggestion) ?? ''
  }

  colorFor = (suggestion: string): string => {
    return this.colorMap().get(suggestion) ?? ''
  }

  // ── event handlers ──────────────────────────────────────

  onInput = (): void => {
    const el = this.inputElement
    if (!el) return
    // Strip leading spaces — they break ghost text alignment
    if (el.value !== el.value.trimStart()) {
      el.value = el.value.trimStart()
    }
    this.suppressed.set(false)
    this.syncSignalsFromDom()
    this.clampActiveIndex()
    this.valueChange.emit(this.value())
  }

  /** The input scrolls horizontally on its own (long line, caret moves) —
   *  track it so the ghost hides rather than reporting a false column. */
  onInputScroll = (): void => {
    this.inputScrollLeft.set(this.inputElement?.scrollLeft ?? 0)
  }

  onKeyDown = (e: KeyboardEvent): void => {
    // The two ACCEPT keys are handled first and independently of the shell's
    // (change-detection-lagged) copy of the suggestion list — see handleTab.
    if (e.key === 'Tab') {
      this.handleTab(e)
      return
    }
    if (e.key === 'ArrowRight' && this.handleArrowRightAccept(e)) return

    // Up/Down on an EMPTY line belong to the parent's command recall. With
    // nothing typed the dropdown is offering "everything", so walking it is
    // worth little — whereas Up is the universal terminal gesture for "the
    // command I just ran". Once something IS typed the list is a real filtered
    // set and Up/Down go back to navigating it.
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && this.value() === '') {
      this.shellKeydown.emit(e)
      return
    }

    // Try completion keys first (when suggestions are visible)
    if (this.handleCompletionKeys(e)) return

    // Enter → commit
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      this.commit.emit(this.value())
      return
    }

    // Forward everything else to parent
    this.shellKeydown.emit(e)
  }

  onInputFocus = (): void => { this.caretPresence.emit(true) }

  onInputBlur = (): void => { this.caretPresence.emit(false) }

  onShellMouseDown = (e: MouseEvent): void => {
    if (e.target === this.inputElement) return
    e.preventDefault()
    this.inputElement?.focus()
  }

  onSuggestionMouseDown = (e: MouseEvent, suggestion: string, index: number): void => {
    e.preventDefault()
    this.activeIndex.set(index)
    this.completionAccepted.emit(suggestion)
  }

  // ── keyboard navigation ─────────────────────────────────

  /**
   * Tab — the completion key. It is a TOTAL function: every Tab press either
   * accepts the highlighted suggestion or is a deliberate no-op, and it NEVER
   * reaches the browser's default focus-traversal.
   *
   * That default was the "it resets and puts me back at the start" bug: any
   * time the dropdown was suppressed (which is what accepting a completion
   * does) or the list was momentarily empty, Tab fell through as a plain
   * keydown, no one called preventDefault, and focus walked off the command
   * line onto the next focusable element — losing the caret mid-command.
   *
   * The rules, in order:
   *  - Shift+Tab with the list open walks the highlight BACKWARDS (the mirror
   *    of ArrowUp). With nothing open it is left alone, so keyboard users keep
   *    a way out of the input.
   *  - Suppressed → re-open the dropdown. Tab always means "show me / take me
   *    forward", never "give up".
   *  - Otherwise → ask the parent to accept the highlighted row. The parent
   *    owns the live list, so it decides whether there is anything to take;
   *    either way focus and caret stay exactly where they are.
   */
  private handleTab(e: KeyboardEvent): void {
    const list = this.suggestions()

    if (e.shiftKey) {
      if (!list.length || this.suppressed()) return   // let the browser move focus back
      e.preventDefault()
      this.activeIndex.update(v => Math.max(v - 1, 0))
      return
    }

    e.preventDefault()

    // Suppression is checked FIRST: the parent reports an EMPTY list while
    // suppressed, so "no options" and "options hidden" are indistinguishable
    // from the list alone. Un-suppressing lets the parent recompute — if there
    // genuinely are none the dropdown simply stays shut and the next Tab is a
    // no-op, which is still infinitely better than losing focus.
    if (this.suppressed()) {
      this.suppressed.set(false)
      return
    }

    this.completionAcceptRequested.emit(this.activeIndex())
  }

  private handleCompletionKeys(e: KeyboardEvent): boolean {
    const list = this.suggestions()
    if (!list.length || this.suppressed()) return false

    if (e.key === 'Escape') {
      this.suppressed.set(true)
      // fall through so the parent can act (peel path, cancel select, etc.)
      this.shellKeydown.emit(e)
      return true
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      this.activeIndex.update(v => Math.min(v + 1, list.length - 1))
      return true
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault()
      this.activeIndex.update(v => Math.max(v - 1, 0))
      return true
    }

    return false
  }

  /**
   * ArrowRight — the second accept key ("walk into the ghost text"). Handled
   * outside handleCompletionKeys for the same reason Tab is: that gate gives
   * up on the shell's lagging copy of the list, so a fast ArrowRight silently
   * did nothing. Accepting is delegated to the parent's live list.
   *
   * It accepts ONLY with the caret already at the very end and nothing
   * selected. Anywhere else it is an ordinary caret move — swallowing it
   * replaced the whole line the moment a user went back to edit mid-command.
   */
  private handleArrowRightAccept(e: KeyboardEvent): boolean {
    if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return false
    if (this.suppressed() || !this.caretAtEnd()) return false
    e.preventDefault()
    this.completionAcceptRequested.emit(this.activeIndex())
    return true
  }

  /** True when the caret sits at the end of the input with no selection. */
  private caretAtEnd(): boolean {
    const el = this.inputElement
    if (!el) return false
    const end = el.value.length
    return el.selectionStart === end && el.selectionEnd === end
  }

  // ── internal helpers ────────────────────────────────────

  private syncSignalsFromDom(): void {
    this.value.set(this.inputElement?.value ?? '')
    this.inputScrollLeft.set(this.inputElement?.scrollLeft ?? 0)
  }

  private clampActiveIndex(): void {
    const max = this.suggestions().length - 1
    this.activeIndex.update(v => Math.max(0, Math.min(v, max)))
  }
}
