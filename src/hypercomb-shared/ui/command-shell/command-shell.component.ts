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
  readonly indicators = input<readonly { key: string; icon: string; label: string }[]>([])

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
      e.preventDefault()
      this.suppressed.set(true)
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
