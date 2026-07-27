// diamondcoreprocessor.com/commands/reference-requirement.drone.ts
//
// A reference can DEMAND something of what it shows: "People, but only family".
// Those marks ride in the reference decoration's payload (`requiredMarks`), and
// this drone is what turns them into a live narrowing of the page you land on.
//
// Why the requirement is a SECOND source rather than the existing lens:
//
//   The participant's own pheromone lens is `tags:filter`, and it is STICKY —
//   nothing clears it on navigation, deliberately, because every emit is a
//   considered act. If entering through a reference simply emitted `tags:filter`
//   with the required marks, it would overwrite the lens the participant had
//   set, and leave it overwritten after they walked back out. The requirement
//   would also arrive in the tag panel as chips — switchable OFF, which is not
//   "relaxing a filter" but editing the reference itself, since a reference
//   decoration is `appliesTo: []` and its payload IS its identity.
//
//   So this drone never writes `tags:filter`. It broadcasts `tags:required`,
//   which show-cell ANDs with the lens: a cell must satisfy the participant's
//   filter (if any) AND the standing requirement (if any). The requirement is
//   not listed anywhere and cannot be toggled — the lock is structural, not a
//   rule someone has to remember.
//
// Lifecycle: a requirement is armed by portalling through a reference that
// carries one, and disarmed the moment the participant stands outside that
// reference's target subtree. Walking back out therefore restores exactly the
// lens they had, with no save/restore bookkeeping to get wrong — the standing
// location IS the state.
//
// A reference with no marks arms NOTHING (and clears any standing requirement),
// so the ordinary case costs one map read per portal.

import { Drone, EffectBus } from '@hypercomb/core'
import { referenceMarksForLabel, referenceTargetForLabel } from './decoration-kind-index.js'

type LineageLike = { explorerSegments?: () => readonly string[] }

const ioc = <T,>(key: string): T | undefined =>
  (window as { ioc?: { get?: <U>(k: string) => U | undefined } }).ioc?.get?.<T>(key)

/** Is `here` at or below `root`? `[]` (the hive root) contains everything,
 *  which is correct: a reference to the root narrows the whole hive. */
const isInside = (here: readonly string[], root: readonly string[]): boolean =>
  root.length <= here.length && root.every((s, i) => here[i] === s)

export class ReferenceRequirementDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'commands'

  public override description =
    'Applies a reference’s required pheromones while you stand inside what it points at.'

  protected override listens = ['tile:navigate-reference', 'render:cell-count']
  protected override emits = ['tags:required']

  #wired = false
  /** The standing requirement, or null when nothing is armed. `at` is the
   *  target subtree it holds over — leaving that subtree disarms it. */
  #active: { marks: readonly string[]; at: readonly string[] } | null = null

  protected override heartbeat = async (): Promise<void> => {
    if (this.#wired) return
    this.#wired = true

    // Armed at the portal, not at arrival: the label being clicked is what
    // carries the requirement, and by the time we have landed the reference
    // cell is behind us and no longer resolvable from where we stand.
    this.onEffect<{ label?: string }>('tile:navigate-reference', (p) => {
      const label = String(p?.label ?? '').trim()
      if (!label) return
      const target = referenceTargetForLabel(label)
      if (target === null) return
      const marks = referenceMarksForLabel(label)
      // A reference with no demand must CLEAR a standing one rather than leave
      // it in place: portalling through an unrestricted reference otherwise
      // inherits whatever the last restricted one imposed.
      this.#apply(marks.length > 0 ? { marks: [...marks], at: [...target] } : null)
    })

    // The standing location is the whole disarm condition. render:cell-count
    // fires after every navigation render, so this sees each move without a
    // new navigation contract to keep in sync.
    this.onEffect('render:cell-count', () => {
      if (!this.#active) return
      const here = ioc<LineageLike>('@hypercomb.social/Lineage')?.explorerSegments?.() ?? []
      if (!isInside(here, this.#active.at)) this.#apply(null)
    })
  }

  /** Broadcast a change of requirement. Sticky like every other filter effect,
   *  so a renderer that starts late still learns what is in force. Silent when
   *  nothing actually changed — this runs on every render tick. */
  #apply(next: { marks: readonly string[]; at: readonly string[] } | null): void {
    // Compared as JSON rather than a joined string: any separator good enough
    // to be unambiguous is a control byte, and a LITERAL one is invisible in
    // every editor and silently stripped by common tooling — which would turn
    // the join into join('') and make ['ab'] compare equal to ['a','b'].
    const before = this.#active ? JSON.stringify(this.#active.marks) : ''
    const after = next ? JSON.stringify(next.marks) : ''
    this.#active = next
    if (before === after) return
    EffectBus.emit('tags:required', { marks: next ? [...next.marks] : [] })
  }
}

// ── registration ────────────────────────────────────────
const _referenceRequirement = new ReferenceRequirementDrone()
window.ioc.register('@diamondcoreprocessor.com/ReferenceRequirementDrone', _referenceRequirement)
