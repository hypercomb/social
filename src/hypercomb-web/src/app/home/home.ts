import { Component, OnDestroy, signal } from '@angular/core';
import type { Lineage } from '@hypercomb/shared/core';
import type { ResourceMessageHandler } from '@hypercomb/shared/core/resource-message-handler';
import { fromRuntime } from '@hypercomb/shared/core/from-runtime';
import { TrackPlayerComponent } from '@hypercomb/shared/ui/track-player/track-player.component';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [TrackPlayerComponent],
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class Home implements OnDestroy {
  readonly playerOpen = signal(true)

  private get handler(): ResourceMessageHandler { return get('@hypercomb.social/ResourceMessageHandler') as ResourceMessageHandler }
  private get lineage(): Lineage { return get('@hypercomb.social/Lineage') as Lineage }
  public ready = fromRuntime(
    get('@hypercomb.social/Lineage') as EventTarget,
    () => this.lineage.ready
  )

  dismissPlayer(): void {
    this.playerOpen.set(false)
  }

  ngOnDestroy(): void {
    this.handler.destroy()
  }
}
