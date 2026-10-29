// comfy/comfy-draft.ts
//
// WHERE THE FORM WAS. Each model and its LoRAs keep the words and the knobs
// from the last time they were the ones loaded. Moving away writes that
// continuation. Moving back reads it. The first visit uses the workflow's
// own defaults.
//
// This is working state, not a save. The library is the save. A continuation
// is one current record per combination (`keep: 'current'`), so an edit
// replaces the previous one and does not grow a history.

import { clampReviewers } from './comfy-help.js'
import { weightsIn } from './comfy-weights.js'
import type { ComfyGraph } from './comfy-workflow.js'

/** Colon-scoped, so no tile can be named this address. Not published. */
export const COMFY_DRAFTS_POOL = 'comfy:drafts'

export const COMFY_DRAFT_KIND = 'comfy-draft@1'

/** The form, as the panel holds it. Empty strings are blanks, not zeros. */
export interface ComfyDraft {
  positive: string
  negative: string
  seed: string
  width: string
  height: string
  steps: string
  cfg: string
  batch: string
  fromTile: boolean
  reviewers: number
}

const NUMBER_KEYS = ['width', 'height', 'steps', 'cfg', 'batch'] as const

/**
 * The combination a continuation belongs to: the model files, then the LoRA
 * files. Text encoders and VAEs are not part of it. Inactive rows are not
 * either. Order does not matter. Empty when nothing is loaded.
 */
export const continuationKey = (
  rows: readonly { file?: string; kind?: string; active?: boolean }[],
): string => {
  const files = (kind: string): string[] => {
    const found = new Set<string>()
    for (const row of rows) {
      if (row.kind !== kind || row.active === false) continue
      const file = String(row.file ?? '').trim()
      if (file) found.add(file)
    }
    return [...found].sort()
  }
  const models = files('model')
  const loras = files('lora')
  if (!models.length && !loras.length) return ''
  return `${models.join('\n')}\n\n${loras.join('\n')}`
}

/** The key of the workflow that is about to run. */
export const continuationKeyOfGraph = (graph: ComfyGraph): string =>
  continuationKey(weightsIn(graph))

const text = (value: unknown): string => typeof value === 'string' ? value : ''

const numeric = (value: string): number | undefined => {
  if (!value.trim()) return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

const shown = (value: unknown): string => {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return String(Number(value))
  return ''
}

/** The bytes a continuation signs. Blanks are left out. No clock. */
export const draftRecord = (draft: ComfyDraft): Record<string, unknown> => {
  const record: Record<string, unknown> = {
    kind: COMFY_DRAFT_KIND,
    positive: text(draft.positive),
    reviewers: clampReviewers(draft.reviewers),
  }
  const negative = text(draft.negative).trim()
  if (negative) record['negative'] = negative
  const seed = numeric(text(draft.seed))
  if (seed !== undefined) record['seed'] = seed
  for (const knob of NUMBER_KEYS) {
    const value = numeric(text(draft[knob]))
    if (value !== undefined) record[knob] = value
  }
  if (draft.fromTile === true) record['fromTile'] = true
  return record
}

export const draftFromRecord = (parsed: unknown): ComfyDraft | null => {
  if (!parsed || typeof parsed !== 'object') return null
  const raw = parsed as Record<string, unknown>
  if (raw['kind'] !== COMFY_DRAFT_KIND) return null
  const draft: ComfyDraft = {
    positive: text(raw['positive']),
    negative: text(raw['negative']),
    seed: shown(raw['seed']),
    width: '',
    height: '',
    steps: '',
    cfg: '',
    batch: '',
    fromTile: raw['fromTile'] === true,
    reviewers: clampReviewers(raw['reviewers']),
  }
  for (const knob of NUMBER_KEYS) draft[knob] = shown(raw[knob])
  return draft
}

const asBuffer = (record: Record<string, unknown>): ArrayBuffer => {
  const encoded = new TextEncoder().encode(JSON.stringify(record))
  return encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength) as ArrayBuffer
}

interface DraftStore {
  initialize?: () => Promise<void>
  getPool?: (meaning: string) => Promise<unknown>
  getPoolDoc?: (pool: unknown, subKey?: string) => Promise<ArrayBuffer | null>
  putPoolDoc?: (
    pool: unknown,
    bytes: ArrayBuffer,
    subKey?: string,
    options?: { keep?: 'versions' | 'current' },
  ) => Promise<string | null>
}

const liveStore = (): DraftStore | undefined =>
  (typeof window === 'undefined' ? undefined : window.ioc?.get?.('@hypercomb.social/Store')) as DraftStore | undefined

const poolOf = async (held: DraftStore): Promise<unknown> => {
  if (!held.getPool) return null
  try { await held.initialize?.() } catch { /* boot handles its own failure */ }
  return await held.getPool(COMFY_DRAFTS_POOL)
}

/** Replace the continuation for this combination. A blank key writes nothing. */
export const saveComfyDraft = async (
  key: string,
  draft: ComfyDraft,
  store?: DraftStore | null,
): Promise<string | null> => {
  const name = key.trim()
  if (!name) return null
  const held = store === undefined ? liveStore() : store
  if (!held?.putPoolDoc) return null
  const dir = await poolOf(held)
  if (!dir) return null
  return await held.putPoolDoc(dir, asBuffer(draftRecord(draft)), name, { keep: 'current' })
}

/** The continuation for this combination, or null when it has never been used. */
export const readComfyDraft = async (
  key: string,
  store?: DraftStore | null,
): Promise<ComfyDraft | null> => {
  const name = key.trim()
  if (!name) return null
  const held = store === undefined ? liveStore() : store
  if (!held?.getPoolDoc) return null
  const dir = await poolOf(held)
  if (!dir) return null
  const bytes = await held.getPoolDoc(dir, name)
  if (!bytes) return null
  try { return draftFromRecord(JSON.parse(new TextDecoder().decode(bytes))) } catch { return null }
}
