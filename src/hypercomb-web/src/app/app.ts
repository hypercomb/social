import { AfterViewInit, Component, computed, effect, HostBinding, inject, signal } from '@angular/core'
import { type Bee, EffectBus } from '@hypercomb/core'
import type { BootStatus } from '../setup/ensure-install'
import { RouterOutlet } from '@angular/router'
import { Header } from './header/header'
import { CoreAdapter } from './core-adapter'
import { TileEditorComponent } from "@hypercomb/shared/ui/tile-editor/tile-editor.component"
import { ControlsBarComponent } from "@hypercomb/shared/ui/controls-bar/controls-bar.component"
import { MeshHeaderComponent } from "@hypercomb/shared/ui/mesh-header/mesh-header.component"
import { PortalOverlayComponent } from "@hypercomb/shared/ui/portal/portal-overlay.component"
import { SensitivityBarComponent } from "@hypercomb/shared/ui/sensitivity-bar/sensitivity-bar.component"
import { SelectionContextMenuComponent } from "@hypercomb/shared/ui/selection-context-menu/selection-context-menu.component"
import { ConfirmDialogComponent } from "@hypercomb/shared/ui/confirm-dialog/confirm-dialog.component"
import { DocsOverlayComponent } from "@hypercomb/shared/ui/docs-overlay/docs-overlay.component"
import { HistoryViewerComponent } from "@hypercomb/shared/ui/history-viewer/history-viewer.component"
import { NotesStripComponent } from "@hypercomb/shared/ui/notes-strip/notes-strip.component"
import { NotesViewerComponent } from "@hypercomb/shared/ui/notes-viewer/notes-viewer.component"
import { WebsiteViewComponent } from "@hypercomb/shared/ui/website-view/website-view.component"

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, Header, MeshHeaderComponent, TileEditorComponent, ControlsBarComponent, PortalOverlayComponent, SensitivityBarComponent, SelectionContextMenuComponent, ConfirmDialogComponent, DocsOverlayComponent, HistoryViewerComponent, NotesStripComponent, NotesViewerComponent, WebsiteViewComponent],
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
  protected readonly secretOpen = signal(false)
  protected readonly inputOpen = signal(false)
  public showHeader = true
  public readonly viewActive = signal(false)
  readonly clipboardMode = signal(false)
  readonly moveMode = signal(false)
  protected readonly bootStatus = signal<BootStatus | null>(null)
  protected readonly dcpPortalOpen = signal(false)
  protected readonly installNeeded = computed(() =>
    this.bootStatus()?.kind === 'install-needed' && !this.dcpPortalOpen()
  )
  protected readonly installReason = computed(() => {
    const s = this.bootStatus()
    return s?.kind === 'install-needed' ? s.reason : null
  })
  protected openDcpPortal(): void {
    window.dispatchEvent(new CustomEvent('portal:open', { detail: { target: 'dcp' } }))
  }

  @HostBinding('class.clipboard-mode')
  get clipboardModeClass() { return this.clipboardMode(); }

  @HostBinding('class.move-mode')
  get moveModeClass() { return this.moveMode(); }

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

    EffectBus.on<BootStatus>('boot:status', (status) => {
      this.bootStatus.set(status)
    })

    EffectBus.on<{ active: boolean }>('view:active', ({ active }) => {
      this.viewActive.set(active)
    })

    EffectBus.on<{ active: boolean }>('clipboard:view', ({ active }) => {
      this.clipboardMode.set(active)
    })

    EffectBus.on<{ active: boolean }>('move:mode', ({ active }) => {
      this.moveMode.set(active)
    })

    // Mobile command-line reveal: when the user long-presses an empty area
    // (or otherwise toggles via the controls bar), the header-bar must
    // un-hide so the command-line inside it is visible.
    EffectBus.on<{ visible: boolean; mobile: boolean }>('mobile:input-visible', ({ visible, mobile }) => {
      this.inputOpen.set(mobile && visible)
    })

    window.addEventListener('portal:open', (e) => {
      if ((e as CustomEvent).detail?.target === 'dcp') this.dcpPortalOpen.set(true)
    })
    window.addEventListener('dcp:embed-closed', () => this.dcpPortalOpen.set(false))

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
      document.body.classList.remove('hc-view-hexagons', 'hc-view-website')
      document.body.classList.add(`hc-view-${m}`)
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

    window.dispatchEvent(new Event('synchronize'))

    // broadcast initial mesh state so drones can react
    EffectBus.emit('mesh:public-changed', { public: this.meshPublic() })
  }
}
