// sharing/community-portal.ts
//
// A PORTAL — a FIXED GROUP of public domains, made ahead of time, that the
// community lens is read through (documentation/community-lens.md, "Portals").
//
// jwize, 2026-10-31: "portals become variations where we join many public
// domains to create a fixed group. We should create the domain groups ahead of
// time, so we can look at portals through filtered lenses when we are working
// together."
//
//   - The group is defined once. Its hosts are folded (scheme and trailing
//     slash dropped, lowercased), deduplicated and sorted, so the same set of
//     domains is the same group however it was typed, and it is frozen.
//   - Its identity is its GROUP SIGNATURE (`group:portal:<name>`, the existing
//     group-signature primitive): members carry the signature, so a set adds or
//     goes as one unit. Renaming a portal is a different group.
//   - A VARIATION is a filtered read through the group: the same hosts, fewer
//     rows. Filters narrow what is SHOWN; they never add a host the group does
//     not hold, and they change nothing about the group.
//
// READ ONLY. Defining a group stores nothing here — where a portal is kept
// (a layer in the hive, so undo is native) is a separate act.

import { groupSignature } from '@hypercomb/core'
import { readLedgerLens, type LedgerDeps, type LensPoint, type LensResult } from './community-lens.js'

export interface DomainGroup {
  readonly name: string
  /** `portal:<name>` — the meaning the group signature is made from. */
  readonly meaning: string
  readonly signature: string
  /** Normalized, unique, sorted. Frozen. */
  readonly hosts: readonly string[]
}

const bareHost = (host: string): string =>
  host.trim().toLowerCase().replace(/^wss?:\/\//, '').replace(/^https?:\/\//, '').replace(/\/+$/, '')

/** Make a portal's group ahead of time. Throws on a nameless group or no hosts,
 *  rather than minting a group that can never be read. */
export const defineDomainGroup = async (name: string, hosts: readonly string[]): Promise<DomainGroup> => {
  const label = name.trim().toLowerCase()
  if (!label) throw new RangeError('defineDomainGroup: a portal needs a name')
  const members = Object.freeze([...new Set(hosts.map(bareHost).filter(Boolean))].sort())
  if (members.length === 0) throw new RangeError('defineDomainGroup: a portal needs at least one domain')
  const meaning = `portal:${label}`
  return Object.freeze({ name: label, meaning, signature: await groupSignature(meaning), hosts: members })
}

/** One variation: a filtered read through a portal. */
export interface PortalFilter {
  /** Only these member hosts (a subset of the group; others are ignored). */
  readonly only?: readonly string[]
  /** Leave these member hosts out. */
  readonly except?: readonly string[]
  /** Keep only points a publisher's signed index backs. Asks for verification. */
  readonly verifiedOnly?: boolean
  /** Keep only points at least this many of the words gathered. */
  readonly minWords?: number
}

export interface PortalView extends LensResult {
  readonly group: Pick<DomainGroup, 'name' | 'signature'>
  /** The member hosts this variation actually asked, after the filter. */
  readonly asked: readonly string[]
  /** Points held back by the filter, so a reader sees what was narrowed away. */
  readonly hidden: number
}

export interface PortalOptions {
  readonly words: readonly string[]
  readonly filter?: PortalFilter
  readonly deps?: LedgerDeps
  readonly timeoutMs?: number
}

const narrow = (group: DomainGroup, filter: PortalFilter | undefined): string[] => {
  const only = filter?.only ? new Set(filter.only.map(bareHost)) : null
  const except = new Set((filter?.except ?? []).map(bareHost))
  return group.hosts.filter(host => (!only || only.has(host)) && !except.has(host))
}

/** Read a portal through a filter. A host outside the group is never asked,
 *  whatever the filter names. */
export const readPortal = async (group: DomainGroup, options: PortalOptions): Promise<PortalView> => {
  const filter = options.filter
  const asked = narrow(group, filter)
  const verify = filter?.verifiedOnly === true
  const result = await readLedgerLens({
    hosts: asked, words: options.words, verify,
    ...(options.deps ? { deps: options.deps } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
  })
  const minWords = Math.max(1, filter?.minWords ?? 1)
  const keep = (point: LensPoint): boolean => point.words.length >= minWords && (!verify || point.verified === true)
  const points = result.points.filter(keep)
  return { group: { name: group.name, signature: group.signature }, asked, points, answers: result.answers, hidden: result.points.length - points.length }
}
