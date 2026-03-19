// src/app/tree-view/bee-inspector.component.ts
import { Component, computed, effect, inject, input, output, signal } from '@angular/core'
import { SignatureService } from '@hypercomb/core'
import { CodeViewerComponent } from '../code-viewer/code-viewer.component'
import { DcpStore } from '../core/dcp-store'

@Component({
  selector: 'dcp-bee-inspector',
  standalone: true,
  imports: [CodeViewerComponent],
  template: `
    @if (visible()) {
      <div class="backdrop" (click)="close.emit()"></div>
      <div class="modal">
        <header class="modal-header">
          <div class="header-left">
            <span class="bee-kind">bee</span>
            <h2 class="bee-name">{{ displayName() }}</h2>
          </div>
          <button class="close-btn" (click)="close.emit()">&times;</button>
        </header>

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

        @if (source() && !loading()) {
          <div class="modal-body">
            <div class="meta-strip">
              <div class="meta-item">
                <span class="meta-label">signature</span>
                <span class="meta-value mono">{{ signature() }}</span>
              </div>
              <div class="meta-item">
                <span class="meta-label">size</span>
                <span class="meta-value">{{ fileSize() }}</span>
              </div>
              <div class="meta-item">
                <span class="meta-label">source</span>
                <span class="meta-value">{{ loadedFrom() }}</span>
              </div>
            </div>

            <div class="code-section">
              <hc-code-viewer [code]="source()" />
            </div>
          </div>
        }
      </div>
    }
  `,
  styles: [`
    .backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.4);
      backdrop-filter: blur(4px);
      z-index: 1000;
      animation: fadeIn 0.15s ease;
    }

    .modal {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: min(720px, 90vw);
      max-height: 85vh;
      background: #fff;
      border-radius: 14px;
      box-shadow: 0 24px 80px rgba(0, 0, 0, 0.18), 0 0 0 1px rgba(0, 0, 0, 0.06);
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
      align-items: center;
      justify-content: space-between;
      padding: 16px 20px;
      border-bottom: 1px solid rgba(0, 0, 0, 0.06);
    }

    .header-left {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
    }

    .bee-kind {
      font-size: 10px;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #a58b4f;
      background: rgba(165, 139, 79, 0.08);
      padding: 2px 8px;
      border-radius: 4px;
      flex-shrink: 0;
    }

    .bee-name {
      font-size: 15px;
      font-weight: 500;
      color: #1a1a1a;
      margin: 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .close-btn {
      background: none;
      border: none;
      font-size: 20px;
      color: #999;
      cursor: pointer;
      padding: 0 4px;
      line-height: 1;
      flex-shrink: 0;
    }

    .close-btn:hover {
      color: #333;
    }

    .modal-body {
      flex: 1;
      overflow-y: auto;
      padding: 16px 20px;
    }

    .modal-body.center {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      min-height: 120px;
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
      font-size: 12px;
      color: #888;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    }

    .error-text {
      font-size: 12px;
      color: #b00020;
    }

    .meta-strip {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-bottom: 16px;
    }

    .meta-item {
      display: flex;
      align-items: baseline;
      gap: 10px;
    }

    .meta-label {
      font-size: 10px;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #999;
      flex-shrink: 0;
      width: 72px;
    }

    .meta-value {
      font-size: 12px;
      color: #444;
      word-break: break-all;
    }

    .mono {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 11px;
      color: #666;
    }

    .code-section {
      margin-bottom: 0;
    }
  `]
})
export class BeeInspectorComponent {
  signature = input.required<string>()
  contentBase = input('')
  rootSig = input('')
  visible = input(false)
  close = output<void>()

  #store = inject(DcpStore)

  source = signal('')
  loading = signal(false)
  error = signal<string | null>(null)
  loadedFrom = signal('')
  #loaded = ''
  #byteSize = 0

  displayName = computed(() => {
    const src = this.source()
    const match = src.match(/class\s+([A-Za-z0-9_]+)\s+extends/)
    return match?.[1] ?? this.signature().slice(0, 16) + '...'
  })

  fileSize = computed(() => {
    const bytes = this.#byteSize
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  })

  constructor() {
    effect(() => {
      const sig = this.signature()
      const vis = this.visible()
      if (vis && sig && this.#loaded !== sig) {
        this.#load(sig)
      }
    })
  }

  async #load(sig: string): Promise<void> {
    if (this.#loaded === sig) return
    this.#loaded = sig
    this.loading.set(true)
    this.error.set(null)
    this.source.set('')
    this.loadedFrom.set('')
    this.#byteSize = 0

    await this.#store.initialize()

    // 1. check local OPFS first (DCP's own store — same folder structure)
    const localBytes = await this.#store.readFile(this.#store.bees, `${sig}.js`)
    if (localBytes) {
      const actual = await SignatureService.sign(localBytes)
      if (actual === sig) {
        this.#byteSize = localBytes.byteLength
        this.source.set(new TextDecoder().decode(localBytes))
        this.loadedFrom.set('local (OPFS)')
        this.loading.set(false)
        return
      }
    }

    // 2. fetch from content server, verify, store locally
    const base = this.contentBase().replace(/\/+$/, '')
    const root = this.rootSig()
    const urls = [
      root ? `${base}/${root}/__bees__/${sig}.js` : null,
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
          await this.#store.writeFile(this.#store.bees, `${sig}.js`, bytes)

          this.#byteSize = bytes.byteLength
          this.source.set(new TextDecoder().decode(bytes))
          this.loadedFrom.set('content server')
          this.loading.set(false)
          return
        } catch { continue }
      }
      this.error.set('Bee not found — not yet installed')
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Failed to load bee')
    } finally {
      this.loading.set(false)
    }
  }
}
