// diamondcoreprocessor.com/ui/slash-behaviour/slash-behaviour.drone.ts
import { EffectBus, hypercomb, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import type { SlashBehaviour, SlashBehaviourMatch, SlashBehaviourProvider } from './slash-behaviour.provider.js'

export class SlashBehaviourDrone extends EventTarget {
  #providers: SlashBehaviourProvider[] = []

  addProvider(provider: SlashBehaviourProvider): void {
    this.#providers.push(provider)
    this.#providers.sort((a, b) => b.priority - a.priority)
  }

  all(): SlashBehaviour[] {
    const results: SlashBehaviour[] = []
    for (const provider of this.#providers) {
      for (const behaviour of provider.behaviours) {
        const localized = this.#localize(behaviour)
        results.push(localized)
        for (const alias of behaviour.aliases ?? []) {
          results.push({ ...localized, name: alias })
        }
      }
    }
    return results
  }

  match(query: string): SlashBehaviourMatch[] {
    const q = query.toLowerCase().trim()
    const results: SlashBehaviourMatch[] = []

    for (const provider of this.#providers) {
      for (const behaviour of provider.behaviours) {
        const localized = this.#localize(behaviour)
        const names = [behaviour.name, ...(behaviour.aliases ?? [])]

        for (const name of names) {
          if (!q || name.startsWith(q)) {
            // each matching name (primary or alias) becomes its own entry
            // so autocomplete sees every reachable name, not just the primary
            results.push({
              behaviour: name === behaviour.name
                ? localized
                : { ...localized, name },
              provider,
            })
          }
        }
      }
    }

    return results
  }

  #localize(behaviour: SlashBehaviour): SlashBehaviour {
    if (!behaviour.descriptionKey) return behaviour
    const i18n = get(I18N_IOC_KEY) as I18nProvider | undefined
    if (!i18n) return behaviour
    const translated = i18n.t(behaviour.descriptionKey)
    if (translated === behaviour.descriptionKey) return behaviour
    return { ...behaviour, description: translated }
  }

  complete(behaviourName: string, args: string): readonly string[] {
    const name = behaviourName.toLowerCase().trim()

    for (const provider of this.#providers) {
      for (const behaviour of provider.behaviours) {
        const names = [behaviour.name, ...(behaviour.aliases ?? [])]
        if (names.includes(name) && provider.complete) {
          return provider.complete(behaviour.name, args)
        }
      }
    }
    return []
  }

  execute(behaviourName: string, args: string): Promise<void> | void {
    const name = behaviourName.toLowerCase().trim()

    for (const provider of this.#providers) {
      for (const behaviour of provider.behaviours) {
        const names = [behaviour.name, ...(behaviour.aliases ?? [])]
        if (names.includes(name)) {
          return provider.execute(behaviour.name, args)
        }
      }
    }
  }
}

// ── starter providers ───────────────────────────────────

class HelpProvider implements SlashBehaviourProvider {
  readonly name = 'help-provider'
  readonly priority = 100
  readonly behaviours: SlashBehaviour[] = [
    { name: 'help', description: 'Show keyboard shortcuts', descriptionKey: 'slash.help' }
  ]

  execute(): void {
    EffectBus.emit('keymap:invoke', { cmd: 'ui.shortcutSheet', binding: null, event: null })
  }
}

class ClearProvider implements SlashBehaviourProvider {
  readonly name = 'clear-provider'
  readonly priority = 100
  readonly behaviours: SlashBehaviour[] = [
    { name: 'clear', description: 'Clear active filter', descriptionKey: 'slash.clear' }
  ]

  execute(): void {
    EffectBus.emit('search:filter', { keyword: '' })
    void new hypercomb().act()
  }
}

class KeywordProvider implements SlashBehaviourProvider {
  readonly name = 'keyword-provider'
  readonly priority = 100
  readonly behaviours: SlashBehaviour[] = [
    { name: 'keyword', description: 'Add or remove keywords (tags) on selected tiles', descriptionKey: 'slash.keyword' }
  ]

  async execute(_behaviourName: string, args: string): Promise<void> {
    const queen = get('@diamondcoreprocessor.com/KeywordQueenBee') as any
    if (queen?.invoke) {
      await queen.invoke(args)
    }
  }

  complete(_behaviourName: string, args: string): readonly string[] {
    const registry = get('@hypercomb.social/TagRegistry') as { names: string[] } | undefined
    const tagNames = registry?.names ?? []
    const q = args.toLowerCase().trim()
    // strip leading ~ (remove prefix) for matching
    const prefix = q.startsWith('~') ? q.slice(1) : q
    if (!prefix) return tagNames
    return tagNames.filter(t => t.toLowerCase().startsWith(prefix))
  }
}

class MeetingProvider implements SlashBehaviourProvider {
  readonly name = 'meeting-provider'
  readonly priority = 100
  readonly behaviours: SlashBehaviour[] = [
    { name: 'meeting', description: 'Start or join a video meeting on the selected tile', descriptionKey: 'slash.meeting' }
  ]

  async execute(_behaviourName: string, args: string): Promise<void> {
    const queen = get('@diamondcoreprocessor.com/MeetingQueenBee') as any
    if (queen?.invoke) {
      await queen.invoke(args)
    }
  }
}

class DebugProvider implements SlashBehaviourProvider {
  readonly name = 'debug-provider'
  readonly priority = 100
  readonly behaviours: SlashBehaviour[] = [
    { name: 'debug', description: 'Toggle the Pixi display-tree inspector', descriptionKey: 'slash.debug' }
  ]

  async execute(): Promise<void> {
    const queen = get('@diamondcoreprocessor.com/DebugQueenBee') as any
    if (queen?.invoke) {
      await queen.invoke('')
    }
  }
}

class RemoveProvider implements SlashBehaviourProvider {
  readonly name = 'remove-provider'
  readonly priority = 100
  readonly behaviours: SlashBehaviour[] = [
    { name: 'remove', description: 'Remove tiles from the current directory', descriptionKey: 'slash.remove' }
  ]

  async execute(_behaviourName: string, args: string): Promise<void> {
    const queen = get('@diamondcoreprocessor.com/RemoveQueenBee') as any
    if (queen?.invoke) {
      await queen.invoke(args)
    }
  }

  complete(_behaviourName: string, args: string): readonly string[] {
    const cellProvider = get('@hypercomb.social/CellSuggestionProvider') as { suggestions(): string[] } | undefined
    const cells = cellProvider?.suggestions() ?? []

    // Bracket mode: /remove[cell1,cell2,partial
    const bracketStart = args.indexOf('[')
    if (bracketStart >= 0) {
      const inner = args.slice(bracketStart + 1)
      const lastComma = inner.lastIndexOf(',')
      const fragment = (lastComma >= 0 ? inner.slice(lastComma + 1) : inner).trimStart().toLowerCase()
      const already = new Set<string>()
      for (const item of inner.split(',')) {
        const n = item.trim().toLowerCase()
        if (n && n !== fragment) already.add(n)
      }
      let filtered = cells.filter(n => !already.has(n))
      if (fragment) filtered = filtered.filter(n => n.startsWith(fragment))
      return filtered
    }

    // Space mode
    const q = args.toLowerCase().trim()
    if (!q) return cells
    return cells.filter(n => n.startsWith(q))
  }
}

class FormatSlashProvider implements SlashBehaviourProvider {
  readonly name = 'format-provider'
  readonly priority = 100
  readonly behaviours: SlashBehaviour[] = [
    { name: 'format', description: 'Copy visual formatting from the active tile', descriptionKey: 'slash.format' }
  ]

  async execute(_behaviourName: string, args: string): Promise<void> {
    const queen = get('@diamondcoreprocessor.com/FormatQueenBee') as any
    if (queen?.invoke) await queen.invoke(args)
  }
}

class LayoutProvider implements SlashBehaviourProvider {
  readonly name = 'layout-provider'
  readonly priority = 100
  readonly behaviours: SlashBehaviour[] = [
    { name: 'layout', description: 'Save, apply, list, or remove layout templates', descriptionKey: 'slash.layout' }
  ]

  async execute(_behaviourName: string, args: string): Promise<void> {
    const queen = get('@diamondcoreprocessor.com/LayoutQueenBee') as any
    if (queen?.invoke) await queen.invoke(args)
  }

  complete(_behaviourName: string, args: string): readonly string[] {
    const subcommands = ['save', 'apply', 'list', 'remove']
    const q = args.toLowerCase().trim()
    if (!q) return subcommands
    return subcommands.filter(s => s.startsWith(q))
  }
}

class AccentProvider implements SlashBehaviourProvider {
  readonly name = 'accent-provider'
  readonly priority = 100
  readonly behaviours: SlashBehaviour[] = [
    { name: 'accent', description: 'Set the hover accent color by name', descriptionKey: 'slash.accent' }
  ]

  async execute(_behaviourName: string, args: string): Promise<void> {
    const queen = get('@diamondcoreprocessor.com/AccentQueenBee') as any
    if (queen?.invoke) await queen.invoke(args)
  }

  complete(_behaviourName: string, args: string): readonly string[] {
    const presets = ['glacier', 'bloom', 'aurora', 'ember', 'nebula']
    const registry = get('@hypercomb.social/TagRegistry') as { names: string[] } | undefined
    const tagNames = registry?.names ?? []

    // Bracket mode: /accent[tag1,tag2,partial
    const bracketStart = args.indexOf('[')
    if (bracketStart >= 0) {
      const bracketClose = args.indexOf(']', bracketStart)
      if (bracketClose < 0) {
        // Inside brackets — suggest tag names, exclude already chosen
        const inner = args.slice(bracketStart + 1)
        const lastComma = inner.lastIndexOf(',')
        const fragment = (lastComma >= 0 ? inner.slice(lastComma + 1) : inner).trimStart().toLowerCase()
        const already = new Set<string>()
        for (const item of inner.split(',')) {
          const n = item.trim().toLowerCase()
          if (n && n !== fragment) already.add(n)
        }
        let tags = tagNames.filter(t => !already.has(t.toLowerCase()))
        if (fragment) tags = tags.filter(t => t.toLowerCase().startsWith(fragment))
        return tags
      }
      // After closed brackets — suggest presets
      const after = args.slice(bracketClose + 1).trimStart().toLowerCase()
      if (!after) return presets
      return presets.filter(p => p.startsWith(after))
    }

    // Space mode: suggest presets + tags
    const all = [...presets, ...tagNames.filter(t => !presets.includes(t))]

    // Two-arg form: first arg done, suggest presets for second
    const parts = args.split(/\s+/)
    if (parts.length >= 2) {
      const q = parts[parts.length - 1].toLowerCase()
      if (!q) return presets
      return presets.filter(p => p.startsWith(q))
    }

    const q = args.toLowerCase().trim()
    if (!q) return all
    return all.filter(n => n.toLowerCase().startsWith(q))
  }
}

class MoveProvider implements SlashBehaviourProvider {
  readonly name = 'move-provider'
  readonly priority = 100
  readonly behaviours: SlashBehaviour[] = [
    { name: 'move', description: 'Toggle move mode for drag-reordering tiles', descriptionKey: 'slash.move' }
  ]

  async execute(_behaviourName: string, args: string): Promise<void> {
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

class ReviseProvider implements SlashBehaviourProvider {
  readonly name = 'revise-provider'
  readonly priority = 100
  readonly behaviours: SlashBehaviour[] = [
    { name: 'revise', description: 'Toggle revision mode (history clock)', descriptionKey: 'slash.revise' }
  ]

  async execute(_behaviourName: string, args: string): Promise<void> {
    const queen = get('@diamondcoreprocessor.com/ReviseQueenBee') as any
    if (queen?.invoke) await queen.invoke(args)
  }
}

class ExpandProvider implements SlashBehaviourProvider {
  readonly name = 'expand-provider'
  readonly priority = 100
  readonly behaviours: SlashBehaviour[] = [
    { name: 'expand', description: 'Expand selected tiles into constituent parts via Claude Haiku', descriptionKey: 'slash.expand' }
  ]

  async execute(_behaviourName: string, _args: string): Promise<void> {
    const selection = get('@diamondcoreprocessor.com/SelectionService') as
      { selected: ReadonlySet<string> } | undefined
    const targets = selection ? Array.from(selection.selected) : []

    if (targets.length === 0) return

    for (const label of targets) {
      EffectBus.emit('tile:action', { action: 'expand', label, q: 0, r: 0, index: 0 })
    }
  }
}

class ChatProvider implements SlashBehaviourProvider {
  readonly name = 'chat-provider'
  readonly priority = 100
  readonly behaviours: SlashBehaviour[] = [
    { name: 'chat', description: 'Multi-turn conversation with Claude' }
  ]

  async execute(_behaviourName: string, args: string): Promise<void> {
    const queen = get('@diamondcoreprocessor.com/ConversationQueenBee') as any
    if (queen?.invoke) await queen.invoke(args)
  }
}

class LlmProvider implements SlashBehaviourProvider {
  readonly name = 'llm-provider'
  readonly priority = 100
  readonly behaviours: SlashBehaviour[] = [
    { name: 'opus', description: 'Send context to Claude Opus 4.6', descriptionKey: 'slash.opus' },
    { name: 'sonnet', description: 'Send context to Claude Sonnet', descriptionKey: 'slash.sonnet' },
    { name: 'haiku', description: 'Send context to Claude Haiku', descriptionKey: 'slash.haiku' },
  ]

  async execute(behaviourName: string, args: string): Promise<void> {
    const queen = get('@diamondcoreprocessor.com/LlmQueenBee') as any
    if (queen) {
      queen.activeModel = behaviourName
      await queen.invoke(args)
    }
  }
}

class LanguageProvider implements SlashBehaviourProvider {
  readonly name = 'language-provider'
  readonly priority = 100
  readonly behaviours: SlashBehaviour[] = [
    { name: 'language', description: 'Switch the UI language', descriptionKey: 'slash.language' }
  ]

  async execute(_behaviourName: string, args: string): Promise<void> {
    const queen = get('@diamondcoreprocessor.com/LanguageQueenBee') as any
    if (queen?.invoke) await queen.invoke(args)
  }

  complete(_behaviourName: string, args: string): readonly string[] {
    const locales = ['en', 'ja']
    const q = args.toLowerCase().trim()
    if (!q) return locales
    return locales.filter(l => l.startsWith(q))
  }
}

class ArrangeProvider implements SlashBehaviourProvider {
  readonly name = 'arrange-provider'
  readonly priority = 100
  readonly behaviours: SlashBehaviour[] = [
    { name: 'arrange', description: 'Toggle icon arrangement mode on the tile overlay', descriptionKey: 'slash.arrange' }
  ]

  async execute(): Promise<void> {
    const queen = get('@diamondcoreprocessor.com/ArrangeQueenBee') as any
    if (queen?.invoke) await queen.invoke('')
  }
}

class VoiceProvider implements SlashBehaviourProvider {
  readonly name = 'voice-provider'
  readonly priority = 100
  readonly behaviours: SlashBehaviour[] = [
    { name: 'voice', description: 'Toggle voice input (speech-to-text)', descriptionKey: 'slash.voice' }
  ]

  async execute(): Promise<void> {
    const svc = get('@hypercomb.social/VoiceInputService') as { toggle?: () => void } | undefined
    svc?.toggle?.()
  }
}

class PushToTalkProvider implements SlashBehaviourProvider {
  readonly name = 'push-to-talk-provider'
  readonly priority = 100
  readonly behaviours: SlashBehaviour[] = [
    { name: 'push-to-talk', description: 'Toggle push-to-talk mic button', descriptionKey: 'slash.push-to-talk' }
  ]

  async execute(): Promise<void> {
    const current = localStorage.getItem('hc:push-to-talk') === 'true'
    const next = !current
    localStorage.setItem('hc:push-to-talk', String(next))
    EffectBus.emit('push-to-talk:toggle', { enabled: next })
  }
}

class TextOnlyProvider implements SlashBehaviourProvider {
  readonly name = 'text-only-provider'
  readonly priority = 100
  readonly behaviours: SlashBehaviour[] = [
    { name: 'text-only', description: 'Toggle text-only mode (hide images)', descriptionKey: 'slash.text-only' }
  ]

  #active = false

  execute(): void {
    this.#active = !this.#active
    EffectBus.emit('render:set-text-only', { textOnly: this.#active })
  }
}

class InstructionsProvider implements SlashBehaviourProvider {
  readonly name = 'instructions-provider'
  readonly priority = 100
  readonly behaviours: SlashBehaviour[] = [
    { name: 'instructions', description: 'Toggle instruction overlay', descriptionKey: 'slash.instructions' }
  ]

  execute(): void {
    EffectBus.emit('instruction:toggle', undefined)
  }
}

class AtomizeUiProvider implements SlashBehaviourProvider {
  readonly name = 'atomize-ui-provider'
  readonly priority = 100
  readonly behaviours: SlashBehaviour[] = [
    { name: 'atomize-ui', description: 'Toggle the atomizer toolbar', descriptionKey: 'slash.atomize-ui' }
  ]

  execute(): void {
    EffectBus.emit('atomizer-bar:toggle', { active: true })
  }
}

class DocsProvider implements SlashBehaviourProvider {
  readonly name = 'docs-provider'
  readonly priority = 100
  readonly behaviours: SlashBehaviour[] = [
    { name: 'docs', description: 'Browse project documentation', descriptionKey: 'slash.docs' }
  ]

  execute(_behaviourName: string, args: string): void {
    EffectBus.emit('docs:open', { page: args.trim() || '' })
  }
}

class DomainProvider implements SlashBehaviourProvider {
  readonly name = 'domain-provider'
  readonly priority = 100
  readonly behaviours: SlashBehaviour[] = [
    { name: 'domain', description: 'Add, remove, or list mesh relay domains', descriptionKey: 'slash.domain' }
  ]

  async execute(_behaviourName: string, args: string): Promise<void> {
    const queen = get('@diamondcoreprocessor.com/DomainQueenBee') as any
    if (queen?.invoke) await queen.invoke(args)
  }

  complete(_behaviourName: string, args: string): readonly string[] {
    const subcommands = ['list', 'remove', 'clear']
    const q = args.toLowerCase().trim()
    if (!q) return subcommands
    return subcommands.filter(s => s.startsWith(q))
  }
}

class SubstrateProvider implements SlashBehaviourProvider {
  readonly name = 'substrate-provider'
  readonly priority = 100
  readonly behaviours: SlashBehaviour[] = [
    { name: 'substrate', description: 'Toggle default background images for new tiles', descriptionKey: 'slash.substrate' }
  ]

  async execute(_behaviourName: string, args: string): Promise<void> {
    const queen = get('@diamondcoreprocessor.com/SubstrateQueenBee') as any
    if (queen?.invoke) await queen.invoke(args)
  }

  complete(_behaviourName: string, args: string): readonly string[] {
    const q = args.toLowerCase().trim()
    if (!q) return ['here']
    return ['here'].filter(s => s.startsWith(q))
  }
}

class RerollProvider implements SlashBehaviourProvider {
  readonly name = 'reroll-provider'
  readonly priority = 100
  readonly behaviours: SlashBehaviour[] = [
    { name: 'reroll', description: 'Reroll substrate background images on tiles', descriptionKey: 'slash.reroll' }
  ]

  async execute(_behaviourName: string, args: string): Promise<void> {
    const queen = get('@diamondcoreprocessor.com/RerollQueenBee') as any
    if (queen?.invoke) await queen.invoke(args)
  }

  complete(_behaviourName: string, args: string): readonly string[] {
    const cellProvider = get('@hypercomb.social/CellSuggestionProvider') as { suggestions(): string[] } | undefined
    const cells = cellProvider?.suggestions() ?? []

    // Bracket mode: /reroll[cell1,cell2,partial — same pattern as /remove and
    // /accent so every batch-target command behaves identically.
    const bracketStart = args.indexOf('[')
    if (bracketStart >= 0) {
      const inner = args.slice(bracketStart + 1)
      const lastComma = inner.lastIndexOf(',')
      const fragment = (lastComma >= 0 ? inner.slice(lastComma + 1) : inner).trimStart().toLowerCase()
      const already = new Set<string>()
      for (const item of inner.split(',')) {
        const n = item.trim().toLowerCase()
        if (n && n !== fragment) already.add(n)
      }
      let filtered = cells.filter(n => !already.has(n))
      if (fragment) filtered = filtered.filter(n => n.startsWith(fragment))
      return filtered
    }

    // Space mode — single tile name
    const q = args.toLowerCase().trim()
    if (!q) return cells
    return cells.filter(n => n.startsWith(q))
  }
}

class RecordingProvider implements SlashBehaviourProvider {
  readonly name = 'recording-provider'
  readonly priority = 100
  readonly behaviours: SlashBehaviour[] = [
    { name: 'record', description: 'Start AI-powered meeting recording with live hierarchy compilation', descriptionKey: 'slash.record' }
  ]

  async execute(_behaviourName: string, args: string): Promise<void> {
    const queen = get('@diamondcoreprocessor.com/RecordingQueenBee') as any
    if (queen?.invoke) await queen.invoke(args)
  }

  complete(_behaviourName: string, args: string): readonly string[] {
    const q = args.toLowerCase().trim()
    const options = ['start', 'stop', 'interval', 'model']
    if (!q) return options
    return options.filter(s => s.startsWith(q))
  }
}

// ── registration ────────────────────────────────────────

const _slashBehaviours = new SlashBehaviourDrone()
_slashBehaviours.addProvider(new HelpProvider())
_slashBehaviours.addProvider(new ClearProvider())
_slashBehaviours.addProvider(new KeywordProvider())
_slashBehaviours.addProvider(new MeetingProvider())
_slashBehaviours.addProvider(new DebugProvider())
_slashBehaviours.addProvider(new RemoveProvider())
_slashBehaviours.addProvider(new FormatSlashProvider())
_slashBehaviours.addProvider(new LayoutProvider())
_slashBehaviours.addProvider(new AccentProvider())
_slashBehaviours.addProvider(new MoveProvider())
_slashBehaviours.addProvider(new ReviseProvider())
_slashBehaviours.addProvider(new ExpandProvider())
_slashBehaviours.addProvider(new ChatProvider())
_slashBehaviours.addProvider(new LlmProvider())
_slashBehaviours.addProvider(new LanguageProvider())
_slashBehaviours.addProvider(new ArrangeProvider())
_slashBehaviours.addProvider(new VoiceProvider())
_slashBehaviours.addProvider(new PushToTalkProvider())
_slashBehaviours.addProvider(new TextOnlyProvider())
_slashBehaviours.addProvider(new InstructionsProvider())
_slashBehaviours.addProvider(new AtomizeUiProvider())
_slashBehaviours.addProvider(new DocsProvider())
_slashBehaviours.addProvider(new DomainProvider())
_slashBehaviours.addProvider(new SubstrateProvider())
_slashBehaviours.addProvider(new RerollProvider())
_slashBehaviours.addProvider(new RecordingProvider())
window.ioc.register('@diamondcoreprocessor.com/SlashBehaviourDrone', _slashBehaviours)
