// core/pool-kinds.ts
//
// POOL KINDS — a DECORATION, never part of the address.
//
// Four kinds, each answering three questions at once (the table in
// `documentation/address-syntax.md`):
//
//   kind        | shape                      | deletion                    | replicates
//   ------------|----------------------------|-----------------------------|-----------
//   set         | sig-named items            | remove only your own member | yes
//   index       | member named by the sig    | never delete; recompute     | no (derived)
//               | it describes               |                             |
//   document    | one current record         | replaces siblings BY DESIGN | no (per-participant)
//   succession  | per-author buckets of      | never touch another         | yes
//               | signed claims              | author's bucket             |
//
// KEYED BY MEANING, REACHED BY ADDRESS. The kind is stored against the meaning
// and resolved to an address through the registry, so changing your mind about
// a kind never re-addresses anything: `sign(meaning)` is untouched.
//
// WHY THIS IS CODE AND NOT A POOL. A kind is a DECLARATION by whoever mints the
// pool. It is not derivable from layers, so the optimize phase may not mint it
// (a cold client cannot rebuild "what the author of this module meant by this
// directory" — the optimize-phase.md litmus). And it is not a participant act,
// so it is not truth to commit either. A pool for it would be state nobody
// writes. It belongs beside the registry that already grants meanings,
// self-extending by the same mechanism, and inherently wipe-safe because it is
// source.
//
// ═══════════════════════════════════════════════════════════════════════════
// ADVISORY FOR READING. NEVER AUTHORITATIVE FOR A DELETE.
// ═══════════════════════════════════════════════════════════════════════════
//
// A record that arrived over the wire gets no vote on destroying bytes. This
// module therefore does NOT import `directory-safety.js`, exports no function
// that takes a kind and returns a deletion decision, and — the direction that
// matters — nothing in `directory-safety.ts` names anything here. Destruction
// answers only to the structural guard: THE ENTRY DECIDES, NEVER THE
// DIRECTORY, and a directory may be hard-deleted only if every entry in it is
// a marker. `pool-kinds.spec.ts` proves all three, including a parameterised
// run of every kind against every exported guard asserting the verdicts are
// byte-identical to the no-record run.

import { poolMeaningOf } from './pool-registry.js'

/** The four kinds. */
export type PoolKind = 'set' | 'index' | 'document' | 'succession'

/** What declaring a kind actually tells a READER. Three answers, one lookup. */
export interface PoolKindFacts {
  readonly kind: PoolKind
  /** How a member leaves — a description of intent, never an authorisation.
   *  `directory-safety.ts` decides what may actually be unlinked. */
  readonly deletion: 'own-member' | 'never-recompute' | 'replaces-siblings' | 'own-bucket'
  /** May the whole pool be dropped and rebuilt from what remains? */
  readonly wipeSafe: boolean
  /** Does it travel to a peer? */
  readonly replicates: boolean
}

const FACTS: Readonly<Record<PoolKind, PoolKindFacts>> = Object.freeze({
  set: Object.freeze({ kind: 'set', deletion: 'own-member', wipeSafe: false, replicates: true }),
  index: Object.freeze({ kind: 'index', deletion: 'never-recompute', wipeSafe: true, replicates: false }),
  document: Object.freeze({ kind: 'document', deletion: 'replaces-siblings', wipeSafe: false, replicates: false }),
  succession: Object.freeze({ kind: 'succession', deletion: 'own-bucket', wipeSafe: false, replicates: true }),
})

/** The facts behind a kind. */
export const poolKindFacts = (kind: PoolKind): PoolKindFacts | undefined => FACTS[kind]

/** Is this one of the four? */
export const isPoolKind = (value: unknown): value is PoolKind =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(FACTS, value)

/** meaning → kind. Seeded from the live census, self-extending at runtime. */
const kindByMeaning = new Map<string, PoolKind>()

/**
 * Declare the kind of the pool named by `meaning`.
 *
 * Called beside `registerPoolMeaning`, so a module that mints a pool at runtime
 * says what shape it is in the same breath. First declaration wins: a later
 * caller cannot re-declare someone else's pool into a shape whose sanctioned
 * behaviour is a sibling sweep. (It could not widen a delete anyway — see the
 * header — but a silent re-declaration would still make a READER wrong.)
 *
 * IT SEEDS FIRST, AND THAT IS LOAD-BEARING. `first declaration wins` is only a
 * property if the SEED counts as the first declaration. Without this call the
 * winner is whoever imports earliest: a module declaring at import time would
 * see an empty map, take the slot, and `ensureSeeded` would then decline to
 * overwrite it — turning `roots` (succession, "never touch another author's
 * bucket") into a `document` ("replaces siblings") by module-graph accident.
 */
export const declarePoolKind = (meaning: string, kind: PoolKind): PoolKindFacts | undefined => {
  const key = String(meaning ?? '').trim()
  if (!key || !isPoolKind(kind)) return undefined
  ensureSeeded()
  if (!kindByMeaning.has(key)) kindByMeaning.set(key, kind)
  return FACTS[kindByMeaning.get(key) as PoolKind]
}

/** The seed census — every pool in the tree whose shape is settled today. */
const SEED: ReadonlyArray<readonly [string, PoolKind]> = Object.freeze([
  // DERIVED CACHES — recomputable, wipe-safe, never sent.
  ['computed:genome', 'index'],
  ['insights:catalog', 'index'],
  ['manifests', 'index'],
  ['molecule:index', 'index'],
  ['search:index', 'index'],
  ['thumbnails:hex', 'index'],
  ['visual-optimization', 'index'],
  // SETS — the participant's own members, and they travel.
  ['backgrounds:saved', 'set'],
  ['comfy:generations', 'set'],
  ['comfy:workflows', 'set'],
  ['community:hosts', 'set'],
  ['pheromones:content', 'set'],
  ['pheromones:deposits', 'set'],
  ['substrate:references', 'set'],
  ['substrate:sources', 'set'],
  ['websites:menu', 'set'],
  // DOCUMENTS — one current record, per-participant, replaced in place.
  ['backgrounds:screen', 'document'],
  ['overrides', 'document'],
  ['translations', 'document'],
  ['viewport', 'document'],
  // SUCCESSION — per-author buckets of signed claims; they must travel.
  ['host-receipts', 'succession'],
  ['hives:names', 'succession'],
  ['roots', 'succession'],
])

let seeded = false
const ensureSeeded = (): void => {
  if (seeded) return
  seeded = true
  for (const [meaning, kind] of SEED) if (!kindByMeaning.has(meaning)) kindByMeaning.set(meaning, kind)
}

/** The declared kind behind a MEANING, or `undefined` when nobody has said.
 *  Undefined is the honest answer, not a default — a pool whose shape nobody
 *  declared must be read conservatively, and never swept. */
export const poolKindOfMeaning = (meaning: string): PoolKindFacts | undefined => {
  ensureSeeded()
  const kind = kindByMeaning.get(String(meaning ?? '').trim())
  return kind ? FACTS[kind] : undefined
}

/**
 * The declared kind behind an ADDRESS. Resolves through the registry's own
 * `poolMeaningOf`, so the kind stays keyed by meaning and is merely REACHED by
 * address — which is what makes changing a kind free of any re-addressing.
 *
 * A `undefined` answer covers both "not a pool this process has heard of" and
 * "a pool whose shape nobody declared". Neither is licence to do anything.
 */
export const poolKindOfAddress = async (address: string): Promise<PoolKindFacts | undefined> => {
  const meaning = await poolMeaningOf(String(address ?? ''))
  return meaning ? poolKindOfMeaning(meaning) : undefined
}

/** Every declared kind, for diagnostics. Snapshot — callers must not mutate. */
export const poolKinds = (): ReadonlyMap<string, PoolKind> => {
  ensureSeeded()
  return new Map(kindByMeaning)
}

// ---------------------------------------------------------------------------
// WIRE CLAIMS
// ---------------------------------------------------------------------------
//
// A peer may DECLARE the shape of a pool it holds. Declaration is inert;
// placement is an act. `readClaim` validates and returns the claim as DATA —
// there is deliberately no function anywhere that turns one into a deletion.

/** A kind as claimed by someone else. Parse it, read it, trust it with nothing. */
export interface PoolKindClaim {
  readonly address: string
  readonly kind: PoolKind
  /** Who said so, when the wire carried it. Provenance, not authority. */
  readonly by?: string
}

const ADDRESS = /^[0-9a-f]{64}$/i

/**
 * Validate a claim that arrived from outside. Returns the claim or `null`; it
 * has NO side effect — reading a stranger's claim does not declare anything
 * locally, because a local declaration is what a reader of THIS hive believes.
 */
export const readClaim = (raw: unknown): PoolKindClaim | null => {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  const address = String(record['address'] ?? '')
  if (!ADDRESS.test(address)) return null
  const kind = record['kind']
  if (!isPoolKind(kind)) return null
  const by = typeof record['by'] === 'string' ? record['by'] : undefined
  return Object.freeze({ address: address.toLowerCase(), kind, ...(by ? { by } : {}) })
}
