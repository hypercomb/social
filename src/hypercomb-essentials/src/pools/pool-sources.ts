// pools/pool-sources.ts
//
// WHICH HOSTS A HIVE DRAWS FROM. Selection is the first of the three gates
// (T5): whom I take from, before what I keep and what may run. It is the FROM
// of the relational database (documentation/pools-as-relational-database.md):
// the participant's own named host, then the hosts they follow, narrowed on
// the domain shelf by switching a host off.
//
// Every followed host is on until the participant switches it off, so the one
// thing kept is the exception: the pool `pools:sources` holds one current
// document, `{ "off": ["zone", ...] }`. It is software-written state, a
// preference and never truth (P6), so only the current version is kept. A
// host that is off is not asked; nothing about it is forgotten, and switching
// it on again is taking it out of the list (H4: hide, never delete).
//
// A NODE IS A HOST OR A PERSON (pools/pool-node.ts). The shelf also carries
// the participants of the room that was joined, as nodes beside the domains.
// A participant is switched for the session only: a participant is per room,
// and nothing about a room is written to the store (M3), so the kept list
// holds zones and nothing else.
//
// Reading opens the pool without creating it. The state the shelf announces
// is computed here, purely, from the followed hosts, the room's participants
// and what is switched off. Store access is through IoC or handed in; nothing
// registers here.

import { get } from '@hypercomb/core'
import { hostZone, listCommunityHosts } from '../sharing/community-hosts.js'
import { zoneDoor } from '../sharing/zone-door.js'
import type { SourcesState } from './lights-contract.js'
import { poolNodeKey, uniquePoolNodes, type PoolNode } from './pool-node.js'

/** The pool's meaning. Its address is `sign('pools:sources')`, derived by the store. */
export const SOURCES_MEANING = 'pools:sources'

const STORE_KEY = '@hypercomb.social/Store'
const HOST_SYNC_KEY = '@diamondcoreprocessor.com/HostSyncService'
/** Hosts one hive draws from. */
const ZONES_MAX = 16
/** Hosts kept as switched off: more than are ever followed at once, so a host unfollowed for a while stays off. */
const OFF_MAX = 64
const QUERY_MAX = 80
const DOCUMENT_MAX_BYTES = 64 * 1024
/** Participants one room is read by: more than a classroom holds, so a host cannot hand the shelf a list without end. */
const PARTICIPANTS_MAX = 512
/** A participant's key is 64 characters; anything much longer is not one. */
const NODE_ID_MAX = 128
const NODE_NAME_MAX = 80
const DOMAIN_KEY_START = poolNodeKey({ kind: 'domain', id: '' })

/** The store, as far as this module uses it. Every method optional: an older store, or none, is an answer. */
export interface SourcesStore {
  /** Waits for the store's root to open; a pool asked for before that reads as nothing. */
  initialize?(): Promise<void>
  /** Opens the pool, creating it: only for a write. */
  getPool?(meaning: string): Promise<object | null>
  /** Opens the pool and never creates it: for a read. */
  openPool?(meaning: string): Promise<object | null>
  getPoolDoc?(pool: object, subKey?: string): Promise<ArrayBuffer | null>
  putPoolDoc?(pool: object, bytes: ArrayBuffer, subKey?: string, options?: { keep?: 'versions' | 'current' }): Promise<string | null>
}

/** The hive's store, through IoC; undefined where there is none. */
export const sourcesStore = (): SourcesStore | undefined => {
  try { return get<SourcesStore>(STORE_KEY) } catch { return undefined }
}

export interface FollowedZonesDeps {
  /** The participant's own named host, '' for none. */
  ownHost?: () => string
  /** The hosts the participant follows. */
  followed?: () => Promise<readonly string[]>
}

/** A host as the zone it is, or '' when the text names none. */
const zoneOf = (raw: unknown): string => {
  const zone = zoneDoor(String(raw ?? '').trim().toLowerCase())
  return hostZone(zone) ? zone : ''
}

const zonesIn = (raw: readonly unknown[]): string[] => [...new Set(raw.map(zoneOf).filter(Boolean))]

/** The hosts this hive may draw from: its own named host first, then the hosts it follows, once each, at most sixteen. */
export async function followedZones(deps: FollowedZonesDeps = {}): Promise<string[]> {
  let own = ''
  // The public host when one is named, else the home domain the hosts window names.
  const named = (): string => {
    const sync = get<{ publicHostDomain?(): string; ownHostDomain?(): string }>(HOST_SYNC_KEY)
    return sync?.publicHostDomain?.() || sync?.ownHostDomain?.() || ''
  }
  try { own = (deps.ownHost ?? named)() } catch { own = '' }
  const followed = await (deps.followed ?? listCommunityHosts)().catch(() => [] as readonly string[])
  return zonesIn([own, ...followed]).slice(0, ZONES_MAX)
}

/** The hosts switched off, as kept. Never creates the pool; [] when there is none or it does not read. */
export async function readSourcesOff(store: SourcesStore | undefined = sourcesStore()): Promise<string[]> {
  try {
    if (!store?.openPool || !store.getPoolDoc) return []
    await store.initialize?.()
    const pool = await store.openPool(SOURCES_MEANING)
    const bytes = pool ? await store.getPoolDoc(pool) : null
    if (!bytes || bytes.byteLength > DOCUMENT_MAX_BYTES) return []
    const doc = JSON.parse(new TextDecoder().decode(bytes)) as { off?: unknown } | null
    return Array.isArray(doc?.off) ? zonesIn(doc.off).slice(0, OFF_MAX) : []
  } catch { return [] }
}

/** Keep the hosts switched off: one current document, the list before it not kept. False when it could not be written. */
export async function writeSourcesOff(store: SourcesStore | undefined, off: readonly string[]): Promise<boolean> {
  try {
    const held = store ?? sourcesStore()
    if (!held?.getPool || !held.putPoolDoc) return false
    await held.initialize?.()
    const pool = await held.getPool(SOURCES_MEANING)
    if (!pool) return false
    const bytes = new TextEncoder().encode(JSON.stringify({ off: zonesIn(off).slice(0, OFF_MAX) }))
    const exact = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    return !!(await held.putPoolDoc(pool, exact, undefined, { keep: 'current' }))
  } catch { return false }
}

/** What the shelf announces: the hosts that are on in the order followed, every host, and the words searched for. Pure. */
export function sourcesState(all: readonly string[], off: readonly string[], query: string): SourcesState {
  const hidden = new Set(off.map(zoneOf))
  return {
    zones: all.filter(zone => !hidden.has(zoneOf(zone))),
    all: [...all],
    query: String(query ?? '').trim().toLowerCase().slice(0, QUERY_MAX).trimEnd(),
  }
}

/** The off list with one host switched: taken out when it was off, added when it was on. Pure. */
export function toggleSource(off: readonly string[], zone: string): string[] {
  const target = zoneOf(zone)
  const kept = zonesIn(off)
  if (!target) return kept
  return kept.includes(target) ? kept.filter(one => one !== target) : [...kept, target]
}

/** The followed hosts as nodes, once each in the order followed, the participant's own marked. Pure. */
export function sourceDomainNodes(zones: readonly string[], own = ''): PoolNode[] {
  return [...new Set(zones)].map((zone): PoolNode => ({ kind: 'domain', id: zone, ...(own && zone === own ? { you: true } : {}) }))
}

/** A name as one line of at most eighty characters: what a person typed in a room is never trusted to be short or plain. */
const nodeName = (raw: unknown): string =>
  typeof raw === 'string' ? Array.from(raw.replace(/[\s\u0000-\u001f\u007f]+/g, ' ').trim()).slice(0, NODE_NAME_MAX).join('').trimEnd() : ''

/**
 * What a surface announced as the room's participants, as the nodes the shelf
 * carries: participants only, each once, the reader's own first. Anything that
 * is not a node, or whose key could not be a key, is left out. Pure.
 */
export function sourceParticipantNodes(raw: unknown): PoolNode[] {
  if (!Array.isArray(raw)) return []
  const people: PoolNode[] = []
  for (const one of raw as readonly unknown[]) {
    if (people.length >= PARTICIPANTS_MAX) break
    const node = one as Partial<PoolNode> | null
    if (node?.kind !== 'participant' || typeof node.id !== 'string') continue
    if (!node.id || node.id.length > NODE_ID_MAX || /[\s\u0000-\u001f\u007f]/.test(node.id)) continue
    const name = nodeName(node.name)
    people.push({ kind: 'participant', id: node.id, ...(name ? { name } : {}), ...(node.you === true ? { you: true } : {}) })
  }
  const once = uniquePoolNodes(people)
  return [...once.filter(node => node.you), ...once.filter(node => !node.you)]
}

/**
 * What the shelf announces once it carries nodes: `zones`, `all` and `query`
 * exactly as `sourcesState` gives them for the domains alone, so a reader that
 * only knows domains is told what it always was, plus `nodes` (every node that
 * is on, the domains then the participants) and `allNodes`. `offKeys` are node
 * keys (`poolNodeKey`). Pure.
 */
export function sourcesStateOf(
  domains: readonly PoolNode[],
  participants: readonly PoolNode[],
  offKeys: readonly string[],
  query: string,
): SourcesState {
  const off = new Set(offKeys)
  const places = uniquePoolNodes(domains.filter(node => node.kind === 'domain'))
  const people = uniquePoolNodes(participants.filter(node => node.kind === 'participant'))
  const offZones = offKeys.filter(key => key.startsWith(DOMAIN_KEY_START)).map(key => key.slice(DOMAIN_KEY_START.length))
  const base = sourcesState(places.map(node => node.id), offZones, query)
  const lit = new Set(base.zones)
  return {
    ...base,
    nodes: [...places.filter(node => lit.has(node.id)), ...people.filter(node => !off.has(poolNodeKey(node)))],
    allNodes: [...places, ...people],
  }
}

/** The off keys with one node switched: taken out when it was off, added when it was on. Pure. */
export function toggleSourceNode(offKeys: readonly string[], node: Pick<PoolNode, 'kind' | 'id'>): string[] {
  const key = poolNodeKey(node)
  const kept = [...new Set(offKeys)]
  return kept.includes(key) ? kept.filter(one => one !== key) : [...kept, key]
}
