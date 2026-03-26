// diamond-core-processor/src/app/detail/detail-view.component.ts

import { Component, inject, input, output, computed, signal } from '@angular/core'
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser'
import type { TreeNode } from '../core/tree-node'

@Component({
  selector: 'dcp-detail-view',
  standalone: true,
  template: `
    <div class="detail">
      <header class="detail-header">
        <button class="back" (click)="back.emit()">&larr; Back</button>
        <div class="breadcrumb">{{ breadcrumb() }}</div>
      </header>

      <div class="detail-meta">
        <h2 class="detail-name">{{ node().name }}</h2>
        @if (node().signature) {
          <span class="detail-sig">{{ node().signature }}</span>
          <button class="copy-sig" (click)="copySig()">{{ sigCopied() ? '&#10003;' : '&#x2398;' }}</button>
        }
        <span class="detail-kind">{{ node().kind }}</span>
        @if (node().audit) {
          <span class="detail-audit" [class.met]="node().audit!.meetsThreshold" [class.unmet]="!node().audit!.meetsThreshold">
            {{ node().audit!.approvedBy.length }} of {{ node().audit!.total }} auditors approve
          </span>
        }
      </div>

      <div class="detail-content">
        <iframe
          class="hypercomb-frame"
          [src]="iframeSrc()"
          sandbox="allow-scripts allow-same-origin"
          allow="clipboard-write">
        </iframe>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; height: 100%; }

    .detail {
      display: flex;
      flex-direction: column;
      height: 100vh;
    }

    .detail-header {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 12px 20px;
      border-bottom: 1px solid rgba(0,0,0,0.08);
    }

    .back {
      background: none;
      border: 1px solid rgba(0,0,0,0.12);
      border-radius: 2px;
      padding: 6px 12px;
      cursor: pointer;
      font-size: 13px;
      color: #444;
    }

    .back:hover {
      background: rgba(0,0,0,0.04);
    }

    .breadcrumb {
      font-size: 13px;
      color: #666;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    }

    .detail-meta {
      display: flex;
      align-items: baseline;
      gap: 12px;
      padding: 16px 20px 12px;
      flex-wrap: wrap;
    }

    .detail-name {
      font-size: 20px;
      font-weight: 700;
      color: #1a1a1a;
      margin: 0;
    }

    .detail-sig {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 11px;
      color: #888;
      word-break: break-all;
    }

    .copy-sig {
      background: none;
      border: 1px solid rgba(0, 0, 0, 0.1);
      border-radius: 4px;
      padding: 2px 6px;
      cursor: pointer;
      font-size: 13px;
      color: #888;
      line-height: 1;
      flex-shrink: 0;
    }

    .copy-sig:hover {
      background: rgba(0, 0, 0, 0.04);
      color: #444;
    }

    .detail-kind {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #999;
    }

    .detail-audit {
      font-size: 12px;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 2px;
    }

    .detail-audit.met {
      background: #e6f4ea;
      color: #1e7e34;
    }

    .detail-audit.unmet {
      background: #fff3e0;
      color: #e65100;
    }

    .detail-content {
      flex: 1;
      padding: 0;
    }

    .hypercomb-frame {
      width: 100%;
      height: 100%;
      border: none;
    }
  `]
})
export class DetailViewComponent {
  node = input.required<TreeNode>()
  hypercombUrl = input('http://localhost:4200')

  back = output<void>()

  #sanitizer = inject(DomSanitizer)
  sigCopied = signal(false)

  breadcrumb = computed(() => {
    const lineage = this.node().lineage
    return lineage ? `/ ${lineage.replace(/\//g, ' / ')}` : '/ root'
  })

  async copySig(): Promise<void> {
    const sig = this.node().signature
    if (!sig) return
    try {
      await navigator.clipboard.writeText(sig)
      this.sigCopied.set(true)
      setTimeout(() => this.sigCopied.set(false), 900)
    } catch { /* ignore */ }
  }

  iframeSrc = computed((): SafeResourceUrl => {
    const lineage = this.node().lineage
    const base = this.hypercombUrl()
    const url = lineage ? `${base}/${lineage}` : base
    return this.#sanitizer.bypassSecurityTrustResourceUrl(url)
  })
}
