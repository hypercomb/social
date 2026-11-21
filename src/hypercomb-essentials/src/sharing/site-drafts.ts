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
import { collectSigsDeep } from './decoration-closure.js'
import { DRAFTS_KIND, DRAFTS_MAX, replicaLocation, replicaRoute, type CommitterLike, type HistoryLike } from './site-replica.js'

export { DRAFTS_KIND } from './site-replica.js'
const SIG_RE = /^[0-9a-f]{64}$/

/** One draft as the record carries it: its root, the layer its pick names,
 *  the module it was written into ('' for a new file), and every module the
 *  layer adds over the trunk (`parts`, the draft's own module among them). */
export type CarriedDraftEntry = { readonly root: string; readonly layer: string; readonly from: string; readonly parts: readonly string[] }

/** The record as it is written (decoration-manifest.ts writeDecoration's shape and key order). */
export type DraftsRecord = {
  readonly kind: typeof DRAFTS_KIND
  readonly appliesTo: readonly string[]
  readonly payload: { readonly drafts: readonly CarriedDraftEntry[] }
  readonly refs: readonly string[]
}

export type ComposedDrafts = { readonly record: DraftsRecord; readonly sig: string; readonly drafts: number }

/** A `module:drafts` decoration on the card: its signature, and the record when it was read. */
export type DraftsOnCard = { readonly sig: string; readonly record?: unknown }

/** What carrying reads and writes, so a spec hands in its own. */
export type DraftDecorations = {
  list(segments: readonly string[]): Promise<readonly DraftsOnCard[]>
  write(record: DraftsRecord, segments: readonly string[]): Promise<string>
  remove(sig: string, segments: readonly string[]): Promise<void>
}

/** Were these modules written here, as this hive's own drafts? Read from
 *  disk (core broodRecordOnDisk). A draft put back here from a card is known
 *  by the receipt instead (`settled`): its hold is written before its pick is
 *  made, so a hold alone never says it ran here. */
export type KnowsDraft = (parts: readonly string[]) => Promise<boolean>

/** How a draft put back from a card is recorded in the brood (runtime module-drafts.ts). */
const CARRIED_HOME = ', carried home with '

const liveDecorations: DraftDecorations = {
  // Strict: a record whose bytes cannot be read here may be the drafts record,
  // so the card is "unreadable", never "carries nothing" (planDrafts).
  list: segments => listDecorations({ kind: DRAFTS_KIND, segments, strict: true }),
  write: (record, segments) => writeDecoration({
    kind: record.kind, appliesTo: record.appliesTo, payload: record.payload, segments, refs: record.refs,
  }),
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
  return { root, layer, from, parts: sigs([to, ...(entry?.parts ?? [])]) }
}

/** The drafts a card's record names, as it names them. */
const entriesOnCard = (onCard: readonly DraftsOnCard[]): CarriedDraftEntry[] => onCard.flatMap(found => {
  const record = found.record as { kind?: unknown; payload?: { drafts?: unknown } } | undefined
  if (record?.kind !== DRAFTS_KIND || !Array.isArray(record.payload?.drafts)) return []
  return record.payload.drafts.flatMap((entry: { root?: unknown; layer?: unknown; from?: unknown; parts?: unknown }) => {
    const root = sig(entry?.root), layer = sig(entry?.layer), parts = sigs(entry?.parts)
    return root && layer && parts.length ? [{ root, layer, from: sig(entry?.from), parts }] : []
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
async function recordOf(entries: readonly CarriedDraftEntry[], appliesTo: readonly string[]): Promise<ComposedDrafts | null> {
  const byRoot = new Map<string, CarriedDraftEntry>()
  for (const entry of entries) if (!byRoot.has(entry.root) && byRoot.size < DRAFTS_MAX) byRoot.set(entry.root, entry)
  if (byRoot.size === 0) return null
  const sorted = [...byRoot.values()].sort((a, b) => (a.root < b.root ? -1 : a.root > b.root ? 1 : 0))
  const payload = { drafts: sorted.map(({ root, layer, from, parts }) => ({ root, layer, from, parts: [...parts] })) }
  const declared = [...new Set(sorted.flatMap(e => [e.root, e.layer, e.from, ...e.parts]).filter(Boolean))].sort()
  const refs = [...new Set([...collectSigsDeep(payload), ...declared])]
  const record: DraftsRecord = { kind: DRAFTS_KIND, appliesTo: [...appliesTo], payload, refs }
  const bytes = new TextEncoder().encode(JSON.stringify(record))
  const signature = await SignatureService.sign(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
  return { record, sig: signature, drafts: sorted.length }
}

/** This device's drafts, read through the provider; undefined when they
 *  cannot be known. `cameHome` names the ones that came home here with a card
 *  (the provider's `carried`), not written here. */
async function carriedHere(provider: Pick<ModuleDraftsProvider, 'carry'> | null | undefined): Promise<(CarriedDraftEntry & { readonly cameHome?: true })[] | undefined> {
  if (typeof provider?.carry !== 'function') return undefined
  let carried: Awaited<ReturnType<NonNullable<ModuleDraftsProvider['carry']>>>
  try { carried = await provider.carry() } catch { return undefined }
  return (carried ?? []).flatMap(entry => {
    const made = entryOfCarried(entry)
    return made ? [entry?.carried === true ? { ...made, cameHome: true as const } : made] : []
  })
}

/**
 * THE RECORD THIS DEVICE'S DRAFTS MAKE, alone. `null` when there are no
 * drafts to carry. `undefined` when it cannot be known (no provider, or it
 * would not say): the card is then left as it is — never stripped of drafts
 * because they could not be read.
 */
export async function composeDraftsRecord(
  provider: Pick<ModuleDraftsProvider, 'carry'> | null | undefined,
  appliesTo: readonly string[],
): Promise<ComposedDrafts | null | undefined> {
  const here = await carriedHere(provider)
  return here === undefined ? undefined : recordOf(here, appliesTo)
}

/** The drafts picked here, over any trunk, by their roots; undefined when
 *  they cannot be read. A draft kept through Update all still runs here,
 *  though it is no longer one this device carries (carryableDrafts). */
async function pickedHere(provider: Partial<Pick<ModuleDraftsProvider, 'list'>> | null | undefined): Promise<Set<string> | undefined> {
  if (typeof provider?.list !== 'function') return new Set()
  try { return new Set((await provider.list()).map(draft => sig(draft?.rootSig)).filter(Boolean)) } catch { return undefined }
}

/** What a Publish does to the card's drafts. */
export type DraftsPlan = {
  /** What the card carries after it; null for nothing. */
  readonly composed: ComposedDrafts | null
  readonly onCard: readonly DraftsOnCard[]
  /** The card already carries exactly that. */
  readonly unchanged: boolean
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
 */
export async function planDrafts(
  provider: (Pick<ModuleDraftsProvider, 'carry'> & Partial<Pick<ModuleDraftsProvider, 'list'>>) | null | undefined,
  segments: readonly string[],
  decorations: Pick<DraftDecorations, 'list'> = liveDecorations,
  knows: KnowsDraft = liveKnows,
  settled: readonly string[] = [],
): Promise<DraftsPlan | undefined> {
  if (!segments.length) return undefined
  const all = await carriedHere(provider)
  if (all === undefined) return undefined
  const picked = await pickedHere(provider)
  if (picked === undefined) return undefined
  let onCard: readonly DraftsOnCard[]
  try { onCard = await decorations.list(segments) } catch { return undefined }
  const card = entriesOnCard(onCard)
  const carriedNow = new Set(card.map(entry => entry.root))
  // A draft that came home here rides with the card only while the card
  // carries it: the device that wrote it decides when it comes off, and one
  // that only received it never puts it back nor is owed it.
  const here = all.filter(entry => !entry.cameHome || carriedNow.has(entry.root))
  const running = new Set([...here.map(entry => entry.root), ...picked])
  const settledHere = new Set(settled)
  const kept: CarriedDraftEntry[] = []
  for (const entry of card) {
    if (picked.has(entry.root) && !here.some(mine => mine.root === entry.root)) { kept.push(entry); continue }
    if (running.has(entry.root)) continue
    if (settledHere.has(entry.root)) continue
    if (!(await knows(entry.parts).catch(() => false))) kept.push(entry)
  }
  const composed = await recordOf([...here, ...kept], segments)
  const after = new Set(composed?.record.payload.drafts.map(entry => entry.root) ?? [])
  return {
    composed,
    onCard,
    unchanged: composed ? onCard.length === 1 && onCard[0]!.sig === composed.sig : onCard.length === 0,
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

/** Does this device run drafts the card at `lineage` does not carry? False
 *  when the drafts cannot be known. Carrying fewer is never owed. */
export async function draftsOwed(
  provider: Pick<ModuleDraftsProvider, 'carry'> | null | undefined,
  lineage: string,
  decorations: Pick<DraftDecorations, 'list'> = liveDecorations,
  knows: KnowsDraft = liveKnows,
): Promise<boolean> {
  return (await planDrafts(provider, replicaRoute(lineage), decorations, knows))?.owed ?? false
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
  const plan = services.plan ?? await planDrafts(services.drafts, segments, decorations, knows, services.settled)
  if (plan && !plan.unchanged) {
    // The new record first, then the ones before it off: a write that fails
    // leaves the card carrying what it carried, and a remove that fails
    // leaves the new record newest in the slot, which is the one read.
    const written = plan.composed ? await decorations.write(plan.composed.record, segments) : ''
    for (const prior of plan.onCard) if (prior.sig !== written) await decorations.remove(prior.sig, segments)
    await committer?.settled?.()
  }
  const loc = await replicaLocation(history, lineage)
  try { await history.currentLayerAt(loc) } catch { /* read below */ }
  const head = history.warmHeadSigFor?.(loc) ?? (await history.latestMarkerSigFor?.(loc, segments.at(-1) ?? '').catch(() => '')) ?? ''
  return SIG_RE.test(head) ? head : null
}
