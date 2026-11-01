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
// "here are some bytes, what made them" with no index and no scan. The same
// record is also a resource, and the tile revision that receives the picture
// names it. History can return to that revision, and the details come with it.
//
// THE SOCKET IS NEVER THE TRUTH. Progress comes over the WebSocket because a
// progress bar should move; the RESULT is read from `/history`, always, even
// when the socket already delivered it. A dropped socket must cost a
// participant a progress bar, never a picture.

import { EffectBus, isReservedPoolWord } from '@hypercomb/core'
import { createTile } from '../commands/trait-read.js'
import { storeImageResources } from '../editor/arm-resource.js'
import { generateHexThumbnails } from '../editor/resource-thumbnail.js'
import { readTilePropertiesAt, tilePictureCandidates } from '../editor/tile-properties.js'
import { promptFromTile, promptFromWords } from './comfy-roll.js'
import { comfyFolder, importable, tooLargeMessage } from './comfy-folder.js'
import { ComfyHost, comfyHost, type ComfyFileRef } from './comfy-host.js'
import { readyRecipes } from './comfy-recipes.js'
import { activeWorkflow, comfyWorkflow } from './comfy-workflows.js'
import {
  applyParams,
  randomSeed,
  type ComfyGraph,
  type ComfyParams,
  type ComfyWorkflowSpec,
} from './comfy-workflow.js'
import { emptyLoadClock, noteCached, noteExecuting, type LoadClock } from './comfy-weights.js'
import {
  COMFY_REVIEWER_DEFAULT,
  clampReviewers,
  helpedPrompt,
  pictureContext,
  REVIEWER_SYSTEM,
  tileBriefText,
  type ReviewerAsk,
} from './comfy-help.js'

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
  /** The generation record, when it was stored. The tile revision names it. */
  generationSig?: string
}

/** What a picture was made from. Content, keyed by the picture's signature. */
export interface ComfyGenerationRecord {
  kind: 'comfy-generation@1'
  workflow: string
  label?: string
  /** The name the participant gave the picture. Absent until they type one. */
  name?: string
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
  /** Put the first result on `cell` (or the selection) when `tiles` is not set. */
  attach?: boolean
  /** Selected tiles each receive a picture; `/comfy <prompt>` does this. With
   *  nothing selected the pictures wait as assets. A caller that only wants the
   *  bytes (a substrate candidate) leaves this unset. */
  tiles?: boolean
  /** The pictures are assets and land nowhere. The desk's Generate. */
  assets?: boolean
  /** Read each selected tile's picture and properties before the prompt is set. */
  fromTile?: boolean
  /** How many reviewers write a prompt. Jev picks one. */
  reviewers?: number
}

/** A tiles run paints every selected tile, one picture each. An empty
 *  selection means new tiles. A caller that is not making tiles (a re-roll,
 *  a substrate candidate) does not paint the selection. */
export const cellsToPaint = (makeTiles: boolean, selected: readonly string[]): string[] =>
  makeTiles ? selected.filter(name => name.trim().length > 0) : []

const assetsMessage = (count: number): string =>
  count === 1 ? '1 picture in your assets' : `${count} pictures in your assets`

type DirLike = {
  getFileHandle(name: string, options?: { create?: boolean }): Promise<{
    getFile(): Promise<{ size: number; text(): Promise<string> }>
    createWritable(): Promise<{ write(data: ArrayBuffer): Promise<void>; close(): Promise<void> }>
  }>
}
type StoreLike = {
  initialize?: () => Promise<void>
  getPool?: (meaning: string) => Promise<DirLike | null>
  putResource?: (blob: Blob) => Promise<string>
  getResource?: (sig: string) => Promise<Blob | null>
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
  /** The graph whose loader nodes the clock is timing. */
  #runGraph: ComfyGraph | null = null
  #clock: LoadClock = emptyLoadClock()
  /** True only between queue and the run ending, so a late socket frame
   *  cannot start a new load after the picture is already done. */
  #timing = false
  #fromTile = false
  #reviewers = COMFY_REVIEWER_DEFAULT
  /** Set while reviewers are writing, so Stop can end that and not the host. */
  #helpAbort: AbortController | null = null

  get job(): ComfyJob { return this.#job }
  /** The from-the-tile switch, for `/comfy <prompt>` after the window set it. */
  get help(): { fromTile: boolean; reviewers: number } {
    return { fromTile: this.#fromTile, reviewers: this.#reviewers }
  }

  setHelp(next: { fromTile?: boolean; reviewers?: number }): void {
    if (typeof next.fromTile === 'boolean') this.#fromTile = next.fromTile
    if (next.reviewers !== undefined) this.#reviewers = clampReviewers(next.reviewers)
  }
  /** Load times for the model list. Milliseconds survive a new run; the
   *  open loader does not. */
  get loadClock(): LoadClock { return this.#clock }
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

  /**
   * A new prompt for the form. `words` uses common picture words. `tile`
   * uses the selected tile. Nothing selected makes no tile prompt.
   * Generate stays the participant's own press.
   */
  async rollPrompt(kind: string): Promise<string | null> {
    if (kind === 'words') {
      this.#clearRollMiss()
      return promptFromWords()
    }
    const cell = this.targetCell()
    if (!cell) {
      this.#setJob({ state: 'error', message: 'Select a tile first.' })
      return null
    }
    let props: unknown = {}
    try { props = await readTilePropertiesAt(this.#segments(), cell) } catch { /* the name still helps */ }
    const made = promptFromTile(cell, props)
    if (made) this.#clearRollMiss()
    return made || null
  }

  /** A later roll that did make a prompt should not keep the miss sentence. */
  #clearRollMiss(): void {
    if (this.#job.state === 'error' && this.#job.message === 'Select a tile first.') {
      this.#setJob({ state: 'idle', message: '' })
    }
  }

  /** Every tile in the selection, in the order they were selected. */
  selectedCells(): string[] {
    const selection = ioc<{ selected?: ReadonlySet<string> }>(
      '@diamondcoreprocessor.com/SelectionService')
    const named = selection?.selected ? [...selection.selected] : []
    if (named.length) return named
    const drone = ioc<{ selectedLabels?: string[] }>('@diamondcoreprocessor.com/TileSelectionDrone')
    return (drone?.selectedLabels ?? []).filter(name => !!name)
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
    if (typeof request.fromTile === 'boolean' || typeof request.reviewers === 'number') {
      this.setHelp({
        ...(typeof request.fromTile === 'boolean' ? { fromTile: request.fromTile } : {}),
        ...(typeof request.reviewers === 'number' ? { reviewers: request.reviewers } : {}),
      })
    }

    // The local server, and the workflows it can already run, before a graph
    // is chosen. A down server is a sentence, not a cached empty roster.
    await readyRecipes()

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

    // A selection means those tiles. One picture each, on the tile itself.
    // An asset run still reads them when the tile is helping, and lands nowhere.
    const selected = this.selectedCells()
    const painting = cellsToPaint(request.tiles === true, selected)
    if (painting.length) return this.#paintEach(request, painting)
    if (request.assets && request.fromTile && selected.length) return this.#paintEach(request, selected, false)

    const results = await this.#produce(request)
    if (!results.length) return []

    // Every picture is already in the pool. Nothing asked for it yet.
    if (request.tiles || request.assets) {
      this.#setJob({ state: 'done', message: assetsMessage(results.length) })
      EffectBus.emit('comfy:results', { count: results.length, workflow: workflow.id })
      return results
    }

    if (request.attach !== false) {
      const cell = request.cell ?? this.targetCell()
      if (cell && results[0]) this.attach(results[0], cell)
    }

    this.#setJob({
      state: 'done',
      message: `${results.length} picture${results.length === 1 ? '' : 's'}`,
    })
    EffectBus.emit('comfy:results', { count: results.length, workflow: workflow.id })
    return results
  }

  /** One picture for each selected tile. A tile leaves the selection when
   *  its picture lands. The ones still waiting stay selected. The list was
   *  taken before the first picture, so dropping one does not skip the rest.
   *  `land` false reads each tile for its picture and keeps it as an asset. */
  async #paintEach(request: ComfyRunRequest, cells: readonly string[], land = true): Promise<readonly ComfyResult[]> {
    this.#releaseResults()
    const gathered: ComfyResult[] = []
    const painted: string[] = []
    for (let i = 0; i < cells.length; i++) {
      if (i > 0 && (this.#job.state === 'idle' || this.#job.state === 'error')) break
      const cell = cells[i] as string
      let next = request
      if (request.fromTile === true) {
        const positive = await this.#helpPositive(cell, request.positive ?? '', request.reviewers)
        if (positive === null) {
          if (painted.length && this.#job.state !== 'idle') this.#finishPainted(painted, gathered, request.workflowId)
          return gathered
        }
        if (positive) next = { ...request, positive }
      }
      const seed = typeof request.seed === 'number' ? request.seed + i : randomSeed()
      const progress = cells.length > 1 ? `${cell} (${i + 1}/${cells.length})` : cell
      const batch = await this.#produce(
        { ...next, seed, batch: 1, tiles: false, attach: false },
        progress,
        false,
      )
      const picture = batch[0]
      if (!picture) {
        if (painted.length) this.#finishPainted(painted, gathered, request.workflowId)
        return gathered
      }
      if (land) this.attach(picture, cell)
      gathered.push(picture)
      painted.push(cell)
      this.#results = gathered.slice()
      this.#setJob({ state: 'running', message: `"${cell}"` })
    }
    this.#finishPainted(painted, gathered, request.workflowId, land)
    return gathered
  }

  #finishPainted(painted: readonly string[], gathered: readonly ComfyResult[], workflowId?: string, land = true): void {
    this.#results = gathered.slice()
    this.#setJob({
      state: 'done',
      message: land ? painted.map(name => `"${name}"`).join(', ') : assetsMessage(gathered.length),
    })
    EffectBus.emit('comfy:results', { count: gathered.length, workflow: workflowId ?? activeWorkflow().id })
  }

  /**
   * Queue one graph and bring its pictures back. Does not decide where they
   * land — the caller paints a selection, makes tiles, or attaches.
   */
  async #produce(request: ComfyRunRequest, progress?: string, release = true): Promise<ComfyResult[]> {
    const workflow: ComfyWorkflowSpec = (request.workflowId ? comfyWorkflow(request.workflowId) : undefined)
      ?? activeWorkflow()
    const seed = typeof request.seed === 'number' ? request.seed : randomSeed()
    const checkpoint = await this.#resolveCheckpoint(
      request.checkpoint ?? (workflow.seams.checkpoint
        ? workflow.graph[workflow.seams.checkpoint.node]?.inputs?.[workflow.seams.checkpoint.input] as string
        : undefined))

    const graph = applyParams(workflow.graph, workflow.seams, { ...request, seed, checkpoint })

    if (release) this.#releaseResults()
    const where = progress ? `${workflow.label} — ${progress}` : `${workflow.label} — queued`
    this.#setJob({ state: 'queued', message: where })

    let promptId: string
    try {
      this.#beginLoads(graph)
      this.#attachSocket()
      promptId = await comfyHost.queue(graph)
    } catch (err) {
      this.#closeLoad()
      this.#setJob({ state: 'error', message: (err as Error)?.message ?? 'the server refused the workflow' })
      return []
    }

    this.#setJob({ state: 'running', promptId, message: progress ? `${workflow.label} — ${progress}` : workflow.label })

    const run = await this.#await(promptId)
    this.#closeLoad()
    if (!run) {
      this.#setJob({ state: 'error', promptId, message: 'the run did not finish' })
      return []
    }

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
      // Past this line the bytes enter the hive. An oversized picture stays
      // where ComfyUI wrote it (comfy-folder.ts).
      if (!importable(blob.size)) { refused = tooLargeMessage(blob.size); continue }
      const stored = await storeImageResources(blob)
      if (!stored) continue
      const generationSig = await this.#record(
        { ...stored, file, seed, workflowId: workflow.id },
        workflow,
        { ...request, seed, checkpoint },
      )
      const result: ComfyResult = {
        ...stored, file, seed, workflowId: workflow.id,
        ...(generationSig ? { generationSig } : {}),
      }
      results.push(result)
    }

    if (release) this.#results = results
    if (!results.length) {
      this.#setJob({ state: 'error', promptId, message: refused || 'the pictures could not be read back' })
      return []
    }
    return results
  }

  /**
   * The prompt for one tile: reviewers read its picture and its properties,
   * Jev picks, and the participant's words stay in. Null means Stop.
   */
  async #helpPositive(cell: string, own: string, reviewers: number | undefined): Promise<string | null> {
    const abort = new AbortController()
    this.#helpAbort = abort
    this.#setJob({ state: 'running', message: `choosing a prompt for ${cell}` })
    try {
      const context = await this.#tileContext(cell)
      if (abort.signal.aborted) return null
      const [{ callModel }, { jevDecision }] = await Promise.all([
        import('../assistant/llm-dispatch.js'),
        import('../assistant/jev-decision.service.js'),
      ])
      const image = context.image
      const propose = async (ask: ReviewerAsk): Promise<string> => {
        const once = async (withImage: boolean): Promise<string> => {
          const result = await callModel({
            need: { tier: 'fast' },
            maxTokens: 200,
            system: REVIEWER_SYSTEM,
            messages: [{
              role: 'user',
              content: ask.content,
              ...(withImage && image ? { images: [image] } : {}),
            }],
            signal: abort.signal,
          })
          return result.text
        }
        try {
          return await once(!!image)
        } catch (err) {
          if (abort.signal.aborted || !image) throw err
          return await once(false)
        }
      }
      const choose = async (options: readonly string[]): Promise<number> => {
        if (abort.signal.aborted) throw new Error('stopped')
        if (!jevDecision.readyForHive()) return -1
        const result = await jevDecision.pickComfy({
          tile: cell,
          own: own.trim(),
          brief: context.brief,
          options: [...options],
        }, abort.signal)
        return result.index < 0 ? -2 : result.index
      }
      const positive = await helpedPrompt({
        own,
        brief: context.brief,
        reviewers: reviewers ?? this.#reviewers,
        propose,
        choose,
        stopped: () => abort.signal.aborted,
      })
      return abort.signal.aborted ? null : positive
    } catch {
      return abort.signal.aborted ? null : own.trim()
    } finally {
      if (this.#helpAbort === abort) this.#helpAbort = null
    }
  }

  /** Properties in words, plus the picture when its bytes are here. */
  async #tileContext(cell: string): Promise<{ brief: string; image?: { mime: string; base64: string } }> {
    let props: unknown = {}
    try { props = await readTilePropertiesAt(this.#segments(), cell) } catch { /* the name still helps */ }
    let reading = ''
    let image: { mime: string; base64: string } | undefined
    try {
      const held = ioc<{ getResource?: (sig: string) => Promise<Blob | null> }>('@hypercomb.social/Store')
      if (held?.getResource) {
        for (const sig of tilePictureCandidates(props)) {
          const blob = await held.getResource(sig)
          if (!blob || blob.size <= 0) continue
          const seen = await pictureContext(blob)
          reading = seen.reading
          image = seen.image
          break
        }
      }
    } catch { /* the properties still help */ }
    return { brief: tileBriefText(cell, props, reading), image }
  }

  /** Stop the run that is going, if one is. A prompt still being chosen does
   *  not interrupt the host — that would stop someone else's picture. */
  async cancel(): Promise<void> {
    if (this.#helpAbort) {
      this.#helpAbort.abort()
      this.#helpAbort = null
      this.#setJob({ state: 'idle', message: 'stopped' })
      return
    }
    if (this.#job.state !== 'queued' && this.#job.state !== 'running') return
    await comfyHost.interrupt()
    this.#closeLoad()
    this.#setJob({ state: 'idle', message: 'stopped' })
  }

  /** Start timing this graph. Earlier load times stay; the open node does not,
   *  so the same loader can be measured again. */
  #beginLoads(graph: ComfyGraph): void {
    this.#runGraph = graph
    this.#clock = { ...this.#clock, node: null, file: null, since: 0 }
    this.#timing = true
  }

  #noteNode(nodeId: string | null): void {
    const graph = this.#runGraph
    if (!graph) return
    const next = noteExecuting(this.#clock, graph, nodeId, Date.now())
    if (next === this.#clock) return
    this.#clock = next
    EffectBus.emit('comfy:loads', {})
  }

  /** Close whatever loader is open. A second call is a no-op. */
  #closeLoad(): void {
    if (!this.#timing && !this.#clock.file) return
    this.#timing = false
    this.#noteNode(null)
  }

  #attachSocket(): void {
    if (this.#listening) return
    this.#listening = true
    comfyHost.listen({
      onProgress: progress => {
        // Step ticks repeat the same node. Only a new node id moves the clock,
        // and a status frame (no node) must not close the loader.
        if (this.#timing && typeof progress.node === 'string' && progress.node) {
          this.#noteNode(progress.node)
        }
        if (this.#job.state !== 'running' && this.#job.state !== 'queued') return
        const fraction = progress.max ? (progress.value ?? 0) / progress.max : undefined
        this.#setJob({
          ...this.#job,
          state: 'running',
          ...(fraction !== undefined ? { fraction } : {}),
          ...(progress.queued !== undefined ? { queued: progress.queued } : {}),
        })
      },
      onCached: nodeIds => {
        const graph = this.#runGraph
        if (!this.#timing || !graph) return
        const next = noteCached(this.#clock, graph, nodeIds)
        if (next === this.#clock) return
        this.#clock = next
        EffectBus.emit('comfy:loads', {})
      },
      onError: (_promptId, message) => {
        this.#closeLoad()
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
   *
   * NO TARGET IS NOT NOTHING TO DO. A picture with nowhere to land takes the
   * same door every other ownerless picture takes — it arms the command-line
   * chevron slot (`command:arm-resource`), so naming it and pressing Enter
   * creates the tile. Silently no-op'ing here read as "clicking does
   * nothing", because most of the time nothing is selected yet.
   */
  attach(result: ComfyResult, cell?: string, segments?: readonly string[]): boolean {
    const target = cell ?? this.targetCell()
    if (!target) { this.#arm(result); return false }
    EffectBus.emit('cell:attach-resource', {
      cell: target,
      ...(segments ? { segments } : {}),
      largeSig: result.largeSig,
      smallPointSig: result.smallPointSig,
      smallFlatSig: result.smallFlatSig,
      url: null,
      type: 'image',
      ...(result.generationSig ? { generationSig: result.generationSig } : {}),
    })
    this.#dropSelected(target)
    EffectBus.emit('activity:log', { message: `picture on "${target}"`, icon: '◈' })
    return true
  }

  /** The tile's picture just changed. It is no longer part of the batch. */
  #dropSelected(label: string): void {
    ioc<{ remove?: (label: string) => void }>(
      '@diamondcoreprocessor.com/SelectionService')?.remove?.(label)
  }

  /** Arm the command-line chevron slot with a result already in the store —
   *  the sigs are already known, so this skips `storeImageResources` entirely
   *  rather than re-hashing bytes `run()` or `keep()` just hashed.
   *
   *  `preview` is false when a tile is about to be created from this arm.
   *  Dismissing the arm revokes its object URL, and that URL is also the
   *  panel thumbnail. */
  #arm(result: ComfyResult, preview = true): void {
    EffectBus.emit('command:arm-resource', {
      armId: null,
      atTop: false,
      previewUrl: preview ? result.previewUrl : '',
      largeSig: result.largeSig,
      smallPointSig: result.smallPointSig,
      smallFlatSig: result.smallFlatSig,
      url: null,
      type: 'image',
      attachment: null,
      name: null,
      ...(result.generationSig ? { generationSig: result.generationSig } : {}),
    })
  }

  /**
   * An asset, ready to land. The signature IS the large picture, so it is read
   * as it stands and never stored again: `storeImageResources` re-encodes, and
   * a re-encode would make a second picture of the same thing. Only the two
   * small pictures are derived, and the same source reaches the same signatures.
   */
  async #asset(sig: string): Promise<ComfyResult | null> {
    const held = store()
    const blob = await held?.getResource?.(sig)
    if (!held?.putResource || !blob?.size) {
      this.#setJob({ state: 'error', message: 'that picture is not in this hive' })
      return null
    }
    const hex = await generateHexThumbnails(blob)
    const record = await this.generationOf(sig)
    const generationSig = record ? await this.#persistGeneration(sig, record, false) : null
    return {
      largeSig: sig,
      smallPointSig: hex.pointBlob ? await held.putResource(hex.pointBlob) : null,
      smallFlatSig: hex.flatBlob ? await held.putResource(hex.flatBlob) : null,
      previewUrl: '',
      file: { filename: '', subfolder: '', type: 'output' },
      seed: record?.seed ?? 0,
      workflowId: record?.workflow ?? '',
      ...(generationSig ? { generationSig } : {}),
    }
  }

  /** Put an asset on a tile that exists. The picture is named by its signature. */
  async placeOn(sig: string, cell: string, segments?: readonly string[]): Promise<boolean> {
    const result = await this.#asset(sig)
    if (!result) return false
    this.attach(result, cell, segments)
    this.#setJob({ state: 'done', message: `picture on "${cell}"` })
    return true
  }

  /**
   * Put an asset on a new tile under the name the participant typed. A blank
   * name and a reserved word make nothing. The command line is the create door,
   * so a name it refuses leaves the picture as it was.
   */
  async placeNamed(sig: string, raw: string): Promise<boolean> {
    const name = raw.trim()
    const parts = name.split('/').map(part => part.trim()).filter(Boolean)
    if (!parts.length) {
      this.#setJob({ state: 'error', message: 'Type a name first.' })
      return false
    }
    const reserved = parts.find(part => isReservedPoolWord(part))
    if (reserved) {
      this.#setJob({ state: 'error', message: `"${reserved}" is a reserved word. Choose another name.` })
      return false
    }
    const result = await this.#asset(sig)
    if (!result) return false
    await this.#stampName(result, name)
    this.#arm(result, false)
    const ok = await Promise.race([
      createTile(name),
      new Promise<boolean>(resolve => setTimeout(() => resolve(false), 20_000)),
    ])
    if (!ok) {
      this.#setJob({ state: 'error', message: 'That name was not accepted.' })
      return false
    }
    this.#setJob({ state: 'done', message: `"${name}" is on the hive` })
    EffectBus.emit('activity:log', { message: `"${name}" is a tile`, icon: '◈' })
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
   * copied into the store, where it is an asset like any other. Everything
   * else they looked at stays a preview URL over a file on disk, and is
   * forgotten when the strip closes.
   */
  async keep(file: ComfyFileRef): Promise<string | null> {
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
    try { URL.revokeObjectURL(stored.previewUrl) } catch { /* already gone */ }
    if (!await this.generationOf(stored.largeSig)) {
      await this.#persistGeneration(stored.largeSig, {
        kind: 'comfy-generation@1',
        workflow: '',
        label: file.filename,
        at: Date.now(),
      })
    }
    this.#setJob({ state: 'done', message: assetsMessage(1) })
    return stored.largeSig
  }

  // ── provenance ────────────────────────────────────────────────────────────

  async #pool(): Promise<DirLike | null> {
    const held = store()
    if (!held?.getPool) return null
    try { await held.initialize?.() } catch { /* boot handles its own failure */ }
    return await held.getPool(COMFY_GENERATIONS_POOL)
  }

  /** Write "these exact bytes were made like this", named by the bytes.
   *  The same JSON is a resource, so the tile revision can name it.
   *  The participant's name is written later, when they give the picture one. */
  async #record(result: ComfyResult, workflow: ComfyWorkflowSpec, params: ComfyParams): Promise<string | null> {
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
    // the same bytes made again: the record already held (its name, its first
    // provenance) stands; nothing is overwritten, only a resource sig returned
    const existing = await this.generationOf(result.largeSig)
    return this.#persistGeneration(result.largeSig, existing ?? record, !existing)
  }

  /** The name they typed, on the same record the tile revision will name. */
  async #stampName(result: ComfyResult, name: string): Promise<void> {
    const existing = await this.generationOf(result.largeSig)
      ?? (result.generationSig ? await this.#generationNamed({ generation: result.generationSig }) : null)
    if (!existing) return
    const sig = await this.#persistGeneration(result.largeSig, { ...existing, name }, true)
    if (sig) result.generationSig = sig
  }

  /** One writer for the pool file and the resource. The pool member stays
   *  keyed by the image signature; the resource signature is what a tile names. */
  async #persistGeneration(imageSig: string, record: ComfyGenerationRecord, writePool = true): Promise<string | null> {
    const bytes = new TextEncoder().encode(JSON.stringify(record)).buffer as ArrayBuffer
    const dir = writePool ? await this.#pool() : null
    if (dir) {
      try {
        const handle = await dir.getFileHandle(imageSig, { create: true })
        const writable = await handle.createWritable()
        try { await writable.write(bytes) } finally { await writable.close() }
      } catch { /* a picture without its pool record is still a picture */ }
    }
    try {
      const sig = await store()?.putResource?.(new Blob([bytes], { type: 'application/json' }))
      return sig && /^[0-9a-f]{64}$/.test(sig) ? sig : null
    } catch { return null }
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

  /** The record a tile revision names, when the properties carry one.
   *  `getResource` follows a Life incidence to the record. */
  async #generationNamed(props: unknown): Promise<ComfyGenerationRecord | null> {
    const sig = (props as { generation?: unknown } | null)?.generation
    if (typeof sig !== 'string' || !/^[0-9a-f]{64}$/.test(sig)) return null
    try {
      const blob = await store()?.getResource?.(sig)
      if (!blob) return null
      const parsed = JSON.parse(await blob.text()) as ComfyGenerationRecord
      return parsed?.kind === 'comfy-generation@1' ? parsed : null
    } catch { return null }
  }

  /** What made the picture this tile is wearing. */
  async generationOfCell(cell: string): Promise<ComfyGenerationRecord | null> {
    try {
      const props = await readTilePropertiesAt(this.#segments(), cell)
      const named = await this.#generationNamed(props)
      if (named) return named
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
// comfy/comfy.drone.ts registers this (atomic-modules-plan.md): a dependency registers nothing.

/** The live map is REPLACED after the early barrel modules register (the
 *  lesson in llm-provider-registry). Re-assert on a post-boot path so a
 *  consumer resolving late still finds the service. */
export const ensureComfyServiceRegistered = (): void => {
  const held = (window as unknown as { ioc?: { get?: (k: string) => unknown; register?: (k: string, v: unknown) => void } }).ioc
  if (held?.get?.(COMFY_SERVICE_KEY)) return
  held?.register?.(COMFY_SERVICE_KEY, comfyService)
}
