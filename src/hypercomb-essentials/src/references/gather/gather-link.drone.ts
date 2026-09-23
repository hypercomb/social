// references/gather/gather-link.drone.ts
//
// THE LINK YOU CAN SEE. Every time the page, a link, or a switch changes, this
// publishes `gather:page-links` — which groups the page gathers from, and which
// targets it feeds — and the breadcrumb writes them out as WORDS after the page
// name: `[team] ◆ ← people` on a linked page, `[people] ◆ → friends, family` on
// a group whose targets are on. Nothing is shown while there is nothing to say.
//
// This replaced two icon-only pills: their words lived in a hover tooltip, so a
// linked page looked exactly like an unlinked one (jwize, 2026-09-23: "there's
// no visual cue if something goes on or not").

import { Drone, EffectBus } from '@hypercomb/core'
import { GATHER_LINK_SERVICE_KEY, GatherLinkService } from './gather-link.service.js'

/** The retired pills — cleared once so a session that still shows one loses it. */
const RETIRED_PILLS = ['gather:from', 'gather:feed']

type LineageLike = EventTarget & { explorerSegments?: () => readonly string[] }

export type GatherPageLinks = {
  readonly page: readonly string[]
  readonly from: readonly (readonly string[])[]
  readonly feeding: readonly (readonly string[])[]
}

export class GatherLinkDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'references'
  override description = 'tells the breadcrumb which group a page gathers from, and which pages a group is feeding'

  protected override listens = ['gather:links-changed', 'gather:targets-changed', 'navigation:guard-end']
  protected override emits = ['gather:page-links', 'indicator:clear']

  #initialized = false
  #generation = 0

  protected override heartbeat = async (): Promise<void> => {
    if (this.#initialized) return
    this.#initialized = true
    for (const key of RETIRED_PILLS) EffectBus.emit('indicator:clear', { key })
    window.ioc.get<LineageLike>('@hypercomb.social/Lineage')?.addEventListener('change', () => { void this.#sync() })
    this.onEffect('gather:links-changed', () => { void this.#sync() })
    this.onEffect('gather:targets-changed', () => { void this.#sync() })
    // Once a page has landed its layers are warm. A boot or deep link answers
    // the first ask from a cold hive — empty, which would leave the words off.
    this.onEffect('navigation:guard-end', () => { void this.#sync() })
    await this.#sync()
  }

  async #sync(): Promise<void> {
    const generation = ++this.#generation
    const link = window.ioc.get<GatherLinkService>(GATHER_LINK_SERVICE_KEY)
    const here = [...(window.ioc.get<LineageLike>('@hypercomb.social/Lineage')?.explorerSegments?.() ?? [])]
    if (!link || here.length === 0) {
      EffectBus.emit<GatherPageLinks>('gather:page-links', { page: here, from: [], feeding: [] })
      return
    }
    const [from, targets] = await Promise.all([
      link.groupsOf(here).catch(() => [] as string[][]),
      link.targetsOf(here).catch(() => []),
    ])
    // A later page (or switch) has already answered — never publish a stale one.
    if (generation !== this.#generation) return
    EffectBus.emit<GatherPageLinks>('gather:page-links', {
      page: here,
      from,
      feeding: targets.filter(target => target.on).map(target => [...target.segments]),
    })
  }
}

// The bee wires its dependency: the link door every word, window and the
// create path resolve by key.
window.ioc.register(GATHER_LINK_SERVICE_KEY, new GatherLinkService())
const _gatherLink = new GatherLinkDrone()
window.ioc.register('@diamondcoreprocessor.com/GatherLinkDrone', _gatherLink)
