// diamondcoreprocessor.com/assistant/atomize.drone.ts
//
// ATOMIZE — GO DEEPER. Break a tile into the pieces that compose it, on
// Claude Haiku's advice, OVER THE BRIDGE. No API key, no direct Anthropic
// call, nothing billed to a pasted key: this mints a `kind:'ask'`
// optimization (exactly the record /opus, /sonnet, /haiku mint — see
// llm.queen.ts) carrying `task:'atomize'`, and a bridge-connected Claude Code
// session drains it and CREATES the parts as tiles. The hive asks; the parked
// session builds.
//
// THE UNIT IS A TILE, AND THE TILE MUST BE A LEAF. Atomize never runs against
// "the page as a topic", and it DOES NOTHING to a tile that already has
// children — that tile has been broken down, and re-atomizing it would widen
// a level instead of deepening anything. One ask per leaf, foreach:
//   • `tile:action` action:'expand' — the tile quick-menu: that one tile.
//   • `/atomize` with a selection — foreach selected tile.
//   • `/atomize` with nothing selected — foreach tile ON the current layer.
// Branches are skipped at every door and the skip is reported, never silent.
//
// Atomize is NOT organize. Organize goes the other way — it mints no leaves,
// it inserts a level and re-homes existing children into groups, which is
// what makes a crowded level manageable. See organize.drone.ts.
//
// `task:'atomize'` is what tells the responder this ask asks for STRUCTURE,
// not a note — the one sanctioned exception to "never introduce tiles to
// answer a question" (see .claude/skills/bridge-listen/SKILL.md).
import { Drone, EffectBus, normalizeCell } from '@hypercomb/core'
import { childSigsOf, resolveCurrentLayer, type PlacementHistory, type PlacementLayer } from '../history/layer-placement.js'

/** Upper bound on the parts a responder should mint for one tile. */
const SUBTOPIC_COUNT = 7

/** Optimization kind for a user→Claude ask. The bridge ask-loop lists this. */
const ASK_KIND = 'ask'

/** Payload discriminator: this ask asks for tiles, not a note. */
const ATOMIZE_TASK = 'atomize'

/** The model hint carried to the responder. Atomize is a decomposition —
 *  cheap, structural, high-volume — so it asks the Haiku tier by name. */
const ATOMIZE_MODEL = 'haiku'

type TileActionPayload = { action: string; label: string; q: number; r: number; index: number }

type StoreLike = { putOptimization?: (blob: Blob) => Promise<string> }
type LineageLike = { explorerSegments?: () => readonly string[]; domain?: unknown }

/** One tile on the current layer, with enough to tell a leaf from a branch. */
type LayerChild = { name: string; children: readonly string[] }

export class AtomizeDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'assistant'
  override description = 'asks Claude Haiku (over the bridge) to break tiles into the pieces that compose them'

  protected override deps = {
    lineage: '@hypercomb.social/Lineage',
    navigation: '@hypercomb.social/Navigation',
    store: '@hypercomb.social/Store',
  }

  protected override listens = ['tile:action', 'atomize:layer']
  protected override emits = ['ask:queued', 'toast:show']

  #effectsRegistered = false

  /** Mints are SERIALIZED, not dropped. A foreach fires N calls back to back
   *  and every one of them must land — a `#busy` boolean would silently keep
   *  the first and discard the rest, which reads as "atomize only did one
   *  tile". Each mint chains onto the last. */
  #chain: Promise<unknown> = Promise.resolve()

  protected override heartbeat = async (): Promise<void> => {
    if (this.#effectsRegistered) return
    this.#effectsRegistered = true

    this.onEffect<TileActionPayload>('tile:action', (payload) => {
      if (payload.action !== 'expand') return
      void this.atomizeTile(payload.label)
    })

    this.onEffect('atomize:layer', () => {
      void this.atomizeLayer()
    })
  }

  /** Atomize ONE tile — but ONLY if it is a leaf.
   *
   *  ATOMIZE DOES NOTHING TO A TILE THAT HAS CHILDREN. It is the operation
   *  that gives a leaf its first level; a tile that already has one has been
   *  broken down, and re-atomizing it would grow the layer sideways rather
   *  than deepen anything. Going deeper there means atomizing ITS leaves, and
   *  making a crowded level manageable is /organize's job, not this one.
   *
   *  `isLeaf` short-circuits the lookup for callers that already walked the
   *  layer; everyone else pays one read so the rule holds at every door
   *  (slash, quick-menu, foreach). */
  async atomizeTile(rawLabel: string, isLeaf?: boolean): Promise<boolean> {
    const label = normalizeCell(rawLabel) || String(rawLabel ?? '').trim()
    if (!label) return false

    const segments = this.#segments()

    if (isLeaf !== true) {
      const own = await this.#currentChildren([...segments, label])
      if (own === null) {
        console.warn(`[atomize] could not read "${label}" — refusing rather than guessing it is a leaf`)
        return false
      }
      if (own.length > 0) {
        console.log(`[atomize] "${label}" already has ${own.length} children — nothing to do`)
        return false
      }
    }

    const prompt =
      `Atomize the tile "${label}". Work out its constituent parts — the smaller, more `
      + `specific pieces that compose it, each concrete enough to explore on its own — and `
      + `CREATE them as child tiles of "${label}". At most ${SUBTOPIC_COUNT}; unique, `
      + `non-overlapping, concrete constituents rather than vague categories; short 1–3 word `
      + `names. "${label}" has no children yet — this gives it its first level. `
      + `This ask asks for tiles, not a note.`

    return this.#queue(prompt, [label], segments)
  }

  /** Atomize THE CURRENT LAYER = foreach tile on it, atomize that tile.
   *  Tiles that already have children are skipped: atomize deepens leaves,
   *  and a branch was already broken down. Returns how many asks landed. */
  async atomizeLayer(): Promise<number> {
    const segments = this.#segments()
    const children = await this.#currentChildren(segments)
    const where = segments.length ? `/${segments.join('/')}` : 'this hive'

    if (children === null) {
      EffectBus.emit('toast:show', { type: 'tip', message: `Could not read ${where} — nothing atomized.` })
      return 0
    }

    const leaves = children.filter(c => c.children.length === 0)
    const branches = children.length - leaves.length

    if (leaves.length === 0) {
      EffectBus.emit('toast:show', {
        type: 'tip',
        message: children.length
          ? `Every tile on ${where} already has children — select the ones to atomize.`
          : `Nothing on ${where} to atomize.`,
      })
      return 0
    }

    let queued = 0
    for (const leaf of leaves) {
      // Leafness already established by the walk — skip the re-read.
      if (await this.atomizeTile(leaf.name, true)) queued++
    }

    // Say what was SKIPPED — a foreach that quietly covered less than the
    // layer reads as "it did everything" when it didn't.
    EffectBus.emit('toast:show', {
      type: 'tip',
      message: `Atomizing ${queued} tile${queued === 1 ? '' : 's'} on ${where}`
        + (branches ? ` (${branches} already had children — skipped)` : '')
        + ' — Haiku is working out the parts.',
    })
    console.log(`[atomize] layer ${where}: ${queued} queued, ${branches} skipped (already branches)`)
    return queued
  }

  // ── the ask ──────────────────────────────────────────────

  /** Mint the ask record. Same shape as LlmQueenBee.submitAsk — content-
   *  addressed, participant-local, never shared — plus the `task`/`existing`
   *  fields that make it an atomize rather than a question. */
  #queue(
    prompt: string,
    targets: readonly string[],
    segments: readonly string[],
  ): Promise<boolean> {
    const run = this.#chain.then(async (): Promise<boolean> => {
      try {
        const store = get<StoreLike>('@hypercomb.social/Store')
        if (!store?.putOptimization) {
          console.warn('[atomize] Store.putOptimization unavailable')
          return false
        }

        const record = {
          kind: ASK_KIND,
          appliesTo: targets.length ? [...targets] : [...segments],
          payload: {
            task: ATOMIZE_TASK,
            prompt,
            model: ATOMIZE_MODEL,
            targets: [...targets],
            segments: [...segments],
            // Always a leaf by the time an atomize is minted — stated so the
            // responder never has to wonder whether to merge with siblings.
            existing: [],
            count: SUBTOPIC_COUNT,
            status: 'pending',
            askedAt: Date.now(),
          },
          mark: 'persistent',
        }

        const sig = await store.putOptimization(
          new Blob([JSON.stringify(record)], { type: 'application/json' }),
        )

        // Same surfacing as any other ask: the command line raises a pending
        // pill off ask:queued and drops it when the answer lands.
        EffectBus.emit('ask:queued', { sig, prompt, targets: [...targets], model: ATOMIZE_MODEL })
        console.log(`[atomize] queued (${ATOMIZE_MODEL}): ${targets.join(', ')}  [${sig.slice(0, 12)}…]`)
        return true
      } catch (err) {
        console.warn('[atomize] failed to queue:', err)
        return false
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
   *  instead of silently atomizing nothing). A child sig that will not
   *  resolve is DROPPED from the foreach rather than guessed at: atomize only
   *  ever ADDS, so the cost of missing one is a tile that didn't get deepened,
   *  and the cost of guessing would be an ask against a tile we can't see. */
  async #currentChildren(segments: readonly string[]): Promise<LayerChild[] | null> {
    const history = get<PlacementHistory>('@diamondcoreprocessor.com/HistoryService')
    const lineage = get<LineageLike>('@hypercomb.social/Lineage')
    if (!history || !lineage) return null
    try {
      const parent = await resolveCurrentLayer(history, lineage.domain, segments, null)
      if (!parent) return null

      const out: LayerChild[] = []
      for (const sig of childSigsOf(parent)) {
        const child = await history.getLayerBySig(String(sig)) as PlacementLayer | null
        const name = typeof child?.name === 'string' ? child.name : ''
        if (!child || !name) continue
        out.push({ name, children: childSigsOf(child) })
      }
      return out
    } catch (err) {
      console.warn('[atomize] could not read the current layer:', err)
      return null
    }
  }
}

const _atomize = new AtomizeDrone()
window.ioc.register('@diamondcoreprocessor.com/AtomizeDrone', _atomize)
console.log('[AtomizeDrone] Loaded')
