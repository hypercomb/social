import { type Bee, EffectBus, hypercomb } from '@hypercomb/core'
import { CoreAdapter } from './core-adapter'
import '@hypercomb/shared/ui/shell-surfaces/shell-surfaces.element'
import '@hypercomb/shared/ui/mesh-header/mesh-header.element'
import '@hypercomb/shared/ui/sync-indicator/sync-indicator.element'
import '@hypercomb/shared/ui/upgrade-indicator/upgrade-indicator.element'
import '@hypercomb/shared/ui/edit-actions/edit-actions.element'
import '@hypercomb/shared/ui/controls-bar/controls-bar.element'
import '@hypercomb/shared/ui/command-line/command-line.element'

const APP_TEMPLATE = `
  <div class="header-bar">
    <app-header><hc-command-line></hc-command-line></app-header>
    <hc-mesh-header></hc-mesh-header>
  </div>
  <hc-controls-bar></hc-controls-bar>
  <div class="update-status-dock">
    <hc-upgrade-indicator></hc-upgrade-indicator>
    <hc-sync-indicator></hc-sync-indicator>
  </div>
  <hc-edit-actions></hc-edit-actions>
  <hc-shell-surfaces></hc-shell-surfaces>
`

type ViewModeService = EventTarget & {
  mode: string
  isTransient?: (mode: string) => boolean
}

/**
 * Framework-free application host.
 *
 * Every child is already an element-shaped surface. This host owns only the
 * small amount of shell coordination Angular previously supplied: stable DOM,
 * event-to-class projection, runtime startup, and the initial bee pulse.
 */
export class App extends HTMLElement {
  private readonly core = new CoreAdapter()
  private readonly cleanups: Array<() => void> = []
  private wired = false
  private startPromise: Promise<void> | null = null
  private viewMode = 'hexagons'
  private inputOpen = false
  private viewActive = false
  private moveMode = false
  private swarmEmpty = false

  connectedCallback(): void {
    if (this.wired) this.refresh()
  }

  /** Materialize children only after main.ts has finished runtime setup. */
  public mount(): void {
    if (!this.wired) {
      this.innerHTML = APP_TEMPLATE
      this.wireShellState()
      this.wired = true
    }
    this.refresh()
  }

  /** Begin runtime work after the signed acquisition and dependency gates. */
  public start(): Promise<void> {
    this.startPromise ??= (async () => {
      await this.core.initialize()
      this.mount()
      await this.startRegisteredBees()
    })()
    return this.startPromise
  }

  /** Re-project current state after a live package resync. */
  public refresh(): void {
    this.classList.toggle('move-mode', this.moveMode)
    this.classList.toggle('swarm-empty', this.swarmEmpty)
    this.classList.toggle('view-website', this.viewMode === 'website')

    const header = this.querySelector<HTMLElement>('.header-bar')
    header?.classList.toggle('input-open', this.inputOpen)
    if (header) header.style.visibility = this.viewActive || this.viewMode === 'website' ? 'hidden' : ''

    for (const name of [...document.body.classList]) {
      if (name.startsWith('hc-view-')) document.body.classList.remove(name)
    }
    document.body.classList.add(`hc-view-${this.viewMode}`)
    const mode = window.ioc?.get?.<ViewModeService>('@hypercomb.social/ViewMode')
    if (mode?.isTransient?.(this.viewMode)) document.body.classList.add('hc-view-covered')
  }

  private wireShellState(): void {
    const suppressResizeObserverNoise = (event: ErrorEvent): void => {
      if (event.message?.includes('ResizeObserver loop')) event.stopImmediatePropagation()
    }
    window.addEventListener('error', suppressResizeObserverNoise)
    this.cleanups.push(() => window.removeEventListener('error', suppressResizeObserverNoise))

    this.cleanups.push(EffectBus.on<{ active: boolean }>('view:active', ({ active }) => {
      this.viewActive = active
      this.refresh()
    }))
    this.cleanups.push(EffectBus.on<{ active: boolean }>('move:mode', ({ active }) => {
      this.moveMode = active
      this.refresh()
    }))
    this.cleanups.push(EffectBus.on<{ active: boolean }>('swarm:empty-layer', ({ active }) => {
      this.swarmEmpty = active
      this.refresh()
    }))
    this.cleanups.push(EffectBus.on<{ visible: boolean; mobile: boolean }>(
      'mobile:input-visible',
      ({ visible, mobile }) => {
        this.inputOpen = mobile && visible
        this.refresh()
      },
    ))
    this.cleanups.push(EffectBus.on<{ silent?: boolean }>('adopt:done', payload => {
      if (payload?.silent) return
      this.viewMode = 'hexagons'
      this.refresh()
      EffectBus.emit('nav:to-hive', { reason: 'adopt-complete' })
    }))

    const wireViewMode = (service: ViewModeService): void => {
      const changed = (): void => {
        this.viewMode = service.mode
        this.refresh()
      }
      changed()
      service.addEventListener('change', changed)
      this.cleanups.push(() => service.removeEventListener('change', changed))
    }
    const mode = window.ioc?.get?.<ViewModeService>('@hypercomb.social/ViewMode')
    if (mode) wireViewMode(mode)
    else window.ioc?.whenReady?.<ViewModeService>('@hypercomb.social/ViewMode', wireViewMode)

    console.log('[app] framework-free host initialized')
  }

  private readonly pulseBee = (bee: Bee): void => {
    void bee.pulse('').catch(error =>
      console.warn('[app] failed to start bee', bee.constructor?.name, error),
    )
  }

  private async startRegisteredBees(): Promise<void> {
    window.ioc.onRegister((_key, value) => {
      if (value && typeof (value as Bee).pulse === 'function') this.pulseBee(value as Bee)
    })

    const values = list()
      .map(key => get(key))
      .filter((value): value is Bee => !!value && typeof (value as Bee).pulse === 'function')

    await Promise.allSettled(values.map(bee =>
      bee.pulse('').catch(error =>
        console.warn('[app] failed to start bee', bee.constructor?.name, error),
      ),
    ))

    await new hypercomb().act('')
    EffectBus.emit('mesh:public-changed', { public: this.core.meshPublic() })
  }
}

if (!customElements.get('app-root')) customElements.define('app-root', App)
