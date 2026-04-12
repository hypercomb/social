// diamond-core-processor/src/app/relay/relay-panel.component.ts

import { Component, signal, OnDestroy } from '@angular/core'
import { DcpTranslatePipe } from '../core/dcp-translate.pipe'

const RELAY_KEY = 'dcp.relay'
const DEFAULT_RELAY = 'http://localhost:7777'
const POLL_INTERVAL = 10_000

interface RelayInfo {
  name: string
  description: string
  supported_nips: number[]
  version: string
  limitation?: { auth_required?: boolean; max_subscriptions?: number }
}

@Component({
  selector: 'dcp-relay-panel',
  standalone: true,
  imports: [DcpTranslatePipe],
  template: `
    <div class="relay-panel" [class.open]="open()">
      <button class="toggle" [class.connected]="status() === 'connected'" (click)="open.set(!open())" title="Nostr Relay">
        @if (open()) { &times; } @else { &#9889; }
      </button>

      @if (open()) {
        <div class="panel">
          <header class="panel-header">
            <h3>{{ 'dcp.relay-title' | t }}</h3>
            <span class="badge" [class.badge-ok]="status() === 'connected'" [class.badge-off]="status() !== 'connected'">
              {{ status() === 'connected' ? ('dcp.relay-connected' | t) : status() === 'checking' ? ('dcp.relay-checking' | t) : ('dcp.relay-offline' | t) }}
            </span>
          </header>

          <p class="description">
            {{ 'dcp.relay-description' | t }}
          </p>

          <div class="url-row">
            <input
              type="text"
              class="field"
              [placeholder]="'dcp.relay-placeholder' | t"
              [value]="relayUrl()"
              (input)="relayUrl.set($any($event.target).value)"
              (keydown.enter)="saveAndProbe()" />
            <button class="btn-probe" (click)="saveAndProbe()">{{ 'dcp.relay-check' | t }}</button>
          </div>

          @if (status() === 'connected' && info()) {
            <div class="info-block">
              <div class="info-row">
                <span class="info-label">{{ 'dcp.relay-name' | t }}</span>
                <span class="info-value">{{ info()!.name }}</span>
              </div>
              <div class="info-row">
                <span class="info-label">{{ 'dcp.relay-version' | t }}</span>
                <span class="info-value">{{ info()!.version }}</span>
              </div>
              <div class="info-row">
                <span class="info-label">{{ 'dcp.relay-nips' | t }}</span>
                <span class="info-value">{{ info()!.supported_nips.join(', ') }}</span>
              </div>
              @if (info()!.limitation?.auth_required) {
                <div class="info-row">
                  <span class="info-label">{{ 'dcp.relay-auth' | t }}</span>
                  <span class="info-value">required</span>
                </div>
              }
            </div>
          }

          @if (status() === 'offline') {
            <div class="install-block">
              <div class="install-header">{{ 'dcp.relay-install-locally' | t }}</div>
              <p class="install-desc">
                {{ 'dcp.relay-install-description' | t }}
              </p>
              <div class="install-actions">
                <button class="btn-install" (click)="downloadInstaller()">{{ 'dcp.relay-download' | t }}</button>
                <button class="btn-copy" (click)="copyCommand()" [title]="copied() ? 'Copied!' : 'Copy npx command'">
                  {{ copied() ? ('dcp.relay-copied' | t) : ('dcp.relay-copy-command' | t) }}
                </button>
              </div>
            </div>
          }

          <footer class="panel-footer">
            <span class="footer-hint">{{ 'dcp.relay-polled' | t }}</span>
          </footer>
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }

    .relay-panel { position: relative; }

    .toggle {
      background: none;
      border: 1px solid rgba(0, 0, 0, 0.08);
      border-radius: 2px;
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

    .toggle.connected {
      color: #2a7d3f;
      border-color: rgba(42, 125, 63, 0.25);
    }

    .panel {
      position: absolute;
      top: 38px;
      right: 0;
      width: 380px;
      background: #fff;
      border: 1px solid rgba(0, 0, 0, 0.1);
      border-radius: 2px;
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
      padding: 2px 8px;
      border-radius: 2px;
    }

    .badge-ok {
      color: #2a7d3f;
      background: rgba(42, 125, 63, 0.08);
    }

    .badge-off {
      color: #888;
      background: rgba(0, 0, 0, 0.05);
    }

    .description {
      margin: 8px 16px 14px;
      font-size: 11px;
      line-height: 1.5;
      color: #888;
    }

    .url-row {
      display: flex;
      gap: 8px;
      padding: 0 16px 14px;
    }

    .field {
      flex: 1;
      padding: 7px 10px;
      font-size: 12px;
      border: 1px solid rgba(0, 0, 0, 0.1);
      border-radius: 2px;
      outline: none;
      transition: border-color 0.15s;
      background: #fafafa;
      font-family: var(--hc-mono);
      cursor: text;
    }

    .field:focus {
      border-color: rgba(74, 111, 165, 0.5);
      background: #fff;
    }

    .btn-probe {
      padding: 7px 14px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      border: 1px solid rgba(0, 0, 0, 0.1);
      border-radius: 2px;
      background: #1a1a1a;
      color: #fff;
      white-space: nowrap;
      transition: all 0.15s;
    }

    .btn-probe:hover { background: #333; }

    /* relay info */
    .info-block {
      border-top: 1px solid rgba(0, 0, 0, 0.06);
      padding: 10px 16px;
    }

    .info-row {
      display: flex;
      justify-content: space-between;
      padding: 3px 0;
    }

    .info-label {
      font-size: 11px;
      font-weight: 600;
      color: #555;
    }

    .info-value {
      font-size: 11px;
      color: #888;
      font-family: var(--hc-mono);
    }

    /* install section */
    .install-block {
      border-top: 1px solid rgba(0, 0, 0, 0.06);
      padding: 14px 16px;
    }

    .install-header {
      font-size: 12px;
      font-weight: 700;
      color: #1a1a1a;
      margin-bottom: 6px;
    }

    .install-desc {
      font-size: 11px;
      color: #888;
      line-height: 1.5;
      margin: 0 0 12px;
    }

    .install-actions {
      display: flex;
      gap: 8px;
    }

    .btn-install {
      flex: 1;
      padding: 8px 14px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      border: 1px solid rgba(0, 0, 0, 0.1);
      border-radius: 2px;
      background: #1a1a1a;
      color: #fff;
      transition: all 0.15s;
    }

    .btn-install:hover { background: #333; }

    .btn-copy {
      padding: 8px 14px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      border: 1px solid rgba(0, 0, 0, 0.1);
      border-radius: 2px;
      background: #f8f8f8;
      color: #555;
      white-space: nowrap;
      transition: all 0.15s;
    }

    .btn-copy:hover { background: #eee; }

    .panel-footer {
      padding: 10px 16px;
      border-top: 1px solid rgba(0, 0, 0, 0.06);
      background: #fafafa;
    }

    .footer-hint {
      font-size: 10px;
      color: #aaa;
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

      .panel-header { padding: 16px; }

      .panel-header h3 { font-size: 16px; }

      .badge { font-size: 12px; padding: 3px 10px; }

      .description { font-size: 13px; margin: 10px 16px 16px; }

      .url-row {
        flex-direction: column;
        padding: 0 16px 16px;
        gap: 10px;
      }

      .field {
        font-size: 16px;
        padding: 10px 12px;
        min-height: 44px;
        box-sizing: border-box;
      }

      .btn-probe {
        font-size: 14px;
        padding: 12px 16px;
        min-height: 44px;
      }

      .install-actions { flex-direction: column; }

      .btn-install, .btn-copy {
        font-size: 14px;
        padding: 12px 16px;
        min-height: 44px;
      }

      .footer-hint { font-size: 12px; }
    }
  `]
})
export class RelayPanelComponent implements OnDestroy {
  open = signal(false)
  relayUrl = signal(this.#loadUrl())
  status = signal<'offline' | 'checking' | 'connected'>('checking')
  info = signal<RelayInfo | null>(null)
  copied = signal(false)

  #timer: ReturnType<typeof setInterval> | null = null

  constructor() {
    this.probe()
    this.#timer = setInterval(() => this.probe(), POLL_INTERVAL)
  }

  ngOnDestroy(): void {
    if (this.#timer) clearInterval(this.#timer)
  }

  saveAndProbe(): void {
    const url = this.relayUrl().trim()
    if (url) localStorage.setItem(RELAY_KEY, url)
    this.probe()
  }

  async probe(): Promise<void> {
    const base = this.relayUrl().trim() || DEFAULT_RELAY
    this.status.set('checking')
    try {
      const res = await fetch(base, {
        headers: { Accept: 'application/nostr+json' },
        signal: AbortSignal.timeout(3000)
      })
      if (!res.ok) { this.status.set('offline'); this.info.set(null); return }
      const data: RelayInfo = await res.json()
      this.info.set(data)
      this.status.set('connected')
    } catch {
      this.status.set('offline')
      this.info.set(null)
    }
  }

  downloadInstaller(): void {
    const isWindows = navigator.userAgent.includes('Windows')
    const { name, content } = isWindows ? this.#batScript() : this.#shScript()
    const blob = new Blob([content], { type: 'text/plain' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = name
    a.click()
    URL.revokeObjectURL(a.href)
  }

  async copyCommand(): Promise<void> {
    await navigator.clipboard.writeText('npx @hypercomb/relay')
    this.copied.set(true)
    setTimeout(() => this.copied.set(false), 2000)
  }

  #loadUrl(): string {
    return localStorage.getItem(RELAY_KEY) ?? DEFAULT_RELAY
  }

  #batScript(): { name: string; content: string } {
    return {
      name: 'start-relay.bat',
      content: [
        '@echo off',
        'title Hypercomb Relay',
        'echo.',
        'echo   Hypercomb Relay Installer',
        'echo   -------------------------',
        'echo.',
        '',
        'where node >nul 2>nul',
        'if errorlevel 1 (',
        '  echo   Node.js is not installed.',
        '  echo   Download it from https://nodejs.org',
        '  echo.',
        '  pause',
        '  exit /b 1',
        ')',
        '',
        'for /f "tokens=1 delims=." %%v in (\'node -v\') do set NODE_MAJOR=%%v',
        'set NODE_MAJOR=%NODE_MAJOR:v=%',
        'if %NODE_MAJOR% LSS 20 (',
        '  echo   Node.js 20+ required. Found: && node -v',
        '  echo   Download from https://nodejs.org',
        '  echo.',
        '  pause',
        '  exit /b 1',
        ')',
        '',
        'echo   Node.js found:',
        'node -v',
        'echo.',
        '',
        'set RELAY_DIR=%~dp0hypercomb-relay',
        '',
        'if not exist "%RELAY_DIR%\\package.json" (',
        '  echo   Downloading relay package...',
        '  mkdir "%RELAY_DIR%" 2>nul',
        '  cd /d "%RELAY_DIR%"',
        '  npm init -y >nul 2>nul',
        '  npm install @hypercomb/relay >nul 2>nul',
        '  if errorlevel 1 (',
        '    echo   npm install failed. Check your network connection.',
        '    pause',
        '    exit /b 1',
        '  )',
        ') else (',
        '  cd /d "%RELAY_DIR%"',
        ')',
        '',
        'echo   Starting relay on ws://0.0.0.0:7777',
        'echo   Press Ctrl+C to stop.',
        'echo.',
        'npx hypercomb-relay',
        'pause',
        ''
      ].join('\r\n')
    }
  }

  #shScript(): { name: string; content: string } {
    return {
      name: 'start-relay.sh',
      content: [
        '#!/usr/bin/env bash',
        'set -e',
        '',
        'echo ""',
        'echo "  Hypercomb Relay Installer"',
        'echo "  -------------------------"',
        'echo ""',
        '',
        'if ! command -v node &>/dev/null; then',
        '  echo "  Node.js is not installed."',
        '  echo "  Install via: https://nodejs.org or your package manager"',
        '  exit 1',
        'fi',
        '',
        'NODE_MAJOR=$(node -v | cut -d. -f1 | tr -d v)',
        'if [ "$NODE_MAJOR" -lt 20 ]; then',
        '  echo "  Node.js 20+ required. Found: $(node -v)"',
        '  exit 1',
        'fi',
        '',
        'echo "  Node.js found: $(node -v)"',
        'echo ""',
        '',
        'RELAY_DIR="$(dirname "$0")/hypercomb-relay"',
        '',
        'if [ ! -f "$RELAY_DIR/package.json" ]; then',
        '  echo "  Downloading relay package..."',
        '  mkdir -p "$RELAY_DIR"',
        '  cd "$RELAY_DIR"',
        '  npm init -y >/dev/null 2>&1',
        '  npm install @hypercomb/relay >/dev/null 2>&1',
        'else',
        '  cd "$RELAY_DIR"',
        'fi',
        '',
        'echo "  Starting relay on ws://0.0.0.0:7777"',
        'echo "  Press Ctrl+C to stop."',
        'echo ""',
        'npx hypercomb-relay',
        ''
      ].join('\n')
    }
  }
}
