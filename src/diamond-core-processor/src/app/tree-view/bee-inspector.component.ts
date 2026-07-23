// diamond-core-processor/src/app/tree-view/bee-inspector.component.ts

import { Component, computed, effect, inject, input, output, signal } from '@angular/core'
import { SignatureService } from '@hypercomb/core'
import { CodeViewerComponent } from '../code-viewer/code-viewer.component'
import { CodeEditorComponent } from '../code-editor/code-editor.component'
import { DcpTranslatePipe } from '../core/dcp-translate.pipe'
import { DcpStore } from '../core/dcp-store'
import { MerklePatchService, type PatchResult } from '../core/merkle-patch.service'
import type { BeeDocEntry } from '../core/tree-node'

@Component({
  selector: 'dcp-bee-inspector',
  standalone: true,
  imports: [CodeViewerComponent, CodeEditorComponent, DcpTranslatePipe],
  template: `
    @if (visible()) {
      <div class="page">
        <header class="hdr">
          <button class="hdr-back" (click)="onBack()">&larr; {{ 'dcp.inspector-back' | t }}</button>
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
            <button class="hdr-copy" (click)="copySig()">{{ sigCopied() ? ('dcp.copied' | t) : ('dcp.inspector-copy-sig' | t) }}</button>
            @if (!editMode() && source() && !loading() && canPatch()) {
              <button class="hdr-edit" (click)="enterEditMode()">{{ 'dcp.inspector-edit' | t }}</button>
            }
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
                  <tr><td class="prop-label">{{ 'dcp.inspector-location' | t }}</td><td><code>{{ lineage() }}</code></td></tr>
                }
                @if (d.command) {
                  <tr><td class="prop-label">{{ 'dcp.inspector-command' | t }}</td><td><code class="cmd">/{{ d.command }}</code>@for (alias of d.aliases; track alias) { <code class="alias">/{{ alias }}</code>}</td></tr>
                }
                @if (d.listens.length) {
                  <tr><td class="prop-label">{{ 'dcp.inspector-listens' | t }}</td><td>@for (e of d.listens; track e) {<code class="pill listen">{{ e }}</code> }</td></tr>
                }
                @if (d.emits.length) {
                  <tr><td class="prop-label">{{ 'dcp.inspector-emits' | t }}</td><td>@for (e of d.emits; track e) {<code class="pill emit">{{ e }}</code> }</td></tr>
                }
                @if (d.effects.length) {
                  <tr><td class="prop-label">{{ 'dcp.inspector-effects' | t }}</td><td>@for (e of d.effects; track e) {<code class="pill effect">{{ e }}</code> }</td></tr>
                }
                @if (depEntries().length) {
                  <tr><td class="prop-label">{{ 'dcp.inspector-deps' | t }}</td><td>@for (dep of depEntries(); track dep.key) {<code class="pill dep dep-link" (click)="navigateDep.emit(dep.key)" [title]="dep.key">{{ dep.name }}</code> }</td></tr>
                }
                @if (d.links.length) {
                  <tr><td class="prop-label">{{ 'dcp.inspector-links' | t }}</td><td>@for (link of d.links; track link.url) {<a class="link" [href]="link.url" target="_blank" rel="noopener">{{ link.label }}</a> }</td></tr>
                }
              </table>
              @if (activeView() === 'detail') {
                <button class="source-btn" (click)="activeView.set('code')">{{ 'dcp.inspector-view-source' | t }}</button>
              }
            </div>
          }

          @if (loading()) {
            <div class="status">
              <span class="loading-dot"></span>
              {{ 'dcp.inspector-resolving' | t }} {{ signature().slice(0, 12) }}...
            </div>
          }

          @if (error()) {
            <div class="status error">{{ error() }}</div>
          }

          @if (source() && !loading() && activeView() === 'code') {
            @if (editMode()) {
              <div class="edit-area">
                <dcp-code-editor [code]="editSource()" (codeChange)="editSource.set($event)" />
                @if (patchError()) {
                  <div class="status error">{{ patchError() }}</div>
                }
                <div class="edit-actions">
                  <button class="patch-btn" (click)="applyPatch()" [disabled]="patching()">
                    {{ patching() ? ('dcp.inspector-compiling' | t) : ('dcp.inspector-apply-patch' | t) }}
                  </button>
                  <button class="cancel-btn" (click)="cancelEdit()">{{ 'dcp.inspector-cancel' | t }}</button>
                </div>
              </div>
            } @else {
              <hc-code-viewer [code]="source()" />
            }
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
      background: var(--dcp-surface);
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
      border-bottom: 1px solid var(--dcp-line);
      background: var(--dcp-surface-2);
      min-height: 44px;
    }

    .hdr-back {
      background: none;
      border: 1px solid var(--dcp-line);
      padding: 4px 10px;
      font-size: 12px;
      color: var(--dcp-ink-2);
      cursor: pointer;
      white-space: nowrap;
      flex-shrink: 0;
    }

    .hdr-back:hover { color: var(--dcp-ink); border-color: var(--dcp-line-2); }

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
      color: var(--dcp-k-bee);
      flex-shrink: 0;
    }

    .hdr-kind.dep { color: var(--dcp-k-dependency); }
    .hdr-kind.worker { color: var(--dcp-k-worker); }
    .hdr-kind.drone { color: var(--dcp-k-drone); }
    .hdr-kind.queen { color: var(--dcp-k-queen); }

    .hdr-name {
      font-size: 15px;
      font-weight: 600;
      color: var(--dcp-ink);
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
      color: var(--dcp-ink-3);
      font-family: var(--hc-mono);
    }

    .hdr-sep { color: var(--dcp-ink-3); }

    .hdr-sig { color: var(--dcp-ink-3); }

    .hdr-copy, .hdr-edit {
      font-size: 10px;
      font-weight: 600;
      color: var(--dcp-ink-2);
      background: none;
      border: 1px solid var(--dcp-line);
      padding: 1px 8px;
      cursor: pointer;
      margin-left: 2px;
    }

    .hdr-copy:hover, .hdr-edit:hover { background: var(--dcp-hover); border-color: var(--dcp-line-2); }

    .hdr-edit { color: var(--dcp-accent); border-color: var(--dcp-accent); }
    .hdr-edit:hover { background: var(--dcp-accent-tint); }

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
      border-bottom: 1px solid var(--dcp-line);
    }

    .desc {
      font-size: 13px;
      color: var(--dcp-ink);
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
      color: var(--dcp-ink-3);
      width: 65px;
      padding-right: 10px;
    }

    .props code {
      font-family: var(--hc-mono);
      font-size: 11px;
      color: var(--dcp-ink-2);
    }

    .cmd {
      font-weight: 600;
      color: var(--dcp-k-queen);
    }

    .alias {
      color: var(--dcp-ink-3);
      margin-left: 6px;
    }

    .pill {
      display: inline-block;
      padding: 0 4px;
      margin: 1px 2px 1px 0;
    }

    .pill.listen { color: var(--dcp-z-logical-ink); background: color-mix(in srgb, var(--dcp-z-logical-ink) 14%, transparent); }
    .pill.emit { color: var(--dcp-danger); background: color-mix(in srgb, var(--dcp-danger) 14%, transparent); }
    .pill.effect { color: var(--dcp-accent); background: var(--dcp-accent-tint); }
    .pill.dep { color: var(--dcp-k-dependency); background: color-mix(in srgb, var(--dcp-k-dependency) 14%, transparent); }

    .dep-link {
      cursor: pointer;
      transition: background 0.15s, color 0.15s;
    }

    .dep-link:hover {
      background: color-mix(in srgb, var(--dcp-k-dependency) 24%, transparent);
      color: var(--dcp-k-dependency);
    }

    .link {
      font-size: 11px;
      color: var(--dcp-accent);
      text-decoration: none;
      margin-right: 8px;
    }

    .link:hover { text-decoration: underline; }

    .source-btn {
      margin-top: 10px;
      padding: 6px 14px;
      font-size: 11px;
      font-weight: 600;
      color: var(--dcp-accent);
      background: none;
      border: 1px solid var(--dcp-accent);
      cursor: pointer;
    }

    .source-btn:hover { background: var(--dcp-accent-tint); }

    /* --- edit mode --- */

    .edit-area {
      padding-top: 12px;
      padding-bottom: 24px;
    }

    .edit-actions {
      display: flex;
      gap: 8px;
      margin-top: 12px;
    }

    .patch-btn {
      padding: 8px 20px;
      font-size: 12px;
      font-weight: 600;
      color: var(--dcp-on-accent);
      background: var(--dcp-accent);
      border: none;
      cursor: pointer;
    }

    .patch-btn:hover:not(:disabled) { background: var(--dcp-accent-strong); }
    .patch-btn:disabled { opacity: 0.5; cursor: not-allowed; }

    .cancel-btn {
      padding: 8px 20px;
      font-size: 12px;
      font-weight: 600;
      color: var(--dcp-ink-2);
      background: none;
      border: 1px solid var(--dcp-line);
      cursor: pointer;
    }

    .cancel-btn:hover { background: var(--dcp-hover); }

    /* --- loading / error --- */

    .status {
      display: flex;
      align-items: center;
      gap: 8px;
      padding-top: 24px;
      padding-bottom: 24px;
      font-size: 11px;
      color: var(--dcp-ink-3);
      font-family: var(--hc-mono);
    }

    .status.error { color: var(--dcp-danger); }

    .loading-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--dcp-accent);
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

      .hdr-copy, .hdr-edit { font-size: 10px; padding: 2px 10px; min-height: 28px; }

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

      .patch-btn, .cancel-btn {
        font-size: 14px;
        padding: 12px 20px;
        min-height: 44px;
        flex: 1;
      }
    }
  `]
})
export class BeeInspectorComponent {
  signature = input.required<string>()
  contentBase = input('')
  rootSig = input('')
  domainName = input('')
  kind = input<string>('bee')
  doc = input<BeeDocEntry | undefined>(undefined)
  lineage = input('')
  mode = input<'code' | 'detail'>('code')
  visible = input(false)
  close = output<void>()
  navigateSig = output<string>()
  navigateDep = output<string>()
  patchApplied = output<PatchResult>()

  #store = inject(DcpStore)
  #patcher = inject(MerklePatchService)

  source = signal('')
  loading = signal(false)
  error = signal<string | null>(null)
  loadedFrom = signal('')
  sigCopied = signal(false)
  activeView = signal<'code' | 'detail'>('code')
  #loaded = ''
  #byteSize = signal(0)

  // edit mode state
  editMode = signal(false)
  editSource = signal('')
  patching = signal(false)
  patchError = signal<string | null>(null)

  canPatch = computed(() => {
    const k = this.kind()
    return k === 'bee' || k === 'dependency' || k === 'worker' || k === 'drone'
  })

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
        this.editMode.set(false)
        this.patchError.set(null)
        if (this.#loaded !== sig) {
          this.#load(sig)
        }
      }
    })
  }

  onBack(): void {
    if (this.editMode()) {
      this.cancelEdit()
    } else {
      this.close.emit()
    }
  }

  enterEditMode(): void {
    this.editSource.set(this.source())
    this.editMode.set(true)
    this.patchError.set(null)
  }

  cancelEdit(): void {
    this.editMode.set(false)
    this.editSource.set('')
    this.patchError.set(null)
  }

  async applyPatch(): Promise<void> {
    const modified = this.editSource()
    if (!modified.trim()) {
      this.patchError.set('Source cannot be empty')
      return
    }

    this.patching.set(true)
    this.patchError.set(null)

    try {
      const patchKind = (this.kind() === 'dependency' ? 'dependency' : 'bee') as 'bee' | 'dependency'

      const result = await this.#patcher.applyPatch({
        originalSig: this.signature(),
        kind: patchKind,
        modifiedSource: modified,
        rootSig: this.rootSig(),
        domain: this.domainName(),
        lineage: this.lineage()
      })

      this.editMode.set(false)
      this.patchApplied.emit(result)
    } catch (e: unknown) {
      this.patchError.set(e instanceof Error ? e.message : 'Compilation failed')
    } finally {
      this.patching.set(false)
    }
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

    // check patched files first, then originals
    const domain = this.domainName()
    if (domain) {
      const patchedDir = isDep
        ? await this.#store.patchedDepsDir(domain)
        : await this.#store.patchedBeesDir(domain)
      const patchedBytes = await this.#store.readFile(patchedDir, `${sig}.js`)
      if (patchedBytes) {
        const actual = await SignatureService.sign(patchedBytes)
        if (actual === sig) {
          this.#byteSize.set(patchedBytes.byteLength)
          this.source.set(this.#stripSourceMap(new TextDecoder().decode(patchedBytes)))
          this.loadedFrom.set('local (patched)')
          this.loading.set(false)
          return
        }
      }
    }

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

    // 2. fetch from content server, verify, store locally. Flat heap first
    // (`/<sig>` — the canonical address), then the plain typed pool, then
    // the stale root-scoped shape kept last for ancient hosts.
    const base = this.contentBase().replace(/\/+$/, '')
    const root = this.rootSig()
    const urls = [
      `${base}/${sig}`,
      `${base}/${folder}/${sig}.js`,
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
