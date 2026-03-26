// diamond-core-processor/src/app/tree-view/bee-inspector.component.ts

import { Component, computed, effect, inject, input, output, signal } from '@angular/core'
import { SignatureService } from '@hypercomb/core'
import { CodeViewerComponent } from '../code-viewer/code-viewer.component'
import { DcpStore } from '../core/dcp-store'
import type { BeeDocEntry } from '../core/tree-node'

@Component({
  selector: 'dcp-bee-inspector',
  standalone: true,
  imports: [CodeViewerComponent],
  template: `
    @if (visible()) {
      <div class="backdrop" (click)="close.emit()"></div>
      <div class="modal">
        <header class="modal-header">
          <div class="header-top">
            <div class="header-left">
              <span class="kind-badge" [class.dep]="kind() === 'dependency'" [class.worker]="kind() === 'worker'" [class.drone]="kind() === 'drone'" [class.queen]="doc()?.kind === 'queen'">{{ doc()?.kind ?? kind() }}</span>
              <span class="display-name">{{ displayName() }}</span>
              <span class="meta-pill">{{ fileSize() }}</span>
              <span class="meta-pill">{{ loadedFrom() }}</span>
            </div>
            <button class="close-btn" (click)="close.emit()">&times;</button>
          </div>
          <div class="sig-row">
            <code class="sig-value">{{ signature() }}</code>
            <button class="sig-copy" (click)="copySig()">{{ sigCopied() ? 'copied' : 'copy' }}</button>
          </div>
        </header>

        <!-- doc panel — shown always on detail mode, shown as collapsible on code mode -->
        @if (doc(); as d) {
          <div class="doc-panel" [class.detail-mode]="activeView() === 'detail'">
            @if (d.description) {
              <p class="doc-description">{{ d.description }}</p>
            }

            @if (lineage()) {
              <div class="doc-section">
                <span class="doc-label">location</span>
                <span class="doc-lineage">{{ lineage() }}</span>
              </div>
            }

            @if (d.command) {
              <div class="doc-section">
                <span class="doc-label">command</span>
                <code class="doc-command">/{{ d.command }}</code>
                @for (alias of d.aliases; track alias) {
                  <code class="doc-alias">/{{ alias }}</code>
                }
              </div>
            }

            @if (d.listens.length) {
              <div class="doc-section">
                <span class="doc-label">listens</span>
                <div class="doc-pills">
                  @for (e of d.listens; track e) {
                    <span class="doc-pill listen">{{ e }}</span>
                  }
                </div>
              </div>
            }

            @if (d.emits.length) {
              <div class="doc-section">
                <span class="doc-label">emits</span>
                <div class="doc-pills">
                  @for (e of d.emits; track e) {
                    <span class="doc-pill emit">{{ e }}</span>
                  }
                </div>
              </div>
            }

            @if (depEntries().length) {
              <div class="doc-section">
                <span class="doc-label">depends on</span>
                <div class="doc-deps">
                  @for (dep of depEntries(); track dep.key) {
                    <div class="doc-dep">
                      <span class="dep-name">{{ dep.name }}</span>
                      <code class="dep-key">{{ dep.key }}</code>
                    </div>
                  }
                </div>
              </div>
            }

            @if (d.effects.length) {
              <div class="doc-section">
                <span class="doc-label">effects</span>
                <div class="doc-pills">
                  @for (e of d.effects; track e) {
                    <span class="doc-pill effect">{{ e }}</span>
                  }
                </div>
              </div>
            }

            @if (d.links.length) {
              <div class="doc-section">
                <span class="doc-label">links</span>
                <div class="doc-links">
                  @for (link of d.links; track link.url) {
                    <a class="doc-link" [href]="link.url" target="_blank" rel="noopener">{{ link.label }}</a>
                  }
                </div>
              </div>
            }

            <!-- view source button in detail mode -->
            @if (activeView() === 'detail') {
              <button class="view-source-btn" (click)="activeView.set('code')">View Source</button>
            }
          </div>
        }

        @if (loading()) {
          <div class="modal-body center">
            <span class="loading-dot"></span>
            <span class="loading-text">Resolving {{ signature().slice(0, 12) }}...</span>
          </div>
        }

        @if (error()) {
          <div class="modal-body center">
            <span class="error-text">{{ error() }}</span>
          </div>
        }

        <!-- code viewer — shown when activeView is 'code' -->
        @if (source() && !loading() && activeView() === 'code') {
          <div class="modal-body">
            <hc-code-viewer [code]="source()" />
          </div>
        }
      </div>
    }
  `,
  styles: [`
    .backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      backdrop-filter: blur(6px);
      z-index: 1000;
      animation: fadeIn 0.15s ease;
    }

    .modal {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: min(780px, 92vw);
      max-height: 88vh;
      background: #fff;
      border-radius: 12px;
      box-shadow: 0 24px 80px rgba(0, 0, 0, 0.22), 0 0 0 1px rgba(0, 0, 0, 0.06);
      z-index: 1001;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      animation: slideUp 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    }

    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    @keyframes slideUp {
      from { opacity: 0; transform: translate(-50%, -48%); }
      to { opacity: 1; transform: translate(-50%, -50%); }
    }

    .modal-header {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 14px 18px 12px;
      border-bottom: 1px solid rgba(0, 0, 0, 0.06);
      background: #fafafa;
    }

    .header-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .header-left {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }

    .kind-badge {
      font-size: 9px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: #a58b4f;
      background: rgba(165, 139, 79, 0.1);
      padding: 2px 7px;
      border-radius: 3px;
      flex-shrink: 0;
    }

    .kind-badge.dep {
      color: #4fa58b;
      background: rgba(79, 165, 139, 0.1);
    }

    .kind-badge.worker {
      color: #a54f4f;
      background: rgba(165, 79, 79, 0.1);
    }

    .kind-badge.drone {
      color: #a59b4f;
      background: rgba(165, 155, 79, 0.1);
    }

    .kind-badge.queen {
      color: #7b4fa5;
      background: rgba(123, 79, 165, 0.1);
    }

    .display-name {
      font-size: 14px;
      font-weight: 600;
      color: #1a1a1a;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .meta-pill {
      font-size: 10px;
      color: #888;
      background: rgba(0, 0, 0, 0.04);
      padding: 1px 6px;
      border-radius: 3px;
      flex-shrink: 0;
      white-space: nowrap;
    }

    .close-btn {
      background: none;
      border: none;
      font-size: 18px;
      color: #aaa;
      cursor: pointer;
      padding: 0 2px;
      line-height: 1;
      flex-shrink: 0;
    }

    .close-btn:hover {
      color: #333;
    }

    .sig-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .sig-value {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 10px;
      color: #777;
      letter-spacing: 0.02em;
      word-break: break-all;
      line-height: 1.3;
      flex: 1;
    }

    .sig-copy {
      font-size: 10px;
      font-weight: 600;
      color: #666;
      background: rgba(0, 0, 0, 0.04);
      border: 1px solid rgba(0, 0, 0, 0.08);
      border-radius: 4px;
      padding: 2px 8px;
      cursor: pointer;
      flex-shrink: 0;
      white-space: nowrap;
    }

    .sig-copy:hover {
      background: rgba(0, 0, 0, 0.08);
    }

    /* --- doc panel --- */

    .doc-panel {
      padding: 12px 18px;
      border-bottom: 1px solid rgba(0, 0, 0, 0.06);
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .doc-description {
      font-size: 13px;
      color: #444;
      line-height: 1.5;
      margin: 0;
    }

    .doc-section {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 6px;
    }

    .doc-label {
      font-size: 9px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #999;
      width: 70px;
      flex-shrink: 0;
    }

    .doc-pills {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }

    .doc-pill {
      font-size: 10px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      padding: 1px 6px;
      border-radius: 3px;
      white-space: nowrap;
    }

    .doc-pill.listen {
      color: #2e7d32;
      background: rgba(46, 125, 50, 0.08);
    }

    .doc-pill.emit {
      color: #c62828;
      background: rgba(198, 40, 40, 0.08);
    }

    .doc-pill.effect {
      color: #1565c0;
      background: rgba(21, 101, 192, 0.08);
    }

    .doc-command {
      font-size: 12px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-weight: 600;
      color: #7b4fa5;
    }

    .doc-alias {
      font-size: 10px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      color: #999;
    }

    .doc-deps {
      display: flex;
      flex-direction: column;
      gap: 3px;
    }

    .doc-dep {
      display: flex;
      align-items: baseline;
      gap: 8px;
      background: none;
      border: 1px solid rgba(0, 0, 0, 0.06);
      border-radius: 4px;
      padding: 3px 8px;
      cursor: pointer;
      text-align: left;
    }

    .doc-dep:hover {
      background: rgba(0, 0, 0, 0.03);
      border-color: rgba(0, 0, 0, 0.12);
    }

    .dep-name {
      font-size: 11px;
      font-weight: 500;
      color: #333;
    }

    .dep-key {
      font-size: 9px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      color: #aaa;
    }

    .doc-links {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .doc-link {
      font-size: 11px;
      color: #1565c0;
      text-decoration: none;
    }

    .doc-link:hover {
      text-decoration: underline;
    }

    .doc-lineage {
      font-size: 12px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      color: #666;
    }

    .view-source-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 10px 16px;
      font-size: 12px;
      font-weight: 600;
      color: #4a6fa5;
      background: rgba(74, 111, 165, 0.06);
      border: 1px solid rgba(74, 111, 165, 0.15);
      border-radius: 6px;
      cursor: pointer;
      margin-top: 4px;
    }

    .view-source-btn:hover {
      background: rgba(74, 111, 165, 0.12);
    }

    /* --- body --- */

    .modal-body {
      flex: 1;
      overflow-y: auto;
      overflow-x: hidden;
      padding: 6px;
    }

    .modal-body.center {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      min-height: 120px;
      padding: 16px;
    }

    .loading-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #4a6fa5;
      animation: pulse 1s ease infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 0.3; }
      50% { opacity: 1; }
    }

    .loading-text {
      font-size: 11px;
      color: #888;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    }

    .error-text {
      font-size: 12px;
      color: #b00020;
    }

    @media (max-width: 600px) {
      .modal {
        width: 100vw;
        height: 100dvh;
        max-height: 100dvh;
        top: 0;
        left: 0;
        transform: none;
        border-radius: 0;
        animation: none;
      }

      .modal-header {
        padding: 20px 20px 16px;
        gap: 10px;
      }

      .header-left {
        flex-direction: column;
        align-items: flex-start;
        gap: 8px;
      }

      .kind-badge {
        font-size: 10px;
        padding: 4px 10px;
        border-radius: 4px;
      }

      .display-name {
        font-size: 20px;
        font-weight: 700;
        white-space: normal;
        word-break: break-word;
        line-height: 1.25;
        color: #111;
      }

      .meta-pill {
        font-size: 11px;
        padding: 3px 10px;
        border-radius: 6px;
      }

      .close-btn {
        font-size: 22px;
        min-width: 44px;
        min-height: 44px;
        display: flex;
        align-items: center;
        justify-content: center;
        position: absolute;
        top: 12px;
        right: 8px;
      }

      .header-top {
        position: relative;
      }

      .sig-row {
        background: rgba(0, 0, 0, 0.03);
        padding: 10px 12px;
        border-radius: 8px;
        gap: 10px;
      }

      .sig-value {
        font-size: 11px;
        color: #555;
      }

      .sig-copy {
        font-size: 11px;
        padding: 6px 14px;
        min-height: 32px;
        border-radius: 6px;
      }

      /* doc panel — card-style sections */
      .doc-panel {
        padding: 20px;
        gap: 16px;
        overflow-y: auto;
        flex: 1;
      }

      .doc-description {
        font-size: 15px;
        line-height: 1.6;
        color: #333;
      }

      .doc-section {
        flex-direction: column;
        gap: 6px;
        padding: 12px 14px;
        background: rgba(0, 0, 0, 0.02);
        border-radius: 10px;
        border: 1px solid rgba(0, 0, 0, 0.04);
      }

      .doc-label {
        font-size: 11px;
        font-weight: 700;
        width: auto;
        color: #777;
      }

      .doc-lineage {
        font-size: 14px;
        color: #444;
      }

      .doc-pills {
        gap: 8px;
      }

      .doc-pill {
        font-size: 13px;
        padding: 5px 12px;
        border-radius: 6px;
      }

      .doc-command {
        font-size: 16px;
      }

      .doc-alias {
        font-size: 13px;
      }

      .dep-name {
        font-size: 14px;
      }

      .dep-key {
        font-size: 11px;
      }

      .doc-dep {
        padding: 10px 12px;
        min-height: 44px;
        align-items: center;
        border-radius: 8px;
      }

      .doc-deps {
        gap: 6px;
      }

      .doc-link {
        font-size: 14px;
        padding: 6px 0;
      }

      .view-source-btn {
        font-size: 14px;
        padding: 14px 20px;
        min-height: 48px;
        border-radius: 10px;
      }

      .modal-body {
        padding: 8px;
      }

      .loading-text {
        font-size: 12px;
      }

      .error-text {
        font-size: 13px;
      }
    }
  `]
})
export class BeeInspectorComponent {
  signature = input.required<string>()
  contentBase = input('')
  rootSig = input('')
  kind = input<string>('bee')
  doc = input<BeeDocEntry | undefined>(undefined)
  lineage = input('')
  mode = input<'code' | 'detail'>('code')
  visible = input(false)
  close = output<void>()
  navigateSig = output<string>()

  #store = inject(DcpStore)

  source = signal('')
  loading = signal(false)
  error = signal<string | null>(null)
  loadedFrom = signal('')
  sigCopied = signal(false)
  activeView = signal<'code' | 'detail'>('code')
  #loaded = ''
  #byteSize = signal(0)

  displayName = computed(() => {
    const d = this.doc()
    if (d?.className) return d.className
    const src = this.source()
    const match = src.match(/(?:var\s+([A-Za-z0-9_]+)\s*=\s*class|class\s+([A-Za-z0-9_]+))\s+extends/)
    return match?.[1] ?? match?.[2] ?? this.signature().slice(0, 16) + '...'
  })

  depEntries = computed(() => {
    const d = this.doc()
    if (!d?.deps) return []
    return Object.entries(d.deps).map(([name, key]) => ({ name, key }))
  })

  fileSize = computed(() => {
    const bytes = this.#byteSize()
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  })

  constructor() {
    effect(() => {
      const sig = this.signature()
      const vis = this.visible()
      if (vis && sig) {
        this.activeView.set(this.mode())
        if (this.#loaded !== sig) {
          this.#load(sig)
        }
      }
    })
  }

  async copySig(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.signature())
      this.sigCopied.set(true)
      setTimeout(() => this.sigCopied.set(false), 900)
    } catch { /* ignore */ }
  }

  async #load(sig: string): Promise<void> {
    if (this.#loaded === sig) return
    this.#loaded = sig
    this.loading.set(true)
    this.error.set(null)
    this.source.set('')
    this.loadedFrom.set('')
    this.#byteSize.set(0)

    await this.#store.initialize()

    const isDep = this.kind() === 'dependency'
    const dir = isDep ? this.#store.dependencies : this.#store.bees
    const folder = isDep ? '__dependencies__' : '__bees__'
    const label = isDep ? 'Dependency' : 'Bee'

    // 1. check local OPFS first (DCP's own store — same folder structure)
    const localBytes = await this.#store.readFile(dir, `${sig}.js`)
    if (localBytes) {
      const actual = await SignatureService.sign(localBytes)
      if (actual === sig) {
        this.#byteSize.set(localBytes.byteLength)
        this.source.set(this.#stripSourceMap(new TextDecoder().decode(localBytes)))
        this.loadedFrom.set('local (OPFS)')
        this.loading.set(false)
        return
      }
    }

    // 2. fetch from content server, verify, store locally
    const base = this.contentBase().replace(/\/+$/, '')
    const root = this.rootSig()
    const urls = [
      root ? `${base}/${root}/${folder}/${sig}.js` : null,
    ].filter(Boolean) as string[]

    try {
      for (const url of urls) {
        try {
          const res = await fetch(url, { cache: 'no-store' })
          if (!res.ok) continue

          const bytes = await res.arrayBuffer()
          const actual = await SignatureService.sign(bytes)
          if (actual !== sig) continue

          // store in DCP's OPFS for next time
          await this.#store.writeFile(dir, `${sig}.js`, bytes)

          this.#byteSize.set(bytes.byteLength)
          this.source.set(this.#stripSourceMap(new TextDecoder().decode(bytes)))
          this.loadedFrom.set('content server')
          this.loading.set(false)
          return
        } catch { continue }
      }
      this.error.set(`${label} not found — not yet installed`)
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : `Failed to load ${label.toLowerCase()}`)
    } finally {
      this.loading.set(false)
    }
  }

  #stripSourceMap(text: string): string {
    return text.replace(/\n?\/\/#\s*sourceMappingURL=[\s\S]*$/, '').trimEnd()
  }
}
