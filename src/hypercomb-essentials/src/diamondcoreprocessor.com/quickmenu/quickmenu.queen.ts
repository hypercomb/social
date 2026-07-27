// diamondcoreprocessor.com/quickmenu/quickmenu.queen.ts
//
// `/menu` — summon the seven-hexagon quick menu without the gesture.
//
// The gesture (middle-mouse hold, or long-press on touch) is the real
// interface; this exists so the ring is discoverable from the command line,
// reachable on hardware with no middle button, and inspectable — `/menu
// list` prints the registered vocabularies and which surface each claims.
//
// Opened this way the ring is STICKY: the pointer is free, aiming still
// works by direction from the ring's centre, a click fires what is lit, and
// Escape dismisses. Same geometry, same slots, no button held.

import { QueenBee, EffectBus } from '@hypercomb/core'
import type { QuickMenuRegistry } from './quick-menu-registry.service.js'
import type { QuickMenuInput } from './quick-menu.input.js'

const get = <T,>(key: string): T | undefined =>
  (window as { ioc?: { get?: (k: string) => T } }).ioc?.get?.(key)

export class QuickMenuQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'menu'
  override readonly aliases = ['ring']
  override description = 'Quick menu — seven hexagons at the pointer; flick a direction to choose'
  override descriptionKey = 'slash.menu'
  override options = ['<name>', 'list']
  override examples = [
    { input: '/menu', result: 'Opens the menu for the surface you are on' },
    { input: '/menu workflow', result: 'Opens the workflow vocabulary' },
    { input: '/menu list', result: 'Lists every registered menu and its surfaces' },
  ]

  override slashComplete(args: string): readonly string[] {
    const query = args.trim().toLowerCase()
    const registry = get<QuickMenuRegistry>('@diamondcoreprocessor.com/QuickMenuRegistry')
    const names = ['list', ...(registry?.names() ?? [])]
    return names.filter(name => name.toLowerCase().startsWith(query))
  }

  protected async execute(args: string): Promise<void> {
    const argument = args.trim().toLowerCase()
    const registry = get<QuickMenuRegistry>('@diamondcoreprocessor.com/QuickMenuRegistry')
    const input = get<QuickMenuInput>('@diamondcoreprocessor.com/QuickMenuInput')

    if (!registry || !input) {
      this.#log('Quick menu unavailable')
      return
    }

    if (argument === 'list') {
      for (const definition of registry.all()) {
        const where = definition.contexts.length
          ? definition.contexts.join(', ')
          : 'by name only'
        this.#log(`${definition.name} — ${definition.slots.length} slots · ${where}`, '⬡')
      }
      return
    }

    if (argument && !registry.byName(argument)) {
      this.#log(`No menu named "${argument}" — try /menu list`)
      return
    }

    const opened = input.open(argument || undefined)
    if (!opened) { this.#log('Quick menu could not open'); return }

    const definition = argument ? registry.byName(argument)! : registry.forContext()
    this.#log(`${definition.title} — flick a direction, Escape to dismiss`, '⬡')
  }

  #log(message: string, icon = '⬡'): void {
    EffectBus.emit('activity:log', { message, icon })
  }
}

const _quickMenu = new QuickMenuQueenBee()
window.ioc.register('@diamondcoreprocessor.com/QuickMenuQueenBee', _quickMenu)
