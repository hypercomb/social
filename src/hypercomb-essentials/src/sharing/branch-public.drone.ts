// sharing/branch-public.drone.ts
//
// Says, for the place you stand, whether it is PUBLIC — published and in the
// community (branch-public.ts) — as `branch:public`, which the breadcrumb's
// first word reads. Asked again when you move, when a publish finishes, when
// a showcase is signed, and when the window comes back (another tab may have
// switched the showcase). A step that lands while an older answer is still on
// its way wins: the older answer is dropped.

import { Drone } from '@hypercomb/core'
import { BRANCH_PUBLIC_EFFECT, branchPublicAt, liveBranchPublicDeps, placeKey, type BranchPublicState } from './branch-public.js'
import { PUBLISH_RESULT_EFFECT } from './publish-results.js'
import { SHOWCASE_SIGNED_EFFECT } from './showcase-record.js'

type LineageLike = EventTarget & { explorerSegments?: () => readonly string[] }

export class BranchPublicDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'sharing'

  public override description =
    'Says whether the place you stand is public — published and in the community — for the breadcrumb.'

  protected override listens: string[] = [PUBLISH_RESULT_EFFECT, SHOWCASE_SIGNED_EFFECT]
  protected override emits: string[] = [BRANCH_PUBLIC_EFFECT]

  #initialized = false
  #run = 0
  #deps = liveBranchPublicDeps()
  #timer: ReturnType<typeof setTimeout> | undefined

  protected override sense = () => true
  protected override heartbeat = async (): Promise<void> => {
    if (this.#initialized) return
    this.#initialized = true
    const lineage = window.ioc?.get?.('@hypercomb.social/Lineage') as LineageLike | undefined
    lineage?.addEventListener?.('change', () => this.#soon())
    const fresh = (): void => { this.#deps.forget(); this.#soon() }
    this.onEffect(PUBLISH_RESULT_EFFECT, fresh)
    this.onEffect(SHOWCASE_SIGNED_EFFECT, fresh)
    window.addEventListener('focus', fresh)
    this.#soon()
  }

  /** Coalesce a burst of moves into one ask. */
  #soon(): void {
    if (this.#timer !== undefined) clearTimeout(this.#timer)
    this.#timer = setTimeout(() => { this.#timer = undefined; void this.#ask() }, 150)
  }

  async #ask(): Promise<void> {
    const lineage = window.ioc?.get?.('@hypercomb.social/Lineage') as LineageLike | undefined
    const segments = [...(lineage?.explorerSegments?.() ?? [])].map(String)
    const run = ++this.#run
    let state: BranchPublicState
    try { state = await branchPublicAt(segments, this.#deps) } catch { state = { key: placeKey(segments), public: null } }
    // Moved again while asking: the newer ask answers.
    if (run !== this.#run) return
    this.emitEffect(BRANCH_PUBLIC_EFFECT, state)
  }
}

const _branchPublic = new BranchPublicDrone()
window.ioc.register('@diamondcoreprocessor.com/BranchPublicDrone', _branchPublic)
