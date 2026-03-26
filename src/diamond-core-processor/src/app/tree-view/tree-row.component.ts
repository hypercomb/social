// diamond-core-processor/src/app/tree-view/tree-row.component.ts

import { Component, computed, input, output } from '@angular/core'
import { ToggleComponent } from './toggle.component'
import { DiamondIconComponent } from './diamond-icon.component'
import type { TreeNode } from '../core/tree-node'

@Component({
  selector: 'dcp-tree-row',
  standalone: true,
  imports: [ToggleComponent, DiamondIconComponent],
  template: `
    <div class="row" [style.--depth]="node().depth">
      @if (node().kind === 'layer' || node().kind === 'domain') {
        <dcp-toggle
          [enabled]="enabled()"
          [effectivelyEnabled]="effectivelyEnabled()"
          (toggled)="toggle.emit(node())" />
      }

      <dcp-diamond
        [kind]="node().kind"
        (clicked)="open.emit(node())" />

      <button class="label" (click)="hasChildren() ? expandToggle.emit(node()) : open.emit(node())">
        @if (node().lineage && node().kind !== 'layer' && node().kind !== 'domain') {
          <span class="lineage">{{ node().lineage }}/</span>
        }
        <span class="name">{{ node().name }}</span>
        @if (description()) {
          <span class="description">{{ description() }}</span>
        }
      </button>

      @if (node().signature) {
        <span class="sig">{{ node().signature!.slice(0, 8) }}</span>
      }

      @if (node().audit) {
        <span class="audit-badge" [class.met]="node().audit!.meetsThreshold" [class.unmet]="!node().audit!.meetsThreshold">
          {{ node().audit!.approvedBy.length }}/{{ node().audit!.total }}
        </span>
      }

      @if (node().signature && (node().kind === 'bee' || node().kind === 'worker' || node().kind === 'drone' || node().kind === 'dependency')) {
        <button class="info-btn" (click)="openDetail.emit(node()); $event.stopPropagation()">&#9432;</button>
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
      gap: 6px;
      padding: 5px 10px 5px 0;
      padding-left: calc(10px + var(--depth, 0) * 20px);
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
      flex-wrap: wrap;
    }

    .name {
      font-size: 12px;
      font-weight: 500;
      color: #333;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .description {
      font-size: 10px;
      color: #999;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      width: 100%;
      line-height: 1.2;
    }

    .lineage {
      font-size: 10px;
      color: #aaa;
      white-space: nowrap;
      flex-shrink: 0;
    }

    .sig {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 10px;
      color: #bbb;
      flex-shrink: 0;
      margin-left: auto;
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

    /* info button — hidden on desktop, visible on mobile */
    .info-btn {
      display: none;
    }

    @media (max-width: 600px) {
      .row {
        padding-left: calc(8px + var(--depth, 0) * 14px);
        gap: 8px;
        padding-top: 10px;
        padding-bottom: 10px;
        min-height: 48px;
      }

      .name {
        font-size: 15px;
        font-weight: 500;
      }

      /* hide technical details — tap to see them in the detail view */
      .description,
      .lineage,
      .sig,
      .audit-badge {
        display: none;
      }

      .info-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        background: none;
        border: 1px solid rgba(0, 0, 0, 0.08);
        border-radius: 8px;
        cursor: pointer;
        font-size: 18px;
        color: #4a6fa5;
        min-width: 40px;
        min-height: 40px;
        flex-shrink: 0;
        margin-left: auto;
        transition: background 0.15s;
      }

      .info-btn:active {
        background: rgba(74, 111, 165, 0.08);
      }

      .chevron {
        font-size: 18px;
        padding: 4px 8px;
        min-width: 44px;
        min-height: 44px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
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
  openDetail = output<TreeNode>()
  expandToggle = output<TreeNode>()

  description = computed(() => {
    const n = this.node()
    return n.doc?.description || n.layerDocs?.description || ''
  })
}
