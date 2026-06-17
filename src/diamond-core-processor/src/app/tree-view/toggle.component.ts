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
      <span class="track"></span>
      <span class="thumb"></span>
    </button>
  `,
  styles: [`
    :host { display: inline-flex; align-items: center; }

    .toggle {
      position: relative;
      width: 22px;
      height: 12px;
      border: none;
      background: transparent;
      cursor: pointer;
      padding: 0;
      outline: none;
    }

    .track {
      position: absolute;
      inset: 2px 0;
      height: 8px;
      border-radius: 999px;
      background: var(--dcp-line-2);
      transition: background 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .toggle.on .track {
      background: var(--dcp-accent-tint);
    }

    .thumb {
      position: absolute;
      top: 0;
      left: 0;
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: var(--dcp-ink-3);
      transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1),
                  background 0.25s cubic-bezier(0.4, 0, 0.2, 1),
                  box-shadow 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      box-shadow: var(--dcp-shadow-1);
    }

    .toggle.on .thumb {
      transform: translateX(10px);
      background: var(--dcp-accent);
      box-shadow: 0 1px 4px var(--dcp-accent-tint);
    }

    .toggle:hover .thumb {
      box-shadow: 0 0 0 4px var(--dcp-hover), var(--dcp-shadow-1);
    }

    .toggle.on:hover .thumb {
      box-shadow: 0 0 0 4px var(--dcp-accent-tint), 0 1px 4px var(--dcp-accent-tint);
    }

    .toggle.dimmed {
      opacity: 0.3;
    }

    @media (max-width: 600px) {
      .toggle {
        width: 36px;
        height: 20px;
      }

      .track {
        inset: 3px 0;
        height: 14px;
        border-radius: 2px;
      }

      .thumb {
        width: 20px;
        height: 20px;
      }

      .toggle.on .thumb {
        transform: translateX(16px);
      }
    }
  `]
})
export class ToggleComponent {
  enabled = input(true)
  effectivelyEnabled = input(true)
  toggled = output<void>()
}
