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

const STORAGE_KEY = 'hc:bee-banter-cache:v1'
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
): void => {
  const now = Date.now()
  const record: BeeBanterRecord = {
    id: `${now}:${pairKey.slice(0, 40)}`,
    pairKey,
    beeKeys: [personalityKey(a), personalityKey(b)],
    beeNames: names,
    sessionIds: [...new Set(sessionIds.filter(Boolean))],
    lines: [...lines],
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
    const highlights = [...new Set([
      turns[0],
      turns.find(line => /platform|model|local|cloud|tier|tradeoff|task/i.test(line)),
      turns.find(line => /hive|beautiful|tremendous|win/i.test(line)),
      turns[turns.length - 1],
    ].filter((line): line is string => !!line))].slice(0, 4)
    const reference: BeeBanterReference = {
      sessionId: convoId,
      beeKeys,
      beeNames: names,
      conversationCount: retiring.length,
      turnCount: turns.length,
      summary: `${names.join(' and ')} held ${retiring.length} educational bee conversation${retiring.length === 1 ? '' : 's'} across ${turns.length} turns, comparing their platforms, model choices, tasks, and hive-building styles.`,
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
