// hypercomb-shared/ui/mesh-modal/mesh-modal.component.ts
// Centered modal for editing the mesh location and secret in one place.
// Listens for 'mesh:open-modal' to open, broadcasts 'mesh:modal-open'
// while open so the controls-bar can highlight the trigger.

import { registerShellSurface } from '../../core/shell-surface-registry'
import { Component, signal, computed, type OnInit, type OnDestroy } from '@angular/core'
import { EffectBus } from '@hypercomb/core'
import { fromRuntime } from '../../core/from-runtime'
import { TranslatePipe } from '../../core/i18n.pipe'
import { HcWidgetDirective } from '../widget-zoom/hc-widget.directive'
import type { RoomStore } from '../../core/room-store'
import type { SecretStore } from '../../core/secret-store'
import type { SecretStrengthProvider } from '../../core/secret-strength'
import type { SavedLocationsStore } from '../../core/saved-locations-store'
import { encodeAddress } from '../../core/address-record'

const SELF_DOMAIN_KEY = 'hc:nostrmesh:self-domain'

/** Normalize a host string the same way the rest of the codebase does:
 *  strip protocol prefix, trailing slashes, lowercase. Keeps localStorage
 *  in the canonical bare-host form. */
function normalizeHost(raw: string): string {
  return String(raw ?? '')
    .trim()
    .replace(/^wss?:\/\//i, '')
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '')
    .toLowerCase()
}

@Component({
  selector: 'hc-mesh-modal',
  standalone: true,
  imports: [TranslatePipe, HcWidgetDirective],
  templateUrl: './mesh-modal.component.html',
  styleUrls: ['./mesh-modal.component.scss'],
})
export class MeshModalComponent implements OnInit, OnDestroy {

  #unsubOpen: (() => void) | null = null
  #unsubEscape: (() => void) | null = null
  #onWindowKeyDown: ((e: KeyboardEvent) => void) | null = null

  readonly open = signal(false)
  /** JOIN mode: opened from the solo→public flip. The primary button reads
   *  "start" and confirming also joins the swarm (emits 'mesh:join'). */
  readonly joinMode = signal(false)
  readonly roomDraft = signal('')
  readonly secretDraft = signal('')
  readonly labelDraft = signal('')
  readonly hostDraft = signal('')
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
  #readHost = (): string => {
    try { return normalizeHost(localStorage.getItem(SELF_DOMAIN_KEY) ?? '') }
    catch { return '' }
  }
  #writeHost = (v: string): void => {
    try {
      const clean = normalizeHost(v)
      if (clean) localStorage.setItem(SELF_DOMAIN_KEY, clean)
      else localStorage.removeItem(SELF_DOMAIN_KEY)
    } catch { /* ignore */ }
  }

  ngOnInit(): void {
    this.#unsubOpen = EffectBus.on<{ join?: boolean }>('mesh:open-modal', (payload) => {
      this.joinMode.set(!!payload?.join)
      const initialSecret = this.#secretStore?.value ?? ''
      this.roomDraft.set(this.#roomStore?.value ?? '')
      this.secretDraft.set(initialSecret)
      this.labelDraft.set(this.#readMyLabel())
      this.hostDraft.set(this.#readHost())
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

  readonly onHostInput = (event: Event): void => {
    this.hostDraft.set((event.target as HTMLInputElement).value)
  }

  /** Compose the four draft fields into a share-link URL and copy it
   *  to the clipboard. Uses the navigator clipboard API; falls back
   *  silently if unavailable. The URL never contains the secret in
   *  the path or query — secret lives only in the hash fragment, which
   *  isn't sent to the server. */
  readonly copyShareLink = async (): Promise<void> => {
    try {
      const url = encodeAddress({
        alias:    this.labelDraft().trim() || undefined,
        host:     this.hostDraft().trim(),
        location: this.roomDraft().trim() || undefined,
        secret:   this.secretDraft().trim() || undefined,
      })
      await navigator.clipboard.writeText(url)
      this.copiedFlash.set(true)
      setTimeout(() => this.copiedFlash.set(false), 1500)
    } catch (e) {
      console.warn('[mesh-modal] copyShareLink failed:', e)
    }
  }

  readonly copiedFlash = signal(false)

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
    const host = this.hostDraft().trim()
    this.#roomStore?.set(room)
    this.#secretStore?.set(secret)
    // Host writes directly to localStorage — single canonical key, no
    // wrapper. Empty save doesn't unset it (the runtime bootstrap default
    // of window.location.origin stays), so we only write on non-empty.
    if (host) this.#writeHost(host)
    EffectBus.emit('mesh:room', { room })
    EffectBus.emit('mesh:secret', { secret })
    EffectBus.emit('mesh:host', { host: this.#readHost() })
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

    // JOIN mode: confirming the location IS the act of going public — the
    // controls-bar listens for 'mesh:join' and flips solo → swarm.
    if (this.joinMode()) EffectBus.emit('mesh:join', {})

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

// Registry-fed shell surface — mounted by <hc-shell-surfaces>, never by an
// app.html tag (see shell-surface-registry.ts).
registerShellSurface({
  name: 'hc-mesh-modal',
  owner: '@hypercomb.shared/MeshModalComponent',
  component: MeshModalComponent,
  order: 260,
})
