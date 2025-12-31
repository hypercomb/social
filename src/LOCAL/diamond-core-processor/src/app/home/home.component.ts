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
    // fetch('/payloads/helloworld')
    //   .then(r => r.arrayBuffer())
    //   .then(async buffer => {
    //     const sig = await SignatureService.hash(buffer)
    //     console.log('HELLO WORLD HASH:', sig)
    //   })
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
      // ignore invalid urls
    }
  }

  protected remove = (domain: string): void => {
    const next = this.domains().filter(d => d !== domain)
    this.domains.set(next)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }

  // -----------------------------
  // helper: resolve payload url
  // -----------------------------
  private resolvePayloadUrl(name: string): string {
    const trimmed = name.trim()
    if (!trimmed) return ''

    // if it looks like a full url, use as-is
    if (/^https?:\/\//i.test(trimmed)) {
      return trimmed
    }

    // otherwise use local payload route
    return `/payloads/${trimmed}`
  }

  // -----------------------------
  // payload signature (upgraded, non-breaking)
  // -----------------------------
  protected signPayload = async (): Promise<void> => {
    const name = this.payloadName().trim()
    if (!name) return

    const url = this.resolvePayloadUrl(name)
    if (!url) return

    this.busy.set(true)
    this.error.set(null)
    this.payloadSignature.set(null)

    try {
      const res = await fetch(url)
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

    // -----------------------------
  // test postMessage (end-to-end)
  // -----------------------------
  protected testPost = async (ev: Event): Promise<void> => {
    console.log('window href:', window.location.href)
    debugger
    ev.preventDefault()
    this.busy.set(true)
    this.error.set(null)
    this.payloadSignature.set(null)

    try {
      const name = this.payloadName().trim()
      if (!name) throw new Error('no payload name')

      // HARD-CODED TEST FETCH
      const res = await fetch(
        'https://storagehypercomb.blob.core.windows.net/hypercomb-data/44bebabbbcc7b042606d8c1409977f1bafb5eecc0afcdbd13b0a6024a0b3232c'
      )
      if (!res.ok) throw new Error('payload not found')

      // raw bytes for the payload
      const bytes = await res.arrayBuffer()

      // optional: compute signature locally for visibility / routing
      const sig = await SignatureService.sign(bytes)
      this.payloadSignature.set(sig)

      // post raw bytes; arraybuffer is structured clonable
      const message = {
        scope: 'dcp',          // <-- dcp marker
        type: 'resource.bytes',
        name,
        signature: sig,
        bytes
      }

      // third arg transfers ownership of the buffer (no copy, more efficient)
      window.parent.postMessage(message, 'http://localhost:4200', [bytes])

      console.log('postMessage sent, signature:', sig)
    } catch (e: any) {
      this.error.set(e.message ?? 'postMessage test failed')
    } finally {
      this.busy.set(false)
    }
  }

}
