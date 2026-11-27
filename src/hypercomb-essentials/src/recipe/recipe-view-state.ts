// recipe/recipe-view-state.ts
//
// WHAT THE RECIPE VIEW DECIDES, AS PURE FUNCTIONS OF WHAT IT IS HANDED. The
// drone (recipe-view.drone.ts) reads the hive, mounts the page and saves; every
// choice it makes on the way is here, so each can be pinned without a hive:
//
//   WHICH TILE   the one selected tile, else the place the cook stands (L1).
//   WHICH LAYOUT the template the recipe names when it is here, else the
//                built-in one it names, else the first built-in (N4: a layout
//                and its fill are two things, so a missing layout never hides
//                what a cook wrote).
//   WHAT CHANGED a recipe is its canonical bytes (I1), so "did it change" is
//                asked of those and an unchanged save spends no history (H2).
//   THE PICKER   built in, the cook's own, then one group per domain that is
//                switched on: whom a reader takes from is their own choice
//                (T5), and the table is the union of what those hosts list
//                (T9). A pick is resolved here, so the drone keeps a domain's
//                template only on the press that chose it (T4).
//   A LIVE PRESS a replayed last value is not a press: an effect that carries
//                a stamp is acted on only while the stamp is fresh.
//   THE DESK'S LIST the tiles on the page the recipe's tile sits on, once each
//                by name (N1: the name is the path segment), the open one
//                marked and never missing.
//   WHERE IT IS OFFERED, said in words: only you, in your pools when you
//                publish (T5, T8), or with the room you joined, kept by its
//                host or live while you are there (T1). A lit tile is the only
//                kind that is offered anywhere.
//   THE BULB     which mark a press changes: the tile's own, the branch it is
//                the root of, or none when a branch above it is what lights it.
//
// Pure: no IoC, no store, no network, no EffectBus, nothing registered.

import { normalizeCell } from '@hypercomb/core'
import type { RecipeShared, RecipeTileRow } from './recipe-page.js'
import type { RecipePickerEntry, RecipePickerGroup } from './recipe-picker.js'
import type { RecipeTemplateOffer } from './recipe-pool.js'
import type { RecipeSay } from './recipe-style.js'
import { recipeBytes, recipeTemplateWords, type RecipeDocument, type RecipeTemplateDocument } from './recipe-template.js'

/** The view's owner in the mode registry and the back gesture: one string, so the entry is live exactly while the view is up. */
export const RECIPE_VIEW_OWNER = 'recipe-view'
/** Who asks for the domain shelf while the template picker is open. */
export const RECIPE_PICKER_OWNER = 'recipe-picker'
/** A stamped open or spawn older than this is a replayed last value, not a press. */
export const RECIPE_VIEW_FRESH_MS = 5_000
/** The domains one picker asks, at most: as many as a hive follows. */
export const RECIPE_VIEW_ZONES_MAX = 16
/** The search words the domain shelf carries, at most. */
export const RECIPE_VIEW_QUERY_MAX = 80
/** The view-mode token Browse enters: the catalogue of what the cook's nodes offer. */
export const RECIPE_VIEW_BROWSE = 'catalogue'

/** A template with the signature its bytes have. */
export interface RecipeViewTemplate {
  readonly sig: string
  readonly template: RecipeTemplateDocument
}

/** Everything the picker offers, by where it comes from. */
export interface RecipeViewSources {
  /** The built-in templates, in the picker's order. */
  readonly defaults: readonly RecipeViewTemplate[]
  /** The templates on the cook's own list. */
  readonly kept: readonly RecipeViewTemplate[]
  /** The domains switched on in the domain shelf, in its order. */
  readonly zones: readonly string[]
  /** What each domain asked so far offers. A domain not asked yet has no entry. */
  readonly offers: ReadonlyMap<string, readonly RecipeTemplateOffer[]>
}

/** The headings of the two groups that are not a domain. */
export interface RecipeViewGroupWords {
  readonly builtIn: string
  readonly yours: string
}

/** A pick, resolved to where it came from: what the drone must do before it is used. */
export type RecipeViewPicked =
  | { readonly from: 'built-in'; readonly sig: string; readonly template: RecipeTemplateDocument }
  | { readonly from: 'yours'; readonly sig: string; readonly template: RecipeTemplateDocument }
  | { readonly from: 'domain'; readonly sig: string; readonly offer: RecipeTemplateOffer }

const names = (segments: readonly unknown[]): string[] =>
  segments.map(part => String(part ?? '').trim()).filter(Boolean)

/**
 * The tile the word `recipe` opens: the one selected tile when exactly one is
 * selected, else the place the cook stands. Empty at the hive root with
 * nothing selected, where there is no tile to hold a recipe.
 */
export function recipeViewTarget(selected: Iterable<string>, here: readonly string[]): string[] {
  const place = names(here)
  const chosen = names([...selected])
  return chosen.length === 1 ? [...place, chosen[0]] : place
}

/** True while a stamp is a press that just happened. A payload with no stamp is never fresh. */
export function recipeViewFresh(at: unknown, now: number): boolean {
  return typeof at === 'number' && Number.isFinite(at) && Math.abs(now - at) <= RECIPE_VIEW_FRESH_MS
}

/**
 * The recipe as the text of its canonical bytes: two documents that say the
 * same thing have the same key, so an unchanged recipe is never saved twice.
 */
export function recipeViewKey(doc: RecipeDocument): string {
  try { return new TextDecoder().decode(recipeBytes(doc)) } catch { return JSON.stringify(doc) }
}

/**
 * The layout a recipe is shown through: the template it names when this hive
 * holds it, else the built-in one it names, else the first built-in. Null only
 * when there is no built-in to fall back on.
 */
export function recipeViewTemplate(
  named: string | undefined,
  held: RecipeViewTemplate | null,
  defaults: readonly RecipeViewTemplate[],
): RecipeViewTemplate | null {
  if (held) return held
  return defaults.find(entry => entry.sig === named) ?? defaults[0] ?? null
}

/** Search words in the form the domain shelf announces them: trimmed, lower-cased, bounded. */
export function recipeViewQuery(raw: string): string {
  return String(raw ?? '').trim().toLowerCase().slice(0, RECIPE_VIEW_QUERY_MAX).trimEnd()
}

/** The domains a picker asks: once each, in the shelf's order, bounded. */
export function recipeViewZones(zones: readonly string[]): string[] {
  return [...new Set(names(zones))].slice(0, RECIPE_VIEW_ZONES_MAX)
}

/**
 * The picker's groups, in order: built in, the cook's own (never repeating a
 * built-in one), then one per domain that is switched on, holding what that
 * domain offers. A template several domains offer appears under each. Entries
 * are narrowed to those that say every word of the query; a group left empty
 * is left out.
 */
export function recipeViewPickerGroups(sources: RecipeViewSources, query: string, words: RecipeViewGroupWords): RecipePickerGroup[] {
  const wanted = recipeViewQuery(query).split(/\s+/).filter(Boolean)
  const says = (template: RecipeTemplateDocument): boolean => {
    const said = recipeTemplateWords(template)
    return wanted.every(word => said.includes(word))
  }
  const once = (entries: readonly RecipeViewTemplate[], skip: ReadonlySet<string>, kept: boolean): RecipePickerEntry[] => {
    const seen = new Set<string>(skip)
    const out: RecipePickerEntry[] = []
    for (const entry of entries) {
      if (seen.has(entry.sig) || !says(entry.template)) continue
      seen.add(entry.sig)
      out.push({ sig: entry.sig, template: entry.template, ...(kept ? { kept: true } : {}) })
    }
    return out
  }
  const builtIn = new Set(sources.defaults.map(entry => entry.sig))
  const groups: RecipePickerGroup[] = [
    { id: 'built-in', label: words.builtIn, entries: once(sources.defaults, new Set(), false) },
    { id: 'yours', label: words.yours, entries: once(sources.kept, builtIn, true) },
    ...recipeViewZones(sources.zones).map(zone => ({
      id: `domain:${zone}`,
      label: zone,
      entries: once(sources.offers.get(zone) ?? [], new Set(), false),
    })),
  ]
  return groups.filter(group => group.entries.length > 0)
}

/**
 * Where a picked signature comes from. One already here (built in, or on the
 * cook's list) is taken from here, so nothing is asked of a domain for it; a
 * domain's offer is found only among the domains switched on. Null for a
 * signature nothing offers.
 */
export function recipeViewPick(sig: string, sources: RecipeViewSources): RecipeViewPicked | null {
  const builtIn = sources.defaults.find(entry => entry.sig === sig)
  if (builtIn) return { from: 'built-in', sig, template: builtIn.template }
  const yours = sources.kept.find(entry => entry.sig === sig)
  if (yours) return { from: 'yours', sig, template: yours.template }
  for (const zone of recipeViewZones(sources.zones)) {
    const offer = sources.offers.get(zone)?.find(entry => entry.sig === sig)
    if (offer) return { from: 'domain', sig, offer }
  }
  return null
}

/** How many templates each domain asked so far offers: what the shelf's chips say. */
export function recipeViewCounts(offers: ReadonlyMap<string, readonly RecipeTemplateOffer[]>): Record<string, number> {
  return Object.fromEntries([...offers].map(([zone, offered]) => [zone, offered.length]))
}

// ── the desk's list ─────────────────────────────────────────────────────────

/** A tile's route as the quiet address the desk shows: "/recipes/sunday-soup". */
export function recipeViewAddress(segments: readonly string[]): string {
  return `/${names(segments).join('/')}`
}

/** One tile name, however it was spelled. */
const tileKey = (label: string): string => normalizeCell(label) || label.trim()

/** True when two labels name the same tile of one page. */
export function recipeViewSameTile(a: string, b: string): boolean {
  return tileKey(a) === tileKey(b)
}

/**
 * The desk's list: the tiles of one page by name, once each in the page's own
 * order, the open one marked `current`. `holds` says whether a tile has a
 * recipe. The open tile is always in the list: a page that did not name it
 * (not read yet, or the tile is new) gets it at the end.
 */
export function recipeViewTileRows(labels: readonly string[], holds: (label: string) => boolean, current: string): RecipeTileRow[] {
  const seen = new Set<string>()
  const rows: RecipeTileRow[] = []
  for (const label of [...names(labels), ...names([current])]) {
    const key = tileKey(label)
    if (seen.has(key)) continue
    seen.add(key)
    rows.push({ label, hasRecipe: holds(label), current: recipeViewSameTile(label, current) })
  }
  return rows
}

// ── where the recipe is offered ─────────────────────────────────────────────

/** What the room's host answered the last time this tile's recipe was shared. Null: no attempt has finished. */
export type RecipeViewRoomOutcome = 'kept' | 'live' | 'failed' | null

/** Everything the words beside the bulb are made from. */
export interface RecipeViewSharing {
  /** The tile is lit: on its own, or by a lit branch. */
  readonly lit: boolean
  /** This tab is joined to a room. */
  readonly joined: boolean
  readonly room: string
  /** The room's host. */
  readonly host: string
  /** The recipe says nothing yet, so there is nothing to share. */
  readonly empty: boolean
  readonly outcome: RecipeViewRoomOutcome
}

/**
 * Where a recipe is offered, said plainly. Not lit: only you. Lit outside a
 * room: left in your pools when you publish. Lit in a room: shared with it
 * (kept by its host), shared live (the host keeps entries only for its own
 * people), or on its way. An empty recipe is shared once it says something.
 */
export function recipeViewShared(state: RecipeViewSharing, say: RecipeSay): RecipeShared {
  if (!state.lit) return { lit: false, words: say('recipe.shared.only-you', 'Only you') }
  if (!state.joined) return { lit: true, words: say('recipe.shared.pools', 'On: left in your pools when you publish') }
  const room = state.room.trim() || say('recipe.shared.room', 'the room')
  const host = state.host.trim() || say('recipe.shared.host', 'its host')
  if (state.empty) return { lit: true, words: say('recipe.shared.waiting', 'On: shared with {room} once you write something', { room }) }
  if (state.outcome === 'kept') return { lit: true, tone: 'good', words: say('recipe.shared.kept', 'Shared with {room} \u00b7 {host}', { room, host }) }
  if (state.outcome === 'live') {
    return { lit: true, tone: 'warn', words: say('recipe.shared.live', 'Shared live with {room}. {host} keeps entries only for its own people', { room, host }) }
  }
  return { lit: true, words: say('recipe.shared.sharing', 'Sharing with {room}...', { room }) }
}

// ── the bulb ────────────────────────────────────────────────────────────────

/** How a tile is lit: on its own, as the root of a lit branch, or at all (those two, or a lit branch above it). */
export interface RecipeViewLight {
  readonly own: boolean
  readonly branch: boolean
  readonly lit: boolean
}

/** What a press of the bulb changes. `held`: a branch above lights the tile, and only that branch can unlight it. */
export type RecipeViewLightStep = 'light' | 'unlight' | 'unlight-branch' | 'held'

/** The mark a press of the bulb changes: the tile's own first, then the branch it is the root of. */
export function recipeViewLightStep(light: RecipeViewLight): RecipeViewLightStep {
  if (light.own) return 'unlight'
  if (light.branch) return 'unlight-branch'
  return light.lit ? 'held' : 'light'
}
