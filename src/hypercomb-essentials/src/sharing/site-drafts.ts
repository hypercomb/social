// sharing/site-drafts.ts
//
// HOME, HELD (jwize, 2026-11-20): Publish on a card carries the owner's
// drafts with the card. The drafts ride as ONE `module:drafts` decoration on
// the card's root: signatures only (each draft's root, the layer its pick
// names, the module it was written into, and every module that layer adds
// over the trunk — its own and any earlier draft in the folder), never a
// ruling, an acceptance or a time — so the same drafts always give the same
// record, and a card whose drafts did not change is not changed by carrying
// them. Where the card arrives on the owner's hive or another of his devices,
// each draft is put back HELD (site-replica.ts restoreDrafts); visitors never
// run it, and acceptance never travels.
//
// DEPENDENCY DRAFTS (jwize, 2026-11-24: "work on dependency drafts travelling
// home") ride in a decoration of their own, `module:dependency-drafts`, of
// the same shape, beside the bee drafts' `module:drafts`. Never in the bee
// record: a READER from before them would settle a dependency entry there as
// tampered, for good, and a WRITER from before them (an owner device not yet
// Updated) rebuilds `module:drafts` from its own bee drafts on every Publish,
// so it would take them off the card unannounced. Neither lists the other
// kind. A card carrying bee drafts alone keeps the record, and the
// signature, it had. They go on the card only through a publish port that can
// read their bundles (`carriesDependencyParts`), and come off it only through
// a runtime that can put them back (site-replica.ts, `restoresDependencies`).
// On the card that record names ONE resource, its listing, and the drafts
// and their parts sit inside it (decoration-closure.ts
// `dependencyDraftsListingBytes`): a walker from before them takes the listing
// for a leaf, so it never walks down through a draft root into the trunk it
// names. Everything here plans with the record as the listing reads (`record`);
// only the write and the read of the card see the listing.
//
// The record is written through the ordinary decoration machinery
// (decoration-manifest.ts), so the commit, the hot index and the publish
// closure (hypercomb-shim managed-publish.ts: a `module:drafts` record's refs
// are `part`s, each one must be held) all treat it as they treat any other.
// No credentials, no raw storage writes.
//
// A dependency: it exports, registers nothing.

import * as hypercombCore from '@hypercomb/core'
import { SignatureService, broodRecord, type BroodRecord, type CarriedModuleDraft, type ModuleDraftsProvider } from '@hypercomb/core'

// Read off the namespace, never named: a page whose core predates
// broodRecordOnDisk must still load this package (it then reads the session
// copy, which only makes "knows" less sure, never more).
const recordOnDisk = (sig: string): Promise<BroodRecord | null> =>
  ((hypercombCore as { broodRecordOnDisk?: (sig: string) => Promise<BroodRecord | null> }).broodRecordOnDisk ?? broodRecord)(sig)
import { listDecorations, removeDecorationAndWait, writeDecoration } from '../commands/decoration-manifest.js'
import { collectSigsDeep, dependencyDraftsListingBytes, readDependencyDraftsListing } from './decoration-closure.js'
import { DEPENDENCY_DRAFTS_KIND, DRAFTS_KIND, DRAFTS_MAX, replicaLocation, replicaRoute, type CommitterLike, type HistoryLike } from './site-replica.js'

export { DEPENDENCY_DRAFTS_KIND, DRAFTS_KIND } from './site-replica.js'

/** Which record a draft rides in: bee drafts, or dependency drafts. */
export type DraftsKind = typeof DRAFTS_KIND | typeof DEPENDENCY_DRAFTS_KIND
const SIG_RE = /^[0-9a-f]{64}$/

/** One draft as the record carries it: its root, the layer its pick names,
 *  the module it was written into ('' for a new file), and every module the
 *  layer adds over the trunk (`parts`, the draft's own module among them) —
 *  for a dependency draft (`kind`), every bundle its root lists beyond the
 *  trunk's. On the card the kind is said by the record the entry is written
 *  in, never by a field of its own. */
export type CarriedDraftEntry = {
  readonly root: string; readonly layer: string; readonly from: string; readonly parts: readonly string[]
  readonly kind?: 'dependency'
}

/** An entry as it is written: its kind left to the record. */
export type WrittenDraftEntry = { readonly root: string; readonly layer: string; readonly from: string; readonly parts: readonly string[] }

/** The record as it is written (decoration-manifest.ts writeDecoration's shape and key order). */
export type DraftsRecord = {
  readonly kind: DraftsKind
  readonly appliesTo: readonly string[]
  readonly payload: { readonly drafts: readonly WrittenDraftEntry[] }
  readonly refs: readonly string[]
}

/** Does the card already carry exactly this record (or, for none, none)? */
const sameRecord = (composed: ComposedDrafts | null, onCard: readonly DraftsOnCard[]): boolean =>
  composed ? onCard.length === 1 && onCard[0]!.sig === composed.sig : onCard.length === 0

const kindOfEntry = (entry: { readonly kind?: 'dependency' }): DraftsKind =>
  entry.kind === 'dependency' ? DEPENDENCY_DRAFTS_KIND : DRAFTS_KIND

/** `record` is the drafts as they are planned with; `sig` is the decoration
 *  as it lands on the card. For dependency drafts that decoration names only
 *  `listing` (its signature and bytes), which is written first. */
export type ComposedDrafts = {
  readonly record: DraftsRecord; readonly sig: string; readonly drafts: number
  readonly listing?: { readonly sig: string; readonly bytes: Uint8Array }
}

/** A drafts decoration on the card: its signature, and the record when it was read. */
export type DraftsOnCard = { readonly sig: string; readonly record?: unknown }

/** What carrying reads and writes, so a spec hands in its own. `list` reads
 *  the records of one kind (bee drafts when none is named). */
export type DraftDecorations = {
  list(segments: readonly string[], kind?: DraftsKind): Promise<readonly DraftsOnCard[]>
  /** Write the record; for dependency drafts, `listing` first and a decoration naming it alone. */
  write(record: DraftsRecord, segments: readonly string[], listing?: ComposedDrafts['listing']): Promise<string>
  remove(sig: string, segments: readonly string[]): Promise<void>
}

/** Were these modules written here, as this hive's own drafts? Read from
 *  disk (core broodRecordOnDisk). A draft put back here from a card is known
 *  by the receipt instead (`settled`): its hold is written before its pick is
 *  made, so a hold alone never says it ran here. */
export type KnowsDraft = (parts: readonly string[]) => Promise<boolean>

/** How a draft put back from a card is recorded in the brood (runtime module-drafts.ts). */
const CARRIED_HOME = ', carried home with '

type ResourceStore = { getResource?(sig: string): Promise<Blob | null>; putResource?(blob: Blob): Promise<string> }
const resourceStore = (): ResourceStore | undefined =>
  (globalThis as { ioc?: { get?: <T>(key: string) => T | undefined } }).ioc?.get?.<ResourceStore>('@hypercomb.social/Store')

/** A dependency drafts decoration as its listing reads: the drafts and their
 *  parts. Throws when the listing cannot be read here, so the card is
 *  "unreadable", never "carries nothing". */
const throughListing = async (found: { sig: string; record: unknown }): Promise<DraftsOnCard> => {
  const record = found.record as { kind?: unknown; appliesTo?: unknown; payload?: { listing?: unknown } } | undefined
  const listingSig = sig(record?.payload?.listing)
  if (!listingSig) return found
  const blob = await resourceStore()?.getResource?.(listingSig)
  const listing = blob ? readDependencyDraftsListing(new Uint8Array(await blob.arrayBuffer())) : null
  if (!listing) throw new Error(`[site-drafts] the dependency drafts listing ${listingSig} could not be read`)
  return { sig: found.sig, record: { kind: record?.kind, appliesTo: record?.appliesTo, payload: { drafts: listing.drafts }, refs: listing.refs } }
}

const liveDecorations: DraftDecorations = {
  // Strict: a record whose bytes cannot be read here may be the drafts record,
  // so the card is "unreadable", never "carries nothing" (planDrafts).
  list: async (segments, kind = DRAFTS_KIND) => {
    const found = await listDecorations({ kind, segments, strict: true })
    return kind === DEPENDENCY_DRAFTS_KIND ? Promise.all(found.map(throughListing)) : found
  },
  write: async (record, segments, listing) => {
    if (!listing) {
      return writeDecoration({ kind: record.kind, appliesTo: record.appliesTo, payload: record.payload, segments, refs: record.refs })
    }
    // The listing first: a decoration naming bytes this device does not hold is never written.
    const exact = listing.bytes.buffer.slice(listing.bytes.byteOffset, listing.bytes.byteOffset + listing.bytes.byteLength) as ArrayBuffer
    const put = await resourceStore()?.putResource?.(new Blob([exact]))
    if (put !== listing.sig) throw new Error('[site-drafts] the dependency drafts listing did not land')
    return writeDecoration({ kind: record.kind, appliesTo: record.appliesTo, payload: { listing: listing.sig }, segments, refs: [listing.sig] })
  },
  remove: (sig, segments) => removeDecorationAndWait({ sig, segments }),
}

const liveKnows: KnowsDraft = async parts => {
  if (!parts.length) return false
  for (const part of parts) {
    const record = await recordOnDisk(part).catch(() => null)
    if (record?.source.kind !== 'own' || !record.source.how?.startsWith('a draft of ') || record.source.how.includes(CARRIED_HOME)) return false
  }
  return true
}

const sig = (value: unknown): string => {
  const text = String(value ?? '').trim().toLowerCase()
  return SIG_RE.test(text) ? text : ''
}

const sigs = (value: unknown): string[] =>
  [...new Set((Array.isArray(value) ? value : []).map(sig).filter(Boolean))].sort()

/** A draft this device carries, as the record names it. */
const entryOfCarried = (entry: CarriedModuleDraft | null | undefined): CarriedDraftEntry | null => {
  const root = sig(entry?.root), layer = sig(entry?.layer), to = sig(entry?.to), from = sig(entry?.from)
  if (!root || !layer || !to) return null
  return { root, layer, from, parts: sigs([to, ...(entry?.parts ?? [])]), ...(entry?.kind === 'dependency' ? { kind: 'dependency' as const } : {}) }
}

/** The drafts a card's records of `kind` name, as they name them. */
const entriesOnCard = (onCard: readonly DraftsOnCard[], kind: DraftsKind): CarriedDraftEntry[] => onCard.flatMap(found => {
  const record = found.record as { kind?: unknown; payload?: { drafts?: unknown } } | undefined
  if (record?.kind !== kind || !Array.isArray(record.payload?.drafts)) return []
  return record.payload.drafts.flatMap((entry: { root?: unknown; layer?: unknown; from?: unknown; parts?: unknown }) => {
    const root = sig(entry?.root), layer = sig(entry?.layer), parts = sigs(entry?.parts)
    return root && layer && parts.length
      ? [{ root, layer, from: sig(entry?.from), parts, ...(kind === DEPENDENCY_DRAFTS_KIND ? { kind: 'dependency' as const } : {}) }]
      : []
  })
})

/**
 * THE RECORD THESE DRAFTS MAKE, for the card at `appliesTo`. Deterministic:
 * the drafts are deduplicated and sorted by root, and `refs` is formed exactly
 * as writeDecoration forms it (the payload's signatures, then every declared
 * part, sorted), so the signature computed here is the one the write lands.
 * Never more than a reader takes (DRAFTS_MAX): the first ones given stay,
 * this device's own before the ones kept from the card. Null when there are
 * none.
 */
async function recordOf(entries: readonly CarriedDraftEntry[], appliesTo: readonly string[], kind: DraftsKind = DRAFTS_KIND): Promise<ComposedDrafts | null> {
  const byRoot = new Map<string, CarriedDraftEntry>()
  for (const entry of entries) if (kindOfEntry(entry) === kind && !byRoot.has(entry.root) && byRoot.size < DRAFTS_MAX) byRoot.set(entry.root, entry)
  if (byRoot.size === 0) return null
  const sorted = [...byRoot.values()].sort((a, b) => (a.root < b.root ? -1 : a.root > b.root ? 1 : 0))
  const payload = { drafts: sorted.map(({ root, layer, from, parts }): WrittenDraftEntry => ({ root, layer, from, parts: [...parts] })) }
  const declared = [...new Set(sorted.flatMap(e => [e.root, e.layer, e.from, ...e.parts]).filter(Boolean))].sort()
  const refs = [...new Set([...collectSigsDeep(payload), ...declared])]
  const record: DraftsRecord = { kind, appliesTo: [...appliesTo], payload, refs }
  const signOf = (bytes: Uint8Array): Promise<string> =>
    SignatureService.sign(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
  if (kind === DEPENDENCY_DRAFTS_KIND) {
    // On the card: a decoration naming the listing alone, in writeDecoration's shape.
    const bytes = dependencyDraftsListingBytes({ drafts: payload.drafts, refs })
    const listing = { sig: await signOf(bytes), bytes }
    const landed = { kind, appliesTo: [...appliesTo], payload: { listing: listing.sig }, refs: [listing.sig] }
    return { record, sig: await signOf(new TextEncoder().encode(JSON.stringify(landed))), drafts: sorted.length, listing }
  }
  return { record, sig: await signOf(new TextEncoder().encode(JSON.stringify(record))), drafts: sorted.length }
}

/** This device's drafts, read through the provider; undefined when they
 *  cannot be known. `cameHome` names the ones that came home here with a card
 *  (the provider's `carried`), not written here. */
async function carriedHere(provider: Pick<ModuleDraftsProvider, 'carry'> | null | undefined): Promise<(CarriedDraftEntry & { readonly cameHome?: true })[] | undefined> {
  if (typeof provider?.carry !== 'function') return undefined
  let carried: Awaited<ReturnType<NonNullable<ModuleDraftsProvider['carry']>>>
  // Dependency drafts asked for: a runtime from before them ignores the ask
  // and gives bee drafts alone; either way each comes marked by its kind.
  try { carried = await provider.carry({ dependencies: true }) } catch { return undefined }
  return (carried ?? []).flatMap(entry => {
    const made = entryOfCarried(entry)
    return made ? [entry?.carried === true ? { ...made, cameHome: true as const } : made] : []
  })
}

/**
 * THE RECORD THIS DEVICE'S DRAFTS MAKE, alone, of one kind (bee drafts when
 * none is named). `null` when there are no drafts to carry. `undefined` when
 * it cannot be known (no provider, or it would not say): the card is then
 * left as it is — never stripped of drafts because they could not be read.
 */
export async function composeDraftsRecord(
  provider: Pick<ModuleDraftsProvider, 'carry'> | null | undefined,
  appliesTo: readonly string[],
  kind: DraftsKind = DRAFTS_KIND,
): Promise<ComposedDrafts | null | undefined> {
  const here = await carriedHere(provider)
  return here === undefined ? undefined : recordOf(here, appliesTo, kind)
}

/** The drafts picked here, over any trunk, by their roots; undefined when
 *  they cannot be read. A draft kept through Update all still runs here,
 *  though it is no longer one this device carries (carryableDrafts). */
async function pickedHere(provider: Partial<Pick<ModuleDraftsProvider, 'list'>> | null | undefined): Promise<Set<string> | undefined> {
  if (typeof provider?.list !== 'function') return new Set()
  try { return new Set((await provider.list()).map(draft => sig(draft?.rootSig)).filter(Boolean)) } catch { return undefined }
}

/** What a Publish does to one of the card's drafts records. */
export type DraftsRecordPlan = {
  /** What the card carries in it after the Publish; null for nothing. */
  readonly composed: ComposedDrafts | null
  readonly onCard: readonly DraftsOnCard[]
  /** The card already carries exactly that. */
  readonly unchanged: boolean
}

/** What a Publish does to the card's drafts: the bee drafts' record at the
 *  top (as it always was), the dependency drafts' beside it. */
export type DraftsPlan = DraftsRecordPlan & {
  readonly dependencies: DraftsRecordPlan
  /** How many drafts the card carries after it, of both kinds. */
  readonly drafts: number
  /** This device runs drafts the card does not carry: Publish is owed them. */
  readonly owed: boolean
  /** Drafts the card carries that this Publish takes off. */
  readonly dropped: number
  /** The roots of the drafts this device runs that the card carries after it. */
  readonly running: readonly string[]
}

/**
 * WHAT THE CARD CARRIES AFTER THIS DEVICE PUBLISHES: every draft this device
 * runs (written here, or come home here while the card still carries it), and every draft the card carries
 * that this device knows nothing of — one over another build that never came
 * home here, or one from a device whose work this one has not seen — kept as
 * the card carries it. Only a draft this device knows and no longer runs
 * (dropped, refused, or drafted over here) comes off, and the dialog says so.
 * Known: written here (`knows`), or put back from a card and settled here
 * (`settled`, the receipt's roots). One still picked here (kept through Update
 * all) is running, never off. One put back but refused by a gate never ran
 * here, so it stays. A device that carries fewer drafts never strips the
 * others from the card. Undefined when this device's drafts or the card
 * cannot be read.
 *
 * `dependencyParts`: the publish port can send a dependency draft's bundles
 * (portCarriesDependencyParts). Without it, this device's dependency drafts
 * the card does not already carry stay off it and are not owed; the bee
 * drafts go on as ever, and dependency drafts already on the card stay.
 */
export async function planDrafts(
  provider: (Pick<ModuleDraftsProvider, 'carry'> & Partial<Pick<ModuleDraftsProvider, 'list'>>) | null | undefined,
  segments: readonly string[],
  decorations: Pick<DraftDecorations, 'list'> = liveDecorations,
  knows: KnowsDraft = liveKnows,
  settled: readonly string[] = [],
  dependencyParts = false,
): Promise<DraftsPlan | undefined> {
  if (!segments.length) return undefined
  const all = await carriedHere(provider)
  if (all === undefined) return undefined
  const picked = await pickedHere(provider)
  if (picked === undefined) return undefined
  let onCard: readonly DraftsOnCard[]
  let dependenciesOnCard: readonly DraftsOnCard[]
  try {
    [onCard, dependenciesOnCard] = await Promise.all([decorations.list(segments, DRAFTS_KIND), decorations.list(segments, DEPENDENCY_DRAFTS_KIND)])
  } catch { return undefined }
  const card = [...entriesOnCard(onCard, DRAFTS_KIND), ...entriesOnCard(dependenciesOnCard, DEPENDENCY_DRAFTS_KIND)]
  const carriedNow = new Set(card.map(entry => entry.root))
  // A draft that came home here rides with the card only while the card
  // carries it: the device that wrote it decides when it comes off, and one
  // that only received it never puts it back nor is owed it.
  // A dependency draft goes on only through a port that can send its
  // bundles; one already on the card stays, its bundles sent with it.
  const here = all.filter(entry => (!entry.cameHome || carriedNow.has(entry.root))
    && (entry.kind !== 'dependency' || dependencyParts || carriedNow.has(entry.root)))
  const running = new Set([...here.map(entry => entry.root), ...picked])
  const settledHere = new Set(settled)
  const kept: CarriedDraftEntry[] = []
  for (const entry of card) {
    if (picked.has(entry.root) && !here.some(mine => mine.root === entry.root)) { kept.push(entry); continue }
    if (running.has(entry.root)) continue
    if (settledHere.has(entry.root)) continue
    if (!(await knows(entry.parts).catch(() => false))) kept.push(entry)
  }
  const recordPlan = async (kind: DraftsKind, found: readonly DraftsOnCard[]): Promise<DraftsRecordPlan> => {
    const composed = await recordOf([...here, ...kept], segments, kind)
    return { composed, onCard: found, unchanged: sameRecord(composed, found) }
  }
  const bees = await recordPlan(DRAFTS_KIND, onCard)
  const dependencies = await recordPlan(DEPENDENCY_DRAFTS_KIND, dependenciesOnCard)
  const after = new Set([bees, dependencies].flatMap(plan => plan.composed?.record.payload.drafts.map(entry => entry.root) ?? []))
  return {
    ...bees,
    unchanged: bees.unchanged && dependencies.unchanged,
    dependencies,
    drafts: (bees.composed?.drafts ?? 0) + (dependencies.composed?.drafts ?? 0),
    // Only what this Publish would carry is owed: a draft past DRAFTS_MAX
    // never fits on the card, so it never keeps Publish asking.
    owed: here.some(entry => !carriedNow.has(entry.root) && after.has(entry.root)),
    dropped: new Set(card.filter(entry => !after.has(entry.root)).map(entry => entry.root)).size,
    running: [...after].filter(root => running.has(root)).sort(),
  }
}

/** Can the page's publish port carry a card's drafts? The port is host code
 *  (hypercomb-shim managed-publish.ts) and ships apart from essentials: one
 *  from before drafts travelled has no 'part' closure and cannot read the
 *  bees pool, so it would publish a card naming modules the host never got.
 *  `ownsThisCard` came with the drafts closure, so its presence is the sign.
 *  Without it, nothing goes on the card and no Publish is owed for drafts. */
export const portCarriesDrafts = (port: { readonly ownsThisCard?: unknown } | null | undefined): boolean =>
  typeof port?.ownsThisCard === 'function'

/** Can it send a dependency draft's bundles too? They sit in the dependencies
 *  pool, which a port from before them never reads, so it would publish a
 *  card naming bundles the host never got. Without it, dependency drafts stay
 *  off the card (planDrafts `dependencyParts`) and the bee drafts still go. */
export const portCarriesDependencyParts = (port: { readonly ownsThisCard?: unknown; readonly carriesDependencyParts?: unknown } | null | undefined): boolean =>
  portCarriesDrafts(port) && port?.carriesDependencyParts === true

/** Does this device run drafts the card at `lineage` does not carry? False
 *  when the drafts cannot be known. Carrying fewer is never owed. */
export async function draftsOwed(
  provider: Pick<ModuleDraftsProvider, 'carry'> | null | undefined,
  lineage: string,
  decorations: Pick<DraftDecorations, 'list'> = liveDecorations,
  knows: KnowsDraft = liveKnows,
  dependencyParts = false,
): Promise<boolean> {
  return (await planDrafts(provider, replicaRoute(lineage), decorations, knows, [], dependencyParts))?.owed ?? false
}

export type CarryServices = {
  readonly history: HistoryLike
  readonly committer?: CommitterLike
  readonly drafts?: (Pick<ModuleDraftsProvider, 'carry'> & Partial<Pick<ModuleDraftsProvider, 'list'>>) | null
  /** The carried draft roots settled on this device (the replica receipt's `drafts`). */
  readonly settled?: readonly string[]
  /** The plan the Publish dialog showed (planDrafts): written as it is, never
   *  planned again, so the card carries exactly what the owner was told. */
  readonly plan?: DraftsPlan
  /** The publish port can send dependency drafts' bundles (portCarriesDependencyParts). */
  readonly dependencyParts?: boolean
}

/**
 * PUT THE OWNER'S DRAFTS ON THE CARD, before its Publish: one `module:drafts`
 * record on the card's root (planDrafts), written before the one before it is
 * taken off, so a failed write never strips the card; none
 * at all when there are no drafts. Nothing is written when the record is
 * already there, or when the drafts cannot be known. Returns the card's head
 * after it, which is what Publish publishes; null when the head cannot be read.
 */
export async function carryDrafts(
  services: CarryServices,
  lineage: string,
  decorations: DraftDecorations = liveDecorations,
  knows: KnowsDraft = liveKnows,
): Promise<string | null> {
  const { history, committer } = services
  const segments = replicaRoute(lineage)
  if (!segments.length) return null
  const plan = services.plan ?? await planDrafts(services.drafts, segments, decorations, knows, services.settled, services.dependencyParts === true)
  if (plan && !plan.unchanged) {
    // Each kind's new record first, then the ones before it off: a write that
    // fails leaves the card carrying what it carried, and a remove that fails
    // leaves the new record newest in the slot, which is the one read.
    for (const { composed, onCard } of [plan, plan.dependencies]) {
      if (sameRecord(composed, onCard)) continue
      const written = composed ? await decorations.write(composed.record, segments, composed.listing) : ''
      for (const prior of onCard) if (prior.sig !== written) await decorations.remove(prior.sig, segments)
    }
    await committer?.settled?.()
  }
  const loc = await replicaLocation(history, lineage)
  try { await history.currentLayerAt(loc) } catch { /* read below */ }
  const head = history.warmHeadSigFor?.(loc) ?? (await history.latestMarkerSigFor?.(loc, segments.at(-1) ?? '').catch(() => '')) ?? ''
  return SIG_RE.test(head) ? head : null
}
