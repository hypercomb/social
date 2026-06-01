// hypercomb-shared/ui/mesh-modal/mesh-modal.component.ts
// Centered modal for editing the mesh location and secret in one place.
// Listens for 'mesh:open-modal' to open, broadcasts 'mesh:modal-open'
// while open so the controls-bar can highlight the trigger.

import { Component, signal, computed, type OnInit, type OnDestroy } from '@angular/core'
import { EffectBus } from '@hypercomb/core'
import { fromRuntime } from '../../core/from-runtime'
import { TranslatePipe } from '../../core/i18n.pipe'
import type { RoomStore } from '../../core/room-store'
import type { SecretStore } from '../../core/secret-store'
import type { SecretStrengthProvider } from '../../core/secret-strength'
import type { SavedLocationsStore } from '../../core/saved-locations-store'

@Component({
  selector: 'hc-mesh-modal',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './mesh-modal.component.html',
  styleUrls: ['./mesh-modal.component.scss'],
})
export class MeshModalComponent implements OnInit, OnDestroy {

  #unsubOpen: (() => void) | null = null
  #unsubEscape: (() => void) | null = null
  #onWindowKeyDown: ((e: KeyboardEvent) => void) | null = null

  readonly open = signal(false)
  readonly roomDraft = signal('')
  readonly secretDraft = signal('')
  readonly labelDraft = signal('')
  readonly secretVisible = signal(false)

  readonly savedLocations = fromRuntime(
    get('@hypercomb.social/SavedLocationsStore') as EventTarget | undefined,
    () => this.#savedStore?.value ?? [],
  )

  readonly secretInputType = computed(() => this.secretVisible() ? 'text' : 'password')

  readonly shieldColor = computed(() => {
    const secret = this.secretDraft().trim()
    if (!secret) return 'rgba(245, 245, 245, 0.45)'
    const provider = get('@hypercomb.social/SecretStrengthProvider') as SecretStrengthProvider | undefined
    const score = provider?.evaluate(secret) ?? 0.5
    const hue = Math.round(score * 130)
    return `hsl(${hue}, 70%, 50%)`
  })

  get #roomStore(): RoomStore | undefined {
    return get('@hypercomb.social/RoomStore') as RoomStore | undefined
  }
  get #secretStore(): SecretStore | undefined {
    return get('@hypercomb.social/SecretStore') as SecretStore | undefined
  }
  get #savedStore(): SavedLocationsStore | undefined {
    return get('@hypercomb.social/SavedLocationsStore') as SavedLocationsStore | undefined
  }

  ngOnInit(): void {
    this.#unsubOpen = EffectBus.on('mesh:open-modal', () => {
      const initialSecret = this.#secretStore?.value ?? ''
      this.roomDraft.set(this.#roomStore?.value ?? '')
      this.secretDraft.set(initialSecret)
      this.labelDraft.set(this.#readMyLabel())
      this.secretVisible.set(false)
      this.open.set(true)
      EffectBus.emit('mesh:modal-open', { open: true })
      EffectBus.emit('mesh:secret-draft', { secret: initialSecret })
      queueMicrotask(() => {
        document.querySelector<HTMLInputElement>('.mesh-modal-room')?.focus()
      })
    })

    this.#unsubEscape = EffectBus.on<{ cmd: string }>('keymap:invoke', (payload) => {
      if (payload?.cmd === 'global.escape' && this.open()) this.dismiss()
    })

    this.#onWindowKeyDown = (e: KeyboardEvent): void => {
      if (!this.open() || e.key !== 'Enter') return
      const active = document.activeElement as HTMLElement | null
      if (active?.tagName === 'BUTTON' && active.closest('.mesh-modal-panel')) return
      e.preventDefault()
      this.save()
    }
    window.addEventListener('keydown', this.#onWindowKeyDown)
  }

  ngOnDestroy(): void {
    this.#unsubOpen?.()
    this.#unsubEscape?.()
    if (this.#onWindowKeyDown) window.removeEventListener('keydown', this.#onWindowKeyDown)
  }

  readonly onRoomInput = (event: Event): void => {
    this.roomDraft.set((event.target as HTMLInputElement).value)
  }

  readonly onSecretInput = (event: Event): void => {
    const value = (event.target as HTMLInputElement).value
    this.secretDraft.set(value)
    EffectBus.emit('mesh:secret-draft', { secret: value })
  }

  readonly onLabelInput = (event: Event): void => {
    this.labelDraft.set((event.target as HTMLInputElement).value)
  }

  /** Read the persisted swarm label, preferring the SwarmDrone's
   *  canonical accessor when present so any future-tightened
   *  sanitization (length cap, control-char filter) applies. Falls
   *  back to localStorage when the drone hasn't loaded yet — the
   *  modal can still surface and save without a hard swarm
   *  dependency. */
  #readMyLabel = (): string => {
    interface SwarmLabelApi { myLabel: () => string }
    const swarm = get('@diamondcoreprocessor.com/SwarmDrone') as SwarmLabelApi | undefined
    if (swarm?.myLabel) return swarm.myLabel()
    try { return String(localStorage.getItem('hc:user-label') ?? '').trim().slice(0, 64) }
    catch { return '' }
  }

  readonly toggleSecretVisible = (): void => {
    this.secretVisible.set(!this.secretVisible())
  }

  readonly pickLocation = (name: string): void => {
    this.roomDraft.set(name)
  }

  readonly removeSaved = (event: Event, name: string): void => {
    event.stopPropagation()
    this.#savedStore?.remove(name)
  }

  readonly save = (): void => {
    const room = this.roomDraft().trim()
    const secret = this.secretDraft().trim()
    const label = this.labelDraft().trim().slice(0, 64)
    this.#roomStore?.set(room)
    this.#secretStore?.set(secret)
    EffectBus.emit('mesh:room', { room })
    EffectBus.emit('mesh:secret', { secret })
    if (room) this.#savedStore?.add(room)

    // Label routes through swarm.setMyLabel when available — it
    // clears the publish memo + triggers re-sync so the new label
    // propagates immediately. localStorage fallback covers the case
    // where the swarm bee hasn't loaded yet.
    interface SwarmLabelApi { setMyLabel: (s: string) => void }
    const swarm = get('@diamondcoreprocessor.com/SwarmDrone') as SwarmLabelApi | undefined
    if (swarm?.setMyLabel) {
      swarm.setMyLabel(label)
    } else {
      try { localStorage.setItem('hc:user-label', label) } catch { /* ignore */ }
    }

    this.#close()
  }

  readonly dismiss = (): void => {
    this.#close()
  }

  #close = (): void => {
    this.open.set(false)
    EffectBus.emit('mesh:modal-open', { open: false })
    EffectBus.emit('mesh:secret-draft', { secret: null })
  }
}
