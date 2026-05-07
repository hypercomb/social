// hypercomb-shared/ui/command-line/batch-create.behavior.ts

import type { CommandLineBehavior } from './command-line-behavior'
import type { CompletionUtility } from '@hypercomb/shared/core/completion-utility'
import type { Lineage } from '../../core/lineage'
import { EffectBus, hypercomb } from '@hypercomb/core'
import { parseArrayItems, type ParsedArrayItem } from '../../core/array-parser'
import { persistTagOps, type TagOp } from '../../core/tag-ops'

/**
 * Enter with bracket syntax → create, delete, and tag multiple children at once.
 *
 * Examples:
 *   "abc/[123,456]"                   → creates abc/123 and abc/456
 *   "[foo,bar,baz]"                   → creates foo, bar, baz at current level
 *   "parent/[a,b]/child"              → creates parent/a/child and parent/b/child
 *   "[new-thing, ~old-thing]"         → creates new-thing and deletes old-thing
 *   "[beer:craft, ~whiskey, new]"     → tags beer, deletes whiskey, creates new
 *
 * Brackets expand into all comma-separated variants. Items prefixed with ~ are
 * deleted instead of created. Items with :tag are tagged.
 */
export class BatchCreateBehavior implements CommandLineBehavior {

  readonly name = 'batch-create'
  readonly operations = [
    {
      trigger: 'Enter',
      pattern: /\[.+]/,
      description: 'Create, delete, or tag multiple cells using bracket expansion',
      examples: [
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

    // Track all (parent-lineage → added-cell-names) and (parent-lineage →
    // removed-cell-names) so we can fire ONE layer commit per affected
    // parent (vs N per cell).
    const baseSegments = (lineage as unknown as { explorerSegments?: () => string[] })?.explorerSegments?.() ?? []
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
