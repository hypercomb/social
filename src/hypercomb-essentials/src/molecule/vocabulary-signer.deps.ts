// molecule/vocabulary-signer.deps.ts
//
// The one IoC lookup the vocabulary feature makes, kept in its own file so a
// spec can import the signer without a container. Nothing here holds state.

import { get } from '@hypercomb/core'

/** The ONE identity (sharing/nostr-signer.ts). */
export const NOSTR_SIGNER_KEY = '@diamondcoreprocessor.com/NostrSigner'

export interface NostrSignerLike {
  signEvent: (evt: {
    kind: number
    created_at: number
    tags: string[][]
    content: string
  }) => Promise<Record<string, unknown>>
  getPublicKeyHex?: () => Promise<string | null>
}

export const nostrSigner = (): NostrSignerLike | undefined => {
  try { return get(NOSTR_SIGNER_KEY) as NostrSignerLike | undefined } catch { return undefined }
}
