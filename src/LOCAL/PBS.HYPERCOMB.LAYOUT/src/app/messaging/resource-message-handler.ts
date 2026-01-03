import { Injectable, inject } from '@angular/core'
import { OpfsStore } from '../core/opfs.store'

@Injectable({ providedIn: 'root' })
export class ResourceMessageHandler {

  private readonly opfs = inject(OpfsStore)

  // whitelist for allowed postMessage origins
  private readonly allowedOrigins = new Set<string>([
    window.origin,
    'http://localhost:2400',
    // 'https://dcp.hypercomb.io',
  ])

  constructor() {
    console.log('window href:', window.location.href)
    window.addEventListener('message', this.handle)
  }

  public destroy(): void {
    window.removeEventListener('message', this.handle)
  }

  // -------------------------------------------------
  // main dcp-scoped message handler
  // -------------------------------------------------
  public handle = async (event: MessageEvent): Promise<void> => {
    if (!this.allowedOrigins.has(event.origin)) return

    const data = event.data
    if (!data || typeof data !== 'object') return
    if ((data as any).scope !== 'dcp') return

    if ((data as any).type !== 'compiled.code') return

    await this.handleCompiled(data as { code?: string })
  }
  // -------------------------------------------------
  // compiled JS → OPFS (authoritative store)
  // -------------------------------------------------
  private handleCompiled = async (msg: {
    code?: string
  }): Promise<void> => {
    if (!msg.code || typeof msg.code !== 'string') return

    // convert compiled JS string → bytes
    const bytes = new TextEncoder().encode(msg.code).buffer

    // OPFS owns signing, dedupe, persistence
    const signature = await this.opfs.store(bytes)

    console.log('[dcp] compiled action stored', signature)
  }

}
