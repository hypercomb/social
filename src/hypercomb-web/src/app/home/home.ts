import { Component, computed, inject } from '@angular/core';
import { Lineage } from '@hypercomb/shared/core';
import { ResourceMessageHandler } from '@hypercomb/shared/core/resource-message-handler';
import { OpfsExplorerComponent } from '@hypercomb/shared/ui';

@Component({
  selector: 'app-home',
  imports: [],
  templateUrl: './home.html',
  styleUrl: './home.scss'
})
export class Home {
  private handler = inject(ResourceMessageHandler)
  private readonly lineage = inject(Lineage) 
  public ready = computed(() =>  this.lineage.ready())
 
  ngOnDestroy(): void {
    this.handler.destroy()
  }
}
