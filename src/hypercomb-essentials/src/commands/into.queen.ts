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
//
// A MACHINE NAMES ITS TILES (2026-10-24). Asked to organize the home page, a
// hive model made the group tiles and then stopped: it had no word that moves a
// tile — `/copy` and `/paste` duplicate, and `/paste` only places here — so it
// asked the participant to open each group and paste by hand. A model cannot
// see a selection, so its form names the tiles:
//   /into <destination> = <tile>
//   /into <destination> = [<tile>, <tile>, ...]

import { QueenBee, EffectBus } from '@hypercomb/core'

const get = <T,>(key: string): T | undefined => (window as { ioc?: { get?: (k: string) => T } }).ioc?.get?.(key)

const BACKSLASH = String.fromCharCode(92)

/** Names become path segments — drop separators and control characters
 *  (mirrors the UNSAFE_CELL_NAME guard in layer-placement.ts). */
const safeName = (raw: string): string =>
  [...raw].filter(ch => ch !== '/' && ch !== BACKSLASH && ch.charCodeAt(0) > 31).join('').trim()

const parsePath = (raw: string): string[] =>
  raw.split('/').map(safeName).filter(Boolean)

/** The named form: the destination before the `=`, the tiles after it —
 *  `[a, b, c]` or one bare name, the list shape `/copy` and `/remove` read. */
const readNamed = (args: string): { destination: string; members: string[] } | undefined => {
  const at = args.indexOf('=')
  if (at < 0) return undefined
  const list = args.slice(at + 1).trim()
  const bracket = list.match(/^\[(.*)\]$/s)
  const members = (bracket ? bracket[1].split(',') : [list]).map(part => part.trim()).filter(Boolean)
  return { destination: args.slice(0, at).trim(), members }
}

type LineageShape = { explorerSegments?: () => readonly string[] }
type WithheldShape = { covers?: (segments: readonly string[]) => boolean }
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
    { input: '/into archive = [drafts, notes]', result: 'Moves "drafts" and "notes" inside "archive", whatever is selected' },
  ]
  /** CUSTODY CHANGES, NOTHING IS TAKEN AWAY: the moved tiles keep their bytes,
   *  markers and bags, and the destination gains them before this page loses
   *  them, so a failure between the two commits leaves them reachable twice,
   *  never nowhere. Editing, then — unlike `/cut`, whose held tile the next
   *  copy can replace. The destination may be any tile in the hive.
   *
   *  A WITHHELD TILE STAYS WHERE IT IS. The list is keyed by route
   *  (core ai-withheld.store.ts), so moving `/susan` to `/people/susan` would
   *  take it out from under its own guard; and a withheld destination is a
   *  tile a machine does not touch. Refused for every machine — this door
   *  cannot tell the participant's own model from an outside one. */
  override machine = {
    forms: '<destination> = <tile> | <destination> = [<tile>, <tile>, ...]',
    example: '/into archive = [drafts, notes]',
    reach: 'editing' as const,
    scope: 'hive' as const,
    consequence: 'Moves the named tiles of this page inside the destination: a tile on this page, or /<route> anywhere in the hive. They leave this page; nothing is deleted.',
    refuse: (args: string): string | undefined => this.#refuse(args),
  }

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
    const named = readNamed(raw)
    const here = this.#here()

    // Named tiles must be tiles of this page, spelled as the page spells them.
    // Without this a phantom name reached the primitive, which aborts quietly,
    // and the line still read as a move (the clipboard verbs' surface audit).
    let labels: string[]
    if (named) {
      const page = this.#pageTiles()
      const absent = page.length ? named.members.filter(name => !page.some(tile => tile.toLowerCase() === name.toLowerCase())) : []
      if (absent.length) throw new Error(`into — no tile named ${absent.map(name => `"${name}"`).join(', ')} on this page`)
      labels = named.members.map(name => page.find(tile => tile.toLowerCase() === name.toLowerCase()) ?? name)
    } else {
      const selection = get<SelectionShape>('@diamondcoreprocessor.com/SelectionService')
      labels = selection ? [...selection.selected].filter(Boolean) : []
    }
    if (labels.length === 0) {
      this.#log('Into — select the tiles to move first, then say where they go')
      return
    }

    const move = get<MoveShape>('@diamondcoreprocessor.com/MoveDrone')
    if (!move?.commitMoveInto) {
      if (named) throw new Error('into — moving is not ready yet; nothing moved')
      this.#log('Into — unavailable')
      return
    }

    const target = this.#target(named ? named.destination : raw, here)
    if (target.length === 0) {
      if (named) throw new Error('into — the destination is not a name; nothing moved')
      this.#log('Into — that is not a name')
      return
    }

    const landed = await move.commitMoveInto(labels, here, target)
    // The primitive says why aloud for a hand on the screen. A NAMED move is
    // a sentence, and a receipt must never read a move that did not happen.
    if (named && landed.length < labels.length) {
      const missed = labels.filter(label => !landed.includes(label))
      const where = `/${target.join('/')}`
      throw new Error(landed.length === 0
        ? `into — nothing moved into ${where}: it could not be read, it is one of the tiles, or it already holds a tile by each of those names`
        : `into — ${missed.map(name => `"${name}"`).join(', ')} did not move into ${where}, which already holds a tile by that name; nothing was overwritten`)
    }
    if (landed.length === 0) return   // the primitive has already said why
    this.#log(
      landed.length === 1
        ? `Into — "${landed[0]}" now lives in /${target.join('/')}`
        : `Into — ${landed.length} tiles now live in /${target.join('/')}`,
    )
  }

  /** Why a machine may not say this line, or undefined. */
  #refuse(args: string): string | undefined {
    const named = readNamed(args.trim())
    if (!named) return '/into names its tiles — a machine cannot see what is picked: /into <destination> = [<tile>, <tile>]'
    if (!parsePath(named.destination).length) return '/into needs a destination before the ='
    if (!named.members.length) return '/into needs at least one tile name after the ='
    if (named.members.some(name => name.includes('/') || name.includes(BACKSLASH))) {
      return '/into moves tiles of this page; name them, not a route'
    }
    const withheld = get<WithheldShape>('@hypercomb.social/AiWithheld')
    if (!withheld?.covers) return undefined
    // Called on the store: `covers` reads the store's own private document.
    const covers = (segments: readonly string[]): boolean => withheld.covers!(segments)
    const here = this.#here()
    const kept = named.members.filter(name => covers([...here, name]))
    if (kept.length) {
      return `/into: ${kept.map(name => `"${name}"`).join(', ')} ${kept.length === 1 ? 'is' : 'are'} withheld from outside models and stays where it is; move the others without ${kept.length === 1 ? 'it' : 'them'}`
    }
    const target = this.#target(named.destination, here)
    if (covers(target)) return `/into: /${target.join('/')} is withheld from outside models; put the tiles somewhere else`
    return undefined
  }

  /** A bare name means the tile in front of you when there is one. A leading
   *  slash is how you insist on the root reading instead. */
  #target(raw: string, here: readonly string[]): string[] {
    const segments = parsePath(raw)
    const absolute = raw.startsWith('/') || segments.length > 1
    const tile = absolute ? undefined : this.#pageTiles().find(name => name.toLowerCase() === segments[0]?.toLowerCase())
    return tile ? [...here, tile] : segments
  }

  #here(): string[] {
    return (get<LineageShape>('@hypercomb.social/Lineage')?.explorerSegments?.() ?? []).map(String)
  }

  /** The tiles this page holds — what the line completes from, else what was
   *  last rendered here. */
  #pageTiles(): readonly string[] {
    const page = get<{ suggestions?(): string[] }>('@hypercomb.social/CellSuggestionProvider')?.suggestions?.() ?? []
    return page.length ? page : this.#labels
  }

  #log(message: string, icon = '⇲'): void {
    EffectBus.emit('activity:log', { message, icon })
  }
}

const _into = new IntoQueenBee()
window.ioc.register('@diamondcoreprocessor.com/IntoQueenBee', _into)
