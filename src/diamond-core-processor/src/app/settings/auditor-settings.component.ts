// diamond-core-processor/src/app/settings/auditor-settings.component.ts

import { Component, inject, signal } from '@angular/core'
import { AuditorService } from '../core/auditor.service'
import { DcpTranslatePipe } from '../core/dcp-translate.pipe'

@Component({
  selector: 'dcp-auditor-settings',
  standalone: true,
  imports: [DcpTranslatePipe],
  template: `
    <div class="trust-panel" [class.open]="open()">
      <button class="toggle" (click)="open.set(!open())" title="Community Trust">
        @if (open()) { &times; } @else {
          <svg class="toggle-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>
        }
      </button>

      @if (open()) {
        <div class="panel">
          <header class="panel-header">
            <h3>{{ 'dcp.trust-title' | t }}</h3>
            <span class="badge">{{ auditor.endpoints.length }} {{ 'dcp.trust-sources' | t }}</span>
          </header>

          <p class="description">
            {{ 'dcp.trust-description' | t }}
          </p>

          <div class="add-row">
            <div class="add-fields">
              <input
                type="text"
                class="field field-url"
                [placeholder]="'dcp.trust-url-placeholder' | t"
                [value]="urlInput()"
                (input)="urlInput.set($any($event.target).value)"
                (keydown.enter)="addAuditor()" />
              <input
                type="text"
                class="field field-name"
                [placeholder]="'dcp.trust-label-placeholder' | t"
                [value]="nameInput()"
                (input)="nameInput.set($any($event.target).value)"
                (keydown.enter)="addAuditor()" />
            </div>
            <button class="btn-add" (click)="addAuditor()" [disabled]="!urlInput().trim()">{{ 'dcp.trust-add' | t }}</button>
          </div>

          @if (auditor.endpoints.length) {
            <ul class="sources">
              @for (ep of auditor.endpoints; track ep.url) {
                <li class="source-item">
                  <div class="source-info">
                    <span class="source-name">{{ ep.name }}</span>
                    <span class="source-url">{{ ep.url }}</span>
                  </div>
                  <button class="btn-remove" (click)="auditor.removeEndpoint(ep.url)" title="Remove">&times;</button>
                </li>
              }
            </ul>
          } @else {
            <div class="empty-state">
              <span class="empty-icon">&#9737;</span>
              <span class="empty-text">{{ 'dcp.trust-empty' | t }}</span>
            </div>
          }

          <footer class="panel-footer">
            <div class="threshold">
              <label>{{ 'dcp.trust-threshold' | t }}</label>
              <div class="threshold-control">
                <input
                  type="number"
                  min="0"
                  [max]="auditor.endpoints.length"
                  class="threshold-input"
                  [value]="auditor.threshold"
                  (change)="auditor.setThreshold(+$any($event.target).value)" />
                <span class="threshold-label">of {{ auditor.endpoints.length }}</span>
              </div>
            </div>
          </footer>
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }

    .trust-panel { position: relative; }

    .toggle {
      background: none;
      border: 1px solid var(--dcp-line);
      border-radius: var(--dcp-radius-sm);
      width: 30px;
      height: 30px;
      cursor: pointer;
      font-size: 15px;
      color: var(--dcp-ink-3);
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s ease;
    }

    .toggle:hover {
      background: var(--dcp-hover);
      border-color: var(--dcp-line-2);
      color: var(--dcp-ink);
    }

    .toggle-icon {
      width: 15px;
      height: 15px;
      display: block;
    }

    .panel {
      position: absolute;
      top: 38px;
      right: 0;
      width: 420px;
      background: var(--dcp-surface);
      border: 1px solid var(--dcp-line-2);
      border-radius: var(--dcp-radius-md);
      box-shadow: var(--dcp-shadow-2);
      z-index: 100;
      overflow: hidden;
      animation: panelIn 0.15s ease;
    }

    @keyframes panelIn {
      from { opacity: 0; transform: translateY(-4px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 16px 0;
    }

    .panel-header h3 {
      margin: 0;
      font-size: 13px;
      font-weight: 700;
      color: var(--dcp-ink);
      letter-spacing: 0.01em;
    }

    .badge {
      font-size: 10px;
      font-weight: 600;
      color: var(--dcp-ink-3);
      background: var(--dcp-surface-2);
      padding: 2px 8px;
      border-radius: var(--dcp-radius-sm);
    }

    .description {
      margin: 8px 16px 14px;
      font-size: 11px;
      line-height: 1.5;
      color: var(--dcp-ink-2);
    }

    .add-row {
      display: flex;
      align-items: flex-end;
      gap: 8px;
      padding: 0 16px 14px;
    }

    .add-fields {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .field {
      padding: 7px 10px;
      font-size: 12px;
      color: var(--dcp-ink);
      border: 1px solid var(--dcp-line-2);
      border-radius: var(--dcp-radius-sm);
      outline: none;
      transition: border-color 0.15s, box-shadow 0.15s;
      background: var(--dcp-surface-2);
      cursor: text;
    }

    .field:focus {
      border-color: var(--dcp-accent);
      background: var(--dcp-surface);
      box-shadow: 0 0 0 3px var(--dcp-accent-tint);
    }


    .btn-add {
      padding: 7px 14px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      border: 1px solid var(--dcp-accent-strong);
      border-radius: var(--dcp-radius-sm);
      background: var(--dcp-accent);
      color: var(--dcp-on-accent);
      white-space: nowrap;
      transition: filter 0.12s ease;
    }

    .btn-add:hover:not(:disabled) {
      filter: brightness(1.06);
    }

    .btn-add:disabled {
      opacity: 0.35;
      cursor: default;
    }

    .sources {
      list-style: none;
      padding: 0;
      margin: 0;
      border-top: 1px solid var(--dcp-line);
    }

    .source-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 16px;
      border-bottom: 1px solid var(--dcp-line);
      transition: background 0.1s;
    }

    .source-item:hover {
      background: var(--dcp-hover);
    }

    .source-info {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .source-name {
      font-size: 12px;
      font-weight: 600;
      color: var(--dcp-ink);
    }

    .source-url {
      font-size: 10px;
      color: var(--dcp-ink-3);
      font-family: var(--hc-mono);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .btn-remove {
      background: none;
      border: none;
      cursor: pointer;
      color: var(--dcp-ink-3);
      font-size: 16px;
      padding: 0 4px;
      line-height: 1;
      flex-shrink: 0;
      transition: color 0.15s;
    }

    .btn-remove:hover {
      color: var(--dcp-danger);
    }

    .empty-state {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 20px 16px;
      border-top: 1px solid var(--dcp-line);
    }

    .empty-icon {
      font-size: 14px;
      color: var(--dcp-ink-3);
    }

    .empty-text {
      font-size: 11px;
      color: var(--dcp-ink-3);
    }

    .panel-footer {
      padding: 12px 16px;
      border-top: 1px solid var(--dcp-line);
      background: var(--dcp-surface-2);
    }

    .threshold {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .threshold label {
      font-size: 11px;
      font-weight: 600;
      color: var(--dcp-ink-2);
    }

    .threshold-control {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .threshold-input {
      width: 40px;
      padding: 4px 6px;
      font-size: 12px;
      color: var(--dcp-ink);
      border: 1px solid var(--dcp-line-2);
      border-radius: var(--dcp-radius-sm);
      text-align: center;
      background: var(--dcp-surface);
      outline: none;
      cursor: text;
    }

    .threshold-input:focus {
      border-color: var(--dcp-accent);
      box-shadow: 0 0 0 3px var(--dcp-accent-tint);
    }

    .threshold-label {
      font-size: 11px;
      color: var(--dcp-ink-2);
    }

    @media (max-width: 600px) {
      .toggle {
        width: 36px;
        height: 36px;
        font-size: 17px;
      }

      .panel {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        width: 100%;
        border-radius: 0;
        z-index: 1000;
        overflow-y: auto;
        animation: none;
      }

      .panel-header {
        padding: 16px;
      }

      .panel-header h3 {
        font-size: 16px;
      }

      .badge {
        font-size: 12px;
        padding: 3px 10px;
      }

      .description {
        font-size: 13px;
        margin: 10px 16px 16px;
      }

      .add-row {
        flex-direction: column;
        padding: 0 16px 16px;
        gap: 10px;
      }

      .add-fields {
        gap: 8px;
      }

      .field {
        font-size: 16px;
        padding: 10px 12px;
        min-height: 44px;
        box-sizing: border-box;
      }

      .field-name {
        width: 100%;
      }

      .btn-add {
        font-size: 14px;
        padding: 12px 16px;
        min-height: 44px;
        width: 100%;
      }

      .source-item {
        padding: 12px 16px;
        min-height: 48px;
      }

      .source-name {
        font-size: 14px;
      }

      .source-url {
        font-size: 12px;
      }

      .btn-remove {
        min-width: 44px;
        min-height: 44px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 20px;
      }

      .empty-icon {
        font-size: 18px;
      }

      .empty-text {
        font-size: 13px;
      }

      .panel-footer {
        padding: 14px 16px;
      }

      .threshold label {
        font-size: 13px;
      }

      .threshold-input {
        font-size: 16px;
        width: 50px;
        padding: 6px 8px;
        min-height: 36px;
      }

      .threshold-label {
        font-size: 13px;
      }
    }
  `]
})
export class AuditorSettingsComponent {
  auditor = inject(AuditorService)
  open = signal(false)
  urlInput = signal('')
  nameInput = signal('')

  addAuditor(): void {
    const url = this.urlInput().trim()
    const name = this.nameInput().trim()
    if (!url) return
    this.auditor.addEndpoint(url, name)
    this.urlInput.set('')
    this.nameInput.set('')
  }
}
