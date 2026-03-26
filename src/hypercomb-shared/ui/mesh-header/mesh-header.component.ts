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

  readonly secretValue = this.#secretValue.asReadonly()
  readonly hasSecret = computed(() => this.#secretValue().trim().length > 0)
  readonly showSecretInput = () => (!!this.meshPublic && !this.hasSecret()) || this.#secretExpanded()

  readonly shieldColor = computed(() => {
    const secret = this.#secretValue().trim()
    if (!secret) return 'rgba(245, 245, 245, 0.35)'
    const provider = get('@hypercomb.social/SecretStrengthProvider') as SecretStrengthProvider | undefined
    const score = provider?.evaluate(secret) ?? 0.5
    const hue = Math.round(score * 130)
    return `hsl(${hue}, 70%, 50%)`
  })

  constructor() {
    const store = this.#store
    if (store?.value) {
      this.#secretValue.set(store.value)
      this.#secretExpanded.set(false)
    }
  }

  get #store(): SecretStore | undefined {
    return get('@hypercomb.social/SecretStore') as SecretStore | undefined
  }

  #longPressTimer: ReturnType<typeof setTimeout> | null = null

  /** Tap: toggle solo ↔ shield. Long-press in shield: expand secret input. */
  readonly onPointerDown = (): void => {
    this.#longPressTimer = setTimeout(() => {
      this.#longPressTimer = null
      if (this.meshPublic && !this.#secretExpanded()) {
        this.#secretExpanded.set(true)
        this.secretExpandedChange.emit(true)
      }
    }, 500)
  }

  readonly onPointerUp = (): void => {
    if (this.#longPressTimer !== null) {
      clearTimeout(this.#longPressTimer)
      this.#longPressTimer = null
      this.#handleTap()
    }
  }

  readonly #handleTap = (): void => {
    if (!this.meshPublic) {
      // solo → shield: open the secret input
      this.#secretExpanded.set(true)
      this.meshToggled.emit()
      this.secretExpandedChange.emit(true)
    } else if (this.showSecretInput()) {
      if (this.hasSecret()) {
        // has secret: collapse input, show "secured"
        this.#secretExpanded.set(false)
        this.secretExpandedChange.emit(false)
      } else {
        // no secret: go back to solo
        this.#secretExpanded.set(false)
        this.meshToggled.emit()
        this.secretExpandedChange.emit(false)
      }
    } else {
      // secured (collapsed) → back to solo, clear secret
      this.clearSecret()
      this.meshToggled.emit()
      this.secretExpandedChange.emit(false)
    }
  }

  readonly expandSecret = (): void => {
    this.#secretExpanded.set(true)
    this.secretExpandedChange.emit(true)
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
    if (value.length > 0) {
      this.#secretExpanded.set(false)
      this.secretExpandedChange.emit(false)
    }
  }

  readonly clearSecret = (): void => {
    this.#secretValue.set('')
    this.#store?.set('')
    EffectBus.emit('mesh:secret', { secret: '' })
  }
}
