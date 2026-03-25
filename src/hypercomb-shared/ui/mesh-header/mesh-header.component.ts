import { Component, computed, EventEmitter, Input, Output, signal } from '@angular/core'
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

  @Input() meshPublic: boolean | null = false
  @Output() readonly meshToggled = new EventEmitter<void>()
  @Output() readonly secretExpandedChange = new EventEmitter<boolean>()

  #secretValue = signal('')
  #secretExpanded = signal(false)
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

  /** Cycle: solo → public → secret → solo */
  readonly cycleMode = (): void => {
    if (!this.meshPublic) {
      // solo → public
      this.meshToggled.emit()
    } else if (!this.#secretExpanded()) {
      // public → secret
      this.#secretExpanded.set(true)
      this.secretExpandedChange.emit(true)
    } else {
      // secret → solo
      this.#secretExpanded.set(false)
      this.#secretRevealed.set(false)
      this.secretExpandedChange.emit(false)
      this.meshToggled.emit()
    }
  }

  readonly onEyeClick = (): void => {
    this.#secretRevealed.update(v => !v)
  }

  readonly onSecretInput = (event: Event): void => {
    this.#secretValue.set((event.target as HTMLInputElement).value)
  }

  readonly submitSecret = (event: Event): void => {
    const value = (event.target as HTMLInputElement).value.trim()
    if (value.length > 0 && value.length < 8) return
    this.#secretValue.set(value)
    this.#store?.set(value)
    EffectBus.emit('mesh:secret', { secret: value })
  }

  readonly clearSecret = (): void => {
    this.#secretValue.set('')
    this.#store?.set('')
    EffectBus.emit('mesh:secret', { secret: '' })
  }
}
