// assistant/visual-distribution.drone.ts
//
// THE DOOR EVERY PRODUCER OF PARTS KNOCKS ON.
//
// Rules 10 and 11 of the website-artifact paradigm are owed by everything that
// mints parts — `/break-apart`, `/organize`, `/expand`, an
// importer, a bridge responder. If each of them grew its own answer they would
// drift, and the ones written later would quietly not do it at all (which is
// exactly how every break-apart to date produced naked parts).
//
// So there is one act, reached by one effect:
//
//   parts:distribute-visual  { segments, parts?, creationId?, place?, divide? }
//
// `segments` is the WHOLE. `parts` is the ordered list of the parts it was
// broken into; leave it out and the whole's children are read in layer order,
// narrowed to the ones stamped with `creationId` when one is given — which is
// what a producer that has just created a batch actually holds.
//
// `divide: false` says nothing was cut up — the tiles are still owed their own
// appearance, but no frame is declared and nobody is seated. That is what
// `/expand` and the importers want: they widen, they do not deepen.
//
// WHY AN EFFECT AND NOT A CALL. A part-producing act can finish anywhere: in
// the hive, in a worker, or — for break-apart — in a bridge-connected session
// that created the tiles remotely and cannot crop an image. All of them can
// emit. The effect is allowlisted on the bridge (`claude-bridge.worker.ts`
// REMOTE_INTENTS) so the responder that just minted the parts can hand the
// appearance back to the hive, which is the only place the pixels are.
//
// It is safe to emit twice: the frame is written with `replaceDecoration`, a
// part already seated at its slot is left alone, and a part that already owns
// a picture is never redressed.
//
// See documentation/website-artifact-paradigm.md and
// presentation/tiles/visual-division.ts.
import { Drone, EffectBus, normalizeCell } from '@hypercomb/core'
import { readChildrenStrict, type PlacementHistory } from '../history/layer-placement.js'
import { creationsOf } from './creation.js'
import { distributeVisual, dressParts } from './visual-distribution.js'
import type { DivisionFlow } from '../presentation/tiles/visual-division.js'

type DistributeRequest = {
  segments?: readonly string[]
  parts?: readonly string[]
  creationId?: string
  place?: boolean
  /** Did a whole's appearance actually get DIVIDED among these tiles?
   *
   *  True (the default) is break-apart: the tiles are parts of the whole at
   *  `segments`, so it gains a frame and they are seated into it.
   *
   *  False is everything that widens rather than deepens — `/expand`, an
   *  importer. Those tiles are still owed their own appearance
   *  (rule 10's third clause) but nothing was cut up, so declaring a frame
   *  would re-declare the arity of a whole nobody broke apart. */
  divide?: boolean
  /** `spiral` (default) divides a picture among the parts; `stack`/`row`/
   *  `grid` divide a PAGE — the whole's container gets a hole per part and
   *  each part's own page is seated into it. */
  flow?: DivisionFlow
  /** Relative weight per hole. Never a size. */
  spans?: readonly number[]
}

type LineageLike = { explorerSegments?: () => readonly string[]; domain?: unknown }
type HistoryLike = PlacementHistory & {
  sign(lineage: { explorerSegments: () => readonly string[] }): Promise<string>
  currentLayerAt(sig: string): Promise<Record<string, unknown> | null>
}

export class VisualDistributionDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'assistant'
  override description = 'divides a broken-apart tile’s appearance among its parts and leaves the whole a frame'

  protected override deps = {
    lineage: '@hypercomb.social/Lineage',
    store: '@hypercomb.social/Store',
  }

  protected override listens = ['parts:distribute-visual']
  protected override emits = ['toast:show', 'tile:saved']

  #effectsRegistered = false

  /** Serialized, never dropped. Two producers finishing at once would
   *  otherwise interleave their writes to different wholes through the same
   *  layer cascade; one at a time costs nothing at this volume. */
  #chain: Promise<unknown> = Promise.resolve()

  protected override heartbeat = async (): Promise<void> => {
    if (this.#effectsRegistered) return
    this.#effectsRegistered = true

    this.onEffect<DistributeRequest>('parts:distribute-visual', (payload) => {
      this.#chain = this.#chain.then(() => this.distribute(payload)).catch(() => undefined)
    })
  }

  /** Distribute the appearance of the whole at `segments` among its parts.
   *  Returns how many holes the whole ended up declaring, or 0 when there was
   *  nothing to do — never throws at the caller. */
  async distribute(request: DistributeRequest | undefined): Promise<number> {
    const wholeSegments = (request?.segments ?? [])
      .map(s => normalizeCell(String(s ?? '')) || String(s ?? '').trim())
      .filter(Boolean)
    if (wholeSegments.length === 0) {
      console.warn('[visual-distribution] no whole named — nothing distributed')
      return 0
    }

    const parts = request?.parts?.length
      ? request.parts.map(p => normalizeCell(String(p ?? '')) || String(p ?? '').trim()).filter(Boolean)
      : await this.#partsOf(wholeSegments, request?.creationId)

    if (parts === null) {
      EffectBus.emit('toast:show', {
        type: 'tip',
        message: `Could not read /${wholeSegments.join('/')} — its parts keep what they have.`,
      })
      return 0
    }
    if (parts.length === 0) {
      console.log(`[visual-distribution] /${wholeSegments.join('/')} has no parts to dress`)
      return 0
    }

    if (request?.divide === false) {
      const { dressed, kept } = await dressParts({ segments: wholeSegments, parts })
      if (dressed) {
        EffectBus.emit('toast:show', {
          type: 'tip',
          message: `${dressed} new ${dressed === 1 ? 'tile' : 'tiles'} now carry a picture of their own.`,
        })
      }
      return dressed + kept
    }

    const outcome = await distributeVisual({
      wholeSegments,
      parts,
      place: request?.place,
      flow: request?.flow,
      spans: request?.spans,
    })
    if (!outcome.ok) {
      console.warn('[visual-distribution] refused:', outcome.reason)
      return 0
    }

    const dressed = outcome.divided + outcome.derived
    EffectBus.emit('toast:show', {
      type: 'tip',
      message: dressed
        ? `${dressed} of ${outcome.slots} parts now carry their own picture.`
        : `${outcome.slots} places marked out — every part already had a picture.`,
    })
    return outcome.slots
  }

  /** The whole's children in layer order, narrowed to one creation when a
   *  producer names it. `null` means the layer could not be read at all — never
   *  confuse that with "it has no parts", which would mint an empty frame over
   *  a branch we simply could not see. */
  async #partsOf(
    wholeSegments: readonly string[],
    creationId?: string,
  ): Promise<string[] | null> {
    const history = get<HistoryLike>('@diamondcoreprocessor.com/HistoryService')
    const lineage = get<LineageLike>('@hypercomb.social/Lineage')
    if (!history || !lineage) return null

    const rows = await readChildrenStrict(history, lineage.domain, wholeSegments)
    if (rows === null) return null
    const names = rows.map(r => r.name)
    const wanted = String(creationId ?? '').trim()
    if (!wanted) return names

    const out: string[] = []
    for (const name of names) {
      try {
        const sig = await history.sign({ explorerSegments: () => [...wholeSegments, name] })
        const layer = await history.currentLayerAt(sig)
        const stamps = await creationsOf(layer)
        if (stamps.some(s => s.id === wanted)) out.push(name)
      } catch { /* unreadable stamp — it is an index, not truth; leave it out */ }
    }
    // A batch whose stamps never landed is still a batch. Falling back to every
    // child is better than dressing nothing, and dressing is idempotent.
    return out.length > 0 ? out : names
  }
}

const _visualDistribution = new VisualDistributionDrone()
window.ioc.register('@diamondcoreprocessor.com/VisualDistributionDrone', _visualDistribution)
console.log('[VisualDistributionDrone] Loaded')
