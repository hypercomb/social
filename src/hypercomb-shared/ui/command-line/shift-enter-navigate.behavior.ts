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

    // Verify the path exists — bail if it doesn't. Existence = the target
    // location's lineage bag holds at least one marker. The old check
    // name-walked OPFS folders (lineage.tryResolve without its `start`
    // arg → always null; and tiles are merkle entries with sig-named
    // bags, not name folders), so Shift+Enter silently refused EVERY
    // navigation.
    const baseSegments = navigation.segments()
    const target = [...baseSegments, ...parts]
    const history = get('@diamondcoreprocessor.com/HistoryService') as {
      sign?: (l: unknown) => Promise<string>
      listMarkerFilenames?: (locSig: string) => Promise<string[]>
    } | undefined
    if (!history?.sign || !history.listMarkerFilenames) return
    const locSig = await history.sign({
      domain: (lineage as { domain?: () => string }).domain,
      explorerSegments: () => target,
    })
    const markers = await history.listMarkerFilenames(locSig)
    if (!markers.length) return

    // navigate (no creation, no cell:added, no synchronize)
    navigation.goRaw([...navigation.segmentsRaw(), ...parts])
  }
}
