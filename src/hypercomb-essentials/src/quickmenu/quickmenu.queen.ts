// quickmenu/quickmenu.queen.ts
//
// `/menu` — summon the seven-hexagon quick menu without the gesture.
//
// The gesture (hold alt over a tile, or long-press on touch) is the real
// interface; this exists so the ring is discoverable from the command line
// and inspectable — `/menu list` prints the registered vocabularies and which
// surface each claims.
//
// Opened this way the ring is STICKY: the pointer is free, aiming still
// works by direction from the ring's centre, a click fires what is lit, and
// Escape dismisses. Same geometry, same slots, no button held.
//
// `menu trigger` says how the tile you stand in fires each seat. A seat's
// automaton is extruded with `trait` and swapped with `fill`
// (quick-menu.traits.ts).

import { QueenBee, EffectBus, sameTraitWord } from '@hypercomb/core'
import { listDecorations, removeDecorationAndWait, writeDecoration } from '../commands/decoration-manifest.js'
import { say, standing } from '../commands/trait-read.js'
import { MENU_TRIGGER_KIND, parseTriggerArgs, type MenuTriggerRecord } from './quick-menu.traits.js'
import { QuickMenuRegistry } from './quick-menu-registry.service.js'
import { QuickMenuInput } from './quick-menu.input.js'

const get = <T,>(key: string): T | undefined =>
  (window as { ioc?: { get?: (k: string) => T } }).ioc?.get?.(key)

export class QuickMenuQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'menu'
  override description = 'Quick menu — seven hexagons at the pointer; flick a direction to choose'
  override descriptionKey = 'slash.menu'
  override options = ['<name>', 'list', 'trigger <word> <rollover|hold|click|release>']
  override examples = [
    { input: '/menu', result: 'Opens the menu for the surface you are on' },
    { input: '/menu workflow', result: 'Opens the workflow vocabulary' },
    { input: '/menu list', result: 'Lists every registered menu and its surfaces' },
    { input: '/menu trigger copy hold', result: 'Copy fires on this tile after resting on it' },
  ]

  override slashComplete(args: string): readonly string[] {
    const query = args.trim().toLowerCase()
    const registry = get<QuickMenuRegistry>('@diamondcoreprocessor.com/QuickMenuRegistry')
    const names = ['list', 'trigger', ...(registry?.names() ?? [])]
    return names.filter(name => name.toLowerCase().startsWith(query))
  }

  protected async execute(args: string): Promise<void> {
    const argument = args.trim().toLowerCase()
    const registry = get<QuickMenuRegistry>('@diamondcoreprocessor.com/QuickMenuRegistry')
    if (argument === 'trigger' || argument.startsWith('trigger ')) {
      await this.#trigger(args.trim().slice('trigger'.length), registry)
      return
    }
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

  /** The mark lives on the tile that holds the seat, so a swapped automaton
   *  keeps the trigger its place was given. */
  async #trigger(args: string, registry: QuickMenuRegistry | undefined): Promise<void> {
    const parsed = parseTriggerArgs(args)
    if ('error' in parsed) { say('menu: say "menu trigger <word> <rollover|hold|click|release>"', 'error'); return }

    const here = standing()
    if (here.length === 0) { say('menu: stand in a tile to set its triggers', 'error'); return }
    const name = here[here.length - 1]
    const marks = await listDecorations<MenuTriggerRecord>({ kind: MENU_TRIGGER_KIND, segments: here })

    if (parsed.verb === 'list') {
      const lines = marks.map(mark => `${mark.record.payload.word}: ${mark.record.payload.trigger}`)
      say(lines.length ? lines.join('\n') : `"${name}" fires every seat on release`)
      return
    }

    const seat = registry?.all().flatMap(definition => definition.slots)
      .find(slot => sameTraitWord(slot.label, parsed.word))
    if (!seat) { say(`menu: no option called ${parsed.word}`, 'error'); return }

    for (const mark of marks.filter(m => sameTraitWord(m.record.payload?.word, seat.label))) {
      await removeDecorationAndWait({ sig: mark.sig, segments: here })
    }
    if (parsed.trigger !== 'release') {
      await writeDecoration<MenuTriggerRecord>({
        kind: MENU_TRIGGER_KIND,
        appliesTo: here,
        segments: here,
        payload: { word: seat.label, trigger: parsed.trigger },
        mark: 'persistent',
      })
    }
    say(`${seat.label} on "${name}" fires on ${parsed.trigger}`)
  }

  #log(message: string, icon = '⬡'): void {
    EffectBus.emit('activity:log', { message, icon })
  }
}

// THE BEE WIRES (atomic-modules-plan.md): a dependency registers nothing;
// its owner bee registers it.
window.ioc.register('@diamondcoreprocessor.com/QuickMenuRegistry', new QuickMenuRegistry())
window.ioc.register('@diamondcoreprocessor.com/QuickMenuInput', new QuickMenuInput())

const _quickMenu = new QuickMenuQueenBee()
window.ioc.register('@diamondcoreprocessor.com/QuickMenuQueenBee', _quickMenu)
