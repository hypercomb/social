// hypercomb-shared/ui/search-bar/go-parent.behavior.ts

import type { SearchBarBehavior } from './search-bar-behavior'
import type { Navigation } from '../../core/navigation'

/**
 * Enter with `..` prefix → navigate up N levels, optionally forward.
 *
 *   ".."          Enter → go up one level
 *   "../.."       Enter → go up two levels
 *   "../hello"    Enter → go up one level, then into "hello"
 *   "../../hello" Enter → go up two levels, then into "hello"
 *
 * Clamps to root — never errors if you overshoot.
 */
export class GoParentBehavior implements SearchBarBehavior {

  readonly name = 'go-parent'
  readonly operations = [
    {
      trigger: 'Enter',
      pattern: /^\.\.(?:\/|$)/,
      description: 'Navigate up N levels, optionally into a forward path',
      examples: [
        { input: '..', key: 'Enter', result: 'Goes up one level' },
        { input: '../..', key: 'Enter', result: 'Goes up two levels' },
        { input: '../hello', key: 'Enter', result: 'Goes up one level, then into hello' }
      ]
    }
  ]

  match(event: KeyboardEvent, input: string): boolean {
    return event.key === 'Enter' && !event.shiftKey && /^\.\.(?:\/|$)/.test(input)
  }

  execute(input: string): void {
    const navigation = get('@hypercomb.social/Navigation') as Navigation
    const segments = navigation.segmentsRaw()

    const parts = input.replace(/\/+\s*$/, '').split('/').filter(Boolean)

    // count leading ".." segments
    let levels = 0
    while (levels < parts.length && parts[levels] === '..') levels++

    // everything after the ".." segments is a forward path
    const forward = parts.slice(levels)

    const base = segments.slice(0, Math.max(0, segments.length - levels))
    navigation.go([...base, ...forward])
  }
}
