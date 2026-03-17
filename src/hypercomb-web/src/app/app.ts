import { AfterViewInit, Component, computed, inject, signal } from '@angular/core'
import { type Bee, EffectBus } from '@hypercomb/core'
import { RouterOutlet } from '@angular/router'
import { Header } from './header/header'
import { CoreAdapter } from './core-adapter'
import { TileEditorComponent } from "@hypercomb/shared/ui/tile-editor/tile-editor.component"
import { ControlsBarComponent } from "@hypercomb/shared/ui/controls-bar/controls-bar.component"
import type { SecretStore } from '@hypercomb/shared/core/secret-store'
import type { Navigation } from '@hypercomb/shared/core/navigation'

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

  // ── secret state (public-mode mesh scoping) ─────────────
  #secretValue = signal('')
  #secretVisible = signal(false)

  protected readonly secretValue = this.#secretValue.asReadonly()
  protected readonly secretVisible = this.#secretVisible.asReadonly()
  protected readonly hasSecret = computed(() => this.#secretValue().trim().length > 0)

  private get secretStore(): SecretStore | undefined {
    return get('@hypercomb.social/SecretStore') as SecretStore | undefined
  }

  private get navigation(): Navigation {
    return get('@hypercomb.social/Navigation') as Navigation
  }

  protected readonly toggleMesh = (): void => {
    const wasPublic = this.meshPublic()
    this.core.toggleMesh()
    if (!wasPublic) {
      // coming back to public — restore secret from store
      const stored = this.secretStore?.value ?? ''
      this.#secretValue.set(stored)
      if (stored) EffectBus.emit('mesh:secret', { secret: stored })
    }
  }

  protected readonly onShieldClick = (): void => {
    this.#secretVisible.update(v => !v)
  }

  protected readonly onSecretInput = (event: Event): void => {
    this.#secretValue.set((event.target as HTMLInputElement).value)
  }

  protected readonly submitSecret = (): void => {
    const value = this.#secretValue().trim()
    if (!value) return
    this.secretStore?.set(value)
    EffectBus.emit('mesh:secret', { secret: value })
    const segments = value.split('/').map(s => s.trim()).filter(Boolean)
    this.navigation.go(segments)
  }

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
      // pre-fill secret from store (subdomain may have populated it)
      const stored = this.secretStore?.value ?? ''
      if (stored) this.#secretValue.set(stored)

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
