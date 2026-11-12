// meeting/meeting-playback.ts
//
// Two decisions the meeting drones share, kept here so they can be tested
// without a camera or a peer connection: which microphone tracks are still
// worth sending, and how a remote voice retries after autoplay refuses it.

export type TrackLike = { readonly kind: string; readonly readyState: string }

/** Audio tracks a publish can send. An ended track is not one of them. */
export const liveMicTracks = <T extends TrackLike>(tracks: readonly T[]): T[] =>
  tracks.filter(track => track.kind === 'audio' && track.readyState === 'live')

export type Playable = {
  paused: boolean
  muted: boolean
  play: () => Promise<void>
}

export type GestureHost = {
  addEventListener(type: string, listener: EventListener, capture?: boolean): void
  removeEventListener(type: string, listener: EventListener, capture?: boolean): void
}

/** Play again when an audio track joins a stream the element is already showing. */
export const watchAudioTrack = (stream: EventTarget, play: () => void): (() => void) => {
  const listener = (event: Event): void => {
    const track = (event as Event & { track?: { kind?: string } | null }).track
    if (track?.kind === 'audio') play()
  }
  stream.addEventListener('addtrack', listener)
  return () => stream.removeEventListener('addtrack', listener)
}

/**
 * One document gesture — the same function on pointerdown and keydown, in
 * capture — that retries play() on every element still paused. A second
 * rejection does not add another listener. The warning fires once per streak.
 * The listener comes off when every retry has started, or when disarm() runs.
 */
export class PlaybackRetry {
  #host: GestureHost
  #paused: () => readonly Playable[]
  #warn: (error: unknown) => void
  #listener: EventListener | null = null
  #warned = false

  constructor(host: GestureHost, paused: () => readonly Playable[], warn: (error: unknown) => void) {
    this.#host = host
    this.#paused = paused
    this.#warn = warn
  }

  get armed(): boolean { return this.#listener !== null }

  /** A remote play() was rejected. */
  rejected(error: unknown): void {
    if (!this.#warned) {
      this.#warned = true
      this.#warn(error)
    }
    if (this.#listener) return
    const listener: EventListener = () => { void this.#retry() }
    this.#listener = listener
    this.#host.addEventListener('pointerdown', listener, true)
    this.#host.addEventListener('keydown', listener, true)
  }

  async #retry(): Promise<void> {
    const waiting = this.#paused().filter(element => element.paused)
    await Promise.all(waiting.map(async element => {
      try { await element.play() }
      catch (error) { if (!element.muted) this.rejected(error) }
    }))
    if (!this.#paused().some(element => element.paused)) {
      this.#warned = false
      this.disarm()
    }
  }

  disarm(): void {
    const listener = this.#listener
    if (!listener) return
    this.#host.removeEventListener('pointerdown', listener, true)
    this.#host.removeEventListener('keydown', listener, true)
    this.#listener = null
  }
}
