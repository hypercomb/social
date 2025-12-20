// src/app/core/intent/signature.registry.ts

import { Injectable } from '@angular/core'

export type SignatureKind =
  | 'cell'
  | 'text'
  | 'image'
  | 'link'
  | 'container'
  | 'executable'

export interface SignatureMatch {
  kind: SignatureKind
  exact: boolean
}

@Injectable({ providedIn: 'root' })
export class SignatureRegistry {

  // canonical signatures (single source of truth)
  private readonly signatures: SignatureKind[] = [
    'cell',
    'text',
    'image',
    'link',
    'container',
    'executable'
  ]

  public match = (token?: string): SignatureMatch | null => {
    if (!token) return null

    const value = token.trim().toLowerCase()
    if (!value) return null

    // exact match
    if (this.signatures.includes(value as SignatureKind)) {
      return { kind: value as SignatureKind, exact: true }
    }

    // prefix / partial match
    const partial = this.signatures.find(s => s.startsWith(value))
    if (partial) {
      return { kind: partial, exact: false }
    }

    return null
  }
}
