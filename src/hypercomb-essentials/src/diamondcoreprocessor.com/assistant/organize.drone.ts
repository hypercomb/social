// diamondcoreprocessor.com/assistant/organize.drone.ts
//
// ORGANIZE — INSERT A LEVEL. The inverse of atomize: it mints no leaves and
// asks for no new meaning. It takes the children a layer ALREADY has and
// re-homes them into a handful of group tiles, so `parent → 60 tiles` becomes
// `parent → 6 groups → ~10 each`. Haiku's job here is naming the clusters,
// not inventing content.
//
// Why it is worth doing: the render path resolves a layer's children by
// signature PER LEVEL, so fan-out per level IS the cold-load cost. Six sigs at
// the top instead of sixty, and the next level only resolves when the
// participant goes there.
//
// TWO PHASES, AND THE SPLIT IS THE SAFETY.
//
//   1. PLAN (over the bridge). A `task:'organize'` ask carries the layer's
//      current tile names. The responder returns a GROUPING PLAN — it creates
//      nothing and moves nothing — by writing a `kind:'organize-plan'`
//      optimization back through the `optimization-add` bridge op.
//
//   2. APPLY (in the hive, here). This drone validates the plan against the
//      LIVE layer and applies it with MoveDrone.commitMoveInto — the same
//      primitive drag-drop-into, /into and promote already use, which means
//      one marker per group, undoable, name collisions skipped rather than
//      clobbered, and refusal while the history cursor is rewound.
//
// The split exists because a membership rewrite is the ONE operation that can
// permanently lose a tile: a cold pool miss makes a child look absent, and
// writing the resulting `children` list drops a tile whose bytes merely were
// not warm (this is why childNamesOfStrict reports coldMiss at all). A
// responder issuing raw `update` calls over the bridge would be doing exactly
// that rewrite, blind, from outside the hive. So the responder never moves
// anything — it advises, and the hive moves.
import { Drone, EffectBus, hypercomb, normalizeCell } from '@hypercomb/core'
import { childSigsOf, resolveCurrentLayer, type PlacementHistory, type PlacementLayer } from '../history/layer-placement.js'

/** Below this, a layer is already manageable — organizing it would add a
 *  level of navigation to save nothing. */
const ORGANIZE_THRESHOLD = 12

/** The shape to aim for. Not hard limits — the responder is told to prefer
 *  honest clusters over hitting a number — but a plan that ignores them
 *  entirely (one group of 40, or 20 groups of 2) has not helped. */
const TARGET_GROUPS_MIN = 5
const TARGET_GROUPS_MAX = 9

const ASK_KIND = 'ask'
const ORGANIZE_TASK = 'organize'
const ORGANIZE_MODEL = 'haiku'

/** The record kind the responder writes back with the plan. */
const PLAN_KIND = 'organize-plan'

type StoreLike = {
  putOptimization?: (blob: Blob) => Promise<string>
  getOptimization?: (sig: string) => Promise<Blob | null>
  removeOptimization?: (sig: string) => Promise<boolean>
  listOptimizations?: () => Promise<string[]>
}
type LineageLike = { explorerSegments?: () => readonly string[]; domain?: unknown }
type MoveLike = {
  commitMoveInto?: (
    labels: readonly string[],
    sourceSegments: readonly string[],
    targetSegments: readonly string[],
  ) => Promise<readonly string[]>
}

type PlanGroup = { name: string; members: string[] }

export class OrganizeDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'assistant'
  override description = 'asks Claude Haiku (over the bridge) to group a crowded layer, then re-homes the tiles into it'

  protected override deps = {
    lineage: '@hypercomb.social/Lineage',
    store: '@hypercomb.social/Store',
  }

  protected override listens = ['organize:layer', 'optimization:added']
  protected override emits = ['ask:queued', 'toast:show', 'cell:added']

  #effectsRegistered = false
  #applying = false

  protected override heartbeat = async (): Promise<void> => {
    if (this.#effectsRegistered) return
    this.#effectsRegistered = true

    this.onEffect('organize:layer', () => {
      void this.organizeLayer()
    })

    // A plan landing over the bridge is what starts phase 2. The bridge
    // worker emits this for every optimization a client writes; we only care
    // about ours.
    this.onEffect<{ sig?: string; kind?: string }>('optimization:added', (payload) => {
      if (payload?.kind !== PLAN_KIND || !payload.sig) return
      void this.applyPlan(String(payload.sig))
    })
  }

  // ── phase 1: ask for a plan ──────────────────────────────

  /** Ask Haiku how the CURRENT layer should be grouped. Creates and moves
   *  nothing — the plan comes back through `applyPlan`. */
  async organizeLayer(): Promise<boolean> {
    const segments = this.#segments()
    const where = segments.length ? `/${segments.join('/')}` : 'this hive'
    const names = await this.#currentNames(segments)

    if (names === null) {
      EffectBus.emit('toast:show', { type: 'tip', message: `Could not read ${where} — nothing organized.` })
      return false
    }

    if (names.length <= ORGANIZE_THRESHOLD) {
      EffectBus.emit('toast:show', {
        type: 'tip',
        message: `${where} has ${names.length} tile${names.length === 1 ? '' : 's'} — already manageable, nothing to organize.`,
      })
      return false
    }

    const prompt =
      `Organize the layer ${where}. It has ${names.length} tiles, which is too many for one level.\n\n`
      + `Group them into ${TARGET_GROUPS_MIN}–${TARGET_GROUPS_MAX} clusters that genuinely belong together, `
      + `each named with a short 1–3 word label that says what the cluster IS. Prefer honest clusters over `
      + `hitting a count: a group of 2 and a group of 30 both mean the grouping is wrong, but so does forcing `
      + `unrelated tiles together to round out a number.\n\n`
      + `RULES:\n`
      + `- Do NOT create, move, rename, or delete anything. You are returning a plan, nothing else.\n`
      + `- Use each tile name EXACTLY as given, at most once across all groups.\n`
      + `- A tile you cannot place well may be left out — it simply stays where it is. No "misc" bucket.\n`
      + `- Group names must not collide with an existing tile name on the layer.\n\n`
      + `RETURN THE PLAN by writing this record over the bridge (op \`optimization-add\`, \`text\` = the JSON):\n`
      + `{"kind":"${PLAN_KIND}","payload":{"segments":${JSON.stringify(segments)},`
      + `"groups":[{"name":"<group>","members":["<tile>","<tile>"]}]}}\n`
      + `Then retire this ask. The hive validates the plan against the live layer and performs the moves itself.\n\n`
      + `Tiles on ${where} (${names.length}): ${names.join(', ')}`

    try {
      const store = get<StoreLike>('@hypercomb.social/Store')
      if (!store?.putOptimization) {
        console.warn('[organize] Store.putOptimization unavailable')
        return false
      }

      const record = {
        kind: ASK_KIND,
        appliesTo: [...segments],
        payload: {
          task: ORGANIZE_TASK,
          prompt,
          model: ORGANIZE_MODEL,
          targets: [],
          segments: [...segments],
          existing: [...names],
          planKind: PLAN_KIND,
          groupsMin: TARGET_GROUPS_MIN,
          groupsMax: TARGET_GROUPS_MAX,
          status: 'pending',
          askedAt: Date.now(),
        },
        mark: 'persistent',
      }

      const sig = await store.putOptimization(
        new Blob([JSON.stringify(record)], { type: 'application/json' }),
      )
      EffectBus.emit('ask:queued', { sig, prompt, targets: [], model: ORGANIZE_MODEL })
      EffectBus.emit('toast:show', {
        type: 'tip',
        message: `Organizing ${where} — Haiku is working out the groups for ${names.length} tiles.`,
      })
      console.log(`[organize] queued (${ORGANIZE_MODEL}): ${where}, ${names.length} tiles  [${sig.slice(0, 12)}…]`)
      return true
    } catch (err) {
      console.warn('[organize] failed to queue:', err)
      return false
    }
  }

  // ── phase 2: apply the plan ──────────────────────────────

  /** Validate a returned plan against the LIVE layer and perform the moves.
   *  Rejects the whole plan rather than applying a partial one — a grouping
   *  half-applied is worse than none, because the participant cannot tell
   *  which half. Returns the number of groups that landed. */
  async applyPlan(planSig: string): Promise<number> {
    if (this.#applying) return 0
    this.#applying = true
    try {
      const store = get<StoreLike>('@hypercomb.social/Store')
      const blob = await store?.getOptimization?.(planSig)
      if (!blob) {
        console.warn(`[organize] plan ${planSig.slice(0, 12)}… not readable`)
        return 0
      }

      let record: { payload?: { segments?: unknown; groups?: unknown } }
      try {
        record = JSON.parse(await blob.text())
      } catch {
        console.warn('[organize] plan is not valid JSON')
        return 0
      }

      const segments = Array.isArray(record.payload?.segments)
        ? record.payload!.segments.map(s => String(s ?? '').trim()).filter(Boolean)
        : []
      const where = segments.length ? `/${segments.join('/')}` : 'this hive'

      // The plan was made against the layer as it was. Apply it against the
      // layer as it IS, or not at all.
      const live = await this.#currentNames(segments)
      if (live === null) {
        this.#reject(`could not read ${where} to check the plan against`)
        return 0
      }
      const liveSet = new Set(live)

      const groups = this.#validate(record.payload?.groups, liveSet)
      if (!groups) return 0

      const move = get<MoveLike>('@diamondcoreprocessor.com/MoveDrone')
      if (!move?.commitMoveInto) {
        this.#reject('the move primitive is unavailable')
        return 0
      }

      // Mint the group tiles first, in ONE pulse, so every destination exists
      // before anything is re-homed into it.
      for (const g of groups) EffectBus.emit('cell:added', { cell: g.name, segments: [...segments] })
      await new hypercomb().act()

      let landedGroups = 0
      let landedTiles = 0
      for (const g of groups) {
        const landed = await move.commitMoveInto(g.members, segments, [...segments, g.name])
        if (landed.length) { landedGroups++; landedTiles += landed.length }
        // A group whose members all refused (name collision at the
        // destination, rewound cursor) leaves an empty group tile rather than
        // a wrong one. Report it; do not quietly delete a tile we just made.
        if (landed.length !== g.members.length) {
          console.warn(`[organize] "${g.name}": ${landed.length}/${g.members.length} tiles moved`)
        }
      }

      const ungrouped = live.length - landedTiles
      EffectBus.emit('toast:show', {
        type: 'tip',
        message: `Organized ${where} into ${landedGroups} group${landedGroups === 1 ? '' : 's'}`
          + (ungrouped > 0 ? ` — ${ungrouped} tile${ungrouped === 1 ? '' : 's'} stayed put.` : '.'),
      })
      console.log(`[organize] ${where}: ${landedGroups} groups, ${landedTiles} tiles moved, ${ungrouped} left in place`)

      await store?.removeOptimization?.(planSig)
      return landedGroups
    } catch (err) {
      console.warn('[organize] apply failed:', err)
      return 0
    } finally {
      this.#applying = false
    }
  }

  /** Every way a plan can be wrong, checked before anything is written.
   *  Returns null (and reports) rather than applying a plan we don't trust. */
  #validate(raw: unknown, live: ReadonlySet<string>): PlanGroup[] | null {
    if (!Array.isArray(raw) || raw.length === 0) {
      this.#reject('the plan had no groups')
      return null
    }

    const groups: PlanGroup[] = []
    const claimed = new Set<string>()

    for (const g of raw) {
      const name = normalizeCell(String((g as { name?: unknown })?.name ?? ''))
      const membersRaw = (g as { members?: unknown })?.members
      if (!name || !Array.isArray(membersRaw)) {
        this.#reject('a group in the plan had no name or no members')
        return null
      }
      // A name is an address: a group named after a tile that is already
      // there would address THAT tile, not a new one.
      if (live.has(name)) {
        this.#reject(`the plan wanted a group called "${name}", but a tile of that name is already there`)
        return null
      }

      const members: string[] = []
      for (const m of membersRaw) {
        const member = normalizeCell(String(m ?? ''))
        if (!member) continue
        if (!live.has(member)) {
          this.#reject(`the plan referenced "${member}", which is not on the layer — it may be out of date`)
          return null
        }
        if (claimed.has(member)) {
          this.#reject(`the plan put "${member}" in two groups`)
          return null
        }
        claimed.add(member)
        members.push(member)
      }

      if (members.length === 0) {
        this.#reject(`the plan's group "${name}" had no usable members`)
        return null
      }
      groups.push({ name, members })
    }

    return groups
  }

  #reject(why: string): void {
    console.warn(`[organize] plan rejected — ${why}`)
    EffectBus.emit('toast:show', { type: 'tip', message: `Organize plan rejected — ${why}. Nothing was moved.` })
  }

  // ── context ──────────────────────────────────────────────

  #segments(): readonly string[] {
    const lineage = get<LineageLike>('@hypercomb.social/Lineage')
    return (lineage?.explorerSegments?.() ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
  }

  /** The tile names on a layer. `null` = could not read it — never confused
   *  with `[]` "the layer is empty", because organize validates a plan
   *  against this list and an empty list would reject every member. */
  async #currentNames(segments: readonly string[]): Promise<string[] | null> {
    const history = get<PlacementHistory>('@diamondcoreprocessor.com/HistoryService')
    const lineage = get<LineageLike>('@hypercomb.social/Lineage')
    if (!history || !lineage) return null
    try {
      const parent = await resolveCurrentLayer(history, lineage.domain, segments, null)
      if (!parent) return null
      const sigs = childSigsOf(parent)
      const names: string[] = []
      for (const sig of sigs) {
        const child = await history.getLayerBySig(String(sig)) as PlacementLayer | null
        const name = typeof child?.name === 'string' ? child.name : ''
        // A child sig that will not resolve is a COLD MISS, not an absent
        // tile. Organize rewrites membership, so guessing here is exactly the
        // failure that loses a tile — refuse the whole read instead.
        if (!name) {
          console.warn(`[organize] cold miss on child ${String(sig).slice(0, 12)}… — refusing to plan against a partial layer`)
          return null
        }
        names.push(name)
      }
      return names
    } catch (err) {
      console.warn('[organize] could not read the layer:', err)
      return null
    }
  }
}

const _organize = new OrganizeDrone()
window.ioc.register('@diamondcoreprocessor.com/OrganizeDrone', _organize)
console.log('[OrganizeDrone] Loaded')
