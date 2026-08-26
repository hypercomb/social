// diamondcoreprocessor.com/groups/games-group.ts (moved down from hypercomb-shared in the everything-is-a-beehavior Phase 1)
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
// owned essentials-side by `games/game-enablement.ts`). A switched-off game
// leaves this group the way a dormant behaviour leaves every other surface —
// and when the last one goes out, the icon itself goes with it.
//
// Shell-level: never imports essentials; resolves games purely by enumerating
// window.ioc and routes a launch back as `<gameId>:toggle` (the uniform toggle
// the game drones already listen for). Mirrors websites-group.

import { EffectBus } from '@hypercomb/core'
import { groupRegistry, type GroupMember } from './group-registry.js'
import { LaunchGroupBase } from './launch-group-base.js'

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
    // A roster flip changes who is in the group — and when the last lit game
    // goes out, LaunchGroupBase hides the icon entirely (0 members). Without
    // this the launcher would keep offering a game that is switched off, and
    // clicking it would do nothing, which is worse than not being there.
    EffectBus.on('behavior:enablement-changed', () => groupRegistry.notifyChanged())
  }

  /** The live pool of games — every `genotype:'game'` bee in IoC that carries a
   *  launch descriptor AND whose Beehaviors light is on. No roster: a new game
   *  module appears here for free, and a switched-off one leaves. */
  override members(): GroupMember[] {
    const c = ioc()
    if (!c) return []
    const seen = new Set<string>()
    const out: GroupMember[] = []
    for (const key of c.list()) {
      const g = c.get(key) as GameLike | undefined
      if (!g || g.genotype !== 'game') continue
      // Off = gone, the same answer every other dormant behaviour gives.
      if (g.gameDormant === true) continue
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
}

groupRegistry.register(new GamesGroup())
