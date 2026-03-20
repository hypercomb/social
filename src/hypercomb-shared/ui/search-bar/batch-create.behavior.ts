// hypercomb-shared/ui/search-bar/batch-create.behavior.ts

import type { SearchBarBehavior } from './search-bar-behavior'
import type { CompletionUtility } from '@hypercomb/shared/core/completion-utility'
import type { Lineage } from '../../core/lineage'
import { EffectBus } from '@hypercomb/core'

/**
 * Enter with bracket syntax → create multiple children at once.
 *
 * Examples:
 *   "abc/[123,456]"       → creates abc/123 and abc/456
 *   "[foo,bar,baz]"       → creates foo, bar, baz at current level
 *   "parent/[a,b]/child"  → creates parent/a/child and parent/b/child
 *
 * Brackets expand into all comma-separated variants. Each resulting
 * path is created as a folder chain in OPFS.
 */
export class BatchCreateBehavior implements SearchBarBehavior {

  readonly name = 'batch-create'
  readonly operations = [
    {
      trigger: 'Enter',
      pattern: /\[.+]/,
      description: 'Create multiple cells at once using bracket expansion',
      examples: [
        { input: 'abc/[123,456]', key: 'Enter', result: 'Creates abc/123 and abc/456' },
        { input: '[foo,bar,baz]', key: 'Enter', result: 'Creates foo, bar, baz at current level' },
        { input: 'parent/[a,b]/child', key: 'Enter', result: 'Creates parent/a/child and parent/b/child' }
      ]
    }
  ]

  match(event: KeyboardEvent, input: string): boolean {
    return event.key === 'Enter' && !event.shiftKey && input.includes('[') && input.includes(']')
  }

  async execute(input: string): Promise<void> {
    const completions = get('@hypercomb.social/CompletionUtility') as CompletionUtility
    const lineage = get('@hypercomb.social/Lineage') as Lineage

    const paths = this.#expand(input, completions)
    if (!paths.length) return

    const dir = await lineage.explorerDir()
    if (!dir) return

    const topSeeds = new Set<string>()

    for (const path of paths) {
      let parent = dir
      for (const part of path) {
        parent = await parent.getDirectoryHandle(part, { create: true })
      }
      if (path[0]) topSeeds.add(path[0])
    }

    for (const seed of topSeeds) {
      EffectBus.emit('seed:added', { seed })
    }
    window.dispatchEvent(new Event('synchronize'))
  }

  /**
   * Expand bracket syntax into an array of path arrays.
   *
   * "abc/[1,2]/xyz" → [["abc","1","xyz"], ["abc","2","xyz"]]
   */
  #expand(input: string, completions: CompletionUtility): string[][] {
    const segments = input.split('/')

    // build up paths by expanding each segment
    let paths: string[][] = [[]]

    for (const seg of segments) {
      const trimmed = seg.trim()
      const bracketMatch = trimmed.match(/^\[(.+)]$/)

      if (bracketMatch) {
        // expand: each variant × each existing path
        const variants = bracketMatch[1]
          .split(',')
          .map(v => completions.normalize(v.trim()))
          .filter(Boolean)

        const expanded: string[][] = []
        for (const path of paths) {
          for (const variant of variants) {
            expanded.push([...path, variant])
          }
        }
        paths = expanded
      } else {
        const normalized = completions.normalize(trimmed)
        if (normalized) {
          for (const path of paths) {
            path.push(normalized)
          }
        }
      }
    }

    return paths.filter(p => p.length > 0)
  }
}
