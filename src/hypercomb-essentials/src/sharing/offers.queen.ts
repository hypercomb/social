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
// `execute` fetches the window and emits `offers:open`, and nothing else.
// There is no import of `placeOffers` in this module and no argument that
// names a host to accept from: an act that installs configuration is a press
// on a row the participant can read, never a word typed at a prompt.
//
// ── NO `machine` GRAMMAR, NO ALIAS ──────────────────────────────────────
//
// A model speaking the communication layer may not open the door in front of
// an act that installs something. Aliases are the participant's to give.

import { EffectBus, QueenBee } from '@hypercomb/core'

// THE WINDOW ARRIVES WITH ITS OPEN, not at boot (atomic-modules-plan.md,
// "adopt the proper load"). Its surface registers by TAG at boot — the
// shell's host makes it with createElement — and the element is defined from
// one cached import() when the window is asked for, or when a host offers
// something (the window's quiet notice is the one other thing it does). The
// element already in the page then upgrades in place and subscribes. The
// words, the tag and the key are spelled here because importing even a const
// from the view would keep it on the boot path.
const OFFERS_OPEN = 'offers:open'
/** The probe's word that a domain's verified members are held. */
const OFFERS_OFFERED = 'published-pools:offered'
const OFFERS_SURFACE = 'hc-offers'
const OFFERS_VIEW_KEY = '@diamondcoreprocessor.com/OffersView'

type Offered = { origin?: string; meaning?: string; count?: number }

/** OFFERS HEARD BEFORE THE VIEW, one per host and meaning, newest last. The
 *  bus replays only its last value to a new subscriber, so a burst would
 *  reach the element as one notice; each is said again once it is defined,
 *  and its own once-per-host-and-meaning rule keeps the replayed one from
 *  sounding twice. */
const heard = new Map<string, Offered>()
let defined = false
let view: Promise<void> | null = null
const loadView = (): Promise<void> => view ??= import('./offers.view.js').then(({ OffersElement }) => {
  if (!customElements.get(OFFERS_SURFACE)) customElements.define(OFFERS_SURFACE, OffersElement)
  defined = true
  const again = [...heard.values()]
  heard.clear()
  for (const payload of again) EffectBus.emit(OFFERS_OFFERED, payload)
}).catch(error => { view = null; throw error })

const cannotLoad = (error: unknown): void => {
  EffectBus.emit('activity:log', { message: `Could not load the offers window: ${error instanceof Error ? error.message : String(error)}` })
}

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
    // THE STAMP FOLLOWS THE LOAD. The window takes an open request only while
    // it is fresh, so it is stamped once the view is here — a slow first load
    // can never outlive it.
    try { await loadView() } catch (error) { cannotLoad(error); return }
    EffectBus.emit(OFFERS_OPEN, { at: Date.now() })
  }
}

// A host's offer while the view is away: remember it and fetch the view,
// whose quiet notice names the window. The first offer starts the load; the
// rest ride it.
EffectBus.on<Offered>(OFFERS_OFFERED, payload => {
  if (defined || !payload?.origin) return
  const key = `${payload.origin}::${payload.meaning ?? ''}`
  heard.delete(key)
  heard.set(key, payload)
  const starting = !view
  const loading = loadView()
  if (starting) loading.catch(cannotLoad)
})

// THE BEE WIRES (atomic-modules-plan.md): the view is a dependency; this bee
// adds its tag to the shell's surface registry — never a tag in either
// app.html — and defines the element when it is first needed.
window.ioc.whenReady('@hypercomb.social/ShellSurfaceRegistry', (registry: { add(s: unknown): void }) => {
  try {
    registry.add({ name: OFFERS_SURFACE, owner: OFFERS_VIEW_KEY, element: OFFERS_SURFACE, order: 142 })
  } catch {
    // duplicate add (hot reload) — the mounted surface is already live
  }
})

const _offers = new OffersQueenBee()
;(window as unknown as { ioc?: { register?: (k: string, v: unknown) => void } })
  .ioc?.register?.('@diamondcoreprocessor.com/OffersQueenBee', _offers)
