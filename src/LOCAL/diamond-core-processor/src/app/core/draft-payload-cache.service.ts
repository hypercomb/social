// src/app/core/draft-payload-cache.service.ts

import { Injectable } from '@angular/core'

const PREFIX = 'dcp.draft.'
const INDEX_KEY = 'dcp.draft.index'

@Injectable({ providedIn: 'root' })
export class DraftPayloadCacheService {

  public has = (signature: string): boolean => {
    return !!sessionStorage.getItem(this.key(signature))
  }

  public get = (signature: string): string | null => {
    return sessionStorage.getItem(this.key(signature))
  }

  public set = (signature: string, json: string): void => {
    sessionStorage.setItem(this.key(signature), json)

    // keep a tiny index so you can later show “recent drafts”
    const index = this.loadIndex()
    if (!index.includes(signature)) {
      index.unshift(signature)
      sessionStorage.setItem(INDEX_KEY, JSON.stringify(index.slice(0, 25)))
    }
  }

  public move = (fromSignature: string, toSignature: string, json: string): void => {
    if (fromSignature !== toSignature) {
      sessionStorage.removeItem(this.key(fromSignature))
    }
    this.set(toSignature, json)
  }

  public remove = (signature: string): void => {
    sessionStorage.removeItem(this.key(signature))

    const index = this.loadIndex().filter(s => s !== signature)
    sessionStorage.setItem(INDEX_KEY, JSON.stringify(index))
  }

  private key(signature: string): string {
    return `${PREFIX}${signature}`
  }

  private loadIndex(): string[] {
    try {
      return JSON.parse(sessionStorage.getItem(INDEX_KEY) ?? '[]')
    } catch {
      return []
    }
  }
}
