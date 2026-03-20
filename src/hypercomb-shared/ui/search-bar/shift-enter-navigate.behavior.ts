// hypercomb-shared/ui/search-bar/shift-enter-navigate.behavior.ts

import type { SearchBarBehavior } from './search-bar-behavior'
import type { CompletionUtility } from '@hypercomb/shared/core/completion-utility'
import type { Lineage } from '../../core/lineage'
import type { Navigation } from '../../core/navigation'
import { EffectBus } from '@hypercomb/core'

/**
 * Shift+Enter with `/` in the input → create subfolders AND navigate into them.
 *
 * Typing "hello/world" and pressing Shift+Enter:
 *   1. Creates the full folder path (hello/world) in OPFS — same as Enter
 *   2. Emits seed:added + synchronize so tiles update
 *   3. Navigates into the created path
 *
 * Without `/` this behavior does not match — the default single-segment
 * commitNavigate handles it instead.
 */
export class ShiftEnterNavigateBehavior implements SearchBarBehavior {

  readonly name = 'shift-enter-navigate'
  readonly description = 'Create nested folders and navigate into the created path'
  readonly syntax = 'path/to/folder'
  readonly key = 'Shift+Enter'
  readonly examples = [
    { input: 'hello/world', key: 'Shift+Enter', result: 'Creates hello/world and navigates into hello/world' },
    { input: 'a/b/c', key: 'Shift+Enter', result: 'Creates a/b/c and navigates to a/b/c' }
  ]

  match(event: KeyboardEvent, input: string): boolean {
    return event.key === 'Enter' && event.shiftKey && input.includes('/')
  }

  async execute(input: string): Promise<void> {
    const completions = get('@hypercomb.social/CompletionUtility') as CompletionUtility
    const lineage = get('@hypercomb.social/Lineage') as Lineage
    const navigation = get('@hypercomb.social/Navigation') as Navigation

    const parts = input
      .split('/')
      .map(s => completions.normalize(s.trim()))
      .filter(Boolean)

    if (!parts.length) return

    // 1. create the full folder path in OPFS
    const dir = await lineage.explorerDir()
    if (dir) {
      let parent = dir
      for (const part of parts) {
        parent = await parent.getDirectoryHandle(part, { create: true })
      }
    }

    // 2. notify the system
    EffectBus.emit('seed:added', { seed: parts[0] })
    window.dispatchEvent(new Event('synchronize'))

    // 3. navigate into the created path
    const baseSegments = navigation.segmentsRaw()
    const target = [...baseSegments, ...parts]
    navigation.goRaw(target)
  }
}
