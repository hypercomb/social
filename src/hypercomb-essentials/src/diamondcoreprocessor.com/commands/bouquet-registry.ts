// bouquet-registry.ts
//
// Moved down from hypercomb-shared in the everything-is-a-beehavior Phase 1 —
// rides the commands bundle (slash-behaviour.drone is the ONE importer).
// Consumers keep reaching it via IoC ('@hypercomb.social/BouquetRegistry').
//
// BOUQUETS — a group of pheromones. Not an optional one: marks in hand ARE a
// bouquet from the first one, and a name is a later, separate act.
//
// A bee never emits one compound, it emits a blend, and the blend is what the
// hive reads; the apiological word for that blend is a bouquet, so that is the
// word here. A bouquet is the set you PUT ON things together — `part` + `page`
// + `website` in one gesture. It is deliberately NOT the other thing a "group
// of pheromones" could mean: a set you are WATCHING for is a filter over marks,
// derived at read time, and keeps its own word (`interest`). This registry
// holds only the first kind, because only the first kind is truth.
//
// The scenting surface always carried a bouquet — pick several pheromones and
// every tile lands the lot (`tags:apply-begin {tags[]}`). What was missing was
// the identity, which `mint()` gives it whether or not it is ever named, and
// the persistence, which `save()` gives it when it is.
//
// ── storage ───────────────────────────────────────────────────────────────
// Each bouquet's MARKS are a content-addressed resource (sig-named file at the
// flat OPFS root, via Store.putResource); the master list maps name → that sig
// and rides the `bouquets-master` record in the sign('registry') pool, beside
// `tags-master` and `names-master`. No new pool of meaning is minted: this is
// participant registry state of exactly the same species as the tag list.
//
// Marks are SORTED before signing, so the same set picked in a different order
// is the same bytes and therefore the same signature — two participants who
// assemble the same bouquet independently hold one resource, and a bouquet can
// be shared as a signature the day sharing wants it.

import { EffectBus, SignatureService } from '@hypercomb/core'

/** name → the signature of that bouquet's marks resource. */
type BouquetMap = Record<string, { sig: string }>

const MASTER_KEY = 'bouquets-master'
/** Pool of meaning holding the registry pointer records. Address =
 *  sign('registry'), derived by Store — never hardcode the hex. */
const REGISTRY_MEANING = 'registry'

export interface Bouquet {
  name: string
  /** Signature of the marks resource — the bouquet's identity. */
  sig: string
  marks: string[]
}

export class BouquetRegistry extends EventTarget {

  #bouquets: BouquetMap = {}
  /** Resolved marks by signature. The master holds pointers; this is the
   *  expansion, populated on load and on every save. */
  #marks = new Map<string, string[]>()
  #loaded = false
  #loading: Promise<void> | null = null

  /** Every bouquet, name-sorted, with its marks already expanded. */
  get all(): Bouquet[] {
    return Object.keys(this.#bouquets)
      .sort((a, b) => a.localeCompare(b))
      .map(name => ({ name, sig: this.#bouquets[name].sig, marks: this.marks(name) }))
  }

  get names(): string[] { return Object.keys(this.#bouquets).sort((a, b) => a.localeCompare(b)) }

  /** The marks of one bouquet — empty if unknown or not yet expanded. */
  marks(name: string): string[] {
    const sig = this.#bouquets[name]?.sig
    return sig ? (this.#marks.get(sig) ?? []) : []
  }

  /** The bouquet's identity. This is the thing that gets shared. */
  sigOf(name: string): string | undefined { return this.#bouquets[name]?.sig }

  async ensureLoaded(): Promise<void> {
    if (this.#loaded) return
    if (this.#loading) return this.#loading
    this.#loading = this.#load()
    await this.#loading
    this.#loading = null
    this.#announce()
  }

  /** The signature a set of marks WOULD have — derived, never written.
   *
   *  Marks in hand are a bouquet before anyone names one, so the identity has
   *  to be knowable while gathering. But gathering passes through every
   *  intermediate set on the way to the one you meant, and writing each of
   *  those would leave a resource at the content root for every combination
   *  nobody asked for. Content addressing means the signature is a property of
   *  the bytes, not of having stored them — so derive it here, and let `save`
   *  be the thing that commits bytes. */
  async signatureOf(marks: readonly string[]): Promise<string | null> {
    const clean = this.#canonical(marks)
    if (clean.length === 0) return null
    const sig = await SignatureService.sign(new TextEncoder().encode(this.#bytes(clean)).buffer as ArrayBuffer)
    this.#marks.set(sig, clean)
    return sig
  }

  /** Commit the marks resource. Same canonical bytes as `signatureOf`, so the
   *  derived signature and the stored one are always the same string. */
  async mint(marks: readonly string[]): Promise<string | null> {
    const clean = this.#canonical(marks)
    if (clean.length === 0) return null
    const sig = await this.#putMarks(clean)
    if (sig) this.#marks.set(sig, clean)
    return sig
  }

  /** Name a bouquet that already exists. Re-using an existing name replaces its
   *  contents — the name is the address, so this is an update, not a second
   *  bouquet (and the old marks resource stays valid forever, as resources do). */
  async save(name: string, marks: readonly string[]): Promise<string | null> {
    const clean = this.#canonical(marks)
    if (!name.trim() || clean.length === 0) return null
    await this.ensureLoaded()
    const sig = await this.mint(clean)
    if (!sig) return null
    this.#bouquets[name.trim()] = { sig }
    await this.#save()
    return sig
  }

  /** Forget a bouquet. The marks resource is left alone — it is content-
   *  addressed and may be referenced elsewhere; only the name goes. */
  async remove(name: string): Promise<void> {
    await this.ensureLoaded()
    if (!(name in this.#bouquets)) return
    delete this.#bouquets[name]
    await this.#save()
  }

  /** Sorted, de-duplicated, blank-free — the canonical form that makes the
   *  signature a property of the SET rather than of the picking order. */
  #canonical(marks: readonly string[]): string[] {
    return [...new Set(marks.map(m => m.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b))
  }

  /** The bouquet's bytes. ONE definition, used by both the derived signature
   *  and the stored resource — if these two ever disagree, a named bouquet
   *  would resolve to nothing. */
  #bytes(marks: string[]): string {
    return JSON.stringify({ marks })
  }

  // ── persistence ────────────────────────────────────────────────────

  async #load(): Promise<void> {
    try {
      const store = this.#store()
      if (!store) return
      const sig = await this.#readPointer(store)
      if (!sig) { this.#loaded = true; return }
      const blob = await store.getResource(sig)
      if (!blob) { this.#loaded = true; return }
      this.#bouquets = JSON.parse(await blob.text())
      // Expand every pointer once, up front: the panel reads marks
      // synchronously while rendering, so a lazy resolve would show empty
      // bouquets on first paint and fill in a beat later.
      await Promise.all(Object.values(this.#bouquets).map(b => this.#readMarks(store, b.sig)))
    } catch { /* first load or corrupted — start empty */ }
    this.#loaded = true
  }

  async #readMarks(store: any, sig: string): Promise<void> {
    if (this.#marks.has(sig)) return
    try {
      const blob = await store.getResource(sig)
      if (!blob) return
      const parsed = JSON.parse(await blob.text())
      if (Array.isArray(parsed?.marks)) this.#marks.set(sig, parsed.marks.filter((m: unknown) => typeof m === 'string'))
    } catch { /* unresolvable pointer — the bouquet reads empty rather than throwing */ }
  }

  async #putMarks(marks: string[]): Promise<string | null> {
    try {
      const store = this.#store()
      if (!store) return null
      const blob = new Blob([this.#bytes(marks)], { type: 'application/json' })
      return await store.putResource(blob)
    } catch { return null }
  }

  async #save(): Promise<void> {
    try {
      const store = this.#store()
      if (!store) return
      const blob = new Blob([JSON.stringify(this.#bouquets)], { type: 'application/json' })
      const sig = await store.putResource(blob)
      await this.#writePointer(store, sig)
    } catch { /* OPFS write failed — in-memory state still valid */ }
    this.#announce()
  }

  #announce(): void {
    this.dispatchEvent(new Event('change'))
    EffectBus.emit('bouquets:registry', { bouquets: this.all })
  }

  async #readPointer(store: any): Promise<string | null> {
    try {
      const pool = await store.getPool?.(REGISTRY_MEANING)
      if (!pool) return null
      const fh = await pool.getFileHandle(MASTER_KEY)
      const sig = (await (await fh.getFile()).text()).trim()
      return sig || null
    } catch { return null }
  }

  async #writePointer(store: any, sig: string): Promise<void> {
    const pool = await store.getPool?.(REGISTRY_MEANING)
    if (!pool) throw new Error('registry pool unavailable')
    const fh = await pool.getFileHandle(MASTER_KEY, { create: true })
    const writable = await fh.createWritable()
    try { await writable.write(sig) } finally { await writable.close() }
  }

  #store(): any {
    return (window as any).ioc?.get?.('@hypercomb.social/Store')
  }
}

export const bouquetRegistry = new BouquetRegistry()

/** Re-assert into the LIVE IoC map (the llm-provider-registry lesson). */
export const ensureBouquetRegistryRegistered = (): void => {
  if (!window.ioc?.has?.('@hypercomb.social/BouquetRegistry')) {
    window.ioc?.register?.('@hypercomb.social/BouquetRegistry', bouquetRegistry)
  }
}
ensureBouquetRegistryRegistered()
