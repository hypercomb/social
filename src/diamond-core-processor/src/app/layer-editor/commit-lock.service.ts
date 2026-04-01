// diamond-core-processor/src/app/layer-editor/commit-lock.service.ts

import { Injectable } from '@angular/core'

const STORAGE_KEY = 'dcp.commit-lock-hash'

@Injectable({ providedIn: 'root' })
export class CommitLockService {

  isConfigured(): boolean {
    return localStorage.getItem(STORAGE_KEY) !== null
  }

  async configure(passphrase: string): Promise<void> {
    const hash = await this.#hash(passphrase)
    localStorage.setItem(STORAGE_KEY, hash)
  }

  async verify(passphrase: string): Promise<boolean> {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) return true // not configured = always passes
    const hash = await this.#hash(passphrase)
    return hash === stored
  }

  clear(): void {
    localStorage.removeItem(STORAGE_KEY)
  }

  async #hash(passphrase: string): Promise<string> {
    const bytes = new TextEncoder().encode(passphrase)
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    return Array.from(new Uint8Array(digest))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
  }
}
