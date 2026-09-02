// commands/theme.queen.ts

import {
  QueenBee, type ThemeProvider, THEME_IOC_KEY,
  registerCommandRoot, completeCommandPath,
  type CommandObject, type CommandMember,
} from '@hypercomb/core'

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
 *
 * EACH ONE SHOWS ITSELF. `honey`, `bloom`, `sherbet` are five nouns until you
 * have worn them: the only way to find out what a word meant was to apply it,
 * and the only way back was to apply another. So the members carry the theme's
 * own palette as their swatch — ground, panel, accent chord, read live from
 * that theme's tokens — and the choice is made by eye, in the dropdown, before
 * the screen changes. Nothing about which theme is which is written here; the
 * swatch and the bright/dark word both come from the theme itself, so a
 * community theme registered at runtime arrives with its sample already drawn.
 */
const themeObject: CommandObject = {
  members(path: readonly string[]): readonly CommandMember[] {
    // A theme is a leaf — there is nothing inside a look.
    if (path.length) return []
    const service = get(THEME_IOC_KEY) as ThemeProvider | undefined
    if (!service) return []
    return options(service).map(name => ({
      name,
      description: describe(service, name),
      swatch: service.swatch?.(name) || undefined,
      leaf: true,
    }))
  },
}

// Selectable themes + the 'system' meta-option (follow the OS preference).
const options = (service: ThemeProvider): string[] => [...service.themes, 'system']

/** What the row says beside the sample: how bright the theme is (its own
 *  `--md-is-light`, never a list kept here) and whether it is the one on. */
const describe = (service: ThemeProvider, name: string): string => {
  const mood = service.mood?.(name) ?? ''
  const said: string[] = []
  if (name === 'system') said.push(mood ? `follows the machine — ${mood} right now` : 'follows the machine')
  else if (mood) said.push(mood === 'dark' ? 'a dark look' : 'a bright look')
  if (service.theme === name) said.push('what you are wearing')
  return said.join(' · ')
}

registerCommandRoot('theme', themeObject)

export class ThemeQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'theme'
  override description = 'Switch the UI theme (light, dark, system, or a registered theme)'
  override descriptionKey = 'slash.theme'
  override options = ['light', 'dark', 'system', '<theme name>']
  override examples = [
    { input: '/theme dark', result: 'Switches to the dark theme' },
    { input: '/theme', result: 'Prints the current theme and available list' },
  ]

  // The walk is the protocol's — this is the fallback path for shells that ask
  // the behaviour directly rather than the object.
  override slashComplete(args: string): readonly string[] {
    return completeCommandPath(themeObject, args)
  }

  protected execute(args: string): void {
    const theme = get(THEME_IOC_KEY) as ThemeProvider | undefined
    if (!theme) {
      console.warn('[/theme] Theme service not available')
      return
    }

    const requested = args.trim().toLowerCase()

    if (!requested) {
      console.log(`[/theme] Current theme: ${theme.theme} — available: ${options(theme).join(', ')}`)
      return
    }

    theme.setTheme(requested)
    console.log(`[/theme] Theme set to: ${requested}`)
  }
}

const _theme = new ThemeQueenBee()
window.ioc.register('@diamondcoreprocessor.com/ThemeQueenBee', _theme)
