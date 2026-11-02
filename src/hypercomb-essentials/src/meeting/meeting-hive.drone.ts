// meeting/meeting-hive.drone.ts
//
// THE PARTICIPANTS' HIVE, shown and hidden. Joining opens it — the owner
// joined and saw "just a hive again" (2026-11-02): the faces were drawn into
// the tile canvas, too small to notice — and the meeting icon at the top
// toggles it (`meeting:view-toggle`). Pressed with no meeting yet, the icon
// starts one; pressed while a meeting is live and you are not in it, it joins.
// Leaving closes it. `meeting:view {open}` tells the icon which way it is.

import { Drone, EffectBus } from '@hypercomb/core'
import { MEETING_HIVE_TAG, MeetingHiveElement } from './hive/meeting-hive.view.js'

const OWNER = '@diamondcoreprocessor.com/MeetingHiveView'

export class MeetingHiveDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'meeting'

  public override description =
    'The participants’ hive: the people in the meeting and their videos, the leader in the middle. Joining opens it; the meeting icon toggles it.'

  protected override listens = ['meeting:view-toggle', 'meeting:state', 'meeting:presence']
  protected override emits = ['meeting:view', 'meeting:start']

  protected override sense = (): boolean => false

  #joined = false
  #open = false

  constructor() {
    super()
    if (!customElements.get(MEETING_HIVE_TAG)) customElements.define(MEETING_HIVE_TAG, MeetingHiveElement)

    // The bus replays its last value to a new listener: an old state is not news.
    let live = false
    EffectBus.on<{ joined?: boolean }>('meeting:presence', p => {
      const joined = p?.joined === true
      if (live && joined !== this.#joined) this.#setOpen(joined)
      this.#joined = joined
    })
    EffectBus.on<{ open?: boolean }>('meeting:view-toggle', p => {
      if (!live) return
      if (!this.#joined) {
        // No meeting of yours yet: the icon starts or joins it, and joining opens this.
        if (p?.open !== false) EffectBus.emitTransient('meeting:start', {})
        return
      }
      this.#setOpen(typeof p?.open === 'boolean' ? p.open : !this.#open)
    })
    live = true
    EffectBus.emit('meeting:view', { open: false })
  }

  #setOpen(open: boolean): void {
    this.#open = open
    const el = document.querySelector<MeetingHiveElement>(MEETING_HIVE_TAG)
    if (el) el.open = open
    EffectBus.emit('meeting:view', { open })
  }
}

const _meetingHive = new MeetingHiveDrone()
window.ioc.register('@diamondcoreprocessor.com/MeetingHiveDrone', _meetingHive)
window.ioc.whenReady('@hypercomb.social/ShellSurfaceRegistry', (registry: { add(s: unknown): void }) => {
  try {
    registry.add({ name: MEETING_HIVE_TAG, owner: OWNER, element: MEETING_HIVE_TAG, order: 225 })
  } catch {
    // duplicate add (hot reload) — the mounted surface is already live
  }
})
