// hypercomb-shared/core/games-group.ts
//
// The "games" launch group — surfaces every arcade game as ONE meaning-icon in
// the command line. Games are META RESOURCES: each is a signed `genotype:'game'`
// bee that self-registers in IoC and self-describes its launch surface
// (`gameId` / `gameLabel` / `gameIcon`). This provider carries NO roster — the
// pool of games IS the IoC registry filtered by genotype, and
// `window.ioc.onRegister` is the live feed, so any game module (including a
// community one loaded at runtime) auto-aggregates the moment it registers, with
// no edit here. Like every launch group the icon is an independent on/off
// toggle: 0 members → hidden; otherwise toggling it on adds the games to the
// shared mixed aggregator page (MixedGroupBag) — click a game tile to launch.
//
// Shell-level: never imports essentials; resolves games purely by enumerating
// window.ioc and routes a launch back as `<gameId>:toggle` (the uniform toggle
// the game drones already listen for). Mirrors websites-group / dashboard-group.

import { EffectBus } from '@hypercomb/core'
import { groupRegistry, type GroupMember } from './group-registry'
import { LaunchGroupBase } from './launch-group-base'

/** The self-describing surface a `genotype:'game'` bee exposes for the launcher. */
type GameLike = {
  genotype?: string
  gameId?: unknown
  gameLabel?: unknown
  gameIcon?: unknown
}

type IocLike = {
  list(): readonly string[]
  get(key: string): unknown
  onRegister(cb: (key: string, value: unknown) => void): () => void
}

const ioc = (): IocLike | undefined => (window as unknown as { ioc?: IocLike }).ioc

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
  }

  /** The live pool of games — every `genotype:'game'` bee in IoC that carries a
   *  launch descriptor. No roster: a new game module appears here for free. */
  override members(): GroupMember[] {
    const c = ioc()
    if (!c) return []
    const seen = new Set<string>()
    const out: GroupMember[] = []
    for (const key of c.list()) {
      const g = c.get(key) as GameLike | undefined
      if (!g || g.genotype !== 'game') continue
      const gid = typeof g.gameId === 'string' ? g.gameId.trim() : ''
      if (!gid || seen.has(gid)) continue
      seen.add(gid)
      const label = typeof g.gameLabel === 'string' && g.gameLabel.trim() ? g.gameLabel.trim() : gid
      const icon = typeof g.gameIcon === 'string' && g.gameIcon.trim() ? g.gameIcon.trim() : 'sports_esports'
      out.push({ key: gid, label, segments: [], icon })
    }
    return out.sort((a, b) => a.label.localeCompare(b.label))
  }

  /** Launch a game: route back to its drone as `<gameId>:toggle`. The overlay
   *  mounts above the hive (and above the aggregator bag, when launched from
   *  it); games carry no hive location, so there is nothing to navigate here. */
  protected override activate(m: GroupMember): void {
    EffectBus.emit(`${m.key}:toggle`, {})
  }

  /** A game overlay's on-screen state rides its own `<gameId>:state` emit
   *  ({ available, active }) — fired on open and close. EffectBus replays the
   *  last value on subscribe; a stale close is ignored by the base's
   *  seen-open-first machine, a live "already open" (re-tapping the lit tile
   *  toggles it closed) arms correctly. */
  protected override watchSurface(m: GroupMember, report: (open: boolean) => void): () => void {
    return EffectBus.on<{ active?: boolean }>(`${m.key}:state`, p => report(p?.active === true))
  }
}

groupRegistry.register(new GamesGroup())
