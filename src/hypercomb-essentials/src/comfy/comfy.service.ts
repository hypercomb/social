// comfy/comfy.service.ts
//
// THE RUN — from a typed prompt to a picture on a tile.
//
// Everything upstream of this file is inert: a workflow is content, a host is
// an address. This is where they meet, and the whole job is five moves —
// resolve the workflow, write the participant's values at its seams, queue
// it, wait, and bring the bytes home.
//
// BRINGING THEM HOME IS THE POINT. A picture that stays on the ComfyUI box is
// a file in an output folder — it is not in the hive, it cannot be adopted,
// shared, undone or found again. So a finished run goes straight through
// `storeImageResources`, the SAME door a dropped image takes: the full-size
// original plus both hex orientations, content-addressed, and then the
// ordinary `cell:attach-resource` effect puts it on the tile. Nothing about a
// generated picture is special once it exists, and that is deliberate — the
// undo, the publish, the substrate rules and the thumbnail pool all already
// work, because there is no second kind of picture to teach them about.
//
// WHAT IS RECORDED, AND WHERE. The prompt, the seed, the workflow and the
// model that made a picture are written into `comfy:generations` under the
// IMAGE'S OWN SIGNATURE — the sig-keyed record pattern, so the lookup is
// "here are some bytes, what made them" with no index and no scan. That is
// what makes a re-roll possible from a tile alone (`/comfy.reroll`), and it
// is the honest place for the provenance: it belongs to the bytes, not to the
// tile that happens to be wearing them today. The tile's props are untouched.
//
// THE SOCKET IS NEVER THE TRUTH. Progress comes over the WebSocket because a
// progress bar should move; the RESULT is read from `/history`, always, even
// when the socket already delivered it. A dropped socket must cost a
// participant a progress bar, never a picture.

import { EffectBus } from '@hypercomb/core'
import { storeImageResources } from '../editor/arm-resource.js'
import { readTilePropertiesAt, tilePictureCandidates } from '../editor/tile-properties.js'
import { comfyFolder, importable, tooLargeMessage } from './comfy-folder.js'
import { ComfyHost, comfyHost, type ComfyFileRef } from './comfy-host.js'
import { activeWorkflow, comfyWorkflow } from './comfy-workflows.js'
import {
  applyParams,
  randomSeed,
  type ComfyParams,
  type ComfyWorkflowSpec,
} from './comfy-workflow.js'

export const COMFY_SERVICE_KEY = '@diamondcoreprocessor.com/ComfyService'

/** Where a picture's provenance lives — one record per IMAGE signature. */
export const COMFY_GENERATIONS_POOL = 'comfy:generations'

/** How a run is going, in the four words a surface needs. */
export type ComfyJobState = 'idle' | 'queued' | 'running' | 'done' | 'error'

export interface ComfyJob {
  state: ComfyJobState
  promptId?: string
  /** 0..1 while a node reports steps; absent when it does not. */
  fraction?: number
  /** Runs waiting behind this one, ours and anyone else's. */
  queued?: number
  message?: string
}

/** One finished picture, already in the store. */
export interface ComfyResult {
  largeSig: string
  smallPointSig: string | null
  smallFlatSig: string | null
  /** Object URL of a preview — the caller owns revocation. */
  previewUrl: string
  file: ComfyFileRef
  seed: number
  workflowId: string
}

/** What a picture was made from. Content, keyed by the picture's signature. */
export interface ComfyGenerationRecord {
  kind: 'comfy-generation@1'
  workflow: string
  label?: string
  positive?: string
  negative?: string
  seed?: number
  steps?: number
  cfg?: number
  width?: number
  height?: number
  model?: string
  at: number
}

export interface ComfyRunRequest extends ComfyParams {
  /** Which workflow — the active one when unnamed. */
  workflowId?: string
  /** Where the picture lands. The selection when unnamed. */
  cell?: string
  /** Put the first result on the tile without asking. The command line does
   *  (you typed a prompt at a tile); the window does not (you are choosing). */
  attach?: boolean
}

type DirLike = {
  getFileHandle(name: string, options?: { create?: boolean }): Promise<{
    getFile(): Promise<{ size: number; text(): Promise<string> }>
    createWritable(): Promise<{ write(data: ArrayBuffer): Promise<void>; close(): Promise<void> }>
  }>
}
type StoreLike = {
  initialize?: () => Promise<void>
  getPool?: (meaning: string) => Promise<DirLike | null>
}

const ioc = <T,>(key: string): T | undefined =>
  (window as unknown as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.(key) as T | undefined

const store = (): StoreLike | undefined => ioc<StoreLike>('@hypercomb.social/Store')

/** How long a run may take before we stop waiting on it. Ten minutes is a
 *  slow SDXL batch on a modest card — long enough not to cut off real work,
 *  short enough that a wedged server does not leave a spinner up forever. */
const RUN_TIMEOUT_MS = 10 * 60 * 1000
const POLL_MS = 1500

export class ComfyService extends EventTarget {
  #job: ComfyJob = { state: 'idle' }
  #results: ComfyResult[] = []
  /** endpoint → the checkpoints that host actually has. */
  #checkpoints = new Map<string, string[]>()
  #listening = false

  get job(): ComfyJob { return this.#job }
  /** The pictures from the last run, newest run only. */
  get results(): readonly ComfyResult[] { return this.#results }

  #setJob(job: ComfyJob): void {
    this.#job = job
    this.dispatchEvent(new CustomEvent('change'))
    EffectBus.emit('comfy:job', job)
  }

  // ── where a picture lands ─────────────────────────────────────────────────

  /**
   * The tile a run is for. The active selection, then the first of a
   * multi-selection, then whatever the older selection drone still holds —
   * the same walk the clipboard does, so "the tile I have selected" means the
   * same thing in both places.
   */
  targetCell(): string | null {
    const selection = ioc<{ active?: string | null; selected?: ReadonlySet<string> }>(
      '@diamondcoreprocessor.com/SelectionService')
    if (selection?.active) return selection.active
    const first = selection?.selected?.values().next().value
    if (first) return first
    const drone = ioc<{ selectedLabels?: string[] }>('@diamondcoreprocessor.com/TileSelectionDrone')
    return drone?.selectedLabels?.[0] ?? null
  }

  #segments(): readonly string[] {
    return ioc<{ explorerSegments?: () => readonly string[] }>(
      '@hypercomb.social/Lineage')?.explorerSegments?.() ?? []
  }

  // ── the host's own vocabulary ─────────────────────────────────────────────

  /**
   * A workflow saved on someone else's machine names a checkpoint this one
   * may not have, and ComfyUI answers that with a validation refusal rather
   * than a substitution. So: if the named model is not on this host, use the
   * first one that is. A picture from the wrong model beats no picture and a
   * paragraph about safetensors — and the record written afterwards says
   * which model actually ran, so nothing is lost.
   */
  async #resolveCheckpoint(named: string | undefined): Promise<string | undefined> {
    if (!named) return undefined
    const endpoint = comfyHost.endpoint
    let available = this.#checkpoints.get(endpoint)
    if (!available) {
      available = await comfyHost.choicesFor('CheckpointLoaderSimple', 'ckpt_name')
      this.#checkpoints.set(endpoint, available)
    }
    if (!available.length) return undefined
    if (available.includes(named)) return named
    return available[0]
  }

  /** The checkpoints this host has, for a picker. */
  async checkpoints(): Promise<string[]> {
    const endpoint = comfyHost.endpoint
    const held = this.#checkpoints.get(endpoint)
    if (held) return held
    const fresh = await comfyHost.choicesFor('CheckpointLoaderSimple', 'ckpt_name')
    this.#checkpoints.set(endpoint, fresh)
    return fresh
  }

  // ── the run ───────────────────────────────────────────────────────────────

  /**
   * Run a workflow and bring back what it made. Never throws at the caller:
   * a failure is a job in the `error` state with a sentence in it, because
   * every caller (the command line, the window) would otherwise write the
   * same try/catch and say the same thing.
   */
  async run(request: ComfyRunRequest = {}): Promise<readonly ComfyResult[]> {
    if (this.#job.state === 'queued' || this.#job.state === 'running') {
      this.#setJob({ ...this.#job, message: 'a run is already going' })
      return []
    }

    const workflow: ComfyWorkflowSpec = (request.workflowId ? comfyWorkflow(request.workflowId) : undefined)
      ?? activeWorkflow()

    // Ask the host once before queueing. A refusal here is the participant's
    // to fix (CORS flag, wrong port), and the sentence comfy-host writes is
    // the whole answer.
    const reach = comfyHost.reach.ok ? comfyHost.reach : await comfyHost.probe()
    if (!reach.ok) {
      this.#setJob({ state: 'error', message: reach.reason ?? 'no ComfyUI at that address' })
      return []
    }

    const seed = typeof request.seed === 'number' ? request.seed : randomSeed()
    const checkpoint = await this.#resolveCheckpoint(
      request.checkpoint ?? (workflow.seams.checkpoint
        ? workflow.graph[workflow.seams.checkpoint.node]?.inputs?.[workflow.seams.checkpoint.input] as string
        : undefined))

    const graph = applyParams(workflow.graph, workflow.seams, { ...request, seed, checkpoint })

    this.#releaseResults()
    this.#setJob({ state: 'queued', message: `${workflow.label} — queued` })

    let promptId: string
    try {
      this.#attachSocket()
      promptId = await comfyHost.queue(graph)
    } catch (err) {
      this.#setJob({ state: 'error', message: (err as Error)?.message ?? 'the server refused the workflow' })
      return []
    }

    this.#setJob({ state: 'running', promptId, message: workflow.label })

    const run = await this.#await(promptId)
    if (!run) {
      this.#setJob({ state: 'error', promptId, message: 'the run did not finish' })
      return []
    }

    // The named output node first; anything the run produced otherwise. A
    // workflow whose save node was renamed still gives back its pictures.
    const files = ComfyHost.filesOf(run, workflow.seams.output?.node).length
      ? ComfyHost.filesOf(run, workflow.seams.output?.node)
      : ComfyHost.filesOf(run)

    if (!files.length) {
      const said = String(run.status?.status_str ?? '')
      this.#setJob({ state: 'error', promptId, message: said === 'error' ? 'the run failed' : 'the run made no pictures' })
      return []
    }

    const results: ComfyResult[] = []
    let refused = ''
    for (const file of files) {
      const blob = await this.#readFile(file)
      if (!blob || !blob.size) continue
      // THE ONE GATE ON WHAT ENTERS THE HIVE. Everything past this line
      // travels — into the store, into a publish, into an adopter's tree — so
      // an oversized picture is left where it already is (comfy-folder.ts).
      if (!importable(blob.size)) { refused = tooLargeMessage(blob.size); continue }
      const stored = await storeImageResources(blob)
      if (!stored) continue
      const result: ComfyResult = { ...stored, file, seed, workflowId: workflow.id }
      results.push(result)
      await this.#record(result, workflow, { ...request, seed, checkpoint })
    }

    this.#results = results
    if (!results.length) {
      this.#setJob({ state: 'error', promptId, message: refused || 'the pictures could not be read back' })
      return []
    }

    this.#setJob({
      state: 'done',
      promptId,
      message: `${results.length} picture${results.length === 1 ? '' : 's'}`,
    })
    EffectBus.emit('comfy:results', { count: results.length, workflow: workflow.id })

    if (request.attach !== false) {
      const cell = request.cell ?? this.targetCell()
      if (cell && results[0]) this.attach(results[0], cell)
    }
    return results
  }

  /** Stop the run that is going, if one is. */
  async cancel(): Promise<void> {
    if (this.#job.state !== 'queued' && this.#job.state !== 'running') return
    await comfyHost.interrupt()
    this.#setJob({ state: 'idle', message: 'stopped' })
  }

  #attachSocket(): void {
    if (this.#listening) return
    this.#listening = true
    comfyHost.listen({
      onProgress: progress => {
        if (this.#job.state !== 'running' && this.#job.state !== 'queued') return
        const fraction = progress.max ? (progress.value ?? 0) / progress.max : undefined
        this.#setJob({
          ...this.#job,
          state: 'running',
          ...(fraction !== undefined ? { fraction } : {}),
          ...(progress.queued !== undefined ? { queued: progress.queued } : {}),
        })
      },
      onError: (_promptId, message) => {
        if (this.#job.state === 'running' || this.#job.state === 'queued') {
          this.#setJob({ state: 'error', message })
        }
      },
    })
  }

  /**
   * Wait for a prompt to finish, by POLLING `/history` — the socket only
   * shortens the wait, it does not decide it. `/history` answering with
   * outputs IS the definition of finished; a socket that dropped, a tab that
   * slept, and a run that completed before we listened all come out right.
   */
  async #await(promptId: string): Promise<Awaited<ReturnType<typeof comfyHost.history>>> {
    const deadline = Date.now() + RUN_TIMEOUT_MS
    while (Date.now() < deadline) {
      if (this.#job.state === 'idle') return null // cancelled
      const run = await comfyHost.history(promptId)
      if (run && (run.status?.completed === true || Object.keys(run.outputs ?? {}).length > 0)) return run
      if (run?.status?.status_str === 'error') return run
      await new Promise(resolve => setTimeout(resolve, POLL_MS))
    }
    return null
  }

  // ── putting it on a tile ──────────────────────────────────────────────────

  /**
   * Put a result on a tile. Nothing here knows how a picture becomes a tile's
   * face — it emits the same effect a dropped file does, and the ordinary
   * attach path (editor/resource-attach.drone) does the rest: canonical props,
   * the right slot through a portal, `tile:saved`, the history entry.
   */
  attach(result: ComfyResult, cell?: string): boolean {
    const target = cell ?? this.targetCell()
    if (!target) return false
    EffectBus.emit('cell:attach-resource', {
      cell: target,
      largeSig: result.largeSig,
      smallPointSig: result.smallPointSig,
      smallFlatSig: result.smallFlatSig,
      url: null,
      type: 'image',
    })
    EffectBus.emit('activity:log', { message: `picture on "${target}"`, icon: '◈' })
    return true
  }

  /**
   * READ THE PICTURE OFF DISK IF WE CAN, over HTTP if we cannot.
   *
   * Both doors reach the same file. The folder is preferred because it costs
   * ComfyUI nothing, needs no CORS header, and — the reason it exists — does
   * not require a second copy of the bytes to exist anywhere. The HTTP path
   * stays for a host on another machine, where there is no folder to link.
   */
  async #readFile(file: ComfyFileRef): Promise<Blob | null> {
    if (comfyFolder.linked) {
      const held = await comfyFolder.read(file)
      if (held) return held
    }
    return await comfyHost.fetchFile(file)
  }

  /**
   * KEEP ONE PICTURE FROM THE FOLDER. The browse path: a participant looking
   * through what ComfyUI has already made picks one, and only that one is
   * copied into the store and put on a tile. Everything else they looked at
   * stays a preview URL over a file on disk, and is forgotten when the strip
   * closes.
   */
  async keep(file: ComfyFileRef, cell?: string): Promise<ComfyResult | null> {
    const blob = await this.#readFile(file)
    if (!blob || !blob.size) {
      this.#setJob({ state: 'error', message: 'that picture could not be read' })
      return null
    }
    if (!importable(blob.size)) {
      this.#setJob({ state: 'error', message: tooLargeMessage(blob.size) })
      return null
    }
    const stored = await storeImageResources(blob)
    if (!stored) return null
    const result: ComfyResult = { ...stored, file, seed: 0, workflowId: '' }
    this.attach(result, cell)
    return result
  }

  // ── provenance ────────────────────────────────────────────────────────────

  async #pool(): Promise<DirLike | null> {
    const held = store()
    if (!held?.getPool) return null
    try { await held.initialize?.() } catch { /* boot handles its own failure */ }
    return await held.getPool(COMFY_GENERATIONS_POOL)
  }

  /** Write "these exact bytes were made like this", named by the bytes. */
  async #record(result: ComfyResult, workflow: ComfyWorkflowSpec, params: ComfyParams): Promise<void> {
    const dir = await this.#pool()
    if (!dir) return
    const record: ComfyGenerationRecord = {
      kind: 'comfy-generation@1',
      workflow: workflow.id,
      label: workflow.label,
      ...(params.positive ? { positive: params.positive } : {}),
      ...(params.negative ? { negative: params.negative } : {}),
      ...(params.seed !== undefined ? { seed: params.seed } : {}),
      ...(params.steps !== undefined ? { steps: params.steps } : {}),
      ...(params.cfg !== undefined ? { cfg: params.cfg } : {}),
      ...(params.width !== undefined ? { width: params.width } : {}),
      ...(params.height !== undefined ? { height: params.height } : {}),
      ...(params.checkpoint ? { model: params.checkpoint } : {}),
      at: Date.now(),
    }
    try {
      const bytes = new TextEncoder().encode(JSON.stringify(record)).buffer as ArrayBuffer
      const handle = await dir.getFileHandle(result.largeSig, { create: true })
      const writable = await handle.createWritable()
      try { await writable.write(bytes) } finally { await writable.close() }
    } catch { /* a picture without its record is still a picture */ }
  }

  /** What made these bytes, if this hive knows. */
  async generationOf(imageSig: string): Promise<ComfyGenerationRecord | null> {
    if (!imageSig) return null
    const dir = await this.#pool()
    if (!dir) return null
    try {
      const handle = await dir.getFileHandle(imageSig, { create: false })
      const file = await handle.getFile()
      if (!file.size) return null
      return JSON.parse(await file.text()) as ComfyGenerationRecord
    } catch { return null }
  }

  /** What made the picture this tile is wearing. */
  async generationOfCell(cell: string): Promise<ComfyGenerationRecord | null> {
    try {
      const props = await readTilePropertiesAt(this.#segments(), cell)
      for (const sig of tilePictureCandidates(props)) {
        const record = await this.generationOf(sig)
        if (record) return record
      }
    } catch { /* an unreadable tile simply has no record */ }
    return null
  }

  /**
   * THE SAME PICTURE AGAIN, DIFFERENTLY. Reads the record off the tile's
   * current picture and runs it again with a new seed — which is the gesture
   * people actually make ("nearly, but not that face"), and the reason the
   * record is worth keeping at all. A tile whose picture this hive did not
   * generate has nothing to re-roll, and says so.
   */
  async reroll(cell?: string, overrides: ComfyRunRequest = {}): Promise<readonly ComfyResult[]> {
    const target = cell ?? this.targetCell()
    if (!target) {
      this.#setJob({ state: 'error', message: 'no tile selected' })
      return []
    }
    const record = await this.generationOfCell(target)
    if (!record) {
      this.#setJob({ state: 'error', message: `"${target}" was not made here` })
      return []
    }
    return this.run({
      workflowId: record.workflow,
      positive: record.positive,
      negative: record.negative,
      steps: record.steps,
      cfg: record.cfg,
      width: record.width,
      height: record.height,
      checkpoint: record.model,
      ...overrides,
      seed: overrides.seed ?? randomSeed(),
      cell: target,
      attach: overrides.attach ?? true,
    })
  }

  #releaseResults(): void {
    for (const result of this.#results) {
      try { URL.revokeObjectURL(result.previewUrl) } catch { /* already gone */ }
    }
    this.#results = []
  }
}

export const comfyService = new ComfyService()

window.ioc?.register?.(COMFY_SERVICE_KEY, comfyService)

/** The live map is REPLACED after the early barrel modules register (the
 *  lesson in llm-provider-registry). Re-assert on a post-boot path so a
 *  consumer resolving late still finds the service. */
export const ensureComfyServiceRegistered = (): void => {
  const held = (window as unknown as { ioc?: { get?: (k: string) => unknown; register?: (k: string, v: unknown) => void } }).ioc
  if (held?.get?.(COMFY_SERVICE_KEY)) return
  held?.register?.(COMFY_SERVICE_KEY, comfyService)
}
