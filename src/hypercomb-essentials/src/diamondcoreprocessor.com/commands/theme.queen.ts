// diamondcoreprocessor.com/commands/theme.queen.ts

import { QueenBee, type ThemeProvider, THEME_IOC_KEY } from '@hypercomb/core'

/**
 * /theme — switch the UI theme.
 *
 * Syntax:
 *   /theme dark          — dark surface (the baseline look)
 *   /theme light         — light / day surface
 *   /theme system        — follow the OS preference (prefers-color-scheme)
 *   /theme <name>        — any theme a community module registered at runtime
 *   /theme               — print the current theme + the available list
 *
 * A theme is a named value-set for the `--md-*` design tokens. The switch is
 * participant-local (persisted to localStorage, never written to the layer) and
 * reflects onto `<html data-theme>`; static CSS in _material-tokens.scss does
 * the rest. New themes are added by registering a token map — no code change to
 * this queen is needed for community themes to appear in autocomplete.
 */
export class ThemeQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'theme'
  override readonly aliases = ['themes']
  override description = 'Switch the UI theme (light, dark, system, or a registered theme)'
  override descriptionKey = 'slash.theme'

  override slashComplete(args: string): readonly string[] {
    const options = this.#options()
    const q = args.toLowerCase().trim()
    if (!q) return options
    return options.filter(o => o.startsWith(q))
  }

  protected execute(args: string): void {
    const theme = get(THEME_IOC_KEY) as ThemeProvider | undefined
    if (!theme) {
      console.warn('[/theme] Theme service not available')
      return
    }

    const requested = args.trim().toLowerCase()

    if (!requested) {
      console.log(`[/theme] Current theme: ${theme.theme} — available: ${this.#options().join(', ')}`)
      return
    }

    theme.setTheme(requested)
    console.log(`[/theme] Theme set to: ${requested}`)
  }

  // Selectable themes + the 'system' meta-option (follow the OS preference).
  #options(): string[] {
    const theme = get(THEME_IOC_KEY) as ThemeProvider | undefined
    return [...(theme?.themes ?? ['light', 'dark']), 'system']
  }
}

const _theme = new ThemeQueenBee()
window.ioc.register('@diamondcoreprocessor.com/ThemeQueenBee', _theme)
