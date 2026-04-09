import { DOCUMENT } from '@angular/common'
import { Component, EventEmitter, OnDestroy, OnInit, Output, inject, signal } from '@angular/core'
import { AudioPlayerComponent } from '../audio-player/audio-player.component'

interface TrackEntry {
  file: string
  title: string
  src: string
  limited?: boolean
}

interface TrackManifest {
  tracks?: TrackEntry[]
}

interface TrackSequenceState {
  episodeOneCompleted: boolean
  prequelCompleted: boolean
}

const TRACK_SEQUENCE_STORAGE_KEY = 'hc:track-player:sequence'
const NO_SIGNAL_DURATION_MS = 2500

@Component({
  selector: 'hc-track-player',
  standalone: true,
  imports: [AudioPlayerComponent],
  templateUrl: './track-player.component.html',
  styleUrl: './track-player.component.scss',
})
export class TrackPlayerComponent implements OnInit, OnDestroy {
  @Output() closed = new EventEmitter<void>()

  readonly tracks = signal<TrackEntry[]>([])
  readonly selectedTrack = signal<TrackEntry | null>(null)
  readonly loadingTracks = signal(true)
  readonly trackLoadError = signal('')
  readonly autoplaySelectedTrack = signal(false)
  readonly showNoSignal = signal(false)

  #document = inject(DOCUMENT)
  #noSignalTimer?: ReturnType<typeof setTimeout>

  dismiss(): void {
    this.#cancelNoSignalTimer()
    this.closed.emit()
  }

  ngOnInit(): void {
    void this.#loadTracks()
  }

  ngOnDestroy(): void {
    this.#cancelNoSignalTimer()
  }

  selectTrack(track: TrackEntry): void {
    this.#cancelNoSignalTimer()
    this.showNoSignal.set(false)
    this.selectedTrack.set(track)
    this.autoplaySelectedTrack.set(true)
  }

  onTrackEnded(): void {
    const currentTrack = this.selectedTrack()
    const tracks = this.tracks()
    const episodeOne = tracks[0] ?? null
    const prequel = tracks.at(-1) ?? null

    if (!currentTrack) return

    if (episodeOne && currentTrack.file === episodeOne.file) {
      const nextState = {
        ...this.#readSequenceState(),
        episodeOneCompleted: true,
      }
      this.#writeSequenceState(nextState)

      if (prequel && !nextState.prequelCompleted) {
        this.#startNoSignalTransition(prequel)
      } else {
        this.autoplaySelectedTrack.set(false)
      }
      return
    }

    if (prequel && currentTrack.file === prequel.file) {
      this.#writeSequenceState({
        ...this.#readSequenceState(),
        episodeOneCompleted: true,
        prequelCompleted: true,
      })
      this.autoplaySelectedTrack.set(false)
    }
  }

  skipNoSignal(): void {
    const prequel = this.tracks().at(-1) ?? null
    if (!prequel) return
    this.#beginTrackPlayback(prequel)
  }

  async #loadTracks(): Promise<void> {
    this.loadingTracks.set(true)
    this.trackLoadError.set('')

    try {
      const manifestUrl = new URL('tracks/manifest.json', this.#document.baseURI).toString()
      const response = await fetch(manifestUrl, { cache: 'no-store' })
      if (!response.ok) {
        throw new Error(`track manifest request failed with ${response.status}`)
      }

      const manifest = await response.json() as TrackManifest
      const tracks = Array.isArray(manifest.tracks)
        ? manifest.tracks.filter(track => !!track?.src && !!track?.title)
        : []

      this.tracks.set(tracks)
      this.#restoreSequence(tracks)
    } catch (error) {
      console.error('[track-player] failed to load tracks', error)
      this.trackLoadError.set('Tracks are unavailable right now.')
    } finally {
      this.loadingTracks.set(false)
    }
  }

  #restoreSequence(tracks: TrackEntry[]): void {
    const episodeOne = tracks[0] ?? null
    const prequel = tracks.at(-1) ?? null
    const state = this.#readSequenceState()

    if (!episodeOne) {
      this.selectedTrack.set(null)
      this.autoplaySelectedTrack.set(false)
      return
    }

    if (!state.episodeOneCompleted) {
      this.selectedTrack.set(episodeOne)
      this.autoplaySelectedTrack.set(true)
      return
    }

    if (prequel && !state.prequelCompleted) {
      this.#startNoSignalTransition(prequel)
      return
    }

    this.selectedTrack.set(prequel ?? episodeOne)
    this.autoplaySelectedTrack.set(false)
  }

  #startNoSignalTransition(nextTrack: TrackEntry): void {
    this.#cancelNoSignalTimer()
    this.autoplaySelectedTrack.set(false)
    this.showNoSignal.set(true)
    this.#noSignalTimer = setTimeout(() => {
      this.#noSignalTimer = undefined
      this.#beginTrackPlayback(nextTrack)
    }, NO_SIGNAL_DURATION_MS)
  }

  #beginTrackPlayback(track: TrackEntry): void {
    this.#cancelNoSignalTimer()
    this.showNoSignal.set(false)
    this.selectedTrack.set(track)
    this.autoplaySelectedTrack.set(true)
  }

  #cancelNoSignalTimer(): void {
    if (!this.#noSignalTimer) return
    clearTimeout(this.#noSignalTimer)
    this.#noSignalTimer = undefined
  }

  #readSequenceState(): TrackSequenceState {
    const fallback: TrackSequenceState = {
      episodeOneCompleted: false,
      prequelCompleted: false,
    }
    const storage = this.#document.defaultView?.localStorage
    if (!storage) return fallback

    try {
      const rawState = storage.getItem(TRACK_SEQUENCE_STORAGE_KEY)
      if (!rawState) return fallback

      const parsed = JSON.parse(rawState) as Partial<TrackSequenceState>
      return {
        episodeOneCompleted: parsed.episodeOneCompleted === true,
        prequelCompleted: parsed.prequelCompleted === true,
      }
    } catch {
      return fallback
    }
  }

  #writeSequenceState(state: TrackSequenceState): void {
    const storage = this.#document.defaultView?.localStorage
    if (!storage) return

    storage.setItem(TRACK_SEQUENCE_STORAGE_KEY, JSON.stringify(state))
  }
}
