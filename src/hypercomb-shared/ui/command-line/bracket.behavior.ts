// hypercomb-shared/ui/command-line/bracket.behavior.ts

import type { CommandLineBehavior } from './command-line-behavior'
import type { Lineage } from '../../core/lineage'

/**
 * The square bracket `[…]` is THE selection primitive. This behavior owns the
 * bare-select Enter: `[model]` / `[model, practice]` / `dolphin/[model]` push a
 * path-bracket URL and SelectionService syncs from the navigate event natively.
 * A bracketed name that doesn't exist is still kept in the selection set;
 * tile-rendering simply doesn't paint it.
 *
 * The richer grammar is layered ON the same bracket by the command line, not by
 * separate syntaxes:
 *   [+roadmap]            → create roadmap        (per-item `+`, component pre-pass)
 *   [~stale]              → remove stale          (per-item `~`, component pre-pass)
 *   [a, b]:focus          → tag the selection     (trailing `:`, executeSelectCommand)
 *   [a, b]/copy|/move(8)…  → operate on selection  (trailing `/op`)
 * The `operations` below document that full surface for the /help sheet.
 */
export class BracketBehavior implements CommandLineBehavior {

  readonly name = 'bracket'
  readonly operations = [
    {
      trigger: 'Enter',
      pattern: /^[^?]*\/?\[[^\]]+\]$/,
      description: 'Brackets are the selection primitive — `[a, b]` selects.',
      examples: [
        { input: '[model]', key: 'Enter', result: 'Select model at current level' },
        { input: '[model, practice]', key: 'Enter', result: 'Select model and practice' },
        { input: 'dolphin/[model]', key: 'Enter', result: 'Select model under dolphin' },
      ]
    },
    {
      trigger: 'Enter',
      pattern: /^\[\+/,
      description: 'Per-item operators inside `[ ]`: `+` creates, `~` removes, bare selects.',
      examples: [
        { input: '[+roadmap, +tasks]', key: 'Enter', result: 'Create roadmap and tasks' },
        { input: '[~stale]', key: 'Enter', result: 'Remove stale' },
        { input: '[+new, keep, ~old]', key: 'Enter', result: 'Create new, select keep, remove old' },
      ]
    },
    {
      trigger: 'Enter',
      pattern: /\]:/,
      description: 'Tag the selection: `[a, b]:tag` or `[a, b]:[t1, ~t2]`.',
      examples: [
        { input: '[model, practice]:focus', key: 'Enter', result: 'Tag the selection "focus"' },
        { input: '[model, practice]:[focus, ~stale]', key: 'Enter', result: 'Add focus, remove stale' },
      ]
    },
    {
      trigger: 'Enter',
      pattern: /\]\/\w/,
      description: 'Operate on the selection: `/copy` `/cut` `/move(n)` `/format` `/keyword` `/o|/s|/h`.',
      examples: [
        { input: '[a, b]/copy', key: 'Enter', result: 'Copy the selection' },
        { input: '[a, b]/move(8)', key: 'Enter', result: 'Move the selection to slot 8' },
        { input: '[a, b]/keyword work', key: 'Enter', result: 'Tag the selection "work"' },
      ]
    },
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
