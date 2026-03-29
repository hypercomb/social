// diamond-core-processor/src/app/patch-list/patch-list.component.ts

import { Component, computed, input, output } from '@angular/core'
import type { PatchRecord } from '../core/patch-store'

@Component({
  selector: 'dcp-patch-list',
  standalone: true,
  template: `
    @if (patches().length) {
      <div class="patch-list">
        <button class="toggle" (click)="expanded = !expanded">
          patches ({{ patches().length }})
          <span class="chevron" [class.open]="expanded">&#9654;</span>
        </button>

        @if (expanded) {
          <div class="items">
            <button
              class="patch-item original"
              [class.active]="!isPatched()"
              (click)="switchRoot.emit(originalRootSig())">
              <span class="patch-label">original</span>
              <code class="patch-sig">{{ originalRootSig().slice(0, 10) }}&hellip;</code>
            </button>

            @for (patch of patches(); track patch.id) {
              <button
                class="patch-item"
                [class.active]="activeRootSig() === patch.newRootSig"
                (click)="switchRoot.emit(patch.newRootSig)">
                <span class="patch-label">{{ patch.lineage || 'patch' }}</span>
                <code class="patch-sig">{{ patch.newRootSig.slice(0, 10) }}&hellip;</code>
                <span class="patch-time">{{ relativeTime(patch.timestamp) }}</span>
              </button>
            }
          </div>
        }
      </div>
    }
  `,
  styles: [`
    .patch-list {
      margin: 4px 0 8px;
    }

    .toggle {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #888;
      background: none;
      border: none;
      cursor: pointer;
      padding: 4px 0;
    }

    .toggle:hover { color: #555; }

    .chevron {
      font-size: 8px;
      transition: transform 0.15s;
    }

    .chevron.open { transform: rotate(90deg); }

    .items {
      display: flex;
      flex-direction: column;
      gap: 2px;
      margin-top: 4px;
      padding-left: 8px;
    }

    .patch-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 8px;
      font-size: 11px;
      background: none;
      border: 1px solid transparent;
      cursor: pointer;
      text-align: left;
      border-radius: 3px;
    }

    .patch-item:hover { background: #f5f5f5; }

    .patch-item.active {
      background: rgba(74, 111, 165, 0.06);
      border-color: rgba(74, 111, 165, 0.2);
    }

    .patch-label {
      color: #333;
      font-weight: 500;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1;
    }

    .patch-sig {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 10px;
      color: #aaa;
      flex-shrink: 0;
    }

    .patch-time {
      font-size: 10px;
      color: #bbb;
      flex-shrink: 0;
    }

    .original .patch-label { color: #888; }
  `]
})
export class PatchListComponent {
  patches = input<PatchRecord[]>([])
  activeRootSig = input('')
  originalRootSig = input('')
  switchRoot = output<string>()

  expanded = false

  isPatched = computed(() => {
    const active = this.activeRootSig()
    const original = this.originalRootSig()
    return active !== original
  })

  relativeTime(ts: number): string {
    const diff = Date.now() - ts
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    return `${days}d ago`
  }
}
