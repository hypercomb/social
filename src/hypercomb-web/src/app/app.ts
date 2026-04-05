import { AfterViewInit, Component, HostBinding, ViewChild, inject, signal } from '@angular/core'
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
import { AudioPlayerComponent } from "@hypercomb/shared/ui/audio-player/audio-player.component"

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, Header, MeshHeaderComponent, TileEditorComponent, ControlsBarComponent, PortalOverlayComponent, SensitivityBarComponent, SelectionContextMenuComponent, ConfirmDialogComponent, DocsOverlayComponent, AudioPlayerComponent],
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
  readonly introPlaying = signal(localStorage.getItem('hc:intro-played') !== 'true')
  readonly introPhase = signal<'speech' | 'interlude' | 'outro'>('speech')

  @ViewChild('speechAudio') speechAudioRef?: AudioPlayerComponent
  @ViewChild('outroAudio') outroAudioRef?: AudioPlayerComponent
  #interludeTimer?: ReturnType<typeof setTimeout>

  @HostBinding('class.clipboard-mode')
  get clipboardModeClass() { return this.clipboardMode(); }

  @HostBinding('class.move-mode')
  get moveModeClass() { return this.moveMode(); }

  @HostBinding('class.intro-active')
  get introActiveClass() { return this.introPlaying(); }
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

    console.log('[app] initialized')
  }

  public ngAfterViewInit(): void {
    void this.runtimeReady.then(() => {
      void this.startRegisteredBees()
    })

    // autoplay + gesture fallback is handled inside AudioPlayerComponent
  }

  onSpeechEnded(): void {
    this.enterInterlude()
  }

  skipSpeech(): void {
    this.speechAudioRef?.reset()
    this.enterInterlude()
  }

  skipInterlude(): void {
    this.enterOutro()
  }

  onOutroEnded(): void {
    this.dismissIntro()
  }

  skipOutro(): void {
    this.outroAudioRef?.reset()
    this.dismissIntro()
  }

  startIntroAudio(): void {
    if (this.introPhase() === 'speech') void this.speechAudioRef?.play()
    else if (this.introPhase() === 'outro') void this.outroAudioRef?.play()
  }

  private enterInterlude(): void {
    this.introPhase.set('interlude')
    this.#interludeTimer = setTimeout(() => this.enterOutro(), 2500)
  }

  private enterOutro(): void {
    if (this.#interludeTimer) {
      clearTimeout(this.#interludeTimer)
      this.#interludeTimer = undefined
    }
    this.introPhase.set('outro')
  }

  private dismissIntro(): void {
    localStorage.setItem('hc:intro-played', 'true')
    this.introPlaying.set(false)
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
