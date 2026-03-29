// diamondcoreprocessor.com/ui/slash-command/slash-command.drone.ts
import { EffectBus, hypercomb, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import type { SlashCommand, SlashCommandMatch, SlashCommandProvider } from './slash-command.provider.js'

export class SlashCommandDrone extends EventTarget {
  #providers: SlashCommandProvider[] = []

  addProvider(provider: SlashCommandProvider): void {
    this.#providers.push(provider)
    this.#providers.sort((a, b) => b.priority - a.priority)
  }

  all(): SlashCommand[] {
    return this.#providers.flatMap(p => p.commands).map(c => this.#localize(c))
  }

  match(query: string): SlashCommandMatch[] {
    const q = query.toLowerCase().trim()
    const results: SlashCommandMatch[] = []

    for (const provider of this.#providers) {
      for (const command of provider.commands) {
        const names = [command.name, ...(command.aliases ?? [])]
        if (!q || names.some(n => n.startsWith(q))) {
          results.push({ command: this.#localize(command), provider })
        }
      }
    }

    return results
  }

  #localize(command: SlashCommand): SlashCommand {
    if (!command.descriptionKey) return command
    const i18n = get(I18N_IOC_KEY) as I18nProvider | undefined
    if (!i18n) return command
    const translated = i18n.t(command.descriptionKey)
    if (translated === command.descriptionKey) return command
    return { ...command, description: translated }
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
    { name: 'help', description: 'Show keyboard shortcuts', descriptionKey: 'slash.help' }
  ]

  execute(): void {
    EffectBus.emit('keymap:invoke', { cmd: 'ui.shortcutSheet', binding: null, event: null })
  }
}

class ClearProvider implements SlashCommandProvider {
  readonly name = 'clear-provider'
  readonly priority = 100
  readonly commands: SlashCommand[] = [
    { name: 'clear', description: 'Clear active filter', descriptionKey: 'slash.clear' }
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
    { name: 'keyword', description: 'Add or remove keywords (tags) on selected tiles', descriptionKey: 'slash.keyword', aliases: ['kw', 'tag'] }
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
    { name: 'meeting', description: 'Start or join a video meeting on the selected tile', descriptionKey: 'slash.meeting', aliases: ['meet', 'call'] }
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
    { name: 'debug', description: 'Toggle the Pixi display-tree inspector', descriptionKey: 'slash.debug', aliases: ['inspect', 'dbg'] }
  ]

  async execute(): Promise<void> {
    const queen = get('@diamondcoreprocessor.com/DebugQueenBee') as any
    if (queen?.invoke) {
      await queen.invoke('')
    }
  }
}

class RemoveProvider implements SlashCommandProvider {
  readonly name = 'remove-provider'
  readonly priority = 100
  readonly commands: SlashCommand[] = [
    { name: 'remove', description: 'Remove tiles from the current directory', descriptionKey: 'slash.remove', aliases: ['rm'] }
  ]

  async execute(_commandName: string, args: string): Promise<void> {
    const queen = get('@diamondcoreprocessor.com/RemoveQueenBee') as any
    if (queen?.invoke) {
      await queen.invoke(args)
    }
  }
}

class FormatSlashProvider implements SlashCommandProvider {
  readonly name = 'format-provider'
  readonly priority = 100
  readonly commands: SlashCommand[] = [
    { name: 'format', description: 'Copy visual formatting from the active tile', descriptionKey: 'slash.format', aliases: ['fmt', 'fp'] }
  ]

  async execute(_commandName: string, args: string): Promise<void> {
    const queen = get('@diamondcoreprocessor.com/FormatQueenBee') as any
    if (queen?.invoke) await queen.invoke(args)
  }
}

class LayoutProvider implements SlashCommandProvider {
  readonly name = 'layout-provider'
  readonly priority = 100
  readonly commands: SlashCommand[] = [
    { name: 'layout', description: 'Save, apply, list, or remove layout templates', descriptionKey: 'slash.layout', aliases: ['lo'] }
  ]

  async execute(_commandName: string, args: string): Promise<void> {
    const queen = get('@diamondcoreprocessor.com/LayoutQueenBee') as any
    if (queen?.invoke) await queen.invoke(args)
  }
}

class NeonProvider implements SlashCommandProvider {
  readonly name = 'neon-provider'
  readonly priority = 100
  readonly commands: SlashCommand[] = [
    { name: 'neon', description: 'Toggle the neon hover color toolbar', descriptionKey: 'slash.neon' }
  ]

  execute(): void {
    EffectBus.emit('neon:toggle-toolbar', {})
  }
}

class MoveProvider implements SlashCommandProvider {
  readonly name = 'move-provider'
  readonly priority = 100
  readonly commands: SlashCommand[] = [
    { name: 'move', description: 'Toggle move mode for drag-reordering tiles', descriptionKey: 'slash.move' }
  ]

  async execute(_commandName: string, args: string): Promise<void> {
    // /move(index) — commit a move using the current selection
    const indexMatch = args.match(/\((\d+)\)/) || args.match(/\((\d+)$/)
    if (indexMatch) {
      const targetIndex = parseInt(indexMatch[1], 10)
      const selection = get('@diamondcoreprocessor.com/SelectionService') as
        { selected: ReadonlySet<string> } | undefined
      const labels = selection ? Array.from(selection.selected) : []
      if (labels.length > 0) {
        const moveDrone = get('@diamondcoreprocessor.com/MoveDrone') as any
        if (moveDrone) {
          if (moveDrone.moveCommandActive) moveDrone.cancelCommandMove()
          moveDrone.beginCommandMove(labels)
          await moveDrone.commitCommandMoveAt(targetIndex)
        }
      }
      return
    }

    // /move — toggle move mode
    EffectBus.emit('controls:action', { action: 'move' })
  }
}

class ReviseProvider implements SlashCommandProvider {
  readonly name = 'revise-provider'
  readonly priority = 100
  readonly commands: SlashCommand[] = [
    { name: 'revise', description: 'Toggle revision mode (history clock)', descriptionKey: 'slash.revise', aliases: ['rev', 'history'] }
  ]

  async execute(_commandName: string, args: string): Promise<void> {
    const queen = get('@diamondcoreprocessor.com/ReviseQueenBee') as any
    if (queen?.invoke) await queen.invoke(args)
  }
}

class ExpandProvider implements SlashCommandProvider {
  readonly name = 'expand-provider'
  readonly priority = 100
  readonly commands: SlashCommand[] = [
    { name: 'expand', description: 'Expand selected tiles into constituent parts via Claude Haiku', descriptionKey: 'slash.expand', aliases: ['atomize'] }
  ]

  async execute(_commandName: string, _args: string): Promise<void> {
    const selection = get('@diamondcoreprocessor.com/SelectionService') as
      { selected: ReadonlySet<string> } | undefined
    const targets = selection ? Array.from(selection.selected) : []

    if (targets.length === 0) return

    for (const label of targets) {
      EffectBus.emit('tile:action', { action: 'expand', label, q: 0, r: 0, index: 0 })
    }
  }
}

class ChatProvider implements SlashCommandProvider {
  readonly name = 'chat-provider'
  readonly priority = 100
  readonly commands: SlashCommand[] = [
    { name: 'chat', description: 'Multi-turn conversation with Claude', aliases: ['c', 'ask'] }
  ]

  async execute(_commandName: string, args: string): Promise<void> {
    const queen = get('@diamondcoreprocessor.com/ConversationQueenBee') as any
    if (queen?.invoke) await queen.invoke(args)
  }
}

class LlmProvider implements SlashCommandProvider {
  readonly name = 'llm-provider'
  readonly priority = 100
  readonly commands: SlashCommand[] = [
    { name: 'opus', description: 'Send context to Claude Opus 4.6', descriptionKey: 'slash.opus', aliases: ['o'] },
    { name: 'sonnet', description: 'Send context to Claude Sonnet', descriptionKey: 'slash.sonnet', aliases: ['s'] },
    { name: 'haiku', description: 'Send context to Claude Haiku', descriptionKey: 'slash.haiku', aliases: ['h'] },
  ]

  async execute(commandName: string, args: string): Promise<void> {
    const queen = get('@diamondcoreprocessor.com/LlmQueenBee') as any
    if (queen) {
      queen.activeModel = commandName
      await queen.invoke(args)
    }
  }
}

class LanguageProvider implements SlashCommandProvider {
  readonly name = 'language-provider'
  readonly priority = 100
  readonly commands: SlashCommand[] = [
    { name: 'language', description: 'Switch the UI language', descriptionKey: 'slash.language', aliases: ['lang', 'locale'] }
  ]

  async execute(_commandName: string, args: string): Promise<void> {
    const queen = get('@diamondcoreprocessor.com/LanguageQueenBee') as any
    if (queen?.invoke) await queen.invoke(args)
  }
}

class ArrangeProvider implements SlashCommandProvider {
  readonly name = 'arrange-provider'
  readonly priority = 100
  readonly commands: SlashCommand[] = [
    { name: 'arrange', description: 'Toggle icon arrangement mode on the tile overlay', descriptionKey: 'slash.arrange' }
  ]

  async execute(): Promise<void> {
    const queen = get('@diamondcoreprocessor.com/ArrangeQueenBee') as any
    if (queen?.invoke) await queen.invoke('')
  }
}

class VoiceProvider implements SlashCommandProvider {
  readonly name = 'voice-provider'
  readonly priority = 100
  readonly commands: SlashCommand[] = [
    { name: 'voice', description: 'Toggle voice input (speech-to-text)', descriptionKey: 'slash.voice' }
  ]

  async execute(): Promise<void> {
    const svc = get('@hypercomb.social/VoiceInputService') as { toggle?: () => void } | undefined
    svc?.toggle?.()
  }
}

// ── registration ────────────────────────────────────────

const _slashCommands = new SlashCommandDrone()
_slashCommands.addProvider(new HelpProvider())
_slashCommands.addProvider(new ClearProvider())
_slashCommands.addProvider(new KeywordProvider())
_slashCommands.addProvider(new MeetingProvider())
_slashCommands.addProvider(new DebugProvider())
_slashCommands.addProvider(new RemoveProvider())
_slashCommands.addProvider(new FormatSlashProvider())
_slashCommands.addProvider(new LayoutProvider())
_slashCommands.addProvider(new NeonProvider())
_slashCommands.addProvider(new MoveProvider())
_slashCommands.addProvider(new ReviseProvider())
_slashCommands.addProvider(new ExpandProvider())
_slashCommands.addProvider(new ChatProvider())
_slashCommands.addProvider(new LlmProvider())
_slashCommands.addProvider(new LanguageProvider())
_slashCommands.addProvider(new ArrangeProvider())
_slashCommands.addProvider(new VoiceProvider())
window.ioc.register('@diamondcoreprocessor.com/SlashCommandDrone', _slashCommands)
