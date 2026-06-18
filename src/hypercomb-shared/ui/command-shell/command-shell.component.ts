// hypercomb-shared/ui/command-shell/command-shell.component.ts
//
// Shared presentational command-line shell — owns the visual layer (input,
// ghost text, suggestion dropdown, keyboard navigation) while delegating
// all business logic to the parent via inputs/outputs.

import { Component, computed, ElementRef, input, output, signal, ViewChild, type AfterViewInit } from '@angular/core'

/** How long a view toggle must be held (no modifier) to count as a disable —
 *  the touch-friendly equivalent of a cmd/ctrl-click. */
const VIEW_TOGGLE_LONG_PRESS_MS = 500

@Component({
  selector: 'hc-command-shell',
  standalone: true,
  templateUrl: './command-shell.component.html',
  styleUrls: ['./command-shell.component.scss']
})
export class CommandShellComponent implements AfterViewInit {

  @ViewChild('shellInput', { read: ElementRef })
  private inputRef?: ElementRef<HTMLInputElement>

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

  /**
   * Whether the Solomon's Key game toggle is rendered on the header. True
   * whenever the SolomonDrone has registered (announced via `solomon:state`).
   * Backed by the parent; the shell stays presentational.
   */
  readonly showSolomonToggle = input<boolean>(false)

  /** Whether the game overlay is currently open (drives the on/off glow). */
  readonly solomonActive = input<boolean>(false)

  /** Aria-label / tooltip for the game toggle. */
  readonly solomonLabel = input<string>("Solomon's Key game")

  /**
   * Whether the Bubble Bobble game toggle is rendered on the header. True
   * whenever the BubbleDrone has registered (announced via `bubble:state`).
   * Sibling of the Solomon toggle; the shell stays presentational.
   */
  readonly showBubbleToggle = input<boolean>(false)

  /** Whether the Bubble Bobble overlay is currently open (drives the on/off glow). */
  readonly bubbleActive = input<boolean>(false)

  /** Aria-label / tooltip for the Bubble Bobble toggle. */
  readonly bubbleLabel = input<string>('Bubble Bobble game')

  /**
   * Whether the Arkanoid game toggle is rendered on the header. True whenever
   * the ArkanoidDrone has registered (announced via `arkanoid:state`). Sibling
   * of the Solomon / Bubble toggles; the shell stays presentational.
   */
  readonly showArkanoidToggle = input<boolean>(false)

  /** Whether the Arkanoid overlay is currently open (drives the on/off glow). */
  readonly arkanoidActive = input<boolean>(false)

  /** Aria-label / tooltip for the Arkanoid toggle. */
  readonly arkanoidLabel = input<string>('Arkanoid game')

  /**
   * Briefly true when the user tried to pan or zoom while input is locked
   * (the editor overlay is open). Drives a lock icon that flashes to the
   * left of the right-side icons, then fades. Parent owns the timing; the
   * shell just renders the current state.
   */
  readonly lockedFlash = input<boolean>(false)

  /** Aria-label / tooltip for the locked-flash icon. */
  readonly lockedLabel = input<string>('Locked — close the editor to pan or zoom')

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

  /** Emitted when the Solomon's Key header icon is clicked. Parent forwards
   *  it to the SolomonDrone via EffectBus (`solomon:toggle`). */
  readonly solomonToggle = output<void>()

  /** Emitted when the Bubble Bobble header icon is clicked. Parent forwards
   *  it to the BubbleDrone via EffectBus (`bubble:toggle`). */
  readonly bubbleToggle = output<void>()

  /** Emitted when the Arkanoid header icon is clicked. Parent forwards it to
   *  the ArkanoidDrone via EffectBus (`arkanoid:toggle`). */
  readonly arkanoidToggle = output<void>()

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
