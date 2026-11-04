// meeting/meeting-video.drone.ts
//
// THE MEETING'S SOUND. The picture is drawn elsewhere: the speaker fills a
// rectangle, and everyone else is a hexagon in the flower
// (hive/meeting-hive.view.ts). Those elements stay muted. This drone is the
// one place a stream is heard, so a voice is never played twice. Your own
// stream stays muted — hearing yourself back is an echo.

import { Drone } from '@hypercomb/core'
import type { MeetingState } from './hive-meeting.drone.js'

type MeetingStreamPayload = { streams: Map<string, MediaStream> }
type MeetingStatePayload = { state: MeetingState; threshold: number }

export class MeetingVideoDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'meeting'

  public override description =
    'Plays the meeting\'s voices once. The picture is the speaker\'s rectangle and the flower, not a hex on the hive.'

  protected override listens = ['meeting:streams', 'meeting:state']

  #els = new Map<string, HTMLVideoElement>()
  #effectsRegistered = false

  protected override sense = (): boolean => true

  protected override heartbeat = async (): Promise<void> => {
    if (!this.#effectsRegistered) {
      this.#effectsRegistered = true
      this.#registerEffects()
    }
  }

  #registerEffects = (): void => {
    this.onEffect<MeetingStatePayload>('meeting:state', ({ state }) => {
      if (state === 'ended' || state === 'idle') this.#stopAll()
    })
    this.onEffect<MeetingStreamPayload>('meeting:streams', ({ streams }) => {
      this.#sync(streams instanceof Map ? streams : new Map())
    })
  }

  #sync = (streams: Map<string, MediaStream>): void => {
    for (const id of [...this.#els.keys()]) if (!streams.has(id)) this.#remove(id)
    for (const [id, stream] of streams) {
      let video = this.#els.get(id)
      if (!video) {
        video = document.createElement('video')
        video.autoplay = true
        video.playsInline = true
        video.muted = id === this.#ownId()
        video.setAttribute('playsinline', '')
        video.style.display = 'none'
        document.body.appendChild(video)
        this.#els.set(id, video)
      }
      if (video.srcObject !== stream) {
        video.srcObject = stream
        void video.play().catch(() => { /* autoplay policy */ })
      }
    }
  }

  #remove = (id: string): void => {
    const video = this.#els.get(id)
    if (!video) return
    video.pause()
    video.srcObject = null
    video.remove()
    this.#els.delete(id)
  }

  #stopAll = (): void => {
    for (const id of [...this.#els.keys()]) this.#remove(id)
  }

  #ownId = (): string => {
    try { return localStorage.getItem('hc:show-honeycomb:publisher-id') ?? '' }
    catch { return '' }
  }

  protected override dispose = (): void => {
    this.#stopAll()
  }
}

const _meetingVideo = new MeetingVideoDrone()
window.ioc.register('@diamondcoreprocessor.com/MeetingVideoDrone', _meetingVideo)
