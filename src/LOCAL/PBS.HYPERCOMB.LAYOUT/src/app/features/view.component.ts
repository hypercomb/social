// src/app/features/website/website-view.component.ts

import { Component, computed } from '@angular/core'
import { EdgeStore } from '../core/substrate/edge-store.service'
import { WEBSITE_EDGE } from '../core/interpreter/pathways'

@Component({
  selector: 'hc-website-view',
  template: `
    <iframe *ngIf="visible()" src="https://hypercomb.io" class="frame"></iframe>
  `,
  styles: [`
    .frame { width: 100%; height: 100%; border: none; }
  `]
})
export class WebsiteViewComponent {

  public readonly visible = computed(() => this.edges.has(WEBSITE_EDGE))

  constructor(private readonly edges: EdgeStore) {}
}
