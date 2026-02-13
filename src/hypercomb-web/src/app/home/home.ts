import { Component, computed, inject } from '@angular/core';
import { OpfsExplorerComponent } from "../common/file-explorer/opfs-explorer.component";
import { ResourceMessageHandler } from '../messaging/resource-message-handler';
import { Lineage } from '../core/lineage';

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
