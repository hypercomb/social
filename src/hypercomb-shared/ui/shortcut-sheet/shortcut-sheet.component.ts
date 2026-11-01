// shortcut-sheet.component.ts — Angular shell for the /help reference overlay.
//
// Subscribes to ShortcutSheetDrone state and renders three auto-generated
// sections (slash commands, command-line operations, keyboard shortcuts) with
// a shared filter input. No business logic — the drone owns the data.
//
// BOUND WHEN THE DRONE ARRIVES (as toast.component.ts): on the web shell the
// drone loads with the bees, after this surface is built, so a lookup made
// once at construction found nothing and /help showed nothing on
// hypercomb.io (found 2026-10-23).

import { registerShellSurface } from '@hypercomb/runtime/shell-surface-registry'
import {
  Component,
  computed,
  effect,
  signal,
  viewChild,
  type ElementRef,
  type OnInit,
  type OnDestroy,
} from '@angular/core'
import { EffectBus } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'
import { HcWidgetDirective } from '../widget-zoom/hc-widget.directive'

import type {
  CommandLineOperationEntry,
  ShortcutGroup,
  ShortcutSheetState,
  SlashCommandEntry,
} from '@hypercomb/essentials/commands/shortcut-sheet.drone'

const SHORTCUT_SHEET_DRONE_KEY = '@diamondcoreprocessor.com/ShortcutSheetDrone'
const CLOSED = { open: false, slashCommands: [], commandLineOps: [], shortcutGroups: [] } as unknown as ShortcutSheetState

@Component({
  selector: 'hc-shortcut-sheet',
  standalone: true,
  imports: [TranslatePipe, HcWidgetDirective],
  templateUrl: './shortcut-sheet.component.html',
  styleUrls: ['./shortcut-sheet.component.scss'],
})
export class ShortcutSheetComponent implements OnInit, OnDestroy {

  #drone: any
  #release: (() => void) | undefined
  #destroyed = false
  #unsub: (() => void) | null = null

  private readonly state$ = signal<ShortcutSheetState>(CLOSED)

  readonly open = computed(() => this.state$().open)
  readonly query = signal('')

  readonly filterInput = viewChild<ElementRef<HTMLInputElement>>('filterInput')

  readonly slashCommands = computed<SlashCommandEntry[]>(() => {
    const q = this.query().toLowerCase().trim()
    const all = this.state$().slashCommands
    if (!q) return all
    return all.filter(e =>
      e.name.includes(q) ||
      e.aliases.some(a => a.includes(q)) ||
      e.description.toLowerCase().includes(q)
    )
  })

  readonly commandLineOps = computed<CommandLineOperationEntry[]>(() => {
    const q = this.query().toLowerCase().trim()
    const all = this.state$().commandLineOps
    if (!q) return all
    return all.filter(e =>
      e.behavior.toLowerCase().includes(q) ||
      e.trigger.toLowerCase().includes(q) ||
      e.description.toLowerCase().includes(q) ||
      (e.example?.input.toLowerCase().includes(q) ?? false)
    )
  })

  readonly shortcutGroups = computed<ShortcutGroup[]>(() => {
    const q = this.query().toLowerCase().trim()
    const all = this.state$().shortcutGroups
    if (!q) return all
    const filtered: ShortcutGroup[] = []
    for (const group of all) {
      const binds = group.bindings.filter(b =>
        (b.description ?? '').toLowerCase().includes(q) ||
        (b.cmd ?? '').toLowerCase().includes(q) ||
        group.category.toLowerCase().includes(q)
      )
      if (binds.length) filtered.push({ category: group.category, bindings: binds })
    }
    return filtered
  })

  readonly hasResults = computed(() =>
    this.slashCommands().length > 0 ||
    this.commandLineOps().length > 0 ||
    this.shortcutGroups().length > 0
  )

  readonly close = (): void => {
    EffectBus.emit('shortcut-sheet:close', undefined)
  }

  readonly onFilter = (e: Event): void => {
    this.query.set((e.target as HTMLInputElement).value)
  }

  /** The keys are a place of their own: a drawn keyboard, never a list here. */
  readonly openKeyboard = (): void => {
    this.close()
    EffectBus.emit('keyboard:open', {})
  }

  constructor() {
    effect(() => {
      if (this.open()) {
        this.query.set('')
        queueMicrotask(() => this.filterInput()?.nativeElement.focus())
      }
    })
    window.ioc.whenReady<EventTarget>(SHORTCUT_SHEET_DRONE_KEY, drone => this.#attach(drone))
  }

  #attach(drone: EventTarget): void {
    if (this.#destroyed || !drone?.addEventListener || this.#drone) return
    this.#drone = drone
    const read = (): void => this.state$.set((this.#drone?.state ?? CLOSED) as ShortcutSheetState)
    // A microtask, as fromRuntime does: never inside a change-detection pass.
    const onChange = (): void => queueMicrotask(read)
    drone.addEventListener('change', onChange)
    this.#release = () => drone.removeEventListener('change', onChange)
    read()
  }

  ngOnInit(): void {
    this.#unsub = EffectBus.on<{ cmd: string }>('keymap:invoke', (payload) => {
      if (payload?.cmd === 'global.escape' && this.open()) this.close()
    })
  }

  ngOnDestroy(): void {
    this.#destroyed = true
    this.#release?.()
    this.#drone = undefined
    this.#unsub?.()
  }
}

// Registry-fed shell surface — mounted by <hc-shell-surfaces>, never by an
// app.html tag (see shell-surface-registry.ts).
registerShellSurface({
  name: 'hc-shortcut-sheet',
  owner: '@hypercomb.shared/ShortcutSheetComponent',
  component: ShortcutSheetComponent,
  order: 300,
})
