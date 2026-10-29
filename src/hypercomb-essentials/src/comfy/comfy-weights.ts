// comfy/comfy-weights.ts
//
// WHICH FILES A WORKFLOW ACTUALLY LOADS.
//
// A workflow names its own weights. The window lists every file the recipes
// on this machine use, marks the ones in the workflow that is selected, and
// times a loader from the moment ComfyUI says that node is executing until
// it says the next node is. A cached node did not load, and the row says so.

import type { ComfyGraph } from './comfy-workflow.js'

export type WeightKind = 'model' | 'text' | 'vae' | 'lora'

export interface WeightUse {
  file: string
  kind: WeightKind
  node: string
}

export interface WeightRow {
  file: string
  kind: WeightKind
  label: string
  active: boolean
  /** Milliseconds the last time this file's loader actually ran. */
  ms?: number
  /** This run did not reload it. ComfyUI skipped the node. */
  cached?: boolean
  /** The loader is the node running right now. */
  loading?: boolean
  /** Date.now() when that load started, so a window can tick. */
  since?: number
}

export interface LoadClock {
  node: string | null
  file: string | null
  since: number
  ms: Record<string, number>
  cached: Record<string, true>
}

const NAMES: Record<string, string> = {
  'flux3-image-klein-int8-convrot.safetensors': 'FLUX.3 Klein INT8',
  'qwen3vl_4b_int8_convrot.safetensors': 'Qwen3-VL 4B',
  'flux2-vae.safetensors': 'FLUX.2 VAE',
  'sd_xl_base_1.0.safetensors': 'SDXL base',
  'sdxl_lightning_8step_lora.safetensors': 'Lightning 8-step',
  'add-detail-xl.safetensors': 'Add Detail XL',
  'icons-redmond-v2.safetensors': 'Icons Redmond',
  'v1-5-pruned-emaonly.safetensors': 'SD 1.5',
  'v1-5-pruned-emaonly-fp16.safetensors': 'SD 1.5',
}

const KIND_OF: Record<string, WeightKind> = {
  unet_name: 'model',
  ckpt_name: 'model',
  model_name: 'model',
  clip_name: 'text',
  vae_name: 'vae',
  lora_name: 'lora',
}

export const emptyLoadClock = (): LoadClock => ({ node: null, file: null, since: 0, ms: {}, cached: {} })

export const weightLabel = (file: string): string =>
  NAMES[file] ?? file.replace(/\.safetensors$/i, '').replace(/[_-]+/g, ' ')

/** Every weight file a graph names, in node order. */
export const weightsIn = (graph: ComfyGraph): WeightUse[] => {
  const found: WeightUse[] = []
  for (const [node, body] of Object.entries(graph)) {
    const inputs = body?.inputs ?? {}
    for (const [key, kind] of Object.entries(KIND_OF)) {
      const value = inputs[key]
      if (typeof value !== 'string' || !value) continue
      found.push({ file: value, kind, node })
      break
    }
  }
  return found
}

const weightAt = (graph: ComfyGraph, nodeId: string): WeightUse | undefined =>
  weightsIn(graph).find(use => use.node === nodeId)

/**
 * ComfyUI said this node is executing. The previous loader, if any, just
 * finished — that gap is its load time. The same node twice is one load.
 */
export const noteExecuting = (
  clock: LoadClock,
  graph: ComfyGraph,
  nodeId: string | null,
  now: number,
): LoadClock => {
  if (nodeId === clock.node) return clock
  const ms = { ...clock.ms }
  const cached = { ...clock.cached }
  if (clock.file) {
    ms[clock.file] = Math.max(0, now - clock.since)
    delete cached[clock.file]
  }
  const use = nodeId ? weightAt(graph, nodeId) : undefined
  return {
    node: nodeId,
    file: use?.file ?? null,
    since: use ? now : 0,
    ms,
    cached,
  }
}

/** These nodes did not run. A cached loader is not a load. */
export const noteCached = (
  clock: LoadClock,
  graph: ComfyGraph,
  nodeIds: readonly string[],
): LoadClock => {
  const cached = { ...clock.cached }
  const ms = { ...clock.ms }
  let changed = false
  for (const id of nodeIds) {
    const use = weightAt(graph, id)
    if (!use || cached[use.file]) continue
    cached[use.file] = true
    delete ms[use.file]
    changed = true
  }
  if (!changed) return clock
  return { ...clock, ms, cached }
}

/** One row per file the recipes name. Active means the selected workflow uses it. */
export const weightRoster = (
  workflows: readonly { id: string; graph: ComfyGraph }[],
  activeId: string,
  clock: LoadClock,
): WeightRow[] => {
  const activeFiles = new Set(
    workflows.filter(one => one.id === activeId).flatMap(one => weightsIn(one.graph).map(use => use.file)),
  )
  const rows: WeightRow[] = []
  const seen = new Set<string>()
  for (const workflow of workflows) {
    for (const use of weightsIn(workflow.graph)) {
      if (seen.has(use.file)) continue
      seen.add(use.file)
      const loading = clock.file === use.file
      const row: WeightRow = {
        file: use.file,
        kind: use.kind,
        label: weightLabel(use.file),
        active: activeFiles.has(use.file),
        ...(loading ? { loading: true, since: clock.since } : {}),
        ...(!loading && clock.cached[use.file] ? { cached: true } : {}),
        ...(!loading && !clock.cached[use.file] && clock.ms[use.file] !== undefined ? { ms: clock.ms[use.file] } : {}),
      }
      rows.push(row)
    }
  }
  return rows
}
