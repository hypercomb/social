// diamondcoreprocessor.com/commands/context.queen.ts
//
// `/context` — open the CONTEXT WINDOW: the branches a tile's AI requests are
// allowed to read.
//
// Syntax:
//   /context            — the page you are standing on
//   /context <cell>     — a tile here
//
// Context is ATTACHED by dragging a portal onto a tile, which is a fast gesture
// with a lasting consequence. This is the way back to it: see what is attached,
// see how much each branch actually resolves to, and take one back off.
//
// The window itself is shell UI (hypercomb-shared/ui/context-window) — it owns
// the resolving and the detaching through `@diamondcoreprocessor.com/TileContext`.
// This queen is only the door, which is why it does no reading of its own: a
// command that pre-checked "does this tile have context" would answer from the
// decoration index at the instant it was typed and then open a window that
// re-resolves anyway, so the two could disagree about an empty list.

import { QueenBee, EffectBus } from '@hypercomb/core'

const get = <T,>(key: string): T | undefined =>
  (window as { ioc?: { get?: <U>(k: string) => U | undefined } }).ioc?.get?.<T>(key)

const BACKSLASH = String.fromCharCode(92)

/** Names become path segments — the same guard every writer here uses. */
const safeName = (raw: string): string =>
  [...raw].filter(ch => ch !== '/' && ch !== BACKSLASH && ch.charCodeAt(0) > 31).join('').trim()

type LineageShape = { explorerSegments?: () => readonly string[] }
type ShowCellShape = { snapshotCells?: () => { label: string }[] }

export class ContextQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'context'
  override readonly aliases = []
  override description = 'Manage the branches this tile’s AI requests read'
  override descriptionKey = 'slash.context'
  override options = ['', '<cell>']
  override examples = [
    { input: '/context', result: 'Opens the context window for the page you are on' },
    { input: '/context susan', result: 'Shows what questions about "susan" get to read' },
  ]

  /** The tiles on this page. A path typed past a `/` is not completed — it
   *  addresses the whole hive and this queen has no business guessing at it
   *  (the same rule `/into` keeps). */
  override slashComplete(args: string): readonly string[] {
    if (args.includes('/')) return []
    const q = args.trim().toLowerCase()
    const names = (get<ShowCellShape>('@diamondcoreprocessor.com/ShowCellDrone')
      ?.snapshotCells?.() ?? []).map(c => c.label).filter(Boolean)
    const unique = [...new Set(names)]
    return q ? unique.filter(n => n.toLowerCase().startsWith(q)) : unique
  }

  protected execute(args: string): void {
    const name = safeName(args.trim())
    const here = (get<LineageShape>('@hypercomb.social/Lineage')?.explorerSegments?.() ?? [])
      .map(s => String(s ?? '').trim()).filter(Boolean)

    // A named cell is resolved against HERE, never searched for: two tiles can
    // share a name and the one you mean is the one in front of you.
    const segments = name ? [...here, name] : here
    EffectBus.emit('context:window-open', { segments })
  }
}

const _context = new ContextQueenBee()
window.ioc.register('@diamondcoreprocessor.com/ContextQueenBee', _context)
