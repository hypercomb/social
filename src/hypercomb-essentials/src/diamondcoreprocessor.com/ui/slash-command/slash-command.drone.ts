// diamondcoreprocessor.com/ui/slash-command/slash-command.drone.ts
import { EffectBus } from '@hypercomb/core'
import type { SlashCommand, SlashCommandMatch, SlashCommandProvider } from './slash-command.provider.js'

export class SlashCommandDrone extends EventTarget {
  #providers: SlashCommandProvider[] = []

  addProvider(provider: SlashCommandProvider): void {
    this.#providers.push(provider)
    this.#providers.sort((a, b) => b.priority - a.priority)
  }

  all(): SlashCommand[] {
    return this.#providers.flatMap(p => p.commands)
  }

  match(query: string): SlashCommandMatch[] {
    const q = query.toLowerCase().trim()
    const results: SlashCommandMatch[] = []

    for (const provider of this.#providers) {
      for (const command of provider.commands) {
        const names = [command.name, ...(command.aliases ?? [])]
        if (!q || names.some(n => n.startsWith(q))) {
          results.push({ command, provider })
        }
      }
    }

    return results
  }

  execute(commandName: string, args: string): Promise<void> | void {
    const name = commandName.toLowerCase().trim()

    for (const provider of this.#providers) {
      for (const command of provider.commands) {
        const names = [command.name, ...(command.aliases ?? [])]
        if (names.includes(name)) {
          return provider.execute(command.name, args)
        }
      }
    }
  }
}

// ── starter providers ───────────────────────────────────

class HelpProvider implements SlashCommandProvider {
  readonly name = 'help-provider'
  readonly priority = 100
  readonly commands: SlashCommand[] = [
    { name: 'help', description: 'Show keyboard shortcuts' }
  ]

  execute(): void {
    EffectBus.emit('keymap:invoke', { cmd: 'ui.shortcutSheet', binding: null, event: null })
  }
}

class ClearProvider implements SlashCommandProvider {
  readonly name = 'clear-provider'
  readonly priority = 100
  readonly commands: SlashCommand[] = [
    { name: 'clear', description: 'Clear active filter' }
  ]

  execute(): void {
    EffectBus.emit('search:filter', { keyword: '' })
    window.dispatchEvent(new Event('synchronize'))
  }
}

// ── registration ────────────────────────────────────────

const _slashCommands = new SlashCommandDrone()
_slashCommands.addProvider(new HelpProvider())
_slashCommands.addProvider(new ClearProvider())
window.ioc.register('@diamondcoreprocessor.com/SlashCommandDrone', _slashCommands)
