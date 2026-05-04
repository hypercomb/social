import { Component, OnDestroy, signal } from '@angular/core';
import { EffectBus } from '@hypercomb/core';
import type { ResourceMessageHandler } from '@hypercomb/shared/core/resource-message-handler';
import { TrackPlayerComponent } from '@hypercomb/shared/ui/track-player/track-player.component';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [TrackPlayerComponent],
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class Home implements OnDestroy {
  readonly playerOpen = signal(false)

  private get handler(): ResourceMessageHandler { return get('@hypercomb.social/ResourceMessageHandler') as ResourceMessageHandler }

  constructor() {
    // Re-open the track player when /player queen is invoked
    EffectBus.on('player:open', () => {
      this.playerOpen.set(true)
    })
  }

  dismissPlayer(): void {
    this.playerOpen.set(false)
    try { localStorage.setItem('hc:player-dismissed', 'true') } catch { /* storage unavailable */ }
  }

  ngOnDestroy(): void {
    this.handler.destroy()
  }
}
