// assistant/change-record.ts
//
// The one shape a change record takes on file, for what this hive sends over
// the change channel and for what it hears there (change-channel.drone.ts).
// A relay is open to anyone, so a record that opened under the secret is
// still checked here before it is filed.

import type { ChangeRecord, ChangeStatus, ChangeTouch } from './changes.js'

const MAX_SENTENCES = 500
const MAX_SENTENCE_LENGTH = 4000
const STATUSES: readonly ChangeStatus[] = ['requested', 'applied', 'partial', 'declined', 'failed', 'compensated']
const OPS = new Set(['created', 'moved', 'edited', 'removed'])

const text = (value: unknown, max: number): string | null =>
  typeof value === 'string' && value.length <= max ? value : null

const words = (value: unknown): string[] | null =>
  Array.isArray(value) && value.every(item => typeof item === 'string' && item.length <= 200) ? value as string[] : null

/**
 * The one shape a record takes on file, built the same way for what this
 * hive sends and what it hears, so a record that comes back to its sender is
 * the same bytes and is not filed twice. Null when it is not a change for
 * this channel.
 */
export const normalizeChangeRecord = (raw: unknown, channel: string): ChangeRecord | null => {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (r['kind'] !== 'change' || r['channel'] !== channel) return null
  const id = text(r['id'], 128)
  const task = text(r['task'], 200)
  const status = STATUSES.find(s => s === r['status'])
  const at = typeof r['at'] === 'number' && Number.isFinite(r['at']) ? r['at'] : null
  const scope = words(r['scope'] ?? [])
  if (!id || task === null || !status || at === null || !scope) return null

  const touchedRaw = Array.isArray(r['touched']) ? r['touched'] : []
  const touched: ChangeTouch[] = []
  for (const t of touchedRaw.slice(0, 1000)) {
    const touch = t as Record<string, unknown>
    const path = words(touch?.['path'])
    const op = typeof touch?.['op'] === 'string' && OPS.has(touch['op']) ? touch['op'] as ChangeTouch['op'] : null
    if (!path || !op) return null
    touched.push({ path, op, role: text(touch['role'] ?? '', 100) ?? '' })
  }

  let sentences: string[] | undefined
  if (r['sentences'] !== undefined) {
    const list = r['sentences']
    if (!Array.isArray(list) || list.length > MAX_SENTENCES) return null
    if (!list.every(s => typeof s === 'string' && s.length <= MAX_SENTENCE_LENGTH)) return null
    sentences = list as string[]
  }
  const compensates = r['compensates'] === undefined ? undefined : text(r['compensates'], 128)
  const note = r['note'] === undefined ? undefined : text(r['note'], 2000)
  if (compensates === null || note === null) return null

  // A request is always marked as having come from elsewhere; an answer keeps
  // whatever its sender filed, so the copy it gets back is identical.
  const from = status === 'requested' ? 'remote' : (r['from'] === 'remote' ? 'remote' : undefined)

  return {
    kind: 'change',
    channel,
    id,
    task,
    scope,
    at,
    status,
    touched,
    ...(compensates ? { compensates } : {}),
    ...(note ? { note } : {}),
    ...(sentences ? { sentences } : {}),
    ...(from ? { from } : {}),
  }
}
