// hypercomb-essentials/src/diamondcoreprocessor.com/nostr/nostr-signer.ts
// production signer: nip-07 delegator
// - registers 'NostrSigner' for NostrMeshDrone.trySign(...)
// - does not ship any private keys
// - if nip-07 isn't present, signing is unavailable

type NostrEvent = { id?: string; pubkey?: string; created_at: number; kind: number; tags: string[][]; content: string; sig?: string }

export class NostrSigner {

  public signEvent = async (evt: NostrEvent): Promise<NostrEvent> => {
    // already signed
    if (evt?.id && evt?.pubkey && evt?.sig) return evt

    const anyWin = window as any
    if (!anyWin?.nostr?.signEvent) throw new Error('nostr signer: nip-07 not available (window.nostr.signEvent missing)')

    const signed = await anyWin.nostr.signEvent(evt)
    if (!signed) throw new Error('nostr signer: nip-07 returned empty result')

    return signed as NostrEvent
  }
}

window.ioc.register('NostrSigner', new NostrSigner())