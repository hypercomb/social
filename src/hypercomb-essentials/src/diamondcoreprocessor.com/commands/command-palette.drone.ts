// diamondcoreprocessor.com/ui/command-palette.drone.ts
import { EffectBus, type KeyBinding } from '@hypercomb/core'

export interface PaletteItem {
  id: string
  label: string
  category: string
  type: 'command' | 'recent'
  binding: KeyBinding | null
  matchIndices: number[]
  score: number
  globalIndex: number
}

export interface PaletteGroup {
  category: string
  items: PaletteItem[]
}

export interface CommandPaletteState {
  open: boolean
  query: string
  activeIndex: number
  groups: PaletteGroup[]
  totalCount: number
}

const RECENT_KEY = 'hc:recent-commands'
const MAX_RECENT = 8

export class CommandPaletteDrone extends EventTarget {
  #open = false
  #query = ''
  #activeIndex = 0
  #groups: PaletteGroup[] = []
  #totalCount = 0
  #recent: string[] = []

  constructor() {
    super()

    // restore recent commands
    try {
      this.#recent = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    } catch { this.#recent = [] }

    EffectBus.on<{ cmd: string }>('keymap:invoke', (payload) => {
      if (payload?.cmd === 'ui.commandPalette') this.#toggle()
    })

    EffectBus.on<{ query: string }>('command-palette:input', (payload) => {
      if (!this.#open) return
      this.#query = payload?.query ?? ''
      this.#activeIndex = 0
      this.#rebuild()
      this.#emit()
    })

    EffectBus.on<{ direction: string }>('command-palette:nav', (payload) => {
      if (!this.#open) return
      if (payload?.direction === 'up') {
        this.#activeIndex = Math.max(0, this.#activeIndex - 1)
      } else if (payload?.direction === 'down') {
        this.#activeIndex = Math.min(this.#totalCount - 1, this.#activeIndex + 1)
      }
      this.#emit()
    })

    EffectBus.on('command-palette:execute', () => {
      if (!this.#open) return
      this.#executeCurrent()
    })

    EffectBus.on<{ index: number }>('command-palette:execute-at', (payload) => {
      if (!this.#open || payload?.index == null) return
      this.#activeIndex = payload.index
      this.#executeCurrent()
    })

    EffectBus.on('command-palette:close', () => {
      if (this.#open) this.#close()
    })
  }

  get state(): CommandPaletteState {
    return {
      open: this.#open,
      query: this.#query,
      activeIndex: this.#activeIndex,
      groups: this.#groups,
      totalCount: this.#totalCount,
    }
  }

  #toggle(): void {
    if (this.#open) this.#close()
    else this.#openPalette()
  }

  #openPalette(): void {
    this.#open = true
    this.#query = ''
    this.#activeIndex = 0
    EffectBus.emit('keymap:suppress', { reason: 'command-palette' })
    this.#rebuild()
    this.#emit()
  }

  #close(): void {
    this.#open = false
    this.#query = ''
    this.#groups = []
    this.#totalCount = 0
    EffectBus.emit('keymap:unsuppress', { reason: 'command-palette' })
    this.#emit()
  }

  #executeCurrent(): void {
    // find item at activeIndex
    let item: PaletteItem | null = null
    for (const g of this.#groups) {
      for (const i of g.items) {
        if (i.globalIndex === this.#activeIndex) { item = i; break }
      }
      if (item) break
    }
    if (!item) return

    // track in recents
    this.#addRecent(item.id)

    // close first, then invoke
    this.#close()

    // dispatch the command
    if (item.binding) {
      EffectBus.emit('keymap:invoke', { cmd: item.id, binding: item.binding, event: null })
    }
  }

  #addRecent(cmd: string): void {
    this.#recent = [cmd, ...this.#recent.filter(c => c !== cmd)].slice(0, MAX_RECENT)
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(this.#recent)) } catch { /* noop */ }
  }

  #rebuild(): void {
    const keymap = get('@diamondcoreprocessor.com/KeyMapService') as any
    const bindings: KeyBinding[] = keymap?.getEffective?.() ?? []

    // build searchable items from all bindings with descriptions
    // exclude self-referential command (opening palette from itself)
    let items: PaletteItem[] = bindings
      .filter(b => !!b.description && b.cmd !== 'ui.commandPalette')
      .map(b => ({
        id: b.cmd,
        label: b.description!,
        category: b.category ?? 'Other',
        type: 'command' as const,
        binding: b,
        matchIndices: [] as number[],
        score: 0,
        globalIndex: 0,
      }))

    // apply fuzzy filter
    if (this.#query) {
      items = items
        .map(item => {
          const result = fuzzyMatch(this.#query, item.label)
          if (!result) return null
          return { ...item, matchIndices: result.indices, score: result.score }
        })
        .filter((item): item is PaletteItem => item !== null)
        .sort((a, b) => b.score - a.score)
    }

    // group results
    const grouped = new Map<string, PaletteItem[]>()

    if (!this.#query) {
      // show recents first when no query
      const recentItems = this.#recent
        .map(cmd => items.find(i => i.id === cmd))
        .filter((i): i is PaletteItem => !!i)
        .map(i => ({ ...i, type: 'recent' as const, category: 'Recent' }))

      if (recentItems.length) grouped.set('Recent', recentItems)

      // then all by category (excluding those in recents)
      const recentIds = new Set(this.#recent)
      for (const item of items) {
        if (recentIds.has(item.id) && grouped.has('Recent')) continue
        const arr = grouped.get(item.category) ?? []
        arr.push(item)
        grouped.set(item.category, arr)
      }
    } else {
      // when searching, group by category in score order
      for (const item of items) {
        const arr = grouped.get(item.category) ?? []
        arr.push(item)
        grouped.set(item.category, arr)
      }
    }

    // assign global indices and build final groups
    let idx = 0
    const groups: PaletteGroup[] = []
    for (const [category, categoryItems] of grouped) {
      const indexedItems = categoryItems.map(item => ({ ...item, globalIndex: idx++ }))
      groups.push({ category, items: indexedItems })
    }

    this.#groups = groups
    this.#totalCount = idx
  }

  #emit(): void {
    this.dispatchEvent(new Event('change'))
    EffectBus.emit('command-palette:state', this.state)
  }
}

// ── fuzzy match ─────────────────────────────────────────

function fuzzyMatch(query: string, target: string): { score: number; indices: number[] } | null {
  const q = query.toLowerCase()
  const t = target.toLowerCase()
  const indices: number[] = []
  let qi = 0
  let score = 0
  let lastIdx = -1

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      indices.push(ti)

      // consecutive char bonus
      if (lastIdx === ti - 1) score += 3
      // word-start bonus
      if (ti === 0 || t[ti - 1] === ' ' || t[ti - 1] === '-' || t[ti - 1] === '_') score += 2
      // base match
      score += 1

      lastIdx = ti
      qi++
    }
  }

  // all query chars must be found
  if (qi < q.length) return null

  // bonus for shorter targets (tighter match)
  score += Math.max(0, 10 - (t.length - q.length))

  return { score, indices }
}

const _commandPalette = new CommandPaletteDrone()
window.ioc.register('@diamondcoreprocessor.com/CommandPaletteDrone', _commandPalette)
