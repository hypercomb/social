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
import { readChildrenStrict, type PlacementHistory } from '../history/layer-placement.js'
import { PendingAskIndex } from './ask-scope.js'
import { mintCreationId, stampCreation } from './creation.js'
import { ReceiptBuilder, describeReceipt } from './receipt.js'

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
type CommitterLike = {
  /** COMMIT ACKNOWLEDGEMENT — resolves when queued commits have actually run. */
  settled?: () => Promise<void>
}
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

  /** A previewed plan waiting on confirmation. Held, not applied. */
  heldPlanSig: string | null = null

  /** One structural ask per branch. Organize holds the WHOLE layer it stands
   *  on, because it re-homes that layer's children — so it conflicts with a
   *  second organize there AND with any atomize on a tile inside it, whose
   *  target would move out from under the responder mid-flight. */
  #pending = new PendingAskIndex()

  protected override heartbeat = async (): Promise<void> => {
    if (this.#effectsRegistered) return
    this.#effectsRegistered = true

    this.onEffect<{ preview?: boolean }>('organize:layer', (payload) => {
      void this.organizeLayer(payload?.preview === true)
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
  async organizeLayer(preview = false): Promise<boolean> {
    return this.organizeAt(this.#segments(), false, preview)
  }

  /** Organize a NAMED layer. Same act, explicit location — used by the
   *  cascade, which organizes a group it just created rather than wherever
   *  the participant happens to be standing by then. `quiet` suppresses the
   *  "already manageable" toast: a cascade probing its own groups is not
   *  something the participant asked about tile by tile. */
  async organizeAt(segments: readonly string[], quiet = false, preview = false): Promise<boolean> {
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
      + `"groups":[{"name":"<group>","members":["<tile>","<tile>"]}]${preview ? ',"preview":true' : ''}}}\n`
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
          ...(preview ? { preview: true } : {}),
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

  /** Run a plan that was previewed and held. Re-reads and re-validates it
   *  against the layer as it is NOW — a plan approved a minute ago is still
   *  a plan about a layer that may have changed since. */
  async applyHeldPlan(): Promise<number> {
    const sig = this.heldPlanSig
    if (!sig) {
      EffectBus.emit('toast:show', { type: 'tip', message: 'No plan is waiting — run /organize first.' })
      return 0
    }
    const store = get<StoreLike>('@hypercomb.social/Store')
    const blob = await store?.getOptimization?.(sig)
    if (!blob) {
      this.heldPlanSig = null
      EffectBus.emit('toast:show', { type: 'tip', message: 'The held plan is gone — run /organize again.' })
      return 0
    }
    try {
      const rec = JSON.parse(await blob.text()) as { payload?: Record<string, unknown> }
      if (rec.payload) delete rec.payload['preview']
      const fresh = await store?.putOptimization?.(
        new Blob([JSON.stringify(rec)], { type: 'application/json' }))
      await store?.removeOptimization?.(sig)
      this.heldPlanSig = null
      return fresh ? await this.applyPlan(fresh) : 0
    } catch (err) {
      console.warn('[organize] could not apply the held plan:', err)
      return 0
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

      // PLAN BEFORE APPLY. The plan is a separate, inspectable artifact that
      // exists before anything moves — which is the only reason the failed run
      // was diagnosable at all, and the only reason a bad plan could be held
      // back rather than discovered afterwards.
      //
      // `preview` makes that reviewable instead of implicit: the plan is fully
      // validated against the LIVE layer, reported, and left in the pool. Say
      // `/organize apply` to run the held plan. Nothing is created, nothing
      // moves, and an invalid plan still fails here rather than in front of
      // the participant.
      if ((record.payload as Record<string, unknown> | undefined)?.['preview'] === true) {
        const lines = groups.map(g => `${g.name} (${g.members.length})`).join(', ')
        const placed = groups.reduce((n, g) => n + g.members.length, 0)
        EffectBus.emit('toast:show', {
          type: 'tip',
          message: `Plan for ${where}: ${groups.length} groups — ${lines}.`
            + ` ${placed} of ${live.size} tiles placed. Nothing moved yet — /organize apply to run it.`,
        })
        console.log(`[organize] PREVIEW ${where}:`, groups.map(g => [g.name, g.members]))
        this.heldPlanSig = planSig
        return 0
      }

      const move = get<MoveLike>('@diamondcoreprocessor.com/MoveDrone')
      if (!move?.commitMoveInto) {
        this.#reject('the move primitive is unavailable')
        return 0
      }

      // Mint the group tiles first.
      for (const g of groups) EffectBus.emit('cell:added', { cell: g.name, segments: [...segments] })
      await new hypercomb().act()
      // THE WRITE LANDED, not "the write was asked for". act() only queues;
      // moving into a destination that has not committed silently refuses.
      await this.#awaitCommits()

      // The creation id the ask carried, echoed back in the plan. Absent on a
      // plan minted before creation ids existed — derive nothing in that
      // case, just leave the batch unstamped rather than inventing an id
      // that matches no other tile.
      const creationId = String((record.payload as Record<string, unknown> | undefined)?.['creationId'] ?? '')
      let unstamped = 0

      const receipt = new ReceiptBuilder()
      let landedTiles = 0
      for (const g of groups) {
        if (creationId && !await stampCreation([...segments, g.name], creationId, ORGANIZE_TASK, 'group')) {
          console.warn(`[organize] "${g.name}" could not be stamped`)
        }
        const landed = await move.commitMoveInto(g.members, segments, [...segments, g.name])
        landedTiles += landed.length
        if (landed.length === g.members.length) receipt.landed()
        else if (landed.length === 0) receipt.skipped('refused every move')
        else receipt.skipped('partly moved')
      }

      const r = receipt.build()
      const ungrouped = live.size - landedTiles
      EffectBus.emit('toast:show', {
        type: 'tip',
        message: describeReceipt(r, 'Organized into', 'group')
          + (ungrouped > 0 ? ` — ${ungrouped} tile${ungrouped === 1 ? '' : 's'} stayed put.` : '.'),
      })
      console.log(`[organize] ${where}: ${r.landed}/${r.attempted} groups, ${landedTiles} tiles moved`,
        Object.fromEntries(r.skipped), creationId ? `[creation ${creationId.slice(0, 12)}…]` : '')

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

      return r.landed
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

  /** Wait for the commits already queued to actually land.
   *
   *  This used to poll for each group layer to appear, because nothing could
   *  answer "has the queue drained?". The committer can now say so directly,
   *  which replaces a 20x250ms guess with the fact. */
  async #awaitCommits(): Promise<void> {
    const committer = get<CommitterLike>('@diamondcoreprocessor.com/LayerCommitter')
    if (!committer?.settled) {
      console.warn('[organize] committer cannot acknowledge commits — proceeding unverified')
      return
    }
    await committer.settled()
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
  /** The tiles on a layer, name → child count. `null` means "could not see
   *  it", NEVER "it is empty" — organize rewrites membership, so collapsing
   *  those two is exactly how a tile gets permanently dropped. The guard
   *  lives in readChildrenStrict; this only shapes the result. */
  async #currentMembers(segments: readonly string[]): Promise<Map<string, number> | null> {
    const history = get<PlacementHistory>('@diamondcoreprocessor.com/HistoryService')
    const lineage = get<LineageLike>('@hypercomb.social/Lineage')
    if (!history || !lineage) return null
    const rows = await readChildrenStrict(history, lineage.domain, segments)
    if (rows === null) return null
    return new Map(rows.map(r => [r.name, r.childCount]))
  }

}

const _organize = new OrganizeDrone()
window.ioc.register('@diamondcoreprocessor.com/OrganizeDrone', _organize)
console.log('[OrganizeDrone] Loaded')
