import { AfterViewInit, Component, computed, effect, HostBinding, inject, signal } from '@angular/core'
import { type Bee, EffectBus, hypercomb } from '@hypercomb/core'
import { upgradeFromBundled, checkForUpdate, type BootStatus } from '../setup/ensure-install'
import { cacheImportMap } from '../setup/resolve-import-map'
import { nativeAvailable } from '@hypercomb/shared/core/native-filesystem'
import { buildRevisionName } from '@hypercomb/core'
import { RouterOutlet } from '@angular/router'
import { Header } from './header/header'
import { CoreAdapter } from './core-adapter'
import { ControlsBarComponent } from "@hypercomb/shared/ui/controls-bar/controls-bar.component"
import { EditActionsComponent } from "@hypercomb/shared/ui/edit-actions/edit-actions.component"
import { MeshHeaderComponent } from "@hypercomb/shared/ui/mesh-header/mesh-header.component"
import { ShellSurfacesComponent } from "@hypercomb/shared/ui/shell-surfaces/shell-surfaces.component"
import { SyncIndicatorComponent } from "@hypercomb/shared/ui/sync-indicator/sync-indicator.component"
import { UpgradeIndicatorComponent } from "@hypercomb/shared/ui/upgrade-indicator/upgrade-indicator.component"
import { TranslatePipe } from "@hypercomb/shared/core/i18n.pipe"

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, Header, TranslatePipe, MeshHeaderComponent, ControlsBarComponent, EditActionsComponent, ShellSurfacesComponent, SyncIndicatorComponent, UpgradeIndicatorComponent],
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
  /** Storage opens but cannot be written — iOS Safari 16.4–18.3, which has
   *  getDirectory but not createWritable. A different message from
   *  storageBlocked because the remedy is different: not a window to close
   *  or a browser to restart, an OS/browser to update. */
  protected readonly updateNeeded = computed(() => {
    const status = this.bootStatus()
    return status?.kind === 'install-needed' && status.reason === 'no-writable'
  })
  /** What the install is doing right now, shown under "Starting…".
   *
   *  An unchanging "Starting…" is indistinguishable from a hang, and the
   *  install has several slow steps (a DCP handshake that can time out, then a
   *  bundled fallback) during which nothing visible happens. The routine
   *  already reports phase/current/total on the `install:sync` bus — this just
   *  surfaces it. */
  protected readonly installProgress = signal('')

  /** The native auto-install fires once per session. */
  #nativeInstallTried = false

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
  protected async upgradeFromBundledClicked(
    restorePointName?: string,
    requireCheckpoint = false,
  ): Promise<void> {
    if (this.upgrading()) return
    this.upgrading.set(true)
    try {
      if (requireCheckpoint) {
        EffectBus.emit('update:status', { phase: 'snapshotting', message: 'Saving restore point…' })
        const queen = window.ioc?.get<{
          createRestorePoint?: (name: string) => Promise<boolean>
        }>('@diamondcoreprocessor.com/SnapshotQueenBee')
        const checkpointed = await queen?.createRestorePoint?.(String(restorePointName ?? '').trim())
        if (!checkpointed) {
          EffectBus.emit('update:status', {
            phase: 'error',
            message: 'Update stopped — the restore point was not saved',
          })
          this.upgrading.set(false)
          return
        }
      }
      EffectBus.emit('update:status', { phase: 'applying', message: 'Updating packages and website…' })
      const ok = await upgradeFromBundled()
      // Cache the map the upgrade just made resolvable so the reload boots
      // with it live before the module graph (see setup/resolve-import-map).
      if (ok) {
        await cacheImportMap()
        EffectBus.emit('update:status', { phase: 'complete', message: 'Everything is updated' })
        location.reload()
      } else {
        EffectBus.emit('update:status', { phase: 'error', message: 'Update failed — nothing was adopted' })
        this.upgrading.set(false)
      }
    } catch (err) {
      console.error('[app] upgradeFromBundled failed', err)
      EffectBus.emit('update:status', { phase: 'error', message: 'Update failed — nothing was adopted' })
      this.upgrading.set(false)
    }
  }

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

    // Exposed for console / headless testing. Same effect as clicking
    // "Upgrade Hypercomb" in the install-needed prompt.
    ;(window as any).upgradeHypercomb = () => this.upgradeFromBundledClicked()

    EffectBus.on<BootStatus>('boot:status', (status) => {
      this.bootStatus.set(status)
      // A fresh install-needed while "Starting…" means the unattended
      // routine exhausted both sources (sentinel + bundled) — re-arm the
      // Start button so the participant can retry.
      if (status?.kind === 'install-needed') this.upgrading.set(false)

      // NATIVE SHELL: install without waiting to be asked.
      //
      // The web shell needs the click — a first-run install there is a user
      // decision about storing data in their browser. A desktop app has
      // already been installed deliberately, ships its own content, and owns
      // its storage, so a "Start" button to unpack what the user just
      // installed is a stall, not a choice. Fires once; re-arms only if the
      // install genuinely fails, so a failure still surfaces the button.
      if (status?.kind === 'install-needed' && nativeAvailable() && !this.#nativeInstallTried) {
        this.#nativeInstallTried = true
        // LOOP GUARD. A failed install reloads ('next reload will retry'),
        // which lands right back here — auto-starting again turns one broken
        // install into an endless welcome-screen cycle (observed live).
        // sessionStorage survives reloads but not a fresh launch: auto-start
        // fires once per app session; after that the button waits for a human.
        let attempts = 0
        try { attempts = Number(sessionStorage.getItem('hc:auto-install-attempts') ?? '0') } catch {}
        if (attempts < 1) {
          try { sessionStorage.setItem('hc:auto-install-attempts', String(attempts + 1)) } catch {}
          queueMicrotask(() => this.startWelcome())
        }
      }
    })

    // Surface what the install is doing, so "Starting…" is never silent.
    EffectBus.on<{ active: boolean; source?: string; phase?: string; current?: number; total?: number }>(
      'install:sync',
      ({ active, source, phase, current, total }) => {
        if (!active) { this.installProgress.set(''); return }
        const counted = typeof current === 'number' && typeof total === 'number' && total > 0
          ? ` ${current}/${total}`
          : ''
        this.installProgress.set(`${source ?? 'install'}${phase ? ` · ${phase}` : ''}${counted}`)
      },
    )

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

    window.addEventListener('portal:open', (e) => {
      if ((e as CustomEvent).detail?.target === 'dcp') this.dcpPortalOpen.set(true)
    })
    window.addEventListener('dcp:embed-closed', () => this.dcpPortalOpen.set(false))

    // "New features" indicator → just apply. We're in alpha; the eggs
    // (negative-cache + render guards) protect the canvas, so a deployed
    // package update installs straight away — no DCP review/opt-in gate.
    // The mesh only announces WHICH features changed; the bytes are fetched
    // by THIS origin from its own bundled `/content/` (upgradeFromBundled),
    // then the shell reloads so the freshly-installed bees take over.
    window.addEventListener('hypercomb:apply-update', event => {
      const detail = (event as CustomEvent<{ restorePointName?: string; packageSig?: string | null }>).detail
      // The indicator writes the name before it dispatches. `/upgrade` (and any
      // other door) may not, so mint one here rather than snapshotting under
      // the empty string — every update this hive takes gets a name.
      const restorePointName = String(detail?.restorePointName ?? '').trim()
        || buildRevisionName({
          packageSig: detail?.packageSig,
          locale: String(window.ioc?.get<{ locale?: string }>('@hypercomb.social/I18n')?.locale ?? 'en'),
        })
      // The typed (or minted) name names THIS deployed revision — land it on
      // the installer's version row too, so DCP's revision list reads the
      // same name the participant saw in the pill. Fire-and-forget BEFORE the
      // upgrade: the success path ends in location.reload(), which would kill
      // an in-flight port message. Best-effort — no bridge, no rename.
      const packageSig = String(detail?.packageSig ?? '').trim().toLowerCase()
      if (/^[a-f0-9]{64}$/.test(packageSig)) {
        void (globalThis as { __sentinelBridge?: { nameRevision?: (sig: string, name: string) => Promise<boolean> } })
          .__sentinelBridge?.nameRevision?.(packageSig, restorePointName)
      }
      void this.upgradeFromBundledClicked(restorePointName, true)
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

  /**
   * `?upgrade=1` — the one upgrade door that works on a PHONE.
   *
   * Every other route to an upgrade is unreachable on a touch device with an
   * existing install: `window.upgradeHypercomb()` needs a console, the
   * "Upgrade Hypercomb" button only renders in the install-NEEDED prompt (so
   * never once you are installed), and the header indicator is suppressed
   * outright for DCP-sourced installs by checkForUpdate's provenance gate.
   * The net effect was that a deployed build could not reach a phone at all.
   * An address bar is the one input every device has.
   *
   * This lives in the SHELL on purpose. The upgrade path can never be shipped
   * as a bee, because bees are the thing being upgraded — a fix delivered as a
   * drone only exists after the upgrade it was meant to trigger. The shell is
   * served fresh on every load, so this door opens the moment the web app is
   * deployed, with no install involved.
   *
   * The param is consumed BEFORE the upgrade runs: a successful upgrade
   * reloads, and a param left in the URL would re-upgrade on every load for
   * ever.
   */
  #consumeUpgradeParam(): boolean {
    try {
      const url = new URL(location.href)
      if (!url.searchParams.has('upgrade')) return false
      url.searchParams.delete('upgrade')
      history.replaceState(history.state, '', url.toString())
      return true
    } catch {
      return false
    }
  }

  public ngAfterViewInit(): void {
    void this.runtimeReady.then(() => {
      void this.startRegisteredBees()

      // Asked for explicitly — take the bundled build now and skip the
      // detection gate entirely. `upgradeFromBundledClicked` reloads on
      // success, so nothing below runs on that path.
      if (this.#consumeUpgradeParam()) {
        void this.upgradeFromBundledClicked()
        return
      }
      // Post-boot update check — OFF the boot critical path (push-only boot
      // still reads OPFS only). Compares the cached install against the
      // shell's bundled package; if newer, emits `update:available` so the
      // header's upgrade indicator appears. Re-checks on tab refocus so a
      // long-open session notices a fresh deploy after the user returns.
      const runCheck = (): void => { void checkForUpdate() }
      setTimeout(runCheck, 4000)
      window.addEventListener('focus', () => setTimeout(runCheck, 500))
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
