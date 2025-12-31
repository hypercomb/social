// src/app/home/home.component.ts
import { Component, inject, signal } from '@angular/core'
import { Router } from '@angular/router'
import { DraftPayloadCacheService } from '../core/draft-payload-cache.service'
import { PayloadCanonical } from '../core/payload-canonical'

const DOMAINS_KEY = 'dcp.domains'
const LAST_KEY = 'dcp.lastSignature'

@Component({
  selector: 'app-home',
  standalone: true,
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss']
})
export class HomeComponent {

  // -----------------------------
  // event handlers and state
  // -----------------------------
  protected readonly domains = signal<string[]>(this.loadDomains())
  protected readonly input = signal('')

  protected readonly busy = signal(false)
  protected readonly error = signal<string | null>(null)
  protected readonly lastSignature = signal<string | null>(this.loadLast())

  // -----------------------------
  // private fields
  // -----------------------------
  private readonly router = inject(Router)
  private readonly cache = inject(DraftPayloadCacheService)

  // -----------------------------
  // domains
  // -----------------------------
  protected add = (): void => {
    const raw = this.input().trim()
    if (!raw) return

    try {
      const url = new URL(raw)

      const scope = url.pathname && url.pathname !== '/'
        ? `${url.origin}${url.pathname.replace(/\/+$/, '')}`
        : url.origin

      if (this.domains().includes(scope)) {
        this.input.set('')
        return
      }

      const next = [...this.domains(), scope]
      this.domains.set(next)
      localStorage.setItem(DOMAINS_KEY, JSON.stringify(next))
      this.input.set('')
    } catch {
      // ignore invalid urls
    }
  }

  protected remove = (domain: string): void => {
    const next = this.domains().filter(d => d !== domain)
    this.domains.set(next)
    localStorage.setItem(DOMAINS_KEY, JSON.stringify(next))
  }

  // -----------------------------
  // module creation
  // -----------------------------
  protected createModule = async (): Promise<void> => {
    this.busy.set(true)
    this.error.set(null)

    try {
      const draft = PayloadCanonical.createEmpty()

      draft.source.entry = 'index.ts'
      draft.source.files = {
        'index.ts': btoa(`// empty module\n`)
      }

      const { signature, json } = await PayloadCanonical.signPayload(draft)

      this.cache.set(signature, json)
      this.lastSignature.set(signature)
      localStorage.setItem(LAST_KEY, signature)

      await this.router.navigateByUrl(`/inspect/${signature}`)
    } catch (e: any) {
      this.error.set(e.message ?? 'failed to create module')
    } finally {
      this.busy.set(false)
    }
  }

  // -----------------------------
  // optional dev postmessage test
  // -----------------------------
  protected testPost = (ev: Event): void => {
    ev.preventDefault()
  }

  // -----------------------------
  // storage
  // -----------------------------
  private loadDomains(): string[] {
    try {
      return JSON.parse(localStorage.getItem(DOMAINS_KEY) ?? '[]')
    } catch {
      return []
    }
  }

  private loadLast(): string | null {
    try {
      return localStorage.getItem(LAST_KEY)
    } catch {
      return null
    }
  }
}
