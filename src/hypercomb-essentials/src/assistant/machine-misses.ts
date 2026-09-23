// assistant/machine-misses.ts — WHAT THE HIVE WAS ASKED FOR AND COULD NOT DO.
//
// The census is the audit: a behaviour declares on itself what a machine may
// say to it, and default-deny covers the rest (documentation/hive-sentence.md,
// jev-decisions.md §5). So when a model proposes a sentence the hive refuses,
// there are only two causes — the behaviour does not exist, or it exists
// without a machine declaration. Either way the refusal is the most direct
// evidence there is of what to build next, and until now it was thrown away.
//
// The chat emits `machine:miss` for every refused sentence; this records it
// in its own pool, one immutable record per miss, named by the hash of its
// bytes (so the EffectBus's last-value replay can never double-count one).
// `/misses` reads them back grouped by the word that was missing.
//
// Pools hold membership state, never truth: nothing here gates, and a cold
// hive without the pool loses only the history of what was asked.

import { EffectBus } from '@hypercomb/core'

export const MACHINE_MISSES_POOL = 'machine:misses'
export const MACHINE_MISSES_IOC_KEY = '@diamondcoreprocessor.com/MachineMisses'

export interface MachineMiss {
  readonly kind: 'machine-miss'
  /** The sentence as the model wrote it, bare of any slash. */
  readonly sentence: string
  /** Its first word — the behaviour that was asked for. */
  readonly verb: string
  /** The hive's own words for why it refused. */
  readonly reason: string
  readonly model?: string
  readonly at: number
}

export interface MissSummary {
  readonly verb: string
  readonly count: number
  readonly lastAt: number
  readonly examples: readonly string[]
  readonly reasons: readonly string[]
}

const SIG = /^[0-9a-f]{64}$/
const MAX_TEXT = 500

export const verbOf = (sentence: string): string =>
  String(sentence ?? '').trim().replace(/^\//, '').split(/\s+/)[0]?.toLowerCase() ?? ''

/** A payload from the bus, made into a record — or nothing, if it is not one. */
export const missRecord = (payload: unknown): MachineMiss | null => {
  if (!payload || typeof payload !== 'object') return null
  const value = payload as Record<string, unknown>
  const sentence = typeof value['sentence'] === 'string' ? value['sentence'].trim().replace(/^\//, '').slice(0, MAX_TEXT) : ''
  const reason = typeof value['reason'] === 'string' ? value['reason'].trim().slice(0, MAX_TEXT) : ''
  const at = typeof value['at'] === 'number' && Number.isFinite(value['at']) ? value['at'] : 0
  const verb = verbOf(sentence)
  if (!sentence || !verb || !reason || !at) return null
  const model = typeof value['model'] === 'string' && value['model'].trim() ? value['model'].trim().slice(0, 200) : undefined
  return { kind: 'machine-miss', sentence, verb, reason, ...(model ? { model } : {}), at }
}

/** Grouped by the missing word, most asked-for first. */
export const summarizeMisses = (records: readonly MachineMiss[]): MissSummary[] => {
  const groups = new Map<string, MachineMiss[]>()
  for (const record of records) groups.set(record.verb, [...(groups.get(record.verb) ?? []), record])
  return [...groups].map(([verb, rows]) => {
    const newest = [...rows].sort((a, b) => b.at - a.at)
    return {
      verb,
      count: rows.length,
      lastAt: newest[0].at,
      examples: [...new Set(newest.map(row => row.sentence))].slice(0, 3),
      reasons: [...new Set(newest.map(row => row.reason))].slice(0, 3),
    }
  }).sort((a, b) => b.count - a.count || b.lastAt - a.lastAt)
}

// ── the pool ──────────────────────────────────────────────────────────────

type StoreLike = { getPool?: (meaning: string) => Promise<FileSystemDirectoryHandle | null> }
const pool = async (): Promise<FileSystemDirectoryHandle | null> =>
  (await (window.ioc?.get?.('@hypercomb.social/Store') as StoreLike | undefined)?.getPool?.(MACHINE_MISSES_POOL)) ?? null

const sha256Hex = async (text: string): Promise<string> =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))]
    .map(byte => byte.toString(16).padStart(2, '0')).join('')

export const recordMiss = async (payload: unknown): Promise<boolean> => {
  const record = missRecord(payload)
  if (!record) return false
  const dir = await pool()
  if (!dir) return false
  const body = JSON.stringify(record)
  const handle = await dir.getFileHandle(await sha256Hex(body), { create: true })
  const writable = await handle.createWritable()
  try { await writable.write(body) } finally { await writable.close() }
  return true
}

export const listMisses = async (): Promise<MissSummary[] | null> => {
  const dir = await pool()
  if (!dir) return null
  const records: MachineMiss[] = []
  for await (const [name, handle] of (dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
    if (handle.kind !== 'file' || !SIG.test(name)) continue
    try {
      const record = missRecord(JSON.parse(await (await (handle as FileSystemFileHandle).getFile()).text()))
      if (record) records.push(record)
    } catch { /* an unreadable record is skipped, never fatal */ }
  }
  return summarizeMisses(records)
}

EffectBus.on('machine:miss', payload => { void recordMiss(payload).catch(() => { /* the chat never waits on this */ }) })

export const machineMisses = { list: listMisses }
