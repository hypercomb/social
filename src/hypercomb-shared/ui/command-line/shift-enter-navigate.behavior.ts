// hypercomb-shared/ui/command-line/shift-enter-navigate.behavior.ts

import type { CommandLineBehavior } from './command-line-behavior'
import type { CompletionUtility } from '@hypercomb/shared/core/completion-utility'
import type { Lineage } from '../../core/lineage'
import type { Navigation } from '../../core/navigation'

/**
 * Shift+Enter → navigate only, never create.
 *
 *   "hello"        Shift+Enter → go to "hello" if it exists
 *   "hello/world"  Shift+Enter → go to hello/world if it exists
 *
 * This is a non-destructive, read-only operation. If the path
 * doesn't exist, nothing happens. Creation is Enter's job.
 */
export class ShiftEnterNavigateBehavior implements CommandLineBehavior {

  readonly name = 'shift-enter-navigate'
  readonly operations = [
    {
      trigger: 'Shift+Enter',
      pattern: /^.+$/,
      description: 'Navigate to an existing path (never creates)',
      examples: [
        { input: 'hello', key: 'Shift+Enter', result: 'Navigates into "hello" if it exists' },
        { input: 'hello/world', key: 'Shift+Enter', result: 'Navigates to hello/world if it exists' }
      ]
    }
  ]

  match(event: KeyboardEvent, input: string): boolean {
    return event.key === 'Enter' && event.shiftKey && input.length > 0
  }

  async execute(input: string): Promise<void> {
    const completions = get('@hypercomb.social/CompletionUtility') as CompletionUtility
    const lineage = get('@hypercomb.social/Lineage') as Lineage
    const navigation = get('@hypercomb.social/Navigation') as Navigation

    const parts = input
      .replace(/\/+$/, '')
      .split('/')
      .map(s => completions.normalize(s.trim()))
      .filter(Boolean)

    if (!parts.length) return

    // verify the path exists — bail if it doesn't
    const baseSegments = navigation.segments()
    const target = [...baseSegments, ...parts]
    const exists = await lineage.tryResolve(target)
    if (!exists) return

    // navigate (no creation, no cell:added, no synchronize)
    navigation.goRaw([...navigation.segmentsRaw(), ...parts])
  }
}
