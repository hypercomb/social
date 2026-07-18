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
  }

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

  /** Active status indicators shown as pills on the right side of the input. */
  readonly indicators = input<readonly { key: string; icon: string; label: string; dismissable?: boolean }[]>([])

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

  /**
   * Available view-behavior toggles for the current node (e.g. website).
   * Rendered as stateful on/off Material icons on the right side, sourced
   * from VisualBeeRegistry via the parent's ViewBee subscription. The shell
   * stays presentational — it never reads the registry itself.
   */
  readonly viewToggles = input<readonly { view: string; icon: string; label: string; active: boolean }[]>([])

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

  // ── outputs to parent ───────────────────────────────────

  /** Emitted on every input change (after leading-space strip). */
  readonly valueChange = output<string>()

  /** Emitted when Enter is pressed (not Shift+Enter). */
  readonly commit = output<string>()

  /** Emitted when a suggestion is accepted via Tab/ArrowRight/click. */
  readonly completionAccepted = output<string>()

  /**
   * Emitted for keydown events the shell does NOT consume internally
   * (i.e. everything except Escape/Up/Down/Tab/ArrowRight when suggestions
   * are visible). Parent can handle Shift+Enter, special modes, etc.
   */
  readonly shellKeydown = output<KeyboardEvent>()

  /** Emitted when an indicator pill is clicked (to turn it off). */
  readonly indicatorDismiss = output<string>()

  /** Emitted when the user clicks the armed-resource thumbnail to dismiss it. */
  readonly armedResourceDismiss = output<void>()

  /** Emitted when the open-for-subscribers icon is clicked. Parent
   *  flips swarm.setOpenForSubscribers — the shell never touches IoC. */
  readonly openForSubscribersToggle = output<void>()

  /**
   * Emitted when a view toggle is clicked. `view` is the view name (e.g.
   * `'website'`); `disable` is true for a cmd/ctrl-click or long-press —
   * the "back to tiles, permanently" gesture that turns the view OFF for
   * the tile. A plain click (`disable:false`) just enters / leaves the
   * view while keeping the tile sticky. Parent forwards it to ViewBee.
   */
  readonly viewToggle = output<{ view: string; disable: boolean }>()

  /** Pending long-press timer for the view toggle, and a latch so the
   *  mouseup that follows a long-press / modifier-click doesn't ALSO emit a
   *  plain toggle. */
  #viewTogglePressTimer: ReturnType<typeof setTimeout> | null = null
  #viewToggleDisabled = false

  /** Pointer-down on a view toggle. A cmd/ctrl-click disables immediately; a
   *  plain press starts the long-press timer and defers the toggle to mouseup. */
  onViewToggleDown(e: MouseEvent, view: string): void {
    e.preventDefault()
    this.#viewToggleDisabled = false
    if (e.metaKey || e.ctrlKey) {
      this.#viewToggleDisabled = true
      this.viewToggle.emit({ view, disable: true })
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

  /** Template handler for clicks on the armed-resource thumbnail. */
  onArmedGlyphMouseDown = (e: MouseEvent): void => {
    if (!this.armedResource()) return
    e.preventDefault()
    this.armedResourceDismiss.emit()
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

  readonly effectiveShowCompletions = computed(() =>
    this.showSuggestions() && this.suggestions().length > 0 && !this.suppressed()
  )

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

  onKeyDown = (e: KeyboardEvent): void => {
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

    if (e.key === 'Tab' || e.key === 'ArrowRight') {
      e.preventDefault()
      const best = list[this.activeIndex()] ?? list[0]
      if (best) this.completionAccepted.emit(best)
      return true
    }

    return false
  }

  // ── internal helpers ────────────────────────────────────

  private syncSignalsFromDom(): void {
    this.value.set(this.inputElement?.value ?? '')
  }

  private clampActiveIndex(): void {
    const max = this.suggestions().length - 1
    this.activeIndex.update(v => Math.max(0, Math.min(v, max)))
  }
}
