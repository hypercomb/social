// sharing/need-lists.ts
//
// A LIST OFFERED FOR A NEED (the `list:` host pool family; need-feeds.ts reads
// it, need-feeds.queen.ts offers it).
//
// A participant who has values for a name says so in their OWN signed index on
// a host: `list:<m>`, where <m> is the name's molecule address, names a LIST
// RECORD they published there. The host keeps the keys whose index names that
// entry at the pool's derived address `sign('list:<m>')`, exactly as it keeps
// picture publishers (`pictures:<m>`, picture-pools.ts) — membership only,
// nothing trusted. A reader reads each member's own index, follows the entry to
// the record by signature, and re-validates it here; a record whose name is not
// the name its key was found under is ignored.
//
//   { "kind": "need-list", "name": "<the tile name>", "values": ["..."], "at": <ms> }
//
// Keyed by the molecule address, never the name: the index carries no free
// text. One key per participant per name, so a second offer for the same name
// replaces the first.
//
// Pure: the offer is handed its reads and writes (host-offer.ts), so it is
// tested without a store or a network.

import { moleculeAddress, registerPoolMeaning } from '@hypercomb/core'
import type { HostOfferDeps } from './host-offer.js'

export const NEED_LIST_PREFIX = 'list:'
export const NEED_LIST_KIND = 'need-list'
/** Longest value a list carries; a longer one is dropped, never cut. */
export const NEED_LIST_VALUE_MAX = 120
/** Values one list carries. */
export const NEED_LIST_VALUES_MAX = 256

const KEY_RE = /^list:([0-9a-f]{64})$/

export type NeedListRecord = {
  readonly kind: typeof NEED_LIST_KIND
  readonly name: string
  readonly values: readonly string[]
  readonly at: number
}

export type NeedListResult =
  | { readonly ok: true; readonly sig: string; readonly record: NeedListRecord }
  | { readonly ok: false; readonly error: string }

const spaced = (text: unknown): string => (typeof text === 'string' ? text : '').trim().replace(/\s+/g, ' ')

/** `list:<moleculeAddress(name)>`, or null for a name with no molecule. */
export const needListKey = async (name: string): Promise<string | null> => {
  if (!spaced(name)) return null
  try { return `${NEED_LIST_PREFIX}${await moleculeAddress(name)}` } catch { return null }
}

/** The address a host lists a name's offered lists at: `sign('list:<m>')`. */
export const needListPoolAddress = async (name: string): Promise<string | null> => {
  const key = await needListKey(name)
  return key ? await registerPoolMeaning(key) : null
}

/** Is this an index key the list rule reads? */
export const isNeedListKey = (key: string): boolean => KEY_RE.test(key)

/** The molecule address an index key names, or '' for any other key. */
export const needListMolecule = (key: string): string => KEY_RE.exec(key)?.[1] ?? ''

/** A list's values as every list carries them: spacing collapsed, empty and
 *  over-long ones dropped, the first spelling of each (case-folded) kept,
 *  NEED_LIST_VALUES_MAX at most. */
export const needListValues = (raw: unknown): string[] => {
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of Array.isArray(raw) ? raw : []) {
    const value = spaced(item)
    if (!value || value.length > NEED_LIST_VALUE_MAX) continue
    const fold = value.toLowerCase()
    if (seen.has(fold)) continue
    seen.add(fold)
    out.push(value)
    if (out.length >= NEED_LIST_VALUES_MAX) break
  }
  return out
}

/**
 * A list record, checked field by field; null when it is not one. With `m`
 * (the molecule address of the key it was found under), a record for any
 * other name is null too — a reader believes a list only for the name its
 * publisher filed it under.
 */
export const needListOf = async (raw: unknown, m?: string): Promise<NeedListRecord | null> => {
  const value = raw as Partial<Record<keyof NeedListRecord, unknown>> | null
  if (!value || typeof value !== 'object' || value.kind !== NEED_LIST_KIND) return null
  const name = spaced(value.name)
  if (!name) return null
  if (m !== undefined) {
    const molecule = await moleculeAddress(name).catch(() => '')
    if (!molecule || molecule !== String(m).toLowerCase()) return null
  }
  const values = needListValues(value.values)
  if (!values.length) return null
  const at = Number(value.at)
  // Canonical key order, as the record is written.
  return { kind: NEED_LIST_KIND, name, values, at: Number.isFinite(at) ? at : 0 }
}

/** Put the list, ship it to `host`, and name it in this hive's own index there
 *  as `list:<m>`. The participant's own act — only their word or click runs it. */
export const offerNeedList = async (
  host: string, name: string, values: readonly string[], deps: HostOfferDeps,
): Promise<NeedListResult> => {
  if (!String(host ?? '').trim()) return { ok: false, error: 'no host is named for this list' }
  const key = await needListKey(name)
  if (!key) return { ok: false, error: 'a list needs a tile name' }
  const record = await needListOf({ kind: NEED_LIST_KIND, name, values, at: deps.now() })
  if (!record) return { ok: false, error: 'nothing to offer: no values for that name' }
  const sig = await deps.put(JSON.stringify(record), 'application/json')
  const published = await deps.publish(host, [sig])
  if (!published.ok) return { ok: false, error: published.error }
  const stamped = await deps.stamp(host, key, sig)
  if (!stamped.ok) return { ok: false, error: stamped.reason ?? 'the list was not named in your index' }
  return { ok: true, sig, record }
}
