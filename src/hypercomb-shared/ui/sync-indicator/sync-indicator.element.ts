// Framework-free progress cell for installer synchronization and adoption.
import { EffectBus, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'

interface InstallSyncPayload {
  active?: boolean
  source?: string
  phase?: string
  current?: number
  total?: number
}

interface AdoptStatsPayload {
  sig?: string
  root?: string
  layers?: number
  leaves?: number
  failed?: number
}

const ELEMENT_NAME = 'hc-sync-indicator'
const STALE_GUARD_MS = 90_000
const DONE_FLASH_MS = 3_500

const FALLBACKS: Record<string, string> = {
  'sync.synchronizing': 'synchronizing…',
  'sync.adopting': 'adopting…',
  'sync.adopting-progress': 'adopting… {items} fetched',
  'sync.adopted': 'adopted',
  'sync.done': 'synchronized',
  'sync.progress.left': '{current} of {total} files · {left} left',
  'sync.done.files.one': 'synchronized · 1 file',
  'sync.done.files.other': 'synchronized · {count} files',
  'sync.adopted.files.one': 'adopted · 1 file',
  'sync.adopted.files.other': 'adopted · {count} files',
}

const CSS = `
${ELEMENT_NAME}{display:contents}
${ELEMENT_NAME} .sync-cell{display:flex;flex-direction:column;align-items:stretch;justify-content:center;gap:.3rem;flex-shrink:0;min-width:10rem;max-width:16rem;min-height:2.15rem;box-sizing:border-box;padding:.38rem .7rem;border:1px solid rgba(126,182,214,.25);border-radius:var(--hc-radius-floating);background:rgba(9,14,20,.94);box-shadow:0 8px 28px rgba(0,0,0,.42);backdrop-filter:blur(12px);pointer-events:auto;font-family:var(--hc-font);animation:hc-sync-fade-in 360ms ease-out}
${ELEMENT_NAME} .sync-line{display:flex;align-items:center;gap:.4rem;min-width:0}
${ELEMENT_NAME} .sync-label{font-size:.68rem;letter-spacing:.02em;line-height:1.2;color:rgba(245,245,245,.75);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
${ELEMENT_NAME} .sync-cell.done{border-color:rgba(110,201,110,.28)}
${ELEMENT_NAME} .sync-cell.done .sync-label{color:rgba(220,245,225,.76)}
${ELEMENT_NAME} .sync-track{position:relative;height:3px;border-radius:999px;background:rgba(245,245,245,.12);overflow:hidden}
${ELEMENT_NAME} .sync-fill{height:100%;border-radius:999px;background:#e0a93e;transition:width 200ms ease-out}
${ELEMENT_NAME} .sync-track.indeterminate .sync-fill{position:absolute;width:35%;animation:hc-sync-sweep 1.4s ease-in-out infinite}
@keyframes hc-sync-fade-in{from{opacity:0}to{opacity:1}}
@keyframes hc-sync-sweep{0%{left:-35%}100%{left:100%}}
`

let cssInstalled = false
const installCss = (): void => {
  if (cssInstalled || typeof document === 'undefined') return
  cssInstalled = true
  const style = document.createElement('style')
  style.setAttribute('data-hc-sync-indicator', '')
  style.textContent = CSS
  document.head.appendChild(style)
}

type I18nTarget = I18nProvider & EventTarget

export class SyncIndicatorElement extends HTMLElement {
  #connected = false
  #offs: Array<() => void> = []
  #doneTimer: ReturnType<typeof setTimeout> | null = null
  #staleTimer: ReturnType<typeof setTimeout> | null = null
  #syncLanes = new Map<string, { current: number; total: number }>()
  #adoptActive = false
  #adoptItems = 0
  #done = false
  #doneKind: 'sync' | 'adopt' = 'sync'
  #peakCount = 0
  #doneCount = 0
  #i18n: I18nTarget | null = null

  connectedCallback(): void {
    if (this.#connected) return
    this.#connected = true
    installCss()
    this.#connectI18n()
    this.#offs.push(
      EffectBus.on<InstallSyncPayload>('install:sync', payload => this.#onSync(payload)),
      EffectBus.on<{ rootSig?: string }>('adopt:meta', () => {
        this.#begin()
        this.#adoptActive = true
        this.#adoptItems = 0
        this.#render()
      }),
      EffectBus.on<AdoptStatsPayload>('adopt:progress', payload => {
        this.#begin()
        this.#adoptActive = true
        this.#adoptItems = (payload?.layers ?? 0) + (payload?.leaves ?? 0)
        this.#peakCount = Math.max(this.#peakCount, this.#current() + this.#adoptItems)
        this.#render()
      }),
      EffectBus.on<AdoptStatsPayload>('adopt:done', () => {
        if (!this.#adoptActive) return
        this.#adoptActive = false
        this.#adoptItems = 0
        this.#maybeFinish('adopt')
      }),
      EffectBus.on('locale:changed', () => this.#render()),
    )
    this.#render()
  }

  disconnectedCallback(): void {
    if (!this.#connected) return
    this.#connected = false
    for (const off of this.#offs) off()
    this.#offs.length = 0
    this.#clearTimer('done')
    this.#clearTimer('stale')
    this.#i18n?.removeEventListener('change', this.#onI18nChange)
    this.#i18n = null
  }

  #connectI18n(): void {
    const connect = (provider: I18nProvider): void => {
      if (!this.#connected || this.#i18n === provider) return
      this.#i18n?.removeEventListener('change', this.#onI18nChange)
      this.#i18n = provider as I18nTarget
      this.#i18n.addEventListener?.('change', this.#onI18nChange)
      this.#render()
    }
    const current = window.ioc?.get?.<I18nProvider>(I18N_IOC_KEY)
    if (current) connect(current)
    else window.ioc?.whenReady?.<I18nProvider>(I18N_IOC_KEY, connect)
  }

  readonly #onI18nChange = (): void => this.#render()

  #t(key: string, params: Record<string, string | number> = {}): string {
    const translated = this.#i18n?.t(key, params)
    if (translated && translated !== key) return translated
    let template = FALLBACKS[key]
    if (typeof params['count'] === 'number') {
      template = FALLBACKS[`${key}.${params['count'] === 1 ? 'one' : 'other'}`] ?? template
    }
    return (template ?? key).replace(/\{(\w+)\}/g, (whole, token: string) =>
      params[token] !== undefined ? String(params[token]) : whole,
    )
  }

  #onSync(payload: InstallSyncPayload): void {
    const lane = String(payload?.source ?? 'sync')
    if (payload?.active === true) {
      this.#begin()
      const prior = this.#syncLanes.get(lane)
      this.#syncLanes.set(lane, {
        current: payload.current ?? prior?.current ?? 0,
        total: payload.total ?? prior?.total ?? 0,
      })
      this.#peakCount = Math.max(this.#peakCount, this.#current() + this.#adoptItems)
      this.#render()
      return
    }
    if (!this.#syncLanes.has(lane)) return
    this.#syncLanes.delete(lane)
    this.#maybeFinish('sync')
  }

  #begin(): void {
    this.#clearTimer('done')
    this.#done = false
    this.#armStaleGuard()
  }

  #maybeFinish(kind: 'sync' | 'adopt'): void {
    if (this.#syncLanes.size > 0 || this.#adoptActive) {
      this.#render()
      return
    }
    this.#clearTimer('stale')
    this.#doneKind = kind
    this.#doneCount = this.#peakCount
    this.#peakCount = 0
    this.#done = true
    this.#clearTimer('done')
    this.#doneTimer = setTimeout(() => {
      this.#done = false
      this.#doneTimer = null
      this.#render()
    }, DONE_FLASH_MS)
    this.#render()
  }

  #armStaleGuard(): void {
    this.#clearTimer('stale')
    this.#staleTimer = setTimeout(() => {
      this.#staleTimer = null
      this.#syncLanes.clear()
      this.#adoptActive = false
      this.#adoptItems = 0
      this.#peakCount = 0
      this.#done = false
      this.#render()
    }, STALE_GUARD_MS)
  }

  #clearTimer(which: 'done' | 'stale'): void {
    if (which === 'done' && this.#doneTimer !== null) {
      clearTimeout(this.#doneTimer)
      this.#doneTimer = null
    }
    if (which === 'stale' && this.#staleTimer !== null) {
      clearTimeout(this.#staleTimer)
      this.#staleTimer = null
    }
  }

  #current(): number {
    let count = 0
    for (const lane of this.#syncLanes.values()) if (lane.total > 0) count += lane.current
    return count
  }

  #total(): number {
    let count = 0
    for (const lane of this.#syncLanes.values()) count += lane.total
    return count
  }

  #label(): string {
    if (this.#done) {
      if (this.#doneCount > 0) {
        return this.#t(this.#doneKind === 'adopt' ? 'sync.adopted.files' : 'sync.done.files', { count: this.#doneCount })
      }
      return this.#t(this.#doneKind === 'adopt' ? 'sync.adopted' : 'sync.done')
    }
    if (this.#adoptActive) {
      return this.#adoptItems > 0
        ? this.#t('sync.adopting-progress', { items: this.#adoptItems })
        : this.#t('sync.adopting')
    }
    const total = this.#total()
    if (total > 0) {
      const current = this.#current()
      return this.#t('sync.progress.left', { current, total, left: Math.max(0, total - current) })
    }
    return this.#t('sync.synchronizing')
  }

  #render(): void {
    if (!this.#connected) return
    const visible = this.#syncLanes.size > 0 || this.#adoptActive || this.#done
    if (!visible) {
      this.replaceChildren()
      return
    }
    const total = this.#total()
    const hasCounts = total > 0
    const percent = hasCounts ? Math.min(100, Math.round((this.#current() / total) * 100)) : 0

    const cell = document.createElement('div')
    cell.className = 'sync-cell'
    cell.classList.toggle('done', this.#done)
    cell.setAttribute('role', 'status')
    cell.setAttribute('aria-live', 'polite')

    const line = document.createElement('div')
    line.className = 'sync-line'
    const label = document.createElement('span')
    label.className = 'sync-label'
    label.textContent = this.#label()
    line.appendChild(label)

    const track = document.createElement('div')
    track.className = 'sync-track'
    track.classList.toggle('indeterminate', !this.#done && !hasCounts)
    const fill = document.createElement('div')
    fill.className = 'sync-fill'
    if (this.#done) fill.style.width = '100%'
    else if (hasCounts) fill.style.width = `${percent}%`
    track.appendChild(fill)

    cell.append(line, track)
    this.replaceChildren(cell)
  }
}

if (typeof customElements !== 'undefined' && !customElements.get(ELEMENT_NAME)) {
  customElements.define(ELEMENT_NAME, SyncIndicatorElement)
}
