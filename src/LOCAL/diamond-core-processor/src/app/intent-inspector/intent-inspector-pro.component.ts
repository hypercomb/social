// src/app/intent-inspector/intent-inspector-pro.component.ts
import { CommonModule } from '@angular/common'
import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal
} from '@angular/core'
import { ActivatedRoute } from '@angular/router'
import { Intent, SignatureService } from '@hypercomb/core'
import { CodeViewerComponent } from '../code-viewer/code-viewer.component'

type IntentTab = 'description' | 'grammar' | 'links'

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

  // -----------------------------
  // core loaded state
  // -----------------------------
  protected readonly intent = signal<Intent | null>(null)
  protected readonly code = signal<string>('')

  protected readonly loading = signal(true)
  protected readonly error = signal<string | null>(null)

  // -----------------------------
  // UI state
  // -----------------------------
  protected readonly intentTab = signal<IntentTab>('description')
  protected readonly confirmStage = signal<0 | 1>(0)
  protected readonly confirmCountdown = signal(0)
  protected readonly signatureCopied = signal(false)

  private readonly route = inject(ActivatedRoute)
  private readonly destroyRef = inject(DestroyRef)

  private confirmIntervalId: number | null = null

  // -----------------------------
  // derived sections
  // -----------------------------
  protected readonly intentSections = computed<IntentSection[]>(() => {
    const i = this.intent()
    if (!i) return []

    return [
      { id: 'description', label: 'DESCRIPTION', isEmpty: !i.description },
      { id: 'grammar', label: 'GRAMMAR', isEmpty: (i.grammar?.length ?? 0) === 0 },
      { id: 'links', label: 'LINKS', isEmpty: (i.links?.length ?? 0) === 0 }
    ]
  })

  protected readonly primaryLabel = computed(() => {
    if (this.confirmStage() === 0) return 'ARM CONFIRM'
    const s = this.confirmCountdown()
    return s > 0 ? `CONFIRM (${s}s)` : 'CONFIRM'
  })

  // -----------------------------
  // lifecycle
  // -----------------------------
  public constructor() {
    effect(() => {
      const sig = this.route.snapshot.paramMap.get('hash')
      if (!sig) {
        this.fail('missing payload signature')
        return
      }

      this.loadPayload(sig)
    })

    this.destroyRef.onDestroy(() => this.clearConfirmTimer())
  }

 
  // -----------------------------
  // payload loading (BYTE-EXACT)
  // -----------------------------
private async loadPayload(signature: string): Promise<void> {
  try {
    const url = `https://storagehypercomb.blob.core.windows.net/hypercomb-data/${signature}`

    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) {
      throw new Error(`payload not found (${res.status})`)
    }

    const bytes = await res.arrayBuffer()


    const view = new Uint8Array(bytes)
    const headAscii = new TextDecoder().decode(view.slice(0, 64))
    console.log('received head ascii:', JSON.stringify(headAscii))
    console.log('content-type:', res.headers.get('content-type'))

    const actual = await SignatureService.sign(bytes)
    console.log('expected signature:', signature)
    console.log('actual signature:', actual)

    if (actual !== signature) {
      throw new Error('payload signature mismatch')
    }

    const text = new TextDecoder().decode(bytes)

    const payload = JSON.parse(text.trim())

    this.intent.set(payload.intent)
    this.code.set(this.decodeSource(payload.source))
    this.intentTab.set('description')
    this.loading.set(false)

  } catch (e: any) {
    this.fail(e.message ?? 'failed to load payload')
  }
}


  // -----------------------------
  // source decode
  // -----------------------------
  private decodeSource(source: any): string {
    if (!source?.files || !source.entry) return ''
    const encoded = source.files[source.entry]
    if (!encoded) return ''
    return atob(encoded)
  }

  // -----------------------------
  // UI actions (unchanged)
  // -----------------------------
  protected setIntentTab = (value: IntentTab): void => {
    this.intentTab.set(value)
  }

  protected primary = (): void => {
    if (this.confirmStage() === 0) {
      this.armConfirm()
      return
    }

    this.confirm()
    this.disarmConfirm()
  }

  protected armConfirm = (): void => {
    this.confirmStage.set(1)
    this.confirmCountdown.set(8)
    this.clearConfirmTimer()

    this.confirmIntervalId = window.setInterval(() => {
      const next = this.confirmCountdown() - 1
      this.confirmCountdown.set(next)
      if (next <= 0) this.disarmConfirm()
    }, 1000)
  }

  protected disarmConfirm = (): void => {
    this.confirmStage.set(0)
    this.confirmCountdown.set(0)
    this.clearConfirmTimer()
  }

  private clearConfirmTimer = (): void => {
    if (this.confirmIntervalId !== null) {
      window.clearInterval(this.confirmIntervalId)
      this.confirmIntervalId = null
    }
  }

  protected copySignature = async (): Promise<void> => {
    const text = this.intent()?.signature ?? ''
    await navigator.clipboard.writeText(text)
    this.signatureCopied.set(true)
    setTimeout(() => this.signatureCopied.set(false), 900)
  }

  protected confirm = (): void => {
    // handled by hypercomb host
  }

  protected cancel = (): void => {
    // handled by hypercomb host
  }

  private fail(msg: string): void {
    this.error.set(msg)
    this.loading.set(false)
  }
}
