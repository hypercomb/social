// diamond-core-processor/src/app/revision-list/revision-list.component.ts
//
// The deploy-revision switcher for a package. Each named deploy version is a
// switchable row; clicking one makes it the active root for the package
// (persisted to active.json, applied on load by the auto-hotswap). Mirrors
// the patch-list visually, but lists DEPLOY versions, not local AI patches —
// the two switchers sit side by side under a package.

import { Component, input, output } from '@angular/core'
import { DcpTranslatePipe } from '../core/dcp-translate.pipe'

export interface RevisionRow {
  rootSig: string
  /** The display handle (local rename → deploy label → short sig). */
  label: string
  /** Deploy timestamp (ISO) for chronological context. */
  deployedAt?: string
}

@Component({
  selector: 'dcp-revision-list',
  standalone: true,
  imports: [DcpTranslatePipe],
  template: `
    @if (revisions().length > 1) {
      <div class="revision-list">
        <button class="toggle" (click)="expanded = !expanded">
          {{ 'dcp.revisions' | t }} ({{ revisions().length }})
          <span class="chevron" [class.open]="expanded">&#9654;</span>
        </button>

        @if (expanded) {
          <div class="items">
            @for (rev of revisions(); track rev.rootSig) {
              <button
                class="revision-item"
                [class.active]="activeRootSig() === rev.rootSig"
                [title]="rev.rootSig"
                (click)="switchRevision.emit(rev.rootSig)">
                <span class="revision-label">{{ rev.label }}</span>
                @if (rev.deployedAt) {
                  <span class="revision-time">{{ deployed(rev.deployedAt) }}</span>
                }
                @if (activeRootSig() === rev.rootSig) {
                  <span class="revision-flag">{{ 'dcp.revision-active' | t }}</span>
                }
              </button>
            }
          </div>
        }
      </div>
    }
  `,
  styles: [`
    .revision-list { margin: 4px 0 8px; }

    .toggle {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--dcp-ink-3);
      background: none;
      border: none;
      cursor: pointer;
      padding: 4px 0;
    }
    .toggle:hover { color: var(--dcp-ink-2); }

    .chevron { font-size: 8px; transition: transform 0.15s; }
    .chevron.open { transform: rotate(90deg); }

    .items {
      display: flex;
      flex-direction: column;
      gap: 2px;
      margin-top: 4px;
      padding-left: 8px;
    }

    .revision-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 8px;
      font-size: 11px;
      background: none;
      border: 1px solid transparent;
      border-radius: var(--dcp-radius-sm);
      cursor: pointer;
      text-align: left;
    }
    .revision-item:hover { background: var(--dcp-hover, rgba(126,182,214,0.08)); }
    .revision-item.active {
      background: var(--dcp-accent-tint);
      border-color: var(--dcp-accent);
    }

    .revision-label {
      color: var(--dcp-ink);
      font-weight: 500;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1;
    }

    .revision-time {
      font-family: var(--hc-mono);
      font-size: 9px;
      color: var(--dcp-ink-3);
      flex-shrink: 0;
    }

    .revision-flag {
      font-size: 8px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--dcp-accent);
      flex-shrink: 0;
    }
  `]
})
export class RevisionListComponent {
  revisions = input<RevisionRow[]>([])
  /** The currently-active root sig, marked in the list. */
  activeRootSig = input('')
  /** Emits the chosen revision's root sig. */
  switchRevision = output<string>()

  expanded = false

  /** ISO deploy timestamp → "YYYY-MM-DD HH:mm". */
  deployed(at: string): string {
    return at.replace('T', ' ').slice(0, 16)
  }
}
