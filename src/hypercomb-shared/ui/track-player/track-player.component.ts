import { DOCUMENT } from '@angular/common'
import { Component, EventEmitter, OnInit, Output, inject, signal } from '@angular/core'
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

@Component({
  selector: 'hc-track-player',
  standalone: true,
  imports: [AudioPlayerComponent],
  templateUrl: './track-player.component.html',
  styleUrl: './track-player.component.scss',
})
export class TrackPlayerComponent implements OnInit {
  @Output() closed = new EventEmitter<void>()

  readonly tracks = signal<TrackEntry[]>([])
  readonly selectedTrack = signal<TrackEntry | null>(null)
  readonly loadingTracks = signal(true)
  readonly trackLoadError = signal('')

  #document = inject(DOCUMENT)

  dismiss(): void {
    this.closed.emit()
  }

  ngOnInit(): void {
    void this.#loadTracks()
  }

  selectTrack(track: TrackEntry): void {
    this.selectedTrack.set(track)
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
      this.selectedTrack.set(tracks[0] ?? null)
    } catch (error) {
      console.error('[track-player] failed to load tracks', error)
      this.trackLoadError.set('Tracks are unavailable right now.')
    } finally {
      this.loadingTracks.set(false)
    }
  }
}
