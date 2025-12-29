// src/app/intent-inspector/intent-inspector-pro.component.ts
import { CommonModule } from '@angular/common'
import { Component, DestroyRef, computed, effect, inject, input, signal } from '@angular/core'
import { Intent } from '@hypercomb/core'
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

  public readonly intent = input.required<Intent>()
  public readonly code = input.required<string>()

  protected readonly intentTab = signal<IntentTab>('description')

  protected readonly intentSections = computed<IntentSection[]>(() => {
    const i = this.intent()

    return [
      {
        id: 'description',
        label: 'DESCRIPTION',
        isEmpty: !i.description
      },
      {
        id: 'grammar',
        label: 'GRAMMAR',
        isEmpty: (i.grammar?.length ?? 0) === 0
      },
      {
        id: 'links',
        label: 'LINKS',
        isEmpty: (i.links?.length ?? 0) === 0
      }
    ]
  })

  protected readonly confirmStage = signal<0 | 1>(0)
  protected readonly confirmCountdown = signal(0)

  protected readonly signatureCopied = signal(false)

  private readonly destroyRef = inject(DestroyRef)
  private confirmIntervalId: number | null = null

  protected readonly primaryLabel = computed(() => {
    if (this.confirmStage() === 0) return 'ARM CONFIRM'
    const s = this.confirmCountdown()
    return s > 0 ? `CONFIRM (${s}s)` : 'CONFIRM'
  })

  public constructor() {
    // reset to description when a new intent payload arrives
    effect(() => {
      this.intent()
      this.intentTab.set('description')
    })

    this.destroyRef.onDestroy(() => this.clearConfirmTimer())
  }

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

      if (next <= 0) {
        this.disarmConfirm()
      }
    }, 1000)
  }

  protected disarmConfirm = (): void => {
    this.confirmStage.set(0)
    this.confirmCountdown.set(0)
    this.clearConfirmTimer()
  }

  private clearConfirmTimer = (): void => {
    if (this.confirmIntervalId === null) return
    window.clearInterval(this.confirmIntervalId)
    this.confirmIntervalId = null
  }

  protected copySignature = async (): Promise<void> => {
    const text = this.intent().signature ?? ''

    try {
      await navigator.clipboard.writeText(text)
      this.signatureCopied.set(true)
      window.setTimeout(() => this.signatureCopied.set(false), 900)
    } catch {
      const el = document.createElement('textarea')
      el.value = text
      el.setAttribute('readonly', 'true')
      el.style.position = 'fixed'
      el.style.left = '-9999px'
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)

      this.signatureCopied.set(true)
      window.setTimeout(() => this.signatureCopied.set(false), 900)
    }
  }

  protected confirm = (): void => {
    // handled by hypercomb host
  }

  protected cancel = (): void => {
    // handled by hypercomb host
  }
}
