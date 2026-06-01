// hypercomb-shared/ui/command-shell/command-shell.component.ts
//
// Shared presentational command-line shell — owns the visual layer (input,
// ghost text, suggestion dropdown, keyboard navigation) while delegating
// all business logic to the parent via inputs/outputs.

import { Component, computed, ElementRef, input, output, signal, ViewChild, type AfterViewInit } from '@angular/core'

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

  /** Wrap the current selection with `marker` on both sides. If nothing
   *  is selected, the marker is inserted at the caret twice and the
   *  caret is placed between the markers so the user can type inside.
   *  Used by the notes-strip formatting toolbar (B/I/U/code/strike). */
  wrapSelection(marker: string): void {
    const el = this.inputElement
    if (!el) return
    el.focus()
    const value = el.value
    const start = el.selectionStart ?? value.length
    const end = el.selectionEnd ?? start
    const before = value.slice(0, start)
    const middle = value.slice(start, end)
    const after = value.slice(end)
    el.value = before + marker + middle + marker + after
    // Place caret/selection so the user's flow continues naturally:
    // empty wrap → caret between the markers; non-empty → re-select
    // the wrapped text so the next click on a marker layers on top.
    const newStart = start + marker.length
    const newEnd = newStart + middle.length
    el.setSelectionRange(newStart, newEnd)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }

  /** Insert text at the caret. Used by the link button (`[](url)`) and
   *  similar template insertions. */
  insertAtCaret(text: string): void {
    const el = this.inputElement
    if (!el) return
    el.focus()
    const value = el.value
    const start = el.selectionStart ?? value.length
    const end = el.selectionEnd ?? start
    el.value = value.slice(0, start) + text + value.slice(end)
    const caret = start + text.length
    el.setSelectionRange(caret, caret)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }

  /** Prefix the current line with `prefix + ' '`. The "current line" is
   *  bounded by the nearest `\n` on either side of the caret. For the
   *  `<input>`-backed shell there's no newline, so the prefix lands at
   *  the start of the value. */
  prefixLine(prefix: string): void {
    const el = this.inputElement
    if (!el) return
    el.focus()
    const value = el.value
    const caret = el.selectionStart ?? 0
    // Find line bounds. <input> has no \n, so this collapses to {0, len}.
    const lineStart = value.lastIndexOf('\n', Math.max(0, caret - 1)) + 1
    const insertion = prefix + ' '
    el.value = value.slice(0, lineStart) + insertion + value.slice(lineStart)
    const newCaret = caret + insertion.length
    el.setSelectionRange(newCaret, newCaret)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }

  /** Shift the current line by N indent units (positive indents,
   *  negative outdents). One unit = two spaces. Outdent removes up to
   *  one unit; never produces negative indent. */
  indentLine(delta: number): void {
    const el = this.inputElement
    if (!el) return
    el.focus()
    const value = el.value
    const caret = el.selectionStart ?? 0
    const lineStart = value.lastIndexOf('\n', Math.max(0, caret - 1)) + 1
    const lineEndCandidate = value.indexOf('\n', caret)
    const lineEnd = lineEndCandidate === -1 ? value.length : lineEndCandidate
    const line = value.slice(lineStart, lineEnd)
    // Count current leading spaces (tabs converted to 2 spaces).
    const lead = /^([ \t]*)/.exec(line)?.[1] ?? ''
    const normalized = lead.replace(/\t/g, '  ')
    const rest = line.slice(lead.length)
    const UNIT = 2
    const currentUnits = Math.floor(normalized.length / UNIT)
    const nextUnits = Math.max(0, currentUnits + delta)
    const newLead = ' '.repeat(nextUnits * UNIT)
    const newLine = newLead + rest
    el.value = value.slice(0, lineStart) + newLine + value.slice(lineEnd)
    // Caret tracks the indent shift so the user stays at the same
    // logical column within the text after the leading whitespace.
    const shift = newLead.length - lead.length
    const newCaret = Math.max(lineStart + newLead.length, caret + shift)
    el.setSelectionRange(newCaret, newCaret)
    el.dispatchEvent(new Event('input', { bubbles: true }))
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
