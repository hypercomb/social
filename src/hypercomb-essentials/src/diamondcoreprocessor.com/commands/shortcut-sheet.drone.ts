// diamondcoreprocessor.com/ui/shortcut-sheet.drone.ts
import { EffectBus, type KeyBinding } from '@hypercomb/core'

export interface ShortcutGroup {
  category: string
  bindings: KeyBinding[]
}

export interface ShortcutSheetState {
  open: boolean
  groups: ShortcutGroup[]
}

const CATEGORY_ORDER = [
  'Navigation', 'Clipboard', 'View',
]

export class ShortcutSheetDrone extends EventTarget {
  #open = false
  #groups: ShortcutGroup[] = []

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
    return { open: this.#open, groups: this.#groups }
  }

  #toggle(): void {
    if (this.#open) this.#close()
    else this.#openSheet()
  }

  #openSheet(): void {
    this.#open = true
    this.#groups = this.#buildGroups()
    EffectBus.emit('keymap:suppress', { reason: 'shortcut-sheet' })
    this.#emit()
  }

  #close(): void {
    this.#open = false
    EffectBus.emit('keymap:unsuppress', { reason: 'shortcut-sheet' })
    this.#emit()
  }

  #buildGroups(): ShortcutGroup[] {
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
