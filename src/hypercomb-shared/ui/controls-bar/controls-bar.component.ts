// hypercomb-shared/ui/controls-bar/controls-bar.component.ts
// Floating contextual controls pill — minimal by default, mode-adaptive.

import {
  Component,
  computed,
  input,
  signal,
  type OnInit,
  type OnDestroy,
} from '@angular/core'
import { fromRuntime } from '../../core/from-runtime'
import type { Navigation } from '../../core/navigation'
import type { MovementService } from '../../core/movement.service'
import { EffectBus } from '@hypercomb/core'
import type { RoomStore } from '../../core/room-store'
@Component({
  selector: 'hc-controls-bar',
  standalone: true,
  templateUrl: './controls-bar.component.html',
  styleUrls: ['./controls-bar.component.scss'],
})
export class ControlsBarComponent implements OnInit, OnDestroy {

  // ── inputs ────────────────────────────────────────────────

  readonly meshPublic = input(false)

  // ── IoC resolution ──────────────────────────────────────

  private get navigation(): Navigation {
    return get('@hypercomb.social/Navigation') as Navigation
  }
  private get movement(): MovementService {
    return get('@hypercomb.social/MovementService') as MovementService
  }
  private get zoom(): any {
    return get('@diamondcoreprocessor.com/ZoomDrone')
  }
  private get pixiHost(): any {
    return get('@diamondcoreprocessor.com/PixiHostWorker')
  }
  private get roomStore(): RoomStore | undefined {
    return get('@hypercomb.social/RoomStore') as RoomStore | undefined
  }

  // ── reactive state ──────────────────────────────────────

  #moved$ = fromRuntime(
    get('@hypercomb.social/MovementService') as EventTarget,
    () => this.movement.moved,
  )

  #idle = signal(false)
  #hovered = signal(false)
  #locked = signal(false)
  #utility = signal(localStorage.getItem('hc:utility-expanded') !== 'false')
  #mode = signal<'browsing' | 'clipboard'>('browsing')
  #clipboardItems = signal<string[]>([])
  #roomValue = signal('')
  #roomOpen = signal(false)
  #idleTimer: ReturnType<typeof setTimeout> | null = null
  readonly #IDLE_DELAY = 3000

  // ── computed ────────────────────────────────────────────

  readonly path = computed(() => {
    this.#moved$()
    return this.navigation.segmentsRaw().join(' / ')
  })

  readonly hasPath = computed(() => this.path().length > 0)

  readonly canGoBack = computed(() => {
    this.#moved$()
    return this.navigation.segmentsRaw().length > 0
  })

  readonly locked = this.#locked.asReadonly()
  readonly utility = this.#utility.asReadonly()
  readonly mode = this.#mode.asReadonly()
  readonly clipboardItems = this.#clipboardItems.asReadonly()
  readonly clipboardCount = computed(() => this.#clipboardItems().length)
  readonly visible = computed(() => !this.#idle() || this.#hovered())
  readonly roomValue = this.#roomValue.asReadonly()
  readonly roomOpen = this.#roomOpen.asReadonly()

  // ── lifecycle ───────────────────────────────────────────

  ngOnInit(): void {
    // pre-fill room from store
    const stored = this.roomStore?.value ?? ''
    if (stored) this.#roomValue.set(stored)

    window.addEventListener('pointermove', this.#onActivity)
    window.addEventListener('pointerdown', this.#onActivity)
    window.addEventListener('keydown', this.#onActivity)
    window.addEventListener('navigate', this.#onActivity)
    this.#resetIdleTimer()
  }

  ngOnDestroy(): void {
    window.removeEventListener('pointermove', this.#onActivity)
    window.removeEventListener('pointerdown', this.#onActivity)
    window.removeEventListener('keydown', this.#onActivity)
    window.removeEventListener('navigate', this.#onActivity)
    if (this.#idleTimer) clearTimeout(this.#idleTimer)
  }

  // ── navigation actions ────────────────────────────────

  readonly goBack = (): void => {
    void this.movement.back()
  }

  // ── view actions ──────────────────────────────────────

  readonly centerView = (): void => {
    const container = this.pixiHost?.container
    if (container) container.position.set(0, 0)
  }

  readonly toggleLock = (): void => {
    this.#locked.update(v => !v)
  }

  readonly zoomIn = (): void => {
    const center = this.#viewportCenter()
    this.zoom?.zoomByFactor?.(1.25, center, 'controls-bar')
    this.zoom?.end?.('controls-bar')
  }

  readonly zoomOut = (): void => {
    const center = this.#viewportCenter()
    this.zoom?.zoomByFactor?.(0.8, center, 'controls-bar')
    this.zoom?.end?.('controls-bar')
  }

  readonly toggleFullscreen = (): void => {
    if (document.fullscreenElement) {
      void document.exitFullscreen()
    } else {
      void document.documentElement.requestFullscreen()
    }
  }

  // ── utility mode ──────────────────────────────────────

  readonly toggleUtility = (): void => {
    this.#utility.update(v => !v)
    localStorage.setItem('hc:utility-expanded', String(this.#utility()))
    if (!this.#utility()) {
      this.#mode.set('browsing')
    }
  }

  // ── utility actions (emit effects for drones) ─────────

  readonly cut = (): void => {
    EffectBus.emit('controls:action', { action: 'cut' })
  }

  readonly copy = (): void => {
    EffectBus.emit('controls:action', { action: 'copy' })
  }

  readonly remove = (): void => {
    EffectBus.emit('controls:action', { action: 'remove' })
  }

  readonly moveItem = (): void => {
    EffectBus.emit('controls:action', { action: 'move' })
  }

  readonly openClipboard = (): void => {
    this.#mode.set('clipboard')
  }

  readonly closeClipboard = (): void => {
    this.#mode.set('browsing')
  }

  readonly clearClipboard = (): void => {
    this.#clipboardItems.set([])
    this.#mode.set('browsing')
  }

  // ── room ────────────────────────────────────────────

  readonly toggleRoom = (): void => {
    this.#roomOpen.update(v => !v)
    if (this.#roomOpen()) {
      const stored = this.roomStore?.value ?? ''
      if (stored) this.#roomValue.set(stored)
      queueMicrotask(() => {
        document.querySelector<HTMLInputElement>('.room-input')?.focus()
      })
    }
  }

  readonly onRoomInput = (event: Event): void => {
    this.#roomValue.set((event.target as HTMLInputElement).value)
  }

  readonly submitRoom = (): void => {
    const value = this.#roomValue().trim()
    if (!value) return
    this.roomStore?.set(value)
    EffectBus.emit('mesh:room', { room: value })
    this.#roomOpen.set(false)
  }
  // ── hover / idle ──────────────────────────────────────

  readonly onBarEnter = (): void => { this.#hovered.set(true) }
  readonly onBarLeave = (): void => { this.#hovered.set(false) }

  // ── internal ────────────────────────────────────────────

  #viewportCenter = (): { x: number; y: number } => ({
    x: window.innerWidth / 2,
    y: window.innerHeight / 2,
  })

  #onActivity = (): void => {
    this.#idle.set(false)
    this.#resetIdleTimer()
  }

  #resetIdleTimer = (): void => {
    if (this.#idleTimer) clearTimeout(this.#idleTimer)
    this.#idleTimer = setTimeout(() => this.#idle.set(true), this.#IDLE_DELAY)
  }
}
