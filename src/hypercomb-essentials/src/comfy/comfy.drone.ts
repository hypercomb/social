// comfy/comfy.drone.ts
//
// THE COMFYUI SURFACE'S DATA SIDE.
//
// Everything a surface shows crosses as one `comfy:render` payload and everything
// it does comes back as an intent. The desk (comfy-desk/) reads this and is one
// reading of it, so another surface can stand in its place. Nothing on a surface
// knows what a seam is; nothing here knows what a desk is.
//
// THE PARAMS ARE THE SURFACE'S, NOT THIS DRONE'S. A form whose values round-trip
// through a bus on every keystroke fights the typist. What crosses is the
// SEED — what the active workflow's seams currently hold — plus which knobs
// exist at all; the surface holds the edit and hands the whole set back with
// `comfy:generate`.

import { Drone } from '@hypercomb/core'
import { comfyFolder } from './comfy-folder.js'
import { comfyHost, type ComfyFileRef } from './comfy-host.js'
import { readyRecipes } from './comfy-recipes.js'
import { COMFY_SERVICE_KEY, comfyService, type ComfyJob } from './comfy.service.js'
import { weightRoster } from './comfy-weights.js'
import { listComfyPrompts, saveComfyPrompt, type ComfyPromptDraft, type ComfyPromptSaved } from './comfy-prompts.js'
import { continuationKeyOfGraph, readComfyDraft, saveComfyDraft, type ComfyDraft } from './comfy-draft.js'
import { offeredKnobs, readParams, type ComfyParams } from './comfy-workflow.js'
import {
  activeWorkflow,
  BUILTIN_WORKFLOW_ID,
  comfyWorkflows,
  importComfyWorkflow,
  setActiveWorkflow,
} from './comfy-workflows.js'

/** One picture a surface can show without anything being copied: an object
 *  URL over a file that already exists on disk or on the host. */
interface ComfyPicture {
  url: string
  /** Where it came from, so an intent can name it without the panel holding
   *  a file handle. */
  filename: string
  subfolder: string
  type: string
  size: number
  seed: number
}

export interface ComfyRenderPayload {
  open: boolean
  /** Which section to reveal on the way in, when a command asked for one. */
  reveal: string
  endpoint: string
  reachOk: boolean
  /** '' while nobody has asked yet — NOT a failure, and the panel must not
   *  draw it as one. */
  reachReason: string
  reachAsking: boolean
  folderSupported: boolean
  folderLinked: boolean
  folderLabel: string
  browsing: boolean
  folderPictures: ComfyPicture[]
  workflows: { id: string; label: string }[]
  active: string
  activeLabel: string
  /** Which controls this workflow actually offers — the form is built from
   *  it, so a workflow with no negative prompt shows no negative field. */
  knobs: string[]
  seeds: ComfyParams
  job: ComfyJob
  /** What the last run made, by signature. The pictures are the pool's. */
  results: { sig: string; seed: number }[]
  target: string
  /** Tiles selected in the hive: the near door for putting a picture down. */
  targets: string[]
  importError: string
  /** Every model and LoRA the recipes name, and which of them this workflow loads. */
  weights: ComfyWeightRow[]
  /** Kept prompts. `text` is the only thing the list draws. */
  prompts: ComfyPromptSaved[]
  /** Set on the one render that should load a kept state into the form. */
  applyPrompt?: ComfyPromptSaved
  /** Set on the one render that should load a history generation into the form. */
  generation?: ComfyGenerationRestore
  /** Set on the one render that should replace the prompt text. */
  rolled?: string
  /** The read of this combination's continuation has finished. */
  draftReady?: boolean
  /** The form last left on this model and these LoRAs. Absent when none. */
  resume?: ComfyDraft
}

/** The knobs a history point carries back into the form. */
export interface ComfyGenerationRestore {
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
}

/** One file in the model list. */
export interface ComfyWeightRow {
  file: string
  kind: string
  label: string
  active: boolean
  ms?: number
  cached?: boolean
  loading?: boolean
  since?: number
}

export class ComfyDrone extends Drone {

  readonly namespace = 'diamondcoreprocessor.com'

  protected override listens: string[] = [
    'comfy:open', 'comfy:close', 'comfy:reopen', 'comfy:set-endpoint', 'comfy:discover',
    'comfy:link-folder', 'comfy:browse', 'comfy:set-workflow',
    'comfy:import-workflow', 'comfy:generate', 'comfy:set-help', 'comfy:cancel',
    'comfy:library', 'comfy:save-prompt', 'comfy:use-prompt', 'comfy:restore-generation', 'comfy:roll',
    'comfy:remember',
    'comfy:keep', 'comfy:place-asset', 'comfy:job', 'comfy:loads', 'comfy:host-changed',
    'comfy:folder-changed', 'comfy:workflows-changed', 'selection:changed',
  ]
  protected override emits: string[] = ['comfy:render', 'activity:log']

  #open = false
  #reveal = ''
  #browsing = false
  #importError = ''
  #folderPictures: ComfyPicture[] = []
  /** The library, swept when the window opens, when it is asked, and after a keep. */
  #prompts: ComfyPromptSaved[] = []
  /** Consumed by the next render, then cleared, so a later paint cannot clobber the form. */
  #applyPrompt: ComfyPromptSaved | null = null
  #rolled = ''
  /** Consumed by the next render, then cleared. */
  #resume: ComfyDraft | undefined = undefined
  #draftReady = false
  #resumeToken = 0
  /** A history generation, consumed the same way. */
  #generation: ComfyGenerationRestore | null = null

  constructor() {
    super()

    // Do not probe from the hive boot. ComfyUI is often not running, and
    // discover() then logs a refused /system_stats for every usual port.
    // Opening the desk warms it.

    this.onEffect<{ section?: string }>('comfy:open', (p) => {
      const section = String(p?.section ?? '')
      // A word that asked for a section is a request to LOOK at something,
      // never to put the window away — only the bare gesture toggles.
      if (section) { this.#open = true; this.#reveal = section }
      else { this.#open = !this.#open; this.#reveal = '' }
      if (this.#open) void this.#warm()
      this.#emit()
    })

    this.onEffect('comfy:close', () => {
      if (!this.#open) return
      this.#open = false
      this.#releasePictures()
      this.#browsing = false
      this.#emit()
    })

    // THE SHELL PUTS WINDOWS AWAY AND BRINGS THEM BACK, and the state it
    // moves is HERE — one window at a time, a cover over the hive, a return
    // home. Those are not toggles and must not be handled as one: a park that
    // this drone never learned about would leave `/comfy` toggling a window
    // the screen had already lost, doing nothing at all. Idempotent, both
    // directions, announced by the panel's session.
    this.onEffect('comfy:reopen', () => {
      if (this.#open) return
      this.#open = true
      void this.#warm()
      this.#emit()
    })

    this.onEffect<{ endpoint?: string }>('comfy:set-endpoint', (p) => {
      const next = String(p?.endpoint ?? '').trim()
      if (!next) return
      comfyHost.setEndpoint(next)
      void comfyHost.probe().then(() => readyRecipes()).then(() => this.#emit())
      this.#emit()
    })

    this.onEffect('comfy:discover', () => {
      void comfyHost.discover().then(async found => {
        if (found) await readyRecipes()
        this.emitEffect('activity:log', {
          message: found ? `found ComfyUI at ${found}` : 'no ComfyUI on the usual ports',
          icon: '◈',
        })
        this.#emit()
      })
    })

    // MUST stay synchronous from the click. EffectBus.emit runs its handlers
    // in the same task as the press, and `showDirectoryPicker` is only allowed
    // inside that gesture — an await before it loses the activation and the
    // picker never opens.
    this.onEffect('comfy:link-folder', () => {
      void comfyFolder.link().then(ok => {
        if (ok) { this.#browsing = true; void this.#loadFolder() }
        this.#emit()
      })
    })

    this.onEffect<{ open?: boolean }>('comfy:browse', (p) => {
      this.#browsing = p?.open ?? !this.#browsing
      if (this.#browsing) void this.#loadFolder()
      else { this.#releasePictures(); this.#emit() }
    })

    this.onEffect<{ id?: string }>('comfy:set-workflow', (p) => {
      this.#draftReady = false
      this.#resume = undefined
      if (!setActiveWorkflow(String(p?.id ?? ''))) return
      // The change itself already painted. This second paint brings back the
      // form that belongs to the model and LoRAs just selected.
      void this.#loadContinuation().then(() => this.#emit())
    })

    this.onEffect<{ json?: string }>('comfy:import-workflow', (p) => {
      void importComfyWorkflow(String(p?.json ?? ''), { label: 'pasted workflow' })
        .then(async spec => {
          this.#draftReady = false
          this.#resume = undefined
          setActiveWorkflow(spec.id)
          this.#importError = ''
          this.emitEffect('activity:log', { message: `workflow "${spec.label}" added`, icon: '◈' })
          await this.#loadContinuation()
          this.#emit()
        })
        .catch((err: Error) => {
          this.#importError = err?.message ?? 'that workflow could not be read'
          this.#emit()
        })
    })

    // Generate makes assets. Nothing lands until it is asked for by signature.
    this.onEffect<ComfyParams & { fromTile?: boolean; reviewers?: number }>('comfy:generate', (p) => {
      void comfyService.run({ ...(p ?? {}), attach: false, assets: true }).then(() => this.#emit())
    })

    this.onEffect<{ fromTile?: boolean; reviewers?: number }>('comfy:set-help', (p) => {
      comfyService.setHelp(p ?? {})
    })

    // The form, put aside for the model and LoRAs it was written under.
    // No paint: a save must not put the words back into the box.
    this.onEffect<{ key?: string; draft?: ComfyDraft }>('comfy:remember', (p) => {
      const key = String(p?.key ?? '')
      const draft = p?.draft
      if (!key || !draft || typeof draft.positive !== 'string') return
      void saveComfyDraft(key, draft)
    })

    // A new prompt in the form. The picture waits for Generate.
    this.onEffect<{ kind?: string }>('comfy:roll', (p) => {
      void comfyService.rollPrompt(String(p?.kind ?? '')).then(text => {
        if (text) this.#rolled = text
        this.#emit()
      })
    })

    this.onEffect('comfy:library', () => { void this.#loadPrompts() })

    this.onEffect<ComfyPromptDraft>('comfy:save-prompt', (p) => {
      const workflow = activeWorkflow()
      void saveComfyPrompt({
        ...(p ?? {}),
        workflow: workflow.id,
        label: workflow.label,
      }).then(sig => { if (sig) void this.#loadPrompts() })
    })

    // Load the state into the form. The picture waits for Generate.
    // The apply rides the same render as a workflow change, because that
    // change re-seeds the form from the workflow's own defaults.
    this.onEffect<{ sig?: string }>('comfy:use-prompt', (p) => {
      const row = this.#prompts.find(one => one.sig === String(p?.sig ?? ''))
      if (!row) return
      this.#applyPrompt = row
      this.#draftReady = false
      this.#resume = undefined
      const moved = !!row.workflow && setActiveWorkflow(row.workflow)
      if (!moved) this.#emit()
    })

    // A history point. Open the window on those knobs. Generate stays the
    // participant's own press.
    this.onEffect<ComfyGenerationRestore>('comfy:restore-generation', (p) => {
      if (!p) return
      this.#generation = p
      this.#open = true
      this.#draftReady = false
      this.#resume = undefined
      const moved = !!p.workflow && setActiveWorkflow(p.workflow)
      if (!moved) this.#emit()
    })

    this.onEffect('comfy:cancel', () => { void comfyService.cancel() })

    this.onEffect<{ index?: number }>('comfy:keep', (p) => {
      const picture = this.#folderPictures[Number(p?.index ?? -1)]
      if (!picture) return
      void comfyService.keep(this.#refOf(picture)).then(() => this.#emit())
    })

    // An asset, asked for. A tile that exists, or a new one under a typed name.
    this.onEffect<{ sig?: string; cell?: string; name?: string; segments?: string[] }>('comfy:place-asset', (p) => {
      const sig = String(p?.sig ?? '')
      if (!sig) return
      void (p?.cell ? comfyService.placeOn(sig, p.cell, p.segments) : comfyService.placeNamed(sig, String(p?.name ?? '')))
        .then(() => this.#emit())
    })

    // The four live sources this window is a pure read of. Re-emit on each
    // rather than polling any of them.
    for (const effect of ['comfy:job', 'comfy:loads', 'comfy:host-changed', 'comfy:folder-changed', 'comfy:workflows-changed']) {
      this.onEffect(effect, () => { if (this.#open) this.#emit() })
    }
    // "onto <tile>" has to be true while you look at it.
    this.onEffect('selection:changed', () => { if (this.#open) this.#emit() })
  }

  /** Ask the machine and re-open the folder on the way in — a status dot that
   *  starts grey and turns green on its own answers the only question this
   *  window opens with. */
  async #warm(): Promise<void> {
    await readyRecipes()
    await this.#loadContinuation()
    await this.#loadPrompts()
    const granted = await comfyFolder.restore().catch(() => false)
    if (granted) this.#emit()
  }

  /** The continuation for whatever is active now. A later move wins. */
  async #loadContinuation(): Promise<void> {
    const token = ++this.#resumeToken
    const key = continuationKeyOfGraph(activeWorkflow().graph)
    const draft = key ? await readComfyDraft(key) : null
    if (token !== this.#resumeToken) return
    this.#resume = draft ?? undefined
    this.#draftReady = true
  }

  /** Read the library. Not on every paint — a job tick must not walk the pool. */
  async #loadPrompts(): Promise<void> {
    this.#prompts = await listComfyPrompts()
    if (this.#open) this.#emit()
  }

  #refOf(picture: ComfyPicture): ComfyFileRef {
    return {
      filename: picture.filename,
      subfolder: picture.subfolder,
      type: (picture.type as ComfyFileRef['type']) ?? 'output',
    }
  }

  async #loadFolder(): Promise<void> {
    this.#releasePictures()
    const state = await comfyFolder.state()
    if (state.permission !== 'granted') await comfyFolder.allow()
    const recent = await comfyFolder.recent(24)
    this.#folderPictures = recent.map(entry => ({
      url: entry.url,
      filename: entry.file.filename,
      subfolder: entry.file.subfolder,
      type: entry.file.type,
      size: entry.size,
      seed: 0,
    }))
    this.#emit()
  }

  /** The previews are object URLs over files on disk — revoking them costs
   *  the browser nothing and holding them forever is a leak. The FILES are
   *  untouched either way; nothing here was ever a copy. */
  #releasePictures(): void {
    for (const picture of this.#folderPictures) {
      try { URL.revokeObjectURL(picture.url) } catch { /* already gone */ }
    }
    this.#folderPictures = []
  }

  #emit(): void {
    const workflow = activeWorkflow()
    const applyPrompt = this.#applyPrompt ?? undefined
    this.#applyPrompt = null
    const generation = this.#generation ?? undefined
    this.#generation = null
    const rolled = this.#rolled
    this.#rolled = ''
    const resume = this.#resume
    this.#resume = undefined
    const draftReady = this.#draftReady
    this.#draftReady = false
    const reach = comfyHost.reach
    const asking = !reach.ok && reach.kind === 'unknown'
    const payload: ComfyRenderPayload = {
      open: this.#open,
      reveal: this.#reveal,
      endpoint: comfyHost.endpoint,
      reachOk: reach.ok,
      reachReason: asking ? '' : (reach.reason ?? ''),
      reachAsking: asking,
      folderSupported: typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function',
      folderLinked: comfyFolder.linked,
      folderLabel: comfyFolder.label,
      browsing: this.#browsing,
      folderPictures: [...this.#folderPictures],
      workflows: comfyWorkflows().map(one => ({ id: one.id, label: one.label })),
      active: workflow.id,
      activeLabel: workflow.label,
      knobs: [...offeredKnobs(workflow.seams)] as string[],
      seeds: readParams(workflow.graph, workflow.seams),
      job: comfyService.job,
      results: comfyService.results.map(result => ({ sig: result.largeSig, seed: result.seed })),
      target: comfyService.targetCell() ?? '',
      targets: comfyService.selectedCells(),
      importError: this.#importError,
      prompts: this.#prompts,
      ...(applyPrompt ? { applyPrompt } : {}),
      ...(generation ? { generation } : {}),
      ...(rolled ? { rolled } : {}),
      ...(draftReady ? { draftReady: true } : {}),
      ...(resume ? { resume } : {}),
      weights: weightRoster(
        comfyWorkflows().filter(one => one.id !== BUILTIN_WORKFLOW_ID || one.id === workflow.id),
        workflow.id,
        comfyService.loadClock,
      ),
    }
    this.emitEffect('comfy:render', payload)
  }
}

// THE BEE WIRES (atomic-modules-plan.md): a dependency registers nothing;
// its owner bee registers it.
window.ioc.register(COMFY_SERVICE_KEY, comfyService)

const _comfy = new ComfyDrone()
;(window as { ioc?: { register?: (k: string, v: unknown) => void } }).ioc?.register?.(
  '@diamondcoreprocessor.com/ComfyDrone',
  _comfy,
)
