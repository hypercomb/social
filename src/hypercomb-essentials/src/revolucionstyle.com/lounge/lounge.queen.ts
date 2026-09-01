// /lounge — the room as a behaviour.
//
// A cell carrying `visual:lounge:room` IS a room. Opening it mounts the
// bundle the record names, full-viewport, straight from the tile — no site,
// no page, no route. Mark the cell's `view:default` with it and walking in
// IS walking in.
//
// NOT `attachable`: the content is a three.js bundle that has to be built and
// stored before there is anything to open, so `name@lounge` cannot install
// one out of thin air the way `name@slides` can. `/lounge here <bundleSig>`
// is the hand-authoring path; the Revolución site build writes the record
// over the bridge as part of the same pass that mints the bundle.
//
// The behaviour is DOMAIN-GENERIC on purpose. Nothing here says "cigar" —
// the record names its own bundle and its own art, so a second room is a
// second record on a second tile. Same logical piece, different world.

import { QueenBee, EffectBus } from '@hypercomb/core'
import type { VisualBeeRegistry } from '../../commands/visual-bee-registry.js'
import {
  listDecorations,
  removeDecorationAndWait,
  replaceDecoration,
} from '../../commands/decoration-manifest.js'
import {
  ENABLEMENT_CHANGED, readGlobalOnKinds, seedCohortOn,
} from '../../sharing/behavior-enablement.js'
import { LOUNGE_KIND, LOUNGE_VIEW, type LoungeRoomPayload } from './lounge-room.js'

const HEXAGONS = 'hexagons'
const SIG_RE = /^[0-9a-f]{64}$/

type ViewModeShape = { mode: string; setMode(next: string): void }
type LineageShape = { explorerSegments?: () => readonly string[] }

const get = <T,>(key: string): T | undefined =>
  (window as { ioc?: { get?: (k: string) => T } }).ioc?.get?.(key)

export class LoungeQueenBee extends QueenBee {
  readonly namespace = 'revolucionstyle.com'
  readonly command = 'lounge'
  override readonly aliases = ['room']
  override description = 'The lounge — a three-dimensional room this tile carries as its own presence'
  override options = ['here <bundleSig>', 'remove', 'on', 'off']
  override examples = [
    { input: '/lounge', result: 'Opens or closes the room on this tile' },
    { input: '/lounge here 4f2a…', result: 'Makes this cell a room, painted by that bundle' },
    { input: '/lounge remove', result: 'Takes the room off this cell' },
  ]

  protected async execute(args: string): Promise<void> {
    const trimmed = args.trim()
    const [verb = ''] = trimmed.toLowerCase().split(/\s+/, 1)

    if (verb === 'here' || verb === 'mark' || verb === 'attach') {
      await this.#attach(trimmed.slice(verb.length).trim())
      return
    }
    if (verb === 'remove' || verb === 'detach') {
      await this.#remove()
      return
    }

    const vm = get<ViewModeShape>('@hypercomb.social/ViewMode')
    if (!vm) return
    if (verb === 'off' || verb === 'close') { vm.setMode(HEXAGONS); return }
    vm.setMode(verb === 'on' || verb === 'open'
      ? LOUNGE_VIEW
      : vm.mode === LOUNGE_VIEW ? HEXAGONS : LOUNGE_VIEW)
  }

  #segments(): string[] {
    return [...(get<LineageShape>('@hypercomb.social/Lineage')?.explorerSegments?.() ?? [])]
  }

  /** `/lounge here <bundleSig>` — one live record per cell; re-marking
   *  replaces rather than piling, so pointing a room at a rebuilt bundle is
   *  the same gesture as making it a room in the first place. */
  async #attach(rest: string): Promise<void> {
    const bundleSig = rest.split(/\s+/, 1)[0]?.trim().toLowerCase() ?? ''
    if (!SIG_RE.test(bundleSig)) {
      EffectBus.emit('activity:log', {
        message: 'A room needs the signature of the bundle that paints it',
        icon: 'chair',
      })
      return
    }
    const segments = this.#segments()
    const payload: LoungeRoomPayload = { version: 1, bundleSig }
    await replaceDecoration({
      kind: LOUNGE_KIND,
      appliesTo: segments,
      segments,
      payload,
      mark: 'persistent',
    })
    EffectBus.emit('activity:log', { message: 'This cell is a room now', icon: 'chair' })
  }

  async #remove(): Promise<void> {
    const segments = this.#segments()
    const existing = await listDecorations({ kind: LOUNGE_KIND, segments })
    if (!existing.length) return
    await Promise.all(existing.map(record =>
      removeDecorationAndWait({ sig: record.sig, segments })))
    EffectBus.emit('activity:log', { message: 'The room is off this cell', icon: 'chair' })
  }
}

/** THE ROOM MUST NOT ARRIVE DARK.
 *
 *  A kind nobody has ever seen is globally off until the participant lights
 *  it in the roster, and that is right for a new behaviour. But this room
 *  already worked at its tile — you reached it through the website page —
 *  so putting it behind its own switch would read as the lounge BREAKING,
 *  which is the one failure the roster keeps re-teaching. Worse in this
 *  case: the tile now opens as the room, so a dark behaviour means walking
 *  in lands on bare hexagons.
 *
 *  So it is lit as a COHORT: once, on a hive that already has an on-list,
 *  and refused outright on a hive that opened dark (`'*'` in the ledger) —
 *  a hive that started with nothing lit must never have a light appear
 *  behind the participant. */
const LOUNGE_COHORT = 'lounge'

const lightLoungeOnce = (): void => {
  // ONLY once the census seed has materialized the on-list. Calling before
  // that records the cohort without lighting anything, and the ledger never
  // forgets — the light would be lost for the life of the hive.
  if (!readGlobalOnKinds()) return
  seedCohortOn(LOUNGE_COHORT, [LOUNGE_KIND])
}
lightLoungeOnce()
EffectBus.on(ENABLEMENT_CHANGED, lightLoungeOnce)

const _lounge = new LoungeQueenBee()
window.ioc.register('@revolucionstyle.com/LoungeQueenBee', _lounge)

;(window as { ioc?: { whenReady?: <T>(k: string, cb: (v: T) => void) => void } }).ioc?.whenReady?.<VisualBeeRegistry>(
  '@diamondcoreprocessor.com/VisualBeeRegistry',
  registry => registry.register({
    view: LOUNGE_VIEW,
    slashCommand: '/lounge',
    iconName: 'chair',
    toggleIcon: 'chair',
    behavior: 'render',
    decorationKind: LOUNGE_KIND,
    labelKey: 'view.lounge',
    descriptionKey: 'view.lounge.description',
    queenKey: '@revolucionstyle.com/LoungeQueenBee',
    // The room travels: the record names its bundle and its art by
    // signature, so adopting the tile carries the whole world with it.
    adoptable: true,
    // The tile's lounge ICON steps into the room from where you stand —
    // a look inside costs no navigation, and Escape puts you back on the
    // grid you were reading. Walking into the tile itself still works and
    // is the fuller gesture: the cell's `view:default` mark opens the room
    // on arrival, which is what makes the room the PLACE rather than a
    // page some website routes to.
    opensOnTileClick: true,
    // DELIBERATELY NOT `replacesTileRender`. The room is the cell's face
    // once you are AT it — but on the parent's grid the cell still has to be
    // a hexagon you can see and press, because that hexagon is the door.
    // Claiming the tile's presence here would erase the only ordinary way
    // in (the post-it can afford it: it draws its own sticky in its place).
    //
    // NODE-LOCAL, and deliberately not a branch scope: the room is one
    // place, not an application its children are inside. A child of the
    // lounge is its own tile with its own face.
    pheromones: ['platform:mobile', 'platform:desktop'],
  }),
)
