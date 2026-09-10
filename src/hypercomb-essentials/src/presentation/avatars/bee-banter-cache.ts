import { EffectBus } from '@hypercomb/core'
import type { Agent } from '../../assistant/agent-registry.service.js'
import { personalityKey } from './bee-personality.js'

export interface BeeBanterRecord {
  id: string
  pairKey: string
  beeKeys: readonly [string, string]
  beeNames: readonly [string, string]
  sessionIds: readonly string[]
  lines: readonly string[]
  /** Hive topics this pair has already talked through, oldest first, so the
   *  next chapter asks for ground they have not covered — across a reload as
   *  well as within a session. Absent on records written before chapters. */
  topics?: readonly string[]
  createdAt: number
}

export interface BeeBanterReference {
  sessionId: string
  beeKeys: readonly string[]
  beeNames: readonly string[]
  conversationCount: number
  turnCount: number
  summary: string
  highlights: readonly string[]
  archivedAt: number
}

/** v2: scripts written before the hive-lore chapters were short boasts, and a
 *  held script is replayed forever until its session is archived — so the old
 *  ones would have outlived the change that retired them. Bumping the key
 *  retires them at the door. This is a localStorage cache of disposable
 *  theatre: nothing true is lost by dropping it. */
const STORAGE_KEY = 'hc:bee-banter-cache:v2'
const REFERENCE_KEY = 'hc:bee-banter-references:v1'

const readRaw = (): BeeBanterRecord[] => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    return Array.isArray(parsed) ? parsed.filter(record => {
      const r = record as Partial<BeeBanterRecord>
      return typeof r.id === 'string' && Array.isArray(r.lines)
    }) as BeeBanterRecord[] : []
  } catch { return [] }
}

/** No time or count policy: session archival owns this cache's lifecycle. */
const compact = (): BeeBanterRecord[] => {
  const records = readRaw()
    .sort((a, b) => b.createdAt - a.createdAt)
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(records)) } catch { /* cache is optional */ }
  return records
}

export const cacheBanter = (
  pairKey: string,
  a: Agent,
  b: Agent,
  names: readonly [string, string],
  lines: readonly string[],
  sessionIds: readonly string[],
  topics: readonly string[] = [],
): void => {
  const now = Date.now()
  const record: BeeBanterRecord = {
    id: `${now}:${pairKey.slice(0, 40)}`,
    pairKey,
    beeKeys: [personalityKey(a), personalityKey(b)],
    beeNames: names,
    sessionIds: [...new Set(sessionIds.filter(Boolean))],
    // The whole conversation so far, chapters included: a pair that has been
    // talking all afternoon picks up where it left off after a reload.
    lines: [...lines],
    topics: [...topics],
    createdAt: now,
  }
  const records = compact().filter(existing => existing.pairKey !== pairKey)
  records.unshift(record)
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(records)) } catch { /* optional */ }
}

export const cachedBanterFor = (agent: Agent): BeeBanterRecord[] => {
  const key = personalityKey(agent)
  return compact().filter(record => record.beeKeys.includes(key))
}

export const cachedBanter = (pairKey: string): BeeBanterRecord | undefined =>
  compact().find(record => record.pairKey === pairKey)

const readReferences = (): BeeBanterReference[] => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(REFERENCE_KEY) || '[]')
    return Array.isArray(parsed) ? parsed as BeeBanterReference[] : []
  } catch { return [] }
}

export const banterReferencesFor = (agent: Agent): BeeBanterReference[] => {
  const key = personalityKey(agent)
  return readReferences().filter(reference => reference.beeKeys.includes(key))
    .sort((a, b) => b.archivedAt - a.archivedAt)
}

/** Archive compaction: many disposable scripts become ONE reference file.
 *  Extractive on purpose, so archival never waits for or spends a model call. */
export const evictBanterForSession = (convoId: string): void => {
  const all = readRaw()
  const retiring = all.filter(record => record.sessionIds?.includes(convoId))
  if (retiring.length) {
    const names = [...new Set(retiring.flatMap(record => record.beeNames))]
    const beeKeys = [...new Set(retiring.flatMap(record => record.beeKeys))]
    const turns = retiring.flatMap(record => record.lines)
    const topics = [...new Set(retiring.flatMap(record => record.topics ?? []))]
    // Keep the line that TAUGHT something over the line that boasted: what is
    // worth carrying out of a retired conversation is the architecture it
    // explained, not which bee declared its hive the most beautiful.
    const highlights = [...new Set([
      turns[0],
      turns.find(line => /signature|layer|hash|marker|pool|replicat|cache|artifact|mark/i.test(line)),
      turns.find(line => /platform|model|local|cloud|tier|tradeoff|task/i.test(line)),
      turns[turns.length - 1],
    ].filter((line): line is string => !!line))].slice(0, 4)
    const reference: BeeBanterReference = {
      sessionId: convoId,
      beeKeys,
      beeNames: names,
      conversationCount: retiring.length,
      turnCount: turns.length,
      summary: `${names.join(' and ')} held ${retiring.length} bee conversation${retiring.length === 1 ? '' : 's'} across ${turns.length} turns${topics.length ? `, working through ${topics.join(', ')}` : ''} — how the hive is built, set against their own platforms, tiers and tasks.`,
      highlights,
      archivedAt: Date.now(),
    }
    const references = readReferences().filter(existing => existing.sessionId !== convoId)
    references.unshift(reference) // exactly one durable reference per session
    try { localStorage.setItem(REFERENCE_KEY, JSON.stringify(references)) } catch { /* optional */ }
  }
  const remaining = all.filter(record => !record.sessionIds?.includes(convoId))
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(remaining)) } catch { /* optional */ }
}

// The archive write announces from the data seam. Unarchive does not restore
// disposable theatre; the next live encounter can generate a fresh script.
EffectBus.on<{ convoId?: string; archived?: boolean }>('chat:threads-changed', payload => {
  if (payload?.archived && payload.convoId) evictBanterForSession(payload.convoId)
})
