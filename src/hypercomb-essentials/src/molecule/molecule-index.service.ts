// molecule/molecule-index.service.ts
//
// THE READER HALF of the molecule index — split from the minting bee for the
// same reason search is: the reader has to be testable with an EMPTY POOL and
// no processor, or "wipe it and get identical answers" is a claim rather than a
// proof.
//
//   addressOf(word)   one hash. The front door.
//   holds(word)       whether this hive can say that word.
//   vocabulary()      address → word, from the ROOT record. Empty on a miss.
//   fallbackVocabulary()
//                     THE SAME ANSWER with the pool absent — the SAME names
//                     read from the SAME manifests, folded through the same
//                     `moleculeAddress`. One rule applied to one input twice,
//                     which is what makes cold-path equivalence a theorem
//                     rather than a hope.
//
// THE COLD PATH READS LAYERS, NEVER ANOTHER CACHE. It used to fold
// `HiveSearchService.vocabulary()`, and that reader is itself a record out of
// `sign('search:index')` which returns an EMPTY map on a miss and never
// derives. Both pools are declared `index` kind — recomputable, wipe-safe,
// GC-able — so wiping both, which is exactly what that licenses, left the hive
// able to say NOTHING. That is not slower, it is a different answer. The
// fallback now walks children manifests from the head layer: the same walk the
// deriver does, unbudgeted by a pass, memoised per root sig.
//
// `readRecord` NEVER DERIVES. A deriving reader would put a whole-subtree walk
// on a path a keystroke can reach, which is exactly the cost this design
// refuses. A miss answers from the fallback and says it was slower, never
// wrong.
//
// MINTING IS NOT ON THE REGISTERED SURFACE. `moleculeIndexReader()` is what
// goes into IoC: the read half only. `derive` and `writeRecord` stay on the
// class the bee constructs for itself, so "minted in the optimize phase and
// nowhere else" is structural rather than documentary — no component, drone or
// console caller can reach a recursive subtree walk plus a pool write per node
// through `ioc.get`.

import {
  MAX_RECORD_DEPTH, MOLECULE_INDEX_MEANING, MoleculeWordSet, addressOfName,
  readableRecord, vocabularyOf, type MoleculeRecord, type MoleculeWord,
} from './molecule-index.js'

const ioc = <T>(key: string): T | undefined =>
  (window as unknown as { ioc?: { get?: <V>(k: string) => V | undefined } }).ioc?.get?.<T>(key)

type LayerLike = { name?: string; [k: string]: unknown }

type ManifestEntry = { sig: string; layer: LayerLike; [k: string]: unknown }

type HistoryLike = {
  sign(lineage: { explorerSegments: () => readonly string[] }): Promise<string>
  headLayer(locationSig: string): Promise<{ layerSig: string } | null>
  getLayerBySig(sig: string): Promise<LayerLike | null>
  childrenManifestFor?(layer: LayerLike): Promise<ManifestEntry[] | null>
}

type StoreLike = {
  getPool(meaning: string): Promise<FileSystemDirectoryHandle | null>
  readChildrenManifest?(parentLayerSig: string): Promise<ManifestEntry[] | null>
}

export interface MoleculeBudget {
  nodes: number
  cancelled?: () => boolean
}

/** How many manifests the COLD walk will read before it stops and says so.
 *  Generous, because this path only runs when the accelerator is absent and
 *  the alternative is a wrong answer — but bounded, because a cycle or a
 *  pathological tree must not be able to hang a read. */
export const COLD_WALK_NODES = 20_000

export const MOLECULE_INDEX_SERVICE_KEY = '@diamondcoreprocessor.com/MoleculeIndexService'

export class MoleculeIndexService {

  /** Records read this session, by layer sig. A record for a sig can never go
   *  stale — the sig names the exact content it derives from — so this needs no
   *  invalidation, only a size cap. */
  #memo = new Map<string, MoleculeRecord>()

  #pool: FileSystemDirectoryHandle | null | undefined

  get history(): HistoryLike | undefined {
    return ioc<HistoryLike>('@diamondcoreprocessor.com/HistoryService')
  }

  get store(): StoreLike | undefined {
    return ioc<StoreLike>('@hypercomb.social/Store')
  }

  /** `sign(fold(canon(word)))`. One hash, and the whole of the front door. */
  addressOf = async (word: unknown): Promise<string | null> => await addressOfName(word)

  /** The head layer sig of the root, the record the vocabulary lives at. */
  async rootSig(): Promise<string | null> {
    const history = this.history
    if (!history) return null
    try {
      const location = await history.sign({ explorerSegments: () => [] })
      return (await history.headLayer(location))?.layerSig ?? null
    } catch { return null }
  }

  /** Read a record. Memo, then the pool, then null. NEVER derives, and never
   *  opens a handle with `create: true` — a reader that could mint is a reader
   *  that can put a walk on the keystroke path by accident. */
  readRecord = async (layerSig: string): Promise<MoleculeRecord | null> => {
    const memo = this.#memo.get(layerSig)
    if (memo) return memo
    if (this.#pool === undefined) this.#pool = (await this.store?.getPool(MOLECULE_INDEX_MEANING)) ?? null
    if (!this.#pool) return null
    try {
      const handle = await this.#pool.getFileHandle(layerSig, { create: false })
      const record = readableRecord(JSON.parse(await (await handle.getFile()).text()))
      if (!record) return null
      if (this.#memo.size > 64) this.#memo.clear()
      this.#memo.set(layerSig, record)
      return record
    } catch { return null }
  }

  /** Write a derived record, keyed by the sig it was derived from. Best-effort
   *  — a failed write costs a slower answer and nothing else. */
  writeRecord = async (layerSig: string, record: MoleculeRecord): Promise<void> => {
    if (this.#pool === undefined) this.#pool = (await this.store?.getPool(MOLECULE_INDEX_MEANING)) ?? null
    if (!this.#pool) return
    try {
      const handle = await this.#pool.getFileHandle(layerSig, { create: true })
      const writable = await handle.createWritable()
      try { await writable.write(JSON.stringify(record)) } finally { await writable.close() }
      this.#memo.set(layerSig, record)
    } catch { /* derived cache — a miss next time is the only cost */ }
  }

  /** The children manifest of a layer — the render's own cache, one pool read.
   *  Traversal follows MANIFESTS, never visuals: marks classify, they never
   *  resolve. */
  async #manifestOf(layerSig: string): Promise<ManifestEntry[] | null> {
    const direct = await this.store?.readChildrenManifest?.(layerSig).catch(() => null)
    if (direct?.length) return direct
    const layer = await this.history?.getLayerBySig(layerSig).catch(() => null)
    if (!layer) return null
    return (await this.history?.childrenManifestFor?.(layer).catch(() => null)) ?? null
  }

  /**
   * Derive the record for a layer sig — the optimize phase's worker, and the
   * only thing here that reads more than one file.
   *
   * A child that already HAS a record is spliced in whole and never descended
   * into. Nothing is written for the sig ASKED FOR; the caller writes that.
   *
   * ═════════════════════════════════════════════════════════════════════════
   * COMPLETE-OR-ABSENT, AND THE CHILD WRITE IS WHERE IT IS WON OR LOST.
   * ═════════════════════════════════════════════════════════════════════════
   * A child record is persisted under the child's REAL layer sig, and a sig's
   * record can never go stale — so there is no refresh path anywhere and the
   * first record written for a sig is its record forever. Persisting a
   * TRUNCATED child (budget ran out mid-loop) or an EMPTY one (the depth cap
   * fired before a manifest was even read) therefore does not make the answer
   * slower, it makes it permanently WRONG: `holds(word)` returns a bare
   * `false` for a word the hive genuinely says. So:
   *
   *   - the depth cap returns NULL rather than an empty record. A record must
   *     be a pure function of the sig that keys it; `{ words: [], truncated }`
   *     is a function of WHERE the walk arrived, and the same sig reached from
   *     a shallower parent would then read that emptiness back as a cache hit
   *     and splice it in whole.
   *   - a null child — depth cap, or a manifest read that blinked — sets
   *     `truncated` on the PARENT. Dropping a subtree silently and still
   *     sealing the record as complete is the worst shape available, because
   *     even a reader that honours the flag is then lied to.
   *   - only a COMPLETE child is written.
   */
  derive = async (
    layerSig: string,
    budget: MoleculeBudget,
    depth = 0,
  ): Promise<MoleculeRecord | null> => {
    if (depth >= MAX_RECORD_DEPTH) return null
    const manifest = await this.#manifestOf(layerSig)
    if (!manifest) return null

    const words = new MoleculeWordSet()
    let truncated = false

    for (const entry of manifest) {
      if (budget.cancelled?.() || budget.nodes <= 0) { truncated = true; break }
      budget.nodes--
      const name = typeof entry.layer?.name === 'string' ? entry.layer.name : ''
      const address = await addressOfName(name)
      if (address) words.add(address, name, 0)

      const cached = await this.readRecord(entry.sig)
      const child = cached ?? await this.derive(entry.sig, budget, depth + 1)
      if (!child) { truncated = true; continue }
      words.absorb(child, 1)
      if (child.truncated) { truncated = true; continue }
      if (!cached) await this.writeRecord(entry.sig, child)
    }

    return words.seal(truncated)
  }

  /**
   * THE DECLARED VOCABULARY — address → word, from the root record.
   *
   * EMPTY ON A MISS, never a walk. The phase owes the root a record and mints
   * it last and always; until then `fallbackVocabulary()` is the answer, and it
   * is the same answer.
   */
  vocabulary = async (): Promise<ReadonlyMap<string, MoleculeWord>> => {
    const rootSig = await this.rootSig()
    if (!rootSig) return new Map()
    return vocabularyOf(await this.readRecord(rootSig))
  }

  /** The cold walk's result for one root sig, so a keystroke does not pay for
   *  it twice. Keyed by the root sig, so it invalidates the way a record does:
   *  the head moved, the memo does not answer. */
  #cold: { root: string; words: ReadonlyMap<string, MoleculeWord>; truncated: boolean } | null = null

  /** Walk the manifests under one sig, folding every name. NO pool read, NO
   *  write, no record — the cache is exactly what this path proves it does not
   *  need. `seen` is the cycle guard: a subtree re-homed into itself is cheap
   *  per step, so the node budget alone would not stop it. */
  async #walkNames(
    layerSig: string,
    words: MoleculeWordSet,
    budget: MoleculeBudget,
    depth: number,
    seen: Set<string>,
  ): Promise<boolean> {
    if (seen.has(layerSig)) return false
    seen.add(layerSig)
    const manifest = await this.#manifestOf(layerSig)
    if (!manifest) return true
    let truncated = false
    for (const entry of manifest) {
      if (budget.nodes <= 0) return true
      budget.nodes--
      const name = typeof entry.layer?.name === 'string' ? entry.layer.name : ''
      const address = await addressOfName(name)
      if (address) words.add(address, name, depth)
      if (await this.#walkNames(entry.sig, words, budget, depth + 1, seen)) truncated = true
    }
    return truncated
  }

  /**
   * THE COLD PATH. The same vocabulary with the index pool absent.
   *
   * It reads the SAME children manifests the deriver reads and folds the same
   * names through the same `moleculeAddress`. Not a second implementation of
   * the rule, and — the part that used to be untrue — not a read of a second
   * derived cache either. This is the answer LAYERS ALONE give, which is what
   * "a cold client must produce identical results, only slower" actually
   * requires.
   */
  fallbackVocabulary = async (): Promise<ReadonlyMap<string, MoleculeWord>> => {
    const rootSig = await this.rootSig()
    if (!rootSig) return new Map()
    if (this.#cold?.root === rootSig) return this.#cold.words
    const words = new MoleculeWordSet()
    const truncated = await this.#walkNames(rootSig, words, { nodes: COLD_WALK_NODES }, 0, new Set())
      .catch(() => true)
    const map = vocabularyOf(words.seal())
    this.#cold = { root: rootSig, words: map, truncated }
    return map
  }

  /**
   * THE VOCABULARY OF ONE SUBTREE — record-ACCELERATED, never
   * record-DEPENDENT.
   *
   * `declaredVocabulary()` gives this guarantee for the ROOT; a publish asks
   * about one PUBLISHED BRANCH, and it used to ask `readRecord`, which "NEVER
   * DERIVES". This pool is declared `index` kind — recomputable, wipe-safe,
   * GC-able — so a collector is LICENSED to empty it, and with the raw reader
   * a wipe turned a publishable claim into a refusal. That is a different
   * answer, not a slower one, and `optimize-phase.md` rule 3 forbids exactly
   * that.
   *
   * A WHOLE record answers alone. Anything else — absent, empty, truncated —
   * falls through to the same cold walk `fallbackVocabulary` uses, unioned
   * with whatever the partial record held. Null means the walk could prove
   * nothing at all, which a caller must treat as an incomplete picture and
   * never as an empty vocabulary.
   */
  subtreeVocabulary = async (layerSig: string): Promise<MoleculeRecord | null> => {
    const record = await this.readRecord(layerSig)
    if (MoleculeIndexService.#whole(record)) return record
    const words = new MoleculeWordSet()
    for (const word of record?.words ?? []) words.add(word.a, word.n, 0)
    const truncated = await this.#walkNames(layerSig, words, { nodes: COLD_WALK_NODES }, 0, new Set())
      .catch(() => true)
    if (words.size === 0 && truncated) return null
    return words.seal(truncated)
  }

  /** The root record, or null. One place, so every reader below asks the same
   *  question and gets the same `truncated`. */
  async #rootRecord(): Promise<MoleculeRecord | null> {
    const rootSig = await this.rootSig()
    if (!rootSig) return null
    return await this.readRecord(rootSig)
  }

  /** Is a record usable as the WHOLE answer on its own? */
  static #whole(record: MoleculeRecord | null): boolean {
    return !!record && record.truncated !== true && record.words.length > 0
  }

  /**
   * THE DECLARED VOCABULARY, as the capability actually needs it: the SET of
   * molecule addresses this hive can say.
   *
   * A COMPLETE index record answers alone. Anything else — absent, empty, or
   * flagged `truncated` — falls THROUGH to the cold walk and is unioned with
   * it, never trusted in its place. The flag used to be written and never
   * read, so one non-empty word was enough to short-circuit the cold path
   * entirely and a hive with an admittedly-partial record answered `false` for
   * words it genuinely says. A union can only ever be a superset of the record
   * on its own, so the accelerator can still only make this faster.
   */
  declaredVocabulary = async (): Promise<ReadonlySet<string>> => {
    const record = await this.#rootRecord()
    if (MoleculeIndexService.#whole(record)) return new Set(vocabularyOf(record).keys())
    const out = new Set((await this.fallbackVocabulary()).keys())
    for (const word of record?.words ?? []) out.add(word.a)
    return out
  }

  /**
   * Was that answer assembled from an incomplete picture?
   *
   * `HiveSearchService` surfaces its record's `truncated` to callers as
   * `partial`; this reader dropped it, so "no" and "I could not finish
   * looking" were the same answer. They are not the same fact and a caller
   * that shows a hive's vocabulary needs to be able to tell them apart.
   */
  declaredVocabularyPartial = async (): Promise<boolean> => {
    if (MoleculeIndexService.#whole(await this.#rootRecord())) return false
    await this.fallbackVocabulary()
    return this.#cold?.truncated ?? true
  }

  /** Can this hive say that word? */
  holds = async (word: unknown): Promise<boolean> => {
    const address = await addressOfName(word)
    if (!address) return false
    return (await this.declaredVocabulary()).has(address)
  }
}

/** THE REGISTERED SURFACE — the read half, and nothing else.
 *
 *  `derive` and `writeRecord` are deliberately absent: minting belongs to the
 *  optimize phase, and a minter reachable through `ioc.get` is a recursive
 *  subtree walk plus one pool write per node that any render, navigation or
 *  keystroke path can start by accident. The bee constructs its own service. */
export interface MoleculeIndexReader {
  addressOf(word: unknown): Promise<string | null>
  holds(word: unknown): Promise<boolean>
  vocabulary(): Promise<ReadonlyMap<string, MoleculeWord>>
  fallbackVocabulary(): Promise<ReadonlyMap<string, MoleculeWord>>
  declaredVocabulary(): Promise<ReadonlySet<string>>
  declaredVocabularyPartial(): Promise<boolean>
  readRecord(layerSig: string): Promise<MoleculeRecord | null>
  /** One subtree's vocabulary, with the pool as an accelerator and never as a
   *  dependency. THE READ A PUBLISH USES. */
  subtreeVocabulary(layerSig: string): Promise<MoleculeRecord | null>
  rootSig(): Promise<string | null>
}

export const moleculeIndexReader = (service: MoleculeIndexService): MoleculeIndexReader =>
  Object.freeze({
    addressOf: service.addressOf,
    holds: service.holds,
    vocabulary: service.vocabulary,
    fallbackVocabulary: service.fallbackVocabulary,
    declaredVocabulary: service.declaredVocabulary,
    declaredVocabularyPartial: service.declaredVocabularyPartial,
    readRecord: service.readRecord,
    subtreeVocabulary: service.subtreeVocabulary,
    rootSig: () => service.rootSig(),
  })

if ((window as unknown as { ioc?: { register?: (k: string, v: unknown) => void } }).ioc?.register) {
  (window as unknown as { ioc: { register: (k: string, v: unknown) => void } })
    .ioc.register(MOLECULE_INDEX_SERVICE_KEY, moleculeIndexReader(new MoleculeIndexService()))
}
