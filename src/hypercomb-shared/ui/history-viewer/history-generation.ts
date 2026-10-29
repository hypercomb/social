// history-viewer/history-generation.ts
//
// A generated picture's details are a resource the tile revision names.
// This file only reads that shape. It does not write, and it does not
// know about ComfyUI.

const SIG = /^[0-9a-f]{64}$/

export interface GenerationView {
  positive: string
  /** The name the participant gave the picture. */
  name?: string
  negative?: string
  seed?: number
  steps?: number
  cfg?: number
  width?: number
  height?: number
  workflow?: string
  label?: string
  model?: string
}

const text = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

const finite = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

/** The words a history row shows for a generation. */
export const generationLine = (view: GenerationView): string =>
  view.name || view.positive || view.label || view.workflow || 'picture'

/**
 * Read one JSON document. A generation record becomes the view. A Life
 * incidence that names a resource becomes `{ follow }` so the caller can
 * load that signature. Anything else is not a generation.
 */
export const generationFromJson = (raw: string): GenerationView | { follow: string } | null => {
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return null }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const record = parsed as Record<string, unknown>
  if (record['kind'] === 'comfy-generation@1') {
    const view: GenerationView = { positive: text(record['positive']) ?? '' }
    const name = text(record['name'])
    const negative = text(record['negative'])
    const workflow = text(record['workflow'])
    const label = text(record['label'])
    const model = text(record['model'])
    const seed = finite(record['seed'])
    const steps = finite(record['steps'])
    const cfg = finite(record['cfg'])
    const width = finite(record['width'])
    const height = finite(record['height'])
    if (name) view.name = name
    if (negative) view.negative = negative
    if (workflow) view.workflow = workflow
    if (label) view.label = label
    if (model) view.model = model
    if (seed !== undefined) view.seed = seed
    if (steps !== undefined) view.steps = steps
    if (cfg !== undefined) view.cfg = cfg
    if (width !== undefined) view.width = width
    if (height !== undefined) view.height = height
    return view
  }
  const resource = record['resource']
  if (typeof resource === 'string' && SIG.test(resource)) return { follow: resource }
  return null
}

/** The generation signature a properties bag names, when it names one. */
export const generationSigOf = (props: unknown): string => {
  const sig = (props as { generation?: unknown } | null)?.generation
  return typeof sig === 'string' && SIG.test(sig) ? sig : ''
}

/** Child signatures present in `next` and absent from `prev`. */
export const addedChildSigs = (prev: readonly string[], next: readonly string[]): string[] => {
  const before = new Set(prev)
  return next.filter(sig => SIG.test(sig) && !before.has(sig))
}

export const childSigsOf = (content: unknown): string[] => {
  const children = (content as { children?: unknown } | null | undefined)?.children
  if (!Array.isArray(children)) return []
  return children.filter((sig): sig is string => typeof sig === 'string' && SIG.test(sig))
}
