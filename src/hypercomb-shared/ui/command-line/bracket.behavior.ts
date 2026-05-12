// hypercomb-shared/ui/command-line/bracket.behavior.ts

import type { CommandLineBehavior } from './command-line-behavior'
import type { CompletionUtility } from '@hypercomb/shared/core/completion-utility'
import type { Lineage } from '../../core/lineage'
import { EffectBus, hypercomb } from '@hypercomb/core'
import { parseArrayItems, type ParsedArrayItem } from '../../core/array-parser'
import { persistTagOps, type TagOp } from '../../core/tag-ops'

/**
 * Enter with bracket syntax → one behavior, four sub-cases dispatched
 * internally by what the parser finds and what's already on disk:
 *
 *   - SELECT: every item is a plain-`create` op AND each named child
 *             already exists under one common parent → re-interpret
 *             as a selection; push `/parent?[a,b]` URL.
 *   - CREATE: any item is `create` and the path doesn't exist yet →
 *             create the cell(s) (cartesian expansion supported).
 *   - DELETE: item prefixed with `~` → remove the cell.
 *   - TAG:    item carries `:tag` suffix → add/remove the tag.
 *
 * Examples:
 *   "dolphin/[model]"               (model exists)    → navigate + select
 *   "abc/[123,456]"                 (new)             → creates abc/123, abc/456
 *   "[foo,bar,baz]"                 (new, current)    → creates 3 children here
 *   "parent/[a,b]/child"            (cartesian)       → parent/a/child + parent/b/child
 *   "[new, ~old, beer:craft]"       (mixed)           → creates / deletes / tags
 *
 * One behavior, one concern (bracket-grammar handling), internal
 * dispatch by op type + existence. Adding new sub-cases (e.g.
 * `[a:link=url]`) lives here.
 */
export class BracketBehavior implements CommandLineBehavior {

  readonly name = 'bracket'
  readonly operations = [
    {
      trigger: 'Enter',
      pattern: /\[.+]/,
      description: 'Bracket grammar: select existing, create new, delete (~), tag (:tag)',
      examples: [
        { input: 'dolphin/[model]', key: 'Enter', result: 'If model exists: navigate + select. If not: create.' },
        { input: 'abc/[123,456]', key: 'Enter', result: 'Creates abc/123 and abc/456' },
        { input: '[foo,bar,baz]', key: 'Enter', result: 'Creates foo, bar, baz at current level' },
        { input: 'parent/[a,b]/child', key: 'Enter', result: 'Creates parent/a/child and parent/b/child' },
        { input: '[new, ~old, beer:craft]', key: 'Enter', result: 'Creates new, deletes old, tags beer with craft' }
      ]
    }
  ]

  match(event: KeyboardEvent, input: string): boolean {
    return event.key === 'Enter' && !event.shiftKey && input.includes('[') && input.includes(']')
  }

  async execute(input: string): Promise<void> {
    const completions = get('@hypercomb.social/CompletionUtility') as CompletionUtility
    const lineage = get('@hypercomb.social/Lineage') as Lineage

    const dir = await lineage.explorerDir()
    if (!dir) return

    // Check if this is a simple single-bracket at current level (no path segments outside)
    // vs cartesian expansion (path/[a,b]/child)
    const expanded = this.#expand(input, completions)
    if (!expanded.length) return

    const baseSegments = (lineage as unknown as { explorerSegments?: () => string[] })?.explorerSegments?.() ?? []

    // FILTER: if every expanded item is a `create` op AND all of them
    // already exist on disk AND they all share the same parent path,
    // re-interpret the bracket as a selection rather than a creation.
    // Same surface syntax — `dolphin/[model]` typed at root works
    // whether `model` exists (→ navigate + select) or not (→ create).
    // The dashboard / paste-URL flow's canonical query form
    // (`/dolphin?[model]`) goes through a different behavior; this is
    // the "I typed it directly into the command line" entry point.
    if (await this.#shouldTreatAsSelection(dir, expanded)) {
      this.#navigateAndSelect(expanded, baseSegments)
      return
    }

    // Track all (parent-lineage → added-cell-names) and (parent-lineage →
    // removed-cell-names) so we can fire ONE layer commit per affected
    // parent (vs N per cell).
    const addsByParent = new Map<string, { segments: string[]; names: string[] }>()
    const removesByParent = new Map<string, { segments: string[]; names: string[] }>()
    const tagOps: TagOp[] = []

    const recordAdd = (parentSegments: string[], leafCell: string) => {
      const key = parentSegments.join('/')
      const entry = addsByParent.get(key) ?? { segments: parentSegments.slice(), names: [] }
      if (!entry.names.includes(leafCell)) entry.names.push(leafCell)
      addsByParent.set(key, entry)
    }
    const recordRemove = (parentSegments: string[], leafCell: string) => {
      const key = parentSegments.join('/')
      const entry = removesByParent.get(key) ?? { segments: parentSegments.slice(), names: [] }
      entry.names.push(leafCell)
      removesByParent.set(key, entry)
    }

    for (const item of expanded) {
      if (item.op === 'delete') {
        const ok = await this.#deleteTarget(dir, item.segments)
        if (ok && item.segments[0]) {
          const parentSegs = [...baseSegments, ...item.segments.slice(0, -1)]
          recordRemove(parentSegs, item.segments[item.segments.length - 1])
        }
      } else if (item.op === 'tag-add' || item.op === 'tag-remove') {
        if (item.op === 'tag-add') {
          let parent = dir
          const accumulated: string[] = [...baseSegments]
          for (const part of item.segments) {
            recordAdd([...accumulated], part)
            parent = await parent.getDirectoryHandle(part, { create: true })
            accumulated.push(part)
          }
        }
        if (item.tag) {
          tagOps.push({
            label: item.segments[item.segments.length - 1],
            tag: item.tag,
            color: item.tagColor,
            remove: item.op === 'tag-remove',
          })
        }
      } else {
        let parent = dir
        const accumulated: string[] = [...baseSegments]
        for (const part of item.segments) {
          recordAdd([...accumulated], part)
          parent = await parent.getDirectoryHandle(part, { create: true })
          accumulated.push(part)
        }
      }
    }

    // persist tag operations
    if (tagOps.length > 0) {
      await persistTagOps(tagOps, dir)
    }

    // Bump FS-change marker so renders during the cascade see fresh OPFS.
    const allParents = new Map<string, string[]>()
    for (const { segments } of addsByParent.values()) allParents.set(segments.join('/'), segments)
    for (const { segments } of removesByParent.values()) allParents.set(segments.join('/'), segments)
    if (allParents.size > 0) EffectBus.emit('fs:changed', { segments: baseSegments })

    // ONE layer commit per affected parent.
    const committer = get('@diamondcoreprocessor.com/LayerCommitter') as
      { update(segments: readonly string[], layer: { [slot: string]: unknown }, nameSlots?: ReadonlySet<string>): Promise<string> }
      | undefined
    if (committer) {
      for (const segments of allParents.values()) {
        const parentDir = await (lineage as unknown as { tryResolve: (s: readonly string[]) => Promise<FileSystemDirectoryHandle | null> }).tryResolve(segments)
        if (!parentDir) continue
        const newChildren: string[] = []
        for await (const [name, h] of (parentDir as any).entries()) {
          if (h.kind !== 'directory') continue
          if (!name || (name.startsWith('__') && name.endsWith('__'))) continue
          newChildren.push(name)
        }
        await committer.update(segments, { children: newChildren })
      }
    }

    for (const { segments, names } of addsByParent.values()) {
      for (const name of names) EffectBus.emit('cell:added', { cell: name, segments })
    }
    for (const { segments, names } of removesByParent.values()) {
      for (const name of names) EffectBus.emit('cell:removed', { cell: name, segments })
    }

    await new hypercomb().act()
  }

  /**
   * Expand bracket syntax into an array of ParsedArrayItems.
   *
   * For single brackets at current level: "[a, ~b, c:tag]" → parsed items.
   * For cartesian paths: "abc/[1,2]/xyz" → expanded path combinations.
   */
  #expand(input: string, completions: CompletionUtility): ParsedArrayItem[] {
    const segments = input.split('/')
    const results: ParsedArrayItem[] = []

    // Fast path: single bracket segment at root (no path nesting)
    if (segments.length === 1) {
      const bracketMatch = input.match(/^\[(.+)\]$/)
      if (bracketMatch) {
        return parseArrayItems(bracketMatch[1], completions.normalize)
      }
    }

    // Cartesian expansion: handle path segments with brackets
    let paths: { segments: string[]; op: ParsedArrayItem['op']; tag?: string; tagColor?: string }[] = [{ segments: [], op: 'create' }]

    for (const seg of segments) {
      const trimmed = seg.trim()
      const bracketMatch = trimmed.match(/^\[(.+)\]$/)

      if (bracketMatch) {
        // Parse items inside brackets using shared parser
        const items = parseArrayItems(bracketMatch[1], completions.normalize)
        const expanded: typeof paths = []

        for (const path of paths) {
          for (const item of items) {
            // In cartesian mode, each item's segments are appended to the path
            // The op/tag from the item is preserved only if it's the leaf bracket
            expanded.push({
              segments: [...path.segments, ...item.segments],
              op: item.op,
              tag: item.tag,
              tagColor: item.tagColor,
            })
          }
        }
        paths = expanded
      } else {
        const normalized = completions.normalize(trimmed)
        if (normalized) {
          for (const path of paths) {
            path.segments.push(normalized)
          }
        }
      }
    }

    for (const path of paths) {
      if (path.segments.length > 0) {
        results.push({
          segments: path.segments,
          op: path.op,
          tag: path.tag,
          tagColor: path.tagColor,
        })
      }
    }

    return results
  }

  // ── selection vs create disambiguation ────────────────────────────
  //
  // The bracket grammar (`[a,b]`, `path/[a,b]`) means create. When
  // every expanded item refers to an EXISTING cell sharing one common
  // parent, the same input is treated as a selection — same syntax,
  // behaviour switches based on what's on disk.

  /** True iff every expanded item is a plain `create` op (no delete /
   *  tag), all items share the same parent path within the input, and
   *  every item already exists on disk under that parent. When any of
   *  those is false, fall through to the create flow. */
  async #shouldTreatAsSelection(
    root: FileSystemDirectoryHandle,
    expanded: ParsedArrayItem[],
  ): Promise<boolean> {
    if (expanded.length === 0) return false
    if (!expanded.every(item => item.op === 'create')) return false
    if (!expanded.every(item => item.segments.length > 0)) return false

    // All items must share the same parent path (segments minus leaf).
    const firstParent = expanded[0].segments.slice(0, -1).join('/')
    for (const item of expanded) {
      if (item.segments.slice(0, -1).join('/') !== firstParent) return false
    }

    // Every item's full segment path must resolve on disk.
    for (const item of expanded) {
      let parent: FileSystemDirectoryHandle = root
      let ok = true
      for (const part of item.segments) {
        try {
          parent = await parent.getDirectoryHandle(part, { create: false })
        } catch {
          ok = false
          break
        }
      }
      if (!ok) return false
    }
    return true
  }

  /** Push a `/parent?[a,b,c]` URL for the selection. SelectionService
   *  syncs from the navigate event natively; the auto-open drone
   *  surfaces the editor for the first selected. Pushing the URL
   *  directly (not Navigation.go) avoids segment normalisation
   *  stripping the brackets. */
  #navigateAndSelect(
    expanded: ParsedArrayItem[],
    baseSegments: readonly string[],
  ): void {
    if (expanded.length === 0) return
    const parentInInput = expanded[0].segments.slice(0, -1)
    const selectedNames = expanded.map(item =>
      item.segments[item.segments.length - 1]
    )
    const parentPath = [...baseSegments, ...parentInInput]
    const pathname = parentPath.length > 0 ? '/' + parentPath.join('/') : '/'
    const search = '?[' + selectedNames.join(',') + ']'
    window.history.pushState({}, '', pathname + search)
    window.dispatchEvent(new Event('navigate'))
  }

  async #deleteTarget(root: FileSystemDirectoryHandle, segments: string[]): Promise<boolean> {
    if (!segments.length) return false

    let parent = root
    for (let i = 0; i < segments.length - 1; i++) {
      try {
        parent = await parent.getDirectoryHandle(segments[i], { create: false })
      } catch {
        return false
      }
    }

    const name = segments[segments.length - 1]
    try {
      await parent.removeEntry(name, { recursive: true })
      return true
    } catch { return false }
  }
}
