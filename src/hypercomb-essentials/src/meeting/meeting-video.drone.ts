// meeting/meeting-video.drone.ts
//
// THE MEETING'S SOUND. The picture is drawn elsewhere: the speaker fills a
// rectangle, and everyone else is a hexagon in the flower
// (hive/meeting-hive.view.ts). Those elements stay muted. This drone is the
// one place a stream is heard, so a voice is never played twice. Your own
// stream stays muted — hearing yourself back is an echo.

import { Drone } from '@hypercomb/core'
import type { MeetingState } from './hive-meeting.drone.js'
import { PlaybackRetry, watchAudioTrack } from './meeting-playback.js'

type MeetingStreamPayload = { streams: Map<string, MediaStream> }
type MeetingStatePayload = { state: MeetingState; threshold: number }

export class MeetingVideoDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'meeting'

  public override description =
    'Plays the meeting\'s voices once. The picture is the speaker\'s rectangle and the flower, not a hex on the hive.'

  protected override listens = ['meeting:streams', 'meeting:state']

  #els = new Map<string, HTMLVideoElement>()
  /** Comes off with the element. An audio track added later has to call play() again. */
  #unwatch = new Map<string, () => void>()
  /** One gesture for every remote element autoplay refused. Own video stays muted. */
  #sound = new PlaybackRetry(
    document,
    () => [...this.#els.values()].filter(video => video.paused),
    error => console.warn('[meeting-video] remote sound is blocked until a click or a key', error),
  )
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
      const remote = id !== this.#ownId()
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
      this.#watch(id, video, stream, remote)
      if (video.srcObject !== stream) {
        video.srcObject = stream
        this.#play(video, remote)
      }
    }
  }

  /** A remote rejection arms the one gesture. Your own element stays muted and is not warned. */
  #play = (video: HTMLVideoElement, remote: boolean): void => {
    void video.play().then(() => undefined, (error: unknown) => {
      if (remote) this.#sound.rejected(error)
    })
  }

  #watch = (id: string, video: HTMLVideoElement, stream: MediaStream, remote: boolean): void => {
    if (this.#unwatch.has(id) && video.srcObject === stream) return
    this.#unwatch.get(id)?.()
    this.#unwatch.set(id, watchAudioTrack(stream, () => this.#play(video, remote)))
  }

  #remove = (id: string): void => {
    this.#unwatch.get(id)?.()
    this.#unwatch.delete(id)
    const video = this.#els.get(id)
    if (video) {
      video.pause()
      video.srcObject = null
      video.remove()
      this.#els.delete(id)
    }
    const own = this.#ownId()
    if (![...this.#els.entries()].some(([peer, element]) => peer !== own && element.paused)) this.#sound.disarm()
  }

  #stopAll = (): void => {
    for (const id of [...this.#els.keys()]) this.#remove(id)
    this.#sound.disarm()
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
