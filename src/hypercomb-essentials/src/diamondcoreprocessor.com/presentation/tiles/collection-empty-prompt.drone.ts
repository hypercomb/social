// diamondcoreprocessor.com/presentation/tiles/collection-empty-prompt.drone.ts
//
// Empty-state prompt for a collection's own root page. The /sets landing lets
// participants create and open collections; once they enter a brand-new
// collection, the hex surface is legitimately empty. This prompt gives that
// empty page a first action without changing the renderer or collection model.

import { EffectBus, I18N_IOC_KEY } from '@hypercomb/core'
import { childNamesOf } from '../../history/layer-placement.js'

const SETS = 'sets'

type CellCountPayload = { count: number; settled?: boolean }
type LineageLike = EventTarget & { explorerSegments?: () => readonly string[] }
type I18nLike = { t(key: string, params?: Record<string, string | number>): string }
type HistoryLike = {
  sign(l: { explorerSegments?: () => readonly string[] }): Promise<string>
  currentLayerAt(sig: string): Promise<Record<string, unknown> | null>
  getLayerBySig(sig: string): Promise<Record<string, unknown> | null>
  commitLayer(locationSig: string, layer: Record<string, unknown>): Promise<string>
}

const ioc = (): { get<T = unknown>(key: string): T | undefined } | undefined =>
  (globalThis as { ioc?: { get<T = unknown>(key: string): T | undefined } }).ioc

class CollectionEmptyPromptDrone {
  #host: HTMLDivElement | null = null
  #lineage: LineageLike | null = null
  #lineageBound = false
  #lastSettledEmpty = false
  #checkSeq = 0

  constructor() {
    EffectBus.on<CellCountPayload>('render:cell-count', payload => {
      this.#lastSettledEmpty = payload.count === 0 && payload.settled === true
      void this.#reconcile()
    })
    EffectBus.on('cell:added', () => {
      this.#hide()
      this.#lastSettledEmpty = false
    })
    EffectBus.on('cell:removed', () => { void this.#reconcile() })
    window.addEventListener('synchronize', () => { void this.#reconcile() })
    this.#ensureLineage()
    void this.#reconcile()
  }

  #ensureLineage(): void {
    if (this.#lineageBound) return
    const lineage = ioc()?.get<LineageLike>('@hypercomb.social/Lineage')
    if (!lineage?.addEventListener) return
    this.#lineage = lineage
    lineage.addEventListener('change', () => {
      this.#lastSettledEmpty = false
      this.#hide()
      void this.#reconcile()
    })
    this.#lineageBound = true
  }

  #segments(): string[] {
    this.#ensureLineage()
    return (this.#lineage?.explorerSegments?.() ?? [])
      .map(s => String(s ?? '').trim())
      .filter(Boolean)
  }

  #t(key: string, fallback: string, params?: Record<string, string | number>): string {
    const i18n = ioc()?.get<I18nLike>(I18N_IOC_KEY)
    const value = i18n?.t?.(key, params)
    return value && value !== key ? value : fallback
  }

  async #reconcile(): Promise<void> {
    const seq = ++this.#checkSeq
    const segments = this.#segments()
    if (!this.#lastSettledEmpty || segments.length !== 1 || segments[0] === SETS) {
      this.#hide()
      return
    }

    const name = segments[0]
    const isCollection = await this.#isCollectionRoot(name)
    if (seq !== this.#checkSeq) return
    if (!isCollection) {
      this.#hide()
      return
    }
    this.#show(name)
  }

  async #isCollectionRoot(name: string): Promise<boolean> {
    const history = ioc()?.get<HistoryLike>('@diamondcoreprocessor.com/HistoryService')
    if (!history?.sign || !history.currentLayerAt) return false
    try {
      const setsSig = await history.sign({ explorerSegments: () => [SETS] })
      const setsLayer = await history.currentLayerAt(setsSig)
      const names = await childNamesOf(history, setsLayer as Parameters<typeof childNamesOf>[1])
      return names.includes(name)
    } catch {
      return false
    }
  }

  #show(collectionName: string): void {
    if (this.#host) {
      const title = this.#host.querySelector('[data-role="title"]')
      if (title) title.textContent = this.#t(
        'collections.empty.title',
        'Add your first tile'
      )
      return
    }

    const host = document.createElement('div')
    host.id = 'hc-collection-empty-prompt'
    host.style.cssText =
      'position:fixed;inset:0;z-index:1200;display:flex;align-items:center;justify-content:center;' +
      'pointer-events:none;padding:24px;box-sizing:border-box;font-family:inherit;'

    const panel = document.createElement('div')
    panel.style.cssText =
      'pointer-events:auto;max-width:360px;text-align:center;border-radius:10px;padding:24px 26px 26px;' +
      'background:rgba(12,17,24,0.78);border:1px solid rgba(126,182,214,0.24);' +
      'box-shadow:0 18px 44px rgba(0,0,0,0.28);backdrop-filter:blur(10px);cursor:pointer;'

    const title = document.createElement('div')
    title.dataset['role'] = 'title'
    title.style.cssText = 'font-size:20px;font-weight:700;color:#d8e6ee;margin-bottom:8px;'
    title.textContent = this.#t('collections.empty.title', 'Add your first tile')

    const body = document.createElement('div')
    body.style.cssText = 'font-size:14px;line-height:1.55;color:rgba(216,230,238,0.66);margin-bottom:18px;'
    body.textContent = this.#t(
      'collections.empty.body',
      'Start this collection by naming a tile, dropping a file, or pasting something here.',
      { collection: collectionName },
    )

    const button = document.createElement('button')
    button.type = 'button'
    button.style.cssText =
      'border:0;border-radius:7px;padding:10px 16px;font:inherit;font-size:14px;font-weight:700;' +
      'color:#0c1118;background:rgb(126,182,214);cursor:pointer;'
    button.textContent = this.#t('collections.empty.action', 'Add a tile')
    button.addEventListener('click', event => this.#focusCommandLine(event))
    panel.addEventListener('click', event => this.#focusCommandLine(event))

    panel.appendChild(title)
    panel.appendChild(body)
    panel.appendChild(button)
    host.appendChild(panel)
    document.body.appendChild(host)
    this.#host = host
  }

  #hide(): void {
    this.#host?.remove()
    this.#host = null
  }

  #focusCommandLine(event?: Event): void {
    event?.preventDefault()
    event?.stopPropagation()
    if (event?.target instanceof HTMLElement) event.target.blur()

    const mobile = window.matchMedia('(max-width: 599px), (max-height: 599px)').matches
    EffectBus.emit('mobile:input-visible', { visible: true, mobile })
    EffectBus.emit('command:focus', { cell: '' })

    const focusInput = (): void => {
      const input = document.querySelector<HTMLInputElement>('hc-command-shell input.command-input')
      input?.focus({ preventScroll: true })
    }
    queueMicrotask(focusInput)
    requestAnimationFrame(focusInput)
    setTimeout(focusInput, 60)
  }
}

const _collectionEmptyPrompt = new CollectionEmptyPromptDrone()
window.ioc.register('@diamondcoreprocessor.com/CollectionEmptyPromptDrone', _collectionEmptyPrompt)
