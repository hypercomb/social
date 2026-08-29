// /publications — the PUBLICATION DIRECTORY VIEW. A cell carrying
// `visual:publications:view` opens as a bright page of square plates, one
// per site the host's publication ledger reports as published. The ledger
// (`GET /publications.json`, built by the directory worker from verified
// publisher-signed hive indexes) is the only source: publishing a branch
// puts its plate on the page, unpublishing takes it away, and nothing on
// the page is hand-maintained. Stepping through a plate visits that site.
//
// This is the welcome face of a bare publication-directory domain
// (pluginthematrix.com): the `/pluginthematrix` creation carries this mark
// plus a `view:default`, so a visitor landing on the bare domain arrives
// on the directory — the welcome IS the directory. See
// documentation/read-only-deployment.md, "Domain behavior".

import { QueenBee, EffectBus } from '@hypercomb/core'
import type { VisualBeeRegistry } from './visual-bee-registry.js'
import {
  listDecorations,
  removeDecorationAndWait,
  replaceDecoration,
} from './decoration-manifest.js'
import {
  ENABLEMENT_CHANGED, readGlobalOnKinds, seedCohortOn,
} from '../sharing/behavior-enablement.js'

export const PUBLICATIONS_VIEW = 'publications'
export const PUBLICATIONS_KIND = 'visual:publications:view'

/** Payload of a `visual:publications:view` record. Everything is optional —
 *  the page is built from the ledger, not from authored content. */
export interface PublicationsPayload {
  readonly version: 1
  /** Headline over the plates. Falls back to the cell's title. */
  readonly title?: string
  /** One line under the headline. */
  readonly tagline?: string
}

type ViewModeShape = { mode: string; setMode(next: string): void }
type LineageShape = { explorerSegments?: () => readonly string[] }

const get = <T,>(key: string): T | undefined =>
  (window as { ioc?: { get?: (k: string) => T } }).ioc?.get?.(key)

export class PublicationsViewQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'publications'
  override description = 'Publication directory — every creation published on this host as a square plate'
  override options = ['here [tagline]', 'remove', 'on', 'off']
  override examples = [
    { input: '/publications here Creations shared with the world', result: 'Marks the current cell as the publication directory' },
    { input: '/publications', result: 'Opens or closes the publication directory' },
    { input: '/publications remove', result: 'Takes the directory mark off the current cell' },
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
    if (verb === 'off' || verb === 'close') {
      vm.setMode('hexagons')
      return
    }
    vm.setMode(verb === 'on' || verb === 'open'
      ? PUBLICATIONS_VIEW
      : vm.mode === PUBLICATIONS_VIEW ? 'hexagons' : PUBLICATIONS_VIEW)
  }

  #segments(): string[] {
    return [...(get<LineageShape>('@hypercomb.social/Lineage')?.explorerSegments?.() ?? [])]
  }

  /** One live record per cell — re-marking replaces, never piles. */
  async #attach(tagline: string): Promise<void> {
    const segments = this.#segments()
    const payload: PublicationsPayload = { version: 1, ...(tagline ? { tagline } : {}) }
    await replaceDecoration({
      kind: PUBLICATIONS_KIND,
      appliesTo: segments,
      segments,
      payload,
      mark: 'persistent',
    })
    EffectBus.emit('activity:log', { message: 'Publication directory set on this cell', icon: 'public' })
  }

  async #remove(): Promise<void> {
    const segments = this.#segments()
    const existing = await listDecorations({ kind: PUBLICATIONS_KIND, segments })
    if (!existing.length) return
    await Promise.all(existing.map(record =>
      removeDecorationAndWait({ sig: record.sig, segments })))
    EffectBus.emit('activity:log', { message: 'Publication directory removed', icon: 'public' })
  }
}

/** THE PAGE MUST NOT ARRIVE DARK. A kind nobody has seen is globally off,
 *  and the directory ships paired with a `view:default` mark — dark, the
 *  bare domain's front door would open onto nothing. Lit as a COHORT:
 *  once, on a hive that already has an on-list, and refused outright on a
 *  hive that opened dark (`'*'` in the ledger). The visitor shell needs no
 *  seed — publishing is the enablement act there. */
const PUBLICATIONS_COHORT = 'publications-view'

const lightPublicationsOnce = (): void => {
  // ONLY once the census seed has materialized the on-list. Calling before
  // that records the cohort without lighting anything, and the ledger never
  // forgets — the light would be lost for the life of the hive.
  if (!readGlobalOnKinds()) return
  seedCohortOn(PUBLICATIONS_COHORT, [PUBLICATIONS_KIND])
}
lightPublicationsOnce()
EffectBus.on(ENABLEMENT_CHANGED, lightPublicationsOnce)

const _publicationsView = new PublicationsViewQueenBee()
window.ioc.register('@diamondcoreprocessor.com/PublicationsViewQueenBee', _publicationsView)

;(window as { ioc?: { whenReady?: <T>(k: string, cb: (v: T) => void) => void } }).ioc?.whenReady?.<VisualBeeRegistry>(
  '@diamondcoreprocessor.com/VisualBeeRegistry',
  registry => registry.register({
    view: PUBLICATIONS_VIEW,
    slashCommand: '/publications',
    iconName: 'public',
    toggleIcon: 'public',
    behavior: 'render',
    decorationKind: PUBLICATIONS_KIND,
    labelKey: 'view.publications',
    descriptionKey: 'view.publications.description',
    queenKey: '@diamondcoreprocessor.com/PublicationsViewQueenBee',
    adoptable: true,
    // The content IS the host's ledger — no authoring step, so a bare
    // `name@publications` install works.
    attachable: true,
    // The directory opens where its tile stands.
    opensOnTileClick: true,
    pheromones: ['platform:mobile', 'platform:desktop'],
  }),
)
