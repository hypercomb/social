// comfy/comfy.drone.ts
//
// THE COMFYUI SURFACE'S DATA SIDE.
//
// The panel is a shared Angular component and must not import essentials, so
// everything it shows crosses as one `comfy:render` payload and everything it
// does comes back as an intent — the same contract hosts.drone keeps with the
// hosts panel. Nothing in the panel knows what a seam is; nothing here knows
// what a dock lane is.
//
// WHY THE PANEL AND NOT THE FLOATING CARD IT WAS. The first pass built this
// window the way skills and providers are built: a DOM singleton pinned to
// the bottom-right corner. That is a different KIND of window from the docked
// column — it does not take a dock lane, does not answer `--hc-panel-scale`,
// does not sit under the header anchor, and does not resize with its
// neighbours. Beside the Backgrounds, Publish and Hosts windows it read as a
// stray. A tool window is not a free object, and this one is now what the
// rest of them are.
//
// THE PARAMS ARE THE PANEL'S, NOT THIS DRONE'S. A form whose values round-trip
// through a bus on every keystroke fights the typist. What crosses is the
// SEED — what the active workflow's seams currently hold — plus which knobs
// exist at all; the panel holds the edit and hands the whole set back with
// `comfy:generate`.

import { Drone } from '@hypercomb/core'
import { comfyFolder } from './comfy-folder.js'
import { comfyHost, type ComfyFileRef } from './comfy-host.js'
import { comfyService, type ComfyJob } from './comfy.service.js'
import { offeredKnobs, readParams, type ComfyParams } from './comfy-workflow.js'
import {
  activeWorkflow,
  comfyWorkflows,
  importComfyWorkflow,
  setActiveWorkflow,
} from './comfy-workflows.js'

/** One picture the panel can show without anything being copied: an object
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

/**
 * Mirrors ComfyPanelPayload in `hypercomb-shared/ui/comfy-panel` — shared
 * cannot import essentials, so the shape is kept field-for-field by hand
 * (the same arrangement hosts.drone has with the hosts panel).
 */
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
  results: ComfyPicture[]
  target: string
  importError: string
}

export class ComfyDrone extends Drone {

  readonly namespace = 'diamondcoreprocessor.com'

  protected override listens: string[] = [
    'comfy:open', 'comfy:close', 'comfy:reopen', 'comfy:set-endpoint', 'comfy:discover',
    'comfy:link-folder', 'comfy:browse', 'comfy:set-workflow',
    'comfy:import-workflow', 'comfy:generate', 'comfy:cancel',
    'comfy:keep', 'comfy:attach', 'comfy:job', 'comfy:host-changed',
    'comfy:folder-changed', 'comfy:workflows-changed', 'selection:changed',
  ]
  protected override emits: string[] = ['comfy:render', 'activity:log']

  #open = false
  #reveal = ''
  #browsing = false
  #importError = ''
  #folderPictures: ComfyPicture[] = []

  constructor() {
    super()

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
      void comfyHost.probe().then(() => this.#emit())
      this.#emit()
    })

    this.onEffect('comfy:discover', () => {
      void comfyHost.discover().then(found => {
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
      if (setActiveWorkflow(String(p?.id ?? ''))) this.#emit()
    })

    this.onEffect<{ json?: string }>('comfy:import-workflow', (p) => {
      void importComfyWorkflow(String(p?.json ?? ''), { label: 'pasted workflow' })
        .then(spec => {
          setActiveWorkflow(spec.id)
          this.#importError = ''
          this.emitEffect('activity:log', { message: `workflow "${spec.label}" added`, icon: '◈' })
          this.#emit()
        })
        .catch((err: Error) => {
          this.#importError = err?.message ?? 'that workflow could not be read'
          this.#emit()
        })
    })

    // THE WINDOW DOES NOT ATTACH ON ITS OWN. You are here to choose, and a
    // batch that landed itself on a tile would have chosen for you. The
    // command line does attach, because you typed the prompt at a tile.
    this.onEffect<ComfyParams>('comfy:generate', (p) => {
      void comfyService.run({ ...(p ?? {}), attach: false }).then(() => this.#emit())
    })

    this.onEffect('comfy:cancel', () => { void comfyService.cancel() })

    this.onEffect<{ index?: number }>('comfy:keep', (p) => {
      const picture = this.#folderPictures[Number(p?.index ?? -1)]
      if (!picture) return
      void comfyService.keep(this.#refOf(picture)).then(() => this.#emit())
    })

    this.onEffect<{ index?: number }>('comfy:attach', (p) => {
      const result = comfyService.results[Number(p?.index ?? -1)]
      if (result) comfyService.attach(result)
      this.#emit()
    })

    // The four live sources this window is a pure read of. Re-emit on each
    // rather than polling any of them.
    for (const effect of ['comfy:job', 'comfy:host-changed', 'comfy:folder-changed', 'comfy:workflows-changed']) {
      this.onEffect(effect, () => { if (this.#open) this.#emit() })
    }
    // "onto <tile>" has to be true while you look at it.
    this.onEffect('selection:changed', () => { if (this.#open) this.#emit() })
  }

  /** Ask the machine and re-open the folder on the way in — a status dot that
   *  starts grey and turns green on its own answers the only question this
   *  window opens with. */
  async #warm(): Promise<void> {
    void comfyHost.probe().then(() => this.#emit())
    const granted = await comfyFolder.restore().catch(() => false)
    if (granted) this.#emit()
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
      results: comfyService.results.map(result => ({
        url: result.previewUrl,
        filename: result.file.filename,
        subfolder: result.file.subfolder,
        type: result.file.type,
        size: 0,
        seed: result.seed,
      })),
      target: comfyService.targetCell() ?? '',
      importError: this.#importError,
    }
    this.emitEffect('comfy:render', payload)
  }
}

const _comfy = new ComfyDrone()
;(window as { ioc?: { register?: (k: string, v: unknown) => void } }).ioc?.register?.(
  '@diamondcoreprocessor.com/ComfyDrone',
  _comfy,
)
