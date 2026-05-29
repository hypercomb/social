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
      this.secretVisible.set(false)
      this.open.set(true)
      EffectBus.emit('mesh:modal-open', { open: true })
      EffectBus.emit('mesh:secret-draft', { secret: initialSecret })
      // setTimeout(0), not queueMicrotask: Angular renders the @if panel
      // in a later microtask after change detection, so a microtask-scheduled
      // querySelector misses the input and focus stays wherever it was
      // (usually the command-line shell, which then eats Enter).
      setTimeout(() => {
        document.querySelector<HTMLInputElement>('.mesh-modal-room')?.focus()
      }, 0)
    })

    this.#unsubEscape = EffectBus.on<{ cmd: string }>('keymap:invoke', (payload) => {
      if (payload?.cmd === 'global.escape' && this.open()) this.dismiss()
    })

    this.#onWindowKeyDown = (e: KeyboardEvent): void => {
      if (!this.open() || e.key !== 'Enter') return
      e.preventDefault()
      // Enter always saves while the modal is open — unless the Cancel
      // button itself is the focused element, in which case Enter
      // dismisses (matching the visible focus ring).
      const active = document.activeElement as HTMLElement | null
      const cancelFocused = !!active?.closest?.('.mesh-modal-panel .mesh-modal-btn.cancel')
      if (cancelFocused) this.dismiss()
      else this.save()
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
    this.#roomStore?.set(room)
    this.#secretStore?.set(secret)
    EffectBus.emit('mesh:room', { room })
    EffectBus.emit('mesh:secret', { secret })
    if (room) this.#savedStore?.add(room)
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
