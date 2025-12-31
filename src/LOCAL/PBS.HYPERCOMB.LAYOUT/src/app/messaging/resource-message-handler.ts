// src/app/messaging/resource-message-handler.ts
import { Injectable } from '@angular/core'
import { SignatureService } from '@hypercomb/core'

@Injectable({ providedIn: 'root' })
export class ResourceMessageHandler {
  private expectedSignature?: string

  // whitelist for allowed postMessage origins
  private readonly allowedOrigins = new Set<string>([
    window.origin,
    'http://localhost:2400',
    // 'https://dcp.hypercomb.io', // add production origin here if needed
  ])

  constructor() {
    console.log('window href:', window.location.href)
    window.addEventListener('message', this.handle)
  }

  public destroy(): void {
    window.removeEventListener('message', this.handle)
  }

  // -----------------------------------------------------------------
  // main dcp-scoped message handler
  // -----------------------------------------------------------------
  public handle = async (event: MessageEvent): Promise<void> => {
    // origin check
    if (!this.allowedOrigins.has(event.origin)) return

    const data = event.data
    if (!data || typeof data !== 'object') return

    // only accept explicit dcp messages
    if ((data as any).scope !== 'dcp') return

    const { type } = data as any
    switch (type) {
      case 'resource.signature':
        this.handleSignature(data as { signature?: string })
        break

      case 'resource.bytes':
        await this.handleBytes(data as { bytes?: ArrayBuffer; signature?: string })
        break

      default:
        console.warn('unknown dcp message type:', type)
        break
    }
  }

  // -----------------------------------------------------------------
  // preload expected signature (optional)
  // -----------------------------------------------------------------
  private handleSignature = (msg: { signature?: string }): void => {
    if (!msg.signature || typeof msg.signature !== 'string') {
      throw new Error('invalid resource signature')
    }
    this.expectedSignature = msg.signature
  }

  // -----------------------------------------------------------------
  // verify + persist bytes
  // -----------------------------------------------------------------
  private handleBytes = async (msg: {
    bytes?: ArrayBuffer
    signature?: string
  }): Promise<void> => {
    if (!(msg.bytes instanceof ArrayBuffer)) {
      throw new Error('missing bytes')
    }

    if (!msg.signature) {
      throw new Error('missing signature on bytes message')
    }

    const bytes = msg.bytes

    // recompute signature from bytes
    const computedSignature = await SignatureService.sign(bytes)

    // 1) ensure the provided signature matches the bytes
    if (msg.signature !== computedSignature) {
      throw new Error('signature does not match signed bytes')
    }

    const root = await navigator.storage.getDirectory()
    const resources = await root.getDirectoryHandle('resources', { create: true })

    // dedupe: if a file with this signature already exists, we’re done
    try {
      await resources.getFileHandle(computedSignature)
      return
    } catch {
      // not found — continue
    }

    const handle = await resources.getFileHandle(computedSignature, { create: true })
    const writable = await handle.createWritable()
    await writable.write(bytes)
    await writable.close()

    this.expectedSignature = undefined
  }
}
