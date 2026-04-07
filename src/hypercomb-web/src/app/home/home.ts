import { DOCUMENT } from '@angular/common';
import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import type { Lineage } from '@hypercomb/shared/core';
import type { ResourceMessageHandler } from '@hypercomb/shared/core/resource-message-handler';
import { fromRuntime } from '@hypercomb/shared/core/from-runtime';
import { AudioPlayerComponent } from '@hypercomb/shared/ui/audio-player/audio-player.component';

interface TrackEntry {
  file: string;
  title: string;
  src: string;
}

interface TrackManifest {
  tracks?: TrackEntry[];
}

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [AudioPlayerComponent],
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class Home implements OnInit, OnDestroy {
  readonly tracks = signal<TrackEntry[]>([]);
  readonly selectedTrack = signal<TrackEntry | null>(null);
  readonly loadingTracks = signal(true);
  readonly trackLoadError = signal('');

  private readonly document = inject(DOCUMENT);
  private get handler(): ResourceMessageHandler { return get('@hypercomb.social/ResourceMessageHandler') as ResourceMessageHandler }
  private get lineage(): Lineage { return get('@hypercomb.social/Lineage') as Lineage }
  public ready = fromRuntime(
    get('@hypercomb.social/Lineage') as EventTarget,
    () => this.lineage.ready
  )

  ngOnInit(): void {
    void this.loadTracks();
  }

  selectTrack(track: TrackEntry): void {
    this.selectedTrack.set(track);
  }

  ngOnDestroy(): void {
    this.handler.destroy()
  }

  private async loadTracks(): Promise<void> {
    this.loadingTracks.set(true);
    this.trackLoadError.set('');

    try {
      const manifestUrl = new URL('tracks/manifest.json', this.document.baseURI).toString();
      const response = await fetch(manifestUrl, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`track manifest request failed with ${response.status}`);
      }

      const manifest = await response.json() as TrackManifest;
      const tracks = Array.isArray(manifest.tracks)
        ? manifest.tracks.filter(track => !!track?.src && !!track?.title)
        : [];

      this.tracks.set(tracks);
      this.selectedTrack.set(tracks[0] ?? null);
    } catch (error) {
      console.error('[home] failed to load tracks', error);
      this.trackLoadError.set('Tracks are unavailable right now. Add audio files to public/tracks, then restart dev or rebuild the site.');
    } finally {
      this.loadingTracks.set(false);
    }
  }
}
