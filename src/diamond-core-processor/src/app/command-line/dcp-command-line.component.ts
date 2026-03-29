// diamond-core-processor/src/app/command-line/dcp-command-line.component.ts
//
// DCP-specific command line — wraps the shared command shell with tree
// node filtering, bracket selection, and kind-prefix support.

import { Component, computed, input, output, signal, ViewChild } from '@angular/core'
import { CommandShellComponent } from '@hypercomb/shared/ui/command-shell/command-shell.component'
import { parseArrayItems } from '@hypercomb/shared/core/array-parser'
import type { TreeNode, TreeNodeKind } from '../core/tree-node'

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
  imports: [CommandShellComponent],
  templateUrl: './dcp-command-line.component.html',
  styleUrls: ['./dcp-command-line.component.scss']
})
export class DcpCommandLineComponent {

  @ViewChild('shell')
  private shell!: CommandShellComponent

  // ── inputs ─────────────────────────────────────────────

  /** Flat list of all tree nodes (for autocomplete suggestions). */
  readonly nodes = input<TreeNode[]>([])

  // ── outputs ────────────────────────────────────────────

  /** Plain text filter term (bare text mode). */
  readonly filterTerm = output<string>()

  /** Kind-based filter (e.g. typing "bee:" activates bee+drone filter). */
  readonly kindFilter = output<Set<string>>()

  /** Bracket-selected node names. */
  readonly selectedNames = output<string[]>()

  // ── internal state ─────────────────────────────────────

  private readonly value = signal('')

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

    // bracket selection: [item1,item2]
    if (v.startsWith('[')) {
      const bracketClose = v.indexOf(']')
      const inner = bracketClose >= 0 ? v.slice(1, bracketClose) : v.slice(1)
      const lastComma = inner.lastIndexOf(',')
      const fragment = lastComma >= 0 ? inner.slice(lastComma + 1).trim() : inner.trim()
      return { mode: 'select' as const, fragment, inner, closed: bracketClose >= 0 }
    }

    // kind prefix: bee:, worker:, dependency:
    for (const [prefix, kinds] of Object.entries(KIND_PREFIXES)) {
      if (v.toLowerCase().startsWith(prefix)) {
        const after = v.slice(prefix.length)
        return { mode: 'kind' as const, kinds, filter: after }
      }
    }

    // plain text filter
    return { mode: 'filter' as const, term: v }
  })

  /** Suggestions based on current context. */
  readonly suggestions = computed<readonly string[]>(() => {
    const ctx = this.context
    const c = ctx()
    const names = this.allNames()

    if (c.mode === 'empty') return []

    if (c.mode === 'select') {
      if (c.closed) return []
      // exclude already-selected items
      const already = new Set(
        c.inner.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
      )
      // remove the current fragment from the excluded set (it's still being typed)
      already.delete(c.fragment.toLowerCase())
      let filtered = names.filter(n => !already.has(n.toLowerCase()))
      if (c.fragment) {
        filtered = filtered.filter(n => n.toLowerCase().startsWith(c.fragment.toLowerCase()))
      }
      return filtered
    }

    if (c.mode === 'kind') {
      // filter by kind, then optionally by text
      const kindNodes = this.#flatNodesByKind(c.kinds)
      let kindNames = kindNodes.map(n => n.name)
      if (c.filter) {
        kindNames = kindNames.filter(n => n.toLowerCase().startsWith(c.filter.toLowerCase()))
      }
      return kindNames
    }

    if (c.mode === 'filter') {
      if (!c.term) return names
      return names.filter(n => n.toLowerCase().startsWith(c.term.toLowerCase()))
    }

    return []
  })

  readonly showSuggestions = computed(() => this.suggestions().length > 0)

  readonly ghostText = computed(() => {
    const list = this.suggestions()
    if (!list.length) return ''
    const best = list[this.shell?.activeIndex() ?? 0] ?? list[0]
    if (!best) return ''

    const ctx = this.context()
    const current = this.value()

    if (ctx.mode === 'select') {
      if (!('fragment' in ctx)) return ''
      if (!best.toLowerCase().startsWith(ctx.fragment.toLowerCase())) return ''
      const suffix = best.slice(ctx.fragment.length)
      return suffix ? current + suffix : ''
    }

    if (ctx.mode === 'kind' && 'filter' in ctx) {
      if (!ctx.filter) return ''
      if (!best.toLowerCase().startsWith(ctx.filter.toLowerCase())) return ''
      const suffix = best.slice(ctx.filter.length)
      return suffix ? current + suffix : ''
    }

    if (ctx.mode === 'filter' && 'term' in ctx) {
      if (!best.toLowerCase().startsWith(ctx.term.toLowerCase())) return ''
      const suffix = best.slice(ctx.term.length)
      return suffix ? current + suffix : ''
    }

    return ''
  })

  /** Typed prefix for highlight splitting in suggestion dropdown. */
  readonly typedPrefix = computed(() => {
    const ctx = this.context()
    if (ctx.mode === 'select' && 'fragment' in ctx) return ctx.fragment
    if (ctx.mode === 'kind' && 'filter' in ctx) return ctx.filter
    if (ctx.mode === 'filter' && 'term' in ctx) return ctx.term
    return ''
  })

  // ── shell bridge ───────────────────────────────────────

  onValueChange(v: string): void {
    this.value.set(v)
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
    } else if (ctx.mode === 'select') {
      this.filterTerm.emit('')
      this.kindFilter.emit(new Set())
      // don't emit selectedNames until committed
    } else {
      this.filterTerm.emit('')
      this.kindFilter.emit(new Set())
      this.selectedNames.emit([])
    }
  }

  onCommit(v: string): void {
    const ctx = this.context()

    if (ctx.mode === 'select' && 'inner' in ctx) {
      const items = parseArrayItems(ctx.inner, s => s.trim())
      const names = items.map(i => i.segments.join('/'))
      this.selectedNames.emit(names)
      return
    }

    // on Enter in filter/kind mode, just keep the current filter (no-op)
  }

  onCompletionAccepted(suggestion: string): void {
    const ctx = this.context()
    const raw = this.value()

    if (ctx.mode === 'select' && 'fragment' in ctx) {
      // insert after last comma or after [
      const lastSep = Math.max(raw.lastIndexOf(','), raw.lastIndexOf('['))
      const before = raw.slice(0, lastSep + 1)
      const spacer = raw.lastIndexOf(',') >= 0 ? ' ' : ''
      const newValue = before + spacer + suggestion
      this.shell.setValue(newValue)
      this.shell.unsuppress()
      this.shell.placeCaretAtEnd()
      this.value.set(newValue)
      return
    }

    if (ctx.mode === 'kind' && 'filter' in ctx) {
      // replace the filter part after the kind prefix
      for (const prefix of Object.keys(KIND_PREFIXES)) {
        if (raw.toLowerCase().startsWith(prefix)) {
          const newValue = prefix + suggestion
          this.shell.setValue(newValue)
          this.shell.suppress()
          this.shell.placeCaretAtEnd()
          this.value.set(newValue)
          return
        }
      }
    }

    // plain filter: replace with suggestion
    this.shell.setValue(suggestion)
    this.shell.suppress()
    this.shell.placeCaretAtEnd()
    this.value.set(suggestion)
  }

  // ── helpers ────────────────────────────────────────────

  #flatNodesByKind(kinds: TreeNodeKind[]): TreeNode[] {
    const kindSet = new Set(kinds)
    const result: TreeNode[] = []
    const walk = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        if (kindSet.has(n.kind)) result.push(n)
        walk(n.children)
      }
    }
    walk(this.nodes())
    return result
  }
}
