// diamond-core-processor/src/app/settings/auditor-settings.component.ts

import { Component, inject, signal } from '@angular/core'
import { AuditorService } from '../core/auditor.service'

@Component({
  selector: 'dcp-auditor-settings',
  standalone: true,
  template: `
    <div class="trust-panel" [class.open]="open()">
      <button class="toggle" (click)="open.set(!open())" title="Community Trust">
        @if (open()) { &times; } @else { &#9881; }
      </button>

      @if (open()) {
        <div class="panel">
          <header class="panel-header">
            <h3>Community Trust</h3>
            <span class="badge">{{ auditor.endpoints.length }} source{{ auditor.endpoints.length === 1 ? '' : 's' }}</span>
          </header>

          <p class="description">
            Add trusted auditor endpoints that vouch for code signatures.
            Content must meet the approval threshold before it is marked as trusted.
          </p>

          <div class="add-row">
            <div class="add-fields">
              <input
                type="text"
                class="field field-url"
                placeholder="https://auditor.example.com/approvals"
                [value]="urlInput()"
                (input)="urlInput.set($any($event.target).value)"
                (keydown.enter)="addAuditor()" />
              <input
                type="text"
                class="field field-name"
                placeholder="Label"
                [value]="nameInput()"
                (input)="nameInput.set($any($event.target).value)"
                (keydown.enter)="addAuditor()" />
            </div>
            <button class="btn-add" (click)="addAuditor()" [disabled]="!urlInput().trim()">Add</button>
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
              <span class="empty-text">No trusted sources configured</span>
            </div>
          }

          <footer class="panel-footer">
            <div class="threshold">
              <label>Approval threshold</label>
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
      border: 1px solid rgba(0, 0, 0, 0.08);
      border-radius: 6px;
      width: 30px;
      height: 30px;
      cursor: pointer;
      font-size: 15px;
      color: #777;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s ease;
    }

    .toggle:hover {
      background: rgba(0, 0, 0, 0.04);
      border-color: rgba(0, 0, 0, 0.14);
      color: #333;
    }

    .panel {
      position: absolute;
      top: 38px;
      right: 0;
      width: 420px;
      background: #fff;
      border: 1px solid rgba(0, 0, 0, 0.1);
      border-radius: 10px;
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.12), 0 0 0 1px rgba(0, 0, 0, 0.04);
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
      color: #1a1a1a;
      letter-spacing: 0.01em;
    }

    .badge {
      font-size: 10px;
      font-weight: 600;
      color: #666;
      background: rgba(0, 0, 0, 0.05);
      padding: 2px 8px;
      border-radius: 10px;
    }

    .description {
      margin: 8px 16px 14px;
      font-size: 11px;
      line-height: 1.5;
      color: #888;
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
      border: 1px solid rgba(0, 0, 0, 0.1);
      border-radius: 6px;
      outline: none;
      transition: border-color 0.15s;
      background: #fafafa;
      cursor: text;
    }

    .field:focus {
      border-color: rgba(74, 111, 165, 0.5);
      background: #fff;
    }


    .btn-add {
      padding: 7px 14px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      border: 1px solid rgba(0, 0, 0, 0.1);
      border-radius: 6px;
      background: #1a1a1a;
      color: #fff;
      white-space: nowrap;
      transition: all 0.15s;
    }

    .btn-add:hover:not(:disabled) {
      background: #333;
    }

    .btn-add:disabled {
      opacity: 0.35;
      cursor: default;
    }

    .sources {
      list-style: none;
      padding: 0;
      margin: 0;
      border-top: 1px solid rgba(0, 0, 0, 0.06);
    }

    .source-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 16px;
      border-bottom: 1px solid rgba(0, 0, 0, 0.04);
      transition: background 0.1s;
    }

    .source-item:hover {
      background: rgba(0, 0, 0, 0.015);
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
      color: #1a1a1a;
    }

    .source-url {
      font-size: 10px;
      color: #999;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .btn-remove {
      background: none;
      border: none;
      cursor: pointer;
      color: #ccc;
      font-size: 16px;
      padding: 0 4px;
      line-height: 1;
      flex-shrink: 0;
      transition: color 0.15s;
    }

    .btn-remove:hover {
      color: #c00;
    }

    .empty-state {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 20px 16px;
      border-top: 1px solid rgba(0, 0, 0, 0.06);
    }

    .empty-icon {
      font-size: 14px;
      color: #ccc;
    }

    .empty-text {
      font-size: 11px;
      color: #aaa;
    }

    .panel-footer {
      padding: 12px 16px;
      border-top: 1px solid rgba(0, 0, 0, 0.06);
      background: #fafafa;
    }

    .threshold {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .threshold label {
      font-size: 11px;
      font-weight: 600;
      color: #555;
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
      border: 1px solid rgba(0, 0, 0, 0.1);
      border-radius: 5px;
      text-align: center;
      background: #fff;
      outline: none;
      cursor: text;
    }

    .threshold-input:focus {
      border-color: rgba(74, 111, 165, 0.5);
    }

    .threshold-label {
      font-size: 11px;
      color: #888;
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
