// diamond-core-processor/src/app/layer-editor/layer-editor.component.ts

import { Component, computed, effect, inject, input, output, signal, ChangeDetectorRef } from '@angular/core'
import { SignatureService } from '@hypercomb/core'
import { CodeViewerComponent } from '../code-viewer/code-viewer.component'
import { CodeEditorComponent } from '../code-editor/code-editor.component'
import { DcpTranslatePipe } from '../core/dcp-translate.pipe'
import { DcpStore } from '../core/dcp-store'
import { MerklePatchService, type BatchPatchResult } from '../core/merkle-patch.service'
import { CommitLockService } from './commit-lock.service'
import { LayerEditAiService, type AiEditChange } from './layer-edit-ai.service'
import type { TreeNode } from '../core/tree-node'
import type { DomainSection } from '../home/home.component'
import type { ChatMessage } from '../../../../hypercomb-essentials/src/diamondcoreprocessor.com/assistant/llm-api.js'

type EditableFile = {
  signature: string
  name: string
  kind: 'bee' | 'dependency'
  originalSource: string
}

type AiMessage = {
  role: 'user' | 'assistant'
  content: string
  changes?: AiEditChange[]
}

@Component({
  selector: 'dcp-layer-editor',
  standalone: true,
  imports: [CodeViewerComponent, CodeEditorComponent, DcpTranslatePipe],
  template: `
    @if (visible()) {
      <div class="layer-editor">
        <header class="header">
          <button class="back-btn" (click)="close.emit()">&larr; {{ 'dcp.editor-back' | t }}</button>
          <div class="header-info">
            <span class="header-lineage">{{ layerNode().lineage }}</span>
            <span class="header-name">{{ layerNode().name }}</span>
          </div>
          <div class="header-actions">
            @if (stagedChanges().size > 0) {
              <button class="discard-btn" (click)="onDiscardAll()">{{ 'dcp.editor-discard' | t }}</button>
              @if (lockPromptVisible()) {
                <input
                  class="lock-input"
                  type="password"
                  placeholder="passphrase"
                  [value]="lockInput()"
                  (input)="lockInput.set($any($event.target).value)"
                  (keydown.enter)="onCommit()" />
              }
              <button class="commit-btn" [disabled]="committing()" (click)="onCommit()">
                {{ committing() ? ('dcp.editor-committing' | t) : lockConfigured() ? ('dcp.editor-commit-locked' | t) : ('dcp.editor-commit' | t) }}
              </button>
            }
          </div>
        </header>

        <div class="ai-bar">
          <input
            class="ai-input"
            type="text"
            [placeholder]="'dcp.editor-ai-placeholder' | t"
            [value]="aiInput()"
            [disabled]="aiProcessing()"
            (input)="aiInput.set($any($event.target).value)"
            (keydown.enter)="onAiSubmit()" />
          @if (aiProcessing()) {
            <span class="ai-spinner">{{ 'dcp.editor-working' | t }}</span>
          }
        </div>

        @if (aiError()) {
          <div class="ai-error">{{ aiError() }}</div>
        }

        @if (commitError()) {
          <div class="commit-error">{{ commitError() }}</div>
        }

        @if (messages().length) {
          <div class="messages">
            @for (msg of messages(); track $index) {
              <div class="message" [class.user]="msg.role === 'user'" [class.assistant]="msg.role === 'assistant'">
                <span class="message-role">{{ msg.role }}</span>
                <span class="message-content">{{ msg.content }}</span>
                @if (msg.changes) {
                  <span class="message-changes">{{ msg.changes.length }} file(s) changed</span>
                }
              </div>
            }
          </div>
        }

        <div class="file-panels">
          @if (loading()) {
            <div class="loading">{{ 'dcp.editor-loading-files' | t }}</div>
          }

          @for (file of files(); track file.signature) {
            <div class="file-panel">
              <div class="file-header">
                <span class="file-kind" [class]="file.kind">{{ file.kind }}</span>
                <span class="file-name">{{ file.name }}</span>
                <span class="file-sig">{{ file.signature.slice(0, 12) }}</span>
                @if (stagedChanges().has(file.signature)) {
                  <span class="file-modified">{{ 'dcp.editor-modified' | t }}</span>
                  <button class="file-discard" (click)="onDiscardChange(file.signature)">&times;</button>
                }
              </div>
              @if (stagedChanges().has(file.signature)) {
                <dcp-code-editor
                  [code]="stagedChanges().get(file.signature)!"
                  (codeChange)="onManualEdit(file.signature, $any($event))" />
              } @else {
                <hc-code-viewer [code]="file.originalSource" />
              }
            </div>
          }

          @if (!loading() && files().length === 0) {
            <div class="empty">{{ 'dcp.editor-empty' | t }}</div>
          }
        </div>
      </div>
    }
  `,
  styles: [`
    .layer-editor {
      position: fixed;
      inset: 0;
      z-index: 1000;
      background: #fff;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 8px 16px;
      border-bottom: 1px solid #e0e0e0;
      background: #fafafa;
      flex-shrink: 0;
    }

    .back-btn {
      background: none;
      border: 1px solid #ddd;
      border-radius: 4px;
      cursor: pointer;
      padding: 4px 10px;
      font-size: 13px;
      color: #555;
    }

    .back-btn:hover { background: #f0f0f0; }

    .header-info {
      display: flex;
      align-items: baseline;
      gap: 8px;
      flex: 1;
      min-width: 0;
    }

    .header-lineage {
      font-size: 11px;
      color: #999;
    }

    .header-name {
      font-size: 14px;
      font-weight: 600;
      color: #333;
    }

    .header-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
    }

    .discard-btn {
      background: none;
      border: 1px solid #e0c080;
      border-radius: 4px;
      cursor: pointer;
      padding: 4px 10px;
      font-size: 12px;
      color: #a58b4f;
    }

    .discard-btn:hover { background: #fef8e8; }

    .lock-input {
      font-size: 12px;
      padding: 4px 8px;
      border: 1px solid #ccc;
      border-radius: 4px;
      width: 120px;
    }

    .commit-btn {
      background: #2a6e3f;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      padding: 4px 14px;
      font-size: 12px;
      color: #fff;
      font-weight: 500;
    }

    .commit-btn:hover { background: #1e5a30; }
    .commit-btn:disabled { opacity: 0.5; cursor: default; }

    .ai-bar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 16px;
      border-bottom: 1px solid #e0e0e0;
      background: #f5f5f5;
      flex-shrink: 0;
    }

    .ai-input {
      flex: 1;
      font-size: 13px;
      padding: 6px 10px;
      border: 1px solid #ccc;
      border-radius: 4px;
      background: #fff;
    }

    .ai-input:focus { outline: none; border-color: #4a6fa5; }
    .ai-input:disabled { background: #eee; }

    .ai-spinner {
      font-size: 11px;
      color: #999;
      flex-shrink: 0;
    }

    .ai-error,
    .commit-error {
      padding: 6px 16px;
      font-size: 12px;
      color: #c44;
      background: #fff0f0;
      border-bottom: 1px solid #fcc;
      flex-shrink: 0;
    }

    .messages {
      padding: 8px 16px;
      border-bottom: 1px solid #e0e0e0;
      max-height: 200px;
      overflow-y: auto;
      flex-shrink: 0;
      background: #fcfcfc;
    }

    .message {
      padding: 4px 0;
      font-size: 12px;
      display: flex;
      gap: 8px;
      align-items: baseline;
    }

    .message-role {
      font-weight: 600;
      font-size: 10px;
      text-transform: uppercase;
      color: #999;
      flex-shrink: 0;
      width: 60px;
    }

    .message.user .message-role { color: #4a6fa5; }
    .message.assistant .message-role { color: #6a4fa5; }

    .message-content {
      color: #333;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .message-changes {
      font-size: 10px;
      color: #2a6e3f;
      flex-shrink: 0;
    }

    .file-panels {
      flex: 1;
      overflow-y: auto;
      padding: 0 16px 16px;
    }

    .loading,
    .empty {
      padding: 24px 0;
      text-align: center;
      color: #999;
      font-size: 13px;
    }

    .file-panel {
      margin-top: 12px;
      border: 1px solid #e0e0e0;
      border-radius: 4px;
      overflow: hidden;
    }

    .file-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 10px;
      background: #f5f5f5;
      border-bottom: 1px solid #e0e0e0;
      font-size: 12px;
    }

    .file-kind {
      font-weight: 600;
      text-transform: uppercase;
      font-size: 10px;
    }

    .file-kind.bee { color: #a58b4f; }
    .file-kind.dependency { color: #4fa58b; }

    .file-name {
      color: #333;
      font-weight: 500;
    }

    .file-sig {
      font-family: var(--hc-mono);
      font-size: 10px;
      color: #bbb;
      margin-left: auto;
    }

    .file-modified {
      font-size: 10px;
      color: #2a6e3f;
      background: #e6f4ea;
      padding: 1px 6px;
      border-radius: 2px;
    }

    .file-discard {
      background: none;
      border: none;
      cursor: pointer;
      font-size: 16px;
      color: #c44;
      padding: 0 2px;
      line-height: 1;
    }
  `]
})
export class LayerEditorComponent {

  #store = inject(DcpStore)
  #patchService = inject(MerklePatchService)
  #lockService = inject(CommitLockService)
  #aiService = inject(LayerEditAiService)
  #cdr = inject(ChangeDetectorRef)

  // inputs
  layerNode = input.required<TreeNode>()
  section = input.required<DomainSection>()
  visible = input(false)

  // outputs
  close = output<void>()
  patchApplied = output<BatchPatchResult>()

  // state
  files = signal<EditableFile[]>([])
  stagedChanges = signal<Map<string, string>>(new Map())
  messages = signal<AiMessage[]>([])
  loading = signal(false)
  aiInput = signal('')
  aiProcessing = signal(false)
  aiError = signal<string | null>(null)
  committing = signal(false)
  commitError = signal<string | null>(null)
  lockPromptVisible = signal(false)
  lockInput = signal('')

  lockConfigured = computed(() => this.#lockService.isConfigured())

  constructor() {
    // load files when the layer node changes
    effect(() => {
      const node = this.layerNode()
      if (node.signature && this.visible()) {
        this.#loadFiles(node)
      }
    })
  }

  async onAiSubmit(): Promise<void> {
    const instruction = this.aiInput().trim()
    if (!instruction || this.aiProcessing()) return

    this.aiInput.set('')
    this.aiError.set(null)
    this.aiProcessing.set(true)

    const userMsg: AiMessage = { role: 'user', content: instruction }
    this.messages.set([...this.messages(), userMsg])

    try {
      const files = this.files()
      const fileContexts = files.map(f => ({
        signature: f.signature,
        name: f.name,
        source: this.stagedChanges().get(f.signature) ?? f.originalSource,
        kind: f.kind,
      }))

      const history: ChatMessage[] = this.messages()
        .filter(m => !m.changes)
        .map(m => ({ role: m.role, content: m.content }))

      const result = await this.#aiService.requestEdit({
        instruction,
        files: fileContexts,
        lineageDescription: this.layerNode().lineage,
        history,
      })

      // apply changes to staged
      if (result.changes.length > 0) {
        const next = new Map(this.stagedChanges())
        for (const change of result.changes) {
          if (files.some(f => f.signature === change.signature)) {
            next.set(change.signature, change.modifiedSource)
          }
        }
        this.stagedChanges.set(next)
      }

      const assistantMsg: AiMessage = {
        role: 'assistant',
        content: result.explanation,
        changes: result.changes.length > 0 ? result.changes : undefined,
      }
      this.messages.set([...this.messages(), assistantMsg])
    } catch (e: unknown) {
      this.aiError.set(e instanceof Error ? e.message : 'AI request failed')
    } finally {
      this.aiProcessing.set(false)
    }
  }

  async onCommit(): Promise<void> {
    if (this.committing() || this.stagedChanges().size === 0) return

    // First click: surface the passphrase prompt so the user can set it (first commit)
    // or enter it (verify). The hash is stored in localStorage via CommitLockService —
    // it never enters the layer tree.
    if (!this.lockPromptVisible()) {
      this.lockPromptVisible.set(true)
      this.commitError.set(null)
      return
    }

    const passphrase = this.lockInput()

    if (this.#lockService.isConfigured()) {
      const valid = await this.#lockService.verify(passphrase)
      if (!valid) {
        this.commitError.set('Invalid passphrase')
        return
      }
    } else if (passphrase) {
      await this.#lockService.configure(passphrase)
    }

    this.committing.set(true)
    this.commitError.set(null)
    this.lockPromptVisible.set(false)
    this.lockInput.set('')

    try {
      const section = this.section()
      const files = this.files()
      const staged = this.stagedChanges()

      const changes = Array.from(staged.entries()).map(([sig, source]) => {
        const file = files.find(f => f.signature === sig)!
        return {
          originalSig: sig,
          kind: file.kind,
          modifiedSource: source,
          lineage: this.layerNode().lineage,
        }
      })

      const result = await this.#patchService.applyBatch({
        changes,
        rootSig: section.rootSig,
        domain: section.domainName,
      })

      this.patchApplied.emit(result)
    } catch (e: unknown) {
      this.commitError.set(e instanceof Error ? e.message : 'Commit failed')
    } finally {
      this.committing.set(false)
    }
  }

  onDiscardChange(signature: string): void {
    const next = new Map(this.stagedChanges())
    next.delete(signature)
    this.stagedChanges.set(next)
  }

  onDiscardAll(): void {
    this.stagedChanges.set(new Map())
  }

  onManualEdit(signature: string, source: string): void {
    const next = new Map(this.stagedChanges())
    next.set(signature, source)
    this.stagedChanges.set(next)
  }

  async #loadFiles(node: TreeNode): Promise<void> {
    this.loading.set(true)
    this.files.set([])
    this.stagedChanges.set(new Map())
    this.messages.set([])
    this.aiError.set(null)
    this.commitError.set(null)

    try {
      await this.#store.initialize()

      // read the layer JSON to find bees and deps
      const domain = this.section().domainName
      const layerJson = await this.#readLayerJson(node.signature!, domain)
      if (!layerJson) {
        this.commitError.set(`Layer JSON not found for ${node.signature!.slice(0, 12)}`)
        this.loading.set(false)
        this.#cdr.markForCheck()
        return
      }

      const loaded: EditableFile[] = []

      // load bees
      for (const raw of layerJson.bees ?? []) {
        const sig = raw.replace(/\.js$/i, '')
        const source = await this.#loadSource(sig, 'bee', domain)
        if (source !== null) {
          const name = node.children.find(c => c.signature === sig)?.name ?? sig.slice(0, 12)
          loaded.push({ signature: sig, name, kind: 'bee', originalSource: source })
        }
      }

      // load dependencies
      for (const raw of layerJson.dependencies ?? []) {
        const sig = raw.replace(/\.js$/i, '')
        const source = await this.#loadSource(sig, 'dependency', domain)
        if (source !== null) {
          const name = node.children.find(c => c.signature === sig)?.name ?? sig.slice(0, 12)
          loaded.push({ signature: sig, name, kind: 'dependency', originalSource: source })
        }
      }

      this.files.set(loaded)
    } catch (e: unknown) {
      this.commitError.set(e instanceof Error ? e.message : 'Failed to load files')
    } finally {
      this.loading.set(false)
      this.#cdr.markForCheck()
    }
  }

  async #loadSource(sig: string, kind: 'bee' | 'dependency', domain: string): Promise<string | null> {
    // check patched files first
    const patchedDir = kind === 'bee'
      ? await this.#store.patchedBeesDir(domain)
      : await this.#store.patchedDepsDir(domain)
    const patchedBytes = await this.#store.readFile(patchedDir, `${sig}.js`)
    if (patchedBytes) {
      return this.#decodeAndStrip(patchedBytes)
    }

    // then originals
    const dir = kind === 'bee' ? this.#store.bees : this.#store.dependencies
    const bytes = await this.#store.readFile(dir, `${sig}.js`)
    if (bytes) {
      return this.#decodeAndStrip(bytes)
    }

    return null
  }

  async #readLayerJson(sig: string, domain: string): Promise<LayerJson | null> {
    // check patched layers first
    const patchedDir = await this.#store.patchedLayersDir(domain)
    let bytes = await this.#store.readFile(patchedDir, sig)
    if (bytes) {
      return JSON.parse(new TextDecoder().decode(bytes)) as LayerJson
    }

    // fall back to original layers
    const domainDir = await this.#store.domainLayersDir(domain)
    bytes = await this.#store.readFile(domainDir, sig)
    if (bytes) {
      return JSON.parse(new TextDecoder().decode(bytes)) as LayerJson
    }

    return null
  }

  #decodeAndStrip(bytes: ArrayBuffer): string {
    const text = new TextDecoder().decode(bytes)
    // strip source map comments
    return text.replace(/\/\/# sourceMappingURL=.*$/m, '').trimEnd()
  }
}

type LayerJson = {
  bees?: string[]
  dependencies?: string[]
  layers?: string[]
  children?: string[]
}
