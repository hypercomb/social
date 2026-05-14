import { Component, OnDestroy } from '@angular/core';
import type { ResourceMessageHandler } from '@hypercomb/shared/core/resource-message-handler';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [],
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class Home implements OnDestroy {
  private get handler(): ResourceMessageHandler { return get('@hypercomb.social/ResourceMessageHandler') as ResourceMessageHandler }

  ngOnDestroy(): void {
    this.handler.destroy()
  }
}
