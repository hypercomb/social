// recipe/recipe.queen.ts
//
// `recipe`: THE WORD THAT OPENS A RECIPE ON A TILE. A recipe is content a tile
// holds in its own `recipe` slot (recipe-slot.ts, L1), so the word needs a
// tile: the one selected tile when exactly one is selected, else the place the
// cook is standing in. At the hive root with nothing selected there is no tile
// to hold one, and the word says so.
//
// The word only ASKS. It announces where the cook stood (`view:spawn`, the
// record presentation/tiles/view-spawn.ts describes) and then names the tile on
// `view:open-for-tile`. The view's drone does the opening, and leaving the view
// lands on the surface it was opened from.
//
// THE OPEN REPLAYS, ON PURPOSE. The view's drone sleeps until its view is asked
// for (it declares `renders`), and the bus's replay of this press is what
// reaches it once it wakes, the door every tile icon already uses
// (commands/visual-bee-icons.ts). Each press carries a stamp, so the drone
// never takes an old one for a new one.
//
// This file is also where the feature says what it is to the rest of the hive,
// once, at load:
//   - the VIEW, to the visual-bee registry: the tile icon, the toggle, the
//     slot that lights them and the kind the roster switches;
//   - the POOL CONTRIBUTIONS: a lit recipe tile leaves the template it is
//     written into in `recipe:template`, and itself, as a row with its
//     closure, in `recipe:entry` (P1, T9), at the cook's own root domain and
//     only when the cook publishes (T5, T8);
//   - the COHORT: the view is lit once on a hive that already has an on-list,
//     and never on a hive that opened dark (sharing/behavior-enablement.ts);
//   - the TAKE-BACK: a recipe tile unlit while the tab is in a room takes its
//     entry back from the room's host (H4, T8). It is here because this file
//     is awake on every hive and the desk is not;
//   - the ENTRY FORM: what a pool opened for posts asks a phone to fill (a
//     recipe template), and how its posted recipes are brought home
//     (pools/open-entries-forms.ts, documentation/open-entry-pools.md).
//
// `recipe posts` opens the leader's "Open for posts" in pools mode: the page
// to show a code for, when it ends, and the page's pool if it has one. The
// pools bar does the opening; the word only asks. `posts` is no behaviour word
// of its own, so the command line never runs it as one.
//
// Opening a recipe is a participant's own act: this queen declares no machine
// grammar, and no alias (aliases are the participant's to give).

import { EffectBus, I18N_IOC_KEY, QueenBee, get, type I18nProvider } from '@hypercomb/core'
import type { VisualBeeRegistry } from '../commands/visual-bee-registry.js'
import { LIGHTS_CHANGED, LIGHTS_ENTER } from '../pools/lights-contract.js'
import { litTileRoutes, liveChildrenOf } from '../pools/lit-tiles.js'
import { ENTRY_POSTS_WANTED, registerEntryForm, type EntryFormTemplate } from '../pools/open-entries-forms.js'
import type { EntryRow } from '../pools/open-entries.js'
import { registerPoolContribution } from '../pools/pool-contributions.js'
import { roomStanding } from '../pools/room-entries.js'
import { isCellPublic, readPublicBranches, tilePath } from '../presentation/tiles/tile-public.js'
import { VIEW_SPAWN_EFFECT, type ViewSpawn } from '../presentation/tiles/view-spawn.js'
import { ENABLEMENT_CHANGED, isPublishedVisitorShell, readGlobalOnKinds, seedCohortOn } from '../sharing/behavior-enablement.js'
import { mapBounded } from '../sharing/bounded-fetch.js'
import { RECIPE_ENTRY_MEANING, openRecipeEntry, postedRecipeOffers, recipeEntryContribution, retractRecipeFromRoom, takeRecipeHome } from './recipe-entries.js'
import { defaultRecipeTemplates, listRecipeTemplates, recipeTemplateContribution, recipeTemplateStore } from './recipe-pool.js'
import { recipeSettingContribution } from './recipe-setting-pool.js'
import { RECIPE_KIND, RECIPE_OPEN_FOR_TILE, RECIPE_SLOT, RECIPE_VIEW } from './recipe-slot.js'
import { recipeTemplateBytes } from './recipe-template.js'
import { recipeViewTarget } from './recipe-view-state.js'

const QUEEN_KEY = '@diamondcoreprocessor.com/RecipeQueenBee'
/** The words after `recipe`. None is a behaviour word of its own. */
const WORDS = ['posts'] as const

type ViewModeShape = { mode?: string }
type LineageShape = { explorerSegments?: () => readonly string[] }
type SelectionShape = { selected?: Iterable<string> }

const live = <T>(key: string): T | undefined => {
  try { return get<T>(key) } catch { return undefined }
}

const t = (key: string, fallback: string, params?: Record<string, string | number>): string => {
  let said: string | undefined
  try { said = live<I18nProvider>(I18N_IOC_KEY)?.t(key, params) } catch { said = undefined }
  const text = said && said !== key ? said : fallback
  return params ? text.replace(/\{(\w+)\}/g, (hole, name: string) => name in params ? String(params[name]) : hole) : text
}

export class RecipeQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'recipe'
  override description = 'Open the recipe on a tile: write it, arrange its layout, or read along while you cook'
  override descriptionKey = 'slash.recipe'
  override options = [...WORDS]
  override examples = [
    { input: '/recipe', result: 'Opens the recipe of the one selected tile, or of the tile you are standing in' },
    { input: '/recipe posts', result: 'Opens "Open for posts" in pools mode: a code phones can post recipes to' },
  ]

  override slashComplete(args: string): readonly string[] {
    const typed = args.trim().toLowerCase()
    return WORDS.filter(word => word.startsWith(typed) && word !== typed)
  }

  protected execute(args = ''): void {
    const word = String(args ?? '').trim().toLowerCase()
    if (word === 'posts') {
      // Pools mode first, so the bar the form belongs to is up; the bar opens the form.
      EffectBus.emitTransient(LIGHTS_ENTER, {})
      EffectBus.emitTransient(ENTRY_POSTS_WANTED, {})
      return
    }

    const here = (live<LineageShape>('@hypercomb.social/Lineage')?.explorerSegments?.() ?? [])
      .map(part => String(part ?? '').trim()).filter(Boolean)
    const selected = live<SelectionShape>('@diamondcoreprocessor.com/SelectionService')?.selected ?? []
    const segments = recipeViewTarget(selected, here)
    if (!segments.length) {
      EffectBus.emit('activity:log', {
        message: t('recipe.word.root', 'Select a tile or step into one first: a recipe lives on a tile.'),
        icon: 'menu_book',
      })
      return
    }

    const at = Date.now()
    const mode = String(live<ViewModeShape>('@hypercomb.social/ViewMode')?.mode ?? '').trim()
    // Where the cook stood and what was up, said before the view takes over.
    // Not said again from inside the view: the way back stays the first one.
    if (mode !== RECIPE_VIEW) {
      const spawn: ViewSpawn & { at: number } = { view: RECIPE_VIEW, mode, segments: here, at }
      EffectBus.emit(VIEW_SPAWN_EFFECT, spawn)
    }
    EffectBus.emit(RECIPE_OPEN_FOR_TILE, { view: RECIPE_VIEW, segments, at })
  }
}

// THE VIEW MUST NOT ARRIVE DARK on a hive that already has an on-list: lit once
// as a cohort, as the lounge is, and refused on a hive that opened dark. Only
// once the on-list exists: recording the cohort before that would light nothing.
const RECIPE_COHORT = 'recipe'
const lightRecipeOnce = (): void => {
  if (!readGlobalOnKinds()) return
  seedCohortOn(RECIPE_COHORT, [RECIPE_KIND])
}
lightRecipeOnce()
EffectBus.on(ENABLEMENT_CHANGED, lightRecipeOnce)

// What a lit recipe tile leaves in the pools when its cook publishes: the
// layout it is written into, and the tile itself as a row.
registerPoolContribution(recipeTemplateContribution())
registerPoolContribution(recipeSettingContribution())
registerPoolContribution(recipeEntryContribution())

// ── what a pool opened for posts asks a phone to fill ──────────────────────

/** The templates a leader may open a pool for: the three every hive starts with, then the ones this hive keeps, each by its own bytes. */
async function postTemplates(): Promise<readonly EntryFormTemplate[]> {
  const out: EntryFormTemplate[] = []
  for (const held of await defaultRecipeTemplates().catch(() => [])) {
    out.push({ sig: held.sig, name: held.template.name, bytes: recipeTemplateBytes(held.template) })
  }
  const store = recipeTemplateStore()
  const kept = await listRecipeTemplates(store).catch(() => ({ entries: [] }))
  for (const entry of kept.entries) {
    if (!entry.ok || out.some(one => one.sig === entry.sig)) continue
    // A kept template is sent as it was kept: spelled again it would be another signature.
    const blob = await store?.getResourceLocal?.(entry.sig).catch(() => null)
    if (blob) out.push({ sig: entry.sig, name: entry.template.name, bytes: new Uint8Array(await blob.arrayBuffer()) })
  }
  return out
}

type HeldStore = { getResourceLocal?(sig: string): Promise<Blob | null> }

/** Does this hive already hold a recipe's words, by their signature? The leader's count of what is not home asks
 *  the same question (pools/open-entries-leader.ts entriesNotHome). Never asks a host. */
const holdsRecipeBytes = async (sig: string): Promise<boolean> => {
  try { return !!(await live<HeldStore>('@hypercomb.social/Store')?.getResourceLocal?.(sig)) } catch { return false }
}

/**
 * Bring posted recipes home: each opened from its own bytes and kept as a tile
 * on the page the leader stands on. An entry whose recipe this hive already
 * holds (the hash of its words, as the count of what is not home tests it) is
 * home already and is skipped: bringing it again would make a second tile of it
 * under a numbered name.
 */
async function bringPosted(rows: readonly EntryRow[], source: { pool: string; page: string; template: string }): Promise<{ brought: number; reason?: string }> {
  if (readOnlyShell()) return { brought: 0, reason: t('recipe.entry.take.readonly', 'This visitor hive cannot keep a recipe.') }
  const here = (live<LineageShape>('@hypercomb.social/Lineage')?.explorerSegments?.() ?? [])
    .map(part => String(part ?? '').trim()).filter(Boolean)
  const offers = await postedRecipeOffers(rows, { pool: source.pool, host: source.page, template: source.template })
  let brought = 0
  let reason: string | undefined
  for (const offer of offers) {
    if (await holdsRecipeBytes(offer.entry.recipe)) continue
    const opened = await openRecipeEntry(offer)
    const taken = opened.ok ? await takeRecipeHome(offer, opened, here) : opened
    if (taken.ok) brought++
    else reason ??= taken.reason
  }
  return { brought, ...(reason ? { reason } : {}) }
}

registerEntryForm({ meaning: RECIPE_ENTRY_MEANING, templates: postTemplates, bring: bringPosted })

// ── a tile unlit in a room: its recipe is taken back ────────────────────────
//
// A lit recipe is an entry on the room's host, kept there whether or not its
// cook is online (pools/room-entries.ts). So a tile that goes dark takes its
// entry back wherever the light was turned off: on the grid, with the desk
// closed, with another tile on the desk, after a reload. THE TAKE-BACK OF AN
// UNLIT TILE IS THIS FILE'S AND NOBODY ELSE'S: the desk sleeps until its view
// is asked for and sends none of its own (recipe-view.drone.ts), so the host
// is written to once.
//
// Nothing is remembered. The marks say what is lit now, and a tile's own layer
// says whether it holds a recipe; an entry that was never shared is taken back
// all the same, which costs one member that says gone. Outside a room nothing
// is read: the membership is asked first. A shell that only reads takes
// nothing back. A tile a lit branch still covers is left alone.

/** Tiles looked at under one tile whose light changed, at most. */
const UNLIT_ROUTES_MAX = 200
/** Their layers, read at once. */
const UNLIT_READS_AT_ONCE = 8
const HISTORY_KEY = '@diamondcoreprocessor.com/HistoryService'

type LightsChange = { cell?: unknown; location?: unknown; public?: unknown; branch?: unknown }
type HistoryShape = {
  sign(lineage: { explorerSegments?: () => readonly string[] }): Promise<string>
  currentLayerAt(locationSig: string): Promise<Record<string, unknown> | null>
}

/** A shell that only reads: a published site's visitor, or a hive opened read-only. */
const readOnlyShell = (): boolean =>
  isPublishedVisitorShell() || (globalThis as { __HC_READONLY__?: boolean }).__HC_READONLY__ === true

/** The room this tab is joined to and the host that keeps its entries, as one key. '' outside a room. Never the secret. */
const roomPlace = (): string => {
  const standing = roomStanding()
  return standing.joined ? `${standing.room}\u0000${standing.host}` : ''
}

/** A route's page and name as the public marks address them (presentation/tiles/tile-public.ts). */
const placeOf = (route: readonly string[]): { location: string; label: string } =>
  ({ location: `/${route.slice(0, -1).join('/')}`, label: route[route.length - 1] ?? '' })

/** True when the tile at a route is lit: marked on its own, or covered by a lit branch. */
const litAt = (route: readonly string[]): boolean => {
  const { location, label } = placeOf(route)
  try { return isCellPublic(location, label) } catch { return false }
}

/** True when a lit branch is rooted at the tile or above it: everything under it is lit. */
const underLitBranch = (route: readonly string[]): boolean => {
  const { location, label } = placeOf(route)
  const path = tilePath(location, label)
  return readPublicBranches().some(branch => path === branch || path.startsWith(`${branch}/`))
}

/** True when the tile at a route holds a recipe. Its own layer's slot says: no document is read, and no host is asked. */
const holdsRecipe = async (route: readonly string[]): Promise<boolean> => {
  try {
    const history = live<HistoryShape>(HISTORY_KEY)
    if (!history) return false
    const slot = (await history.currentLayerAt(await history.sign({ explorerSegments: () => route })))?.[RECIPE_SLOT]
    return Array.isArray(slot) && slot.length > 0
  } catch { return false }
}

/**
 * Take back, from the room `where` names, the recipe of every tile one change
 * of lights left dark: the tile named, and everything under it unless only its
 * own mark went off. `public` does not decide that: a branch narrowed to its
 * own tile is announced as public while everything under it goes dark.
 */
async function takeBackUnlit(root: string[], change: LightsChange, where: string): Promise<void> {
  const ownMarkOnly = change.public === false && change.branch !== true
  const changed = ownMarkOnly
    ? [root]
    : await litTileRoutes([{ segments: root, branch: true }], liveChildrenOf(), UNLIT_ROUTES_MAX)
  const dark = changed.filter(route => !litAt(route))
  const holds = await mapBounded(dark, UNLIT_READS_AT_ONCE, holdsRecipe)
  for (const [at, route] of dark.entries()) {
    if (!holds[at]) continue
    // The tab left the room while the tiles were being read: nothing of it is owed anywhere else.
    if (roomPlace() !== where) return
    // Lit again since: its entry stands.
    if (litAt(route)) continue
    const said = await retractRecipeFromRoom(route)
    if (said.ok) continue
    // A host that keeps nothing for this key holds no entry to take back. Any other refusal is
    // said, and the tiles after it are not sent to a host that just refused one.
    if (!said.live) {
      EffectBus.emit('activity:log', {
        message: t('recipe.shared.retract-failed', 'Could not take the recipe back from the room: {reason}', { reason: said.reason }),
        icon: 'menu_book',
      })
    }
    return
  }
}

/** One change of lights at a time, in the order they were made. */
let takingBack: Promise<void> = Promise.resolve()

// The bus hands a new listener the last change made before it listened. That
// is not a light going off now, so loading this file does no work.
let replaying = true
EffectBus.on<LightsChange>(LIGHTS_CHANGED, change => {
  if (replaying) return
  try {
    if (readOnlyShell()) return
    const where = roomPlace()
    if (!where) return
    const cell = typeof change?.cell === 'string' ? change.cell.trim() : ''
    if (!cell || typeof change.location !== 'string') return
    const root = [...change.location.split('/').map(part => part.trim()).filter(Boolean), cell]
    if (underLitBranch(root)) return
    takingBack = takingBack.then(() => takeBackUnlit(root, change, where)).catch(() => undefined)
  } catch { /* a change that could not be read takes nothing back, and breaks nothing */ }
})
replaying = false

window.ioc.register(QUEEN_KEY, new RecipeQueenBee())

window.ioc.whenReady<VisualBeeRegistry>('@diamondcoreprocessor.com/VisualBeeRegistry', registry => registry.register({
  view: RECIPE_VIEW,
  slashCommand: '/recipe',
  iconName: 'menu_book',
  toggleIcon: 'menu_book',
  behavior: 'render',
  // One tile, one recipe: the toggle shows on the tile that holds it and nowhere else.
  scope: 'node',
  // The slot is what lights the toggle: a recipe written here shows its
  // button whether or not the decoration landed.
  slot: RECIPE_SLOT,
  decorationKind: RECIPE_KIND,
  labelKey: 'view.recipe',
  descriptionKey: 'view.recipe.description',
  queenKey: QUEEN_KEY,
  // The tile's icon opens the recipe from where the cook stands: closing it
  // puts them back on the grid they were reading.
  opensOnTileClick: true,
  // Marking a tile is the whole install: the view opens an empty recipe to
  // write into, so `name@recipe` needs nothing authored first.
  attachable: true,
  adoptable: true,
  pheromones: ['platform:desktop', 'platform:mobile'],
}))
