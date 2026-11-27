// recipe/recipe-setting-pool.ts
//
// THE TABLE SETS A HIVE KEEPS, THE ONE ITS DESK SITS ON, AND THE ONES ITS
// COMMUNITY OFFERS. A set is one artifact (recipe-setting.ts) naming its
// layer pictures by signature; the set and every picture are resources at the
// content root, held once (S2, A6). The pool `recipe:setting` says which sets
// the leader keeps (P1): membership, never the set's truth (P6), in the same
// one list document templates are kept in (recipe-pool.ts,
// pools/offered-pool.ts), written as a participant's save so every list
// before it is kept (H2). Taking a set off the list hides it (H4).
//
// WHICH SET THE DESK SITS ON is the leader's own choice for this hive, one
// current document in `recipe:desk`, written through the store and never to
// raw storage. No choice, or a set whose pictures are not here, is the drawn
// plate.
//
// ── A SET TRAVELS WITH ITS PICTURES ─────────────────────────────────────────
//
// A set without its layers is a set with no pictures, so wherever a set goes
// the atoms it names go with it. Publishing leaves a lit hive's kept sets in
// the pool with every layer as the contribution's closure (pools/
// pool-contributions.ts sends a closure before the members that name it). A
// reader's finder fetches only the set documents; keeping one fetches each
// layer from the host that offered it, verified against its signature, and
// only then is the set kept. Nothing arrives uninvited (T4, T5).
//
// ── BRINGING A RENDER IN ────────────────────────────────────────────────────
//
// tableware/setting.py writes a folder: setting.json and the layer pictures it
// names. The leader chooses or drops them; every named picture must be there,
// be a PNG or a WebP, and be no larger than one layer may be. Everything is
// checked before anything is written, so a refusal leaves nothing behind.
//
// Nothing here throws: a refusal is one plain sentence. Nothing registers here.

import { I18N_IOC_KEY, get, type I18nProvider } from '@hypercomb/core'
import { readBodyCapped } from '../pools/bounded-body.js'
import { OFFERED_MAX_MEMBERS, offeredListBytes, offeredMembersOf, readOfferedPools, type OfferedReadIo } from '../pools/offered-pool.js'
import type { PoolContribution } from '../pools/pool-contributions.js'
import { fetchWithDeadline, mapBounded } from '../sharing/bounded-fetch.js'
import { originOf, zoneDoor } from '../sharing/zone-door.js'
import { loadRecipeAt, type RecipeStoreDeps } from './recipe-store.js'
import {
  RECIPE_SETTING_LIMITS,
  parseRecipeSetting,
  recipeSettingBytes,
  recipeSettingRefusalWords,
  recipeSettingRender,
  recipeSettingSignatures,
  type RecipeSetting,
  type RecipeSettingRefusal,
} from './recipe-setting.js'

/** The pool of kept sets. Its address is derived by the store, never spelled here. */
export const RECIPE_SETTING_MEANING = 'recipe:setting'
/** The one current document saying which set the desk sits on. */
export const RECIPE_DESK_MEANING = 'recipe:desk'
/** As many as one host offers per meaning, so a kept list is always a list a host could offer whole. */
export const RECIPE_SETTINGS_MAX = OFFERED_MAX_MEMBERS

const STORE_KEY = '@hypercomb.social/Store'
const SIG = /^[a-f0-9]{64}$/
/** The setting.json a render writes is a few KB; anything this large is not one. */
const RENDER_JSON_BYTES = 64 * 1024
/** The atoms one publish may carry beside its members (pools/offered-pool.ts): the sets offered stop short of it. */
const CLOSURE_MAX = 512
const ROUTES_AT_ONCE = 8
const HOST_TIMEOUT_MS = 12_000

/** The store, as far as this module uses it. Every method optional: an older store, or none, is an answer. */
export interface RecipeSettingStore {
  getPool?(meaning: string): Promise<object | null>
  openPool?(meaning: string): Promise<object | null>
  getPoolDoc?(pool: object, subKey?: string): Promise<ArrayBuffer | null>
  putPoolDoc?(pool: object, bytes: ArrayBuffer, subKey?: string, options?: { keep?: 'versions' | 'current' }): Promise<string | null>
  putResource?(blob: Blob, options?: { emit?: boolean }): Promise<string>
  /** Bytes this device holds. Never asks a host. */
  getResourceLocal?(signature: string): Promise<Blob | null>
}

/** The hive's store, through IoC. Undefined where there is none. */
export const recipeSettingStore = (): RecipeSettingStore | undefined => {
  try { return get<RecipeSettingStore>(STORE_KEY) } catch { return undefined }
}

const t = (key: string, fallback: string, params?: Record<string, string | number>): string => {
  let said: string | undefined
  try { said = get<I18nProvider>(I18N_IOC_KEY)?.t(key, params) } catch { said = undefined }
  const text = said && said !== key ? said : fallback
  return params ? text.replace(/\{(\w+)\}/g, (hole, name: string) => name in params ? String(params[name]) : hole) : text
}

/** Why the reader refused a set, in the participant's language. */
const refused = (refusal: RecipeSettingRefusal): string => recipeSettingRefusalWords(refusal, t)

const noStore = (): string => t('recipe.reason.noStore', 'the store is not available here')
const notSignature = (): string => t('recipe.reason.notSignature', 'not a signature')

const exact = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer

const sha256Hex = async (bytes: Uint8Array): Promise<string> =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', exact(bytes))), b => b.toString(16).padStart(2, '0')).join('')

/** A blob's bytes. A FileReader stands in where a blob has no `arrayBuffer` (an older engine, a test document). */
const blobBytes = async (blob: Blob): Promise<Uint8Array> => {
  if (typeof blob.arrayBuffer === 'function') return new Uint8Array(await blob.arrayBuffer())
  return await new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
    reader.readAsArrayBuffer(blob)
  })
}

/** What a layer is by its first bytes, never by what its name or a header claims: a PNG, a WebP, or nothing. */
export function recipeSettingPictureType(bytes: Uint8Array): 'image/png' | 'image/webp' | null {
  const at = (i: number): number => bytes[i] ?? -1
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (png.every((byte, i) => at(i) === byte)) return 'image/png'
  const ascii = (from: number, to: number): string => String.fromCharCode(...Array.from(bytes.subarray(from, to)))
  if (bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp'
  return null
}

// ── one set, read from this device ──────────────────────────────────────────

export type RecipeSettingEntry =
  | { readonly sig: string; readonly ok: true; readonly setting: RecipeSetting }
  | { readonly sig: string; readonly ok: false; readonly reason: string }

/** One set read from this device's heap, by its signature. Never asks a host, never throws. */
export async function readRecipeSetting(store: RecipeSettingStore | undefined, sig: string): Promise<RecipeSettingEntry> {
  if (typeof sig !== 'string' || !SIG.test(sig)) return { sig: String(sig ?? ''), ok: false, reason: notSignature() }
  let blob: Blob | null = null
  try { blob = await store?.getResourceLocal?.(sig) ?? null } catch { blob = null }
  if (!blob) return { sig, ok: false, reason: t('recipe.reason.notHeld', 'its bytes are not held here') }
  // Size first, so a member that is not a set is never read whole.
  if (blob.size > RECIPE_SETTING_LIMITS.bytes) {
    return { sig, ok: false, reason: t('recipe.reason.tooLarge', 'it is larger than {kb} KB', { kb: RECIPE_SETTING_LIMITS.bytes / 1024 }) }
  }
  let bytes: Uint8Array
  try { bytes = await blobBytes(blob) } catch { return { sig, ok: false, reason: t('recipe.reason.unreadBytes', 'its bytes could not be read') } }
  const parsed = await parseRecipeSetting(bytes, sig)
  return parsed.ok ? { sig, ok: true, setting: parsed.setting } : { sig, ok: false, reason: refused(parsed.refusal) }
}

/** True when this device holds every picture a set names: a set is shown only whole. Never asks a host, never throws. */
export async function recipeSettingHeld(store: RecipeSettingStore | undefined, setting: Pick<RecipeSetting, 'table' | 'utensils' | 'plates'>): Promise<boolean> {
  try {
    if (!store?.getResourceLocal) return false
    for (const sig of recipeSettingSignatures(setting)) {
      if (!await store.getResourceLocal(sig).catch(() => null)) return false
    }
    return true
  } catch { return false }
}

// ── the kept list ───────────────────────────────────────────────────────────

export interface RecipeSettingListing {
  /** Members in the order they were kept, each read back or refused with its reason. */
  readonly entries: readonly RecipeSettingEntry[]
  readonly problem?: 'no-store' | 'unreadable'
}

/** Whether the pool holds a document at all, so a read that came back empty is a failed read and not an empty list. */
async function holdsDocument(pool: object): Promise<boolean> {
  const keys = (pool as { keys?(): AsyncIterable<string> }).keys
  if (typeof keys !== 'function') return false
  try {
    for await (const name of keys.call(pool)) if (SIG.test(name)) return true
  } catch { return true }
  return false
}

/** The list as it stands. `null` means a list is there and does not read. */
async function readList(store: RecipeSettingStore, pool: object): Promise<string[] | null> {
  const bytes = await store.getPoolDoc?.(pool).catch(() => null) ?? null
  if (bytes) return offeredMembersOf(new Uint8Array(bytes), RECIPE_SETTING_MEANING)
  return await holdsDocument(pool) ? null : []
}

/** The sets this hive keeps, each read back by its signature. Reads only this device: no pool is created. Never throws. */
export async function listRecipeSettings(store: RecipeSettingStore | undefined = recipeSettingStore()): Promise<RecipeSettingListing> {
  try {
    if (!store?.openPool || !store.getPoolDoc) return { entries: [], problem: 'no-store' }
    const pool = await store.openPool(RECIPE_SETTING_MEANING).catch(() => null)
    if (!pool) return { entries: [] }
    const members = await readList(store, pool)
    if (!members) return { entries: [], problem: 'unreadable' }
    const entries: RecipeSettingEntry[] = []
    for (const sig of members) entries.push(await readRecipeSetting(store, sig))
    return { entries }
  } catch { return { entries: [], problem: 'unreadable' } }
}

export type RecipeSettingKept =
  | { readonly ok: true; readonly sig: string; readonly setting: RecipeSetting; readonly added: boolean }
  | { readonly ok: false; readonly reason: string }

// One change at a time, each reading the list the one before it wrote.
let changing: Promise<unknown> = Promise.resolve()
const inTurn = <T>(act: () => Promise<T>): Promise<T> => {
  const next = changing.then(act, act)
  changing = next.catch(() => undefined)
  return next
}

async function changeList(
  store: RecipeSettingStore | undefined,
  change: (members: readonly string[]) => { members: readonly string[]; changed: boolean } | { refused: string },
): Promise<{ ok: true; changed: boolean } | { ok: false; reason: string }> {
  if (!store?.getPool || !store.getPoolDoc || !store.putPoolDoc) return { ok: false, reason: noStore() }
  const pool = await store.getPool(RECIPE_SETTING_MEANING).catch(() => null)
  if (!pool) return { ok: false, reason: t('recipe.setting.reason.listUnopened', 'the list of table sets could not be opened') }
  const members = await readList(store, pool)
  if (!members) return { ok: false, reason: t('recipe.setting.reason.listUnreadable', 'the list of table sets on this device does not read, so it was left as it is') }
  const next = change(members)
  if ('refused' in next) return { ok: false, reason: next.refused }
  if (!next.changed) return { ok: true, changed: false }
  // A participant's save: the list before this one is kept.
  const written = await store.putPoolDoc(pool, exact(offeredListBytes(RECIPE_SETTING_MEANING, next.members))).catch(() => null)
  return written ? { ok: true, changed: true } : { ok: false, reason: t('recipe.setting.reason.listUnwritten', 'the list of table sets could not be written') }
}

const notKept = (): string => t('recipe.reason.notKept', 'the store did not keep the bytes it was given')

/** Held as they are, proven to read first, then put on the list. Runs inside a turn. */
async function keep(store: RecipeSettingStore | undefined, bytes: Uint8Array, expectedSig?: string): Promise<RecipeSettingKept> {
  if (!store?.putResource) return { ok: false, reason: noStore() }
  const parsed = await parseRecipeSetting(bytes, expectedSig)
  if (!parsed.ok) return { ok: false, reason: refused(parsed.refusal) }
  const written = await store.putResource(new Blob([exact(bytes)], { type: 'application/json' })).catch(() => '')
  if (written !== parsed.sig) return { ok: false, reason: notKept() }
  const listed = await changeList(store, members => {
    if (members.includes(parsed.sig)) return { members, changed: false }
    if (members.length >= RECIPE_SETTINGS_MAX) {
      return { refused: t('recipe.setting.reason.listFull', 'the list already holds {max} table sets', { max: RECIPE_SETTINGS_MAX }) }
    }
    return { members: [...members, parsed.sig], changed: true }
  })
  return listed.ok ? { ok: true, sig: parsed.sig, setting: parsed.setting, added: listed.changed } : listed
}

/**
 * Keep a set by ITS OWN BYTES, whoever made it: another spelling would be
 * another signature. Its pictures must already be held; `importRecipeSetting`
 * and `takeCommunityRecipeSetting` see to that. Never throws.
 */
export function keepRecipeSetting(store: RecipeSettingStore | undefined, bytes: Uint8Array, sig?: string): Promise<RecipeSettingKept> {
  return inTurn(async (): Promise<RecipeSettingKept> => {
    try {
      if (sig !== undefined && (typeof sig !== 'string' || !SIG.test(sig))) return { ok: false, reason: notSignature() }
      return await keep(store, bytes, sig)
    } catch { return { ok: false, reason: t('recipe.reason.keepFailed', 'it could not be kept') } }
  })
}

/** Take a set off the list. Hide first (H4): its bytes and pictures stay. Never throws. */
export function forgetRecipeSetting(store: RecipeSettingStore | undefined, sig: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  return inTurn(async () => {
    try {
      if (typeof sig !== 'string' || !SIG.test(sig)) return { ok: false as const, reason: notSignature() }
      const listed = await changeList(store, members =>
        members.includes(sig) ? { members: members.filter(member => member !== sig), changed: true } : { members, changed: false })
      return listed.ok ? { ok: true as const } : listed
    } catch { return { ok: false as const, reason: t('recipe.reason.forgetFailed', 'it could not be taken off the list') } }
  })
}

// ── the set the desk sits on ────────────────────────────────────────────────

const DESK_DOC_BYTES = 1024

/** The set this hive's desk sits on, by signature; '' for none, the drawn plate. Reads this device only and creates no pool. Never throws. */
export async function readRecipeDeskSetting(store: RecipeSettingStore | undefined = recipeSettingStore()): Promise<string> {
  try {
    if (!store?.openPool || !store.getPoolDoc) return ''
    const pool = await store.openPool(RECIPE_DESK_MEANING).catch(() => null)
    const bytes = pool ? await store.getPoolDoc(pool).catch(() => null) : null
    if (!bytes || bytes.byteLength > DESK_DOC_BYTES) return ''
    const doc = JSON.parse(new TextDecoder().decode(bytes)) as { setting?: unknown } | null
    const sig = typeof doc?.setting === 'string' ? doc.setting : ''
    return SIG.test(sig) ? sig : ''
  } catch { return '' }
}

/**
 * Say which set the desk sits on: a signature, or '' for the drawn plate. One
 * current document, written by the leader's own choice. False when it could
 * not be written. Never throws.
 */
export async function writeRecipeDeskSetting(store: RecipeSettingStore | undefined, sig: string): Promise<boolean> {
  try {
    if (sig !== '' && !SIG.test(sig)) return false
    if (!store?.getPool || !store.putPoolDoc) return false
    const pool = await store.getPool(RECIPE_DESK_MEANING).catch(() => null)
    if (!pool) return false
    const bytes = new TextEncoder().encode(JSON.stringify({ setting: sig || null }))
    return !!(await store.putPoolDoc(pool, exact(bytes), undefined, { keep: 'current' }).catch(() => null))
  } catch { return false }
}

// ── bringing a render in ────────────────────────────────────────────────────

/** A file the leader chose or dropped: a blob with its name. */
export type RecipeSettingFile = Blob & { readonly name: string }

const named = (file: unknown): file is RecipeSettingFile =>
  !!file && typeof (file as Blob).size === 'number' && typeof (file as { name?: unknown }).name === 'string'

/** A chosen file's own name, without the folder a drop or a folder chooser puts before it. */
const baseName = (file: RecipeSettingFile): string => file.name.split(/[\\/]/).pop() ?? file.name

/**
 * Bring a table set in from the files tableware/setting.py writes: its
 * setting.json and the layer pictures that names. Every named picture must be
 * among the files, be a PNG or a WebP and be no larger than
 * RECIPE_SETTING_LIMITS.layerBytes. Each picture becomes a resource, the set
 * is built from setting.json and becomes one too, and it goes on the kept
 * list. Everything is checked before anything is written. Refuses with one
 * plain sentence; never throws.
 */
export async function importRecipeSetting(
  files: readonly unknown[],
  options: { store?: RecipeSettingStore; name?: string } = {},
): Promise<RecipeSettingKept> {
  try {
    const store = options.store ?? recipeSettingStore()
    if (!store?.putResource || !store.getPool || !store.putPoolDoc) return { ok: false, reason: noStore() }
    const chosen = (Array.isArray(files) ? files : []).filter(named)
    const jsons = chosen.filter(file => /\.json$/i.test(baseName(file)))
    const json = jsons.find(file => baseName(file).toLowerCase() === 'setting.json') ?? (jsons.length === 1 ? jsons[0] : undefined)
    if (!json) {
      return { ok: false, reason: jsons.length
        ? t('recipe.setting.reason.manyJson', 'Choose one setting.json at a time, together with its pictures.')
        : t('recipe.setting.reason.noJson', 'Choose the setting.json the render wrote, together with its pictures.') }
    }
    const jsonName = baseName(json)
    const notSet = (): RecipeSettingKept => ({ ok: false, reason: t('recipe.setting.reason.notSet', '{file} is not a table set: it does not say where its plates are.', { file: jsonName }) })
    if (json.size > RENDER_JSON_BYTES) return notSet()
    let raw: unknown
    try { raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await blobBytes(json))) } catch { return notSet() }
    const render = recipeSettingRender(raw, options.name)
    if (!render) return notSet()

    // Every picture, read and checked before a byte is written.
    const pictures = new Map<string, { bytes: Uint8Array; type: string; sig: string }>()
    for (const name of render.files) {
      const file = chosen.find(each => baseName(each).toLowerCase() === name.toLowerCase())
      if (!file) return { ok: false, reason: t('recipe.setting.reason.missing', '{file} is missing: choose it together with setting.json.', { file: name }) }
      if (file.size > RECIPE_SETTING_LIMITS.layerBytes) {
        return { ok: false, reason: t('recipe.setting.reason.tooLarge', '{file} is larger than {mb} MB, the most one layer of a table set may be.', { file: name, mb: RECIPE_SETTING_LIMITS.layerBytes / (1024 * 1024) }) }
      }
      const bytes = await blobBytes(file)
      const type = recipeSettingPictureType(bytes)
      if (!type) return { ok: false, reason: t('recipe.setting.reason.notPicture', '{file} is not a PNG or WebP picture.', { file: name }) }
      pictures.set(name, { bytes, type, sig: await sha256Hex(bytes) })
    }
    const built = render.build(file => pictures.get(file)?.sig)
    if (!built.ok) return notSet()
    const doc = recipeSettingBytes(built.doc)
    const parsed = await parseRecipeSetting(doc)
    if (!parsed.ok) return { ok: false, reason: t('recipe.setting.reason.invalid', '{file} does not make a table set this desk can lay: {reason}.', { file: jsonName, reason: refused(parsed.refusal) }) }

    for (const picture of pictures.values()) {
      const written = await store.putResource(new Blob([exact(picture.bytes)], { type: picture.type })).catch(() => '')
      // The store signs what it kept; another answer is not this picture (S3).
      if (written !== picture.sig) return { ok: false, reason: notKept() }
    }
    return await keepRecipeSetting(store, doc)
  } catch { return { ok: false, reason: t('recipe.setting.reason.importFailed', 'The table set could not be brought in.') } }
}

// ── what the community offers ───────────────────────────────────────────────

/** A set a followed host offers: read and verified, held in the answer, kept nowhere. Its pictures are not fetched yet. */
export interface RecipeSettingOffer {
  readonly sig: string
  readonly setting: RecipeSetting
  /** The maker's own bytes: what is kept. */
  readonly bytes: Uint8Array
  readonly host: string
  readonly hosts: readonly string[]
  readonly pubkey: string
}

/**
 * The table sets these hosts offer, as one table: the union of their
 * `recipe:setting` pools, one row per signature, each read as a set under the
 * signature it was listed under. Only the documents are fetched: a set's
 * pictures are fetched when it is kept. Never throws.
 */
export async function findCommunityRecipeSettings(hosts: readonly string[], options: { io?: OfferedReadIo } = {}): Promise<readonly RecipeSettingOffer[]> {
  try {
    const members = await readOfferedPools(hosts, RECIPE_SETTING_MEANING, {
      ...(options.io ? { io: options.io } : {}),
      maxMemberBytes: RECIPE_SETTING_LIMITS.bytes,
    })
    const offers: RecipeSettingOffer[] = []
    for (const member of members) {
      const parsed = await parseRecipeSetting(member.bytes, member.sig)
      if (!parsed.ok) continue
      offers.push({ sig: member.sig, setting: parsed.setting, bytes: member.bytes, host: member.host, hosts: [...member.hosts], pubkey: member.pubkey })
    }
    return offers
  } catch { return [] }
}

/** `/<sig>`, then the legacy `/content/<sig>`: the first that serves bytes hashing to the name. */
const liveAtom = async (host: string, sig: string, limit: number): Promise<Uint8Array | null> => {
  for (const path of [`/${sig}`, `/content/${sig}`]) {
    try {
      const response = await fetchWithDeadline(`${originOf(host)}${path}`, {}, { timeoutMs: HOST_TIMEOUT_MS })
      if (!response.ok) continue
      const bytes = await readBodyCapped(response, limit)
      if (bytes?.byteLength && await sha256Hex(bytes) === sig) return bytes
    } catch { /* the other spelling, then nothing */ }
  }
  return null
}

/**
 * Keep a set a host offered: the leader's press is the yes (T4). Every picture
 * it names that this device does not hold is fetched from the hosts that
 * offered it, in order, kept only when its bytes hash to its name and are a
 * PNG or a WebP no larger than one layer may be. Only when every picture is
 * held is the set kept, by the maker's own bytes. Never throws.
 */
export async function takeCommunityRecipeSetting(
  store: RecipeSettingStore | undefined,
  offer: Pick<RecipeSettingOffer, 'sig' | 'bytes' | 'host' | 'hosts'>,
  options: { io?: Pick<OfferedReadIo, 'atom'> } = {},
): Promise<RecipeSettingKept> {
  try {
    if (!store?.putResource || !store.getResourceLocal) return { ok: false, reason: noStore() }
    const parsed = await parseRecipeSetting(offer.bytes, offer.sig)
    if (!parsed.ok) return { ok: false, reason: refused(parsed.refusal) }
    const atom = options.io?.atom ?? liveAtom
    const hosts = [...new Set([offer.host, ...offer.hosts].map(host => zoneDoor(host)).filter(Boolean))]
    for (const sig of recipeSettingSignatures(parsed.setting)) {
      if (await store.getResourceLocal(sig).catch(() => null)) continue
      let fetched: { bytes: Uint8Array; type: string } | null = null
      for (const host of hosts) {
        const bytes = await atom(host, sig, RECIPE_SETTING_LIMITS.layerBytes).catch(() => null)
        const type = bytes && bytes.byteLength <= RECIPE_SETTING_LIMITS.layerBytes && await sha256Hex(bytes) === sig ? recipeSettingPictureType(bytes) : null
        if (bytes && type) { fetched = { bytes, type }; break }
      }
      if (!fetched) return { ok: false, reason: t('recipe.setting.reason.unfetched', 'A picture of this table set could not be fetched from {host}.', { host: offer.host }) }
      const written = await store.putResource(new Blob([exact(fetched.bytes)], { type: fetched.type })).catch(() => '')
      if (written !== sig) return { ok: false, reason: notKept() }
    }
    return await keepRecipeSetting(store, offer.bytes, offer.sig)
  } catch { return { ok: false, reason: t('recipe.reason.keepFailed', 'it could not be kept') } }
}

// ── what a lit hive leaves in the pool ──────────────────────────────────────

type HeldStore = {
  getResourceResolvedLocal?(sig: string): Promise<Blob | null>
  getResourceLocal?(sig: string): Promise<Blob | null>
  getResource?(sig: string): Promise<Blob | null>
}

/** This device's bytes for a signature, never a host's, following the meta envelope a tile's slot names its recipe through (L2). */
const heldHere = async (store: HeldStore | undefined, sig: string): Promise<Blob | null> => {
  if (store?.getResourceResolvedLocal) return await store.getResourceResolvedLocal(sig) ?? null
  if (store?.getResourceLocal) return await store.getResourceLocal(sig) ?? null
  return await store?.getResource?.(sig) ?? null
}

export interface RecipeSettingContributionDeps {
  /** Where the kept sets and their pictures are read. */
  readonly store?: RecipeSettingStore
  /** Where the lit tiles' recipes are read. */
  readonly recipes?: RecipeStoreDeps
}

/**
 * The rows a lit hive offers in `recipe:setting`: the sets it keeps, whole,
 * while any lit tile holds a recipe to be laid on one. A set whose pictures
 * are not all here is not offered: a reader would get a table with nothing on
 * it. Its closure is every picture it names, so the pictures travel before the
 * set that names them. A lit tile that could not be read throws, so the pool
 * is left as it is published. Read from this device only.
 */
export function recipeSettingContribution(deps: RecipeSettingContributionDeps = {}): PoolContribution {
  const storeOf = (): RecipeSettingStore | undefined => deps.store ?? recipeSettingStore()
  const recipes: RecipeStoreDeps = {
    ...deps.recipes,
    store: { getResource: sig => heldHere((deps.recipes?.store ?? storeOf()) as HeldStore | undefined, sig) },
  }
  return {
    meaning: RECIPE_SETTING_MEANING,
    label: { key: 'recipe.setting.pool.count', one: '1 table set', other: '{count} table sets' },
    membersOf: async routes => {
      if (!routes.length) return []
      const read = await mapBounded(routes, ROUTES_AT_ONCE, route => loadRecipeAt(route, recipes))
      if (read.some(at => !at || at.unread)) throw new Error('a lit tile could not be read')
      if (!read.some(at => at?.recipe)) return []
      const listing = await listRecipeSettings(storeOf())
      if (listing.problem) throw new Error('the kept sets could not be read')
      const members: string[] = []
      const atoms = new Set<string>()
      for (const entry of listing.entries) {
        if (!entry.ok || !await recipeSettingHeld(storeOf(), entry.setting)) continue
        const names = recipeSettingSignatures(entry.setting)
        if (new Set([...atoms, ...names]).size > CLOSURE_MAX) break
        for (const sig of names) atoms.add(sig)
        members.push(entry.sig)
      }
      return members
    },
    closureOf: async members => {
      const out = new Set<string>()
      for (const sig of members) {
        const entry = await readRecipeSetting(storeOf(), sig)
        if (entry.ok) for (const atom of recipeSettingSignatures(entry.setting)) out.add(atom)
      }
      return [...out]
    },
  }
}
