// diamondcoreprocessor.com/assistant/break-apart.drone.ts
//
// BREAK APART — GO DEEPER. Break a tile into the pieces that compose it, on
// Claude Haiku's advice, OVER THE BRIDGE. No API key, no direct Anthropic
// call, nothing billed to a pasted key: this mints a `kind:'ask'`
// optimization (exactly the record /opus, /sonnet, /haiku mint — see
// llm.queen.ts) carrying `task:'break-apart'`, and a bridge-connected Claude
// Code session drains it and CREATES the parts as tiles. The hive asks; the
// parked session builds.
//
// ONE GESTURE, TWO OPERATIONS — the drone picks. Standing on a page of 80
// tiles and thinking "this needs breaking up" is a single intent; the
// participant should not have to know that thinning a level and deepening a
// leaf are different acts. A CROWDED layer (> ORGANIZE_THRESHOLD children)
// routes to /organize, which then cascades into its own groups until every
// level is manageable. Only an uncrowded layer is broken apart.
//
// THE UNIT IS A TILE, AND THE TILE MUST BE A LEAF. Break apart never runs
// against "the page as a topic", and it DOES NOTHING to a tile that already
// has children — that tile has been broken down, and breaking it apart again
// would widen a level instead of deepening anything. One ask per leaf,
// foreach:
//   • `tile:action` action:'expand' — the tile quick-menu: that one tile.
//   • `/break-apart` with a selection — foreach selected tile.
//   • `/break-apart` with nothing selected — foreach tile ON the current layer.
// Branches are skipped at every door and the skip is reported, never silent.
//
// Break apart is NOT organize. Organize goes the other way — it mints no
// leaves, it inserts a level and re-homes existing children into groups,
// which is what makes a crowded level manageable. See organize.drone.ts.
//
// `task:'break-apart'` is what tells the responder this ask asks for
// STRUCTURE, not a note — the one sanctioned exception to "never introduce
// tiles to answer a question" (see .claude/skills/bridge-listen/SKILL.md).
import { Drone, EffectBus, normalizeCell } from '@hypercomb/core'
import { readChildrenStrict, type PlacementHistory } from '../history/layer-placement.js'
import { PendingAskIndex } from './ask-scope.js'
import { ORGANIZE_THRESHOLD } from './organize.drone.js'
import { mintCreationId } from './creation.js'
import { ReceiptBuilder, describeReceipt } from './receipt.js'

/** Upper bound on the parts a responder should mint for one tile. */
const SUBTOPIC_COUNT = 7

/** Optimization kind for a user→Claude ask. The bridge ask-loop lists this. */
const ASK_KIND = 'ask'

/** Payload discriminator: this ask asks for tiles, not a note. */
const BREAK_APART_TASK = 'break-apart'

/** The model hint carried to the responder. Break apart is a decomposition —
 *  cheap, structural, high-volume — so it asks the Haiku tier by name. */
const BREAK_APART_MODEL = 'haiku'

type TileActionPayload = { action: string; label: string; q: number; r: number; index: number }

type StoreLike = { putOptimization?: (blob: Blob) => Promise<string> }
type LineageLike = { explorerSegments?: () => readonly string[]; domain?: unknown }

/** One tile on the current layer, with enough to tell a leaf from a branch. */
type LayerChild = { name: string; childCount: number }

/** Why a tile was or wasn't asked about. A caller reporting to the
 *  participant needs the REASON — "3 of 8" with no explanation is the kind of
 *  silent shortfall that reads as a bug. */
/** Wording for every way a break-apart can decline. Exported so the slash
 *  provider phrases the selection case identically — two doors, one voice. */
export const BREAK_APART_SKIP_LABELS: Record<string, (n: number) => string> = {
  'has-children': n => `${n} already had children`,
  'already-queued': n => `${n} already queued`,
  'ancestor-busy': n => `${n} waiting on a parent already being reshaped`,
  'failed': n => `${n} could not be read`,
}

export type BreakApartOutcome = 'queued' | 'has-children' | 'already-queued' | 'ancestor-busy' | 'failed'

export class BreakApartDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'assistant'
  override description = 'asks Claude Haiku (over the bridge) to break tiles into the pieces that compose them'

  protected override deps = {
    lineage: '@hypercomb.social/Lineage',
    navigation: '@hypercomb.social/Navigation',
    store: '@hypercomb.social/Store',
  }

  protected override listens = ['tile:action', 'break-apart:layer']
  protected override emits = ['ask:queued', 'toast:show']

  #effectsRegistered = false

  /** Mints are SERIALIZED, not dropped. A foreach fires N calls back to back
   *  and every one of them must land — a `#busy` boolean would silently keep
   *  the first and discard the rest, which reads as "break apart only did
   *  one tile". Each mint chains onto the last. */
  #chain: Promise<unknown> = Promise.resolve()

  /** One structural ask per branch. A break-apart holds the subtree UNDER its
   *  target, so siblings run together but a tile whose ancestor is already
   *  being reshaped waits — that ancestor may move it. */
  #pending = new PendingAskIndex()

  protected override heartbeat = async (): Promise<void> => {
    if (this.#effectsRegistered) return
    this.#effectsRegistered = true

    this.onEffect<TileActionPayload>('tile:action', (payload) => {
      if (payload.action !== 'expand') return
      void this.breakApartTile(payload.label)
    })

    this.onEffect('break-apart:layer', () => {
      void this.breakApartLayer()
    })
  }

  /** Break apart ONE tile — but ONLY if it is a leaf.
   *
   *  BREAKING APART DOES NOTHING TO A TILE THAT HAS CHILDREN. It is the operation
   *  that gives a leaf its first level; a tile that already has one has been
   *  broken down, and breaking it apart again would grow the layer sideways rather
   *  than deepen anything. Going deeper there means breaking apart ITS leaves, and
   *  making a crowded level manageable is /organize's job, not this one.
   *
   *  `isLeaf` short-circuits the lookup for callers that already walked the
   *  layer; everyone else pays one read so the rule holds at every door
   *  (slash, quick-menu, foreach). */
  async breakApartTile(rawLabel: string, isLeaf?: boolean): Promise<BreakApartOutcome> {
    const label = normalizeCell(rawLabel) || String(rawLabel ?? '').trim()
    if (!label) return 'failed'

    const segments = this.#segments()

    if (isLeaf !== true) {
      const own = await this.#currentChildren([...segments, label])
      if (own === null) {
        console.warn(`[break-apart] could not read "${label}" — refusing rather than guessing it is a leaf`)
        return 'failed'
      }
      if (own.length > 0) {
        console.log(`[break-apart] "${label}" already has ${own.length} children — nothing to do`)
        return 'has-children'
      }
    }

    const prompt =
      `Break apart the tile "${label}". Work out its constituent parts — the smaller, more `
      + `specific pieces that compose it, each concrete enough to explore on its own — and `
      + `CREATE them as child tiles of "${label}". At most ${SUBTOPIC_COUNT}; unique, `
      + `non-overlapping, concrete constituents rather than vague categories; short 1–3 word `
      + `names. "${label}" has no children yet — this gives it its first level. `
      + `This ask asks for tiles, not a note.`

    return this.#queue(prompt, [label], segments)
  }

  /** Break apart THE CURRENT LAYER = foreach tile on it, break that tile apart.
   *  Tiles that already have children are skipped: break apart deepens leaves,
   *  and a branch was already broken down. Returns how many asks landed. */
  async breakApartLayer(): Promise<number> {
    const segments = this.#segments()
    const children = await this.#currentChildren(segments)
    const where = segments.length ? `/${segments.join('/')}` : 'this hive'

    if (children === null) {
      EffectBus.emit('toast:show', { type: 'tip', message: `Could not read ${where} — nothing broken apart.` })
      return 0
    }

    // CROWDED LAYERS ORGANIZE THEMSELVES. Standing on a page of 80 tiles and
    // thinking "this needs breaking up" is ONE intent, and the participant
    // should not have to know that thinning a level and deepening a leaf are
    // two different operations. Too many children means the layer needs a
    // level inserted, not eighty leaves deepened — so route there and let the
    // rest happen without them.
    if (children.length > ORGANIZE_THRESHOLD) {
      EffectBus.emit('toast:show', {
        type: 'tip',
        message: `${where} has ${children.length} tiles — grouping them first, then the groups can be broken down.`,
      })
      console.log(`[break-apart] ${where} is crowded (${children.length}) — routing to organize`)
      EffectBus.emit('organize:layer', {})
      return 0
    }

    const leaves = children.filter(c => c.childCount === 0)
    const branches = children.length - leaves.length

    if (leaves.length === 0) {
      EffectBus.emit('toast:show', {
        type: 'tip',
        message: children.length
          ? `Every tile on ${where} already has children — select the ones to break apart.`
          : `Nothing on ${where} to break apart.`,
      })
      return 0
    }

    // One receipt: the count and the reasons come from the same place, so
    // a shortfall can never be reported without its explanation.
    const receipt = new ReceiptBuilder()
    for (const branch of children.filter(c => c.childCount > 0)) {
      void branch
      receipt.skipped('has-children')
    }
    for (const leaf of leaves) {
      // Leafness already established by the walk — skip the re-read.
      const outcome = await this.breakApartTile(leaf.name, true)
      if (outcome === 'queued') receipt.landed()
      else receipt.skipped(outcome)
    }

    const r = receipt.build()
    EffectBus.emit('toast:show', {
      type: 'tip',
      message: describeReceipt(r, 'Breaking apart', 'tile', BREAK_APART_SKIP_LABELS)
        + (r.landed ? ' — Haiku is working out the parts.' : ''),
    })
    console.log(`[break-apart] layer ${where}: ${r.landed}/${r.attempted}`, Object.fromEntries(r.skipped))
    return r.landed
  }

  // ── the ask ──────────────────────────────────────────────

  /** Mint the ask record. Same shape as LlmQueenBee.submitAsk — content-
   *  addressed, participant-local, never shared — plus the `task`/`existing`
   *  fields that make it a break-apart rather than a question. */
  #queue(
    prompt: string,
    targets: readonly string[],
    segments: readonly string[],
  ): Promise<BreakApartOutcome> {
    // The subtree this ask reshapes: a break-apart creates children UNDER its
    // target, so the branch it holds is the target's own path. Siblings
    // therefore never collide and a foreach over a layer runs in parallel.
    const scopePath = targets.length ? [...segments, targets[0]] : [...segments]

    const askedAt = Date.now()
    const run = this.#chain.then(async (): Promise<BreakApartOutcome> => {
      try {
        const store = get<StoreLike>('@hypercomb.social/Store')
        if (!store?.putOptimization) {
          console.warn('[break-apart] Store.putOptimization unavailable')
          return 'failed'
        }

        const held = await this.#pending.conflict(scopePath)
        if (held) {
          const same = held.path.length === scopePath.length
          console.log(
            `[break-apart] /${scopePath.join('/')} is held by a pending ${held.task}`
            + ` at /${held.path.join('/')} — not asking`,
          )
          return same && held.task === BREAK_APART_TASK ? 'already-queued' : 'ancestor-busy'
        }
        // Claim BEFORE the write: a foreach runs faster than the pool scan
        // it would otherwise re-read, and would double-mint the same branch.
        this.#pending.claim(BREAK_APART_TASK, scopePath)

        // One id for every part this act creates. These part tiles are made by
        // the RESPONDER over the bridge, so the id travels in the ask and the
        // responder stamps with it — same batch identity either side.
        const creationId = await mintCreationId(BREAK_APART_TASK, scopePath, askedAt)

        const record = {
          kind: ASK_KIND,
          appliesTo: targets.length ? [...targets] : [...segments],
          payload: {
            task: BREAK_APART_TASK,
            prompt,
            model: BREAK_APART_MODEL,
            targets: [...targets],
            segments: [...segments],
            // The branch this ask holds — read by the conflict index so an
            // ancestor being reshaped blocks it (see ask-scope.ts).
            scopePath,
            // Always a leaf by the time a break-apart is minted — stated so the
            // responder never has to wonder whether to merge with siblings.
            existing: [],
            count: SUBTOPIC_COUNT,
            creationId,
            status: 'pending',
            askedAt,
          },
          mark: 'persistent',
        }

        const sig = await store.putOptimization(
          new Blob([JSON.stringify(record)], { type: 'application/json' }),
        )

        // Same surfacing as any other ask: the command line raises a pending
        // pill off ask:queued and drops it when the answer lands.
        EffectBus.emit('ask:queued', { sig, prompt, targets: [...targets], model: BREAK_APART_MODEL })
        console.log(`[break-apart] queued (${BREAK_APART_MODEL}): ${targets.join(', ')}  [${sig.slice(0, 12)}…]`)
        return 'queued'
      } catch (err) {
        // The claim named an ask that never landed — let the request through
        // next time rather than blocking it until the cache expires.
        this.#pending.release(scopePath)
        console.warn('[break-apart] failed to queue:', err)
        return 'failed'
      }
    })
    // The chain must survive a rejected link, or one bad mint stalls every
    // later one. `run` already swallows its own errors; this is belt-and-brace.
    this.#chain = run.catch(() => undefined)
    return run
  }

  // ── context ──────────────────────────────────────────────

  #segments(): readonly string[] {
    const lineage = get<LineageLike>('@hypercomb.social/Lineage')
    return (lineage?.explorerSegments?.() ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
  }

  /** The tiles on the current layer, each with its own child sigs so a leaf
   *  can be told from a branch. `null` = the layer could not be read at all
   *  (never confuse that with "the layer is empty" — the caller reports it
   *  instead of silently breaking nothing apart). A child sig that will not
   *  resolve is DROPPED from the foreach rather than guessed at: break apart only
   *  ever ADDS, so the cost of missing one is a tile that didn't get deepened,
   *  and the cost of guessing would be an ask against a tile we can't see. */
  /** The tiles on a layer, strictly. `null` means "could not see it", never
   *  "it is empty" — the distinction that keeps a cold pool miss from being
   *  read as an absent tile. Delegates to the ONE strict read so this path
   *  cannot drift from the guard the doctrine requires. */
  async #currentChildren(segments: readonly string[]): Promise<LayerChild[] | null> {
    const history = get<PlacementHistory>('@diamondcoreprocessor.com/HistoryService')
    const lineage = get<LineageLike>('@hypercomb.social/Lineage')
    if (!history || !lineage) return null
    const rows = await readChildrenStrict(history, lineage.domain, segments)
    if (rows === null) return null
    return rows.map(r => ({ name: r.name, childCount: r.childCount }))
  }

}

const _breakApart = new BreakApartDrone()
window.ioc.register('@diamondcoreprocessor.com/BreakApartDrone', _breakApart)
console.log('[BreakApartDrone] Loaded')
