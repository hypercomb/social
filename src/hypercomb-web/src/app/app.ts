import { AfterViewInit, Component, ElementRef, HostBinding, ViewChild, inject, signal } from '@angular/core'
import { type Bee, EffectBus } from '@hypercomb/core'
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

const INTRO_KEY_1 = 'hc:intro:episode-1-watched'
const INTRO_KEY_0 = 'hc:intro:episode-0-watched'
const INTRO_THRESHOLD = 0.95

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, Header, MeshHeaderComponent, TileEditorComponent, ControlsBarComponent, PortalOverlayComponent, SensitivityBarComponent, SelectionContextMenuComponent, ConfirmDialogComponent, DocsOverlayComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App implements AfterViewInit {

  protected readonly title = signal('hypercomb-web')
  protected readonly secretOpen = signal(false)
  public showHeader = true
  public readonly viewActive = signal(false)
  readonly clipboardMode = signal(false)
  readonly moveMode = signal(false)

  // ── intro playback state ───────────────────────────────
  readonly introPlaying = signal(
    !(localStorage.getItem(INTRO_KEY_1) === 'true' && localStorage.getItem(INTRO_KEY_0) === 'true')
  )
  /** Which episode is currently playing. Episode 1 plays first, then episode 0. */
  readonly currentEpisode = signal<1 | 0>(1)
  /** True while the 3-second "NO SIGNAL" interlude between episodes is showing. */
  readonly interludePlaying = signal(false)

  @ViewChild('introAudio1') introAudio1Ref?: ElementRef<HTMLAudioElement>
  @ViewChild('introAudio0') introAudio0Ref?: ElementRef<HTMLAudioElement>

  @HostBinding('class.clipboard-mode')
  get clipboardModeClass() { return this.clipboardMode(); }

  @HostBinding('class.move-mode')
  get moveModeClass() { return this.moveMode(); }
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

    EffectBus.on<{ active: boolean }>('clipboard:view', ({ active }) => {
      this.clipboardMode.set(active)
    })

    EffectBus.on<{ active: boolean }>('move:mode', ({ active }) => {
      this.moveMode.set(active)
    })

    // /skip-intro queen (and anyone else) can end the intro via this event.
    EffectBus.on('intro:skip', () => {
      if (this.introPlaying()) this.skipCurrentIntro()
    })

    console.log('[app] initialized')
  }

  public ngAfterViewInit(): void {
    void this.runtimeReady.then(() => {
      void this.startRegisteredBees()
    })

    if (this.introPlaying()) {
      this.playCurrentEpisode()
    }
  }

  // ── intro helpers ──────────────────────────────────────

  private getCurrentAudio(): HTMLAudioElement | undefined {
    return this.currentEpisode() === 1
      ? this.introAudio1Ref?.nativeElement
      : this.introAudio0Ref?.nativeElement
  }

  private playCurrentEpisode(): void {
    const audio = this.getCurrentAudio()
    if (!audio) return
    const play = () => audio.play().catch(() => {})
    audio.play().catch(() => {
      // Autoplay blocked — wait for first user gesture.
      const handler = () => {
        play()
        window.removeEventListener('pointerdown', handler)
        window.removeEventListener('keydown', handler)
      }
      window.addEventListener('pointerdown', handler)
      window.addEventListener('keydown', handler)
    })
  }

  onIntroTimeUpdate(episode: 1 | 0, event: Event): void {
    const audio = event.target as HTMLAudioElement
    if (!audio.duration || !isFinite(audio.duration)) return
    if (audio.currentTime / audio.duration >= INTRO_THRESHOLD) {
      localStorage.setItem(episode === 1 ? INTRO_KEY_1 : INTRO_KEY_0, 'true')
    }
  }

  onIntroEnded(episode: 1 | 0): void {
    // Guarantee the watched flag is set on natural end, even if timeupdate
    // fired its last event just under the 95% threshold.
    localStorage.setItem(episode === 1 ? INTRO_KEY_1 : INTRO_KEY_0, 'true')
    this.advanceIntro()
  }

  skipCurrentIntro(): void {
    const audio = this.getCurrentAudio()
    if (audio) {
      audio.pause()
      audio.currentTime = 0
    }
    this.advanceIntro()
  }

  private advanceIntro(): void {
    if (this.currentEpisode() === 1) {
      this.currentEpisode.set(0)
      // 3-second "NO SIGNAL" interlude between episodes.
      this.interludePlaying.set(true)
      setTimeout(() => {
        this.interludePlaying.set(false)
        queueMicrotask(() => this.playCurrentEpisode())
      }, 3000)
    } else {
      this.introPlaying.set(false)
    }
  }

  private readonly startRegisteredBees = async (): Promise<void> => {
    const values = list()
      .map(key => get(key))
      .filter((value): value is Bee => !!value && typeof (value as Bee).pulse === 'function')

    await Promise.allSettled(
      values.map(bee => bee.pulse('').catch(error =>
        console.warn('[app] failed to start bee', bee.constructor?.name, error)
      ))
    )

    window.dispatchEvent(new Event('synchronize'))

    // broadcast initial mesh state so drones can react
    EffectBus.emit('mesh:public-changed', { public: this.meshPublic() })
  }
}
