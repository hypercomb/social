// src/app/home/home.component.ts
import { Component, signal } from '@angular/core'
import { Router } from '@angular/router'
import { SignatureService } from '@hypercomb/core'

const STORAGE_KEY = 'dcp.domains'

@Component({
  selector: 'app-home',
  standalone: true,
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss']
})
export class HomeComponent {

  protected readonly domains = signal<string[]>(this.load())
  protected readonly input = signal('')

  // payload signing
  protected readonly payloadName = signal('helloworld') 
  protected readonly payloadSignature = signal<string | null>(null)
  protected readonly error = signal<string | null>(null)
  protected readonly busy = signal(false)

public constructor(private readonly router: Router) {
  // one-time dev test: hash helloworld on load
//   fetch('/payloads/helloworld')
//     .then(r => r.arrayBuffer())
//     .then(async buffer => {
//       const sig = await SignatureService.hash(buffer)
//       console.log('HELLO WORLD HASH:', sig)
//     })
}

  // -----------------------------
  // domain management
  // -----------------------------
  protected add = (): void => {
    const raw = this.input().trim()
    if (!raw) return

    try {
      const url = new URL(raw)
      const origin = url.origin

      if (this.domains().includes(origin)) {
        this.input.set('')
        return
      }

      const next = [...this.domains(), origin]
      this.domains.set(next)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      this.input.set('')
    } catch {
      // ignore invalid URLs
    }
  }

  protected remove = (domain: string): void => {
    const next = this.domains().filter(d => d !== domain)
    this.domains.set(next)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }

  // -----------------------------
  // payload signature (upgraded, non-breaking)
  // -----------------------------
  protected signPayload = async (): Promise<void> => {
    const name = this.payloadName().trim()
    if (!name) return

    this.busy.set(true)
    this.error.set(null)
    this.payloadSignature.set(null)

    try {
      const res = await fetch(`/payloads/${name}`)
      if (!res.ok) throw new Error('payload not found')

      let sig: string

      // try json first, fall back to raw bytes
      try {
        const payload = await res.clone().json()
        sig = await SignatureService.sign(payload)
      } catch {
        const buffer = await res.arrayBuffer()
        sig = await SignatureService.sign(buffer)
      }

      // dev visibility so you can rename the file
      console.log('canonical payload hash:', sig)

      this.payloadSignature.set(sig)
    } catch (e: any) {
      this.error.set(e.message ?? 'failed to sign payload')
    } finally {
      this.busy.set(false)
    }
  }

  protected openViewer = (): void => {
    const sig = this.payloadSignature()
    if (!sig) return
    this.router.navigateByUrl(`/${sig}`)
  }

  // -----------------------------
  // storage
  // -----------------------------
  private load(): string[] {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    } catch {
      return []
    }
  }
}
