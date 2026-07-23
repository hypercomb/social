// diamond-core-processor/src/app/tree-view/diamond-icon.component.ts
//
// Kind mark — the little glyph that names WHAT a node is (domain / layer /
// bee / worker / drone / dependency). Foundry: a real geometric SVG per kind,
// stroked in the kind's ink, replacing the old CSS-gradient diamond. Kept the
// `dcp-diamond` selector + kind input + clicked output so every call site
// (tree rows, the top-bar kind filters, the collapse-all button) is unchanged.

import { Component, input, output } from '@angular/core'
import type { TreeNodeKind } from '../core/tree-node'

@Component({
  selector: 'dcp-diamond',
  standalone: true,
  template: `
    <button
      class="kmark"
      [attr.data-kind]="kind()"
      [attr.aria-label]="kind()"
      (click)="clicked.emit(); $event.stopPropagation()">
      @switch (kind()) {
        @case ('layer') {
          <svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="6"/><rect x="4" y="14" width="16" height="6"/></svg>
        }
        @case ('bee') {
          <svg viewBox="0 0 24 24"><path d="M12 3l7.5 4.5v9L12 21l-7.5-4.5v-9L12 3z"/></svg>
        }
        @case ('worker') {
          <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.2"/><path d="M12 4v2.4M12 17.6V20M4 12h2.4M17.6 12H20M6.3 6.3l1.7 1.7M15.9 15.9l1.7 1.7M17.7 6.3l-1.7 1.7M8.1 15.9l-1.7 1.7"/></svg>
        }
        @case ('drone') {
          <svg viewBox="0 0 24 24"><path d="M12 3l7 9-7 9-7-9z"/></svg>
        }
        @case ('dependency') {
          <svg viewBox="0 0 24 24"><path d="M10 13a4 4 0 010-6l1-1a4 4 0 016 6l-1 1M14 11a4 4 0 010 6l-1 1a4 4 0 01-6-6l1-1"/></svg>
        }
        @default {
          <svg viewBox="0 0 24 24"><path d="M12 3l8 9-8 9-8-9z"/><path d="M4 12h16"/></svg>
        }
      }
    </button>
  `,
  styles: [`
    :host { display: inline-flex; align-items: center; }

    .kmark {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      height: 18px;
      padding: 0;
      border: none;
      background: transparent;
      cursor: pointer;
      color: var(--dcp-ink-3);
    }
    .kmark svg {
      width: 18px;
      height: 18px;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.6;
      stroke-linecap: round;
      stroke-linejoin: round;
      display: block;
    }

    /* kind inks — the mark reads as its kind by shape AND colour */
    .kmark[data-kind='domain']     { color: var(--dcp-ice); }
    .kmark[data-kind='layer']      { color: var(--dcp-z-package-ink); }
    .kmark[data-kind='bee']        { color: var(--dcp-k-bee); }
    .kmark[data-kind='worker']     { color: var(--dcp-k-worker); }
    .kmark[data-kind='drone']      { color: var(--dcp-k-drone); }
    .kmark[data-kind='dependency'] { color: var(--dcp-k-dependency); }

    @media (max-width: 600px) {
      :host { min-width: 32px; min-height: 32px; justify-content: center; }
      .kmark { width: 22px; height: 22px; }
      .kmark svg { width: 22px; height: 22px; }
    }
  `]
})
export class DiamondIconComponent {
  kind = input<TreeNodeKind>('layer')
  clicked = output<void>()
}
