// hypercomb-shared/ui/aliases-panel/aliases-panel.component.ts
//
// ALIASES — right-docked, `/aliases` opens it.
//
// One row per behaviour: its canonical name (fixed — the shared tongue never
// bends), the names the participant gave it, and — opened — the candidates
// on offer plus a field for a name of their own. Rows are an accordion, one
// open at a time: the open row is where the giving happens, the closed rows
// are the ledger read at a glance.
//
// Shell UI, so it must NOT import essentials. Everything arrives on
// `aliases:render` (AliasesDrone owns the ledger and the candidate
// inventory) and leaves as intents. Nothing here knows what a queen is.
//
// THE FILTER IS LOCAL — typed here, never round-tripped through the bus. The
// payload's `filter` is only a SEED: `/aliases present` opens the window
// already looking at that behaviour.

import { registerShellSurface } from '@hypercomb/runtime/shell-surface-registry'
import { Component, computed, signal, type OnDestroy } from '@angular/core'
import { EffectBus } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'
import { DockInsetDirective } from '../dock-inset/dock-inset.directive'
import { HcDockedPanelDirective } from '../docked-panel/hc-docked-panel.directive'
import { signalSession } from '../window-session'

interface AliasRow {
  command: string
  description: string
  given: string[]
  candidates: string[]
}

interface RefusedName {
  name: string
  reason: string
}

/** Mirrors AliasesRenderPayload in essentials/commands/aliases/aliases.drone.ts
 *  — shared cannot import essentials, so the shape is kept field-for-field by
 *  hand (the same arrangement the comfy panel has). */
interface AliasesPanelPayload {
  open?: boolean
  filter?: string
  rows?: AliasRow[]
  refusedFor?: string
  refused?: RefusedName[]
}

@Component({
  selector: 'hc-aliases-panel',
  standalone: true,
  imports: [TranslatePipe, DockInsetDirective, HcDockedPanelDirective],
  templateUrl: './aliases-panel.component.html',
  styleUrls: ['./aliases-panel.component.scss'],
})
export class AliasesPanelComponent implements OnDestroy {

  readonly visible = signal(false)

  /** Put away while the hive is covered, brought back on the way home —
   *  announced BOTH ways, because the drone holds the open state and a park
   *  it never learned about leaves `/aliases` toggling a window the screen
   *  already lost. Both far-side handlers are idempotent sets, not toggles. */
  readonly session = signalSession(
    this.visible,
    (open) => { EffectBus.emit(open ? 'aliases:reopen' : 'aliases:close', {}) },
    { close: () => this.close() },
  )

  readonly rows = signal<AliasRow[]>([])
  readonly refusedFor = signal('')
  readonly refused = signal<RefusedName[]>([])

  // ── local state ───────────────────────────────────────────────────────────
  readonly filter = signal('')
  /** The one expanded row — the accordion's single open section. */
  readonly openRow = signal('')

  readonly shown = computed(() => {
    const q = this.filter().trim().toLowerCase()
    const rows = this.rows()
    if (!q) return rows
    return rows.filter(row =>
      row.command.includes(q) || row.given.some(name => name.includes(q)))
  })

  #cleanups: (() => void)[] = []

  constructor() {
    this.#cleanups.push(EffectBus.on<AliasesPanelPayload>('aliases:render', (p) => this.#read(p)))
  }

  #read(p: AliasesPanelPayload): void {
    this.visible.set(!!p?.open)
    this.rows.set(Array.isArray(p?.rows) ? p.rows : [])
    this.refusedFor.set(String(p?.refusedFor ?? ''))
    this.refused.set(Array.isArray(p?.refused) ? p.refused : [])

    // `/aliases present` — the seed both filters and opens that row.
    const seed = String(p?.filter ?? '').trim().toLowerCase()
    if (seed) {
      this.filter.set(seed)
      if (this.rows().some(row => row.command === seed)) this.openRow.set(seed)
    }
  }

  ngOnDestroy(): void {
    for (const c of this.#cleanups) c()
    this.#cleanups = []
  }

  close(): void { EffectBus.emit('aliases:close', {}) }

  /** One open at a time; the open one closes on a second press. */
  toggleRow(command: string): void {
    this.openRow.set(this.openRow() === command ? '' : command)
  }

  setFilter(input: HTMLInputElement): void { this.filter.set(input.value) }

  // ── the giving ────────────────────────────────────────────────────────────

  #set(command: string, names: string[]): void {
    EffectBus.emit('aliases:set', { command, names })
  }

  add(row: AliasRow, name: string): void {
    const next = name.trim().toLowerCase()
    if (!next || row.given.includes(next)) return
    this.#set(row.command, [...row.given, next])
  }

  addTyped(row: AliasRow, input: HTMLInputElement): void {
    this.add(row, input.value)
    input.value = ''
  }

  remove(row: AliasRow, name: string): void {
    this.#set(row.command, row.given.filter(held => held !== name))
  }

  /** The refusal note under the row it belongs to, reason by reason. */
  refusalKey(reason: string): string { return `aliases.refused-${reason}` }
}

// Registry-fed shell surface — mounted by <hc-shell-surfaces>, never by an
// app.html tag (see shell-surface-registry.ts). 158 puts it just after the
// ComfyUI window (157): both are participant-preference windows off the
// command line.
registerShellSurface({
  name: 'hc-aliases-panel',
  owner: '@hypercomb.shared/AliasesPanelComponent',
  component: AliasesPanelComponent,
  order: 158,
})
