// diamondcoreprocessor.com/assistant/chat-context-action.drone.ts
//
// POINT AND CLICK TO ADD CONTEXT — the tile icon that appears while the chat
// window is FOLDED AWAY (see chat-peek.scss).
//
// Folding the window away exists so you can go and FIND the tiles a request
// should carry. Finding them was the easy half; putting them on the shelf was
// the half with no affordance — the shelf takes DROPS, and a drag that starts
// on a hexagon is a PAN, so the one gesture the canvas already owns is the one
// gesture that cannot be used here.
//
// WHY AN ICON AND NOT A DRAG HANDLE. A handle you grab to arm a pan-locked
// drag works, and it costs a MODE: press, hold, cross the screen, release on
// the right hexagon — and pay for the whole round trip again for the next
// tile. Gathering context is a repeated discrete act, three or four tiles
// chosen while reading them, so the cheap repeatable gesture is the right one.
// One press per tile, pressed again to take it back off, and the canvas is
// never left in a state you have to get out of.
//
// WHY NOT CTRL-CLICK. Ctrl-click on a hexagon already means something
// (selection-input.drone.ts: toggle the selection, and the wand on an
// unadopted tile). Overloading it here would make one chord mean two
// different things depending on invisible state — the exact disease the chat
// window was built to kill.
//
// THE SAME CONTROL BOTH DIRECTIONS. A tile already on the shelf wears the
// icon LIT, and pressing it takes the tile off: a lit icon you cannot
// un-press is one you have to go back into the window to undo. The shelf
// announces itself on `context:active-set`, so this drone never keeps its own
// idea of what the request carries — the window owns that, and this draws it.
//
// REGISTERED AND UNREGISTERED WITH THE FOLD, rather than hidden by
// `visibleWhen` alone: `actionsForTile` is also what the close-up screen and
// the tile brief build their affordance lists from, and an "add to the
// request" button on a surface with no request behind it is a button that
// does nothing.

import { Drone, levelRoster } from '@hypercomb/core'
import type { RosterHistory, RosterStore } from '@hypercomb/core'
import type {
  OverlayActionDescriptor, OverlayProfileKey,
} from '../presentation/tiles/tile-overlay.drone.js'

/** A tray with a plus — the shelf, and putting something on it. Deliberately
 *  NOT the paperclip the footer uses for ATTACHED context: that is a different
 *  thing (a decoration riding every question on the tile) and it must not read
 *  as this one. */
const CONTEXT_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 15h5l1.5 2.5h5L16 15h5"/><path d="M5 15 6.5 7h11L19 15"/><path d="M12 8v4"/><path d="M10 10h4"/></svg>'

const OWNER = '@diamondcoreprocessor.com/ChatContextActionDrone'
const ACTION = 'chat-context'

/** Everywhere you can stand. Gathering context is not a private-hive
 *  privilege — reading somebody else's tile is exactly when you want to put
 *  it in front of the model. */
const PROFILES: readonly OverlayProfileKey[] =
  ['private', 'public-own', 'public-external', 'world']

/** Lit when the tile is already on the shelf — the steel the chat window
 *  wears everywhere else, so "this belongs to the conversation" is one colour
 *  in the hive and in the window. */
const ON_SHELF_TINT = 0x7eb6d6

type TileActionPayload = { action: string; label: string; q: number; r: number; index: number }

/** WHAT THE REQUEST CARRIES, and WHERE WE ARE STANDING. Module scope so the
 *  descriptor's pure `tintWhen` can read them without dragging the drone into
 *  the overlay's render path. */
let onShelf = new Set<string>()
let here: readonly string[] = []

/** A label is a name on the CURRENT level; it is only a path once you know
 *  the level. The same `/a/b` shape the shelf keys its references by. */
const pathOf = (label: string): string => '/' + [...here, label].filter(Boolean).join('/')

const descriptorFor = (profile: OverlayProfileKey): OverlayActionDescriptor => ({
  name: ACTION,
  owner: OWNER,
  svgMarkup: CONTEXT_SVG,
  x: -2,
  y: -7,
  hoverTint: ON_SHELF_TINT,
  profile,
  labelKey: 'chat.context.add',
  descriptionKey: 'chat.context.addHint',
  tintWhen: (ctx) => onShelf.has(pathOf(ctx.label)) ? ON_SHELF_TINT : null,
})

const DESCRIPTORS: OverlayActionDescriptor[] = PROFILES.map(descriptorFor)

export class ChatContextActionDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'assistant'
  override description =
    'add-to-the-request icon on every tile, while the chat window is folded away'

  protected override listens = [
    'chat:peek', 'context:active-set', 'render:cell-count',
    'overlay:request-register', 'tile:action',
  ]
  protected override emits = [
    'overlay:register-action', 'overlay:unregister-action', 'chat:add-context',
  ]

  #bound = false
  #peeking = false

  /** Is the icon on the tiles right now? Public because "is this affordance
   *  offered" is a question other surfaces legitimately ask — the close-up
   *  screen and the tile brief build their lists from the same registry — and
   *  because it is the only honest way to read this state off a headless
   *  renderer, where no cell is drawn and the overlay therefore knows no
   *  labels to be asked about. */
  get armed(): boolean { return this.#peeking }

  protected override heartbeat = async (): Promise<void> => {
    if (this.#bound) return
    this.#bound = true

    this.onEffect<{ peeking?: boolean }>('chat:peek', payload => {
      const peeking = !!payload?.peeking
      if (peeking === this.#peeking) return
      this.#peeking = peeking
      this.#apply()
    })

    // Last-value replay: a fold entered after the shelf was already filled
    // still draws the tiles on it as lit.
    this.onEffect<{ paths?: readonly string[] }>('context:active-set', payload => {
      onShelf = new Set((payload?.paths ?? []).map(String))
    })

    this.onEffect('render:cell-count', () => { this.#readHere() })
    this.#readHere()

    // The overlay re-asks after a remount. Answering only while folded away
    // is what keeps the icon off every other surface.
    this.onEffect('overlay:request-register', () => { this.#apply() })

    this.onEffect<TileActionPayload>('tile:action', payload => {
      if (payload?.action !== ACTION) return
      void this.#press(String(payload.label ?? ''))
    })
  }

  #readHere(): void {
    const lineage = window.ioc?.get<{ explorerSegments?: () => readonly string[] }>(
      '@hypercomb.social/Lineage')
    here = (lineage?.explorerSegments?.() ?? []).map(String).filter(Boolean)
  }

  #apply(): void {
    if (this.#peeking) { this.emitEffect('overlay:register-action', DESCRIPTORS); return }
    // Profile-aware removal: the name lives in four orders and each has to be
    // spliced by its own profile, or the wrong one loses an icon.
    for (const profile of PROFILES) {
      this.emitEffect('overlay:unregister-action', { name: ACTION, profile })
    }
  }

  /** Run this affordance on one tile by NAME — the same public shape the
   *  overlay offers (`invokeActionForTile`), for the same reason: the band is
   *  not the only thing that can press an affordance. */
  press(label: string): Promise<void> { return this.#press(label) }

  /** ON OR OFF — the window decides which, because it owns the shelf, so this
   *  sends the tile and nothing else.
   *
   *  The SIGNATURE is resolved here because a reference without one
   *  contributes nothing to the request (`referencePayload` filters on it),
   *  and `levelRoster` is the list the rail, the notes panel and the command
   *  line all read — so the sig this sends is the same sig a drag off the
   *  rail would have carried. */
  async #press(label: string): Promise<void> {
    if (!label) return
    this.#readHere()
    const history = window.ioc?.get<RosterHistory>('@diamondcoreprocessor.com/HistoryService')
    const store = window.ioc?.get<RosterStore>('@hypercomb.social/Store')
    let sig = ''
    if (history && store) {
      try {
        const rows = await levelRoster(here, history, store)
        sig = rows.find(row => row.name === label)?.sig ?? ''
      } catch { /* still worth naming — see below */ }
    }
    // Sent even without a sig. A tile that silently failed to arrive is worse
    // than one that shows up on the shelf and can be taken off again; the
    // shelf reports what the request carries either way.
    this.emitEffect('chat:add-context', { name: label, path: pathOf(label), sig })
  }
}

window.ioc.register(OWNER, new ChatContextActionDrone())
