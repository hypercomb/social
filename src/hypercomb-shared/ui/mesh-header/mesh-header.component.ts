import { Component, EventEmitter, Input, Output, computed, signal, type OnInit, type OnDestroy, type OnChanges } from '@angular/core'
import { EffectBus } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'
import { fromRuntime } from '../../core/from-runtime'
import type { SecretStore } from '../../core/secret-store'
import type { SecretStrengthProvider } from '../../core/secret-strength'

@Component({
  selector: 'hc-mesh-header',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './mesh-header.component.html',
  styleUrls: ['./mesh-header.component.scss'],
})
export class MeshHeaderComponent implements OnInit, OnDestroy, OnChanges {

  @Input() meshPublic: boolean | null = false
  @Output() readonly meshToggled = new EventEmitter<void>()

  // World view (pick what to share) — an on/off toggle that lives beside the
  // solo/swarm icon and only appears in swarm mode. When on, the renderer dims
  // not-yet-shared tiles and the tile overlay shows the two share-toggle icons
  // (the actual dim + icon swap happen in the renderer/overlay drones, which
  // listen for 'world:mode'). The preference persists, but the *effective*
  // mode is gated on swarm: going solo forces it off (dimming unshared tiles is
  // meaningless solo) and re-entering swarm restores the preference — so the
  // hidden-in-solo button can never strand the canvas in a dimmed state.
  readonly #worldMode = signal(localStorage.getItem('hc:world-mode') === '1')
  readonly worldMode = this.#worldMode.asReadonly()

  #emitWorldMode(): void {
    EffectBus.emit('world:mode', { active: !!this.meshPublic && this.#worldMode() })
  }

  readonly toggleWorldMode = (): void => {
    const next = !this.#worldMode()
    this.#worldMode.set(next)
    localStorage.setItem('hc:world-mode', next ? '1' : '0')
    this.#emitWorldMode()
  }

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
    // Publish the initial effective world mode so the renderer/overlay drones
    // pick it up (solo boot → off, regardless of the persisted preference).
    this.#emitWorldMode()
  }

  ngOnChanges(): void {
    // meshPublic flipped solo↔swarm — re-evaluate the effective world mode so
    // leaving the swarm drops the dim and returning restores it.
    this.#emitWorldMode()
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
