// diamondcoreprocessor.com/pixi/tile-actions.drone.ts
import { Drone, EffectBus, hypercomb, normalizeCell } from '@hypercomb/core'
import type { OverlayActionDescriptor, OverlayTileContext, OverlayProfileKey, OverlayTintFn } from './tile-overlay.drone.js'
import { sessionHideStore } from './session-hide.store.js'
import { hasDecorationKind, kindsForLabel } from '../../commands/decoration-kind-index.js'
import { FILES_ATTACHMENT_KIND } from '../../files/files-attachment.js'
import { FILES_ICON } from '../../files/file-types.js'
import { SWARM_INVITE_KIND } from '../../sharing/meeting-invite.js'
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

// ── Per-tile public/private flag ──────────────────────────────────
// A SELF-FACING marker: each tile is private by default; the owner can
// flip individual tiles to public. Persistent + device-scoped (like the
// block list), NOT zone-scoped and NOT in the layer — it's a participant-
// local annotation, so it must never enter the signed lineage (that would
// skew the layer signature across peers, same rule as hide/clipboard).
// Absence from the set means private. We store only the PUBLIC exceptions.
export function publicStorageKey(location: string): string {
  // Normalize every location segment so the key is identical whether the
  // location arrives as a RAW nav path (explorerLabel, e.g. "/My Folder") or
  // a NORMALIZED descent path the publish walk builds ("/my-folder"). Without
  // this, an individually-public tile is silently dropped from the broadcast
  // when the publisher reaches its folder by descent. Branches already match
  // because tilePath() normalizes; this brings the individual key in line.
  const norm = location.split('/').map(s => s.trim()).filter(Boolean).map(s => normalizeCell(s) || s).join('/')
  return `hc:public-tiles:/${norm}`
}

/** Public tile labels at `location`. Empty array on any parse failure. */
export function readPublicLabels(location: string): string[] {
  try {
    const raw = localStorage.getItem(publicStorageKey(location))
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

/** Flip a tile public/private at `location`. Returns the updated label set. */
export function setCellPublic(location: string, label: string, makePublic: boolean): string[] {
  const l = normalizeCell(label) || label
  const list = readPublicLabels(location)
  const has = list.includes(l)
  let next = list
  if (makePublic && !has) next = [...list, l]
  else if (!makePublic && has) next = list.filter(x => x !== l)
  try {
    localStorage.setItem(publicStorageKey(location), JSON.stringify(next))
  } catch { /* private-browsing edge case — flag won't persist */ }
  return next
}

// ── Branch-public ─────────────────────────────────────────────────
// "Make branch public" shares a tile AND its entire sub-tree in one click.
// Rather than walk (and load) the whole tree at click time, we store the
// branch ROOT's canonical path; a tile counts as public-via-branch when any
// stored branch path is a prefix of (or equal to) the tile's own path. O(1)
// per tile at render time, and it covers descendants that aren't loaded yet.
const PUBLIC_BRANCHES_KEY = 'hc:public-branches'

/** Canonical absolute path of a tile, with EVERY segment normalized so the
 *  stored branch-root path and a descendant's path agree even though nav
 *  segments are raw (Lineage keeps them un-normalized). Without normalizing
 *  the whole path, a branch rooted at "My Folder" (stored `/my-folder`) never
 *  matched a descendant whose location prefix carried the raw "My Folder". */
export function tilePath(location: string, label: string): string {
  const segs = location.split('/').map(s => s.trim()).filter(Boolean).map(s => normalizeCell(s) || s)
  const l = normalizeCell(label) || label
  return '/' + [...segs, l].join('/')
}

/** True when this tile is marked public INDIVIDUALLY (ignores branch cover).
 *  The make-public icon's tint uses this so it matches what its click toggles. */
export function isIndividuallyPublic(location: string, label: string): boolean {
  const l = normalizeCell(label) || label
  return readPublicLabels(location).includes(l)
}

/** Lineage paths whose whole branch is public. Empty on any parse failure. */
export function readPublicBranches(): string[] {
  try {
    const raw = localStorage.getItem(PUBLIC_BRANCHES_KEY)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

/** True when this exact tile is itself a public-branch root. */
export function isBranchPublic(location: string, label: string): boolean {
  return readPublicBranches().includes(tilePath(location, label))
}

/** Toggle the whole branch rooted at this tile public/private. */
export function setBranchPublic(location: string, label: string, makePublic: boolean): string[] {
  const p = tilePath(location, label)
  const list = readPublicBranches()
  const has = list.includes(p)
  let next = list
  if (makePublic && !has) next = [...list, p]
  else if (!makePublic && has) next = list.filter(x => x !== p)
  try {
    localStorage.setItem(PUBLIC_BRANCHES_KEY, JSON.stringify(next))
  } catch { /* private-browsing edge case — flag won't persist */ }
  return next
}

/** True when this tile is public — either marked individually, or covered by
 *  a public branch rooted at it or any ancestor. */
export function isCellPublic(location: string, label: string): boolean {
  const l = normalizeCell(label) || label
  if (readPublicLabels(location).includes(l)) return true
  const p = tilePath(location, label)
  return readPublicBranches().some(b => p === b || p.startsWith(b + '/'))
}

/** Current navigation location label, resolved straight from IoC so the
 *  module-level `tintWhen` predicate (no drone `this`) can read it. */
function currentExplorerLabel(): string {
  const lineage = window.ioc.get<{ explorerLabel(): string }>('@hypercomb.social/Lineage')
  return lineage?.explorerLabel?.() ?? '/'
}

type IconProviderEntry = {
  name: string
  owner?: string
  svgMarkup: string
  /** A provider declares EITHER a single `profile` (legacy) OR several
   *  `profiles` from one registration. `#mergedEntries` folds both forms by
   *  expanding into one per-profile catalog entry. */
  profile?: string
  profiles?: readonly string[]
  /** Auto-join the default arrangement for each profile (no DEFAULT_ACTIVE edit). */
  defaultActive?: boolean
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
  // cloud_download — Material Icons Filled. "Pull this peer's tile + its
  // image into my hive" — a plain `add` (+) read as "create a blank tile"
  // and gave no hint that the content/image comes FROM the peer.
  adopt: md('M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z'),
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
  // extension (puzzle piece) — Material Icons Filled. "Features": opens the
  // installer for a synced tile's branch so its scripts/packages can be
  // turned on, separate from the visuals `sync` already folds in.
  extension: md('M20.5 11H19V7c0-1.1-.9-2-2-2h-4V3.5C13 2.12 11.88 1 10.5 1S8 2.12 8 3.5V5H4c-1.1 0-1.99.9-1.99 2v3.8H3.5c1.49 0 2.7 1.21 2.7 2.7s-1.21 2.7-2.7 2.7H2V20c0 1.1.9 2 2 2h3.8v-1.5c0-1.49 1.21-2.7 2.7-2.7 1.49 0 2.7 1.21 2.7 2.7V22H17c1.1 0 2-.9 2-2v-4h1.5c1.38 0 2.5-1.12 2.5-2.5S21.88 11 20.5 11z'),
  // public/globe — Material Icons Filled (make THIS tile public: "the world")
  public: md('M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z'),
  // share — Material Icons Filled (make this tile + its whole BRANCH public)
  share: md('M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z'),
} as const

// ── Icon registry ─────────────────────────────────────────────────

export type IconRegistryEntry = {
  name: string
  svgMarkup: string
  hoverTint?: number
  profile: OverlayProfileKey
  /** Marks an entry EXPANDED from a provider that opted into the default
   *  arrangement — `#getActiveNames` auto-joins it for its profile, so a
   *  feature icon takes part without editing DEFAULT_ACTIVE. */
  defaultActive?: boolean
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

// True when this tile OBVIOUSLY carries a feature with a "scripts portion" —
// i.e. one of its decoration kinds is owned by a registered visual bee
// (website, dashboard, audio, …). This is the honest "has features" signal:
// a visual bee IS the code/render-type the installer would turn on, whereas
// plain images and pure-data decorations (contact cards, file attachments —
// which register a layer-slot/icon, NOT a VisualBeeRegistry entry) are not.
// Reads the same live registry the per-view adoption icons use, so new
// community view-features participate automatically and a drone toggled off
// in DCP drops out — no hardcoded allowlist. Synchronous: kindsForLabel is
// the hot in-memory decoration index; byDecorationKind is a Map lookup.
const tileHasVisualBeeFeature = (label: string): boolean => {
  const registry = window.ioc.get<{ byDecorationKind?: (kind: string) => unknown }>(
    '@diamondcoreprocessor.com/VisualBeeRegistry',
  )
  if (!registry?.byDecorationKind) return false
  for (const kind of kindsForLabel(label)) {
    if (registry.byDecorationKind(kind)) return true
  }
  return false
}

// True when a tile carries a swarm invite — either a LOCAL `swarm:invite`
// decoration (the owner's own junction) or a PEER broadcasting one over the
// wire (its bundle sig rides as `inviteSig`; see swarm.drone publish +
// visual-sanitizer). Synchronous + O(peers): the decoration index is the hot
// in-memory map and the peer scan is the same cache peerBroadcastsTile reads.
const peerTileHasInvite = (label: string): boolean => {
  const swarm = window.ioc.get<{
    peerTilesAtCurrentSig?: () => readonly ({ name: string } & Record<string, unknown>)[]
  }>('@diamondcoreprocessor.com/SwarmDrone')
  if (!swarm?.peerTilesAtCurrentSig) return false
  for (const tile of swarm.peerTilesAtCurrentSig()) {
    if (tile.name !== label) continue
    if (/^[a-f0-9]{64}$/.test(String(tile['inviteSig'] ?? ''))) return true
  }
  return false
}

const tileHasInvite = (label: string): boolean =>
  hasDecorationKind(label, SWARM_INVITE_KIND) || peerTileHasInvite(label)

// Login-style glyph (arrow stepping through a doorway) — "step into this
// meeting place". Material "login" path, verbatim.
const INVITE_ICON = md('M11 7l-1.41 1.41L12.17 11H3v2h9.17l-2.58 2.59L11 17l5-5zM20 19h-8v2h8c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-8v2h8v14z')

const ICON_REGISTRY: IconRegistryEntry[] = [
  // ── private profile ──
  { name: 'command', svgMarkup: ICONS.command, hoverTint: 0xa8ffd8, profile: 'private', labelKey: 'action.command', descriptionKey: 'action.command.description' },
  // 'edit' icon is provided by TileEditorDrone via IconProviderRegistry —
  // when the editor drone is toggled off it never registers, the icon
  // never appears, and the merged-available filter strips it from default
  // arrangements.
  { name: 'search', svgMarkup: ICONS.search, hoverTint: 0xc8ffc8, profile: 'private', visibleWhen: (ctx: OverlayTileContext) => ctx.noImage, labelKey: 'action.search', descriptionKey: 'action.search.description' },
  { name: 'remove', svgMarkup: ICONS.remove, hoverTint: 0xffc8c8, profile: 'private', labelKey: 'action.remove', descriptionKey: 'action.remove.description' },
  { name: 'break-apart', svgMarkup: ICONS.breakApart, hoverTint: 0x66ccff, profile: 'private', visibleWhen: (ctx: OverlayTileContext) => ctx.isHidden, labelKey: 'action.break-apart', descriptionKey: 'action.break-apart.description' },
  // ── world profile ──
  // Active ONLY while world mode is on (see tile-overlay #resolveProfileKey).
  // The hover overlay then shows NOTHING but these two share-toggles — no
  // edit/remove/etc. Each tints green when its scope is already public, dim
  // otherwise, and click toggles it (emitting tile:public-changed → repaint).
  //   make-public        → this tile only
  //   make-branch-public → this tile + its entire sub-tree
  {
    name: 'make-public',
    svgMarkup: ICONS.public,
    hoverTint: 0x6fd39a,
    profile: 'world',
    // Individual scope — matches what the click toggles (not branch cover).
    tintWhen: (ctx: OverlayTileContext) => isIndividuallyPublic(currentExplorerLabel(), ctx.label) ? 0x6fd39a : 0x9aa6b8,
    labelKey: 'action.make-public',
    descriptionKey: 'action.make-public.description',
  },
  {
    name: 'make-branch-public',
    svgMarkup: ICONS.share,
    hoverTint: 0x6fd39a,
    profile: 'world',
    tintWhen: (ctx: OverlayTileContext) => isBranchPublic(currentExplorerLabel(), ctx.label) ? 0x6fd39a : 0x9aa6b8,
    labelKey: 'action.make-branch-public',
    descriptionKey: 'action.make-branch-public.description',
  },
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
  // `features` (the puzzle-piece) is now "SHOW FEATURES": click it and
  // ShowFeaturesDrone gathers the META details (no code) of the bee features
  // this tile uses and opens the right-docked features panel — you stay in
  // the hive. Clicking another tile's icon ADDS its features to the same
  // list. Shown on any tile that carries a registered visual bee
  // (tileHasVisualBeeFeature: a real render-feature, NOT a plain image or
  // pure-data card) — the peer-broadcast requirement is gone, because viewing
  // metadata needs no publisher branch. Registered on `private` (browsing
  // your own hive) and `public-own` (your tile in public mode). Click handled
  // by ShowFeaturesDrone (action 'features'); turning a feature on from the
  // panel is BENIGN staging that only pre-ticks the installer later.
  { name: 'features', svgMarkup: ICONS.extension, hoverTint: 0xc8b8ff, profile: 'private', visibleWhen: (ctx: OverlayTileContext) => tileHasVisualBeeFeature(ctx.label), labelKey: 'action.features', descriptionKey: 'action.features.description' },
  { name: 'features', svgMarkup: ICONS.extension, hoverTint: 0xc8b8ff, profile: 'public-own', visibleWhen: (ctx: OverlayTileContext) => tileHasVisualBeeFeature(ctx.label), labelKey: 'action.features', descriptionKey: 'action.features.description' },
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
  // ── files (all profiles) ──
  // The file icon appears on any tile that has at least one `files:attachment`
  // decoration — your own (private / public-own) or a peer's (public-external,
  // so their attached docs are downloadable). visibleWhen reads the synchronous
  // decoration-kind index; the click is handled by FileDropDrone via tile:action.
  { name: 'files', svgMarkup: FILES_ICON, hoverTint: 0xa8c8ff, profile: 'private', visibleWhen: (ctx: OverlayTileContext) => hasDecorationKind(ctx.label, FILES_ATTACHMENT_KIND), labelKey: 'action.files', descriptionKey: 'action.files.description' },
  { name: 'files', svgMarkup: FILES_ICON, hoverTint: 0xa8c8ff, profile: 'public-own', visibleWhen: (ctx: OverlayTileContext) => hasDecorationKind(ctx.label, FILES_ATTACHMENT_KIND), labelKey: 'action.files', descriptionKey: 'action.files.description' },
  { name: 'files', svgMarkup: FILES_ICON, hoverTint: 0xa8c8ff, profile: 'public-external', visibleWhen: (ctx: OverlayTileContext) => hasDecorationKind(ctx.label, FILES_ATTACHMENT_KIND), labelKey: 'action.files', descriptionKey: 'action.files.description' },
  // ── swarm invite (all profiles) ──
  // The invite icon appears on any tile carrying a `swarm:invite` junction —
  // your own (private / public-own) or a peer's broadcasting it (public-external).
  // visibleWhen reads the synchronous decoration index + peer cache; the click
  // is handled by MeetingInviteWorker via tile:action (auth-switch join).
  { name: 'invite', svgMarkup: INVITE_ICON, hoverTint: 0xa8ffd8, profile: 'private', visibleWhen: (ctx: OverlayTileContext) => tileHasInvite(ctx.label), labelKey: 'action.invite', descriptionKey: 'action.invite.description' },
  { name: 'invite', svgMarkup: INVITE_ICON, hoverTint: 0xa8ffd8, profile: 'public-own', visibleWhen: (ctx: OverlayTileContext) => tileHasInvite(ctx.label), labelKey: 'action.invite', descriptionKey: 'action.invite.description' },
  { name: 'invite', svgMarkup: INVITE_ICON, hoverTint: 0xa8ffd8, profile: 'public-external', visibleWhen: (ctx: OverlayTileContext) => tileHasInvite(ctx.label), labelKey: 'action.invite', descriptionKey: 'action.invite.description' },
  // NOTE: feature icons (e.g. `contact`) are NOT listed here. A feature
  // contributes its overlay icon by registering ONE `IconProviderRegistry`
  // provider declaring `profiles` + `defaultActive` + `visibleWhen` (see
  // contact.drone.ts) — it then takes part in the overlay across profiles
  // with no edit to this core catalog. ICON_REGISTRY is just the built-in
  // chrome (command/search/remove/.../make-public/files).
]

// Default active icons per profile (defines the fallback order).
//
// public-own: `hide` and `break-apart` are real entries on `public-own`
// in ICON_REGISTRY above; adopting a peer tile is handled by the
// `public-external` profile (the tile flips kind once it's local).
const DEFAULT_ACTIVE: Record<OverlayProfileKey, string[]> = {
  'private': ['command', 'edit', 'features', 'remove', 'break-apart', 'files', 'invite'],
  // World mode: ONLY the two share-toggles, none of the regular icons.
  'world': ['make-public', 'make-branch-public'],
  // Your own tile in public mode — same trash-bin remove that
  // private mode uses. Records a history op, can be undone. `sync`
  // folds the broadcasting peer's latest VISUALS into the tile in place
  // and is rendered ONLY while a live peer publishes the same name.
  // `features` (puzzle-piece) opens the read-only SHOW FEATURES panel for
  // any tile carrying a registered visual bee — it stays in the hive and
  // has NO peer-broadcast requirement.
  'public-own': ['sync', 'features', 'remove', 'break-apart', 'files', 'invite'],
  // Peer-only mesh tiles. Single-click `adopt` is the explicit
  // "I want to expand on this topic" action — writes the tile to
  // your local layer AND pulls the resources it references (images
  // etc.) via the content broker. Different mechanism from auto-
  // adopt: auto-adopt follows a participant continuously, single-
  // adopt is one tile + its resources, on demand. `hide` dismisses
  // a peer tile from view without taking ownership.
  'public-external': ['adopt', 'hide', 'files', 'invite'],
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
const HANDLED_ACTIONS = new Set(['edit', 'search', 'command', 'hide', 'break-apart', 'block', 'remove', 'make-public', 'make-branch-public'])

type TileActionPayload = { action: string; label: string; q: number; r: number; index: number }

export class TileActionsDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override description = 'registers default tile overlay icons and handles their click actions'

  protected override deps = {
    lineage: '@hypercomb.social/Lineage',
  }

  protected override listens = ['render:host-ready', 'overlay:request-register', 'render:cell-count', 'tile:action', 'controls:action', 'overlay:icons-reordered', 'overlay:arrange-mode', 'substrate:applied', 'substrate:rerolled', 'cell:removed']
  protected override emits = ['overlay:register-action', 'overlay:pool-icons', 'search:prefill', 'command:focus', 'tile:hidden', 'tile:unhidden', 'tile:blocked', 'tile:public-changed', 'cell:removed', 'visibility:show-hidden', 'substrate:rerolled']

  #registered = false
  #effectsRegistered = false
  #arrangement: IconArrangement = {}
  #substrateLabels = new Set<string>()
  #registryChangeTimer: ReturnType<typeof setTimeout> | null = null
  // Icon providers (edit, note, contact, view:website) self-register in the
  // IconProviderRegistry one at a time during boot. Reacting to each 'change'
  // immediately runs #reregisterAll's unregister-then-reregister churn, which
  // races the overlay's accumulate and leaves a partial/invisible icon set.
  // Coalesce to a SINGLE pass once the providers settle so the COMPLETE set
  // re-registers cleanly (exactly what a manual re-trigger does).
  #onRegistryChange = (): void => {
    if (this.#registryChangeTimer) clearTimeout(this.#registryChangeTimer)
    this.#registryChangeTimer = setTimeout(() => {
      this.#registryChangeTimer = null
      this.#reregisterAll()
    }, 250)
  }

  protected override heartbeat = async (): Promise<void> => {
    if (!this.#effectsRegistered) {
      this.#effectsRegistered = true

      // Register all icons as a batch once the pixi host is ready
      this.onEffect('render:host-ready', () => {
        if (this.#registered) return
        this.#registered = true
        void this.#loadArrangementAndRegister()
      })

      // Handshake: the overlay asks every icon provider to re-emit once it is
      // ready. Its overlay:register-action subscription is live, but our
      // descriptors were emitted earlier and only the LAST survives in
      // EffectBus's single lastValue slot — so without this the overlay boots
      // with zero icons. Respond with the full ADDITIVE batch via
      // #buildAllDescriptors (NOT #reregisterAll, which emits an unregister
      // per profile entry first and opens a transient empty window). This one
      // response also carries the IconProviderRegistry-contributed icons
      // (edit/note/contact), since they fold into #mergedEntries.
      this.onEffect('overlay:request-register', () => {
        if (!this.#registered) return
        this.emitEffect('overlay:register-action', this.#buildAllDescriptors())
        this.#emitPoolIcons()
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
    // Expand each provider into one per-profile catalog entry. A feature
    // registers ONE provider declaring `profiles` (e.g. ['private','public-own']);
    // expanding here is the single adapter point, so everything downstream
    // (availability, descriptor build, arrange/pool) keeps dealing with plain
    // single-profile entries — no name-collision, no per-feature core edits.
    const expanded: IconRegistryEntry[] = []
    for (const p of provided) {
      const profiles = p.profiles ?? (p.profile ? [p.profile] : [])
      for (const prof of profiles) {
        expanded.push({
          name: p.name,
          svgMarkup: p.svgMarkup,
          hoverTint: p.hoverTint,
          profile: prof as OverlayProfileKey,
          defaultActive: p.defaultActive,
          visibleWhen: p.visibleWhen,
          tintWhen: p.tintWhen,
          labelKey: p.labelKey,
          descriptionKey: p.descriptionKey,
        })
      }
    }
    return [...ICON_REGISTRY, ...expanded]
  }

  #reregisterAll(): void {
    if (!this.#registered) return
    for (const profile of ['private', 'public-own', 'public-external', 'world'] as OverlayProfileKey[]) {
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

    for (const profile of ['private', 'public-own', 'public-external', 'world'] as OverlayProfileKey[]) {
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

    // Unregister existing icons for this profile. Carry the profile so the
    // overlay removes the name from THIS profile's order only — names shared
    // across profiles (remove/files/invite/break-apart/contact) would otherwise
    // be spliced out of the wrong profile (the bug that collapsed the set).
    const profileEntries = merged.filter(e => e.profile === profile)
    for (const entry of profileEntries) {
      EffectBus.emit('overlay:unregister-action', { name: entry.name, profile })
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
        // Preserve tintWhen on re-registration — without it the world icons
        // (the only tintWhen users) lose their public-state color after any
        // IconProviderRegistry 'change' (e.g. a drone toggled on/off).
        tintWhen: entry.tintWhen,
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
    let desired: string[]
    if (saved && saved.length > 0) {
      desired = [...saved]
    } else {
      desired = [...DEFAULT_ACTIVE[profile]]
      // Provider icons that opt into the default arrangement (defaultActive)
      // auto-join here for their profile — so a feature's icon takes part
      // without editing DEFAULT_ACTIVE. Insert before 'remove' so it stays the
      // rightmost action.
      for (const e of merged) {
        if (!e.defaultActive || e.profile !== profile || desired.includes(e.name)) continue
        const ri = desired.indexOf('remove')
        if (ri >= 0) desired.splice(ri, 0, e.name)
        else desired.push(e.name)
      }
    }
    // Filter out names whose providing drone is missing — covers both
    // saved arrangements with a now-uninstalled icon and defaults that
    // reference a toggled-off drone.
    return desired.filter(n => available.has(n))
  }

  #emitPoolIcons(): void {
    const merged = this.#mergedEntries()
    // For each profile, compute which icons are NOT active (the pool)
    const pool: Record<string, IconRegistryEntry[]> = {}
    for (const profile of ['private', 'public-own', 'public-external', 'world'] as OverlayProfileKey[]) {
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

      case 'hide':
        this.#hideOrBlock(label, 'hc:hidden-tiles', 'tile:hidden')
        break

      case 'break-apart':
        this.#unhide(label)
        break

      case 'block':
        this.#hideOrBlock(label, 'hc:blocked-tiles', 'tile:blocked')
        break

      case 'make-public': {
        // World-mode: toggle THIS tile's individual public flag. tile-overlay
        // refreshes the icon tint on tile:public-changed; show-cell re-dims.
        const lineage = this.resolve<{ explorerLabel(): string }>('lineage')
        const location = lineage?.explorerLabel() ?? '/'
        const isOn = readPublicLabels(location).includes(label)
        setCellPublic(location, label, !isOn)
        EffectBus.emit('tile:public-changed', { cell: label, location, public: !isOn })
        break
      }

      case 'make-branch-public': {
        // World-mode: toggle this tile + its entire sub-tree public.
        const lineage = this.resolve<{ explorerLabel(): string }>('lineage')
        const location = lineage?.explorerLabel() ?? '/'
        const isOn = isBranchPublic(location, label)
        setBranchPublic(location, label, !isOn)
        EffectBus.emit('tile:public-changed', { cell: label, location, public: !isOn, branch: true })
        break
      }

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
    const existing: string[] = JSON.parse(sessionHideStore.getItem(key) ?? '[]')
    const updated = existing.filter(l => l !== label)
    sessionHideStore.setItem(key, JSON.stringify(updated))
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
    const hidden: string[] = JSON.parse(sessionHideStore.getItem(key) ?? '[]')
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
      sessionHideStore.setItem(key, JSON.stringify(updated))
      for (const label of labels) EffectBus.emit('tile:unhidden', { cell: label, location })
      // Re-emit to force show-cell cache clear and re-render without the grayed state
      EffectBus.emit('visibility:show-hidden', { active: localStorage.getItem('hc:show-hidden') === '1' })
      void swarm?.publishHide?.(updated)
    } else {
      // At least one visible → add all to the hidden list
      for (const label of labels) if (!hiddenSet.has(label)) hidden.push(label)
      sessionHideStore.setItem(key, JSON.stringify(hidden))
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
    const isHide = storagePrefix === 'hc:hidden-tiles'
    const key = isHide
      ? hideStorageKey(location)
      : `${storagePrefix}:${location}`
    // HIDES are SESSION-ONLY (in-memory, gone on refresh) so a stale swarm/zone
    // hide can't leak into a later private session. Device-scoped BLOCKS stay
    // persistent (localStorage) — a permanent personal signal.
    const store: { getItem(k: string): string | null; setItem(k: string, v: string): void } =
      isHide ? sessionHideStore : localStorage
    const existing: string[] = JSON.parse(store.getItem(key) ?? '[]')
    if (!existing.includes(label)) existing.push(label)
    store.setItem(key, JSON.stringify(existing))
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
    const raw = sessionHideStore.getItem('hc:hidden-lineages')
    const parsed = raw ? JSON.parse(raw) : []
    const list = Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
    if (list.includes(path)) return
    list.push(path)
    sessionHideStore.setItem('hc:hidden-lineages', JSON.stringify(list))
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
    const raw = sessionHideStore.getItem('hc:hidden-lineages')
    if (!raw) return
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return
    const next = parsed.filter((x): x is string => typeof x === 'string' && x !== path)
    sessionHideStore.setItem('hc:hidden-lineages', JSON.stringify(next))
  } catch { /* leave list as-is */ }
}

// ── Exports for overlay arrange mode ──────────────────────────────

export { ICON_REGISTRY, DEFAULT_ACTIVE, ICON_SPACING, ICON_Y, computeIconPositions }
export type { IconArrangement }

const _tileActions = new TileActionsDrone()
window.ioc.register('@diamondcoreprocessor.com/TileActionsDrone', _tileActions)
