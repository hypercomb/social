// src/app/settings/auditor-settings.component.ts
import { Component, inject, signal } from '@angular/core'
import { AuditorService } from '../core/auditor.service'

@Component({
  selector: 'dcp-auditor-settings',
  standalone: true,
  template: `
    <div class="settings-panel" [class.open]="open()">
      <button class="settings-toggle" (click)="open.set(!open())">
        @if (open()) { &times; } @else { &#9881; }
      </button>

      @if (open()) {
        <div class="settings-body">
          <h3>Auditor Endpoints</h3>

          <div class="input-row">
            <input
              type="text"
              placeholder="Auditor URL"
              [value]="urlInput()"
              (input)="urlInput.set($any($event.target).value)"
              (keydown.enter)="addAuditor()" />
            <input
              type="text"
              placeholder="Name"
              [value]="nameInput()"
              (input)="nameInput.set($any($event.target).value)"
              (keydown.enter)="addAuditor()" />
            <button (click)="addAuditor()">Add</button>
          </div>

          @if (auditor.endpoints.length) {
            <ul class="endpoint-list">
              @for (ep of auditor.endpoints; track ep.url) {
                <li>
                  <span class="ep-name">{{ ep.name }}</span>
                  <span class="ep-url">{{ ep.url }}</span>
                  <button class="remove" (click)="auditor.removeEndpoint(ep.url)">&times;</button>
                </li>
              }
            </ul>
          } @else {
            <p class="empty">No auditor endpoints configured.</p>
          }

          <div class="threshold-row">
            <label>Threshold: require at least</label>
            <input
              type="number"
              min="0"
              [value]="auditor.threshold"
              (change)="auditor.setThreshold(+$any($event.target).value)" />
            <span>of {{ auditor.endpoints.length }} auditors</span>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }

    .settings-panel {
      position: relative;
    }

    .settings-toggle {
      background: none;
      border: 1px solid rgba(0,0,0,0.1);
      border-radius: 6px;
      width: 32px;
      height: 32px;
      cursor: pointer;
      font-size: 16px;
      color: #666;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .settings-toggle:hover {
      background: rgba(0,0,0,0.04);
    }

    .settings-body {
      position: absolute;
      top: 40px;
      right: 0;
      width: 400px;
      background: #fff;
      border: 1px solid rgba(0,0,0,0.12);
      border-radius: 10px;
      padding: 16px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.12);
      z-index: 100;
    }

    h3 {
      margin: 0 0 12px;
      font-size: 14px;
      font-weight: 700;
      color: #333;
    }

    .input-row {
      display: flex;
      gap: 6px;
      margin-bottom: 12px;
    }

    .input-row input {
      flex: 1;
      padding: 6px 8px;
      font-size: 13px;
      border: 1px solid rgba(0,0,0,0.15);
      border-radius: 6px;
    }

    .input-row button {
      padding: 6px 12px;
      font-size: 13px;
      cursor: pointer;
      border: 1px solid rgba(0,0,0,0.15);
      border-radius: 6px;
      background: #f5f5f5;
    }

    .endpoint-list {
      list-style: none;
      padding: 0;
      margin: 0 0 12px;
    }

    .endpoint-list li {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 0;
      border-bottom: 1px solid rgba(0,0,0,0.06);
      font-size: 13px;
    }

    .ep-name {
      font-weight: 600;
      color: #333;
    }

    .ep-url {
      flex: 1;
      color: #888;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 11px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .remove {
      background: none;
      border: none;
      cursor: pointer;
      color: #999;
      font-size: 16px;
    }

    .remove:hover {
      color: #c00;
    }

    .empty {
      font-size: 13px;
      color: #999;
      margin: 8px 0;
    }

    .threshold-row {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      color: #555;
    }

    .threshold-row input {
      width: 48px;
      padding: 4px 6px;
      font-size: 13px;
      border: 1px solid rgba(0,0,0,0.15);
      border-radius: 6px;
      text-align: center;
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
