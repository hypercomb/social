// hypercomb-essentials/src/diamondcoreprocessor.com/nostr/nostr-signer.ts
// signer: nip-07 first, fallback to dev private key for public relay tests
// - registers 'NostrSigner' for NostrMeshDrone.trySign(...)
// - fallback key source order:
//   1) window.NOSTR_SECRET_KEY
//   2) localStorage['hc:nostr:secret-key']
//   3) built-in dev test key

import { finalizeEvent, getPublicKey } from 'nostr-tools'

type NostrEvent = { id?: string; pubkey?: string; created_at: number; kind: number; tags: string[][]; content: string; sig?: string }
const FALLBACK_DEV_SECRET_KEY = 'e9f4f1f67f38a46b71122b81e821fa1ca797c9cf50ae6a36042b4de9e94807b3'

export class NostrSigner {

  public signEvent = async (evt: NostrEvent): Promise<NostrEvent> => {
    // already signed
    if (evt?.id && evt?.pubkey && evt?.sig) return evt

    const anyWin = window as any

    if (anyWin?.nostr?.signEvent) {
      const signed = await anyWin.nostr.signEvent(evt)
      if (!signed) throw new Error('nostr signer: nip-07 returned empty result')

      return signed as NostrEvent
    }

    const secretHex = this.resolveSecretKeyHex()
    if (!secretHex) throw new Error('nostr signer: no signer available (nip-07 missing and no fallback key configured)')

    const sk = this.hexToBytes(secretHex)
    const signed = finalizeEvent(evt as any, sk as any) as NostrEvent

    if (!signed.pubkey) {
      signed.pubkey = getPublicKey(sk as any)
    }

    if (!signed.id || !signed.sig) throw new Error('nostr signer: fallback signing failed')

    return signed
  }

  private resolveSecretKeyHex = (): string => {
    const anyWin = window as any

    const fromWindow = String(anyWin?.NOSTR_SECRET_KEY ?? '').trim().toLowerCase()
    if (this.isHex64(fromWindow)) return fromWindow

    try {
      const fromStorage = String(localStorage.getItem('hc:nostr:secret-key') ?? '').trim().toLowerCase()
      if (this.isHex64(fromStorage)) return fromStorage
    } catch {
      // ignore
    }

    return FALLBACK_DEV_SECRET_KEY
  }

  private isHex64 = (value: string): boolean => /^[0-9a-f]{64}$/.test(value)

  private hexToBytes = (hex: string): Uint8Array => {
    const out = new Uint8Array(32)
    for (let i = 0; i < 32; i++) {
      out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
    }
    return out
  }
}

window.ioc.register('@diamondcoreprocessor.com/NostrSigner', new NostrSigner(), 'NostrSigner')