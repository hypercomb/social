// diamondcoreprocessor.com/ui/shortcut-sheet.drone.ts
//
// The /help reference sheet. Shows slash commands, command-line operations,
// and keyboard shortcuts — all auto-generated from runtime introspection so
// the sheet never drifts from the code.
import { EffectBus, type KeyBinding } from '@hypercomb/core'
import type { SlashBehaviour } from './slash-behaviour.provider.js'

export interface ShortcutGroup {
  category: string
  bindings: KeyBinding[]
}

export interface SlashCommandEntry {
  name: string
  aliases: readonly string[]
  description: string
}

export interface CommandLineOperationEntry {
  behavior: string
  trigger: string
  description: string
  example?: { input: string; result: string }
}

export interface ShortcutSheetState {
  open: boolean
  slashCommands: SlashCommandEntry[]
  commandLineOps: CommandLineOperationEntry[]
  shortcutGroups: ShortcutGroup[]
}

const CATEGORY_ORDER = [
  'Navigation', 'Clipboard', 'View',
]

type CommandLineOperationMeta = {
  trigger: string
  description: string
  examples: readonly { input: string; key: string; result: string }[]
}

type CommandLineBehaviorMeta = {
  name: string
  operations: readonly CommandLineOperationMeta[]
}

type SlashBehaviourDroneLike = {
  entries(): SlashBehaviour[]
}

export class ShortcutSheetDrone extends EventTarget {
  #open = false
  #slashCommands: SlashCommandEntry[] = []
  #commandLineOps: CommandLineOperationEntry[] = []
  #shortcutGroups: ShortcutGroup[] = []

  constructor() {
    super()

    EffectBus.on<{ cmd: string }>('keymap:invoke', (payload) => {
      if (payload?.cmd === 'ui.shortcutSheet') this.#toggle()
    })

    EffectBus.on('shortcut-sheet:close', () => {
      if (this.#open) this.#close()
    })
  }

  get state(): ShortcutSheetState {
    return {
      open: this.#open,
      slashCommands: this.#slashCommands,
      commandLineOps: this.#commandLineOps,
      shortcutGroups: this.#shortcutGroups,
    }
  }

  #toggle(): void {
    if (this.#open) this.#close()
    else this.#openSheet()
  }

  #openSheet(): void {
    this.#open = true
    this.#slashCommands = this.#buildSlashCommands()
    this.#commandLineOps = this.#buildCommandLineOps()
    this.#shortcutGroups = this.#buildShortcutGroups()
    EffectBus.emit('keymap:suppress', { reason: 'shortcut-sheet' })
    this.#emit()
  }

  #close(): void {
    this.#open = false
    EffectBus.emit('keymap:unsuppress', { reason: 'shortcut-sheet' })
    this.#emit()
  }

  #buildSlashCommands(): SlashCommandEntry[] {
    const drone = get('@diamondcoreprocessor.com/SlashBehaviourDrone') as SlashBehaviourDroneLike | undefined
    if (!drone) return []

    return drone.entries()
      .map(b => ({
        name: b.name,
        aliases: b.aliases ?? [],
        description: b.description,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  #buildCommandLineOps(): CommandLineOperationEntry[] {
    const reference = get('@hypercomb.social/CommandLineBehaviors') as readonly CommandLineBehaviorMeta[] | undefined
    if (!reference) return []

    const entries: CommandLineOperationEntry[] = []
    for (const behavior of reference) {
      for (const op of behavior.operations) {
        const first = op.examples[0]
        entries.push({
          behavior: behavior.name,
          trigger: op.trigger,
          description: op.description,
          example: first ? { input: first.input, result: first.result } : undefined,
        })
      }
    }
    return entries
  }

  #buildShortcutGroups(): ShortcutGroup[] {
    const keymap = get('@diamondcoreprocessor.com/KeyMapService') as any
    if (!keymap) return []

    const bindings: KeyBinding[] = keymap.getEffective?.() ?? []
    const grouped = new Map<string, KeyBinding[]>()

    // exclude self-referential UI commands (the sheet/palette themselves)
    const exclude = new Set(['ui.shortcutSheet', 'ui.commandPalette'])

    for (const b of bindings) {
      if (!b.description) continue
      if (exclude.has(b.cmd)) continue
      const cat = b.category ?? 'Other'
      const arr = grouped.get(cat) ?? []
      arr.push(b)
      grouped.set(cat, arr)
    }

    // sort by predefined category order
    const result: ShortcutGroup[] = []
    for (const cat of CATEGORY_ORDER) {
      const binds = grouped.get(cat)
      if (binds?.length) result.push({ category: cat, bindings: binds })
      grouped.delete(cat)
    }
    // append any remaining categories
    for (const [cat, binds] of grouped) {
      if (binds.length) result.push({ category: cat, bindings: binds })
    }

    return result
  }

  #emit(): void {
    this.dispatchEvent(new Event('change'))
    EffectBus.emit('shortcut-sheet:state', this.state)
  }
}

const _shortcutSheet = new ShortcutSheetDrone()
window.ioc.register('@diamondcoreprocessor.com/ShortcutSheetDrone', _shortcutSheet)
