// diamondcoreprocessor.com/pixi/tile-actions.drone.ts
import { Drone, EffectBus, hypercomb, normalizeCell } from '@hypercomb/core'
import type { OverlayActionDescriptor, OverlayTileContext, OverlayProfileKey } from './tile-overlay.drone.js'
import { readCellProperties, writeCellProperties } from '../../editor/tile-properties.js'

// ── SVG icons ─────────────────────────────────────────────────────
// Clean line icons — 24×24 viewBox, 2px stroke, round caps/joins, white fill.

const svg = (d: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`

const ICONS = {
  // Terminal prompt >_
  command: svg('<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>'),
  // Pencil
  edit: svg('<path d="M17 3l4 4L7 21H3v-4L17 3z"/>'),
  // Magnifying glass
  search: svg('<circle cx="11" cy="11" r="7"/><line x1="16" y1="16" x2="21" y2="21"/>'),
  // Eye with slash
  hide: svg('<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/><circle cx="12" cy="12" r="3"/><line x1="4" y1="4" x2="20" y2="20"/>'),
  // Break apart — four fragments separating
  breakApart: svg('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'),
  // Plus
  adopt: svg('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>'),
  // Circle with slash
  block: svg('<circle cx="12" cy="12" r="9"/><line x1="5.7" y1="5.7" x2="18.3" y2="18.3"/>'),
  // Trash bin
  remove: svg('<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'),
  // Refresh / reroll — two curved arrows
  reroll: svg('<path d="M1 4v6h6"/><path d="M23 20v-6h-6"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10"/><path d="M3.51 15A9 9 0 0 0 18.36 18.36L23 14"/>'),
} as const

// ── Icon registry ─────────────────────────────────────────────────

export type IconRegistryEntry = {
  name: string
  svgMarkup: string
  hoverTint?: number
  profile: OverlayProfileKey
  visibleWhen?: (ctx: OverlayTileContext) => boolean
  /** i18n key for the short hint label (shown on sustained hover) */
  labelKey?: string
  /** i18n key for the expanded description (shown on hint click) */
  descriptionKey?: string
}

const ICON_REGISTRY: IconRegistryEntry[] = [
  // ── private profile ──
  { name: 'command', svgMarkup: ICONS.command, hoverTint: 0xa8ffd8, profile: 'private', labelKey: 'action.command', descriptionKey: 'action.command.description' },
  // edit — self-registered by TileEditorDrone (editor layer)
  { name: 'search', svgMarkup: ICONS.search, hoverTint: 0xc8ffc8, profile: 'private', visibleWhen: (ctx: OverlayTileContext) => ctx.noImage, labelKey: 'action.search', descriptionKey: 'action.search.description' },
  // reroll — self-registered by SubstrateDrone (substrate layer)
  { name: 'remove', svgMarkup: ICONS.remove, hoverTint: 0xffc8c8, profile: 'private', labelKey: 'action.remove', descriptionKey: 'action.remove.description' },
  { name: 'break-apart', svgMarkup: ICONS.breakApart, hoverTint: 0x66ccff, profile: 'private', visibleWhen: (ctx: OverlayTileContext) => ctx.isHidden, labelKey: 'action.break-apart', descriptionKey: 'action.break-apart.description' },
  // ── public-own profile ──
  { name: 'hide', svgMarkup: ICONS.hide, hoverTint: 0xffd8a8, profile: 'public-own', visibleWhen: (ctx: OverlayTileContext) => !ctx.isHidden, labelKey: 'action.hide', descriptionKey: 'action.hide.description' },
  { name: 'break-apart', svgMarkup: ICONS.breakApart, hoverTint: 0x66ccff, profile: 'public-own', visibleWhen: (ctx: OverlayTileContext) => ctx.isHidden, labelKey: 'action.break-apart', descriptionKey: 'action.break-apart.description' },
  // ── public-external profile ──
  { name: 'adopt', svgMarkup: ICONS.adopt, hoverTint: 0xa8ffd8, profile: 'public-external', labelKey: 'action.adopt', descriptionKey: 'action.adopt.description' },
  { name: 'block', svgMarkup: ICONS.block, hoverTint: 0xffc8c8, profile: 'public-external', labelKey: 'action.block', descriptionKey: 'action.block.description' },
]

// Default active icons per profile (defines the fallback order)
const DEFAULT_ACTIVE: Record<OverlayProfileKey, string[]> = {
  'private': ['command', 'remove', 'break-apart'],
  'public-own': ['hide', 'break-apart'],
  'public-external': ['adopt', 'block'],
}

// ── Position computation ──────────────────────────────────────────

const ICON_Y = 10
const ICON_SPACING = 10       // tighter to match 75 % icon scale
const ICON_SIZE = 7           // matches DEFAULT_ICON_SIZE in tile-overlay
const HEX_INRADIUS = 27.7     // √3/2 × 32 — safe horizontal bound
const EDGE_MARGIN = 3         // keep icons this far from hex edge

function computeIconPositions(activeNames: string[]): { x: number; y: number }[] {
  const count = activeNames.length
  if (count === 0) return []

  let spacing = ICON_SPACING

  // Compress spacing when the row would overflow the hex
  const available = (HEX_INRADIUS - EDGE_MARGIN) * 2
  const idealWidth = (count - 1) * spacing
  if (idealWidth > available && count > 1) {
    spacing = available / (count - 1)
  }

  // Return CENTER positions — evenly spaced, symmetric about x=0, rounded to integers
  const startX = Math.round(-(count - 1) * spacing / 2)
  return activeNames.map((_, i) => ({ x: Math.round(startX + i * spacing), y: ICON_Y }))
}

// ── Persistence key in root properties ────────────────────────────

const ARRANGEMENT_KEY = 'iconArrangement'

type IconArrangement = Partial<Record<OverlayProfileKey, string[]>>

// ── Action names this bee handles ─────────────────────────────────
const HANDLED_ACTIONS = new Set(['search', 'command', 'hide', 'break-apart', 'adopt', 'block', 'remove'])

type TileActionPayload = { action: string; label: string; q: number; r: number; index: number }

export class TileActionsDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override description = 'registers default tile overlay icons and handles their click actions'

  protected override deps = {
    lineage: '@hypercomb.social/Lineage',
  }

  protected override listens = ['render:host-ready', 'tile:action', 'controls:action', 'overlay:icons-reordered', 'overlay:arrange-mode', 'cell:removed']
  protected override emits = ['overlay:register-action', 'overlay:pool-icons', 'search:prefill', 'command:focus', 'tile:hidden', 'tile:unhidden', 'tile:blocked', 'cell:removed', 'visibility:show-hidden']

  #registered = false
  #effectsRegistered = false
  #arrangement: IconArrangement = {}

  protected override heartbeat = async (): Promise<void> => {
    if (!this.#effectsRegistered) {
      this.#effectsRegistered = true

      // Register all icons as a batch once the pixi host is ready
      this.onEffect('render:host-ready', () => {
        if (this.#registered) return
        this.#registered = true
        void this.#loadArrangementAndRegister()
      })

      // Handle clicks on our own actions
      this.onEffect<TileActionPayload>('tile:action', (payload) => {
        if (!HANDLED_ACTIONS.has(payload.action)) return
        this.#handleAction(payload)
      })

      // Handle hide from selection context menu (controls:action)
      this.onEffect<{ action: string }>('controls:action', (payload) => {
        if (payload?.action === 'hide') this.#bulkHideSelected()
      })

      // Handle icon reorder from arrange mode
      this.onEffect<{ profile: OverlayProfileKey; order: string[] }>('overlay:icons-reordered', (payload) => {
        this.#arrangement[payload.profile] = payload.order
        void this.#persistArrangement()
        this.#registerProfileIcons(payload.profile)
      })
    }
  }

  // ── Arrangement loading & registration ──────────────────────────

  async #loadArrangementAndRegister(): Promise<void> {
    // Load saved arrangement from root properties
    try {
      const lineage = this.resolve<{ explorerDir(): Promise<FileSystemDirectoryHandle | null> }>('lineage')
      const rootDir = await this.#getRootDir(lineage)
      if (rootDir) {
        const props = await readCellProperties(rootDir)
        const saved = props[ARRANGEMENT_KEY] as IconArrangement | undefined
        if (saved && typeof saved === 'object') {
          this.#arrangement = saved
        }
      }
    } catch {
      // fallback to defaults — no saved arrangement
    }

    // Register icons for all profiles
    const descriptors = this.#buildAllDescriptors()
    this.emitEffect('overlay:register-action', descriptors)

    // Emit pool info for arrange mode
    this.#emitPoolIcons()
  }

  #buildAllDescriptors(): OverlayActionDescriptor[] {
    const descriptors: OverlayActionDescriptor[] = []

    for (const profile of ['private', 'public-own', 'public-external'] as OverlayProfileKey[]) {
      const activeNames = this.#getActiveNames(profile)
      const positions = computeIconPositions(activeNames)

      for (let i = 0; i < activeNames.length; i++) {
        const entry = ICON_REGISTRY.find(e => e.name === activeNames[i] && e.profile === profile)
        if (!entry) continue

        descriptors.push({
          name: entry.name,
          owner: this.iocKey,
          svgMarkup: entry.svgMarkup,
          hoverTint: entry.hoverTint,
          profile: entry.profile,
          visibleWhen: entry.visibleWhen,
          labelKey: entry.labelKey,
          descriptionKey: entry.descriptionKey,
          x: positions[i].x,
          y: positions[i].y,
        })
      }
    }

    return descriptors
  }

  #registerProfileIcons(profile: OverlayProfileKey): void {
    // Unregister existing icons for this profile
    const profileEntries = ICON_REGISTRY.filter(e => e.profile === profile)
    for (const entry of profileEntries) {
      EffectBus.emit('overlay:unregister-action', { name: entry.name })
    }

    // Re-register with new positions
    const activeNames = this.#getActiveNames(profile)
    const positions = computeIconPositions(activeNames)
    const descriptors: OverlayActionDescriptor[] = []

    for (let i = 0; i < activeNames.length; i++) {
      const entry = ICON_REGISTRY.find(e => e.name === activeNames[i] && e.profile === profile)
      if (!entry) continue

      descriptors.push({
        name: entry.name,
        owner: this.iocKey,
        svgMarkup: entry.svgMarkup,
        hoverTint: entry.hoverTint,
        profile: entry.profile,
        visibleWhen: entry.visibleWhen,
        labelKey: entry.labelKey,
        descriptionKey: entry.descriptionKey,
        x: positions[i].x,
        y: positions[i].y,
      })
    }

    if (descriptors.length > 0) {
      this.emitEffect('overlay:register-action', descriptors)
    }

    // Update pool
    this.#emitPoolIcons()
  }

  #getActiveNames(profile: OverlayProfileKey): string[] {
    const saved = this.#arrangement[profile]
    if (saved && saved.length > 0) {
      // Filter out names that no longer exist in the registry for this profile
      const available = new Set(ICON_REGISTRY.filter(e => e.profile === profile).map(e => e.name))
      return saved.filter(n => available.has(n))
    }
    return [...DEFAULT_ACTIVE[profile]]
  }

  #emitPoolIcons(): void {
    // For each profile, compute which icons are NOT active (the pool)
    const pool: Record<string, IconRegistryEntry[]> = {}
    for (const profile of ['private', 'public-own', 'public-external'] as OverlayProfileKey[]) {
      const activeNames = new Set(this.#getActiveNames(profile))
      pool[profile] = ICON_REGISTRY
        .filter(e => e.profile === profile && !activeNames.has(e.name))
    }
    EffectBus.emit('overlay:pool-icons', { pool, registry: ICON_REGISTRY })
  }

  // ── Persistence ─────────────────────────────────────────────────

  async #persistArrangement(): Promise<void> {
    try {
      const lineage = this.resolve<{ explorerDir(): Promise<FileSystemDirectoryHandle | null> }>('lineage')
      const rootDir = await this.#getRootDir(lineage)
      if (rootDir) {
        await writeCellProperties(rootDir, { [ARRANGEMENT_KEY]: this.#arrangement })
      }
    } catch {
      // persistence failure — silently ignore
    }
  }

  async #getRootDir(_lineage: unknown): Promise<FileSystemDirectoryHandle | null> {
    return null
  }

  // ── Action handlers ─────────────────────────────────────────────

  #handleAction(payload: TileActionPayload): void {
    const { action, label: rawLabel } = payload
    const label = normalizeCell(rawLabel) || rawLabel

    switch (action) {
      case 'search':
        EffectBus.emit('search:prefill', { value: label })
        break

      case 'command':
        EffectBus.emit('command:focus', { cell: label })
        break

      case 'hide':
        this.#hideOrBlock(label, 'hc:hidden-tiles', 'tile:hidden')
        break

      case 'break-apart':
        this.#unhide(label)
        break

      case 'adopt':
        EffectBus.emit('cell:added', { cell: label })
        void new hypercomb().act()
        break
      case 'block':
        this.#hideOrBlock(label, 'hc:blocked-tiles', 'tile:blocked')
        break

      case 'remove':
        void this.#removeTile(label)
        break
    }
  }

  async #removeTile(label: string): Promise<void> {
    const lineage = this.resolve<{ explorerDir(): Promise<FileSystemDirectoryHandle | null> }>('lineage')
    if (!lineage) return
    const dir = await lineage.explorerDir()
    if (!dir) return

    try {
      await dir.removeEntry(label, { recursive: true })
      EffectBus.emit('cell:removed', { cell: label })
    } catch { /* entry doesn't exist or can't be removed */ }
    void new hypercomb().act()
  }

  #unhide(label: string): void {
    const lineage = this.resolve<{ explorerLabel(): string }>('lineage')
    const location = lineage?.explorerLabel() ?? '/'
    const key = `hc:hidden-tiles:${location}`
    const existing: string[] = JSON.parse(localStorage.getItem(key) ?? '[]')
    const updated = existing.filter(l => l !== label)
    localStorage.setItem(key, JSON.stringify(updated))
    EffectBus.emit('tile:unhidden', { cell: label, location })
    void new hypercomb().act()
  }

  #bulkHideSelected(): void {
    const selection = window.ioc.get<{ selected: ReadonlySet<string>; count: number; clear(): void }>('@diamondcoreprocessor.com/SelectionService')
    if (!selection || selection.count === 0) return

    const lineage = this.resolve<{ explorerLabel(): string }>('lineage')
    const location = lineage?.explorerLabel() ?? '/'
    const key = `hc:hidden-tiles:${location}`
    const hidden: string[] = JSON.parse(localStorage.getItem(key) ?? '[]')
    const hiddenSet = new Set(hidden)

    const labels = [...selection.selected]
    const allHidden = labels.every(l => hiddenSet.has(l))

    if (allHidden) {
      // Every selected tile is hidden → remove them from the hidden list
      const removeSet = new Set(labels)
      localStorage.setItem(key, JSON.stringify(hidden.filter(l => !removeSet.has(l))))
      for (const label of labels) EffectBus.emit('tile:unhidden', { cell: label, location })
      // Re-emit to force show-cell cache clear and re-render without the grayed state
      EffectBus.emit('visibility:show-hidden', { active: localStorage.getItem('hc:show-hidden') === '1' })
    } else {
      // At least one visible → add all to the hidden list
      for (const label of labels) if (!hiddenSet.has(label)) hidden.push(label)
      localStorage.setItem(key, JSON.stringify(hidden))
      for (const label of labels) EffectBus.emit('tile:hidden', { cell: label, location })
      // Auto-enable show-hidden so grayed tiles are visible
      localStorage.setItem('hc:show-hidden', '1')
      EffectBus.emit('visibility:show-hidden', { active: true })
    }

    selection.clear()
    void new hypercomb().act()
  }

  #hideOrBlock(label: string, storagePrefix: string, effect: string): void {
    const lineage = this.resolve<{ explorerLabel(): string }>('lineage')
    const location = lineage?.explorerLabel() ?? '/'
    const key = `${storagePrefix}:${location}`
    const existing: string[] = JSON.parse(localStorage.getItem(key) ?? '[]')
    if (!existing.includes(label)) existing.push(label)
    localStorage.setItem(key, JSON.stringify(existing))
    EffectBus.emit(effect, { cell: label, location })
    void new hypercomb().act()
  }
}

// ── Exports for overlay arrange mode ──────────────────────────────

export { ICON_REGISTRY, DEFAULT_ACTIVE, ICON_SPACING, ICON_Y, computeIconPositions }
export type { IconArrangement }

const _tileActions = new TileActionsDrone()
window.ioc.register('@diamondcoreprocessor.com/TileActionsDrone', _tileActions)
