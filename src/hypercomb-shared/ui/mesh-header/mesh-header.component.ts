import { Component, computed, EventEmitter, Input, Output, signal } from '@angular/core'
import { EffectBus } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'
import type { SecretStore } from '../../core/secret-store'
import type { SecretStrengthProvider } from '../../core/secret-strength'
import { secretTag } from '../controls-bar/secret-words'

@Component({
  selector: 'hc-mesh-header',
  standalone: true,
  imports: [TranslatePipe],
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
  readonly showSecretInput = () => !!this.meshPublic && this.#secretExpanded()

  readonly secretWords = computed(() => {
    const secret = this.#secretValue().trim()
    return secret ? secretTag(secret) : ''
  })

  readonly shieldTooltip = computed(() => {
    if (!this.meshPublic) return ''
    return this.hasSecret() ? 'Public · SEC' : 'Public · unsecure'
  })

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
      // solo → shield (just show shield icon; secret input only via long-press)
      this.meshToggled.emit()
    } else if (this.showSecretInput()) {
      // shield tap while editing: save current value and collapse (same as Enter)
      this.#saveAndCollapse()
    } else {
      // shield collapsed (has secret) → toggle to solo (keep secret)
      this.meshToggled.emit()
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
    this.#saveAndCollapse()
  }

  readonly cancelSecret = (): void => {
    // Revert to last persisted value and collapse
    const stored = this.#store?.value ?? ''
    this.#secretValue.set(stored)
    this.#secretExpanded.set(false)
    this.secretExpandedChange.emit(false)
    if (!stored) {
      this.meshToggled.emit()
    }
  }

  readonly #saveAndCollapse = (): void => {
    const value = this.#secretValue().trim()
    if (value.length > 0 && value.length < 8) return
    this.#store?.set(value)
    EffectBus.emit('mesh:secret', { secret: value })
    if (value.length > 0) {
      this.#secretExpanded.set(false)
      this.secretExpandedChange.emit(false)
    } else {
      // No secret: go back to solo
      this.#secretExpanded.set(false)
      this.meshToggled.emit()
      this.secretExpandedChange.emit(false)
    }
  }

  readonly clearSecret = (): void => {
    this.#secretValue.set('')
    this.#store?.set('')
    EffectBus.emit('mesh:secret', { secret: '' })
  }
}
