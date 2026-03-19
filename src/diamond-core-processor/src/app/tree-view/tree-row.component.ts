// src/app/tree-view/tree-row.component.ts
import { Component, input, output } from '@angular/core'
import { ToggleComponent } from './toggle.component'
import { DiamondIconComponent } from './diamond-icon.component'
import type { TreeNode } from '../core/tree-node'

@Component({
  selector: 'dcp-tree-row',
  standalone: true,
  imports: [ToggleComponent, DiamondIconComponent],
  template: `
    <div class="row" [style.padding-left.px]="node().depth * 20">
      <dcp-toggle
        [enabled]="enabled()"
        [effectivelyEnabled]="effectivelyEnabled()"
        (toggled)="toggle.emit(node())" />

      <dcp-diamond
        [kind]="node().kind"
        (clicked)="open.emit(node())" />

      <button class="label" (click)="hasChildren() ? expandToggle.emit(node()) : open.emit(node())">
        <span class="name">{{ node().name }}</span>
        @if (node().signature) {
          <span class="sig">{{ node().signature!.slice(0, 8) }}</span>
        }
      </button>

      @if (node().audit) {
        <span class="audit-badge" [class.met]="node().audit!.meetsThreshold" [class.unmet]="!node().audit!.meetsThreshold">
          {{ node().audit!.approvedBy.length }}/{{ node().audit!.total }}
        </span>
      }

      @if (hasChildren()) {
        <button class="chevron" (click)="expandToggle.emit(node())">
          {{ node().expanded ? '\u25BE' : '\u25B8' }}
        </button>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }

    .row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 5px 0;
      border-bottom: 1px solid rgba(0,0,0,0.05);
    }

    .row:hover {
      background: rgba(0,0,0,0.02);
    }

    .label {
      display: flex;
      align-items: baseline;
      gap: 8px;
      background: none;
      border: none;
      cursor: pointer;
      padding: 0;
      flex: 1;
      min-width: 0;
      text-align: left;
    }

    .name {
      font-size: 12px;
      font-weight: 400;
      color: #333;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .sig {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 10px;
      color: #888;
      flex-shrink: 0;
    }

    .audit-badge {
      font-size: 10px;
      font-weight: 500;
      padding: 1px 6px;
      border-radius: 8px;
      flex-shrink: 0;
    }

    .audit-badge.met {
      background: #e6f4ea;
      color: #1e7e34;
    }

    .audit-badge.unmet {
      background: #fff3e0;
      color: #e65100;
    }

    .chevron {
      background: none;
      border: none;
      cursor: pointer;
      font-size: 14px;
      color: #666;
      padding: 0 4px;
      flex-shrink: 0;
    }

    .chevron:hover {
      color: #222;
    }
  `]
})
export class TreeRowComponent {
  node = input.required<TreeNode>()
  enabled = input(true)
  effectivelyEnabled = input(true)
  hasChildren = input(false)

  toggle = output<TreeNode>()
  open = output<TreeNode>()
  expandToggle = output<TreeNode>()
}
