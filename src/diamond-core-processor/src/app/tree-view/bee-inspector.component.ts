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
      <div class="page">
        <header class="hdr">
          <button class="hdr-back" (click)="close.emit()">&larr; Back</button>
          <div class="hdr-title">
            <span class="hdr-kind" [class.dep]="kind() === 'dependency'" [class.worker]="kind() === 'worker'" [class.drone]="kind() === 'drone'" [class.queen]="doc()?.kind === 'queen'">{{ doc()?.kind ?? kind() }}</span>
            <span class="hdr-name">{{ displayName() }}</span>
          </div>
          <div class="hdr-meta">
            <span>{{ fileSize() }}</span>
            <span class="hdr-sep">&middot;</span>
            <span>{{ loadedFrom() }}</span>
            <span class="hdr-sep">&middot;</span>
            <code class="hdr-sig">{{ signature().slice(0, 12) }}&hellip;</code>
            <button class="hdr-copy" (click)="copySig()">{{ sigCopied() ? 'copied' : 'copy sig' }}</button>
          </div>
        </header>

        <div class="content">

          @if (doc(); as d) {
            <div class="details">
              @if (d.description) {
                <p class="desc">{{ d.description }}</p>
              }
              <table class="props">
                @if (lineage()) {
                  <tr><td class="prop-label">location</td><td><code>{{ lineage() }}</code></td></tr>
                }
                @if (d.command) {
                  <tr><td class="prop-label">command</td><td><code class="cmd">/{{ d.command }}</code>@for (alias of d.aliases; track alias) { <code class="alias">/{{ alias }}</code>}</td></tr>
                }
                @if (d.listens.length) {
                  <tr><td class="prop-label">listens</td><td>@for (e of d.listens; track e) {<code class="pill listen">{{ e }}</code> }</td></tr>
                }
                @if (d.emits.length) {
                  <tr><td class="prop-label">emits</td><td>@for (e of d.emits; track e) {<code class="pill emit">{{ e }}</code> }</td></tr>
                }
                @if (d.effects.length) {
                  <tr><td class="prop-label">effects</td><td>@for (e of d.effects; track e) {<code class="pill effect">{{ e }}</code> }</td></tr>
                }
                @if (depEntries().length) {
                  <tr><td class="prop-label">deps</td><td>@for (dep of depEntries(); track dep.key) {<code class="pill dep dep-link" (click)="navigateDep.emit(dep.key)" [title]="dep.key">{{ dep.name }}</code> }</td></tr>
                }
                @if (d.links.length) {
                  <tr><td class="prop-label">links</td><td>@for (link of d.links; track link.url) {<a class="link" [href]="link.url" target="_blank" rel="noopener">{{ link.label }}</a> }</td></tr>
                }
              </table>
              @if (activeView() === 'detail') {
                <button class="source-btn" (click)="activeView.set('code')">View Source</button>
              }
            </div>
          }

          @if (loading()) {
            <div class="status">
              <span class="loading-dot"></span>
              Resolving {{ signature().slice(0, 12) }}...
            </div>
          }

          @if (error()) {
            <div class="status error">{{ error() }}</div>
          }

          @if (source() && !loading() && activeView() === 'code') {
            <hc-code-viewer [code]="source()" />
          }
        </div>
      </div>
    }
  `,
  styles: [`
    :host { display: contents; }

    .page {
      position: fixed;
      inset: 0;
      z-index: 1000;
      background: #fff;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    /* --- header --- */

    .hdr {
      flex-shrink: 0;
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 10px 20px;
      border-bottom: 1px solid #e0e0e0;
      background: #fafafa;
      min-height: 44px;
    }

    .hdr-back {
      background: none;
      border: 1px solid #ddd;
      padding: 4px 10px;
      font-size: 12px;
      color: #555;
      cursor: pointer;
      white-space: nowrap;
      flex-shrink: 0;
    }

    .hdr-back:hover { color: #111; border-color: #bbb; }

    .hdr-title {
      display: flex;
      align-items: baseline;
      gap: 8px;
      min-width: 0;
    }

    .hdr-kind {
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #a58b4f;
      flex-shrink: 0;
    }

    .hdr-kind.dep { color: #4fa58b; }
    .hdr-kind.worker { color: #a54f4f; }
    .hdr-kind.drone { color: #a59b4f; }
    .hdr-kind.queen { color: #7b4fa5; }

    .hdr-name {
      font-size: 15px;
      font-weight: 600;
      color: #111;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .hdr-meta {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-left: auto;
      flex-shrink: 0;
      font-size: 11px;
      color: #999;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    }

    .hdr-sep { color: #ccc; }

    .hdr-sig { color: #aaa; }

    .hdr-copy {
      font-size: 10px;
      font-weight: 600;
      color: #666;
      background: none;
      border: 1px solid #ddd;
      padding: 1px 8px;
      cursor: pointer;
      margin-left: 2px;
    }

    .hdr-copy:hover { background: #f0f0f0; border-color: #bbb; }

    /* --- scrollable content --- */

    .content {
      flex: 1;
      overflow-y: auto;
      overflow-x: hidden;
      --gutter: 20px;
    }

    .content > * {
      display: block;
      max-width: 680px;
      margin-left: auto;
      margin-right: auto;
      padding-left: var(--gutter);
      padding-right: var(--gutter);
      box-sizing: border-box;
    }

    /* --- details section --- */

    .details {
      padding-top: 12px;
      padding-bottom: 12px;
      border-bottom: 1px solid #f0f0f0;
    }

    .desc {
      font-size: 13px;
      color: #444;
      line-height: 1.5;
      margin: 0 0 10px;
    }

    .props {
      border-collapse: collapse;
      width: 100%;
      font-size: 11px;
    }

    .props td {
      padding: 3px 0;
      vertical-align: baseline;
    }

    .prop-label {
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      font-size: 9px;
      color: #999;
      width: 65px;
      padding-right: 10px;
    }

    .props code {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 11px;
      color: #555;
    }

    .cmd {
      font-weight: 600;
      color: #7b4fa5;
    }

    .alias {
      color: #999;
      margin-left: 6px;
    }

    .pill {
      display: inline-block;
      padding: 0 4px;
      margin: 1px 2px 1px 0;
    }

    .pill.listen { color: #2e7d32; background: rgba(46, 125, 50, 0.07); }
    .pill.emit { color: #c62828; background: rgba(198, 40, 40, 0.07); }
    .pill.effect { color: #1565c0; background: rgba(21, 101, 192, 0.07); }
    .pill.dep { color: #4fa58b; background: rgba(79, 165, 139, 0.07); }

    .dep-link {
      cursor: pointer;
      transition: background 0.15s, color 0.15s;
    }

    .dep-link:hover {
      background: rgba(79, 165, 139, 0.18);
      color: #2e7d5b;
    }

    .link {
      font-size: 11px;
      color: #1565c0;
      text-decoration: none;
      margin-right: 8px;
    }

    .link:hover { text-decoration: underline; }

    .source-btn {
      margin-top: 10px;
      padding: 6px 14px;
      font-size: 11px;
      font-weight: 600;
      color: #4a6fa5;
      background: none;
      border: 1px solid rgba(74, 111, 165, 0.2);
      cursor: pointer;
    }

    .source-btn:hover { background: rgba(74, 111, 165, 0.06); }

    /* --- loading / error --- */

    .status {
      display: flex;
      align-items: center;
      gap: 8px;
      padding-top: 24px;
      padding-bottom: 24px;
      font-size: 11px;
      color: #888;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    }

    .status.error { color: #b00020; }

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

    /* --- responsive widths --- */

    @media (min-width: 1200px) {
      .content > * { max-width: 800px; }
    }

    @media (max-width: 768px) {
      .content > * { max-width: 560px; }
    }

    @media (max-width: 600px) {
      .content > * { max-width: none; }
      .content { --gutter: 12px; }
    }

    /* --- mobile --- */

    @media (max-width: 600px) {
      .hdr {
        flex-wrap: wrap;
        padding: 8px 12px;
        gap: 8px;
      }

      .hdr-back {
        min-width: 44px;
        min-height: 36px;
        font-size: 13px;
      }

      .hdr-title { gap: 6px; }
      .hdr-kind { font-size: 10px; }
      .hdr-name { font-size: 14px; }

      .hdr-meta {
        width: 100%;
        font-size: 10px;
        gap: 4px;
      }

      .hdr-copy { font-size: 10px; padding: 2px 10px; min-height: 28px; }

      .details { padding-top: 14px; padding-bottom: 14px; }
      .desc { font-size: 14px; }
      .props { font-size: 13px; }
      .props code { font-size: 13px; }
      .prop-label { font-size: 10px; width: 60px; }

      .pill { padding: 2px 8px; margin: 2px 4px 2px 0; }

      .source-btn {
        font-size: 14px;
        padding: 12px 20px;
        min-height: 44px;
        width: 100%;
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
  navigateDep = output<string>()

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
      const vis = this.visible()
      document.documentElement.style.overflow = vis ? 'hidden' : ''
    })

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
