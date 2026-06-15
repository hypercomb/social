// diamondcoreprocessor.com/pixi/tile-actions.drone.ts
import { Drone, EffectBus, hypercomb, normalizeCell } from '@hypercomb/core'
import type { OverlayActionDescriptor, OverlayTileContext, OverlayProfileKey, OverlayTintFn } from './tile-overlay.drone.js'
// Arrangement persistence currently disabled — `#getRootDir` returns
// null pending the layer-slot read/write path, so the legacy
// readCellProperties / writeCellProperties imports are no longer needed.

/** Zone-scoped localStorage key for the hide list at this location.
 *  SwarmDrone writes `hc:current-zone` on every room/secret change
 *  (or clears it when going private), so we read it sync here and
 *  append it to the key when present. Bleed-protection: switching
 *  zone changes the suffix, so the new zone reads from an empty key
 *  even if the old zone's data is still on disk. Block list never
 *  uses this helper — block is device-scoped on purpose.
 *  Exported so show-cell uses the same key for its render-time read. */
export function hideStorageKey(location: string): string {
  const zone = localStorage.getItem('hc:current-zone') ?? ''
  return zone
    ? `hc:hidden-tiles:${location}:z${zone}`
    : `hc:hidden-tiles:${location}`
}

type IconProviderEntry = {
  name: string
  owner?: string
  svgMarkup: string
  profile: string
  hoverTint?: number
  visibleWhen?: (ctx: OverlayTileContext) => boolean
  tintWhen?: OverlayTintFn
  labelKey?: string
  descriptionKey?: string
}

type IconProviderRegistryShape = EventTarget & {
  all(): IconProviderEntry[]
}

// ── Notes accent ──────────────────────────────────────────────────
// Warm gold used as the canonical "note intent" colour: tints the note
// icon when a tile contains notes, the command line when in capture
// mode, and the notes UI surfaces. Bright but not saturated.
export const NOTE_ACCENT = 0xffe14a
export const NOTE_ACCENT_CSS = '#ffe14a'

// ── SVG icons ─────────────────────────────────────────────────────
// Material Design icons — 24×24 viewBox, solid white fill. Tint is
// applied at the Pixi Sprite level via `tint`; the SVG's fill must be
// pure white so the tint multiplication preserves chroma. Paths are
// taken from Google's Material Icons Filled set (verbatim, single-path
// where possible) so the visual language matches material.io.

const md = (d: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="white"><path d="${d}"/></svg>`

const ICONS = {
  // terminal — Material Icons Filled
  command: md('M20 4H4c-1.11 0-1.99.89-1.99 2L2 18c0 1.1.89 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.11-.9-2-2-2zm0 14H4V8h16v10zM7.5 17l-1.41-1.41L8.67 13l-2.58-2.59L7.5 9l4 4-4 4zM13 17v-2h5v2h-5z'),
  // search — Material Icons Filled
  search: md('M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z'),
  // visibility_off — Material Icons Filled
  hide: md('M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z'),
  // grid_view — Material Icons Filled
  breakApart: md('M3 3v8h8V3H3zm6 6H5V5h4v4zm-6 4v8h8v-8H3zm6 6H5v-4h4v4zm4-16v8h8V3h-8zm6 6h-4V5h4v4zm-6 4v8h8v-8h-8zm6 6h-4v-4h4v4z'),
  // add — Material Icons Filled
  adopt: md('M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z'),
  // block — Material Icons Filled
  block: md('M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zM4 12c0-4.42 3.58-8 8-8 1.85 0 3.55.63 4.9 1.69L5.69 16.9C4.63 15.55 4 13.85 4 12zm8 8c-1.85 0-3.55-.63-4.9-1.69L18.31 7.1C19.37 8.45 20 10.15 20 12c0 4.42-3.58 8-8 8z'),
  // delete — Material Icons Filled
  remove: md('M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z'),
  // refresh — Material Icons Filled
  reroll: md('M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z'),
  // sticky_note_2 — Material Icons Filled
  note: md('M19 3H4.99c-1.11 0-1.98.9-1.98 2L3 19c0 1.1.89 2 2 2h10l6-6V5c0-1.1-.9-2-2-2zM7 8h10v2H7V8zm5 6H7v-2h5v2zm2 5.5V14h5.5L14 19.5z'),
  // sync — Material Icons Filled
  sync: md('M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z'),
} as const

// ── Icon registry ─────────────────────────────────────────────────

export type IconRegistryEntry = {
  name: string
  svgMarkup: string
  hoverTint?: number
  profile: OverlayProfileKey
  visibleWhen?: (ctx: OverlayTileContext) => boolean
  tintWhen?: OverlayTintFn
  /** i18n key for the short hint label (shown on sustained hover) */
  labelKey?: string
  /** i18n key for the expanded description (shown on sustained hover) */
  descriptionKey?: string
}

// True when a live peer is broadcasting a same-named tile that carries a
// layerSig — i.e., there is a publisher version of this locally-held tile
// that `sync` can re-adopt. The swarm CACHE keeps every peer visual even
// when the render pipeline dedupes it against the local cell set, so this
// is exactly the "the publisher updated a tile I hold" detector. Stale
// peers are already filtered out by peerTilesAtCurrentSig.
const peerBroadcastsTile = (label: string): boolean => {
  const swarm = window.ioc.get<{
    peerTilesAtCurrentSig?: () => readonly ({ name: string } & Record<string, unknown>)[]
  }>('@diamondcoreprocessor.com/SwarmDrone')
  if (!swarm?.peerTilesAtCurrentSig) return false
  for (const tile of swarm.peerTilesAtCurrentSig()) {
    if (tile.name !== label) continue
    if (/^[a-f0-9]{64}$/.test(String(tile['layerSig'] ?? ''))) return true
  }
  return false
}

const ICON_REGISTRY: IconRegistryEntry[] = [
  // ── private profile ──
  { name: 'command', svgMarkup: ICONS.command, hoverTint: 0xa8ffd8, profile: 'private', labelKey: 'action.command', descriptionKey: 'action.command.description' },
  // 'edit' icon is provided by TileEditorDrone via IconProviderRegistry —
  // when the editor drone is toggled off it never registers, the icon
  // never appears, and the merged-available filter strips it from default
  // arrangements. Same pattern for 'note' (NotesService) and 'reroll'
  // (SubstrateDrone) — both registered by their owning drones.
  { name: 'search', svgMarkup: ICONS.search, hoverTint: 0xc8ffc8, profile: 'private', visibleWhen: (ctx: OverlayTileContext) => ctx.noImage, labelKey: 'action.search', descriptionKey: 'action.search.description' },
  { name: 'remove', svgMarkup: ICONS.remove, hoverTint: 0xffc8c8, profile: 'private', labelKey: 'action.remove', descriptionKey: 'action.remove.description' },
  { name: 'break-apart', svgMarkup: ICONS.breakApart, hoverTint: 0x66ccff, profile: 'private', visibleWhen: (ctx: OverlayTileContext) => ctx.isHidden, labelKey: 'action.break-apart', descriptionKey: 'action.break-apart.description' },
  // ── public-own profile ──
  // Your own tile in public mode. Removal is the existing trash-bin
  // delete, which routes through LayerCommitter and is recorded in
  // history (so it can be undone, time-travelled to, and is part of
  // the lineage's canonical state). Hide doesn't belong here — hide
  // is a session-scoped per-view filter, but you OWN this tile and
  // the correct dismissal is to delete it from your layer.
  { name: 'remove', svgMarkup: ICONS.remove, hoverTint: 0xffc8c8, profile: 'public-own', labelKey: 'action.remove', descriptionKey: 'action.remove.description' },
  { name: 'break-apart', svgMarkup: ICONS.breakApart, hoverTint: 0x66ccff, profile: 'public-own', visibleWhen: (ctx: OverlayTileContext) => ctx.isHidden, labelKey: 'action.break-apart', descriptionKey: 'action.break-apart.description' },
  // `sync` re-adopts the broadcasting peer's CURRENT version of a tile
  // you already hold (adopted earlier, or same-named). Visible only while
  // a live peer publishes that name. Dispatches the same sig-handoff as
  // adopt (SwarmAdoptDrone accepts both actions) — the installer's
  // (name, at) identity makes it idempotent: same-sig aborts, a re-signed
  // publisher layer replaces your stale copy.
  { name: 'sync', svgMarkup: ICONS.sync, hoverTint: 0xa8d8ff, profile: 'public-own', visibleWhen: (ctx: OverlayTileContext) => peerBroadcastsTile(ctx.label), labelKey: 'action.sync', descriptionKey: 'action.sync.description' },
  // ── public-external profile ──
  { name: 'adopt', svgMarkup: ICONS.adopt, hoverTint: 0xa8ffd8, profile: 'public-external', labelKey: 'action.adopt', descriptionKey: 'action.adopt.description' },
  // 'hide' also lives in `public-own` (your own tile in public mode);
  // re-registering for `public-external` lets the same handler apply
  // when the tile is a peer-only mesh entry. Same dispatch through
  // tile:hidden, same instant repaint (show-cell listens directly),
  // same mesh propagation via publishHide. Peer tiles disappear
  // immediately without needing to adopt them first.
  { name: 'hide', svgMarkup: ICONS.hide, hoverTint: 0xffd8a8, profile: 'public-external', visibleWhen: (ctx: OverlayTileContext) => !ctx.isHidden, labelKey: 'action.hide', descriptionKey: 'action.hide.description' },
  { name: 'block', svgMarkup: ICONS.block, hoverTint: 0xffc8c8, profile: 'public-external', labelKey: 'action.block', descriptionKey: 'action.block.description' },
]

// Default active icons per profile (defines the fallback order).
//
// public-own: `hide` and `break-apart` are real entries on `public-own`
// in ICON_REGISTRY above; adopting a peer tile is handled by the
// `public-external` profile (the tile flips kind once it's local).
const DEFAULT_ACTIVE: Record<OverlayProfileKey, string[]> = {
  'private': ['command', 'edit', 'note', 'reroll', 'remove', 'break-apart'],
  // Your own tile in public mode — same trash-bin remove that
  // private mode uses. Records a history op, can be undone. `sync`
  // pulls the broadcasting peer's latest version of an adopted tile
  // (only rendered while a live peer publishes the same name).
  'public-own': ['sync', 'remove', 'break-apart'],
  // Peer-only mesh tiles. Single-click `adopt` is the explicit
  // "I want to expand on this topic" action — writes the tile to
  // your local layer AND pulls the resources it references (images
  // etc.) via the content broker. Different mechanism from auto-
  // adopt: auto-adopt follows a participant continuously, single-
  // adopt is one tile + its resources, on demand. `hide` dismisses
  // a peer tile from view without taking ownership.
  'public-external': ['adopt', 'hide'],
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

// ARRANGEMENT_KEY removed alongside the dead persistence path; left as
// a comment so anyone restoring the layer-slot-backed arrangement
// reader/writer can pick the same property name back up.
// const ARRANGEMENT_KEY = 'iconArrangement'

type IconArrangement = Partial<Record<OverlayProfileKey, string[]>>

// ── Action names this bee handles ─────────────────────────────────
// 'adopt' is intentionally NOT in this set — SwarmAdoptDrone owns the
// adopt path directly (its own tile:action listener at
// swarm-adopt.drone.ts:63). The legacy paired-channel 'adopt' / 'import'
// handlers were retired with the paired-channel subsystem.
const HANDLED_ACTIONS = new Set(['edit', 'search', 'command', 'note', 'hide', 'break-apart', 'block', 'remove', 'reroll'])

type TileActionPayload = { action: string; label: string; q: number; r: number; index: number }

export class TileActionsDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override description = 'registers default tile overlay icons and handles their click actions'

  protected override deps = {
    lineage: '@hypercomb.social/Lineage',
  }

  protected override listens = ['render:host-ready', 'render:cell-count', 'tile:action', 'controls:action', 'overlay:icons-reordered', 'overlay:arrange-mode', 'substrate:applied', 'substrate:rerolled', 'cell:removed']
  protected override emits = ['overlay:register-action', 'overlay:pool-icons', 'search:prefill', 'command:focus', 'note:capture', 'tile:hidden', 'tile:unhidden', 'tile:blocked', 'cell:removed', 'visibility:show-hidden', 'substrate:rerolled']

  #registered = false
  #effectsRegistered = false
  #arrangement: IconArrangement = {}
  #substrateLabels = new Set<string>()
  #onRegistryChange = (): void => { this.#reregisterAll() }

  protected override heartbeat = async (): Promise<void> => {
    if (!this.#effectsRegistered) {
      this.#effectsRegistered = true

      // Register all icons as a batch once the pixi host is ready
      this.onEffect('render:host-ready', () => {
        if (this.#registered) return
        this.#registered = true
        void this.#loadArrangementAndRegister()
      })

      // Track which tiles have substrate so bulk reroll can filter correctly.
      // render:cell-count reseeds the set on full renders, but substrate:applied
      // runs via an in-place buffer path that doesn't re-emit render:cell-count —
      // so we also track it incrementally to keep newly-added substrate tiles
      // reachable by bulk reroll before the next full render.
      this.onEffect<{ substrateLabels?: string[] }>('render:cell-count', (payload) => {
        this.#substrateLabels = new Set(payload.substrateLabels ?? [])
      })
      this.onEffect<{ cell: string }>('substrate:applied', ({ cell }) => {
        if (cell) this.#substrateLabels.add(cell)
      })
      this.onEffect<{ cell: string }>('cell:removed', ({ cell }) => {
        if (cell) this.#substrateLabels.delete(cell)
      })

      // Handle clicks on our own actions
      this.onEffect<TileActionPayload>('tile:action', (payload) => {
        if (!HANDLED_ACTIONS.has(payload.action)) return
        this.#handleAction(payload)
      })

      // Handle hide / reroll from selection context menu (controls:action)
      this.onEffect<{ action: string }>('controls:action', (payload) => {
        if (payload?.action === 'hide') this.#bulkHideSelected()
        else if (payload?.action === 'reroll') this.#bulkRerollSelected()
      })

      // Handle icon reorder from arrange mode
      this.onEffect<{ profile: OverlayProfileKey; order: string[] }>('overlay:icons-reordered', (payload) => {
        this.#arrangement[payload.profile] = payload.order
        void this.#persistArrangement()
        this.#registerProfileIcons(payload.profile)
      })

      // Re-emit descriptors whenever a drone-owned icon provider is added
      // or removed at runtime (e.g. installer toggles a drone, or a hot
      // arrange-mode change). Provider-contributed icons are merged with
      // the local catalog before positioning.
      const registry = window.ioc.get<IconProviderRegistryShape>('@hypercomb.social/IconProviderRegistry')
      registry?.addEventListener('change', this.#onRegistryChange)
    }
  }

  // ── Merged icon catalog ─────────────────────────────────────────
  // Local ICON_REGISTRY entries plus any IconProviderRegistry entries
  // contributed by individual drones. Source of truth for "available"
  // icons used by descriptor build, pool computation, and arrangement
  // filtering.
  #mergedEntries(): IconRegistryEntry[] {
    const registry = window.ioc.get<IconProviderRegistryShape>('@hypercomb.social/IconProviderRegistry')
    const provided = registry?.all() ?? []
    return [...ICON_REGISTRY, ...provided as IconRegistryEntry[]]
  }

  #reregisterAll(): void {
    if (!this.#registered) return
    for (const profile of ['private', 'public-own', 'public-external'] as OverlayProfileKey[]) {
      this.#registerProfileIcons(profile)
    }
  }

  // ── Arrangement loading & registration ──────────────────────────

  async #loadArrangementAndRegister(): Promise<void> {
    // Arrangement load path pending re-wire through the layer-slot
    // properties API. `#getRootDir` returns null today, so the legacy
    // OPFS-backed load was unreachable; dropping the dead branch.
    // Register icons for all profiles with the default arrangement.
    const descriptors = this.#buildAllDescriptors()
    this.emitEffect('overlay:register-action', descriptors)

    // Emit pool info for arrange mode
    this.#emitPoolIcons()
  }

  #buildAllDescriptors(): OverlayActionDescriptor[] {
    const descriptors: OverlayActionDescriptor[] = []
    const merged = this.#mergedEntries()

    for (const profile of ['private', 'public-own', 'public-external'] as OverlayProfileKey[]) {
      const activeNames = this.#getActiveNames(profile)
      const positions = computeIconPositions(activeNames)

      for (let i = 0; i < activeNames.length; i++) {
        const entry = merged.find(e => e.name === activeNames[i] && e.profile === profile)
        if (!entry) continue

        descriptors.push({
          name: entry.name,
          owner: this.iocKey,
          svgMarkup: entry.svgMarkup,
          hoverTint: entry.hoverTint,
          profile: entry.profile,
          visibleWhen: entry.visibleWhen,
          tintWhen: entry.tintWhen,
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
    const merged = this.#mergedEntries()

    // Unregister existing icons for this profile
    const profileEntries = merged.filter(e => e.profile === profile)
    for (const entry of profileEntries) {
      EffectBus.emit('overlay:unregister-action', { name: entry.name })
    }

    // Re-register with new positions
    const activeNames = this.#getActiveNames(profile)
    const positions = computeIconPositions(activeNames)
    const descriptors: OverlayActionDescriptor[] = []

    for (let i = 0; i < activeNames.length; i++) {
      const entry = merged.find(e => e.name === activeNames[i] && e.profile === profile)
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
    const merged = this.#mergedEntries()
    const available = new Set(merged.filter(e => e.profile === profile).map(e => e.name))
    const saved = this.#arrangement[profile]
    const desired = (saved && saved.length > 0) ? saved : DEFAULT_ACTIVE[profile]
    // Filter out names whose providing drone is missing — covers both
    // saved arrangements with a now-uninstalled icon and defaults that
    // reference a toggled-off drone.
    return desired.filter(n => available.has(n))
  }

  #emitPoolIcons(): void {
    const merged = this.#mergedEntries()
    // For each profile, compute which icons are NOT active (the pool)
    const pool: Record<string, IconRegistryEntry[]> = {}
    for (const profile of ['private', 'public-own', 'public-external'] as OverlayProfileKey[]) {
      const activeNames = new Set(this.#getActiveNames(profile))
      pool[profile] = merged
        .filter(e => e.profile === profile && !activeNames.has(e.name))
    }
    EffectBus.emit('overlay:pool-icons', { pool, registry: merged })
  }

  // ── Persistence ─────────────────────────────────────────────────

  async #persistArrangement(): Promise<void> {
    // Persistence pending re-wire through the layer-slot properties API
    // — the legacy OPFS write was unreachable (rootDir was always null),
    // so we're dropping the dead body. The in-memory arrangement still
    // drives the current session; it just doesn't survive restart yet.
    void this.#arrangement
  }

  // ── Action handlers ─────────────────────────────────────────────

  #handleAction(payload: TileActionPayload): void {
    const { action, label: rawLabel } = payload
    const label = normalizeCell(rawLabel) || rawLabel

    switch (action) {
      case 'edit':
        // tile:action already emitted by overlay — editor listens for it
        break

      case 'search':
        EffectBus.emit('search:prefill', { value: label })
        break

      case 'command':
        EffectBus.emit('command:focus', { cell: label })
        break

      case 'note': {
        // Note targeting is resolved by lineage in NotesService — the
        // cellLabel rides on the event and is enough on its own. Don't
        // drive SelectionService here: a full selection highlight is
        // too loud for capture intent. The command-line `note-intent`
        // glow plus the icon's `hasNotes` tint are the subtle cues.
        EffectBus.emit('note:capture', { cellLabel: label })
        break
      }

      case 'hide':
        this.#hideOrBlock(label, 'hc:hidden-tiles', 'tile:hidden')
        break

      case 'break-apart':
        this.#unhide(label)
        break

      case 'block':
        this.#hideOrBlock(label, 'hc:blocked-tiles', 'tile:blocked')
        break

      case 'reroll':
        void this.#rerollSubstrate(label)
        break

      case 'remove':
        void this.#removeTile(label)
        break
    }
  }

  async #removeTile(label: string): Promise<void> {
    // Layer-as-primitive: drop the cell from the parent layer's children
    // slot via LayerCommitter.update. The cell's OPFS data stays put so
    // undoing the head history row restores it.
    type LineageLike = { domain?: () => string; explorerSegments?: () => readonly string[] }
    type HistoryServiceLike = {
      sign(l: LineageLike): Promise<string>
      currentLayerAt(s: string): Promise<{ children?: readonly string[]; [k: string]: unknown } | null>
      getLayerBySig(s: string): Promise<{ name?: string } | null>
    }
    type LayerCommitterLike = {
      update(
        segments: readonly string[],
        layer: { name?: string; [slot: string]: unknown },
        nameSlots?: ReadonlySet<string>,
      ): Promise<string>
    }

    const lineage = this.resolve<LineageLike>('lineage')
    const history = (window as any).ioc?.get?.('@diamondcoreprocessor.com/HistoryService') as HistoryServiceLike | undefined
    const committer = (window as any).ioc?.get?.('@diamondcoreprocessor.com/LayerCommitter') as LayerCommitterLike | undefined
    if (!lineage || !history || !committer) return

    const segments = (lineage.explorerSegments?.() ?? [])
      .map(s => String(s ?? '').trim())
      .filter(Boolean)
    const parentLocSig = await history.sign({
      domain: lineage.domain,
      explorerSegments: () => segments,
    })
    const parent = await history.currentLayerAt(parentLocSig)
    if (!parent) return

    // Names are the truth. Resolve each child sig to its layer's `name`,
    // drop the target, and pass the surviving names back. The committer
    // re-resolves each name to its current head sig at commit time.
    const childSigs = Array.isArray(parent.children) ? parent.children : []
    const survivorNames: string[] = []
    for (const sig of childSigs) {
      const child = await history.getLayerBySig(sig)
      if (!child || typeof child.name !== 'string') continue
      if (child.name !== label) survivorNames.push(child.name)
    }

    const nextLayer = { ...parent, children: survivorNames }

    // Emit BEFORE awaiting the commit so the visual unmount (ShowCellDrone's
    // sync incremental path) runs immediately. The OPFS cascade in
    // LayerCommitter.update is O(siblings) per ancestor depth and can take
    // seconds with large layers — gating the visual on it makes deletes feel
    // broken. All cell:removed listeners do in-memory work only, so eager
    // emit is safe; if the background commit throws, the cell will reappear
    // on the next layer re-read (no worse than today's failure mode).
    EffectBus.emit('cell:removed', { cell: label, segments })
    await committer.update(segments, nextLayer)
  }

  async #rerollSubstrate(label: string): Promise<void> {
    const svc = (window as any).ioc?.get?.('@diamondcoreprocessor.com/SubstrateService') as
      { rerollCell(label: string): Promise<boolean> } | undefined
    if (svc && await svc.rerollCell(label)) {
      // show-cell.drone listens for substrate:rerolled and clears its caches
      // (cellImageCache, cellSubstrateCache, #layerCellsCache, renderedCellsKey)
      // before requesting a render, so the new image shows up immediately.
      EffectBus.emit('substrate:rerolled', { cell: label })
      void new hypercomb().act()
    }
  }

  #bulkRerollSelected(): void {
    const selection = window.ioc.get<{ selected: ReadonlySet<string>; count: number }>('@diamondcoreprocessor.com/SelectionService')
    if (!selection || selection.count === 0) return

    const svc = (window as any).ioc?.get?.('@diamondcoreprocessor.com/SubstrateService') as
      { rerollCells(labels: string[]): Promise<string[]> } | undefined
    if (!svc) return

    // Filter to only substrate tiles — non-substrate tiles (user-edited) are
    // never clobbered by bulk reroll. The substrate flag comes from render:cell-count
    // and is authoritative regardless of which substrate pool is currently active.
    const labels = [...selection.selected].filter(l => this.#substrateLabels.has(l))
    if (labels.length === 0) return
    void svc.rerollCells(labels).then(rerolled => {
      if (rerolled.length === 0) return

      // Emit per-cell so show-cell's substrate:rerolled handler invalidates
      // caches for each affected tile. requestRender is microtask-coalesced
      // so a burst of emits collapses to a single render pass.
      for (const cell of rerolled) {
        EffectBus.emit('substrate:rerolled', { cell })
      }
      void new hypercomb().act()
    })
  }

  #unhide(label: string): void {
    const lineage = this.resolve<{ explorerLabel(): string }>('lineage')
    const location = lineage?.explorerLabel() ?? '/'
    const key = hideStorageKey(location)
    const existing: string[] = JSON.parse(localStorage.getItem(key) ?? '[]')
    const updated = existing.filter(l => l !== label)
    localStorage.setItem(key, JSON.stringify(updated))
    EffectBus.emit('tile:unhidden', { cell: label, location })

    // Mirror to the mesh — same scope rule as hide. Publishing an
    // updated `{ hidden: [...] }` with the removed name absent
    // replaces the prior parameterized-replaceable slot at this
    // pubkey+kind+lineage; the relay-echo on subsequent reads will
    // then carry the cleared list.
    const swarm = window.ioc.get<{ publishHide?: (names: Iterable<string>) => Promise<void> }>(
      '@diamondcoreprocessor.com/SwarmDrone',
    )
    void swarm?.publishHide?.(updated)

    // Drop the lineage-keyed hide too — break-apart unhides across
    // every layer the user is filtering on, including the persistent
    // cross-zone hide for peer visuals.
    removeHiddenLineage(this.#segments(), label)

    void new hypercomb().act()
  }

  #bulkHideSelected(): void {
    const selection = window.ioc.get<{ selected: ReadonlySet<string>; count: number; clear(): void }>('@diamondcoreprocessor.com/SelectionService')
    if (!selection || selection.count === 0) return

    const lineage = this.resolve<{ explorerLabel(): string }>('lineage')
    const location = lineage?.explorerLabel() ?? '/'
    const key = hideStorageKey(location)
    const hidden: string[] = JSON.parse(localStorage.getItem(key) ?? '[]')
    const hiddenSet = new Set(hidden)

    const labels = [...selection.selected]
    const allHidden = labels.every(l => hiddenSet.has(l))

    const swarm = window.ioc.get<{ publishHide?: (names: Iterable<string>) => Promise<void> }>(
      '@diamondcoreprocessor.com/SwarmDrone',
    )

    if (allHidden) {
      // Every selected tile is hidden → remove them from the hidden list
      const removeSet = new Set(labels)
      const updated = hidden.filter(l => !removeSet.has(l))
      localStorage.setItem(key, JSON.stringify(updated))
      for (const label of labels) EffectBus.emit('tile:unhidden', { cell: label, location })
      // Re-emit to force show-cell cache clear and re-render without the grayed state
      EffectBus.emit('visibility:show-hidden', { active: localStorage.getItem('hc:show-hidden') === '1' })
      void swarm?.publishHide?.(updated)
    } else {
      // At least one visible → add all to the hidden list
      for (const label of labels) if (!hiddenSet.has(label)) hidden.push(label)
      localStorage.setItem(key, JSON.stringify(hidden))
      for (const label of labels) EffectBus.emit('tile:hidden', { cell: label, location })
      // Auto-enable show-hidden so grayed tiles are visible
      localStorage.setItem('hc:show-hidden', '1')
      EffectBus.emit('visibility:show-hidden', { active: true })
      void swarm?.publishHide?.(hidden)
    }

    selection.clear()
    void new hypercomb().act()
  }

  #hideOrBlock(label: string, storagePrefix: string, effect: string): void {
    const lineage = this.resolve<{ explorerLabel(): string }>('lineage')
    const location = lineage?.explorerLabel() ?? '/'
    // Hide list is zone-scoped when a zone is active so switching
    // room/secret gives a fresh empty filter at the new zone instead
    // of bleeding stale hides through. Block stays device-scoped —
    // a personal/permanent signal not tied to any session.
    const key = (storagePrefix === 'hc:hidden-tiles')
      ? hideStorageKey(location)
      : `${storagePrefix}:${location}`
    const existing: string[] = JSON.parse(localStorage.getItem(key) ?? '[]')
    if (!existing.includes(label)) existing.push(label)
    localStorage.setItem(key, JSON.stringify(existing))
    EffectBus.emit(effect, { cell: label, location })

    // Mirror hide list onto the mesh as a kind-30202 event so the
    // filter survives reloads via relay echo and naturally evaporates
    // when the user switches zone (different room+secret = different
    // composed sig = no hides at that sig). Block list stays local.
    if (storagePrefix === 'hc:hidden-tiles') {
      const swarm = window.ioc.get<{ publishHide?: (names: Iterable<string>) => Promise<void> }>(
        '@diamondcoreprocessor.com/SwarmDrone',
      )
      void swarm?.publishHide?.(existing)

      // Lineage-keyed hide — additional persistent layer so a hide
      // survives across zones and sessions. The path string is the
      // user-visible identity of the tile (parent segments + name).
      // The swarm tile source filters against this list at render
      // time, so a peer publishing the same lineage anywhere later
      // stays hidden until the user explicitly un-hides via
      // break-apart.
      addHiddenLineage(this.#segments(), label)
    }

    void new hypercomb().act()
  }

  /** Current navigation segments as a clean string array. Used to
   *  compose the lineage-hide path for #hideOrBlock and #unhide. */
  #segments(): readonly string[] {
    const lineage = this.resolve<{ explorerSegments?: () => readonly string[] }>('lineage')
    const segs = lineage?.explorerSegments?.() ?? []
    return (Array.isArray(segs) ? segs : [])
      .map(s => String(s ?? '').trim())
      .filter(Boolean)
  }
}

/** Append `parentSegments.join('/') + '/' + name` to the persistent
 *  `hc:hidden-lineages` localStorage array. Cross-zone, cross-session
 *  hide for peer visuals (and own tiles too — same key). Idempotent on
 *  duplicates. The swarm tile source reads this list at render time. */
function addHiddenLineage(parentSegments: readonly string[], name: string): void {
  const locKey = parentSegments
    .map(s => String(s ?? '').trim())
    .filter(Boolean)
    .join('/')
  const path = locKey ? `${locKey}/${name}` : name
  try {
    const raw = localStorage.getItem('hc:hidden-lineages')
    const parsed = raw ? JSON.parse(raw) : []
    const list = Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
    if (list.includes(path)) return
    list.push(path)
    localStorage.setItem('hc:hidden-lineages', JSON.stringify(list))
  } catch {
    // localStorage might be unavailable (private browsing edge case);
    // the hide still applies in the in-session name-keyed list.
  }
}

/** Remove `parentSegments.join('/') + '/' + name` from the persistent
 *  `hc:hidden-lineages` localStorage array. Paired with break-apart so
 *  the cross-zone hide can be cleared by the same gesture that clears
 *  the name-keyed local hide. */
function removeHiddenLineage(parentSegments: readonly string[], name: string): void {
  const locKey = parentSegments
    .map(s => String(s ?? '').trim())
    .filter(Boolean)
    .join('/')
  const path = locKey ? `${locKey}/${name}` : name
  try {
    const raw = localStorage.getItem('hc:hidden-lineages')
    if (!raw) return
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return
    const next = parsed.filter((x): x is string => typeof x === 'string' && x !== path)
    localStorage.setItem('hc:hidden-lineages', JSON.stringify(next))
  } catch { /* leave list as-is */ }
}

// ── Exports for overlay arrange mode ──────────────────────────────

export { ICON_REGISTRY, DEFAULT_ACTIVE, ICON_SPACING, ICON_Y, computeIconPositions }
export type { IconArrangement }

const _tileActions = new TileActionsDrone()
window.ioc.register('@diamondcoreprocessor.com/TileActionsDrone', _tileActions)
