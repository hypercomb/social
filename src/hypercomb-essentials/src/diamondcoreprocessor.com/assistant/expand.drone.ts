// diamondcoreprocessor.com/assistant/expand.drone.ts
//
// EXPAND — GO WIDER. Grow the CURRENT layer with new sibling tiles that
// extend its subject, on Claude Haiku's advice, OVER THE BRIDGE. No API key,
// no direct Anthropic call: this mints a `kind:'ask'` optimization (the same
// record /opus, /sonnet, /haiku mint — see llm.queen.ts) carrying
// `task:'expand'`, and a bridge-connected Claude Code session drains it,
// looks at the tree as it stands, and CREATES the expansions as tiles ON the
// layer. The hive asks; the parked session builds.
//
// The three structural verbs, side by side:
//   • break-apart — go DEEPER: give a leaf its first level of parts
//   • organize — go SHALLOWER: insert a level, re-home a crowded layer
//   • expand   — go WIDER:   add new siblings the subject is missing
//
// THE UNIT IS THE LAYER. Expand never targets a single tile — deepening one
// tile is break-apart's job. It reads what the layer ALREADY holds (the `existing`
// list rides in the ask so nothing is duplicated) and asks for the concrete
// aspects of the subject that are NOT yet represented. Standing on a page
// about a subject you are interested in and wanting more of it is the whole
// gesture: /expand, and the layer grows.
//
// A CROWDED layer refuses rather than widening the problem: more than
// ORGANIZE_THRESHOLD children means the level needs grouping, not growth, and
// silently routing a "give me more" into a reshuffle would not be what the
// participant asked for — so it declines and names /organize instead.
//
// `task:'expand'` is what tells the responder this ask asks for STRUCTURE,
// not a note — the same sanctioned exception break-apart uses (see
// .claude/skills/bridge-listen/SKILL.md).
import { Drone, EffectBus } from '@hypercomb/core'
import { readChildrenStrict, type PlacementHistory } from '../history/layer-placement.js'
import { PendingAskIndex } from './ask-scope.js'
import { ORGANIZE_THRESHOLD } from './organize.drone.js'
import { mintCreationId } from './creation.js'

/** Upper bound on the new tiles a responder should mint for one expand. */
const EXPANSION_COUNT = 7

/** Optimization kind for a user→Claude ask. The bridge ask-loop lists this. */
const ASK_KIND = 'ask'

/** Payload discriminator: this ask asks for tiles, not a note. */
const EXPAND_TASK = 'expand'

/** The model hint carried to the responder. Expansion is structural and
 *  high-volume like break-apart, so it asks the Haiku tier by name. */
const EXPAND_MODEL = 'haiku'

type StoreLike = { putOptimization?: (blob: Blob) => Promise<string> }
type LineageLike = { explorerSegments?: () => readonly string[]; domain?: unknown }

export class ExpandDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'assistant'
  override description = 'asks Claude Haiku (over the bridge) to grow the current layer with new tiles that extend its subject'

  protected override deps = {
    lineage: '@hypercomb.social/Lineage',
    store: '@hypercomb.social/Store',
  }

  protected override listens = ['expand:layer']
  protected override emits = ['ask:queued', 'toast:show']

  #effectsRegistered = false

  /** One structural ask per branch. An expand ADDS children to the layer it
   *  stands on, so the branch it holds is the layer itself — a second expand
   *  there is already-queued, and an organize there would re-home tiles out
   *  from under the responder's `existing` snapshot. */
  #pending = new PendingAskIndex()

  protected override heartbeat = async (): Promise<void> => {
    if (this.#effectsRegistered) return
    this.#effectsRegistered = true

    this.onEffect<{ focus?: string }>('expand:layer', (payload) => {
      void this.expandLayer(String(payload?.focus ?? '').trim())
    })
  }

  /** Expand THE CURRENT LAYER: ask for new sibling tiles that extend its
   *  subject, informed by everything already on it. `focus` narrows the
   *  direction ("/expand growing techniques") — empty means the whole
   *  subject. Returns true when the ask landed. */
  async expandLayer(focus = ''): Promise<boolean> {
    const segments = this.#segments()
    const where = segments.length ? `/${segments.join('/')}` : 'this hive'
    const subject = segments.length ? segments[segments.length - 1] : 'the hive root'

    const children = await this.#currentChildren(segments)
    if (children === null) {
      EffectBus.emit('toast:show', { type: 'tip', message: `Could not read ${where} — nothing expanded.` })
      return false
    }

    // A crowded layer does not get wider. Unlike break-apart (where "break this
    // up" and "group this" are one intent), asking for MORE on a page that
    // already has too much is a request worth declining out loud.
    if (children.length > ORGANIZE_THRESHOLD) {
      EffectBus.emit('toast:show', {
        type: 'tip',
        message: `${where} already has ${children.length} tiles — /organize it into groups first, then expand the group you care about.`,
      })
      return false
    }

    const scopePath = [...segments]
    const askedAt = Date.now()

    const prompt =
      `Expand the layer ${where}. Its subject is "${subject}"`
      + (focus ? `, and the participant is especially interested in: ${focus}` : '')
      + `. Look at the tree — what it already holds is listed in \`existing\` (verify against the `
      + `live layer, and read the tiles' notes over the bridge when the names alone don't say enough). `
      + `Work out the concrete aspects of the subject that are NOT yet represented, and CREATE them as `
      + `new tiles ON this layer, siblings of the existing ones. At most ${EXPANSION_COUNT}; unique, `
      + `non-overlapping with each other AND with everything already there; short 1–3 word names; `
      + `concrete aspects worth exploring rather than vague categories. Fewer is correct when the `
      + `subject is already well covered — zero is a valid answer. `
      + `This ask asks for tiles, not a note.`

    try {
      const store = get<StoreLike>('@hypercomb.social/Store')
      if (!store?.putOptimization) {
        console.warn('[expand] Store.putOptimization unavailable')
        return false
      }

      const held = await this.#pending.conflict(scopePath)
      if (held) {
        const same = held.path.length === scopePath.length && held.task === EXPAND_TASK
        EffectBus.emit('toast:show', {
          type: 'tip',
          message: same
            ? `${where} is already being expanded — waiting on that.`
            : `Can't expand ${where} yet — /${held.path.join('/')} is being ${held.task}d.`,
        })
        return false
      }
      this.#pending.claim(EXPAND_TASK, scopePath)

      // One id for every tile this act creates. The responder stamps with it
      // — same batch identity either side of the bridge.
      const creationId = await mintCreationId(EXPAND_TASK, scopePath, askedAt)

      const record = {
        kind: ASK_KIND,
        appliesTo: [...segments],
        payload: {
          task: EXPAND_TASK,
          prompt,
          model: EXPAND_MODEL,
          targets: [],
          segments: [...segments],
          // What the layer already holds — the responder extends, never
          // duplicates. Captured at mint time; the responder re-reads live.
          existing: children.map(c => c.name),
          // The branch this ask holds — the layer it grows (see ask-scope.ts).
          scopePath,
          ...(focus ? { focus } : {}),
          count: EXPANSION_COUNT,
          creationId,
          status: 'pending',
          askedAt,
        },
        mark: 'persistent',
      }

      const sig = await store.putOptimization(
        new Blob([JSON.stringify(record)], { type: 'application/json' }),
      )

      EffectBus.emit('ask:queued', { sig, prompt, targets: [], model: EXPAND_MODEL })
      EffectBus.emit('toast:show', {
        type: 'tip',
        message: `Expanding ${where} — Haiku is looking at the tree for what "${subject}" is missing.`,
      })
      console.log(`[expand] queued (${EXPAND_MODEL}): ${where}, ${children.length} existing  [${sig.slice(0, 12)}…]`)
      return true
    } catch (err) {
      // The claim named an ask that never landed — release rather than
      // blocking the next request until the cache expires.
      this.#pending.release(scopePath)
      console.warn('[expand] failed to queue:', err)
      return false
    }
  }

  // ── context ──────────────────────────────────────────────

  #segments(): readonly string[] {
    const lineage = get<LineageLike>('@hypercomb.social/Lineage')
    return (lineage?.explorerSegments?.() ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
  }

  /** The tiles on a layer, strictly. `null` means "could not see it", never
   *  "it is empty" — an empty layer is a fine thing to expand (it seeds the
   *  subject's first tiles), an unreadable one is not. */
  async #currentChildren(segments: readonly string[]): Promise<Array<{ name: string }> | null> {
    const history = get<PlacementHistory>('@diamondcoreprocessor.com/HistoryService')
    const lineage = get<LineageLike>('@hypercomb.social/Lineage')
    if (!history || !lineage) return null
    const rows = await readChildrenStrict(history, lineage.domain, segments)
    if (rows === null) return null
    return rows.map(r => ({ name: r.name }))
  }

}

const _expand = new ExpandDrone()
window.ioc.register('@diamondcoreprocessor.com/ExpandDrone', _expand)
console.log('[ExpandDrone] Loaded')
