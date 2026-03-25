// diamondcoreprocessor.com/meeting/meeting-controls.worker.ts
// Registers meeting overlay buttons (Join + Camera) on hex tiles
// and emits toggle effects when clicked.

import { Worker } from '@hypercomb/core'
import type { MeetingState } from './hive-meeting.drone.js'

type MeetingStatePayload = { state: MeetingState; threshold: number }
type TileActionPayload = { action: string; label: string; q: number; r: number; index: number }

// ── SVG icons ───────────────────────────────────────────────────

const JOIN_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="96" height="96"><circle fill="none" stroke="white" stroke-width="6" cx="48" cy="48" r="30"/><path fill="white" d="M38 36v24l22-12z"/></svg>`

const CAMERA_ON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="96" height="96"><rect fill="white" x="14" y="28" width="44" height="40" rx="6"/><path fill="white" d="M62 42l20-10v32l-20-10z"/></svg>`

const CAMERA_OFF_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="96" height="96"><rect fill="white" x="14" y="28" width="44" height="40" rx="6" opacity="0.4"/><path fill="white" d="M62 42l20-10v32l-20-10z" opacity="0.4"/><rect fill="white" x="46" y="16" width="4" height="64" rx="2" transform="rotate(-45 48 48)"/></svg>`

// ── Icon position (in overlay-local coordinates) ────────────────
const ICON_Y = -12 // above the label row, in the upper hex area

export class MeetingControlsWorker extends Worker {
  readonly namespace = 'diamondcoreprocessor.com'

  public override description =
    'Registers join/camera overlay buttons for hive meetings.'
  public override effects = ['network'] as const

  protected override listens = ['render:host-ready', 'tile:action', 'meeting:state', 'meeting:local-camera']
  protected override emits = ['overlay:register-action', 'overlay:unregister-action', 'meeting:toggle-available', 'meeting:toggle-camera']

  #meetingState: MeetingState = 'idle'
  #cameraOn = false
  #registered = false

  protected override ready = (): boolean => true

  protected override act = async (): Promise<void> => {
    // register overlay icons once pixi is ready
    this.onEffect('render:host-ready', () => {
      this.#registerActions()
    })

    // track meeting state to update icon visibility
    this.onEffect<MeetingStatePayload>('meeting:state', ({ state }) => {
      const prev = this.#meetingState
      this.#meetingState = state

      // re-register if state changed to update visibleWhen
      if (prev !== state) this.#registerActions()
    })

    // track camera state to swap icon
    this.onEffect<{ on: boolean }>('meeting:local-camera', ({ on }) => {
      const prev = this.#cameraOn
      this.#cameraOn = on
      if (prev !== on) this.#registerActions()
    })

    // handle clicks on our actions
    this.onEffect<TileActionPayload>('tile:action', (payload) => {
      switch (payload.action) {
        case 'meeting-join':
          this.emitEffect('meeting:toggle-available', {})
          break
        case 'meeting-camera':
          this.emitEffect('meeting:toggle-camera', {})
          break
      }
    })
  }

  #registerActions = (): void => {
    if (this.#registered) {
      // unregister old actions first
      this.emitEffect('overlay:unregister-action', { name: 'meeting-join' })
      this.emitEffect('overlay:unregister-action', { name: 'meeting-camera' })
    }
    this.#registered = true

    const state = this.#meetingState
    const cameraOn = this.#cameraOn

    const actions: any[] = []
    const available = state !== 'idle'

    // Join button — visible when not yet joined (idle state)
    if (!available) {
      actions.push({
        name: 'meeting-join',
        svgMarkup: JOIN_ICON_SVG,
        x: -14,
        y: ICON_Y,
        hoverTint: 0xa8ffd8,
        profile: 'public-own',
        visibleWhen: () => !available,
      })
    }

    // Camera button — visible once joined (gathering or active)
    if (available) {
      actions.push({
        name: 'meeting-camera',
        svgMarkup: cameraOn ? CAMERA_ON_SVG : CAMERA_OFF_SVG,
        x: -14,
        y: ICON_Y,
        hoverTint: cameraOn ? 0xffc8c8 : 0xa8ffd8,
        profile: 'public-own',
        visibleWhen: () => available,
      })
    }

    if (actions.length > 0) {
      this.emitEffect('overlay:register-action', actions)
    }
  }
}

const _meetingControls = new MeetingControlsWorker()
window.ioc.register('@diamondcoreprocessor.com/MeetingControlsWorker', _meetingControls)
