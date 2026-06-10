import { Component, EventEmitter, Input, Output, computed, signal, type OnInit, type OnDestroy } from '@angular/core'
import { EffectBus } from '@hypercomb/core'
import { fromRuntime } from '../../core/from-runtime'
import type { SecretStore } from '../../core/secret-store'
import type { SecretStrengthProvider } from '../../core/secret-strength'

@Component({
  selector: 'hc-mesh-header',
  standalone: true,
  imports: [],
  templateUrl: './mesh-header.component.html',
  styleUrls: ['./mesh-header.component.scss'],
})
export class MeshHeaderComponent implements OnInit, OnDestroy {

  @Input() meshPublic: boolean | null = false
  @Output() readonly meshToggled = new EventEmitter<void>()

  #secret$ = fromRuntime(
    get('@hypercomb.social/SecretStore') as EventTarget | undefined,
    () => (get('@hypercomb.social/SecretStore') as SecretStore | undefined)?.value ?? '',
  )

  // While the mesh-modal is editing, it broadcasts the draft so the header
  // shield can preview the strength in real time. Null = no active draft;
  // header falls back to the persisted store value.
  readonly #draft = signal<string | null>(null)
  #unsubDraft: (() => void) | null = null

  readonly shieldColor = computed(() => {
    const draft = this.#draft()
    const secret = (draft !== null ? draft : this.#secret$()).trim()
    if (!secret) return 'rgba(245, 245, 245, 0.45)'
    const provider = get('@hypercomb.social/SecretStrengthProvider') as SecretStrengthProvider | undefined
    const score = provider?.evaluate(secret) ?? 0.5
    const hue = Math.round(score * 130)
    return `hsl(${hue}, 70%, 50%)`
  })

  ngOnInit(): void {
    this.#unsubDraft = EffectBus.on<{ secret: string | null }>('mesh:secret-draft', ({ secret }) => {
      this.#draft.set(secret)
    })
  }

  ngOnDestroy(): void {
    this.#unsubDraft?.()
  }

  readonly onToggle = (): void => {
    // Going PUBLIC routes through the location dialog (JOIN mode): the form
    // pops, you set where + secret, press START, and the join happens on
    // confirm via 'mesh:join' (the single listener in the controls-bar
    // performs the flip — one listener only, or the toggle would fire
    // twice). Going PRIVATE stays one click. Without this gate there is no
    // way to set the location — the bar's location icon was removed in
    // favor of this flow.
    if (!this.meshPublic) {
      EffectBus.emit('mesh:open-modal', { join: true })
      return
    }
    this.meshToggled.emit()
  }
}
