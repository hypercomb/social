import { AfterViewInit, Component, CUSTOM_ELEMENTS_SCHEMA, effect, HostBinding, inject, signal } from '@angular/core'
import { type Bee, EffectBus, hypercomb } from '@hypercomb/core'
import { RouterOutlet } from '@angular/router'
import { Header } from './header/header'
import { CoreAdapter } from './core-adapter'
import '@hypercomb/shared/ui/shell-surfaces/shell-surfaces.element'
import '@hypercomb/shared/ui/mesh-header/mesh-header.element'
import '@hypercomb/shared/ui/sync-indicator/sync-indicator.element'
import '@hypercomb/shared/ui/upgrade-indicator/upgrade-indicator.element'
import '@hypercomb/shared/ui/edit-actions/edit-actions.element'
import '@hypercomb/shared/ui/controls-bar/controls-bar.element'

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, Header],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App implements AfterViewInit {

  protected readonly title = signal('hypercomb-web')

  // ViewMode bridge — when 'website', the Pixi canvas hides and the
  // website-view overlay activates. Mutually exclusive surfaces; new
  // modes plug in via additional Angular components or drones that
  // gate on the same signal.
  protected readonly viewMode = signal<string>('hexagons')
  protected readonly inputOpen = signal(false)
  public showHeader = true
  public readonly viewActive = signal(false)
  readonly moveMode = signal(false)
  // Empty-layer swarm watermark — set when show-cell reports the current
  // public/swarm location has zero tiles. Drives a faint full-bleed
  // "invite others" watermark, mirroring clipboard-mode.
  readonly swarmEmpty = signal(false)

  @HostBinding('class.move-mode')
  get moveModeClass() { return this.moveMode(); }

  @HostBinding('class.swarm-empty')
  get swarmEmptyClass() { return this.swarmEmpty(); }

  // View-mode CSS hook. When 'website', the header-bar (and its
  // command-line) docks to the bottom of the viewport, the website-view
  // takes the upper area, and you can type /view (or future aliases) to
  // toggle back without moving your cursor.
  @HostBinding('class.view-website')
  get viewWebsiteClass() { return this.viewMode() === 'website'; }
  private runtimeReady: Promise<void> = Promise.resolve()

  protected readonly core = inject(CoreAdapter)
  protected readonly meshPublic = this.core.meshPublic

  protected readonly toggleMesh = (): void => {
    this.core.toggleMesh()
  }

  constructor() {
    window.addEventListener('error', e => {
      if ((e as ErrorEvent).message?.includes('ResizeObserver loop')) {
        e.stopImmediatePropagation()
      }
    })

    this.runtimeReady = this.core.initialize()

    EffectBus.on<{ active: boolean }>('view:active', ({ active }) => {
      this.viewActive.set(active)
    })

    EffectBus.on<{ active: boolean }>('move:mode', ({ active }) => {
      this.moveMode.set(active)
    })

    EffectBus.on<{ active: boolean }>('swarm:empty-layer', ({ active }) => {
      this.swarmEmpty.set(active)
    })

    // Mobile command-line reveal: when the user long-presses an empty area
    // (or otherwise toggles via the controls bar), the header-bar must
    // un-hide so the command-line inside it is visible.
    EffectBus.on<{ visible: boolean; mobile: boolean }>('mobile:input-visible', ({ visible, mobile }) => {
      this.inputOpen.set(mobile && visible)
    })

    // ─── Return to the hive on adopt complete ──────────────────────────
    // Web/dev shell parity with hypercomb-dev: after broker.adopt walks
    // the peer's subtree → adopt:done fires, ensure the participant lands
    // on the tile-grid view at their current location so the adopted
    // content renders. Idempotent — already on 'hexagons' = no-op.
    // `silent` walks (pre-consent code inspection, features-panel downloads)
    // are background work — they must never yank the view.
    EffectBus.on<{ silent?: boolean }>('adopt:done', (p) => {
      if (p?.silent) return
      this.viewMode.set('hexagons')
      EffectBus.emit('nav:to-hive', { reason: 'adopt-complete' })
    })

    // ViewMode subscription — drives Pixi-canvas visibility via app.html.
    // Self-registered in shared/core/view-mode.service.ts at module load.
    const wireViewMode = (svc: { mode: string } & EventTarget): void => {
      this.viewMode.set(svc.mode)
      svc.addEventListener('change', () => this.viewMode.set(svc.mode))
    }
    const modeSvc = (window as unknown as { ioc?: { get: <T>(k: string) => T | undefined; whenReady: <T>(k: string, cb: (v: T) => void) => void } }).ioc
    if (modeSvc) {
      const now = modeSvc.get<{ mode: string } & EventTarget>('@hypercomb.social/ViewMode')
      if (now) wireViewMode(now)
      else modeSvc.whenReady<{ mode: string } & EventTarget>('@hypercomb.social/ViewMode', wireViewMode)
    }

    // Mirror the active mode to <body> as a class so global stylesheets
    // can hide DOM that portals out of app-root (history-viewer, others
    // that move themselves to document.body at runtime).
    effect(() => {
      const m = this.viewMode()
      // Drop EVERY previous hc-view-* class (modes are open-ended; the old
      // two-name remove left stale classes behind when switching between
      // non-website views), then mark the current mode — plus the generic
      // `hc-view-covered` for any full-surface view, which is what the
      // canvas-suppression rule in styles.scss keys on. With the canvas
      // neutralised under every takeover view, a view-to-view navigation
      // exposes the themed body between surfaces, never a flash of tiles.
      for (const c of [...document.body.classList]) {
        if (c.startsWith('hc-view-')) document.body.classList.remove(c)
      }
      document.body.classList.add(`hc-view-${m}`)
      const vm = (window as unknown as { ioc?: { get?: <T>(k: string) => T | undefined } })
        .ioc?.get?.<{ isTransient?: (mode: string) => boolean }>('@hypercomb.social/ViewMode')
      if (vm?.isTransient?.(m)) document.body.classList.add('hc-view-covered')
    })

    console.log('[app] initialized')
  }

  public ngAfterViewInit(): void {
    void this.runtimeReady.then(() => {
      void this.startRegisteredBees()
    })
  }

  private readonly pulseBee = (bee: Bee): void => {
    void bee.pulse('').catch(error =>
      console.warn('[app] failed to start bee', bee.constructor?.name, error)
    )
  }

  private readonly startRegisteredBees = async (): Promise<void> => {
    // Bees may register over time (BootstrapHistory's Phase 2 loads them
    // from OPFS in the background, after runtimeReady has resolved), so
    // subscribe to future registrations BEFORE pulsing the current ones.
    // Without this, late-registered workers like PixiHostWorker never
    // get their first pulse and the canvas never mounts.
    window.ioc.onRegister((_key, value) => {
      if (value && typeof (value as Bee).pulse === 'function') {
        this.pulseBee(value as Bee)
      }
    })

    const values = list()
      .map(key => get(key))
      .filter((value): value is Bee => !!value && typeof (value as Bee).pulse === 'function')

    await Promise.allSettled(values.map(bee =>
      bee.pulse('').catch(error =>
        console.warn('[app] failed to start bee', bee.constructor?.name, error)
      )
    ))

    // Boot kick through the processor — hypercomb.act() owns the
    // `synchronize` dispatch (and the optimize phase). A second pulse of
    // already-started bees is normal processor behavior, identical to the
    // first user act.
    await new hypercomb().act('')

    // broadcast initial mesh state so drones can react
    EffectBus.emit('mesh:public-changed', { public: this.meshPublic() })
  }
}
