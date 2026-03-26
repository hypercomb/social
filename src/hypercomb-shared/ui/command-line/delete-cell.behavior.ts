// hypercomb-shared/ui/command-line/delete-cell.behavior.ts

import type { CommandLineBehavior } from './command-line-behavior'
import type { CompletionUtility } from '@hypercomb/shared/core/completion-utility'
import type { Lineage } from '../../core/lineage'
import { EffectBus, hypercomb } from '@hypercomb/core'
import { parseArrayItems, parseOneItem } from '../../core/array-parser'
import { persistTagOps, type TagOp } from '../../core/tag-ops'

/**
 * Enter with `~` prefix → delete a cell (folder) from the current level.
 *
 * Examples:
 *   "~cellname"        → deletes cellname from current directory
 *   "~parent/child"    → deletes child from parent (parent stays)
 *   "~[foo,bar]"       → deletes foo and bar from current directory
 *   "~[foo, bar:tag]"  → deletes foo, removes tag from bar
 *
 * Note: `~label:tag` is handled by the universal tag pre-processor (removes a tag),
 * so this behavior only fires when there's no colon after the label.
 */
export class DeleteCellBehavior implements CommandLineBehavior {

  readonly name = 'delete-cell'
  readonly operations = [
    {
      trigger: 'Enter',
      pattern: /^~.+/,
      description: 'Delete cells from the current directory',
      examples: [
        { input: '~cellname', key: 'Enter', result: 'Deletes cellname from current directory' },
        { input: '~parent/child', key: 'Enter', result: 'Deletes child from parent (parent stays)' },
        { input: '~[foo,bar]', key: 'Enter', result: 'Deletes foo and bar from current directory' }
      ]
    }
  ]

  match(event: KeyboardEvent, input: string): boolean {
    return event.key === 'Enter' && !event.shiftKey && input.startsWith('~')
  }

  async execute(input: string): Promise<void> {
    const completions = get('@hypercomb.social/CompletionUtility') as CompletionUtility
    const lineage = get('@hypercomb.social/Lineage') as Lineage

    const body = input.slice(1).trim() // strip leading ~
    if (!body) return

    const dir = await lineage.explorerDir()
    if (!dir) return

    // bracket syntax: ~[foo,bar,baz:tag]
    const bracketMatch = body.match(/^\[(.+)\]$/)
    const items = bracketMatch
      ? parseArrayItems(bracketMatch[1], completions.normalize)
      : (() => {
          const single = parseOneItem(body, completions.normalize)
          return single ? [single] : []
        })()

    if (!items.length) return

    const tagOps: TagOp[] = []

    for (const item of items) {
      if (item.op === 'tag-add' || item.op === 'tag-remove') {
        // tag operations within delete context
        if (item.tag) {
          tagOps.push({
            label: item.segments[item.segments.length - 1],
            tag: item.tag,
            color: item.tagColor,
            remove: item.op === 'tag-remove',
          })
        }
      } else {
        // delete or create — in ~ context, treat plain names as deletes too
        await this.#deleteTarget(dir, item.segments)
      }
    }

    if (tagOps.length > 0) {
      await persistTagOps(tagOps, dir)
    }

    await new hypercomb().act()
  }

  async #deleteTarget(root: FileSystemDirectoryHandle, segments: string[]): Promise<void> {
    if (!segments.length) return

    let parent = root
    for (let i = 0; i < segments.length - 1; i++) {
      try {
        parent = await parent.getDirectoryHandle(segments[i], { create: false })
      } catch {
        return
      }
    }

    const name = segments[segments.length - 1]
    try {
      await parent.removeEntry(name, { recursive: true })
      EffectBus.emit('seed:removed', { seed: name })
    } catch { /* skip */ }
  }
}
