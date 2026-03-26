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
      border-radius: 2px;
      background: rgba(0,0,0,0.10);
      transition: background 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .toggle.on .track {
      background: rgba(74, 111, 165, 0.35);
    }

    .thumb {
      position: absolute;
      top: 0;
      left: 0;
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: #bbb;
      transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1),
                  background 0.25s cubic-bezier(0.4, 0, 0.2, 1),
                  box-shadow 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      box-shadow: 0 1px 3px rgba(0,0,0,0.15);
    }

    .toggle.on .thumb {
      transform: translateX(10px);
      background: #4a6fa5;
      box-shadow: 0 1px 4px rgba(74, 111, 165, 0.4);
    }

    .toggle:hover .thumb {
      box-shadow: 0 0 0 4px rgba(0,0,0,0.04), 0 1px 3px rgba(0,0,0,0.15);
    }

    .toggle.on:hover .thumb {
      box-shadow: 0 0 0 4px rgba(74, 111, 165, 0.1), 0 1px 4px rgba(74, 111, 165, 0.4);
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
