// diamond-core-processor/src/app/tree-view/diamond-icon.component.ts

import { Component, input, output } from '@angular/core'
import type { TreeNodeKind } from '../core/tree-node'

@Component({
  selector: 'dcp-diamond',
  standalone: true,
  template: `
    <button
      class="diamond"
      [class.domain]="kind() === 'domain'"
      [class.layer]="kind() === 'layer'"
      [class.bee]="kind() === 'bee'"
      [class.worker]="kind() === 'worker'"
      [class.drone]="kind() === 'drone'"
      [class.dependency]="kind() === 'dependency'"
      (click)="clicked.emit(); $event.stopPropagation()">
    </button>
  `,
  styles: [`
    :host { display: inline-flex; align-items: center; }

    .diamond {
      width: 12px;
      height: 12px;
      border: none;
      border-radius: 2px;
      cursor: pointer;
      padding: 0;
      transform: perspective(200px) rotateZ(45deg) rotateX(15deg);
      box-shadow: 1px 1px 4px rgba(0,0,0,0.2);
      transition: transform 0.3s ease, box-shadow 0.3s ease;
    }

    .diamond:hover {
      transform: perspective(200px) rotateZ(45deg) rotateX(15deg) scale(1.15);
      box-shadow: 2px 2px 6px rgba(0,0,0,0.3);
    }

    .diamond.domain {
      background: linear-gradient(135deg, #b8cce8, #4a6fa5);
    }

    .diamond.layer {
      background: linear-gradient(135deg, #d4b8e8, #7b4fa5);
    }

    .diamond.bee {
      background: linear-gradient(135deg, #e8d4b8, #a58b4f);
    }

    .diamond.worker {
      background: linear-gradient(135deg, #e8b8b8, #a54f4f);
    }

    .diamond.drone {
      background: linear-gradient(135deg, #e8e0b8, #a59b4f);
    }

    .diamond.dependency {
      background: linear-gradient(135deg, #b8e8d4, #4fa58b);
    }
  `]
})
export class DiamondIconComponent {
  kind = input<TreeNodeKind>('layer')
  clicked = output<void>()
}
