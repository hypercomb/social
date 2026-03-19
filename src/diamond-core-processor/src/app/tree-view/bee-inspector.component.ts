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
          <div class="header-top">
            <div class="header-left">
              <span class="kind-badge" [class.dep]="kind() === 'dependency'">{{ kind() === 'dependency' ? 'dep' : 'bee' }}</span>
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

    .modal-body {
      flex: 1;
      overflow-y: auto;
      padding: 0;
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
  `]
})
export class BeeInspectorComponent {
  signature = input.required<string>()
  contentBase = input('')
  rootSig = input('')
  kind = input<'bee' | 'dependency'>('bee')
  visible = input(false)
  close = output<void>()

  #store = inject(DcpStore)

  source = signal('')
  loading = signal(false)
  error = signal<string | null>(null)
  loadedFrom = signal('')
  sigCopied = signal(false)
  #loaded = ''
  #byteSize = signal(0)

  displayName = computed(() => {
    const src = this.source()
    const match = src.match(/class\s+([A-Za-z0-9_]+)\s+extends/)
    return match?.[1] ?? this.signature().slice(0, 16) + '...'
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
      if (vis && sig && this.#loaded !== sig) {
        this.#load(sig)
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
          this.source.set(new TextDecoder().decode(bytes))
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
}
