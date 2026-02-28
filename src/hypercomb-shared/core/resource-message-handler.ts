// src/app/messaging/resource-message-handler.ts
import { Injectable } from '@angular/core'
import { ScriptPreloader, Store } from '@hypercomb/shared/core'

@Injectable({ providedIn: 'root' })
export class ResourceMessageHandler {

  private get store(): Store { return <Store>window.ioc.get("Store") }
  private get preloader(): ScriptPreloader { return <ScriptPreloader>window.ioc.get("ScriptPreloader") }

  // whitelist for allowed postmessage origins
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
  // compiled js → opfs (authoritative store)
  // -------------------------------------------------

  private handleCompiled = async (msg: { code?: string }): Promise<void> => {
    if (!msg.code || typeof msg.code !== 'string') return

    const bytes = new TextEncoder().encode(msg.code).buffer
    const signature = await this.store.put(bytes)

    // single incremental update
    // this.preloader.add(signature, bytes)
    throw new Error('Not implemented')
    console.log('[dcp] compiled action stored', signature)
  }


}
