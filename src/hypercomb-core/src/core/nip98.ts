// core/nip98.ts
//
// THE NIP-98 ENVELOPE a host asks of every write: a kind-27235 event that binds
// the method and the url (and, with `payload`, the sha256 of the exact body),
// signed by the writer and sent base64'd as `Authorization: Nostr …`. Core signs
// nothing (it carries no secp256k1): it shapes the event and wraps what a signer
// handed back. The hive (essentials hive-pointer.ts) and a front door that holds
// a place's key (the shim's device-owner.ts) both send it.
//
// `extraTags` ride after: `['anchor', <key>]` says the request acts AS that
// anchor, which a host honours only when the anchor's key list there names the
// signer (key-list.ts; becoming-a-host.md).

export const NIP98_KIND = 27235

export type Nip98Template = { kind: number; created_at: number; tags: string[][]; content: string }

/** The event to sign. `at` is seconds-epoch. */
export const nip98Template = (url: string, method: string, at: number, payload?: string, extraTags: readonly string[][] = []): Nip98Template => ({
  kind: NIP98_KIND,
  created_at: Math.floor(at),
  tags: [['u', url], ['method', method], ...(payload ? [['payload', payload]] : []), ...extraTags.map(tag => [...tag])],
  content: '',
})

/** The header value for a signed envelope. */
export const nip98Authorization = (signed: unknown): string =>
  'Nostr ' + btoa(unescape(encodeURIComponent(JSON.stringify(signed))))
