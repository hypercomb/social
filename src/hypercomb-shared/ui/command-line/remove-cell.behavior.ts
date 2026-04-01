// hypercomb-shared/ui/command-line/remove-cell.behavior.ts

import type { CommandLineBehavior } from './command-line-behavior'
import type { CompletionUtility } from '@hypercomb/shared/core/completion-utility'
import type { Lineage } from '../../core/lineage'
import type { Navigation } from '../../core/navigation'
import { EffectBus, hypercomb } from '@hypercomb/core'
import { parseArrayItems, parseOneItem } from '../../core/array-parser'
import { persistTagOps, type TagOp } from '../../core/tag-ops'

/**
 * Enter with `~` prefix → remove a cell (folder) from the current level.
 *
 * Removes from the visible hierarchy only — data persists in OPFS.
 *
 * Examples:
 *   "~cellname"        → removes cellname from current directory
 *   "~parent/child"    → removes child from parent (parent stays)
 *   "~[foo,bar]"       → removes foo and bar from current directory
 *   "~[foo, bar:tag]"  → removes foo, removes tag from bar
 *
 * Note: `~label:tag` is handled by the universal tag pre-processor (removes a tag),
 * so this behavior only fires when there's no colon after the label.
 */
export class RemoveCellBehavior implements CommandLineBehavior {

  readonly name = 'remove-cell'
  readonly operations = [
    {
      trigger: 'Enter',
      pattern: /^~.+/,
      description: 'Remove cells from the current directory',
      examples: [
        { input: '~cellname', key: 'Enter', result: 'Removes cellname from current directory' },
        { input: '~parent/child', key: 'Enter', result: 'Removes child from parent (parent stays)' },
        { input: '~[foo,bar]', key: 'Enter', result: 'Removes foo and bar from current directory' }
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
        // tag operations within remove context
        if (item.tag) {
          tagOps.push({
            label: item.segments[item.segments.length - 1],
            tag: item.tag,
            color: item.tagColor,
            remove: item.op === 'tag-remove',
          })
        }
      } else {
        // in ~ context, treat plain names as removes
        await this.#removeTarget(dir, item.segments)
      }
    }

    if (tagOps.length > 0) {
      await persistTagOps(tagOps, dir)
    }

    await new hypercomb().act()

    // if all cells removed, navigate to parent
    if (await this.#isDirEmpty(dir)) {
      const navigation = get('@hypercomb.social/Navigation') as Navigation
      const segments = navigation.segmentsRaw()
      if (segments.length > 0) {
        navigation.goRaw(segments.slice(0, -1))
      }
    }
  }

  async #isDirEmpty(dir: FileSystemDirectoryHandle): Promise<boolean> {
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind === 'directory' && !name.startsWith('__')) return false
    }
    return true
  }

  async #removeTarget(root: FileSystemDirectoryHandle, segments: string[]): Promise<void> {
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
      EffectBus.emit('cell:removed', { cell: name })
    } catch { /* skip */ }
  }
}
