// comfy/comfy-workflows.ts
//
// WHERE WORKFLOWS LIVE — the `comfy:workflows` pool.
//
// A workflow is content, exactly like an LLM provider spec next door: a
// sig-named JSON resource in a pool of meaning whose address is DERIVED
// (`Store.poolSignature('comfy:workflows')` — colon-carrying per the
// known-location-pools doctrine, so it can never collide with a lineage bag).
// Same content, same signature, one file: two participants who pasted the
// same workflow cost the network one copy of it.
//
// That is not decoration. It is what makes a workflow SHAREABLE — the thing
// ComfyUI itself has no answer for. Today a workflow moves between people as
// a JSON file in a chat window; here it is an artifact with a name, and a
// domain can publish an index of them at `sign('comfy:workflows')` that every
// participant who learns that host probes automatically (published-pools.ts),
// each member verified against its own signature before it is let in. A
// workflow can carry a picture-making recipe; it can never carry a host, a
// key, or code — the spec has nowhere to put one.
//
// THE HOST IS NOT HERE, deliberately: see comfy-host.ts. A machine address is
// device-local truth. Which workflow is ACTIVE is device-local too — it is a
// preference, not a fact about the workflows.

import { SignatureService, isSignature, EffectBus } from '@hypercomb/core'
import { registerPublishedPool } from '../sharing/published-pools.js'
import {
  parseComfyWorkflow,
  type ComfyGraph,
  type ComfyWorkflowSpec,
} from './comfy-workflow.js'

/** The pool's meaning — one address, two sides of the loop: the local OPFS
 *  pool, and the index a domain publishes at `sign(meaning)`. */
export const COMFY_WORKFLOWS_POOL = 'comfy:workflows'

/** Which workflow the participant is working with. A preference. */
const ACTIVE_KEY = 'hc:comfy:workflow'

/**
 * THE ONE THAT SHIPS. ComfyUI's own default text-to-image graph, which is
 * also the shape nearly every other workflow is a variation of — a
 * checkpoint, two prompts, an empty latent, a sampler, a decode, a save.
 *
 * `ckpt_name` is left at ComfyUI's own default name on purpose and RESOLVED
 * AT RUN TIME against whatever the host actually has (comfy.service asks
 * `/object_info`). Hardcoding the participant's model would be a workflow
 * that only runs on the machine it was written on.
 */
const DEFAULT_GRAPH: ComfyGraph = {
  '3': {
    class_type: 'KSampler',
    inputs: {
      seed: 0,
      steps: 20,
      cfg: 8,
      sampler_name: 'euler',
      scheduler: 'normal',
      denoise: 1,
      model: ['4', 0],
      positive: ['6', 0],
      negative: ['7', 0],
      latent_image: ['5', 0],
    },
  },
  '4': {
    class_type: 'CheckpointLoaderSimple',
    inputs: { ckpt_name: 'v1-5-pruned-emaonly.safetensors' },
  },
  '5': {
    class_type: 'EmptyLatentImage',
    inputs: { width: 512, height: 512, batch_size: 1 },
  },
  '6': {
    class_type: 'CLIPTextEncode',
    inputs: { text: 'a hexagonal tile', clip: ['4', 1] },
  },
  '7': {
    class_type: 'CLIPTextEncode',
    inputs: { text: 'text, watermark, blurry', clip: ['4', 1] },
  },
  '8': {
    class_type: 'VAEDecode',
    inputs: { samples: ['3', 0], vae: ['4', 2] },
  },
  '9': {
    class_type: 'SaveImage',
    inputs: { filename_prefix: 'hypercomb', images: ['8', 0] },
  },
}

export const BUILTIN_WORKFLOW_ID = 'text-to-image'

/** The built-in, parsed through the same door every pasted workflow takes —
 *  so its seams are INFERRED by the same code, and a bug in inference shows
 *  up on the workflow everybody has rather than hiding behind a hand-written
 *  seam table. */
export const builtinWorkflow = (): ComfyWorkflowSpec => ({
  ...parseComfyWorkflow(DEFAULT_GRAPH, 'Text to image'),
  id: BUILTIN_WORKFLOW_ID,
  label: 'Text to image',
  description: 'A prompt, a size, a seed — the shape almost every workflow is a variation of.',
})

// ── the roster ──────────────────────────────────────────────────────────────

/** id → spec. The built-in is always present; the rest arrive from the pool
 *  and from whatever the participant pastes. */
const roster = new Map<string, ComfyWorkflowSpec>()
/** id → the signature its bytes are stored under, for removal. */
const sigs = new Map<string, string>()

roster.set(BUILTIN_WORKFLOW_ID, builtinWorkflow())

const announce = (): void => { EffectBus.emit('comfy:workflows-changed', { count: roster.size }) }

export const comfyWorkflows = (): readonly ComfyWorkflowSpec[] => [...roster.values()]

export const comfyWorkflow = (id: string): ComfyWorkflowSpec | undefined =>
  roster.get(String(id ?? '').trim().toLowerCase())

/** The workflow a run uses when nobody names one. The participant's choice
 *  if it is still here, the built-in otherwise — never a silent nothing. */
export const activeWorkflow = (): ComfyWorkflowSpec => {
  let chosen = ''
  try { chosen = localStorage.getItem(ACTIVE_KEY) ?? '' } catch { /* session-only */ }
  return roster.get(chosen) ?? roster.get(BUILTIN_WORKFLOW_ID) ?? builtinWorkflow()
}

export const setActiveWorkflow = (id: string): boolean => {
  const key = String(id ?? '').trim().toLowerCase()
  if (!roster.has(key)) return false
  try { localStorage.setItem(ACTIVE_KEY, key) } catch { /* session-only */ }
  announce()
  return true
}

/** Register without persisting — the sweep's half, and the path a spec takes
 *  when it is already on disk. */
export const registerComfyWorkflow = (spec: ComfyWorkflowSpec, sig?: string): ComfyWorkflowSpec => {
  roster.set(spec.id, spec)
  if (sig) sigs.set(spec.id, sig)
  announce()
  return spec
}

// ── the pool ────────────────────────────────────────────────────────────────

type DirLike = {
  entries(): AsyncIterable<[string, { kind: string; getFile?: () => Promise<{ size: number; text(): Promise<string> }> }]>
  getFileHandle(name: string, options?: { create?: boolean }): Promise<{
    createWritable(): Promise<{ write(data: ArrayBuffer): Promise<void>; close(): Promise<void> }>
  }>
  removeEntry?(name: string): Promise<void>
}

type StoreLike = {
  initialize?: () => Promise<void>
  getPool?: (meaning: string) => Promise<DirLike | null>
}

const store = (): StoreLike | undefined =>
  window.ioc?.get?.('@hypercomb.social/Store') as StoreLike | undefined

const pool = async (): Promise<DirLike | null> => {
  const held = store()
  if (!held?.getPool) return null
  try { await held.initialize?.() } catch { /* boot handles its own failure */ }
  return await held.getPool(COMFY_WORKFLOWS_POOL)
}

/**
 * Register every workflow the local pool holds. Forgiving per member — one
 * malformed resource must not take the rest of the roster down with it.
 */
export const sweepWorkflowPool = async (): Promise<string[]> => {
  const dir = await pool()
  if (!dir) return []
  const found: string[] = []
  try {
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind !== 'file' || !isSignature(name) || !handle.getFile) continue
      try {
        const file = await handle.getFile()
        if (!file.size) continue
        registerComfyWorkflow(parseComfyWorkflow(await file.text()), name)
        found.push(name)
      } catch (err) {
        console.warn(`[comfy-workflows] skipping pool member ${name.slice(0, 12)}…:`, err)
      }
    }
  } catch { /* pool unreadable — the roster is just the built-in */ }
  return found
}

/**
 * Validate, REGISTER, then persist. Register first: a workflow that cannot go
 * live is not saved, so the roster never grows a row that fails at generate
 * time. Persisting canonicalizes — the stored bytes are the parsed spec
 * re-encoded, so two people who pasted the same workflow with different
 * whitespace still share one file.
 */
export const importComfyWorkflow = async (
  json: unknown,
  options: { label?: string; origin?: string } = {},
): Promise<ComfyWorkflowSpec> => {
  const spec = parseComfyWorkflow(json, options.label ?? 'workflow')

  // A pasted workflow that would take the built-in's name gets its own, or
  // the one workflow everybody has would quietly disappear behind it.
  if (spec.id === BUILTIN_WORKFLOW_ID && roster.get(BUILTIN_WORKFLOW_ID)?.graph !== spec.graph) {
    let n = 2
    while (roster.has(`${spec.id}-${n}`)) n += 1
    spec.id = `${spec.id}-${n}`
  }

  const bytes = new TextEncoder().encode(JSON.stringify(spec, null, 2)).buffer as ArrayBuffer
  const sig = await SignatureService.sign(bytes)
  registerComfyWorkflow(spec, sig)

  const dir = await pool()
  if (dir) {
    try {
      const handle = await dir.getFileHandle(sig, { create: true })
      const writable = await handle.createWritable()
      try { await writable.write(bytes) } finally { await writable.close() }
    } catch (err) {
      console.warn(`[comfy-workflows] "${spec.id}" registered but not persisted:`, err)
    }
  }
  return spec
}

/** Take a workflow out of the roster and off the disk. The built-in cannot
 *  be removed — it is code, not a pool member, and "remove" would only mean
 *  "come back on the next reload". */
export const removeComfyWorkflow = async (id: string): Promise<boolean> => {
  const key = String(id ?? '').trim().toLowerCase()
  if (key === BUILTIN_WORKFLOW_ID || !roster.has(key)) return false
  roster.delete(key)
  const sig = sigs.get(key)
  sigs.delete(key)
  if (sig) {
    const dir = await pool()
    try { await dir?.removeEntry?.(sig) } catch { /* the roster is already right */ }
  }
  announce()
  return true
}

// ── the domain side: a host may publish workflows ───────────────────────────
//
// The same probe the LLM providers use. A domain that publishes an index at
// `sign('comfy:workflows')` offers its workflows to every participant who
// learns it, each member verified against its signature by the probe before
// it reaches this accept. There is no privileged spec to smuggle: a workflow
// names nodes and numbers, and the machine it runs on stays the reader's.
registerPublishedPool({
  meaning: COMFY_WORKFLOWS_POOL,
  accept: async (record, origin) => (await importComfyWorkflow(record, { origin })).id,
})

// ── boot ────────────────────────────────────────────────────────────────────
//
// WAIT FOR THE STORE ITSELF, not for a `whenReady` on one ioc map: this
// module is pulled in early by the side-effect barrel, and `window.ioc` is
// REPLACED after the first few modules register (the lesson paid for in
// llm-provider-registry). A callback parked on the map that is about to be
// swapped is never called, and the symptom is the bad kind — workflows work
// for the session that imported them and vanish on reload, which reads as a
// failed write when the bytes are in fact on disk.
const SWEEP_POLL_MS = 500
const SWEEP_GIVE_UP_MS = 30_000

let swept = false
const sweepOnce = (): void => {
  if (swept) return
  swept = true
  void sweepWorkflowPool()
}

const awaitStoreThenSweep = (): void => {
  const started = Date.now()
  const tick = (): void => {
    if (swept) return
    if (store()?.getPool) { sweepOnce(); return }
    if (Date.now() - started > SWEEP_GIVE_UP_MS) return
    setTimeout(tick, SWEEP_POLL_MS)
  }
  tick()
}

window.ioc?.whenReady?.('@hypercomb.social/Store', () => { sweepOnce() })
awaitStoreThenSweep()
