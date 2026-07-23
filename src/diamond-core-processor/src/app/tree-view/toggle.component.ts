// diamond-core-processor/src/app/tree-view/toggle.component.ts

import { Component, input, output } from '@angular/core'

@Component({
  selector: 'dcp-toggle',
  standalone: true,
  template: `
    <button
      class="toggle"
      [class.on]="enabled()"
      [class.dimmed]="!effectivelyEnabled() && enabled()"
      (click)="toggled.emit(); $event.stopPropagation()">
      <span class="thumb"></span>
    </button>
  `,
  styles: [`
    :host { display: inline-flex; align-items: center; }

    /* Foundry switch — a sharp rectangle; the track IS the button. Gold when
       on. Zero radius: the geometry, not a pill, carries the on/off read. */
    .toggle {
      position: relative;
      width: 34px;
      height: 19px;
      border: 1px solid var(--dcp-line-2);
      background: var(--dcp-raise);
      cursor: pointer;
      padding: 0;
      outline: none;
      transition: background 0.14s ease, border-color 0.14s ease;
    }

    .thumb {
      position: absolute;
      top: 1px;
      left: 1px;
      width: 15px;
      height: 15px;
      background: var(--dcp-ink-3);
      transition: left 0.14s ease, background 0.14s ease;
    }

    .toggle.on {
      background: var(--dcp-gold-dim);
      border-color: var(--dcp-gold);
    }
    .toggle.on .thumb {
      left: 16px;
      background: var(--dcp-gold);
    }
    .toggle:hover { border-color: var(--dcp-ink-3); }
    .toggle.on:hover { border-color: var(--dcp-gold-strong); }
    .toggle.on:hover .thumb { background: var(--dcp-gold-strong); }

    .toggle.dimmed { opacity: 0.4; }

    @media (max-width: 600px) {
      .toggle { width: 44px; height: 24px; }
      .thumb { width: 20px; height: 20px; }
      .toggle.on .thumb { left: 21px; }
    }
  `]
})
export class ToggleComponent {
  enabled = input(true)
  effectivelyEnabled = input(true)
  toggled = output<void>()
}
