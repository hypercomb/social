// src/app/intent-inspector/intent-inspector-pro.component.ts
import { CommonModule } from '@angular/common'
import { Component, DestroyRef, computed, effect, inject, signal } from '@angular/core'
import { toSignal } from '@angular/core/rxjs-interop'
import { ActivatedRoute } from '@angular/router'
import { Intent, SignatureService } from '@hypercomb/core'
import { map } from 'rxjs'
import { CodeViewerComponent } from '../code-viewer/code-viewer.component'
import { DraftPayloadCacheService } from '../core/draft-payload-cache.service'
import { DraftPayloadV1, PayloadCanonical } from '../core/payload-canonical'
import { Location } from '@angular/common'

type IntentTab = 'description' | 'grammar' | 'links'
type RightTab = 'safety' | 'json'

type IntentSection = {
  id: IntentTab
  label: string
  isEmpty: boolean
}

@Component({
  selector: 'app-intent-inspector-pro',
  standalone: true,
  imports: [CommonModule, CodeViewerComponent],
  templateUrl: './intent-inspector-pro.component.html',
  styleUrls: ['./intent-inspector-pro.component.scss']
})
export class IntentInspectorProComponent {

  // ----------------------------------
  // canonical draft (single source)
  // ----------------------------------
  protected readonly draft = signal<DraftPayloadV1 | null>(null)

  // ----------------------------------
  // derived display state
  // ----------------------------------
  protected readonly intent = computed<Intent | null>(() => this.draft()?.intent ?? null)

  protected readonly code = computed<string>(() => {
    const src = this.draft()?.source
    if (!src?.files || !src.entry) return ''
    return atob(src.files[src.entry] ?? '')
  })

  protected readonly loading = signal(true)
  protected readonly error = signal<string | null>(null)

  // ----------------------------------
  // signature + url behavior
  // ----------------------------------
  protected readonly signature = signal<string>('')
  protected readonly signing = signal(false)

  private readonly destroyRef = inject(DestroyRef)
  private readonly location = inject(Location)
  private readonly route = inject(ActivatedRoute)
  private readonly cache = inject(DraftPayloadCacheService)

  private resignTimer: number | null = null
  private resignSeq = 0

  // ----------------------------------
  // ui state
  // ----------------------------------
  protected readonly intentTab = signal<IntentTab>('description')
  protected readonly rightTab = signal<RightTab>('safety')
  protected readonly signatureCopied = signal(false)

  // ----------------------------------
  // route param (reactive)
  // ----------------------------------
  private readonly hash = toSignal(
    this.route.paramMap.pipe(map(p => p.get('hash'))),
    { initialValue: null }
  )

  // ----------------------------------
  // derived sections
  // ----------------------------------
  protected readonly intentSections = computed<IntentSection[]>(() => {
    const i = this.intent()
    if (!i) return []

    return [
      { id: 'description', label: 'DESCRIPTION', isEmpty: !i.description },
      { id: 'grammar', label: 'GRAMMAR', isEmpty: (i.grammar?.length ?? 0) === 0 },
      { id: 'links', label: 'LINKS', isEmpty: (i.links?.length ?? 0) === 0 }
    ]
  })

  protected readonly grammarText = computed(() => {
    const g = this.intent()?.grammar ?? []
    return g
      .map(x => (x.meaning ? `${x.example} — ${x.meaning}` : x.example))
      .join('\n')
  })

  protected readonly linksText = computed(() => {
    const links = this.intent()?.links ?? []
    return links
      .map(l => {
        const trust = l.trust ? ` | ${l.trust}` : ''
        const label = (l.label ?? '').trim()
        const url = (l.url ?? '').trim()
        if (!label && url) return `${url}${trust}`
        if (label && url) return `${label} | ${url}${trust}`
        return ''
      })
      .filter(Boolean)
      .join('\n')
  })

  protected readonly jsonView = computed(() => {
    const d = this.draft()
    if (!d) return ''

    const payload = structuredClone(d)
    payload.intent.signature = this.signature()

    const exportView = {
      signature: this.signature(),
      payload,
      bytes_base64: '...'
    }

    return JSON.stringify(exportView, null, 2)
  })

  // ----------------------------------
  // lifecycle
  // ----------------------------------
  public constructor() {
    effect(() => {
      const sig = this.hash()
      if (!sig) {
        this.fail('missing payload signature')
        return
      }

      this.loadFromCacheOrRemote(sig)
    })

    this.destroyRef.onDestroy(() => this.clearResignTimer())
  }

  // ----------------------------------
  // cache-first loading (so drafts work without a blob)
  // ----------------------------------
  private loadFromCacheOrRemote = async (signature: string): Promise<void> => {
    try {
      const cached = this.cache.get(signature)
      if (cached) {
        const parsed = JSON.parse(cached) as DraftPayloadV1
        parsed.intent.signature = signature

        this.draft.set(parsed)
        this.signature.set(signature)
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
      const parsed = JSON.parse(canonicalJson) as DraftPayloadV1
      parsed.intent.signature = signature

      this.draft.set(parsed)
      this.signature.set(signature)

      this.cache.set(signature, canonicalJson)
      this.loading.set(false)

    } catch (e: any) {
      this.fail(e.message ?? 'failed to load payload')
    }
  }

  // ----------------------------------
  // authoring actions
  // ----------------------------------
  protected updateIntent = (key: keyof Intent, value: any): void => {
    const d = this.draft()
    if (!d) return

    const next = structuredClone(d)
    ;(next.intent as any)[key] = value

    this.draft.set(next)
    this.scheduleResign()
  }

  protected updateGrammarText = (text: string): void => {
    const d = this.draft()
    if (!d) return

    const lines = text
      .replaceAll('\r\n', '\n')
      .split('\n')
      .map(x => x.trim())
      .filter(Boolean)

    const grammar = lines.map(line => {
      const split = line.split('—')
      if (split.length >= 2) {
        const example = split[0].trim()
        const meaning = split.slice(1).join('—').trim()
        return meaning ? { example, meaning } : { example }
      }

      const splitDash = line.split(' - ')
      if (splitDash.length >= 2) {
        const example = splitDash[0].trim()
        const meaning = splitDash.slice(1).join(' - ').trim()
        return meaning ? { example, meaning } : { example }
      }

      return { example: line }
    })

    const next = structuredClone(d)
    next.intent.grammar = grammar as any

    this.draft.set(next)
    this.scheduleResign()
  }

  protected updateLinksText = (text: string): void => {
    const d = this.draft()
    if (!d) return

    const lines = text
      .replaceAll('\r\n', '\n')
      .split('\n')
      .map(x => x.trim())
      .filter(Boolean)

    const links = lines.map(line => {
      const parts = line.split('|').map(x => x.trim()).filter(Boolean)

      if (parts.length >= 2) {
        const label = parts[0]
        const url = parts[1]
        const trustRaw = (parts[2] ?? '').toLowerCase()
        const trust = trustRaw === 'official' || trustRaw === 'community' ? (trustRaw as any) : undefined
        return trust ? { label, url, trust } : { label, url }
      }

      const tokens = line.split(/\s+/).filter(Boolean)
      const maybeUrl = tokens[tokens.length - 1] ?? ''
      const label = tokens.length > 1 ? tokens.slice(0, -1).join(' ') : maybeUrl
      const url = maybeUrl
      return { label, url }
    })

    const next = structuredClone(d)
    next.intent.links = links as any

    this.draft.set(next)
    this.scheduleResign()
  }

  protected updateCode = (source: string): void => {
    const d = this.draft()
    if (!d) return

    const next = structuredClone(d)

    if (!next.source.entry) {
      next.source.entry = 'index.ts'
    }

    next.source.files[next.source.entry] = btoa(source)

    this.draft.set(next)
    this.scheduleResign()
  }

  // ----------------------------------
  // live signing (debounced) + url replace + cache move
  // ----------------------------------
  private scheduleResign = (): void => {
    this.signing.set(true)
    this.clearResignTimer()

    const seq = ++this.resignSeq
    this.resignTimer = window.setTimeout(async () => {
      if (seq !== this.resignSeq) return
      await this.resignNow()
    }, 250)
  }

  protected forceResignNow = async (): Promise<void> => {
    this.signing.set(true)
    this.clearResignTimer()
    await this.resignNow()
  }

  private resignNow = async (): Promise<void> => {
    const d = this.draft()
    if (!d) return

    const fromSig = this.signature()

    const { signature, canonicalJson } = await PayloadCanonical.compute(d)

    const next = structuredClone(d)
    next.intent.signature = signature
    this.draft.set(next)

    this.cache.move(fromSig, signature, canonicalJson)

    this.signature.set(signature)
    this.location.replaceState(this.currentInspectorPath(signature))

    this.signing.set(false)
  }

  private currentInspectorPath(signature: string): string {
    const isInspect = (this.route.snapshot.routeConfig?.path ?? '').startsWith('inspect')
    return isInspect ? `/inspect/${signature}` : `/${signature}`
  }

  private clearResignTimer = (): void => {
    if (this.resignTimer !== null) {
      window.clearTimeout(this.resignTimer)
      this.resignTimer = null
    }
  }

  // ----------------------------------
  // ui helpers
  // ----------------------------------
  protected setIntentTab = (value: IntentTab): void => {
    this.intentTab.set(value)
  }

  protected setRightTab = (value: RightTab): void => {
    this.rightTab.set(value)
  }

  protected copySignature = async (): Promise<void> => {
    const sig = this.signature()
    await navigator.clipboard.writeText(sig)
    this.signatureCopied.set(true)
    setTimeout(() => this.signatureCopied.set(false), 900)
  }

  protected cancel = (): void => {
    history.back()
  }

  private fail(msg: string): void {
    this.error.set(msg)
    this.loading.set(false)
  }
}
