import { Component, computed, inject } from '@angular/core';
import { ResourceMessageHandler } from '../../../../hypercomb-shared/ui/search-bar/resource-message-handler';
import { Lineage } from '@hypercomb/shared/core';

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
