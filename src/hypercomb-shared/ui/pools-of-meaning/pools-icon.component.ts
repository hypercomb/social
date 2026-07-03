// hypercomb-shared/ui/pools-of-meaning/pools-icon.component.ts
//
// The Pools of Meaning icon — a ONE-STATE portal (2026-07-03), same contract
// as every aggregate icon: clicking it brings up the `sets/` layer, the page
// of the participant's reference sets (each set is a tile; creating a tile
// there creates a set — see documentation/entrances-and-sets.md). No popup, no
// hover card, no toggle: a pool of meaning is just a LOCATION, and the icon
// just navigates there. Sits in the command bar; hover shows the name via the
// native title.
//
// `sets/` is a lineage OUTSIDE every published entrance (leaf-only commits
// never link it into the hive root), so the sets page is referenceable by the
// keeper but never intrinsically shared.

import { Component } from '@angular/core'
import { TranslatePipe } from '../../core/i18n.pipe'

type NavigationLike = { goRaw?: (segments: readonly string[]) => void }

@Component({
  selector: 'hc-pools-icon',
  standalone: true,
  imports: [TranslatePipe],
  template: `
    <button class="pools-btn" type="button"
            (click)="open()"
            [attr.aria-label]="'pools.title' | t"
            [title]="'pools.title' | t">
      <span class="mat-sym">hub</span>
    </button>
  `,
  styles: [`
    :host { display: inline-flex; align-items: center; }

    .pools-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 1.9rem;
      height: 1.9rem;
      padding: 0;
      background: none;
      border: none;
      border-radius: 8px;
      color: rgba(206, 224, 240, 0.6);
      cursor: pointer;
      transition: color 150ms ease, background 150ms ease;

      .mat-sym {
        font-family: 'Material Symbols Outlined';
        font-size: 1.3rem;
        line-height: 1;
      }

      &:hover { color: #eaf5fb; background: rgba(126, 182, 214, 0.12); }
      &:active { transform: scale(0.94); }
      &:focus-visible { outline: 1px solid rgba(126, 182, 214, 0.6); outline-offset: 2px; }
    }
  `],
})
export class PoolsIconComponent {
  open(): void {
    get<NavigationLike>('@hypercomb.social/Navigation')?.goRaw?.(['sets'])
  }
}
