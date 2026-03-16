import { AfterViewInit, Component, inject, signal } from '@angular/core'
import { type Bee, EffectBus } from '@hypercomb/core'
import { RouterOutlet } from '@angular/router'
import { Header } from './header/header'
import { CoreAdapter } from './core-adapter'
import { TileEditorComponent } from "@hypercomb/shared/ui/tile-editor/tile-editor.component"
import { ControlsBarComponent } from "@hypercomb/shared/ui/controls-bar/controls-bar.component"

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, Header, TileEditorComponent, ControlsBarComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App implements AfterViewInit {

  protected readonly title = signal('hypercomb-web')
  public showHeader = true
  private runtimeReady: Promise<void> = Promise.resolve()

  protected readonly core = inject(CoreAdapter)
  protected readonly meshPublic = this.core.meshPublic
  protected readonly toggleMesh = () => this.core.toggleMesh()

  constructor() {
    window.addEventListener('error', e => {
      if ((e as ErrorEvent).message?.includes('ResizeObserver loop')) {
        e.stopImmediatePropagation()
      }
    })

    this.runtimeReady = this.core.initialize()
    console.log('[app] initialized')
  }

  public ngAfterViewInit(): void {
    void this.runtimeReady.then(() => {
      requestAnimationFrame(() => {
        void this.startRegisteredBees()
      })
    })
  }

  private readonly startRegisteredBees = async (): Promise<void> => {
    const values = list()
      .map(key => get(key))
      .filter((value): value is Bee => !!value && typeof (value as Bee).pulse === 'function')

    for (const bee of values) {
      try {
        await bee.pulse('')
      } catch (error) {
        console.warn('[app] failed to start bee', bee.constructor?.name, error)
      }
    }

    window.dispatchEvent(new Event('synchronize'))

    // broadcast initial mesh state so drones can react
    EffectBus.emit('mesh:public-changed', { public: this.meshPublic() })
  }
}
