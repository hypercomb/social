// comfy/comfy-prompts.ts
//
// THE PROMPT LIBRARY. One saved state is one member of `comfy:prompts`.
//
// The member is the state itself: the words, and the knobs that were set
// when they were kept (workflow, size, steps, cfg, seed, negative, whether
// the tile is helping). The signature of those bytes IS the identity, so
// keeping the same state again finds the member that is already there. A
// timestamp would make every keep a new member of the same words, which is
// not a library.
//
// The list is every sig-named atom. `putPoolDoc` also lays a marker so the
// newest keep is the head; the library does not read the head. A marker is
// eight digits, and `isSignature` skips it. `keep: 'current'` is the wrong
// door — that one deletes the other atoms.

import { isSignature } from '@hypercomb/core'
import { clampReviewers } from './comfy-help.js'

/** Colon-scoped, so no tile can be named this address. */
export const COMFY_PROMPTS_POOL = 'comfy:prompts'

export const COMFY_PROMPT_KIND = 'comfy-prompt@1'

/** What a keep stores. `reviewers` is always present; a missing switch means off. */
export interface ComfyPromptRecord {
  kind: typeof COMFY_PROMPT_KIND
  positive: string
  negative?: string
  seed?: number
  steps?: number
  cfg?: number
  width?: number
  height?: number
  batch?: number
  workflow?: string
  label?: string
  model?: string
  fromTile?: true
  reviewers: number
}

/** The form, before it is canonicalized. Empty words are not a state. */
export interface ComfyPromptDraft {
  positive?: string
  negative?: string
  seed?: number
  steps?: number
  cfg?: number
  width?: number
  height?: number
  batch?: number
  workflow?: string
  label?: string
  model?: string
  fromTile?: boolean
  reviewers?: number
}

/** One row the window can show. `text` is the language; the rest is the detail. */
export interface ComfyPromptSaved {
  sig: string
  text: string
  negative?: string
  seed?: number
  steps?: number
  cfg?: number
  width?: number
  height?: number
  batch?: number
  workflow?: string
  label?: string
  model?: string
  fromTile?: boolean
  reviewers?: number
}

const finite = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

const words = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : ''

/**
 * The bytes a keep signs. Key order is fixed, blanks are left out, and there
 * is no clock in it. No words means there is nothing to keep.
 */
export const promptRecord = (draft: ComfyPromptDraft | null | undefined): ComfyPromptRecord | null => {
  const positive = words(draft?.positive)
  if (!positive) return null
  const record: ComfyPromptRecord = {
    kind: COMFY_PROMPT_KIND,
    positive,
    reviewers: clampReviewers(draft?.reviewers),
  }
  const negative = words(draft?.negative)
  if (negative) record.negative = negative
  const seed = finite(draft?.seed)
  if (seed !== undefined) record.seed = seed
  const steps = finite(draft?.steps)
  if (steps !== undefined) record.steps = steps
  const cfg = finite(draft?.cfg)
  if (cfg !== undefined) record.cfg = cfg
  const width = finite(draft?.width)
  if (width !== undefined) record.width = width
  const height = finite(draft?.height)
  if (height !== undefined) record.height = height
  const batch = finite(draft?.batch)
  if (batch !== undefined) record.batch = batch
  const workflow = words(draft?.workflow)
  if (workflow) record.workflow = workflow
  const label = words(draft?.label)
  if (label) record.label = label
  const model = words(draft?.model)
  if (model) record.model = model
  if (draft?.fromTile === true) record.fromTile = true
  return record
}

interface RawPrompt {
  kind?: unknown
  positive?: unknown
  negative?: unknown
  seed?: unknown
  steps?: unknown
  cfg?: unknown
  width?: unknown
  height?: unknown
  batch?: unknown
  workflow?: unknown
  label?: unknown
  model?: unknown
  fromTile?: unknown
  reviewers?: unknown
}

/** Read a member back. A marker, a workflow, or a blank is not a prompt. */
export const readPromptRecord = (text: string): ComfyPromptRecord | null => {
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { return null }
  if (!parsed || typeof parsed !== 'object') return null
  const raw = parsed as RawPrompt
  if (raw.kind !== COMFY_PROMPT_KIND) return null
  return promptRecord({
    positive: typeof raw.positive === 'string' ? raw.positive : '',
    negative: typeof raw.negative === 'string' ? raw.negative : undefined,
    seed: finite(raw.seed),
    steps: finite(raw.steps),
    cfg: finite(raw.cfg),
    width: finite(raw.width),
    height: finite(raw.height),
    batch: finite(raw.batch),
    workflow: typeof raw.workflow === 'string' ? raw.workflow : undefined,
    label: typeof raw.label === 'string' ? raw.label : undefined,
    model: typeof raw.model === 'string' ? raw.model : undefined,
    fromTile: raw.fromTile === true,
    reviewers: finite(raw.reviewers),
  })
}

const promptBytes = (record: ComfyPromptRecord): ArrayBuffer => {
  const encoded = new TextEncoder().encode(JSON.stringify(record))
  return encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength) as ArrayBuffer
}

interface PromptFile {
  size: number
  text(): Promise<string>
  lastModified?: number
}

interface PromptDir {
  entries(): AsyncIterable<[string, { kind: string; getFile?: () => Promise<PromptFile> }]>
}

interface PromptStore {
  initialize?: () => Promise<void>
  getPool?: (meaning: string) => Promise<PromptDir | null>
  putPoolDoc?: (
    pool: PromptDir,
    bytes: ArrayBuffer,
    subKey?: string,
    options?: { keep?: 'versions' | 'current' },
  ) => Promise<string | null>
}

const liveStore = (): PromptStore | undefined =>
  (typeof window === 'undefined' ? undefined : window.ioc?.get?.('@hypercomb.social/Store')) as PromptStore | undefined

const poolOf = async (held: PromptStore): Promise<PromptDir | null> => {
  if (!held.getPool) return null
  try { await held.initialize?.() } catch { /* boot handles its own failure */ }
  return await held.getPool(COMFY_PROMPTS_POOL)
}

/** Keep this state. The same bytes come back as the same signature. */
export const saveComfyPrompt = async (
  draft: ComfyPromptDraft,
  store?: PromptStore | null,
): Promise<string | null> => {
  const record = promptRecord(draft)
  if (!record) return null
  const held = store === undefined ? liveStore() : store
  if (!held?.putPoolDoc) return null
  const dir = await poolOf(held)
  if (!dir) return null
  // Versions: a participant's save. The other states stay.
  return await held.putPoolDoc(dir, promptBytes(record))
}

const savedFrom = (sig: string, record: ComfyPromptRecord): ComfyPromptSaved => ({
  sig,
  text: record.positive,
  ...(record.negative ? { negative: record.negative } : {}),
  ...(record.seed !== undefined ? { seed: record.seed } : {}),
  ...(record.steps !== undefined ? { steps: record.steps } : {}),
  ...(record.cfg !== undefined ? { cfg: record.cfg } : {}),
  ...(record.width !== undefined ? { width: record.width } : {}),
  ...(record.height !== undefined ? { height: record.height } : {}),
  ...(record.batch !== undefined ? { batch: record.batch } : {}),
  ...(record.workflow ? { workflow: record.workflow } : {}),
  ...(record.label ? { label: record.label } : {}),
  ...(record.model ? { model: record.model } : {}),
  ...(record.fromTile ? { fromTile: true } : {}),
  reviewers: record.reviewers,
})

/**
 * Every kept state, newest first. Markers and anything that is not a prompt
 * are skipped, so one bad member cannot hide the rest.
 */
export const listComfyPrompts = async (store?: PromptStore | null): Promise<ComfyPromptSaved[]> => {
  const held = store === undefined ? liveStore() : store
  if (!held) return []
  const dir = await poolOf(held)
  if (!dir) return []
  const found: { row: ComfyPromptSaved; at: number }[] = []
  try {
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind !== 'file' || !isSignature(name) || !handle.getFile) continue
      try {
        const file = await handle.getFile()
        if (!file.size) continue
        const record = readPromptRecord(await file.text())
        if (!record) continue
        found.push({ row: savedFrom(name, record), at: file.lastModified ?? 0 })
      } catch { /* one unreadable member stays out of the list */ }
    }
  } catch { return [] }
  found.sort((a, b) => (b.at - a.at) || (a.row.text < b.row.text ? -1 : a.row.text > b.row.text ? 1 : (a.row.sig < b.row.sig ? -1 : 1)))
  return found.map(item => item.row)
}
