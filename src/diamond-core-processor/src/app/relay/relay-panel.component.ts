// diamond-core-processor/src/app/relay/relay-panel.component.ts

import { Component, signal, OnDestroy } from '@angular/core'
import { DcpTranslatePipe } from '../core/dcp-translate.pipe'
import { defaultHostOrigin } from '../core/default-host'

const RELAY_KEY = 'dcp.relay'
// Local dev fallback. On a real host (jwize.com etc.) the default is the
// page's own origin — see defaultHostOrigin() and #defaultRelay() below.
const LOCALHOST_RELAY = 'http://localhost:7777'
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
        @if (open()) { &times; } @else {
          <svg class="toggle-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
        }
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

    .toggle.connected {
      color: var(--dcp-z-logical-rail);
      border-color: var(--dcp-z-logical-rail);
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
      width: 380px;
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
      padding: 2px 8px;
      border-radius: var(--dcp-radius-sm);
    }

    .badge-ok {
      color: var(--dcp-z-logical-ink);
      background: var(--dcp-z-logical-tint);
    }

    .badge-off {
      color: var(--dcp-ink-3);
      background: var(--dcp-surface-2);
    }

    .description {
      margin: 8px 16px 14px;
      font-size: 11px;
      line-height: 1.5;
      color: var(--dcp-ink-2);
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
      color: var(--dcp-ink);
      border: 1px solid var(--dcp-line-2);
      border-radius: var(--dcp-radius-sm);
      outline: none;
      transition: border-color 0.15s, box-shadow 0.15s;
      background: var(--dcp-surface-2);
      font-family: var(--hc-mono);
      cursor: text;
    }

    .field:focus {
      border-color: var(--dcp-accent);
      background: var(--dcp-surface);
      box-shadow: 0 0 0 3px var(--dcp-accent-tint);
    }

    .btn-probe {
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

    .btn-probe:hover { filter: brightness(1.06); }

    /* relay info */
    .info-block {
      border-top: 1px solid var(--dcp-line);
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
      color: var(--dcp-ink-2);
    }

    .info-value {
      font-size: 11px;
      color: var(--dcp-ink-3);
      font-family: var(--hc-mono);
    }

    /* install section */
    .install-block {
      border-top: 1px solid var(--dcp-line);
      padding: 14px 16px;
    }

    .install-header {
      font-size: 12px;
      font-weight: 700;
      color: var(--dcp-ink);
      margin-bottom: 6px;
    }

    .install-desc {
      font-size: 11px;
      color: var(--dcp-ink-2);
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
      border: 1px solid var(--dcp-accent-strong);
      border-radius: var(--dcp-radius-sm);
      background: var(--dcp-accent);
      color: var(--dcp-on-accent);
      transition: filter 0.12s ease;
    }

    .btn-install:hover { filter: brightness(1.06); }

    .btn-copy {
      padding: 8px 14px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      border: 1px solid var(--dcp-line-2);
      border-radius: var(--dcp-radius-sm);
      background: var(--dcp-surface-2);
      color: var(--dcp-ink-2);
      white-space: nowrap;
      transition: color 0.12s ease, border-color 0.12s ease;
    }

    .btn-copy:hover { color: var(--dcp-ink); border-color: var(--dcp-ink-3); }

    .panel-footer {
      padding: 10px 16px;
      border-top: 1px solid var(--dcp-line);
      background: var(--dcp-surface-2);
    }

    .footer-hint {
      font-size: 10px;
      color: var(--dcp-ink-3);
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
    const base = this.relayUrl().trim() || this.#defaultRelay()
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
    return localStorage.getItem(RELAY_KEY) ?? this.#defaultRelay()
  }

  /** Canonical default — page's origin on a real host, localhost on dev. */
  #defaultRelay(): string {
    return defaultHostOrigin(LOCALHOST_RELAY)
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
