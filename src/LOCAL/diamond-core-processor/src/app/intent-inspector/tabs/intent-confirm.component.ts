// src/app/intent-inspector/tabs/intent-confirm.component.ts
import { Component, input, signal } from '@angular/core'
import { Intent } from '@hypercomb/core'

@Component({
  selector: 'hc-intent-confirm',
  standalone: true,
  styleUrls: ['./intent-shared.scss'],
  templateUrl: './intent-confirm.component.html'
})
export class IntentConfirmComponent {

  public readonly intent = input.required<Intent>()
  public readonly code = input.required<string>()

  protected readonly vetEndpoint = signal('')
  protected readonly vetApiKey = signal('')
  protected readonly vetResult = signal<string | null>(null)
  protected readonly isVetting = signal(false)

  protected setVetEndpoint = (value: string): void => {
    this.vetEndpoint.set(value)
  }

  protected setVetApiKey = (value: string): void => {
    this.vetApiKey.set(value)
  }

  protected runVetCheck = async (): Promise<void> => {
    const endpoint = this.vetEndpoint().trim()
    this.vetResult.set(null)

    if (!endpoint) {
      this.vetResult.set('no endpoint provided.')
      return
    }

    this.isVetting.set(true)

    try {
      const headers: Record<string, string> = { 'content-type': 'application/json' }

      const key = this.vetApiKey().trim()
      if (key) headers['authorization'] = `Bearer ${key}`

      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ intent: this.intent(), code: this.code() })
      })

      const text = await res.text()
      this.vetResult.set(`status: ${res.status}\n\n${text}`)
    } catch (err: any) {
      this.vetResult.set(`vetting failed: ${err?.message ?? String(err)}`)
    } finally {
      this.isVetting.set(false)
    }
  }
}
