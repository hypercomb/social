// shortcut-sheet.component.ts — Angular shell for the /help reference overlay.
//
// Subscribes to ShortcutSheetDrone state and renders three auto-generated
// sections (slash commands, command-line operations, keyboard shortcuts) with
// a shared filter input. No business logic — the drone owns the data.

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
import { EffectBus, formatChord, type KeyBinding } from '@hypercomb/core'
import { fromRuntime } from '../../core/from-runtime'
import { TranslatePipe } from '../../core/i18n.pipe'

import type {
  CommandLineOperationEntry,
  ShortcutGroup,
  ShortcutSheetState,
  SlashCommandEntry,
} from '@hypercomb/essentials/diamondcoreprocessor.com/commands/shortcut-sheet.drone'

@Component({
  selector: 'hc-shortcut-sheet',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './shortcut-sheet.component.html',
  styleUrls: ['./shortcut-sheet.component.scss'],
})
export class ShortcutSheetComponent implements OnInit, OnDestroy {

  #drone: any
  #unsub: (() => void) | null = null

  private readonly state$ = fromRuntime(
    get('@diamondcoreprocessor.com/ShortcutSheetDrone') as EventTarget,
    () =>
      (this.#drone?.state ?? {
        open: false,
        slashCommands: [],
        commandLineOps: [],
        shortcutGroups: [],
      }) as ShortcutSheetState,
  )

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

  readonly formatSequence = (binding: KeyBinding): string[][] => {
    return binding.sequence.map(chord => formatChord(chord))
  }

  constructor() {
    effect(() => {
      if (this.open()) {
        this.query.set('')
        queueMicrotask(() => this.filterInput()?.nativeElement.focus())
      }
    })
  }

  ngOnInit(): void {
    this.#drone = get('@diamondcoreprocessor.com/ShortcutSheetDrone')

    this.#unsub = EffectBus.on<{ cmd: string }>('keymap:invoke', (payload) => {
      if (payload?.cmd === 'global.escape' && this.open()) this.close()
    })
  }

  ngOnDestroy(): void {
    this.#drone = undefined
    this.#unsub?.()
  }
}
