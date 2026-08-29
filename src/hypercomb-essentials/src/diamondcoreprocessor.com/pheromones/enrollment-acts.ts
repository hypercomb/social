// diamondcoreprocessor.com/pheromones/enrollment-acts.ts
//
// The four things a participant can DO to a relation. Kept apart from
// enrollment.ts so the read model stays a pure module (no IoC, no DOM) that
// every behaviour and every test can import freely.
//
//   enrol    — this tile joins <site>            (idempotent)
//   withdraw — this tile leaves <site>
//   name     — this tile BECOMES the site artifact for <site>
//   unname   — it stops being that
//
// None of them touches any other tile. That is the point: there is no parent to
// update, no children array to append to, no second record anywhere that has to
// agree. One tile, one decoration, one layer — so the act is atomic, undoable on
// its own, and adoptable on its own.

import { groupSignature } from '@hypercomb/core'
import {
  listDecorations,
  removeDecoration,
  replaceDecoration,
  writeDecoration,
} from '../commands/decoration-manifest.js'
import {
  ENROLLMENT_KIND,
  SITE_ARTIFACT_KIND,
  enrolledCells,
  nextOrder,
  siteMeaning,
  siteSlug,
  type CellEnrollment,
  type Enrollment,
} from './enrollment.js'

type ReadStore = {
  getResourceLocal(sig: string): Promise<Blob | null>
  getResourceResolvedLocal?(sig: string): Promise<Blob | null>
}
type WalkHistory = {
  sign(l: { explorerSegments?: () => readonly string[] }): Promise<string>
  currentLayerAt(sig: string): Promise<Record<string, unknown> | null>
  getLayerBySig(sig: string): Promise<Record<string, unknown> | null>
}

const get = <T,>(key: string): T | undefined =>
  (window as { ioc?: { get?: (k: string) => T } }).ioc?.get?.(key)

const history = (): WalkHistory | undefined => get<WalkHistory>('@diamondcoreprocessor.com/HistoryService')
const store = (): ReadStore | undefined => get<ReadStore>('@hypercomb.social/Store')

/** The signature and meaning behind a typed site name. */
export async function siteGroupFor(name: string): Promise<{ sig: string; meaning: string; slug: string } | null> {
  const meaning = siteMeaning(name)
  if (!meaning) return null
  return { sig: await groupSignature(meaning), meaning, slug: siteSlug(name) }
}

/** Put the membership mark on a cell. Idempotent: the same mark mints the same
 *  record signature, and the slot's append-or-noop keeps one copy. The mark IS
 *  the incidence, so anything true only of THIS membership rides its payload
 *  and nowhere else. */
export async function wearEnrollment(
  segments: readonly string[],
  enrolled: Enrollment,
): Promise<void> {
  await writeDecoration({
    kind: ENROLLMENT_KIND,
    appliesTo: segments,
    segments,
    payload: {
      sig: enrolled.sig,
      meaning: enrolled.meaning,
      ...(typeof enrolled.order === 'number' ? { order: enrolled.order } : {}),
    },
    mark: 'persistent',
  })
}

/** Take the membership mark off a cell. Returns whether it was wearing one. */
export async function dropEnrollment(segments: readonly string[], groupSig: string): Promise<boolean> {
  const worn = await listDecorations<{ sig?: string }>({ kind: ENROLLMENT_KIND, segments })
  const same = worn.filter(e => String(e.record.payload?.sig ?? '').toLowerCase() === groupSig)
  for (const entry of same) removeDecoration({ sig: entry.sig, segments })
  return same.length > 0
}

/** The position a tile joining this site should take — derived from the members
 *  themselves, so nothing anywhere keeps a counter. */
export async function nextOrderIn(
  groupSig: string,
  fallback?: (cell: CellEnrollment) => number | undefined,
): Promise<number> {
  const h = history()
  const s = store()
  if (!h || !s?.getResourceLocal) return 0
  return nextOrder(await enrolledCells(h, s, [groupSig]), [groupSig], fallback)
}

export type EnrollResult =
  | { readonly ok: true; readonly act: 'enrolled' | 'withdrawn'; readonly slug: string }
  | { readonly ok: false; readonly reason: 'no-name' | 'nowhere' }

/**
 * Enrol this tile in `<name>`, or withdraw it if it is already enrolled. One
 * gesture, both directions — the same shape as every other mark toggle in the
 * hive, and the reason there is no separate "remove from" command to forget.
 */
export async function toggleEnrollment(
  segments: readonly string[],
  name: string,
  fallback?: (cell: CellEnrollment) => number | undefined,
): Promise<EnrollResult> {
  if (segments.length === 0) return { ok: false, reason: 'nowhere' }
  const group = await siteGroupFor(name)
  if (!group) return { ok: false, reason: 'no-name' }

  if (await dropEnrollment(segments, group.sig)) {
    return { ok: true, act: 'withdrawn', slug: group.slug }
  }
  await wearEnrollment(segments, {
    sig: group.sig,
    meaning: group.meaning,
    order: await nextOrderIn(group.sig, fallback),
  })
  return { ok: true, act: 'enrolled', slug: group.slug }
}

export type NameResult =
  | { readonly ok: true; readonly act: 'named' | 'unnamed'; readonly slug: string }
  | { readonly ok: false; readonly reason: 'no-name' | 'nowhere' }

/**
 * Make this tile the WEBSITE ARTIFACT for `<name>` — the tile that NAMES the
 * relation. It takes the identity record plus the same membership mark every
 * member wears, because naming a set means belonging to it. It holds nothing:
 * remove it and its members are still related to each other.
 */
export async function toggleSiteArtifact(
  segments: readonly string[],
  name: string,
): Promise<NameResult> {
  if (segments.length === 0) return { ok: false, reason: 'nowhere' }
  const group = await siteGroupFor(name)
  if (!group) return { ok: false, reason: 'no-name' }

  const existing = await listDecorations<{ groupSig?: string }>({ kind: SITE_ARTIFACT_KIND, segments })
  const same = existing.filter(e => String(e.record.payload?.groupSig ?? '').toLowerCase() === group.sig)
  if (same.length) {
    for (const entry of same) removeDecoration({ sig: entry.sig, segments })
    await dropEnrollment(segments, group.sig)
    return { ok: true, act: 'unnamed', slug: group.slug }
  }

  await replaceDecoration({
    kind: SITE_ARTIFACT_KIND,
    appliesTo: segments,
    segments,
    payload: { groupSig: group.sig, meaning: group.meaning, name: group.slug },
    mark: 'persistent',
  })
  await wearEnrollment(segments, { sig: group.sig, meaning: group.meaning })
  return { ok: true, act: 'named', slug: group.slug }
}

/** Every site this tile is currently enrolled in, by name. For `/enroll` with
 *  no argument — "what am I part of?" is a question the tile can answer alone,
 *  which is the whole test of an atomic model. */
export async function sitesOf(segments: readonly string[]): Promise<string[]> {
  const worn = await listDecorations<{ meaning?: string }>({ kind: ENROLLMENT_KIND, segments })
  const out: string[] = []
  for (const entry of worn) {
    const meaning = String(entry.record.payload?.meaning ?? '').trim()
    if (meaning && !out.includes(meaning)) out.push(meaning)
  }
  return out.sort()
}
