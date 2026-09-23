// sharing/offers.queen.ts
//
// `/offers` — WHAT THE HOSTS YOU KNOW ARE OFFERING, AND THE YES.
//
// A host that publishes a provider spec or a workflow DECLARES it; nothing
// enters this hive because a host decided it should. `published-pools.ts`
// verifies what a learned domain offers and HOLDS it. This is the surface
// where the participant looks at what is held and places it — or does not.
//
// ── THE COMMAND LINE CANNOT PLACE ───────────────────────────────────────
//
// `execute` emits `offers:open` and nothing else. There is no import of
// `placeOffers` in this module's graph and no argument that names a host to
// accept from: an act that installs configuration is a press on a row the
// participant can read, never a word typed at a prompt.
//
// ── NO `machine` GRAMMAR, NO ALIAS ──────────────────────────────────────
//
// A model speaking the communication layer may not open the door in front of
// an act that installs something. Aliases are the participant's to give.

import { EffectBus, QueenBee } from '@hypercomb/core'
import { OFFERS_OPEN } from './offers.view.js'
import { OffersElement, OFFERS_SURFACE, OFFERS_VIEW_KEY } from './offers.view.js'

export class OffersQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'offers'
  override description = 'Show what the hosts you know are offering, and place what you want'
  override examples = [
    { input: '/offers', result: 'Opens the offers window — nothing is placed until you press it' },
  ]

  override slashComplete(_args: string): readonly string[] {
    return []
  }

  protected async execute(_args: string): Promise<void> {
    EffectBus.emit(OFFERS_OPEN, { at: Date.now() })
  }
}

// THE BEE WIRES (atomic-modules-plan.md): the view is a dependency; this bee
// defines its element and adds it to the shell's surface registry — never a
// tag in either app.html.
window.ioc.whenReady('@hypercomb.social/ShellSurfaceRegistry', (registry: { add(s: unknown): void }) => {
  if (!customElements.get(OFFERS_SURFACE)) customElements.define(OFFERS_SURFACE, OffersElement)
  try {
    registry.add({ name: OFFERS_SURFACE, owner: OFFERS_VIEW_KEY, element: OFFERS_SURFACE, order: 142 })
  } catch {
    // duplicate add (hot reload) — the mounted surface is already live
  }
})

const _offers = new OffersQueenBee()
;(window as unknown as { ioc?: { register?: (k: string, v: unknown) => void } })
  .ioc?.register?.('@diamondcoreprocessor.com/OffersQueenBee', _offers)
