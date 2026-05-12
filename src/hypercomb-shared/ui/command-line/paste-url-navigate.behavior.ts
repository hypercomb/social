// hypercomb-shared/ui/command-line/paste-url-navigate.behavior.ts

import type { CommandLineBehavior } from './command-line-behavior'

/**
 * Enter on a pasted URL with a bracket selection → navigate and select.
 *
 * Accepts two bracket-selection grammars:
 *   - Query form (canonical):  /parent?[a,b,c]
 *   - Path-tail form (legacy): /parent/[a,b,c]
 *
 * Examples:
 *   "http://localhost:4250/dolphin?[model]"       → /dolphin with model selected
 *   "localhost:4250/dolphin/practice?[live]"      → /dolphin/practice with live selected
 *   "/dolphin?[model,practice]"                   → /dolphin with model+practice selected
 *   "/dolphin/[model]"                            → same (legacy path form)
 *
 * Path-only pastes without a bracket fall through to other navigation
 * behaviors. Bare brackets without a leading `/` or host (e.g.
 * `[foo,bar]`) keep their existing batch-create meaning.
 */
export class PasteUrlNavigateBehavior implements CommandLineBehavior {

  readonly name = 'paste-url-navigate'
  readonly operations = [
    {
      trigger: 'Enter',
      pattern: /^(https?:\/\/|localhost|127\.0\.0\.1|\[::1\]|\/).+(\?\[[^\]]+\]|\/\[[^\]]+\])\/?$/,
      description: 'Navigate to a pasted URL with a bracket selection',
      examples: [
        { input: 'http://localhost:4250/dolphin?[model]', key: 'Enter', result: 'Navigates to /dolphin with model selected' },
        { input: '/dolphin/practice?[live]', key: 'Enter', result: 'Navigates to /dolphin/practice with live selected' },
        { input: '/dolphin?[model,practice]', key: 'Enter', result: 'Navigates to /dolphin with model + practice selected' },
        { input: '/dolphin/[model]', key: 'Enter', result: 'Legacy path form — same result, kept for back-compat' },
      ]
    }
  ]

  match(event: KeyboardEvent, input: string): boolean {
    if (event.key !== 'Enter' || event.shiftKey) return false
    const trimmed = input.trim()
    if (!trimmed) return false
    return this.#extractUrl(trimmed) !== null
  }

  async execute(input: string): Promise<void> {
    const url = this.#extractUrl(input.trim())
    if (!url) return

    // Push the path+search directly — no Navigation.go round-trip,
    // because go runs each segment through CompletionUtility.normalize
    // which can strip the brackets. The URL is already shaped the way
    // the Navigation parser wants. SelectionService and the auto-open
    // drone both watch `navigate`, so the rest is wired natively.
    window.history.pushState({}, '', url.pathname + url.search)
    window.dispatchEvent(new Event('navigate'))
  }

  /** Extract { pathname, search } from a pasted URL-shaped input, with
   *  the bracket selection living in either `search` (canonical query
   *  form) or the path's last segment (legacy). Returns null if the
   *  input doesn't look like a URL with a bracket selection. */
  #extractUrl(input: string): { pathname: string, search: string } | null {
    // Full URL form.
    if (/^https?:\/\//i.test(input)) {
      try {
        const u = new URL(input)
        return this.#requireBracket(u.pathname, u.search)
      } catch {
        return null
      }
    }
    // localhost host-only (no protocol).
    if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\//i.test(input)) {
      const slashIdx = input.indexOf('/')
      if (slashIdx < 0) return null
      return this.#parsePathSearch(input.slice(slashIdx))
    }
    // Pure path (+ optional search).
    if (input.startsWith('/')) {
      return this.#parsePathSearch(input)
    }
    return null
  }

  /** Split a `/path?search` string and validate the bracket. */
  #parsePathSearch(pathAndSearch: string): { pathname: string, search: string } | null {
    const qIdx = pathAndSearch.indexOf('?')
    const pathname = qIdx >= 0 ? pathAndSearch.slice(0, qIdx) : pathAndSearch
    const search = qIdx >= 0 ? pathAndSearch.slice(qIdx) : ''
    return this.#requireBracket(pathname, search)
  }

  /** Accept the URL iff either:
   *    - the search string matches `?[...]` (query form), or
   *    - the pathname's last non-empty segment is `[...]` (path form).
   *  Returns the normalized { pathname, search } to push, or null. */
  #requireBracket(pathname: string, search: string): { pathname: string, search: string } | null {
    // Query form: ?[a,b,c]
    if (/^\?\[[^\]]+\]$/.test(search.trim())) {
      const clean = pathname.replace(/\/+$/, '') || '/'
      return { pathname: clean, search: search.trim() }
    }
    // Legacy path-tail form: /.../[a,b,c]
    const trimmed = pathname.replace(/\/+$/, '')
    const segments = trimmed.split('/').filter(Boolean)
    if (segments.length === 0) return null
    const last = segments[segments.length - 1]
    if (!/^\[[^\]]+\]$/.test(last)) return null
    return { pathname: trimmed, search }
  }
}
