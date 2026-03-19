// diamond-core-processor/src/app/intent-inspector/intent-inspector-pro.component.ts

import { CommonModule } from '@angular/common'
import { Component, computed, inject, signal } from '@angular/core'
import { ActivatedRoute } from '@angular/router'
import { SignatureService, type BeePayloadV1, type Effect } from '@hypercomb/core'
import { CodeViewerComponent } from '../code-viewer/code-viewer.component'
import { DraftPayloadCacheService } from '../core/draft-payload-cache.service'
import { compilePayload } from '../core/compile-payload'

@Component({
  selector: 'app-intent-inspector-pro',
  standalone: true,
  imports: [CommonModule, CodeViewerComponent],
  templateUrl: './intent-inspector-pro.component.html',
  styleUrls: ['./intent-inspector-pro.component.scss']
})
export class IntentInspectorProComponent {

  // ----------------------------------
  // canonical payload (single source)
  // ----------------------------------

  protected readonly draft = signal<BeePayloadV1 | null>(null)
  protected readonly canonicalJson = signal<string>('')

  // ----------------------------------
  // derived display state
  // ----------------------------------

  protected readonly action = computed(() => this.draft()?.bee ?? null)

  protected readonly name = computed((): string =>
    this.action()?.name ?? 'Untitled Bee'
  )

  protected readonly effects = computed((): Effect[] => {
    const action = this.action()
    if (!action) return []
    return this.getEffects(action)
  })

  protected readonly classSource = computed((): string => {
    const d = this.draft()
    if (!d) return ''

    const entry = (d.source?.entry ?? '').trim()
    if (!entry) return ''

    const raw = d.source?.files?.[entry] ?? ''
    return raw ? atob(raw) : ''
  })

  protected readonly loading = signal(true)
  protected readonly error = signal<string | null>(null)

  // ----------------------------------
  // signature + confirm behavior
  // ----------------------------------

  protected readonly signature = signal<string>('')

  // ----------------------------------
  // private fields
  // ----------------------------------

  private readonly route = inject(ActivatedRoute)
  private readonly cache = inject(DraftPayloadCacheService)

  // ----------------------------------
  // lifecycle
  // ----------------------------------

  public constructor() {
    const sig = (this.route.snapshot.paramMap.get('hash') ?? '').trim()
    if (!sig) {
      this.fail('missing payload signature')
      return
    }

    void this.loadFromCacheOrRemote(sig)
  }

  // ----------------------------------
  // cache-first loading
  // ----------------------------------

  private loadFromCacheOrRemote = async (signature: string): Promise<void> => {
    try {
      this.loading.set(true)
      this.error.set(null)

      const cached = this.cache.get(signature)
      if (cached) {
        const parsed = JSON.parse(cached) as BeePayloadV1
        this.applyLoadedPayload(signature, parsed, cached)
        this.loading.set(false)
        return
      }

      const url = `https://storagehypercomb.blob.core.windows.net/hypercomb-data/${signature}`
      const res = await fetch(url, { cache: 'no-store' })
      if (!res.ok) throw new Error(`payload not found (${res.status})`)

      const bytes = await res.arrayBuffer()
      const actual = await SignatureService.sign(bytes)
      if (actual !== signature) throw new Error('payload signature mismatch')

      const canonicalJson = new TextDecoder().decode(bytes).trim()
      const parsed = JSON.parse(canonicalJson) as BeePayloadV1

      this.cache.set(signature, canonicalJson)
      this.applyLoadedPayload(signature, parsed, canonicalJson)

      this.loading.set(false)
    } catch (e: any) {
      this.fail(e?.message ?? 'failed to load payload')
    }
  }

  private applyLoadedPayload = (
    signature: string,
    payload: BeePayloadV1,
    canonicalJson: string
  ): void => {
    this.signature.set(signature)
    this.canonicalJson.set(canonicalJson)
    this.draft.set(payload)
  }

  // ----------------------------------
  // confirm + close
  // ----------------------------------

  protected readonly canConfirm = computed((): boolean => {
    return !!this.signature() && !!this.action() && !this.loading() && !this.error()
  })

  protected confirm = async (): Promise<void> => {
    const payload = this.draft()
    if (!payload) return

    try {
      const compiled = await compilePayload(payload)

      // send compiled code for storage
      window.parent.postMessage(
        {
          scope: 'dcp',
          type: 'compiled.code',
          code: compiled
        },
        'http://localhost:4200'
      )

      // tell the portal overlay to close
      window.parent.postMessage(
        {
          type: 'dcp:confirm'
        },
        'http://localhost:4200'
      )

    } catch (e: any) {
      this.error.set(e?.message ?? 'compile failed')
    }
  }

  protected done = (): void => {
    history.back()
  }

  private fail = (msg: string): void => {
    this.error.set(msg)
    this.loading.set(false)
  }

  private getEffects = (action: BeePayloadV1['bee']): Effect[] => {
    const a: any = action as any
    const effects = (a?.effects ?? a?.effect ?? []) as Effect[]
    return Array.isArray(effects) ? effects : []
  }
}
