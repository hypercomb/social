// hypercomb-shared/core/interest-registry.ts
//
// INTERESTS — the marks you are WATCHING FOR, and the marks you never want.
//
// The mirror of a bouquet, and the word is not invented here: `bouquet-registry.ts`
// draws the distinction and reserves this half of it —
//
//   "A bouquet is the set you PUT ON things together … It is deliberately NOT
//    the other thing a 'group of pheromones' could mean: a set you are WATCHING
//    for is a filter over marks, derived at read time, and keeps its own word
//    (`interest`)."
//
// Same species, opposite direction. A bouquet is outbound — it scents things.
// An interest is inbound — it decides what an intake keeps. Everything
// structural is therefore copied from the bouquet registry on purpose, down to
// the canonical sort: an interest's identity must be a property of the SET, so
// two participants who assemble the same one independently hold one resource.
//
// THAT IS ALSO THE COLD-START ANSWER. A new participant's filter is empty, and
// the fix is not a default blocklist shipped in the shell — it is that an
// interest IS a signature somebody can hand you. Adopting a filter becomes the
// same act as adopting anything else here, and because it is content-addressed
// it does not bind you to its author: edit it and it is a different signature,
// with nothing anywhere to update.
//
// ── storage ───────────────────────────────────────────────────────────────
// Each interest's MARKS are a content-addressed resource (sig-named file at the
// flat OPFS root, via Store.putResource); the master record maps name → that
// sig and is THE CURRENT DOCUMENT of this registry's own pool,
// `sign('registry:interests')` — read and written through the shared
// `registry-document.ts` helper, exactly as bouquets, names and tags now are.
//
// It is a pool of its own rather than another file in `sign('registry')`
// because the master record IS the document: one meaning, one current member,
// one writer. A shared directory with a pointer file per registry gave four
// writers one directory and an indirection that could dangle.
//
// ── the two roles ─────────────────────────────────────────────────────────
// An intake needs two sets, because the participant said two different things:
// "filter down to things that relate to you" (KEEP) and "people tag it and
// you'll filter that out too" (DROP). They are ordinary named interests; the
// master record additionally says WHICH named interest is currently playing
// each role, so a role is a pointer and never a fourth kind of storage.
//
// POLARITY, AND WHY IT IS CONSERVATIVE. An empty KEEP set is NO FILTER, not an
// empty hive. That matches the only intake filter that ships today
// (`SwarmFilterService`: "Empty selection = no filter = everyone shows") and it
// means installing this changes nothing until a participant expresses an
// interest. DROP always applies and beats KEEP — an excluded mark is a refusal,
// and a refusal that a positive match could override would not be one.
//
// Full doctrine: documentation/intake-filter.md.

import { EffectBus, SignatureService } from '@hypercomb/core'
import { readRegistryDocument, writeRegistryDocument } from './registry-document.js'

/** name → the signature of that interest's marks resource. */
type InterestMap = Record<string, { sig: string }>

/** The master record. `interests` is the same shape the bouquet master has;
 *  `keep` / `drop` name which of them the intake is currently using. */
type InterestFile = {
  interests: InterestMap
  keep?: string
  drop?: string
}

/** This registry's own document pool. Each registry owns a meaning of its own
 *  (`registry:bouquets`, `registry:names`, `registry:tags`) rather than sharing
 *  one `sign('registry')` directory: the master record IS the pool's current
 *  document, so there is no pointer file and exactly one writer per pool.
 *  Seeded in `pool-registry.ts` and declared `document` in `pool-kinds.ts`. */
const INTERESTS_REGISTRY_MEANING = 'registry:interests'
/** Nothing ever wrote this — the registry is new and its document pool is its
 *  first home. Passed only so the read has the same shape as its siblings',
 *  which do have a pointer era to drain; it costs one handle miss on a cold
 *  load and keeps the family reading identically. */
const LEGACY_MASTER_KEY = 'interests-master'

export interface Interest {
  name: string
  /** Signature of the marks resource — the interest's identity. */
  sig: string
  marks: string[]
}

/** What an intake needs, already resolved. Sets, not promises: the render and
 *  gesture call sites decide synchronously (see documentation/intake-filter.md
 *  — "a sync moment may only ask the location carrier"). */
export type IntakeSets = { keep: ReadonlySet<string>; drop: ReadonlySet<string> }

const EMPTY: IntakeSets = { keep: new Set(), drop: new Set() }

export class InterestRegistry extends EventTarget {

  #file: InterestFile = { interests: {} }
  /** Resolved marks by signature. The master holds pointers; this is the
   *  expansion, populated on load and on every save. */
  #marks = new Map<string, string[]>()
  #loaded = false
  #loading: Promise<void> | null = null
  /** The resolved KEEP/DROP sets, rebuilt on every change. Held so the sync
   *  callers never touch a promise. */
  #sets: IntakeSets = EMPTY

  /** Every interest, name-sorted, with its marks already expanded. */
  get all(): Interest[] {
    return Object.keys(this.#file.interests)
      .sort((a, b) => a.localeCompare(b))
      .map(name => ({ name, sig: this.#file.interests[name]!.sig, marks: this.marks(name) }))
  }

  get names(): string[] { return Object.keys(this.#file.interests).sort((a, b) => a.localeCompare(b)) }

  /** The marks of one interest — empty if unknown or not yet expanded. */
  marks(name: string): string[] {
    const sig = this.#file.interests[name]?.sig
    return sig ? (this.#marks.get(sig) ?? []) : []
  }

  /** The interest's identity. This is the thing that gets shared. */
  sigOf(name: string): string | undefined { return this.#file.interests[name]?.sig }

  /** Which named interest plays each intake role, or undefined. */
  get roles(): { keep?: string; drop?: string } {
    return { keep: this.#file.keep, drop: this.#file.drop }
  }

  /**
   * THE SYNCHRONOUS READ the intake gates use. Safe to call per rendered tile:
   * it is a field read, never a promise, and never an OPFS round trip.
   *
   * Empty until `ensureLoaded()` has run, which is the honest failure mode —
   * an intake that has not loaded its filter yet lets content through rather
   * than blanking the screen while a read is in flight.
   */
  sets(): IntakeSets { return this.#sets }

  /**
   * Does content wearing `marks` survive the intake?
   *
   * DROP first and unconditionally — an excluded mark is a refusal. Then KEEP,
   * but only if a KEEP set exists: no expressed interest means no positive
   * filter, so everything that was not dropped is kept.
   */
  allows(marks: readonly string[]): boolean {
    const { keep, drop } = this.#sets
    if (drop.size) for (const m of marks) if (drop.has(m)) return false
    if (!keep.size) return true
    // UNKNOWN IS NOT ABSENT — and this is the difference between a filter and
    // a blackout. BOTH mark carriers are participant-LOCAL: `tagsForSegments`
    // reads an in-memory index filled by this participant's own decoration
    // scans, and `sigMarksOf` reads this participant's own
    // `pheromones:content` pool. Content that just arrived from somebody else
    // has no entry in either, so it presents ZERO marks — not "no marks I
    // want", but "no marks I have heard of yet".
    //
    // Judging that by a KEEP set refuses every peer tile in the swarm, every
    // member a domain publishes, and every branch anybody offers, the moment a
    // participant names a single interest. So an unmarked thing is not a
    // MISMATCH; a KEEP set may only ever exclude something that carries marks
    // and carries none of yours.
    if (!marks.length) return true
    for (const m of marks) if (keep.has(m)) return true
    return false
  }

  async ensureLoaded(): Promise<void> {
    if (this.#loaded) return
    if (this.#loading) return this.#loading
    this.#loading = this.#load()
    await this.#loading
    this.#loading = null
    this.#announce()
  }

  /** The signature a set of marks WOULD have — derived, never written. Same
   *  reasoning as the bouquet registry's: gathering passes through every
   *  intermediate set, and storing each would litter the content root. */
  async signatureOf(marks: readonly string[]): Promise<string | null> {
    const clean = this.#canonical(marks)
    if (clean.length === 0) return null
    const sig = await SignatureService.sign(new TextEncoder().encode(this.#bytes(clean)).buffer as ArrayBuffer)
    this.#marks.set(sig, clean)
    return sig
  }

  /** Commit the marks resource. Same canonical bytes as `signatureOf`. */
  async mint(marks: readonly string[]): Promise<string | null> {
    const clean = this.#canonical(marks)
    if (clean.length === 0) return null
    const sig = await this.#putMarks(clean)
    if (sig) this.#marks.set(sig, clean)
    return sig
  }

  /** Name an interest. Re-using a name replaces its contents — the name is the
   *  address, so this is an update, and the old marks resource stays valid
   *  forever, as resources do. */
  async save(name: string, marks: readonly string[]): Promise<string | null> {
    const clean = this.#canonical(marks)
    if (!name.trim() || clean.length === 0) return null
    await this.ensureLoaded()
    const sig = await this.mint(clean)
    if (!sig) return null
    this.#file.interests[name.trim()] = { sig }
    await this.#save()
    return sig
  }

  /** ADOPT an interest somebody handed you, by its signature alone. The marks
   *  resource is content-addressed, so this needs no permission, no author and
   *  no network beyond having the bytes — which is what makes a filter
   *  shareable rather than shipped. */
  async adopt(name: string, sig: string): Promise<boolean> {
    if (!name.trim() || !/^[0-9a-f]{64}$/i.test(sig)) return false
    await this.ensureLoaded()
    const store = this.#store()
    if (!store) return false
    await this.#readMarks(store, sig.toLowerCase())
    if (!this.#marks.has(sig.toLowerCase())) return false
    this.#file.interests[name.trim()] = { sig: sig.toLowerCase() }
    await this.#save()
    return true
  }

  /** Forget an interest. The marks resource is left alone — content-addressed
   *  and possibly referenced elsewhere; only the name goes. A role pointing at
   *  it is cleared, or it would name something that no longer resolves. */
  async remove(name: string): Promise<void> {
    await this.ensureLoaded()
    if (!(name in this.#file.interests)) return
    delete this.#file.interests[name]
    if (this.#file.keep === name) delete this.#file.keep
    if (this.#file.drop === name) delete this.#file.drop
    await this.#save()
  }

  /** Point an intake role at a named interest, or at nothing (`''`). */
  async setRole(role: 'keep' | 'drop', name: string): Promise<boolean> {
    await this.ensureLoaded()
    const clean = name.trim()
    if (clean && !(clean in this.#file.interests)) return false
    if (clean) this.#file[role] = clean
    else delete this.#file[role]
    await this.#save()
    return true
  }

  /** Sorted, de-duplicated, blank-free — the canonical form that makes the
   *  signature a property of the SET rather than of the picking order. */
  #canonical(marks: readonly string[]): string[] {
    // CODE-UNIT ORDER, NOT `localeCompare`. The signature has to be a property
    // of the SET for two participants to land on one resource — that is the
    // whole of "a filter is a signature somebody can hand you". `localeCompare`
    // answers by the runtime's collation, so the same marks sorted under a
    // different locale or ICU build hash to a different address and the sharing
    // claim quietly stops being true. Default `sort()` is byte-stable
    // everywhere. (`bouquet-registry.ts` still uses localeCompare; its
    // signature is only ever compared against itself, so it does not have this
    // problem yet — but it is the same latent one.)
    return [...new Set(marks.map(m => m.trim()).filter(Boolean))].sort()
  }

  /** The interest's bytes. ONE definition, used by both the derived signature
   *  and the stored resource. Deliberately the SAME shape a bouquet writes
   *  (`{ marks }`) — the two are the same kind of thing pointed opposite ways,
   *  so a set assembled as one can be adopted as the other without conversion. */
  #bytes(marks: string[]): string {
    return JSON.stringify({ marks })
  }

  /** Rebuild the resolved sets from the roles. Called on every change, so
   *  `sets()` and `allows()` are always current without awaiting. */
  #resolve(): void {
    const of = (name?: string): ReadonlySet<string> =>
      new Set(name ? this.marks(name) : [])
    this.#sets = { keep: of(this.#file.keep), drop: of(this.#file.drop) }
  }

  // ── persistence ────────────────────────────────────────────────────

  async #load(): Promise<void> {
    try {
      const store = this.#store()
      if (!store) return
      const parsed = await readRegistryDocument<InterestFile | InterestMap>(
        store, INTERESTS_REGISTRY_MEANING, LEGACY_MASTER_KEY)
      if (!parsed) { this.#loaded = true; return }
      // Tolerate a bare map, the bouquet master's shape: an interest file
      // written before roles existed is still a valid list of interests.
      this.#file = (parsed as InterestFile).interests
        ? parsed as InterestFile
        : { interests: parsed as InterestMap }
      await Promise.all(Object.values(this.#file.interests).map(i => this.#readMarks(store, i.sig)))
    } catch { /* first load or corrupted — start empty */ }
    this.#loaded = true
    this.#resolve()
  }

  async #readMarks(store: any, sig: string): Promise<void> {
    if (this.#marks.has(sig)) return
    try {
      const blob = await store.getResource(sig)
      if (!blob) return
      const parsed = JSON.parse(await blob.text())
      if (Array.isArray(parsed?.marks)) this.#marks.set(sig, parsed.marks.filter((m: unknown) => typeof m === 'string'))
    } catch { /* unresolvable pointer — the interest reads empty rather than throwing */ }
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
      await writeRegistryDocument(store, INTERESTS_REGISTRY_MEANING, this.#file)
    } catch { /* OPFS write failed — in-memory state still valid */ }
    this.#resolve()
    this.#announce()
  }

  #announce(): void {
    this.dispatchEvent(new Event('change'))
    EffectBus.emit('interests:registry', { interests: this.all, roles: this.roles })
  }

  #store(): any {
    return (window as any).ioc?.get?.('@hypercomb.social/Store')
  }
}

register('@hypercomb.social/InterestRegistry', new InterestRegistry())
