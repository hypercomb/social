// hypercomb-shared/ui/search-bar/delete-cell.behavior.ts

import type { SearchBarBehavior } from './search-bar-behavior'
import type { CompletionUtility } from '@hypercomb/shared/core/completion-utility'
import type { Lineage } from '../../core/lineage'
import { EffectBus } from '@hypercomb/core'

/**
 * Enter with `!` prefix → delete a cell (folder) from the current level.
 *
 * Examples:
 *   "!cellname"        → deletes cellname from current directory
 *   "!parent/child"    → deletes child from parent (parent stays)
 *   "![foo,bar]"       → deletes foo and bar from current directory
 */
export class DeleteCellBehavior implements SearchBarBehavior {

  readonly name = 'delete-cell'
  readonly operations = [
    {
      trigger: 'Enter',
      pattern: /^!.+/,
      description: 'Delete cells from the current directory',
      examples: [
        { input: '!cellname', key: 'Enter', result: 'Deletes cellname from current directory' },
        { input: '!parent/child', key: 'Enter', result: 'Deletes child from parent (parent stays)' },
        { input: '![foo,bar]', key: 'Enter', result: 'Deletes foo and bar from current directory' }
      ]
    }
  ]

  match(event: KeyboardEvent, input: string): boolean {
    return event.key === 'Enter' && !event.shiftKey && input.startsWith('!')
  }

  async execute(input: string): Promise<void> {
    const completions = get('@hypercomb.social/CompletionUtility') as CompletionUtility
    const lineage = get('@hypercomb.social/Lineage') as Lineage

    const body = input.slice(1).trim()
    if (!body) return

    const targets = this.#parseTargets(body, completions)
    if (!targets.length) return

    const dir = await lineage.explorerDir()
    if (!dir) return

    for (const target of targets) {
      await this.#deleteTarget(dir, target)
    }

    window.dispatchEvent(new Event('synchronize'))
  }

  /**
   * Parse the delete target(s).
   *
   * "cellname"      → [["cellname"]]
   * "parent/child"  → [["parent", "child"]]
   * "[foo,bar]"     → [["foo"], ["bar"]]
   */
  #parseTargets(body: string, completions: CompletionUtility): string[][] {
    // bracket syntax: ![foo,bar]
    const bracketMatch = body.match(/^\[(.+)]$/)
    if (bracketMatch) {
      return bracketMatch[1]
        .split(',')
        .map(v => completions.normalize(v.trim()))
        .filter(Boolean)
        .map(v => [v])
    }

    // path syntax: parent/child or just cellname
    const parts = body
      .split('/')
      .map(s => completions.normalize(s.trim()))
      .filter(Boolean)

    return parts.length > 0 ? [parts] : []
  }

  /**
   * Walk to the parent directory and remove the last segment.
   */
  async #deleteTarget(root: FileSystemDirectoryHandle, segments: string[]): Promise<void> {
    if (!segments.length) return

    let parent = root

    // walk to parent of the target
    for (let i = 0; i < segments.length - 1; i++) {
      try {
        parent = await parent.getDirectoryHandle(segments[i], { create: false })
      } catch {
        return // parent path doesn't exist, nothing to delete
      }
    }

    const name = segments[segments.length - 1]
    try {
      await parent.removeEntry(name, { recursive: true })
    } catch {
      // entry doesn't exist or can't be removed — silently skip
    }
  }
}
