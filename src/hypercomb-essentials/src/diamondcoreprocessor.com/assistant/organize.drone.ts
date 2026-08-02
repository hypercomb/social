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
import { PendingAskIndex } from './ask-scope.js'
import { mintCreationId, stampCreation } from './creation.js'

/** Below this, a layer is already manageable — organizing it would add a
 *  level of navigation to save nothing. Above it, a layer is CROWDED, and
 *  crowded is the condition that decides which operation a page needs:
 *  `/atomize` on a crowded layer routes here instead of deepening. The
 *  participant should never have to know which of the two they want. */
export const ORGANIZE_THRESHOLD = 12

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

  /** Plans are applied one at a time but NEVER dropped. The cascade can put
   *  several in flight at once, and a boolean guard would silently discard
   *  every plan but the first — losing work a responder already did. */
  #applyChain: Promise<unknown> = Promise.resolve()

  /** One structural ask per branch. Organize holds the WHOLE layer it stands
   *  on, because it re-homes that layer's children — so it conflicts with a
   *  second organize there AND with any atomize on a tile inside it, whose
   *  target would move out from under the responder mid-flight. */
  #pending = new PendingAskIndex()

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
    return this.organizeAt(this.#segments())
  }

  /** Organize a NAMED layer. Same act, explicit location — used by the
   *  cascade, which organizes a group it just created rather than wherever
   *  the participant happens to be standing by then. `quiet` suppresses the
   *  "already manageable" toast: a cascade probing its own groups is not
   *  something the participant asked about tile by tile. */
  async organizeAt(segments: readonly string[], quiet = false): Promise<boolean> {
    const where = segments.length ? `/${segments.join('/')}` : 'this hive'
    const members = await this.#currentMembers(segments)

    if (members === null) {
      EffectBus.emit('toast:show', { type: 'tip', message: `Could not read ${where} — nothing organized.` })
      return false
    }

    const names = [...members.keys()]
    if (names.length <= ORGANIZE_THRESHOLD) {
      if (!quiet) EffectBus.emit('toast:show', {
        type: 'tip',
        message: `${where} has ${names.length} tile${names.length === 1 ? '' : 's'} — already manageable, nothing to organize.`,
      })
      return false
    }

    // Organize reshapes THIS layer's membership, so the branch it holds is
    // the layer itself — which is an ancestor of every tile on it.
    const scopePath = [...segments]

    // One id for everything this act creates — minted HERE so it travels in
    // the ask and the responder cannot invent a second one.
    const askedAt = Date.now()
    const creationId = await mintCreationId(ORGANIZE_TASK, scopePath, askedAt)

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
      + `{"kind":"${PLAN_KIND}","payload":{"segments":${JSON.stringify(segments)},"creationId":"${creationId}",`
      + `"groups":[{"name":"<group>","members":["<tile>","<tile>"]}]}}\n`
      + `Then retire this ask. The hive validates the plan against the live layer and performs the moves itself.\n\n`
      + `Tiles on ${where} (${names.length}): ${names.join(', ')}`

    try {
      const store = get<StoreLike>('@hypercomb.social/Store')
      if (!store?.putOptimization) {
        console.warn('[organize] Store.putOptimization unavailable')
        return false
      }

      const held = await this.#pending.conflict(scopePath)
      if (held) {
        const inside = held.path.length > scopePath.length
        EffectBus.emit('toast:show', {
          type: 'tip',
          message: inside
            ? `Can't organize ${where} yet — /${held.path.join('/')} is being ${held.task}d. Moving tiles now would pull it out from under that.`
            : `${where} is already being ${held.task}d — waiting on that.`,
        })
        return false
      }
      this.#pending.claim(ORGANIZE_TASK, scopePath)

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
          // The branch this ask holds — the whole layer, since organize
          // re-homes its children (see ask-scope.ts).
          scopePath,
          planKind: PLAN_KIND,
          groupsMin: TARGET_GROUPS_MIN,
          groupsMax: TARGET_GROUPS_MAX,
          creationId,
          status: 'pending',
          askedAt,
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
      this.#pending.release(scopePath)
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
    const run = this.#applyChain.then(() => this.#applyPlanUnsafe(planSig))
    this.#applyChain = run.catch(() => undefined)
    return run
  }

  async #applyPlanUnsafe(planSig: string): Promise<number> {
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
      const live = await this.#currentMembers(segments)
      if (live === null) {
        this.#reject(`could not read ${where} to check the plan against`)
        return 0
      }
      const groups = this.#validate(record.payload?.groups, live)
      if (!groups) return 0

      const move = get<MoveLike>('@diamondcoreprocessor.com/MoveDrone')
      if (!move?.commitMoveInto) {
        this.#reject('the move primitive is unavailable')
        return 0
      }

      // Mint the group tiles first.
      for (const g of groups) EffectBus.emit('cell:added', { cell: g.name, segments: [...segments] })
      await new hypercomb().act()

      // The creation id the ask carried, echoed back in the plan. Absent on a
      // plan minted before creation ids existed — derive nothing in that
      // case, just leave the batch unstamped rather than inventing an id
      // that matches no other tile.
      const creationId = String((record.payload as Record<string, unknown> | undefined)?.['creationId'] ?? '')
      let unstamped = 0

      let landedGroups = 0
      let landedTiles = 0
      for (const g of groups) {
        // AWAIT THE DESTINATION. `act()` returning does NOT mean the group's
        // layer is committed — the committer is a queue machine, so the pulse
        // only guarantees the work was ENQUEUED. Moving into a path that has
        // not landed yet makes commitMoveInto resolve no destination and
        // refuse, silently, for every group: the observed failure was eight
        // group tiles created and not one tile moved into them.
        if (!await this.#awaitLayer([...segments, g.name])) {
          console.warn(`[organize] "${g.name}" never committed — skipping its moves`)
          continue
        }

        // Stamp BEFORE moving. A group that gets stamped and then fails its
        // move is identifiable wreckage; one that moves and then fails to be
        // stamped is indistinguishable from a tile the participant made.
        if (creationId && !await stampCreation([...segments, g.name], creationId, ORGANIZE_TASK, 'group')) unstamped++

        const landed = await move.commitMoveInto(g.members, segments, [...segments, g.name])
        if (landed.length) { landedGroups++; landedTiles += landed.length }
        // A group whose members all refused (name collision at the
        // destination, rewound cursor) leaves an empty group tile rather than
        // a wrong one. Report it; do not quietly delete a tile we just made.
        if (landed.length !== g.members.length) {
          console.warn(`[organize] "${g.name}": ${landed.length}/${g.members.length} tiles moved`)
        }
      }

      const ungrouped = live.size - landedTiles
      EffectBus.emit('toast:show', {
        type: 'tip',
        message: `Organized ${where} into ${landedGroups} group${landedGroups === 1 ? '' : 's'}`
          + (ungrouped > 0 ? ` — ${ungrouped} tile${ungrouped === 1 ? '' : 's'} stayed put.` : '.'),
      })
      console.log(`[organize] ${where}: ${landedGroups} groups, ${landedTiles} tiles moved, ${ungrouped} left in place`
        + (unstamped ? `, ${unstamped} unstamped` : '') + (creationId ? ` [creation ${creationId.slice(0, 12)}…]` : ''))

      await store?.removeOptimization?.(planSig)

      // KEEP GOING UNTIL EVERY LEVEL IS MANAGEABLE. One pass on a very wide
      // layer can still leave a group of thirty, and the participant asked
      // once — they should not have to come back and ask again per group.
      // This terminates: a group is strictly smaller than the layer it came
      // out of, so the recursion is bounded by the original width, and a
      // group at or under the threshold ends it.
      for (const g of groups) {
        if (g.members.length <= ORGANIZE_THRESHOLD) continue
        console.log(`[organize] "${g.name}" still has ${g.members.length} — organizing it too`)
        void this.organizeAt([...segments, g.name], true)
      }

      return landedGroups
    } catch (err) {
      console.warn('[organize] apply failed:', err)
      return 0
    }
  }

  /** Every way a plan can be wrong, checked before anything is written.
   *  Returns null (and reports) rather than applying a plan we don't trust. */
  #validate(raw: unknown, live: ReadonlyMap<string, number>): PlanGroup[] | null {
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
      // A name is an address, so a group named after an EXISTING tile would
      // address that tile rather than mint a new one. One exception, and it
      // is the resume case: an existing tile of that name with NO children is
      // a group tile from a run that minted the groups and then failed to
      // move anything into them. Reusing it finishes the job instead of
      // deadlocking every retry against the wreckage of the last attempt.
      const existingChildren = live.get(name)
      if (existingChildren !== undefined && existingChildren > 0) {
        this.#reject(`the plan wanted a group called "${name}", but a tile of that name already holds ${existingChildren} tiles`)
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

  /** Poll until a layer resolves, or give up. The committer queues work, so a
   *  freshly minted tile exists a moment AFTER the pulse that asked for it. */
  async #awaitLayer(segments: readonly string[], tries = 20, everyMs = 250): Promise<boolean> {
    const history = get<PlacementHistory>('@diamondcoreprocessor.com/HistoryService')
    const lineage = get<LineageLike>('@hypercomb.social/Lineage')
    if (!history || !lineage) return false
    for (let i = 0; i < tries; i++) {
      try {
        if (await resolveCurrentLayer(history, lineage.domain, segments, null)) return true
      } catch { /* not yet */ }
      await new Promise(r => setTimeout(r, everyMs))
    }
    return false
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
  async #currentMembers(segments: readonly string[]): Promise<Map<string, number> | null> {
    const history = get<PlacementHistory>('@diamondcoreprocessor.com/HistoryService')
    const lineage = get<LineageLike>('@hypercomb.social/Lineage')
    if (!history || !lineage) return null
    try {
      const parent = await resolveCurrentLayer(history, lineage.domain, segments, null)
      if (!parent) return null
      const sigs = childSigsOf(parent)
      const names = new Map<string, number>()
      for (const sig of sigs) {
        const child = await history.getLayerBySig(String(sig)) as PlacementLayer | null
        const name = typeof child?.name === 'string' ? child.name : ''
        // A child sig that will not resolve is a COLD MISS, not an absent
        // tile. Organize rewrites membership, so guessing here is exactly the
        // failure that loses a tile — refuse the whole read instead.
        if (!child || !name) {
          console.warn(`[organize] cold miss on child ${String(sig).slice(0, 12)}… — refusing to plan against a partial layer`)
          return null
        }
        names.set(name, childSigsOf(child).length)
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
