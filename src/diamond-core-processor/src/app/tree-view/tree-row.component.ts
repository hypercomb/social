// diamond-core-processor/src/app/tree-view/tree-row.component.ts

import { Component, computed, ElementRef, inject, input, OnDestroy, OnInit, output, signal } from '@angular/core'
import { ToggleComponent } from './toggle.component'
import { DiamondIconComponent } from './diamond-icon.component'
import type { TreeNode } from '../core/tree-node'

@Component({
  selector: 'dcp-tree-row',
  standalone: true,
  imports: [ToggleComponent, DiamondIconComponent],
  template: `
    @if (visible()) {
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
          @if (lineageDisplay()) {
            <span class="lineage">{{ lineageDisplay() }}</span>
          }
          <span class="name" [class]="node().kind">{{ node().name }}</span>
          @if (description()) {
            <span class="description">{{ description() }}</span>
          }
        </button>

        @if (splitClassName()) {
          <span class="kind-label" [class]="docKind()">{{ splitClassName() }}</span>
        }

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

        @if (node().kind === 'layer' && node().signature) {
          <button class="promote-btn" (click)="promoteToPackage.emit(node()); $event.stopPropagation()" title="Promote to package root">&#8689;</button>
        }

        @if (hasChildren()) {
          <button class="chevron" (click)="expandToggle.emit(node())">
            {{ node().expanded ? '\u25BE' : '\u25B8' }}
          </button>
        }
      </div>
    } @else {
      <div class="row-placeholder" [style.--depth]="node().depth"></div>
    }
  `,
  styles: [`
    :host { display: block; min-height: 1px; }

    .row-placeholder {
      height: 32px;
      padding-left: calc(10px + var(--depth, 0) * 20px);
    }

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
      font-size: 11px;
      font-weight: 500;
      color: #333;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .name.bee { color: #a58b4f; }
    .name.worker { color: #a54f4f; }
    .name.drone { color: #a59b4f; }
    .name.dependency { color: #4fa58b; }

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

    .kind-label {
      font-size: 12px;
      font-weight: 500;
      white-space: nowrap;
      flex-shrink: 0;
      margin-left: auto;
      color: #a58b4f;
    }

    .kind-label.worker { color: #a54f4f; }
    .kind-label.drone { color: #a59b4f; }
    .kind-label.queen { color: #7b4fa5; }
    .kind-label.dependency { color: #4fa58b; }

    .sig {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 10px;
      color: #bbb;
      flex-shrink: 0;
    }

    .audit-badge {
      font-size: 10px;
      font-weight: 500;
      padding: 1px 6px;
      border-radius: 2px;
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

    .promote-btn {
      background: none;
      border: 1px solid rgba(0,0,0,0.08);
      border-radius: 2px;
      cursor: pointer;
      font-size: 12px;
      color: #4a6fa5;
      padding: 1px 4px;
      flex-shrink: 0;
      opacity: 0;
      transition: opacity 0.15s;
    }

    .row:hover .promote-btn {
      opacity: 1;
    }

    .promote-btn:hover {
      background: rgba(74, 111, 165, 0.08);
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
      .kind-label,
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
        border-radius: 2px;
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

      .row-placeholder {
        height: 48px;
        padding-left: calc(8px + var(--depth, 0) * 14px);
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
export class TreeRowComponent implements OnInit, OnDestroy {
  #el = inject(ElementRef)
  #observer: IntersectionObserver | null = null

  node = input.required<TreeNode>()
  enabled = input(true)
  effectivelyEnabled = input(true)
  hasChildren = input(false)

  toggle = output<TreeNode>()
  open = output<TreeNode>()
  openDetail = output<TreeNode>()
  expandToggle = output<TreeNode>()
  promoteToPackage = output<TreeNode>()

  visible = signal(true)

  docKind = computed(() => this.node().doc?.kind || this.node().kind)

  lineageDisplay = computed(() => {
    const n = this.node()
    if (!n.lineage || n.kind === 'layer' || n.kind === 'domain') return ''
    const parts = n.lineage.split('/')
    if (parts.length <= 1) return n.lineage + ' /'
    return parts.slice(0, -1).join('/') + ' / ' + parts[parts.length - 1] + ' /'
  })

  splitClassName = computed(() => {
    const name = this.node().doc?.className
    if (!name) return ''
    return name.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()
  })

  description = computed(() => {
    const n = this.node()
    return n.doc?.description || n.layerDocs?.description || ''
  })

  ngOnInit(): void {
    this.#observer = new IntersectionObserver(
      ([entry]) => this.visible.set(entry.isIntersecting),
      { rootMargin: '200px 0px' }
    )
    this.#observer.observe(this.#el.nativeElement)
  }

  ngOnDestroy(): void {
    this.#observer?.disconnect()
  }
}
