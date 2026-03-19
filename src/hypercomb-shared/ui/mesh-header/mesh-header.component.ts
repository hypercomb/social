import { Component, computed, input, output, signal } from '@angular/core'
import { EffectBus } from '@hypercomb/core'
import type { SecretStore } from '../../core/secret-store'
import type { SecretStrengthProvider } from '../../core/secret-strength'

@Component({
  selector: 'hc-mesh-header',
  standalone: true,
  templateUrl: './mesh-header.component.html',
  styleUrls: ['./mesh-header.component.scss'],
})
export class MeshHeaderComponent {

  readonly meshPublic = input(false)
  readonly meshToggled = output<void>()

  #secretValue = signal('')
  #secretExpanded = signal(true)
  #secretRevealed = signal(false)

  readonly secretValue = this.#secretValue.asReadonly()
  readonly secretExpanded = this.#secretExpanded.asReadonly()
  readonly secretRevealed = this.#secretRevealed.asReadonly()
  readonly hasSecret = computed(() => this.#secretValue().trim().length > 0)

  readonly shieldColor = computed(() => {
    const secret = this.#secretValue().trim()
    if (!secret) return 'rgba(245, 245, 245, 0.35)'
    const provider = get('@hypercomb.social/SecretStrengthProvider') as SecretStrengthProvider | undefined
    const score = provider?.evaluate(secret) ?? 0.5
    const hue = Math.round(score * 130)
    return `hsl(${hue}, 70%, 50%)`
  })

  constructor() {
    // pre-fill from store if available
    const store = this.#store
    if (store?.value) {
      this.#secretValue.set(store.value)
      this.#secretExpanded.set(false)
    }
  }

  get #store(): SecretStore | undefined {
    return get('@hypercomb.social/SecretStore') as SecretStore | undefined
  }

  readonly onShieldClick = (): void => {
    this.#secretExpanded.update(v => !v)
    if (!this.#secretExpanded()) {
      // if collapsing, also hide the secret
      this.#secretRevealed.set(false)
    }
  }

  readonly onEyeClick = (): void => {
    this.#secretRevealed.update(v => !v)
  }

  readonly onSecretInput = (event: Event): void => {
    this.#secretValue.set((event.target as HTMLInputElement).value)
  }

  readonly submitSecret = (): void => {
    const value = this.#secretValue().trim()
    this.#store?.set(value)
    EffectBus.emit('mesh:secret', { secret: value })
    this.#secretExpanded.set(false)
    this.#secretRevealed.set(false)
  }
}
