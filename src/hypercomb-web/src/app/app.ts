import { AfterViewInit, Component, computed, effect, HostBinding, inject, signal } from '@angular/core'
import { type Bee, EffectBus } from '@hypercomb/core'
import { upgradeFromBundled, type BootStatus } from '../setup/ensure-install'
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
import { MeshModalComponent } from "@hypercomb/shared/ui/mesh-modal/mesh-modal.component"
import { TrustPromptComponent } from "@hypercomb/shared/ui/trust-prompt/trust-prompt.component"
import { LayerCycleStripComponent } from "@hypercomb/shared/ui/layer-cycle-strip/layer-cycle-strip.component"
import { ToastComponent } from "@hypercomb/shared/ui/toast/toast.component"
import { PresenceBannerComponent } from "@hypercomb/shared/ui/presence-banner/presence-banner.component"
import { SyncIndicatorComponent } from "@hypercomb/shared/ui/sync-indicator/sync-indicator.component"
import { CameraCaptureComponent } from "@hypercomb/shared/ui/camera-capture/camera-capture.component"
import { SwarmAdoptPanelComponent } from "@hypercomb/shared/ui/swarm-adopt-panel/swarm-adopt-panel.component"

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, Header, MeshHeaderComponent, TileEditorComponent, ControlsBarComponent, PortalOverlayComponent, SensitivityBarComponent, SelectionContextMenuComponent, ConfirmDialogComponent, DocsOverlayComponent, HistoryViewerComponent, NotesStripComponent, NotesViewerComponent, MeshModalComponent, TrustPromptComponent, LayerCycleStripComponent, ToastComponent, PresenceBannerComponent, SyncIndicatorComponent, CameraCaptureComponent, SwarmAdoptPanelComponent],
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
  readonly clipboardMode = signal(false)
  readonly moveMode = signal(false)
  protected readonly bootStatus = signal<BootStatus | null>(null)
  protected readonly dcpPortalOpen = signal(false)
  protected readonly installNeeded = computed(() =>
    this.bootStatus()?.kind === 'install-needed' && !this.dcpPortalOpen()
  )
  /** Persistent storage (OPFS) is missing — private window, or a Safari
   *  before 16.4. Installing is impossible, so the welcome card explains
   *  what to change instead of offering a Start that can only loop. */
  protected readonly storageBlocked = computed(() => {
    const status = this.bootStatus()
    return status?.kind === 'install-needed' && status.reason === 'no-storage'
  })
  /** First-run "Start" — one button, zero choices. Hands off to main.ts's
   *  unattended install routine (hidden sentinel → DCP resolves from its
   *  content domains → stream → reload; bundled package as the silent
   *  fallback). The card shows "Starting…" until the routine either
   *  reloads the shell (success) or re-emits install-needed (re-arm,
   *  handled in the boot:status subscription below). */
  protected startWelcome(): void {
    if (this.upgrading()) return
    this.upgrading.set(true)
    window.dispatchEvent(new CustomEvent('hypercomb:start-install'))
  }

  /**
   * User-initiated install from the shell's bundled `/content/` package.
   * Wired to the "Upgrade Hypercomb" button in the install-needed prompt;
   * also surfaced as `window.upgradeHypercomb` for headless triggering.
   * On success, reloads the page so the freshly-installed bees take over.
   */
  protected upgrading = signal(false)
  protected async upgradeFromBundledClicked(): Promise<void> {
    if (this.upgrading()) return
    this.upgrading.set(true)
    try {
      const ok = await upgradeFromBundled()
      if (ok) location.reload()
      else this.upgrading.set(false)
    } catch (err) {
      console.error('[app] upgradeFromBundled failed', err)
      this.upgrading.set(false)
    }
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

    // Exposed for console / headless testing. Same effect as clicking
    // "Upgrade Hypercomb" in the install-needed prompt.
    ;(window as any).upgradeHypercomb = () => this.upgradeFromBundledClicked()

    EffectBus.on<BootStatus>('boot:status', (status) => {
      this.bootStatus.set(status)
      // A fresh install-needed while "Starting…" means the unattended
      // routine exhausted both sources (sentinel + bundled) — re-arm the
      // Start button so the participant can retry.
      if (status?.kind === 'install-needed') this.upgrading.set(false)
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

    // ─── Return to the hive on adopt complete ──────────────────────────
    // Web/dev shell parity with hypercomb-dev: after broker.adopt walks
    // the peer's subtree → adopt:done fires, ensure the participant lands
    // on the tile-grid view at their current location so the adopted
    // content renders. Idempotent — already on 'hexagons' = no-op.
    EffectBus.on('adopt:done', () => {
      this.viewMode.set('hexagons')
      EffectBus.emit('nav:to-hive', { reason: 'adopt-complete' })
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
