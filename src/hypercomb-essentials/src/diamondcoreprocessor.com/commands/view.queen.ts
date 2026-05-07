// diamondcoreprocessor.com/commands/view.queen.ts

import { QueenBee } from '@hypercomb/core'

/**
 * /view — toggle the active rendering surface.
 *
 * Mutually exclusive surfaces (hexagons, website, future modes) all read
 * the same merkle layer tree but render differently. The mode is a flag
 * on ViewModeService — in-memory for fast filter checks, localStorage so
 * it survives reload.
 *
 * Syntax:
 *   /view              — toggle hexagons ⇄ website
 *   /view website      — switch to website mode
 *   /view hex          — switch to hexagons
 *   /view <name>       — set to any mode name (kanban, timeline, etc.)
 *
 * Per-node workers gate on the active mode: hexagon-rendering drones
 * idle when mode !== 'hexagons'; website renderers activate when
 * mode === 'website'. New surfaces compose by adding more renderers.
 *
 * Note: there's an existing /website queen that stamps website sigs onto
 * cells (the publish-this-subtree workflow). Kept separate for now —
 * /view is purely the rendering-surface switch.
 */

type ViewModeServiceShape = EventTarget & {
  mode: string
  setMode(next: string): void
  toggle(a?: string, b?: string): string
}

const VIEW_MODE_KEY = '@hypercomb.social/ViewMode'

export class ViewQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'view'
  override readonly aliases = ['mode', 'surface']
  override description = 'Toggle between hexagons and website rendering of the layer tree'
  override descriptionKey = 'slash.view'

  override slashComplete(args: string): readonly string[] {
    const modes = ['hexagons', 'website', 'hex']
    const q = args.toLowerCase().trim()
    if (!q) return modes
    return modes.filter(m => m.startsWith(q))
  }

  protected execute(args: string): void {
    const svc = get(VIEW_MODE_KEY) as ViewModeServiceShape | undefined
    if (!svc) {
      console.warn('[/view] ViewModeService not available')
      return
    }

    const requested = args.trim().toLowerCase()

    if (!requested) {
      const next = svc.toggle('hexagons', 'website')
      console.log(`[/view] mode → ${next}`)
      return
    }

    const target = ALIASES[requested] ?? requested
    svc.setMode(target)
    console.log(`[/view] mode → ${target}`)
  }
}

const ALIASES: Record<string, string> = {
  'hex': 'hexagons',
  'hexagon': 'hexagons',
  'site': 'website',
  'page': 'website',
  'web': 'website',
  'on': 'website',
  'off': 'hexagons',
}

const _view = new ViewQueenBee()
window.ioc.register('@diamondcoreprocessor.com/ViewQueenBee', _view)
