// recipe/recipe-store.ts
//
// A RECIPE ON A TILE: how one is read, and how one is saved. The recipe is a
// document of its own (recipe-template.ts), held once under its signature at
// the content root (S2, A6); the tile's layer names it in the `recipe` slot,
// newest last (L1, I2). Saving is ordinary hive content, the path the document
// view takes (document/document-view.drone.ts): new bytes, a new signature, a
// new layer, and therefore a history entry and an undo (H2). Nothing is
// rewritten, and a recipe that did not change commits nothing.
//
// Nothing is stored that would not read back: a document is written to its
// canonical bytes and parsed again before any byte is kept, and the store must
// answer the signature those bytes hash to (S3). A read never throws: a tile
// with no recipe is an answer, and a recipe that does not read is an answer
// with its reason. A tile whose layer is known but not readable yet (its bytes
// still landing) is the second kind, never the first: it is not shown as empty
// and nothing is offered or withdrawn on its word. A save is believed only
// when the tile reads back as the recipe that was saved.
//
// A picture is a signature the recipe names (I2). Every picture kept here is
// re-encoded first (editor/arm-resource.ts), which is also what takes a photo's
// place and time out of it, because a lit recipe is offered to whoever follows
// its cook. Showing one never makes this browser contact another host (T7).
//
// Every service is reached through an injectable `deps` object whose live
// defaults come from IoC. Nothing registers here.

import { I18N_IOC_KEY, RESOURCE_URL_PREFIX, get, type I18nProvider } from '@hypercomb/core'
import { replaceDecoration } from '../commands/decoration-manifest.js'
import { largeImage } from '../editor/arm-resource.js'
import { RECIPE_KIND, RECIPE_SLOT } from './recipe-slot.js'
import {
  RECIPE_LIMITS,
  parseRecipe,
  parseRecipeTemplate,
  recipeBytes,
  type Recipe,
  type RecipeDocument,
  type RecipeTemplate,
} from './recipe-template.js'

const HISTORY_KEY = '@diamondcoreprocessor.com/HistoryService'
const COMMITTER_KEY = '@diamondcoreprocessor.com/LayerCommitter'
const STORE_KEY = '@hypercomb.social/Store'
const SIG = /^[a-f0-9]{64}$/

/** What reading and saving do their work with. Every part optional: the hive's own stands in for any left out. */
export interface RecipeStoreDeps {
  /** Where a route's current layer is read. */
  history?: {
    sign(lineage: { explorerSegments?: () => readonly string[] }): Promise<string>
    /** `stats.cold` set beside a null: the layer could not be read just now, which is not a tile with no layer. */
    currentLayerAt(locationSig: string, stats?: { cold?: boolean }): Promise<Record<string, unknown> | null>
  }
  /** The one write surface of a layer. */
  committer?: {
    update(segments: readonly string[], layer: { name?: string; [slot: string]: unknown }): Promise<unknown>
  }
  /** The content store: bytes by signature. */
  store?: {
    getResource?(sig: string): Promise<Blob | null>
    putResource?(blob: Blob): Promise<string>
  }
  /** Put the recipe decoration on a tile, so the view's mark lights on it. */
  decorate?: (segments: readonly string[]) => Promise<unknown>
  /** The re-encoded copy of a picture. Answers the blob as it came when it could not make one. */
  large?: (blob: Blob) => Promise<{ blob: Blob }>
}

/** What a tile holds: its name, and its recipe when it has one that reads. */
export interface RecipeAtTile {
  readonly name: string
  readonly recipe: Recipe | null
  /** Why a recipe the tile names could not be shown. Absent when the tile simply has none. */
  readonly reason?: string
  /** The tile itself could not be read, so whether it holds a recipe is not known. Never set for a tile that has none. */
  readonly unread?: true
}

export type RecipeSaved =
  | { readonly ok: true; readonly sig: string; readonly changed: boolean }
  | { readonly ok: false; readonly reason: string }

const t = (key: string, fallback: string, params?: Record<string, string | number>): string => {
  let said: string | undefined
  try { said = get<I18nProvider>(I18N_IOC_KEY)?.t(key, params) } catch { said = undefined }
  const text = said && said !== key ? said : fallback
  return params ? text.replace(/\{(\w+)\}/g, (hole, name: string) => name in params ? String(params[name]) : hole) : text
}

const live = <T>(key: string): T | undefined => {
  try { return get<T>(key) } catch { return undefined }
}

const historyOf = (deps: RecipeStoreDeps): RecipeStoreDeps['history'] => deps.history ?? live<NonNullable<RecipeStoreDeps['history']>>(HISTORY_KEY)
const committerOf = (deps: RecipeStoreDeps): RecipeStoreDeps['committer'] => deps.committer ?? live<NonNullable<RecipeStoreDeps['committer']>>(COMMITTER_KEY)
const storeOf = (deps: RecipeStoreDeps): RecipeStoreDeps['store'] => deps.store ?? live<NonNullable<RecipeStoreDeps['store']>>(STORE_KEY)

/**
 * The route as given, or null when it names no tile. A route with an empty
 * name in it is refused whole, never mended: dropping the name would read or
 * save on another tile.
 */
const routeOf = (segments: readonly string[]): string[] | null =>
  Array.isArray(segments) && segments.length && segments.every(part => typeof part === 'string' && part.trim())
    ? [...segments]
    : null

/** The current layer at a route. Null where there is none; throws where it could not be asked. */
async function layerAt(route: readonly string[], deps: RecipeStoreDeps): Promise<Record<string, unknown> | null> {
  const history = historyOf(deps)
  if (!history) throw new Error('no history')
  const stats: { cold?: boolean } = {}
  const layer = await history.currentLayerAt(await history.sign({ explorerSegments: () => route }), stats)
  // A head that is known but not readable yet is not a tile with no layer: it could not be asked.
  if (!layer && stats.cold) throw new Error('cold')
  return layer
}

/** What the tile is called: its layer's name, else the last name of its route. */
const nameOf = (layer: Record<string, unknown> | null, route: readonly string[]): string => {
  const named = layer?.['name']
  return typeof named === 'string' && named.trim() ? named : route[route.length - 1] ?? ''
}

/**
 * What the slot names now: its newest signature. Older ones are its history.
 *
 * THIS IS A REFERENCE, NOT THE RECIPE'S OWN SIGNATURE. A layer never holds an
 * artifact directly: the committer wraps what it is handed in a meta envelope
 * { meta: 1, resource: <recipe>, relation: 'recipe' } and the slot holds the
 * envelope's signature (L2, the life primitive). The store's `getResource`
 * follows that one hop, so the bytes read through it are the recipe's; the
 * recipe's own signature is the hash of those bytes, never this reference.
 */
const newestRecipeSig = (layer: Record<string, unknown> | null): string | null => {
  const slot = layer?.[RECIPE_SLOT]
  if (!Array.isArray(slot)) return null
  for (let i = slot.length - 1; i >= 0; i--) {
    const sig = String(slot[i] ?? '')
    if (SIG.test(sig)) return sig
  }
  return null
}

/** The bytes held under a signature, never read whole when they are larger than `limit`. */
async function bytesOf(deps: RecipeStoreDeps, sig: string, limit: number): Promise<{ bytes: Uint8Array } | { reason: string }> {
  let blob: Blob | null = null
  try { blob = await storeOf(deps)?.getResource?.(sig) ?? null } catch { blob = null }
  if (!blob) return { reason: t('recipe.reason.notHeld', 'its bytes are not held here') }
  if (blob.size > limit) return { reason: t('recipe.reason.tooLarge', 'it is larger than {kb} KB', { kb: limit / 1024 }) }
  try { return { bytes: new Uint8Array(await blob.arrayBuffer()) } } catch {
    return { reason: t('recipe.reason.unreadBytes', 'its bytes could not be read') }
  }
}

/** The answer for a tile that could not be read: a reason, and the mark that says it is not a tile with no recipe. */
const unreadTile = (name: string): RecipeAtTile =>
  ({ name, recipe: null, reason: t('recipe.reason.unreadTile', 'the tile could not be read'), unread: true })

/**
 * The recipe on the tile at `segments`: the newest signature of its layer's
 * `recipe` slot, read back through the strict reader under that signature. A
 * tile with no recipe answers `recipe: null` and no reason; one whose recipe
 * does not read answers the reason, and one whose layer could not be read
 * answers `unread` beside it. Never throws.
 */
export async function loadRecipeAt(segments: readonly string[], deps: RecipeStoreDeps = {}): Promise<RecipeAtTile> {
  const route = routeOf(segments)
  if (!route) return { name: '', recipe: null, reason: t('recipe.reason.noTile', 'no tile is named') }
  const fallback = route[route.length - 1] ?? ''
  try {
    let layer: Record<string, unknown> | null
    try { layer = await layerAt(route, deps) } catch { return unreadTile(fallback) }
    const name = nameOf(layer, route)
    const sig = newestRecipeSig(layer)
    if (!sig) return { name, recipe: null }
    const held = await bytesOf(deps, sig, RECIPE_LIMITS.recipeBytes)
    if ('reason' in held) return { name, recipe: null, reason: held.reason }
    // Read by what the bytes are, not by the slot's reference (see newestRecipeSig):
    // the recipe answers with its own signature.
    const parsed = await parseRecipe(held.bytes)
    return parsed.ok ? { name, recipe: parsed.recipe } : { name, recipe: null, reason: parsed.reason }
  } catch { return unreadTile(fallback) }
}

// One save at a time, each reading the layer the one before it wrote, so two
// saves finishing together never commit the same recipe twice.
let saving: Promise<unknown> = Promise.resolve()
const inTurn = <T>(act: () => Promise<T>): Promise<T> => {
  const next = saving.then(act, act)
  saving = next.catch(() => undefined)
  return next
}

/** The decoration a tile with a recipe wears: no payload, the kind is the whole statement. */
const liveDecorate = (segments: readonly string[]): Promise<unknown> =>
  replaceDecoration({ kind: RECIPE_KIND, appliesTo: segments, segments, payload: {}, mark: 'persistent' })

/**
 * Save `doc` as the recipe of the tile at `segments`. Its canonical bytes must
 * read back as a recipe before anything is written; they become a resource,
 * and the tile's layer is committed with the slot naming it. A recipe that is
 * already the tile's current one commits nothing (`changed: false`). A commit
 * that left the tile holding another recipe, or none, is not a save and says
 * so. The first recipe on a tile also puts the recipe decoration on it. Never
 * throws.
 */
export function saveRecipeAt(segments: readonly string[], doc: RecipeDocument, deps: RecipeStoreDeps = {}): Promise<RecipeSaved> {
  return inTurn(async (): Promise<RecipeSaved> => {
    try {
      const route = routeOf(segments)
      if (!route) return { ok: false, reason: t('recipe.reason.noTile', 'no tile is named') }
      let bytes: Uint8Array
      try { bytes = recipeBytes(doc) } catch { return { ok: false, reason: t('recipe.reason.notRecipe', 'it is not a recipe') } }
      // Never store what would not read: the tile shows only what opens again.
      const parsed = await parseRecipe(bytes)
      if (!parsed.ok) return { ok: false, reason: parsed.reason }

      const store = storeOf(deps)
      const committer = committerOf(deps)
      if (!store?.putResource || !committer?.update) return { ok: false, reason: t('recipe.reason.notReady', 'the hive is not ready to save here yet') }

      const written = await store.putResource(new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'application/json' })).catch(() => '')
      // The store signs what it wrote; a different answer is not this recipe (S3).
      if (written !== parsed.sig) return { ok: false, reason: t('recipe.reason.notKept', 'the store did not keep the bytes it was given') }

      // A layer that cannot be read yet is saved over as the document view does: by the tile's route name.
      const layer = await layerAt(route, deps).catch(() => null)
      const current = newestRecipeSig(layer)
      // Unchanged means the recipe the slot already leads to is this one. The
      // slot's own signature is a reference and never equals a recipe's.
      if (current) {
        const held = await bytesOf(deps, current, RECIPE_LIMITS.recipeBytes)
        const before = 'bytes' in held ? await parseRecipe(held.bytes) : null
        if (before?.ok && before.sig === parsed.sig) return { ok: true, sig: parsed.sig, changed: false }
      }

      // The slot holds the current recipe. Earlier ones stay reachable through history, where versions belong.
      await committer.update(route, { name: nameOf(layer, route), [RECIPE_SLOT]: [parsed.sig] })
      // The committer says nothing when it did not write (a hive viewing its past, a preview up), so
      // the tile is read back: through the slot's reference to the recipe, compared by the recipe's own signature.
      const landed = newestRecipeSig(await layerAt(route, deps).catch(() => null))
      const kept = landed ? await bytesOf(deps, landed, RECIPE_LIMITS.recipeBytes) : null
      const after = kept && 'bytes' in kept ? await parseRecipe(kept.bytes) : null
      if (!after?.ok || after.sig !== parsed.sig) {
        return { ok: false, reason: t('recipe.reason.notWritten', 'the hive is not taking writes right now: step forward to now, or close the preview') }
      }
      if (!current) {
        // The recipe is saved whether or not the mark lands: the slot is what opens it.
        try { await (deps.decorate ?? liveDecorate)(route) } catch { /* saved without its mark */ }
      }
      return { ok: true, sig: parsed.sig, changed: true }
    } catch {
      return { ok: false, reason: t('recipe.reason.saveFailed', 'the recipe could not be saved') }
    }
  })
}

/**
 * The template the tile's recipe names, when its bytes are held and read as a
 * template under that signature. Null for a tile with no recipe, a recipe
 * that names none, or a template that is not here. Never throws.
 */
export async function recipeTemplateAt(segments: readonly string[], deps: RecipeStoreDeps = {}): Promise<{ sig: string; template: RecipeTemplate } | null> {
  try {
    const { recipe } = await loadRecipeAt(segments, deps)
    if (!recipe?.template) return null
    const held = await bytesOf(deps, recipe.template, RECIPE_LIMITS.templateBytes)
    if ('reason' in held) return null
    const parsed = await parseRecipeTemplate(held.bytes, recipe.template)
    return parsed.ok ? { sig: parsed.sig, template: parsed.template } : null
  } catch { return null }
}

// ── pictures ────────────────────────────────────────────────────────────────

const isPicture = (blob: unknown): blob is Blob =>
  !!blob && typeof (blob as Blob).size === 'number' && /^image\//i.test(String((blob as Blob).type ?? ''))

/**
 * Keep pictures for a recipe and answer their signatures, in the order given,
 * once each, at most RECIPE_LIMITS.pictures. Each is re-encoded before it is
 * kept, so what a camera wrote into the file does not travel with the recipe.
 * Skipped, never thrown: anything that is not a picture, a picture this
 * browser could not re-encode (only a GIF is kept as it came, because drawing
 * it would stop it moving and a GIF carries no camera data), and one the
 * store did not keep.
 */
export async function storeRecipePictures(blobs: readonly Blob[], deps: RecipeStoreDeps = {}): Promise<string[]> {
  const out: string[] = []
  const store = storeOf(deps)
  if (!store?.putResource) return out
  const large = deps.large ?? largeImage
  for (const blob of Array.isArray(blobs) ? blobs : []) {
    if (out.length >= RECIPE_LIMITS.pictures) break
    if (!isPicture(blob)) continue
    try {
      const copy = await large(blob)
      if (!isPicture(copy.blob) || !copy.blob.size) continue
      if (copy.blob === blob && !/^image\/gif$/i.test(blob.type)) continue
      const sig = await store.putResource(copy.blob)
      if (SIG.test(sig) && !out.includes(sig)) out.push(sig)
    } catch { /* this one is skipped; the rest are still kept */ }
  }
  return out
}

/** Where a picture is shown from: this hive's own resource path, never another host. Empty for anything but a signature. */
export function recipePictureUrl(sig: string): string {
  return typeof sig === 'string' && SIG.test(sig) ? RESOURCE_URL_PREFIX + sig : ''
}

/**
 * The pictures on the clipboard, one per copied item (an item's types are
 * spellings of one picture, so its first picture type is taken), at most
 * RECIPE_LIMITS.pictures. Must be called inside the participant's own gesture.
 * Empty where the browser has no clipboard to read, or the read was refused.
 */
export async function recipeClipboardPictures(): Promise<Blob[]> {
  const out: Blob[] = []
  try {
    const clipboard = navigator.clipboard
    if (!clipboard?.read) return out
    for (const item of await clipboard.read()) {
      if (out.length >= RECIPE_LIMITS.pictures) break
      const mime = item.types.find(type => type.startsWith('image/'))
      if (!mime) continue
      try { out.push(await item.getType(mime)) } catch { /* this item would not give its picture */ }
    }
  } catch { /* refused, empty, or a clipboard this browser will not read */ }
  return out
}
