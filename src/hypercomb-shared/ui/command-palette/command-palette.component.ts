// command-palette.component.ts — Angular shell for the command palette
//
// Subscribes to CommandPaletteDrone state and renders the palette UI.
// Forwards input changes and keyboard navigation back to the drone
// via EffectBus effects. No business logic lives here.
//
// BOUND WHEN THE DRONE ARRIVES (as toast.component.ts): on the web shell the
// drone loads with the bees, after this surface is built, so a lookup made
// once at construction found nothing and the palette never opened on
// hypercomb.io (found 2026-10-23).

import { registerShellSurface } from '@hypercomb/runtime/shell-surface-registry'
import {
  Component,
  computed,
  effect,
  signal,
  ElementRef,
  ViewChild,
  type OnDestroy,
} from '@angular/core'
import { EffectBus, formatChord, type KeyBinding } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'
import { HcWidgetDirective } from '../widget-zoom/hc-widget.directive'

import type { CommandPaletteState, PaletteItem } from
  '@hypercomb/essentials/commands/command-palette.drone'

// Owner token for the InputGate lock held while the palette is open. Owner-
// scoped so it composes with locks held by the editor / other overlays.
const COMMAND_PALETTE_LOCK_OWNER = 'command-palette'
const COMMAND_PALETTE_DRONE_KEY = '@diamondcoreprocessor.com/CommandPaletteDrone'
const CLOSED: CommandPaletteState = { open: false, query: '', activeIndex: 0, groups: [], totalCount: 0 } as CommandPaletteState

/** Structural type for the InputGate — the shared tile-input lock. Resolved
 *  at runtime via window.ioc (shared must never import from modules). */
type InputGateLike = {
  lock(owner?: string): void
  unlock(owner?: string): void
}

@Component({
  selector: 'hc-command-palette',
  standalone: true,
  imports: [TranslatePipe, HcWidgetDirective],
  templateUrl: './command-palette.component.html',
  styleUrls: ['./command-palette.component.scss'],
})
export class CommandPaletteComponent implements OnDestroy {

  @ViewChild('paletteInput') paletteInput!: ElementRef<HTMLInputElement>

  #drone: any
  #release: (() => void) | undefined
  #destroyed = false

  private readonly state$ = signal<CommandPaletteState>(CLOSED)

  readonly open = computed(() => this.state$().open)
  readonly groups = computed(() => this.state$().groups)
  readonly activeIndex = computed(() => this.state$().activeIndex)
  readonly totalCount = computed(() => this.state$().totalCount)

  constructor() {
    // Freeze tile navigation while the palette is open — it's a centred modal
    // over the canvas, so per the "modals lock tiles while showing" rule no
    // pan/pinch/wheel-zoom/drag-select may bleed through. open() (derived from
    // drone state) is the tracked dependency; the gate is resolved lazily (its
    // bee may register after this component constructs on hypercomb-web). The
    // [data-consumes-wheel] panel keeps the results list scrollable.
    effect(() => {
      const gate = this.#gate()
      if (!gate) return
      if (this.open()) gate.lock(COMMAND_PALETTE_LOCK_OWNER)
      else gate.unlock(COMMAND_PALETTE_LOCK_OWNER)
    })
    // The input takes the keyboard as the palette opens — once it has
    // rendered (as the shortcut sheet's filter does; the old after-view-
    // checked hook never focused it, on either shell).
    effect(() => {
      if (!this.open()) return
      const focus = (): void => { if (!this.#destroyed) this.paletteInput?.nativeElement?.focus() }
      setTimeout(focus, 0)
      requestAnimationFrame(focus)
    })
    window.ioc.whenReady<EventTarget>(COMMAND_PALETTE_DRONE_KEY, drone => this.#attach(drone))
  }

  #attach(drone: EventTarget): void {
    if (this.#destroyed || !drone?.addEventListener || this.#drone) return
    this.#drone = drone
    const read = (): void => this.state$.set((this.#drone?.state ?? CLOSED) as CommandPaletteState)
    // A microtask, as fromRuntime does: never inside a change-detection pass.
    const onChange = (): void => queueMicrotask(read)
    drone.addEventListener('change', onChange)
    this.#release = () => drone.removeEventListener('change', onChange)
    read()
  }

  readonly close = (): void => {
    EffectBus.emit('command-palette:close', undefined)
  }

  readonly onInput = (event: Event): void => {
    const value = (event.target as HTMLInputElement).value
    EffectBus.emit('command-palette:input', { query: value })
  }

  readonly onKeyDown = (event: KeyboardEvent): void => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        EffectBus.emit('command-palette:nav', { direction: 'down' })
        break
      case 'ArrowUp':
        event.preventDefault()
        EffectBus.emit('command-palette:nav', { direction: 'up' })
        break
      case 'Enter':
        event.preventDefault()
        EffectBus.emit('command-palette:execute', undefined)
        break
      case 'Escape':
        event.preventDefault()
        this.close()
        break
    }
  }

  readonly executeAt = (index: number, event: MouseEvent): void => {
    event.preventDefault()
    EffectBus.emit('command-palette:execute-at', { index })
  }

  readonly setActive = (index: number): void => {
    // update active via nav to keep drone in sync
    // direct set via effect
    EffectBus.emit('command-palette:nav', { direction: 'set', index })
  }

  readonly formatShortcut = (binding: KeyBinding | null): string[][] => {
    if (!binding?.sequence?.length) return []
    return binding.sequence.map(chord => formatChord(chord))
  }

  readonly highlightLabel = (item: PaletteItem): { text: string; highlighted: boolean }[] => {
    if (!item.matchIndices.length) return [{ text: item.label, highlighted: false }]

    const indices = new Set(item.matchIndices)
    const parts: { text: string; highlighted: boolean }[] = []
    let current = ''
    let currentHighlighted = false

    for (let i = 0; i < item.label.length; i++) {
      const isHighlighted = indices.has(i)
      if (i === 0) {
        currentHighlighted = isHighlighted
        current = item.label[i]
      } else if (isHighlighted === currentHighlighted) {
        current += item.label[i]
      } else {
        parts.push({ text: current, highlighted: currentHighlighted })
        current = item.label[i]
        currentHighlighted = isHighlighted
      }
    }
    if (current) parts.push({ text: current, highlighted: currentHighlighted })
    return parts
  }

  ngOnDestroy(): void {
    this.#destroyed = true
    this.#release?.()
    this.#drone = undefined
    // Release on teardown — the visibility effect won't run a final unlock
    // once destroyed, so a palette torn down while open would leave the hexes
    // locked.
    this.#gate()?.unlock(COMMAND_PALETTE_LOCK_OWNER)
  }

  /** InputGate — the shared tile-input lock. Resolved at runtime (shared
   *  must never import from modules); undefined until its bee registers. */
  #gate(): InputGateLike | undefined {
    return window.ioc?.get<InputGateLike>('@diamondcoreprocessor.com/InputGate')
  }
}

// Registry-fed shell surface — mounted by <hc-shell-surfaces>, never by an
// app.html tag (see shell-surface-registry.ts).
registerShellSurface({
  name: 'hc-command-palette',
  owner: '@hypercomb.shared/CommandPaletteComponent',
  component: CommandPaletteComponent,
  order: 370,
})
