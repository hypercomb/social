// diamond-core-processor/src/app/command-line/dcp-command-line.component.ts
//
// DCP command line — self-contained terminal-style input with tree node
// filtering, bracket selection, and kind-prefix support.
// Visual design matches the shared command shell but is inlined here to
// avoid cross-project Angular module resolution issues.

import { Component, computed, ElementRef, input, output, signal, ViewChild, type AfterViewInit } from '@angular/core'
import type { TreeNode, TreeNodeKind } from '../core/tree-node'
import { DcpTranslatePipe } from '../core/dcp-translate.pipe'

/** Kind prefixes recognized in the command line. */
const KIND_PREFIXES: Record<string, TreeNodeKind[]> = {
  'bee:':        ['bee', 'drone'],
  'worker:':     ['worker'],
  'dependency:': ['dependency'],
  'layer:':      ['layer'],
  'drone:':      ['drone'],
}

@Component({
  selector: 'dcp-command-line',
  standalone: true,
  imports: [DcpTranslatePipe],
  templateUrl: './dcp-command-line.component.html',
  styleUrls: ['./dcp-command-line.component.scss']
})
export class DcpCommandLineComponent implements AfterViewInit {

  @ViewChild('shellInput', { read: ElementRef })
  private inputRef?: ElementRef<HTMLInputElement>

  private get inputElement(): HTMLInputElement { return this.inputRef!.nativeElement }

  // ── inputs ─────────────────────────────────────────────

  readonly nodes = input<TreeNode[]>([])

  // ── outputs ────────────────────────────────────────────

  readonly filterTerm = output<string>()
  readonly kindFilter = output<Set<string>>()
  readonly selectedNames = output<string[]>()

  // ── internal state ─────────────────────────────────────

  readonly value = signal('')
  readonly activeIndex = signal(0)
  readonly suppressed = signal(false)

  /** All unique node names from the tree, sorted. */
  readonly allNames = computed(() => {
    const names = new Set<string>()
    const walk = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        if (n.name) names.add(n.name)
        walk(n.children)
      }
    }
    walk(this.nodes())
    return [...names].sort()
  })

  /** Parse the current input to determine mode. */
  readonly context = computed(() => {
    const v = this.value()
    if (!v.trim()) return { mode: 'empty' as const }

    if (v.startsWith('[')) {
      const bracketClose = v.indexOf(']')
      const inner = bracketClose >= 0 ? v.slice(1, bracketClose) : v.slice(1)
      const lastComma = inner.lastIndexOf(',')
      const fragment = lastComma >= 0 ? inner.slice(lastComma + 1).trim() : inner.trim()
      return { mode: 'select' as const, fragment, inner, closed: bracketClose >= 0 }
    }

    for (const [prefix, kinds] of Object.entries(KIND_PREFIXES)) {
      if (v.toLowerCase().startsWith(prefix)) {
        const after = v.slice(prefix.length)
        return { mode: 'kind' as const, kinds, filter: after }
      }
    }

    return { mode: 'filter' as const, term: v }
  })

  /** Suggestions based on current context. */
  readonly suggestions = computed<readonly string[]>(() => {
    if (this.suppressed()) return []
    const c = this.context()
    const names = this.allNames()

    if (c.mode === 'empty') return []

    if (c.mode === 'select') {
      if (c.closed) return []
      const already = new Set(
        c.inner.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
      )
      already.delete(c.fragment.toLowerCase())
      let filtered = names.filter(n => !already.has(n.toLowerCase()))
      if (c.fragment) {
        filtered = filtered.filter(n => n.toLowerCase().startsWith(c.fragment.toLowerCase()))
      }
      return filtered
    }

    if (c.mode === 'kind') {
      const kindSet = new Set(c.kinds)
      const kindNames: string[] = []
      const walk = (nodes: TreeNode[]) => {
        for (const n of nodes) {
          if (kindSet.has(n.kind) && n.name) kindNames.push(n.name)
          walk(n.children)
        }
      }
      walk(this.nodes())
      if (c.filter) return kindNames.filter(n => n.toLowerCase().startsWith(c.filter.toLowerCase()))
      return kindNames
    }

    if (c.mode === 'filter') {
      if (!c.term) return names
      return names.filter(n => n.toLowerCase().startsWith(c.term.toLowerCase()))
    }

    return []
  })

  readonly showCompletions = computed(() => this.suggestions().length > 0 && !this.suppressed())

  readonly ghostText = computed(() => {
    const list = this.suggestions()
    if (!list.length) return ''
    const best = list[this.activeIndex()] ?? list[0]
    if (!best) return ''
    const current = this.value()
    const ctx = this.context()

    let prefix = ''
    if (ctx.mode === 'select' && 'fragment' in ctx) prefix = ctx.fragment
    else if (ctx.mode === 'kind' && 'filter' in ctx) prefix = ctx.filter
    else if (ctx.mode === 'filter' && 'term' in ctx) prefix = ctx.term
    else return ''

    if (!prefix) return ''
    if (!best.toLowerCase().startsWith(prefix.toLowerCase())) return ''
    const suffix = best.slice(prefix.length)
    return suffix ? current + suffix : ''
  })

  readonly typedPrefix = computed(() => {
    const ctx = this.context()
    if (ctx.mode === 'select' && 'fragment' in ctx) return ctx.fragment
    if (ctx.mode === 'kind' && 'filter' in ctx) return ctx.filter
    if (ctx.mode === 'filter' && 'term' in ctx) return ctx.term
    return ''
  })

  // ── lifecycle ──────────────────────────────────────────

  ngAfterViewInit(): void {
    this.inputElement.focus()
  }

  // ── template helpers ───────────────────────────────────

  getActiveIndex = (): number => this.activeIndex()

  typedPart = (s: string): string => {
    const p = this.typedPrefix()
    if (!p) return ''
    return s.slice(0, Math.min(p.length, s.length))
  }

  restPart = (s: string): string => {
    const p = this.typedPrefix()
    if (!p) return s
    return s.slice(Math.min(p.length, s.length))
  }

  // ── event handlers ─────────────────────────────────────

  onInput = (): void => {
    const el = this.inputElement
    if (el.value !== el.value.trimStart()) el.value = el.value.trimStart()
    this.suppressed.set(false)
    this.value.set(el.value)
    this.clampActiveIndex()
    this.emitState()
  }

  onKeyDown = (e: KeyboardEvent): void => {
    if (this.handleCompletionKeys(e)) return

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      this.onCommit()
    }
  }

  onShellMouseDown = (e: MouseEvent): void => {
    if (e.target === this.inputElement) return
    e.preventDefault()
    this.inputElement.focus()
  }

  onSuggestionMouseDown = (e: MouseEvent, s: string, i: number): void => {
    e.preventDefault()
    this.activeIndex.set(i)
    this.acceptCompletion(s)
  }

  // ── completion logic ───────────────────────────────────

  private handleCompletionKeys(e: KeyboardEvent): boolean {
    const list = this.suggestions()
    if (!list.length || this.suppressed()) return false

    if (e.key === 'Escape') { e.preventDefault(); this.suppressed.set(true); return true }
    if (e.key === 'ArrowDown') { e.preventDefault(); this.activeIndex.update(v => Math.min(v + 1, list.length - 1)); return true }
    if (e.key === 'ArrowUp') { e.preventDefault(); this.activeIndex.update(v => Math.max(v - 1, 0)); return true }
    if (e.key === 'Tab' || e.key === 'ArrowRight') {
      e.preventDefault()
      const best = list[this.activeIndex()] ?? list[0]
      if (best) this.acceptCompletion(best)
      return true
    }
    return false
  }

  private acceptCompletion(suggestion: string): void {
    const ctx = this.context()
    const raw = this.value()

    if (ctx.mode === 'select' && 'fragment' in ctx) {
      const lastSep = Math.max(raw.lastIndexOf(','), raw.lastIndexOf('['))
      const before = raw.slice(0, lastSep + 1)
      const spacer = raw.lastIndexOf(',') >= 0 ? ' ' : ''
      this.setInputValue(before + spacer + suggestion)
      this.suppressed.set(false)
      return
    }

    if (ctx.mode === 'kind' && 'filter' in ctx) {
      for (const prefix of Object.keys(KIND_PREFIXES)) {
        if (raw.toLowerCase().startsWith(prefix)) {
          this.setInputValue(prefix + suggestion)
          this.suppressed.set(true)
          return
        }
      }
    }

    this.setInputValue(suggestion)
    this.suppressed.set(true)
  }

  private onCommit(): void {
    const ctx = this.context()
    if (ctx.mode === 'select' && 'inner' in ctx) {
      const names = ctx.inner.split(',').map(s => s.trim()).filter(Boolean)
      this.selectedNames.emit(names)
    }
  }

  // ── helpers ────────────────────────────────────────────

  private emitState(): void {
    const ctx = this.context()
    if (ctx.mode === 'filter' && 'term' in ctx) {
      this.filterTerm.emit(ctx.term)
      this.kindFilter.emit(new Set())
      this.selectedNames.emit([])
    } else if (ctx.mode === 'kind' && 'kinds' in ctx) {
      const kindKeys = new Set<string>()
      for (const k of ctx.kinds) {
        if (k === 'drone') kindKeys.add('bee')
        else kindKeys.add(k)
      }
      this.kindFilter.emit(kindKeys)
      this.filterTerm.emit(ctx.filter)
      this.selectedNames.emit([])
    } else {
      this.filterTerm.emit('')
      this.kindFilter.emit(new Set())
      this.selectedNames.emit([])
    }
  }

  private setInputValue(v: string): void {
    this.inputElement.value = v
    this.value.set(v)
    queueMicrotask(() => this.inputElement.setSelectionRange(v.length, v.length))
  }

  private clampActiveIndex(): void {
    const max = this.suggestions().length - 1
    this.activeIndex.update(v => Math.max(0, Math.min(v, max)))
  }
}
