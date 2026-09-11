// hypercomb-shared/core/games-group.ts
//
// The "games" launch group — surfaces every arcade game as ONE meaning-icon in
// the command line. Games are META RESOURCES: each is a signed `genotype:'game'`
// bee that self-registers in IoC and self-describes its launch surface
// (`gameId` / `gameLabel` / `gameIcon`). This provider carries NO roster — the
// pool of games IS the IoC registry filtered by genotype, and
// `window.ioc.onRegister` is the live feed, so any game module (including a
// community one loaded at runtime) auto-aggregates the moment it registers, with
// no edit here. Like every launch group the icon is a one-state portal:
// 0 members → hidden; otherwise clicking it shows the games on the shared
// aggregator page (MixedGroupBag) — click a game tile to launch.
//
// A game is also a BEHAVIOUR in the Beehaviors roster (kind `game:<gameId>`,
// owned essentials-side by `games/game-enablement.ts`). A switched-off game is
// HIDDEN on the page, never removed from it (Jaime, 2026-09-10: "you should be
// able to turn off the behavior but you shouldn't be able to lose the
// possibility of restoring the icon"). The page's children are DERIVED from
// members(): a member missing here is a cell MixedGroupBag drops from the
// /games layer, and no undo brings it back — the next reconcile re-derives the
// children and forces the cursor to head. So a dormant game stays a member,
// flagged `dormant`: its cell keeps its place, show-cell paints it grey
// whatever the show-hidden eye says, and the unhide every hidden tile offers
// turns its light back on.
//
// Shell-level: never imports essentials; resolves games purely by enumerating
// window.ioc and routes a launch back as `<gameId>:toggle` (the uniform toggle
// the game drones already listen for). Mirrors websites-group.

import { EffectBus, normalizeCell } from '@hypercomb/core'
import { groupRegistry, type GroupMember } from './group-registry'
import { LaunchGroupBase } from './launch-group-base'
import { setKindGlobalOn } from '../ui/features-viewer/behavior-enablement'

/** The self-describing surface a `genotype:'game'` bee exposes for the launcher. */
type GameLike = {
  genotype?: string
  gameId?: unknown
  gameLabel?: unknown
  gameIcon?: unknown
  /** Switched off in the Beehaviors roster. The bee answers the dormancy
   *  question itself (the kind is `game:<gameId>`, and essentials owns that
   *  lens) so the shell never has to learn the spelling — the same way it
   *  reads the label and the icon off the bee rather than holding a table. */
  gameDormant?: unknown
  /** The roster kind whose light this game is — named by the bee, for the
   *  same reason: relighting it from the page must not spell it here. */
  behaviorKind?: unknown
}

type IocLike = {
  list(): readonly string[]
  get(key: string): unknown
  onRegister(cb: (key: string, value: unknown) => void): () => void
}

const ioc = (): IocLike | undefined => (window as unknown as { ioc?: IocLike }).ioc

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

class GamesGroup extends LaunchGroupBase {
  override readonly id = 'games'
  override readonly icon = 'sports_esports'
  override readonly label = 'Games'
  readonly shape = 'space-invader'

  constructor() {
    super()
    // Re-render the launcher whenever a new game bee registers. Order-agnostic:
    // games may load before OR after this provider — anything already present is
    // picked up by the first members() enumeration, anything later by this feed.
    ioc()?.onRegister((_key, value) => {
      if ((value as GameLike)?.genotype === 'game') groupRegistry.notifyChanged()
    })
    // A roster flip changes how a member shows (lit ↔ hidden), so the page
    // repaints in place — the cell itself never leaves the layer.
    EffectBus.on('behavior:enablement-changed', () => groupRegistry.notifyChanged())
    // UNHIDE IS THE WAY BACK. A dormant game's tile wears the hidden face, so
    // the overlay offers the same unhide any hidden tile offers — and on this
    // page, unhiding a switched-off game means turning its light back on.
    EffectBus.on<{ cell?: string }>('tile:unhidden', (p) => {
      if (groupRegistry.currentId() !== this.id) return
      const kind = str(this.#dormantGame(str(p?.cell))?.behaviorKind)
      if (kind) setKindGlobalOn(kind, true)
    })
  }

  /** The live pool of games — every `genotype:'game'` bee in IoC that carries a
   *  launch descriptor. No roster: a new game module appears here for free. A
   *  switched-off one STAYS, flagged `dormant`, so its tile is hidden rather
   *  than deleted. */
  override members(): GroupMember[] {
    const out: GroupMember[] = []
    const seen = new Set<string>()
    for (const g of this.#games()) {
      const gid = str(g.gameId)
      if (seen.has(gid)) continue
      seen.add(gid)
      out.push({
        key: gid,
        label: this.#labelOf(g),
        segments: [],
        icon: str(g.gameIcon) || 'sports_esports',
        ...(g.gameDormant === true ? { dormant: true } : {}),
      })
    }
    return out.sort((a, b) => a.label.localeCompare(b.label))
  }

  /** Launch a game: route back to its drone as `<gameId>:toggle`. The overlay
   *  mounts above the hive (and above the aggregator bag, when launched from
   *  it); games carry no hive location, so there is nothing to navigate here. */
  protected override activate(m: GroupMember): void {
    EffectBus.emit(`${m.key}:toggle`, {})
  }

  /** Every game bee with a launch descriptor, lit or not. */
  *#games(): Generator<GameLike> {
    const c = ioc()
    if (!c) return
    for (const key of c.list()) {
      const g = c.get(key) as GameLike | undefined
      if (g?.genotype === 'game' && str(g.gameId)) yield g
    }
  }

  #labelOf(g: GameLike): string {
    return str(g.gameLabel) || str(g.gameId)
  }

  /** The switched-off game whose tile wears this name. Compared as CELLS: the
   *  overlay's unhide carries the label as drawn ("Roper"), a typed
   *  `/hide ~roper` carries the normalized cell ("roper"). */
  #dormantGame(label: string): GameLike | undefined {
    const wantedCell = normalizeCell(label)
    if (!wantedCell) return undefined
    for (const g of this.#games()) {
      if (g.gameDormant === true && normalizeCell(this.#labelOf(g)) === wantedCell) return g
    }
    return undefined
  }
}

groupRegistry.register(new GamesGroup())
