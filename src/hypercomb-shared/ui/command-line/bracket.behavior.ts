// hypercomb-shared/ui/command-line/bracket.behavior.ts

import type { CommandLineBehavior } from './command-line-behavior'
import type { Lineage } from '../../core/lineage'

/**
 * Enter on bracket input → push a path-bracket URL. Selection only.
 *
 *   [model]              → push `/<base>/[model]` — select model at current level
 *   [model,practice]     → push `/<base>/[model,practice]` — multi-select
 *   dolphin/[model]      → push `/<base>/dolphin/[model]` — select model under dolphin
 *
 * Brackets express selection. They do not create, delete, edit, or tag.
 * SelectionService syncs from the navigate event natively — that's the
 * whole pipeline. If a bracketed name doesn't exist as a child of the
 * parent, the URL still gets pushed; SelectionService keeps the name
 * in its set and tile-rendering decides what to do (typically nothing —
 * non-existent names just don't paint).
 *
 * Mutations (create, delete, tag) live in other behaviors with other
 * syntax. One bee, one concern.
 */
export class BracketBehavior implements CommandLineBehavior {

  readonly name = 'bracket'
  readonly operations = [
    {
      trigger: 'Enter',
      pattern: /^[^?]*\/?\[[^\]]+\]$/,
      description: 'Bracket = selection. Pushes a path-bracket URL.',
      examples: [
        { input: '[model]', key: 'Enter', result: 'Select model at current level' },
        { input: '[model,practice]', key: 'Enter', result: 'Select model and practice at current level' },
        { input: 'dolphin/[model]', key: 'Enter', result: 'Select model under dolphin' },
      ]
    }
  ]

  match(event: KeyboardEvent, input: string): boolean {
    if (event.key !== 'Enter' || event.shiftKey) return false
    return /^[^?]*\/?\[[^\]]+\]\/?$/.test(input.trim())
  }

  async execute(input: string): Promise<void> {
    const lineage = get('@hypercomb.social/Lineage') as Lineage

    const parsed = this.#parse(input.trim())
    if (!parsed) return

    const baseSegments =
      (lineage as unknown as { explorerSegments?: () => readonly string[] })
        ?.explorerSegments?.() ?? []

    const fullParent = [...baseSegments, ...parsed.pathPrefix]
    const base = fullParent.length > 0 ? '/' + fullParent.join('/') : ''
    const url = base + '/[' + parsed.names.join(',') + ']'

    // Direct pushState — Navigation.go would run each segment through
    // CompletionUtility.normalize, which strips bracket characters.
    // SelectionService syncs from the navigate event natively.
    window.history.pushState({}, '', url)
    window.dispatchEvent(new Event('navigate'))
  }

  /** Split `path/prefix/[a,b,c]` into { pathPrefix, names }. Returns
   *  null when the input doesn't match the bracket form. */
  #parse(input: string): { pathPrefix: string[]; names: string[] } | null {
    const m = /^(.*?)\/?\[([^\]]+)\]\/?$/.exec(input)
    if (!m) return null
    const prefix = (m[1] ?? '').trim()
    const pathPrefix = prefix
      .replace(/^\/+|\/+$/g, '')
      .split('/')
      .map(s => s.trim())
      .filter(Boolean)
    const names = m[2]
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
    if (names.length === 0) return null
    return { pathPrefix, names }
  }
}
