// hypercomb-shared/ui/action-card/action-card.component.ts
//
// The ACTION study card — the contact-card interaction applied to behaviors.
// A true MOUSE-OVER card: hover a tile on the help launcher page and the
// panel peeks AT THE CURSOR with what the action does; CLICK THE TILE and the
// card PINS right there (HelpGroup routes the click to ActionCardDrone as
// `action:request-pin` → `action:hover-pin`). Pin several and drag them apart
// to compare and study. Composes PinnableHoverBase — ONE base, never
// re-rolled; this subclass only supplies the pointer anchor.
//
// The card is documentation, formatted like a reference entry: the action's
// name, its shortcut as key pills, its category, and what it's used for.
// Nothing else. Pins are page-scoped: they belong to the launcher page and
// re-show when you come back to it.

import { Component } from '@angular/core'
import { TranslatePipe } from '../../core/i18n.pipe'
import { PinnableHoverBase } from '../pinnable/pinnable-hover.base'

export interface ActionCardOp {
  trigger: string
  description: string
  example?: { input: string; result: string }
}

export interface ActionCardData {
  label: string
  cmd: string
  kind: 'key' | 'slash' | 'cli'
  steps: string[][]
  category: string
  description: string
  usage?: string
  params?: string[]
  aliases?: string[]
  examples?: { input: string; result: string }[]
  ops?: ActionCardOp[]
}

/** Offset from the cursor so the pointer can travel INTO the card without
 *  sitting on its corner (which would fight the canvas hover underneath). */
const CURSOR_GAP = { x: 18, y: 14 }

@Component({
  selector: 'hc-action-card',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './action-card.component.html',
  styleUrls: ['./action-card.component.scss'],
})
export class ActionCardComponent extends PinnableHoverBase<ActionCardData> {

  protected get ns(): string { return 'action' }
  protected get posKey(): string { return 'hc:action-card-pins-pos' }
  protected override get panelWidth(): number { return 300 }
  // Study cards belong to the launcher page they were pinned on: hide on
  // navigate-away, re-show on return. Transient otherwise — no refresh
  // persistence; a study session is a session.
  protected override get pageScoped(): boolean { return true }

  /** Last pointer position — the anchor that makes this a mouse-over card. */
  #mouse = { x: 24, y: 96 }
  #onMove = (e: PointerEvent): void => { this.#mouse = { x: e.clientX, y: e.clientY } }

  override ngOnInit(): void {
    super.ngOnInit()
    document.addEventListener('pointermove', this.#onMove, { passive: true })
  }

  override ngOnDestroy(): void {
    document.removeEventListener('pointermove', this.#onMove)
    super.ngOnDestroy()
  }

  /** New peeks and fresh pins land beside the cursor, not at the dock. */
  protected override anchorPos(): { x: number; y: number } {
    return { x: this.#mouse.x + CURSOR_GAP.x, y: this.#mouse.y + CURSOR_GAP.y }
  }

  protected override currentPageKey(): string {
    const lineage = (window as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.('@hypercomb.social/Lineage') as { explorerSegments?: () => readonly string[] } | undefined
    return (lineage?.explorerSegments?.() ?? []).map(s => String(s ?? '').trim()).filter(Boolean).join('/')
  }

  protected toPanel(payload: unknown): { key: string; data: ActionCardData } | null {
    const p = payload as Partial<ActionCardData> | undefined
    if (!p?.cmd || !p.label) return null
    return {
      key: p.cmd,
      data: {
        label: p.label,
        cmd: p.cmd,
        kind: p.kind === 'slash' || p.kind === 'cli' ? p.kind : 'key',
        steps: Array.isArray(p.steps) ? p.steps.map(s => (Array.isArray(s) ? s.map(String) : [])) : [],
        category: typeof p.category === 'string' ? p.category : '',
        description: typeof p.description === 'string' ? p.description : '',
        usage: typeof p.usage === 'string' && p.usage ? p.usage : undefined,
        params: Array.isArray(p.params) && p.params.length ? p.params.map(String) : undefined,
        aliases: Array.isArray(p.aliases) && p.aliases.length ? p.aliases.map(String) : undefined,
        examples: Array.isArray(p.examples) && p.examples.length
          ? p.examples
              .filter(e => e && typeof e.input === 'string' && typeof e.result === 'string')
              .map(e => ({ input: e.input, result: e.result }))
          : undefined,
        ops: Array.isArray(p.ops) && p.ops.length
          ? p.ops.map(o => ({
              trigger: String(o?.trigger ?? ''),
              description: String(o?.description ?? ''),
              example: o?.example && typeof o.example.input === 'string' && typeof o.example.result === 'string'
                ? { input: o.example.input, result: o.example.result }
                : undefined,
            }))
          : undefined,
      },
    }
  }
}
