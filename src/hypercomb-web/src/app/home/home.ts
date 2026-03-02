import { Component, computed } from '@angular/core';
import type { Lineage } from '@hypercomb/shared/core';
import type { ResourceMessageHandler } from '@hypercomb/shared/core/resource-message-handler';

@Component({
  selector: 'app-home',
  standalone: true,
  templateUrl: './home.html',
  styleUrl: './home.scss'
})
export class Home {
  private get handler(): ResourceMessageHandler { return get('ResourceMessageHandler') as ResourceMessageHandler }
  private get lineage(): Lineage { return get('Lineage') as Lineage }
  public ready = computed(() => this.lineage.ready())

  ngOnDestroy(): void {
    this.handler.destroy()
  }
}
