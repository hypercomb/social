// recipe/recipe-pool.ts
//
// THE TEMPLATES A HIVE KEEPS, AND THE ONES ITS COMMUNITY OFFERS. A template is
// one artifact (A1): its bytes are a resource at the content root, held once
// however many recipes name it (S2, A6). The pool `recipe:template` says which
// of those the cook keeps (P1): membership, never the template's truth (P6). A
// template is trusted by its own bytes under its own signature, never because
// a list or a host named it (M1, M2).
//
// ── ONE DOCUMENT, THE SHAPE A HOST OFFERS ───────────────────────────────────
//
// The kept list is one current document, `{ meaning, members: [sig, ...] }`:
// the list document of pools/offered-pool.ts, written and read with its own
// functions so the two can never drift. It is written as a participant's save,
// so every list before it is kept (H2). Taking a template off the list hides
// it (H4): its bytes stay, every recipe that names it still opens, and the
// list's history still names it. A list that does not read is never rewritten
// as a shorter one: a change is complete or it does not happen.
//
// ── THREE WAYS IN, AND NONE ARRIVES UNINVITED ───────────────────────────────
//
//   HOLD  the bytes become a resource and the list is untouched: what a recipe
//         needs so the template it names resolves.
//   SAVE  hold, and put it on the list: "keep as a template".
//   KEEP  someone else's, by THEIR bytes: another spelling would be another
//         signature, and every recipe naming the maker's would not find it.
//
// What the community offers is only HELD IN THE ANSWER of the finder: a row of
// the table (documentation/pools-as-relational-database.md, T9), verified by
// its signature and kept only when the cook picks it (T4, T5). Listing reads
// this device alone and creates no pool; only the finder asks a host, and only
// the hosts it is handed (T5). What a lit recipe tile leaves in the pool is
// said by the contribution at the foot of this file.
//
// Nothing here throws: a refusal is words. Nothing registers here.

import { I18N_IOC_KEY, get, type I18nProvider } from '@hypercomb/core'
import { OFFERED_MAX_MEMBERS, offeredListBytes, offeredMembersOf, readOfferedPools, type OfferedReadIo } from '../pools/offered-pool.js'
import type { PoolContribution } from '../pools/pool-contributions.js'
import { mapBounded } from '../sharing/bounded-fetch.js'
import { DEFAULT_RECIPE_TEMPLATES } from './recipe-defaults.js'
import { recipeTemplateAt, type RecipeStoreDeps } from './recipe-store.js'
import {
  RECIPE_LIMITS,
  parseRecipeTemplate,
  recipeTemplateBytes,
  type RecipeTemplate,
  type RecipeTemplateDocument,
} from './recipe-template.js'

/** The pool's meaning. Its address is derived by the store, never spelled here. */
export const RECIPE_TEMPLATE_MEANING = 'recipe:template'
/** As many as one host offers per meaning, so a kept list is always a list a host could offer whole. */
export const RECIPE_TEMPLATES_MAX = OFFERED_MAX_MEMBERS

const STORE_KEY = '@hypercomb.social/Store'
const SIG = /^[a-f0-9]{64}$/
/** Lit tiles read at once when the contribution is asked for its members. */
const ROUTES_AT_ONCE = 8

/** The store, as far as this module uses it. Every method optional: an older store, or none, is an answer. */
export interface RecipeTemplateStore {
  /** Opens the pool, creating it. Only for a write. */
  getPool?(meaning: string): Promise<object | null>
  /** Opens the pool and never creates it. For a read. */
  openPool?(meaning: string): Promise<object | null>
  getPoolDoc?(pool: object, subKey?: string): Promise<ArrayBuffer | null>
  putPoolDoc?(pool: object, bytes: ArrayBuffer, subKey?: string, options?: { keep?: 'versions' | 'current' }): Promise<string | null>
  putResource?(blob: Blob, options?: { emit?: boolean }): Promise<string>
  /** Bytes this device holds. Never asks a host. */
  getResourceLocal?(signature: string): Promise<Blob | null>
}

/** The hive's store, through IoC. Undefined where there is none. */
export const recipeTemplateStore = (): RecipeTemplateStore | undefined => {
  try { return get<RecipeTemplateStore>(STORE_KEY) } catch { return undefined }
}

const t = (key: string, fallback: string, params?: Record<string, string | number>): string => {
  let said: string | undefined
  try { said = get<I18nProvider>(I18N_IOC_KEY)?.t(key, params) } catch { said = undefined }
  const text = said && said !== key ? said : fallback
  return params ? text.replace(/\{(\w+)\}/g, (hole, name: string) => name in params ? String(params[name]) : hole) : text
}

const noStore = (): string => t('recipe.reason.noStore', 'the store is not available here')
const notSignature = (): string => t('recipe.reason.notSignature', 'not a signature')

// ── the list ────────────────────────────────────────────────────────────────

export type RecipeTemplateEntry =
  | { readonly sig: string; readonly ok: true; readonly template: RecipeTemplate }
  | { readonly sig: string; readonly ok: false; readonly reason: string }

export interface RecipeTemplateListing {
  /** Members in the order they were kept, each read back or refused with its reason. */
  readonly entries: readonly RecipeTemplateEntry[]
  /** Set when there is no list to read: no store here, or a list on this device that does not read. */
  readonly problem?: 'no-store' | 'unreadable'
}

const exact = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer

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
async function readList(store: RecipeTemplateStore, pool: object): Promise<string[] | null> {
  const bytes = await store.getPoolDoc?.(pool).catch(() => null) ?? null
  if (bytes) return offeredMembersOf(new Uint8Array(bytes), RECIPE_TEMPLATE_MEANING)
  return await holdsDocument(pool) ? null : []
}

/** One template read from this device's heap, by its signature. Never asks a host, never throws. */
export async function readRecipeTemplate(store: RecipeTemplateStore | undefined, sig: string): Promise<RecipeTemplateEntry> {
  if (typeof sig !== 'string' || !SIG.test(sig)) return { sig: String(sig ?? ''), ok: false, reason: notSignature() }
  let blob: Blob | null = null
  try { blob = await store?.getResourceLocal?.(sig) ?? null } catch { blob = null }
  if (!blob) return { sig, ok: false, reason: t('recipe.reason.notHeld', 'its bytes are not held here') }
  // Size first, so a member that is not a template is never read whole.
  if (blob.size > RECIPE_LIMITS.templateBytes) {
    return { sig, ok: false, reason: t('recipe.reason.tooLarge', 'it is larger than {kb} KB', { kb: RECIPE_LIMITS.templateBytes / 1024 }) }
  }
  let bytes: Uint8Array
  try { bytes = new Uint8Array(await blob.arrayBuffer()) } catch {
    return { sig, ok: false, reason: t('recipe.reason.unreadBytes', 'its bytes could not be read') }
  }
  const parsed = await parseRecipeTemplate(bytes, sig)
  return parsed.ok ? { sig, ok: true, template: parsed.template } : { sig, ok: false, reason: parsed.reason }
}

/**
 * The templates this hive keeps, each read back by its signature. Reads only
 * this device: no pool is created, no host is asked. Never throws.
 */
export async function listRecipeTemplates(store: RecipeTemplateStore | undefined = recipeTemplateStore()): Promise<RecipeTemplateListing> {
  try {
    if (!store?.openPool || !store.getPoolDoc) return { entries: [], problem: 'no-store' }
    const pool = await store.openPool(RECIPE_TEMPLATE_MEANING).catch(() => null)
    if (!pool) return { entries: [] }
    const members = await readList(store, pool)
    if (!members) return { entries: [], problem: 'unreadable' }
    const entries: RecipeTemplateEntry[] = []
    for (const sig of members) entries.push(await readRecipeTemplate(store, sig))
    return { entries }
  } catch { return { entries: [], problem: 'unreadable' } }
}

// ── holding and keeping ─────────────────────────────────────────────────────

export type RecipeTemplateHeld =
  | { readonly ok: true; readonly sig: string }
  | { readonly ok: false; readonly reason: string }

export type RecipeTemplateKept =
  | { readonly ok: true; readonly sig: string; readonly added: boolean }
  | { readonly ok: false; readonly reason: string }

// One change at a time, each reading the list the one before it wrote, so two
// saves finishing together are both on the list.
let changing: Promise<unknown> = Promise.resolve()
const inTurn = <T>(act: () => Promise<T>): Promise<T> => {
  const next = changing.then(act, act)
  changing = next.catch(() => undefined)
  return next
}

/** Change the list, complete or not at all: a list that does not read is never rewritten as a shorter one. */
async function changeList(
  store: RecipeTemplateStore | undefined,
  change: (members: readonly string[]) => { members: readonly string[]; changed: boolean } | { refused: string },
): Promise<{ ok: true; changed: boolean } | { ok: false; reason: string }> {
  if (!store?.getPool || !store.getPoolDoc || !store.putPoolDoc) return { ok: false, reason: noStore() }
  const pool = await store.getPool(RECIPE_TEMPLATE_MEANING).catch(() => null)
  if (!pool) return { ok: false, reason: t('recipe.reason.listUnopened', 'the template list could not be opened') }
  const members = await readList(store, pool)
  if (!members) return { ok: false, reason: t('recipe.reason.listUnreadable', 'the template list on this device does not read, so it was left as it is') }
  const next = change(members)
  if ('refused' in next) return { ok: false, reason: next.refused }
  if (!next.changed) return { ok: true, changed: false }
  // A participant's save: the list before this one is kept.
  const written = await store.putPoolDoc(pool, exact(offeredListBytes(RECIPE_TEMPLATE_MEANING, next.members))).catch(() => null)
  return written ? { ok: true, changed: true } : { ok: false, reason: t('recipe.reason.listUnwritten', 'the template list could not be written') }
}

/** The bytes as they are, proven to read, then held. The list is not touched. */
async function hold(store: RecipeTemplateStore | undefined, bytes: Uint8Array, expectedSig?: string): Promise<RecipeTemplateHeld> {
  if (!store?.putResource) return { ok: false, reason: noStore() }
  // Never hold what would not read back: a recipe names only a template that opens.
  const parsed = await parseRecipeTemplate(bytes, expectedSig)
  if (!parsed.ok) return { ok: false, reason: parsed.reason }
  const written = await store.putResource(new Blob([exact(bytes)], { type: 'application/json' })).catch(() => '')
  // The store signs what it wrote; a different answer is not this template (S3).
  if (written !== parsed.sig) return { ok: false, reason: t('recipe.reason.notKept', 'the store did not keep the bytes it was given') }
  return { ok: true, sig: parsed.sig }
}

/** Held, then listed. Runs inside a turn. */
async function keep(store: RecipeTemplateStore | undefined, bytes: Uint8Array, expectedSig?: string): Promise<RecipeTemplateKept> {
  const held = await hold(store, bytes, expectedSig)
  if (!held.ok) return held
  const listed = await changeList(store, members => {
    if (members.includes(held.sig)) return { members, changed: false }
    if (members.length >= RECIPE_TEMPLATES_MAX) {
      return { refused: t('recipe.reason.listFull', 'the list already holds {max} templates', { max: RECIPE_TEMPLATES_MAX }) }
    }
    return { members: [...members, held.sig], changed: true }
  })
  return listed.ok ? { ok: true, sig: held.sig, added: listed.changed } : listed
}

const canonical = (doc: RecipeTemplateDocument): Uint8Array | null => {
  try { return recipeTemplateBytes(doc) } catch { return null }
}
const notTemplate = (): string => t('recipe.reason.notTemplate', 'it is not a template')
const keepFailed = (): string => t('recipe.reason.keepFailed', 'it could not be kept')

/**
 * Hold a template without listing it: its canonical bytes become a resource
 * (one template, one signature, I1), proven to read before anything is
 * written. What a recipe needs so the template it names resolves. Never throws.
 */
export async function holdRecipeTemplate(store: RecipeTemplateStore | undefined, doc: RecipeTemplateDocument): Promise<RecipeTemplateHeld> {
  try {
    const bytes = canonical(doc)
    return bytes ? await hold(store, bytes) : { ok: false, reason: notTemplate() }
  } catch { return { ok: false, reason: keepFailed() } }
}

/**
 * Keep a template: held, and its signature put on the list. Saving the same
 * template twice changes nothing. Never throws.
 */
export function saveRecipeTemplate(store: RecipeTemplateStore | undefined, doc: RecipeTemplateDocument): Promise<RecipeTemplateKept> {
  return inTurn(async (): Promise<RecipeTemplateKept> => {
    try {
      const bytes = canonical(doc)
      return bytes ? await keep(store, bytes) : { ok: false, reason: notTemplate() }
    } catch { return { ok: false, reason: keepFailed() } }
  })
}

/**
 * Keep a template someone else made, BY ITS OWN BYTES. Never written again in
 * canonical form: another spelling would be another signature. Refused unless
 * the bytes are the signature they were offered under (S3) and read as a
 * template. Never throws.
 */
export function keepRecipeTemplate(store: RecipeTemplateStore | undefined, bytes: Uint8Array, sig: string): Promise<RecipeTemplateKept> {
  return inTurn(async (): Promise<RecipeTemplateKept> => {
    try {
      if (typeof sig !== 'string' || !SIG.test(sig)) return { ok: false, reason: notSignature() }
      return await keep(store, bytes, sig)
    } catch { return { ok: false, reason: keepFailed() } }
  })
}

/**
 * Take a template off the list. Hide first (H4): its bytes stay in the heap,
 * every recipe that names it still opens, and the list before this one still
 * names it. Never throws.
 */
export function forgetRecipeTemplate(store: RecipeTemplateStore | undefined, sig: string): Promise<RecipeTemplateKept> {
  return inTurn(async (): Promise<RecipeTemplateKept> => {
    try {
      if (typeof sig !== 'string' || !SIG.test(sig)) return { ok: false, reason: notSignature() }
      const listed = await changeList(store, members =>
        members.includes(sig) ? { members: members.filter(member => member !== sig), changed: true } : { members, changed: false })
      return listed.ok ? { ok: true, sig, added: false } : listed
    } catch { return { ok: false, reason: t('recipe.reason.forgetFailed', 'it could not be taken off the list') } }
  })
}

// ── the three every hive starts with ────────────────────────────────────────

let defaults: Promise<readonly { sig: string; template: RecipeTemplate }[]> | null = null

/**
 * The default templates with the signatures their canonical bytes have, in the
 * picker's order. Worked out once. Nothing is written: a default becomes a
 * resource only when a recipe is written into it (`holdRecipeTemplate`).
 */
export function defaultRecipeTemplates(): Promise<readonly { sig: string; template: RecipeTemplate }[]> {
  return defaults ??= (async () => {
    const out: { sig: string; template: RecipeTemplate }[] = []
    for (const doc of DEFAULT_RECIPE_TEMPLATES) {
      const parsed = await parseRecipeTemplate(recipeTemplateBytes(doc))
      if (parsed.ok) out.push({ sig: parsed.sig, template: parsed.template })
    }
    // An answer that is missing one is not remembered: the next ask works it out again.
    if (out.length !== DEFAULT_RECIPE_TEMPLATES.length) defaults = null
    return Object.freeze(out)
  })()
}

// ── what the community offers ───────────────────────────────────────────────

/** A template a followed host offers: read and verified, held in the answer, kept nowhere. */
export interface RecipeTemplateOffer {
  readonly sig: string
  readonly template: RecipeTemplate
  /** The maker's own bytes: what `keepRecipeTemplate` takes. */
  readonly bytes: Uint8Array
  /** The first host that offered it, in the order the hosts were given. */
  readonly host: string
  /** Every host that offered it. */
  readonly hosts: readonly string[]
  /** The key it was offered under on `host`. */
  readonly pubkey: string
}

/**
 * The recipe templates these hosts offer, as one table: the union of their
 * `recipe:template` pools, one row per signature. A member is in the answer
 * only when its bytes are the signature it was listed under and read as a
 * template; anything else is left out. Nothing is kept: the cook picks, and
 * `keepRecipeTemplate` keeps. Bounded in hosts, members, size and time by the
 * reader it stands on. Never throws.
 */
export async function findCommunityRecipeTemplates(
  hosts: readonly string[],
  options: { io?: OfferedReadIo } = {},
): Promise<readonly RecipeTemplateOffer[]> {
  try {
    const members = await readOfferedPools(hosts, RECIPE_TEMPLATE_MEANING, {
      ...(options.io ? { io: options.io } : {}),
      maxMemberBytes: RECIPE_LIMITS.templateBytes,
    })
    const offers: RecipeTemplateOffer[] = []
    for (const member of members) {
      const parsed = await parseRecipeTemplate(member.bytes, member.sig)
      if (!parsed.ok) continue
      offers.push({ sig: member.sig, template: parsed.template, bytes: member.bytes, host: member.host, hosts: [...member.hosts], pubkey: member.pubkey })
    }
    return offers
  } catch { return [] }
}

// ── what a lit recipe tile leaves in the pool ───────────────────────────────

type HeldStore = {
  getResourceResolvedLocal?(sig: string): Promise<Blob | null>
  getResourceLocal?(sig: string): Promise<Blob | null>
  getResource?(sig: string): Promise<Blob | null>
}

/**
 * This device's bytes for a signature, never a host's. A tile's slot names its
 * recipe through a meta envelope (L2), so the read has to follow that one hop:
 * the store's resolved-local reader does, and asks nobody. The raw local read
 * would hand back the envelope itself.
 */
const heldHere = async (store: HeldStore | undefined, sig: string): Promise<Blob | null> => {
  if (store?.getResourceResolvedLocal) return await store.getResourceResolvedLocal(sig) ?? null
  if (store?.getResourceLocal) return await store.getResourceLocal(sig) ?? null
  return await store?.getResource?.(sig) ?? null
}

/**
 * The rows the lit tiles offer in `recipe:template`: for each lit route, the
 * template its current recipe names, when this hive holds bytes for it that
 * read as a template. Read from this device only: what is offered is what is
 * here, and a host is never asked for bytes this hive is about to send. A
 * template names no other atom, so it has no closure.
 */
export function recipeTemplateContribution(deps: RecipeStoreDeps = {}): PoolContribution {
  const held: RecipeStoreDeps = {
    ...deps,
    store: {
      getResource: sig => heldHere((deps.store ?? recipeTemplateStore()) as HeldStore | undefined, sig),
    },
  }
  return {
    meaning: RECIPE_TEMPLATE_MEANING,
    label: { key: 'recipe.pool.count', one: '1 recipe template', other: '{count} recipe templates' },
    membersOf: async routes => {
      const named = await mapBounded(routes, ROUTES_AT_ONCE, route => recipeTemplateAt(route, held))
      return [...new Set(named.flatMap(found => (found ? [found.sig] : [])))]
    },
  }
}
