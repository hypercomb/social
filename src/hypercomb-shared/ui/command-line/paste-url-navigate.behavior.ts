// hypercomb-shared/ui/command-line/paste-url-navigate.behavior.ts

import type { CommandLineBehavior } from './command-line-behavior'

/**
 * Enter on a pasted URL with a trailing bracket selection → navigate
 * and select.
 *
 * Examples:
 *   "http://localhost:4250/dolphin/[model]"       → /dolphin with model selected
 *   "localhost:4250/dolphin/practice/[live]"      → /dolphin/practice with live selected
 *   "/dolphin/[model,practice]"                   → /dolphin with model+practice selected
 *
 * The path-bracket form `/parent/[a,b,c]` is the canonical selection
 * grammar (SelectionService syncs from it natively on `navigate` and
 * `popstate`). This behavior is the command-line entry point — paste
 * a URL anyone shared, hit Enter, and the dev shell lands you on the
 * right cell with the right tile pre-selected.
 *
 * Must be registered BEFORE BatchCreateBehavior. Bare `[a,b]` (no path,
 * no host) keeps its existing meaning — create cells named `a` and `b`
 * at the current level. The disambiguator is "looks like a URL" —
 * starts with a protocol, a known localhost host, or a leading `/`.
 */
export class PasteUrlNavigateBehavior implements CommandLineBehavior {

  readonly name = 'paste-url-navigate'
  readonly operations = [
    {
      trigger: 'Enter',
      pattern: /^(https?:\/\/|localhost|127\.0\.0\.1|\[::1\]|\/).*\/\[[^\]]+\]\/?$/,
      description: 'Navigate to a pasted URL with a bracket selection',
      examples: [
        { input: 'http://localhost:4250/dolphin/[model]', key: 'Enter', result: 'Navigates to /dolphin with model selected' },
        { input: '/dolphin/practice/[live]', key: 'Enter', result: 'Navigates to /dolphin/practice with live selected' },
        { input: '/dolphin/[model,practice]', key: 'Enter', result: 'Navigates to /dolphin with model + practice selected' },
      ]
    }
  ]

  match(event: KeyboardEvent, input: string): boolean {
    if (event.key !== 'Enter' || event.shiftKey) return false
    const trimmed = input.trim()
    if (!trimmed) return false
    return this.#extractPathname(trimmed) !== null
  }

  async execute(input: string): Promise<void> {
    const pathname = this.#extractPathname(input.trim())
    if (!pathname) return

    // Push the URL directly — no Navigation.go round-trip, because go
    // runs each segment through CompletionUtility.normalize which can
    // strip the brackets. The path is already shaped the way the
    // Navigation parser wants. SelectionService and the auto-open
    // drone both watch `navigate`, so the rest is wired natively.
    window.history.pushState({}, '', pathname)
    window.dispatchEvent(new Event('navigate'))
  }

  /** Extracts the pathname from a pasted URL-shaped input, or returns
   *  null if the input doesn't look like a URL with a trailing bracket.
   *  Accepts protocol form (`http://host/path`), localhost host-only
   *  (`localhost:4250/path`), and bare path form (`/path`). */
  #extractPathname(input: string): string | null {
    // Full URL form.
    if (/^https?:\/\//i.test(input)) {
      try {
        const u = new URL(input)
        return this.#requireTrailingBracket(u.pathname)
      } catch {
        return null
      }
    }
    // localhost host-only (no protocol).
    if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\//i.test(input)) {
      const slashIdx = input.indexOf('/')
      if (slashIdx < 0) return null
      return this.#requireTrailingBracket(input.slice(slashIdx))
    }
    // Pure path.
    if (input.startsWith('/')) {
      return this.#requireTrailingBracket(input)
    }
    return null
  }

  /** Returns the pathname iff its last non-empty segment is a
   *  `[...]` bracket selection. Otherwise null — bare paths without
   *  selection fall through to other navigation behaviors. */
  #requireTrailingBracket(pathname: string): string | null {
    const trimmed = pathname.replace(/\/+$/, '')
    const segments = trimmed.split('/').filter(Boolean)
    if (segments.length === 0) return null
    const last = segments[segments.length - 1]
    if (!/^\[.+\]$/.test(last)) return null
    return trimmed
  }
}
