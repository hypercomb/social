// diamondcoreprocessor.com/pixi/tile-actions.drone.ts
import { Drone, EffectBus, hypercomb, normalizeSeed } from '@hypercomb/core'
import type { OverlayActionDescriptor, OverlayTileContext, OverlayProfileKey } from './tile-overlay.drone.js'
import { readSeedProperties, writeSeedProperties } from '../../editor/tile-properties.js'

// ── SVG icons ─────────────────────────────────────────────────────
// Clean line icons — 24×24 viewBox, 2px stroke, round caps/joins, white fill.

const svg = (d: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`

const ICONS = {
  // Pencil
  edit: svg('<path d="M17 3l4 4L7 21H3v-4L17 3z"/>'),
  // Tree branch (parent + child node)
  'add-sub': svg('<circle cx="12" cy="6" r="3"/><circle cx="12" cy="18" r="3"/><line x1="12" y1="9" x2="12" y2="15"/>'),
  // Magnifying glass
  search: svg('<circle cx="11" cy="11" r="7"/><line x1="16" y1="16" x2="21" y2="21"/>'),
  // Eye with slash
  hide: svg('<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/><circle cx="12" cy="12" r="3"/><line x1="4" y1="4" x2="20" y2="20"/>'),
  // Plus
  adopt: svg('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>'),
  // Circle with slash
  block: svg('<circle cx="12" cy="12" r="9"/><line x1="5.7" y1="5.7" x2="18.3" y2="18.3"/>'),
} as const

// ── Icon registry ─────────────────────────────────────────────────

export type IconRegistryEntry = {
  name: string
  svgMarkup: string
  hoverTint?: number
  profile: OverlayProfileKey
  visibleWhen?: (ctx: OverlayTileContext) => boolean
}

const ICON_REGISTRY: IconRegistryEntry[] = [
  // ── private profile ──
  { name: 'add-sub', svgMarkup: ICONS['add-sub'], hoverTint: 0xa8ffd8, profile: 'private' },
  { name: 'edit', svgMarkup: ICONS.edit, hoverTint: 0xc8d8ff, profile: 'private' },
  { name: 'search', svgMarkup: ICONS.search, hoverTint: 0xc8ffc8, profile: 'private', visibleWhen: (ctx: OverlayTileContext) => ctx.noImage },
  // ── public-own profile ──
  { name: 'hide', svgMarkup: ICONS.hide, hoverTint: 0xffd8a8, profile: 'public-own' },
  // ── public-external profile ──
  { name: 'adopt', svgMarkup: ICONS.adopt, hoverTint: 0xa8ffd8, profile: 'public-external' },
  { name: 'block', svgMarkup: ICONS.block, hoverTint: 0xffc8c8, profile: 'public-external' },
]

// Default active icons per profile (defines the fallback order)
const DEFAULT_ACTIVE: Record<OverlayProfileKey, string[]> = {
  'private': ['add-sub', 'edit', 'search'],
  'public-own': ['hide'],
  'public-external': ['adopt', 'block'],
}

// ── Position computation ──────────────────────────────────────────

const ICON_Y = 6
const ICON_SPACING = 10       // tighter to match 75 % icon scale
const ICON_SIZE = 6.5         // matches DEFAULT_ICON_SIZE in tile-overlay
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

  // Return CENTER positions — evenly spaced, symmetric about x=0
  const startX = -(count - 1) * spacing / 2
  return activeNames.map((_, i) => ({ x: startX + i * spacing, y: ICON_Y }))
}

// ── Persistence key in root properties ────────────────────────────

const ARRANGEMENT_KEY = 'iconArrangement'

type IconArrangement = Partial<Record<OverlayProfileKey, string[]>>

// ── Action names this bee handles ─────────────────────────────────
const HANDLED_ACTIONS = new Set(['edit', 'search', 'add-sub', 'hide', 'adopt', 'block'])

type TileActionPayload = { action: string; label: string; q: number; r: number; index: number }

export class TileActionsDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override description = 'registers default tile overlay icons and handles their click actions'

  protected override deps = {
    lineage: '@hypercomb.social/Lineage',
  }

  protected override listens = ['render:host-ready', 'tile:action', 'overlay:icons-reordered', 'overlay:arrange-mode']
  protected override emits = ['overlay:register-action', 'overlay:pool-icons', 'search:prefill', 'tile:hidden', 'tile:blocked']

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
        const props = await readSeedProperties(rootDir)
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
          svgMarkup: entry.svgMarkup,
          hoverTint: entry.hoverTint,
          profile: entry.profile,
          visibleWhen: entry.visibleWhen,
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
        svgMarkup: entry.svgMarkup,
        hoverTint: entry.hoverTint,
        profile: entry.profile,
        visibleWhen: entry.visibleWhen,
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
        await writeSeedProperties(rootDir, { [ARRANGEMENT_KEY]: this.#arrangement })
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
    const label = normalizeSeed(rawLabel) || rawLabel

    switch (action) {
      case 'edit':
        // tile:action already emitted by overlay — editor listens for it
        break

      case 'search':
        EffectBus.emit('search:prefill', { value: label })
        break

      case 'add-sub':
        EffectBus.emit('search:prefill', { value: label + '/' })
        break

      case 'hide':
        this.#hideOrBlock(label, 'hc:hidden-tiles', 'tile:hidden')
        break

      case 'adopt':
        EffectBus.emit('seed:added', { seed: label })
        void new hypercomb().act()
        break
      case 'block':
        this.#hideOrBlock(label, 'hc:blocked-tiles', 'tile:blocked')
        break
    }
  }

  #hideOrBlock(label: string, storagePrefix: string, effect: string): void {
    const lineage = this.resolve<{ explorerLabel(): string }>('lineage')
    const location = lineage?.explorerLabel() ?? '/'
    const key = `${storagePrefix}:${location}`
    const existing: string[] = JSON.parse(localStorage.getItem(key) ?? '[]')
    if (!existing.includes(label)) existing.push(label)
    localStorage.setItem(key, JSON.stringify(existing))
    EffectBus.emit(effect, { seed: label, location })
    void new hypercomb().act()
  }
}

// ── Exports for overlay arrange mode ──────────────────────────────

export { ICON_REGISTRY, DEFAULT_ACTIVE, ICON_SPACING, ICON_Y, computeIconPositions }
export type { IconArrangement }

const _tileActions = new TileActionsDrone()
window.ioc.register('@diamondcoreprocessor.com/TileActionsDrone', _tileActions)
