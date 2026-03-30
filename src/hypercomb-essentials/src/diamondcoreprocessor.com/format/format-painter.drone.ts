// diamondcoreprocessor.com/format/format-painter.drone.ts
import { EffectBus } from '@hypercomb/core'
import type { FormatEntry, FormatProvider } from './format.provider.js'

// ── built-in providers ──────────────────────────────────

const borderColorProvider: FormatProvider = {
  key: 'border.color',
  extract(props) {
    const color = (props as any).border?.color
    if (!color || typeof color !== 'string') return null
    return { key: 'border.color', label: 'Border', value: color, preview: color }
  },
  apply(props, value) {
    const next = { ...props }
    if (!(next as any).border) (next as any).border = {}
    ;(next as any).border = { ...(next as any).border, color: value }
    return next
  },
}

const backgroundColorProvider: FormatProvider = {
  key: 'background.color',
  extract(props) {
    const color = (props as any).background?.color
    if (!color || typeof color !== 'string') return null
    return { key: 'background.color', label: 'Background', value: color, preview: color }
  },
  apply(props, value) {
    const next = { ...props }
    if (!(next as any).background) (next as any).background = {}
    ;(next as any).background = { ...(next as any).background, color: value }
    return next
  },
}

// ── state type ──────────────────────────────────────────

export interface FormatPainterState {
  open: boolean
  sourceSeed: string | null
  entries: Array<FormatEntry & { enabled: boolean }>
}

// ── store type (matches TileEditorDrone's local type) ───

type Store = {
  resources: FileSystemDirectoryHandle
  putResource: (blob: Blob) => Promise<string>
  getResource: (signature: string) => Promise<Blob | null>
}

// ── drone ───────────────────────────────────────────────

export class FormatPainterDrone extends EventTarget {

  #open = false
  #sourceSeed: string | null = null
  #entries: Array<FormatEntry & { enabled: boolean }> = []
  #providers: FormatProvider[] = [borderColorProvider, backgroundColorProvider]

  get state(): FormatPainterState {
    return {
      open: this.#open,
      sourceSeed: this.#sourceSeed,
      entries: this.#entries.map(e => ({ ...e })),
    }
  }

  // ── load source tile's properties ──────────────────────

  async #loadSource(seed: string): Promise<void> {
    const store = window.ioc.get<Store>('@hypercomb.social/Store')
    if (!store) return

    let properties: Record<string, unknown> = {}
    try {
      const indexKey = 'hc:tile-props-index'
      const index: Record<string, string> = JSON.parse(localStorage.getItem(indexKey) ?? '{}')
      const propsSig = index[seed]
      if (!propsSig) throw new Error('no index entry')
      const propsBlob = await store.getResource(propsSig)
      if (!propsBlob) throw new Error('props blob missing')
      properties = JSON.parse(await propsBlob.text())
    } catch {
      // no properties
    }

    this.#openPainter(seed, properties)
  }

  constructor() {
    super()

    EffectBus.on<{ seed: string; properties: Record<string, unknown> }>('format:open', (payload) => {
      this.#openPainter(payload.seed, payload.properties)
    })

    EffectBus.on('format:close', () => {
      this.#close()
    })

    EffectBus.on<{ key: string }>('format:toggle-entry', (payload) => {
      this.#toggleEntry(payload.key)
    })

    EffectBus.on('format:apply', () => {
      void this.#applyFormat()
    })

    // when panel is open and user clicks a different tile, load its properties
    EffectBus.on<{ selected: string[]; active: string | null }>('selection:changed', (payload) => {
      if (!this.#open || !payload?.active) return
      if (payload.active === this.#sourceSeed) return
      void this.#loadSource(payload.active)
    })
  }

  addProvider(provider: FormatProvider): void {
    this.#providers.push(provider)
  }

  // ── open ────────────────────────────────────────────────

  #openPainter(seed: string, props: Record<string, unknown>): void {
    this.#sourceSeed = seed
    this.#entries = []

    for (const provider of this.#providers) {
      const entry = provider.extract(props)
      if (entry) {
        this.#entries.push({ ...entry, enabled: true })
      }
    }

    this.#open = true
    this.#emit()
  }

  // ── close ───────────────────────────────────────────────

  #close(): void {
    this.#open = false
    this.#sourceSeed = null
    this.#entries = []
    this.#emit()
  }

  // ── toggle checkbox ─────────────────────────────────────

  #toggleEntry(key: string): void {
    const entry = this.#entries.find(e => e.key === key)
    if (entry) {
      entry.enabled = !entry.enabled
      this.#emit()
    }
  }

  // ── apply to selection ──────────────────────────────────

  async #applyFormat(): Promise<void> {
    const selection = window.ioc.get<{ selected: ReadonlySet<string> }>('@diamondcoreprocessor.com/SelectionService')
    const store = window.ioc.get<Store>('@hypercomb.social/Store')
    if (!selection || !store) return

    const enabled = this.#entries.filter(e => e.enabled)
    if (enabled.length === 0) return

    const indexKey = 'hc:tile-props-index'
    const index: Record<string, string> = JSON.parse(localStorage.getItem(indexKey) ?? '{}')

    for (const seed of selection.selected) {
      // skip source tile
      if (seed === this.#sourceSeed) continue

      // 1. read current props (content-addressed → legacy 0000 fallback)
      let props: Record<string, unknown> = {}
      try {
        const propsSig = index[seed]
        if (!propsSig) throw new Error('no index entry')
        const propsBlob = await store.getResource(propsSig)
        if (!propsBlob) throw new Error('props blob missing')
        props = JSON.parse(await propsBlob.text())
      } catch {
        // no existing props — start fresh
      }

      // 2. apply each enabled entry via its provider
      for (const entry of enabled) {
        const provider = this.#providers.find(p => p.key === entry.key)
        if (provider) {
          props = provider.apply(props, entry.value)
        }
      }

      // 3. write as content-addressed resource
      const json = JSON.stringify(props, null, 2)
      const blob = new Blob([json], { type: 'application/json' })
      const propsSig = await store.putResource(blob)

      // 4. update index
      index[seed] = propsSig

      // 5. notify renderer
      EffectBus.emit<{ seed: string }>('tile:saved', { seed })
    }

    // persist updated index
    localStorage.setItem(indexKey, JSON.stringify(index))
  }

  // ── emit state ──────────────────────────────────────────

  #emit(): void {
    this.dispatchEvent(new CustomEvent('change'))
    EffectBus.emit<FormatPainterState>('format:state', this.state)
  }
}

window.ioc.register(
  '@diamondcoreprocessor.com/FormatPainterDrone',
  new FormatPainterDrone(),
)
