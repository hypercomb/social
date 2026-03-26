// diamondcoreprocessor.com/ui/slash-command/slash-command.drone.ts
import { EffectBus, hypercomb } from '@hypercomb/core'
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
    void new hypercomb().act()
  }
}

class KeywordProvider implements SlashCommandProvider {
  readonly name = 'keyword-provider'
  readonly priority = 100
  readonly commands: SlashCommand[] = [
    { name: 'keyword', description: 'Add or remove keywords (tags) on selected tiles', aliases: ['kw', 'tag'] }
  ]

  async execute(_commandName: string, args: string): Promise<void> {
    const queen = get('@diamondcoreprocessor.com/KeywordQueenBee') as any
    if (queen?.invoke) {
      await queen.invoke(args)
    }
  }
}

class MeetingProvider implements SlashCommandProvider {
  readonly name = 'meeting-provider'
  readonly priority = 100
  readonly commands: SlashCommand[] = [
    { name: 'meeting', description: 'Start or join a video meeting on the selected tile', aliases: ['meet', 'call'] }
  ]

  async execute(_commandName: string, args: string): Promise<void> {
    const queen = get('@diamondcoreprocessor.com/MeetingQueenBee') as any
    if (queen?.invoke) {
      await queen.invoke(args)
    }
  }
}

class DebugProvider implements SlashCommandProvider {
  readonly name = 'debug-provider'
  readonly priority = 100
  readonly commands: SlashCommand[] = [
    { name: 'debug', description: 'Toggle the Pixi display-tree inspector', aliases: ['inspect', 'dbg'] }
  ]

  async execute(): Promise<void> {
    const queen = get('@diamondcoreprocessor.com/DebugQueenBee') as any
    if (queen?.invoke) {
      await queen.invoke('')
    }
  }
}

class DeleteProvider implements SlashCommandProvider {
  readonly name = 'delete-provider'
  readonly priority = 100
  readonly commands: SlashCommand[] = [
    { name: 'delete', description: 'Delete tiles from the current directory', aliases: ['del', 'rm'] }
  ]

  async execute(_commandName: string, args: string): Promise<void> {
    const queen = get('@diamondcoreprocessor.com/DeleteQueenBee') as any
    if (queen?.invoke) {
      await queen.invoke(args)
    }
  }
}

class FormatSlashProvider implements SlashCommandProvider {
  readonly name = 'format-provider'
  readonly priority = 100
  readonly commands: SlashCommand[] = [
    { name: 'format', description: 'Copy visual formatting from the active tile', aliases: ['fmt', 'fp'] }
  ]

  async execute(_commandName: string, args: string): Promise<void> {
    const queen = get('@diamondcoreprocessor.com/FormatQueenBee') as any
    if (queen?.invoke) await queen.invoke(args)
  }
}

class NeonProvider implements SlashCommandProvider {
  readonly name = 'neon-provider'
  readonly priority = 100
  readonly commands: SlashCommand[] = [
    { name: 'neon', description: 'Toggle the neon hover color toolbar' }
  ]

  execute(): void {
    EffectBus.emit('neon:toggle-toolbar', {})
  }
}

class LlmProvider implements SlashCommandProvider {
  readonly name = 'llm-provider'
  readonly priority = 100
  readonly commands: SlashCommand[] = [
    { name: 'opus', description: 'Send context to Claude Opus 4.6', aliases: ['o'] },
    { name: 'sonnet', description: 'Send context to Claude Sonnet', aliases: ['s'] },
    { name: 'haiku', description: 'Send context to Claude Haiku', aliases: ['h'] },
  ]

  async execute(commandName: string, args: string): Promise<void> {
    const queen = get('@diamondcoreprocessor.com/LlmQueenBee') as any
    if (queen) {
      queen.activeModel = commandName
      await queen.invoke(args)
    }
  }
}

// ── registration ────────────────────────────────────────

const _slashCommands = new SlashCommandDrone()
_slashCommands.addProvider(new HelpProvider())
_slashCommands.addProvider(new ClearProvider())
_slashCommands.addProvider(new KeywordProvider())
_slashCommands.addProvider(new MeetingProvider())
_slashCommands.addProvider(new DebugProvider())
_slashCommands.addProvider(new DeleteProvider())
_slashCommands.addProvider(new FormatSlashProvider())
_slashCommands.addProvider(new NeonProvider())
_slashCommands.addProvider(new LlmProvider())
window.ioc.register('@diamondcoreprocessor.com/SlashCommandDrone', _slashCommands)
