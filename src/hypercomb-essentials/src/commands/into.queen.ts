// commands/into.queen.ts
//
// `/into` — FILE the selection away: move the selected tiles inside another
// tile, so they leave the page they were on and live in the destination.
//
// This is the typed door onto MoveDrone.commitMoveInto, the one re-home
// primitive. The other two doors are Ctrl+drag onto a tile (same page only) and
// the Organizer's Move button (any collection, anywhere). All three commit the
// identical act; only the way you say it differs.
//
// `/into` is NOT `/reference`, and the difference is the whole point:
//   • /reference  — the tile gains a DOORWAY somewhere else and stays put. Use
//     it when something belongs in several places at once.
//   • /into       — CUSTODY. The tile moves. It vanishes from where it was.
// Nothing is deleted either way: the moved subtree keeps its bytes, its markers
// and its history bag, so undo at either page puts it back.
//
// Syntax:
//   /into <cell>              — a tile on THIS page (what you can see wins)
//   /into <path>/<to>/<cell>  — anywhere in the hive, from the root
//   /into /<cell>             — force the root reading of a bare name
//
// A bare name prefers a child of the page you are standing on, because that is
// the tile you are looking at. Nothing here by that name → it reads as a path
// from the root, which is how a collection (`/reading`) is reached.

import { QueenBee, EffectBus } from '@hypercomb/core'

const get = <T,>(key: string): T | undefined => (window as { ioc?: { get?: (k: string) => T } }).ioc?.get?.(key)

const BACKSLASH = String.fromCharCode(92)

/** Names become path segments — drop separators and control characters
 *  (mirrors the UNSAFE_CELL_NAME guard in layer-placement.ts). */
const safeName = (raw: string): string =>
  [...raw].filter(ch => ch !== '/' && ch !== BACKSLASH && ch.charCodeAt(0) > 31).join('').trim()

const parsePath = (raw: string): string[] =>
  raw.split('/').map(safeName).filter(Boolean)

type LineageShape = { explorerSegments?: () => readonly string[] }
type SelectionShape = { selected: ReadonlySet<string> }
type MoveShape = {
  commitMoveInto(
    labels: readonly string[],
    sourceSegments: readonly string[],
    targetSegments: readonly string[],
  ): Promise<readonly string[]>
}

export class IntoQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'into'
  override description = 'Move the selected tiles inside another tile — they leave this page'
  override descriptionKey = 'slash.into'
  override options = ['<cell>', '<path>/<cell>']
  override examples = [
    { input: '/into archive', result: 'The selected tiles move inside the tile "archive" on this page' },
    { input: '/into reading/2026', result: 'They move into /reading/2026, wherever you are standing' },
  ]

  /** Labels rendered at the current level, for autocomplete. Replayed on
   *  subscribe, so this is populated from the moment the queen is constructed —
   *  no first-completion miss and no async read from a sync hook. */
  #labels: readonly string[] = []

  constructor() {
    super()
    EffectBus.on<{ labels?: string[] }>('render:cell-count', (p) => {
      this.#labels = Array.isArray(p?.labels) ? p.labels.filter(Boolean) : []
    })
  }

  /** The tiles on this page — the destinations you can see. A path typed past a
   *  '/' is not completed: it addresses the whole hive and this queen has no
   *  business reading the tree to guess at it. */
  override slashComplete(args: string): readonly string[] {
    if (args.includes('/')) return []
    const q = args.trim().toLowerCase()
    const names = [...this.#labels]
    return q ? names.filter(n => n.toLowerCase().startsWith(q)) : names
  }

  protected async execute(args: string): Promise<void> {
    const raw = args.trim()
    if (!raw) { this.#log('Into — usage: /into <cell>  or  /into <path>/<cell>'); return }

    const selection = get<SelectionShape>('@diamondcoreprocessor.com/SelectionService')
    const labels = selection ? [...selection.selected].filter(Boolean) : []
    if (labels.length === 0) {
      this.#log('Into — select the tiles to move first, then say where they go')
      return
    }

    const move = get<MoveShape>('@diamondcoreprocessor.com/MoveDrone')
    if (!move?.commitMoveInto) { this.#log('Into — unavailable'); return }

    const here = (get<LineageShape>('@hypercomb.social/Lineage')?.explorerSegments?.() ?? []).map(String)
    const segments = parsePath(raw)
    if (segments.length === 0) { this.#log('Into — that is not a name'); return }

    // A bare name means the tile in front of you when there is one. A leading
    // slash is how you insist on the root reading instead.
    const absolute = raw.startsWith('/') || segments.length > 1
    const target = (!absolute && this.#labels.includes(segments[0]))
      ? [...here, segments[0]]
      : segments

    const landed = await move.commitMoveInto(labels, here, target)
    if (landed.length === 0) return   // the primitive has already said why
    this.#log(
      landed.length === 1
        ? `Into — "${landed[0]}" now lives in /${target.join('/')}`
        : `Into — ${landed.length} tiles now live in /${target.join('/')}`,
    )
  }

  #log(message: string, icon = '⇲'): void {
    EffectBus.emit('activity:log', { message, icon })
  }
}

const _into = new IntoQueenBee()
window.ioc.register('@diamondcoreprocessor.com/IntoQueenBee', _into)
