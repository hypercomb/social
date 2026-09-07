// document/document-view.drone.ts
//
// Full-viewport DOCUMENT takeover — the long-form analogue of SiteViewDrone
// and TutorViewDrone. When ViewMode is 'document', the current cell's body
// (its first-class `document` slot) is opened in an editor over the
// viewport. The visible back control, Escape, or the shared BackGesture
// returns to the hive.
//
// ── Why a plain markdown surface ──────────────────────────────────────
//
// The canonical body IS markdown, so the participant edits the actual
// stored text. A rich-text surface here would be a lie: it would imply
// fidelity the round trip does not have (comments, suggestions and
// footnotes live on the remote and cannot come back through a push), and
// every keystroke would have to be translated twice. Editing the source
// keeps what you see and what is stored the same object.
//
// ── Saving ────────────────────────────────────────────────────────────
//
// Typing pauses -> the body is committed as ordinary hive content: new
// bytes, new signature, new layer, and therefore a history entry. Undo and
// version history are the plain lineage behaviours; nothing here is
// document-specific. Pushing that body onward to a remote (Google) is a
// SEPARATE concern handled by the sync worker, so this view keeps working
// with the network down and never blocks a keystroke on a request.

import { Drone } from '@hypercomb/core'
import type { BackGesture } from '../navigation/back-gesture.service.js'
import { DOCUMENT_SLOT } from './document-slot.js'
import { SAVE_DEBOUNCE_MS, newestBodySig, shouldCommitBody } from './document-edit.js'

const DOCUMENT_VIEW = 'document'
const DOCUMENT_VIEW_OWNER = 'document-view'

/**
 * This behaviour's feature identity — what the Beehaviors panel switches off
 * and what the hidden/dormant gates key on.
 *
 * NOT a source mark. A sync adapter's mark would record where a body came
 * FROM; this one names the view that opens any body. Conflating them would
 * switch off every document when someone disconnected a remote source, and
 * would leave a document the participant typed themselves with no behaviour
 * identity at all. (The unwired Google Docs adapter was removed 2026-09-01;
 * the slot stays source-agnostic so any adapter can plug in later.)
 */
export const DOCUMENT_KIND = 'visual:document:body'

type ViewModeShape = EventTarget & { mode: string; setMode(next: string): void }

type MountState = {
  host: HTMLDivElement
  editor: HTMLTextAreaElement
  /** The body sig this mount opened, so an unchanged reconcile skips remount. */
  bodySig: string | null
  /** Segments the body belongs to — a save must never land on another cell. */
  segments: string[]
  /** Last text committed, so an unchanged save spends no undo step. */
  lastCommitted: string | null
  timer: number | null
}

export class DocumentViewDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'presentation'
  override description =
    'Full-viewport document takeover. When ViewMode is "document", opens the current cell\'s body in an editor that saves into the hive.'

  #mount: MountState | null = null
  #viewActive = false
  #registered = false
  #lineageBound = false
  #viewModeBound = false
  #escapeBound = false
  /** Unregisters this view's shared right-click / hardware-BACK peel. */
  #backOff: (() => void) | null = null
  #reconciling = false

  protected override deps = {
    lineage: '@hypercomb.social/Lineage',
    store: '@hypercomb.social/Store',
  }
  protected override listens: string[] = []
  protected override emits = ['view:active']

  protected override heartbeat = async (): Promise<void> => {
    if (!this.#registered) {
      window.ioc.register('@diamondcoreprocessor.com/DocumentViewDrone', this)
      this.#registered = true
    }
    if (!this.#lineageBound) {
      const lineage = this.resolve<EventTarget & { addEventListener?: typeof EventTarget.prototype.addEventListener }>('lineage')
      if (lineage?.addEventListener) {
        lineage.addEventListener('change', this.#onLineageChange)
        this.#lineageBound = true
      }
    }
    if (!this.#viewModeBound) {
      const vm = this.#vm()
      if (vm?.addEventListener) {
        vm.addEventListener('change', this.#onViewModeChange)
        this.#viewModeBound = true
      }
    }
    if (!this.#escapeBound) {
      // ESCAPE IS A PEEL, AND IT IS EVERYWHERE. This used to hang off the
      // EDITOR, so it only answered while the caret was in the text — press
      // Escape with focus anywhere else and the view held. That was survivable
      // only while this mode was (wrongly) left out of the shell's takeover
      // list and the hexagons still showed through it; now that the canvas is
      // properly suppressed underneath, an Escape that does not answer is a
      // participant with no way back.
      //
      // CAPTURE + stopImmediatePropagation, the same shape every other view
      // uses (tree-view.drone.ts:212): the shell runs an escape CASCADE of its
      // own, and it preventDefaults. A bubble-phase listener that politely
      // stands aside for an already-handled Escape therefore never answers at
      // all — which is exactly how the first attempt at this failed. While a
      // view owns the surface, its Escape is the first claim on the key.
      window.addEventListener('keydown', this.#onKeyDown, true)
      this.#escapeBound = true
    }
    if (!this.#backOff) {
      // One registration feeds both shared ways back: BackGesture owns the
      // right button, and navigation/view-back routes browser / hardware BACK
      // through the same registry. It also preserves the arrival-face rule
      // (navigate back rather than merely peeling the renderer). Do not push
      // a document-specific history entry here: view-back owns the single
      // trap for the whole view stack.
      this.#backOff = window.ioc?.get<BackGesture>('@diamondcoreprocessor.com/BackGesture')
        ?.register({ owner: DOCUMENT_VIEW_OWNER, back: () => { void this.#exit() } }) ?? null
    }
    void this.#reconcile()
  }

  protected override dispose(): void {
    const lineage = this.resolve<EventTarget & { removeEventListener?: typeof EventTarget.prototype.removeEventListener }>('lineage')
    if (this.#lineageBound && lineage?.removeEventListener) lineage.removeEventListener('change', this.#onLineageChange)
    const vm = this.#vm()
    if (this.#viewModeBound && vm?.removeEventListener) vm.removeEventListener('change', this.#onViewModeChange)
    if (this.#escapeBound) { window.removeEventListener('keydown', this.#onKeyDown, true); this.#escapeBound = false }
    this.#backOff?.()
    this.#backOff = null
    this.#teardown()
  }

  // ── reactivity ─────────────────────────────────────────────

  readonly #onLineageChange = (): void => { void this.#reconcile() }
  readonly #onViewModeChange = (): void => { void this.#reconcile() }

  #vm(): ViewModeShape | undefined {
    return (window as { ioc?: { get: <T>(k: string) => T | undefined } }).ioc?.get<ViewModeShape>('@hypercomb.social/ViewMode')
  }

  // ── reconcile / mount ──────────────────────────────────────

  async #reconcile(): Promise<void> {
    if (this.#reconciling) return
    this.#reconciling = true
    try {
      const lineage = this.resolve<{ explorerSegments?: () => readonly string[] }>('lineage')
      const store = this.resolve<{ getResource?: (sig: string) => Promise<Blob | null> }>('store')
      if (!lineage || !store?.getResource) return

      const vm = this.#vm()
      if (vm && vm.mode !== DOCUMENT_VIEW) { await this.#teardownSaving(); return }

      const segments: string[] = [...(lineage.explorerSegments?.() ?? [])]
      if (segments.length === 0) { await this.#teardownSaving(); return }

      const layer = await this.#layerAt(segments)
      const bodySig = newestBodySig(layer)

      // A cell with no body yet still opens — an empty document is how a new
      // one starts, and refusing to mount would make the toggle dead on
      // exactly the cells a participant wants to write into.
      const text = bodySig ? (await store.getResource(bodySig).then(b => b?.text() ?? '').catch(() => '')) : ''
      this.#mountEditor(segments, bodySig, text)
    } finally {
      this.#reconciling = false
    }
  }

  async #layerAt(segments: readonly string[]): Promise<Record<string, unknown> | null> {
    const history = (window as { ioc?: { get: <T>(k: string) => T | undefined } }).ioc?.get<{
      sign: (l: { explorerSegments?: () => readonly string[] }) => Promise<string>
      currentLayerAt: (sig: string) => Promise<Record<string, unknown> | null>
    }>('@diamondcoreprocessor.com/HistoryService')
    if (!history) return null
    try {
      return await history.currentLayerAt(await history.sign({ explorerSegments: () => segments }))
    } catch {
      return null // cold read — retried on the next reconcile
    }
  }

  #mountEditor(segments: string[], bodySig: string | null, text: string): void {
    const key = segments.join('/')
    // Already showing this exact body for this exact cell — remounting would
    // throw away the caret and any keystrokes since the last save.
    if (this.#mount && this.#mount.bodySig === bodySig && this.#mount.segments.join('/') === key) return

    this.#teardown()

    const host = document.createElement('div')
    host.id = 'hc-document-view-host'
    // Inset by any docked panel's reservation so a panel can stay open beside
    // the document.
    host.style.cssText =
      'position:fixed;top:0;bottom:0;' +
      'left:var(--hc-inset-left,0px);right:var(--hc-inset-right,0px);' +
      'z-index:59988;overflow:hidden;background:#0d0c10;' +
      'display:flex;flex-direction:column;'
    // The editor owns its surface — without this the always-on hex wheel-zoom
    // handler preventDefaults wheel events and the document cannot scroll.
    host.setAttribute('data-consumes-wheel', '')

    const toolbar = document.createElement('div')
    toolbar.setAttribute('data-hc-document-toolbar', '')
    toolbar.style.cssText =
      'flex:0 0 auto;box-sizing:border-box;min-height:3.75rem;' +
      'padding:calc(8px + var(--hc-safe-top,env(safe-area-inset-top,0px))) ' +
      'calc(12px + env(safe-area-inset-right,0px)) 8px ' +
      'calc(12px + env(safe-area-inset-left,0px));' +
      'border-bottom:1px solid #211f2b;display:flex;align-items:center;gap:12px;'

    const back = document.createElement('button')
    back.type = 'button'
    back.setAttribute('data-hc-document-back', '')
    back.setAttribute('aria-label', 'Back to the hive')
    back.title = 'Back to the hive'
    back.textContent = '\u2190'
    back.style.cssText =
      'flex:0 0 2.75rem;width:2.75rem;height:2.75rem;padding:0;' +
      'display:flex;align-items:center;justify-content:center;border-radius:50%;' +
      'border:1px solid #343140;background-color:#1b1922;color:#e8e6f0;' +
      'font:600 1.4rem/1 system-ui,sans-serif;cursor:pointer;touch-action:manipulation;'
    back.addEventListener('click', this.#onBackClick)

    const hint = document.createElement('div')
    hint.style.cssText =
      'flex:1 1 auto;min-width:0;font:13px/1.5 system-ui,sans-serif;' +
      'color:#8a8798;display:flex;flex-wrap:wrap;gap:2px 16px;'
    hint.append(this.#hintText('Saves as you type'), this.#hintText('Back or Esc to close'))
    toolbar.append(back, hint)

    const editor = document.createElement('textarea')
    editor.className = 'hc-document-editor'
    editor.setAttribute('aria-label', 'Document body')
    editor.value = text
    editor.spellcheck = false
    editor.style.cssText =
      'flex:1 1 auto;width:100%;box-sizing:border-box;' +
      'padding:28px 18px calc(28px + var(--hc-safe-bottom,env(safe-area-inset-bottom,0px)));' +
      'border:0;outline:0;resize:none;background-color:transparent;color:#e8e6f0;' +
      'font:16px/1.7 ui-monospace,SFMono-Regular,Consolas,monospace;'
    editor.addEventListener('input', this.#onInput)

    host.append(toolbar, editor)
    document.body.appendChild(host)
    editor.focus()

    this.#mount = { host, editor, bodySig, segments, lastCommitted: text, timer: null }
    this.#setViewActive(true)
  }

  #hintText(label: string): HTMLSpanElement {
    const span = document.createElement('span')
    span.textContent = label
    return span
  }

  readonly #onKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return
    const vm = this.#vm()
    if (!vm || vm.mode !== DOCUMENT_VIEW) return
    e.preventDefault()
    e.stopImmediatePropagation()
    void this.#exit()
  }

  readonly #onBackClick = (): void => { void this.#backOut() }

  readonly #onInput = (): void => {
    const mount = this.#mount
    if (!mount) return
    if (mount.timer !== null) window.clearTimeout(mount.timer)
    mount.timer = window.setTimeout(() => { void this.#save() }, SAVE_DEBOUNCE_MS)
  }

  /** Commit the current text as the cell's body — new bytes, new sig, new
   *  layer, one history entry. No-ops when nothing changed. */
  async #save(): Promise<void> {
    const mount = this.#mount
    if (!mount) return
    mount.timer = null

    const text = mount.editor.value
    if (!shouldCommitBody(text, mount.lastCommitted)) return

    const store = this.resolve<{ putResource?: (blob: Blob) => Promise<string> }>('store')
    if (!store?.putResource) return

    const ioc = (window as { ioc?: { get: <T>(k: string) => T | undefined } }).ioc
    const committer = ioc?.get<{ update?: (segments: readonly string[], layer: object) => Promise<string> }>(
      '@diamondcoreprocessor.com/LayerCommitter',
    )
    if (!committer?.update) return

    try {
      const sig = await store.putResource(new Blob([text], { type: 'text/markdown' }))
      const layer = await this.#layerAt(mount.segments)
      const name = (layer?.['name'] as string | undefined) ?? mount.segments[mount.segments.length - 1] ?? ''
      // Replace the slot with the new current body. Previous bodies stay
      // reachable through history, which is where past versions belong.
      await committer.update(mount.segments, { name, [DOCUMENT_SLOT]: [sig] })
      mount.lastCommitted = text
      mount.bodySig = sig
    } catch {
      // Leave lastCommitted alone so the next pause retries this same text.
    }
  }

  /** The visible back plate obeys the same arrival-face rule as BACK and the
   *  right button. Save first because an arrival-face back navigates rather
   *  than calling the peel callback. */
  async #backOut(): Promise<void> {
    await this.#flushPendingSave()
    const vm = this.#vm()
    if (!vm || vm.mode !== DOCUMENT_VIEW) return
    const peel = (): void => {
      this.#teardown()
      vm.setMode('hexagons')
    }
    const gesture = window.ioc?.get<BackGesture>('@diamondcoreprocessor.com/BackGesture')
    if (gesture?.backOutOfView) gesture.backOutOfView(peel)
    else peel()
  }

  /** Flush a pending save before leaving, so closing never loses a keystroke. */
  async #exit(): Promise<void> {
    await this.#flushPendingSave()
    this.#teardown()
    this.#vm()?.setMode('hexagons')
  }

  async #teardownSaving(): Promise<void> {
    await this.#flushPendingSave()
    this.#teardown()
  }

  async #flushPendingSave(): Promise<void> {
    if (!this.#mount) return
    if (this.#mount.timer !== null) {
      window.clearTimeout(this.#mount.timer)
      this.#mount.timer = null
    }
    await this.#save()
  }

  #teardown(): void {
    if (this.#mount) {
      if (this.#mount.timer !== null) window.clearTimeout(this.#mount.timer)
      this.#mount.editor.removeEventListener('input', this.#onInput)
      this.#mount.host.remove()
      this.#mount = null
    }
    if (this.#viewActive) this.#setViewActive(false)
  }

  #setViewActive(active: boolean): void {
    if (this.#viewActive === active) return
    this.#viewActive = active
    // Owner-counted, not a raw boolean: a modal closing on top of this view
    // must not unhide the chrome while the document is still open.
    const modes = window.ioc.get('@diamondcoreprocessor.com/ModeRegistry') as
      { enter(mode: string, owner: string): void; exit(mode: string, owner: string): void } | undefined
    if (active) modes?.enter('view:active', DOCUMENT_VIEW_OWNER)
    else modes?.exit('view:active', DOCUMENT_VIEW_OWNER)
  }
}

const _documentView = new DocumentViewDrone()
window.ioc.register('@diamondcoreprocessor.com/DocumentViewDrone', _documentView)

// The toggle that makes this point-and-click: a cell carrying a document
// shows the view button, no command typed. Registered at module load beside
// the bee that owns it.
;(window as { ioc?: { get: <T>(k: string) => T | undefined } }).ioc
  ?.get<{ register: (d: Record<string, unknown>) => void }>('@diamondcoreprocessor.com/VisualBeeRegistry')
  ?.register({
    view: DOCUMENT_VIEW,
    slashCommand: '/document',
    iconName: 'description',
    // 'description' already belongs to living-brief — the registry enforces
    // one ligature per view, and a duplicate THROWS at module load.
    toggleIcon: 'edit_document',
    // `slot` is what makes the toggle appear: view.bee.ts lights a view when
    // its first-class slot holds a non-empty sig array. Gating on the
    // decoration alone would show the button only on imported tiles and never
    // on a document written here.
    slot: DOCUMENT_SLOT,
    decorationKind: DOCUMENT_KIND,
    labelKey: 'view.document',
    descriptionKey: 'view.document.description',
    adoptable: true,
    // Required by the registry — omitting it THROWS at module load and takes
    // the whole boot down for a cold profile.
    pheromones: ['platform:mobile', 'platform:desktop'],
  })
