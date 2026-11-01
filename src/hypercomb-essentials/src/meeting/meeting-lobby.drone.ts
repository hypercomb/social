// meeting/meeting-lobby.drone.ts
//
// THE WAY INTO A MEETING IS THE LOBBY. This bee owns no drawing: it hears that
// someone wants to join (the `/meeting` word, or the meeting icon on a tile),
// registers the lobby's surface with the shell, and brings the desk on the
// first open. Joining from the lobby hands its open camera to the hive drone
// (`meeting:join`), which runs the meeting; nothing here touches WebRTC.

import { Drone, EffectBus } from '@hypercomb/core'

// The desk arrives with the first open, as the tile editor's does, and the
// element the shell's surface host already made upgrades in place. The tag and
// key are written out because importing even a constant would load the view.
const MEETING_LOBBY_SURFACE = 'hc-meeting-lobby'
const MEETING_LOBBY_VIEW_KEY = '@diamondcoreprocessor.com/MeetingLobbyView'

type LobbyView = typeof import('./lobby/meeting-lobby.view.js')
let viewLoad: Promise<LobbyView> | null = null

const loadView = (): Promise<LobbyView> => viewLoad ??= import('./lobby/meeting-lobby.view.js')
  .then(module => {
    if (!customElements.get(MEETING_LOBBY_SURFACE)) customElements.define(MEETING_LOBBY_SURFACE, module.MeetingLobbyElement)
    return module
  })
  .catch(error => { viewLoad = null; throw error })

const viewFacade = {
  open(cell: string): void { void loadView().then(view => view.meetingLobbyFacade.open(cell)) },
}

export class MeetingLobbyDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'meeting'

  public override description =
    'The meeting lobby: check your camera and microphone, choose the picture, see who is here, then join.'

  protected override sense = (): boolean => false

  constructor() {
    super()
    // The bus replays its last value to a new subscriber, and an old wish to
    // open replayed at construction is not a wish now.
    let live = false
    EffectBus.on<{ cell?: unknown }>('meeting:lobby-open', payload => {
      if (live) viewFacade.open(typeof payload?.cell === 'string' ? payload.cell : '')
    })
    live = true
  }
}

window.ioc.register(MEETING_LOBBY_VIEW_KEY, viewFacade)
window.ioc.whenReady('@hypercomb.social/ShellSurfaceRegistry', (registry: { add(s: unknown): void }) => {
  try {
    registry.add({ name: MEETING_LOBBY_SURFACE, owner: MEETING_LOBBY_VIEW_KEY, element: MEETING_LOBBY_SURFACE, order: 226 })
  } catch {
    // duplicate add (hot reload) — the mounted surface is already live
  }
})

window.ioc.register('@diamondcoreprocessor.com/MeetingLobbyDrone', new MeetingLobbyDrone())
