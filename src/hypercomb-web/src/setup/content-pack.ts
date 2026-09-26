// hypercomb-web/src/setup/content-pack.ts
//
// THE LANDING VIEW IN ONE REQUEST. A published site's first view is its head
// layer and the few hundred small layers and records a short walk below it —
// fetched one by one, that walk was ~176 round trips and most of a second at
// phone speed, all latency and no work. The door serves them as one transfer
// pack at the member of sign('content:packs') named by the head
// (blossom-worker serveContentPack), a derived record the host builds once
// and keeps.
//
// Nothing here is load-bearing: a host that has no pack, a pack that fails to
// unzip, a member whose bytes do not hash to its name — each simply means that
// sig is fetched loose, as before. Every member is re-hashed against its own
// signature before it is offered, and the content broker hashes it again as
// it stores it (content-broker.boot.drone.ts fetchBySig).
//
// The fetch starts at page load, beside the boot graph, because the door
// record in the page already names the head; the broker's first ask arrives
// about a second later and finds it waiting.

import { decodeTransferPack, gunzipBytes } from '@hypercomb/runtime/transfer-pack'

export const CONTENT_PACKS_MEANING = 'content:packs'

/** A landing pack is small; refuse to inflate past this. */
const INFLATE_LIMIT = 4 * 1024 * 1024
const SIG_RE = /^[a-f0-9]{64}$/

const hex = (buffer: ArrayBuffer): string =>
  [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, '0')).join('')

const sha256 = async (bytes: Uint8Array): Promise<string> =>
  hex(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>))

/** The verified members of the head's landing pack, or an empty map. */
export const fetchContentPack = async (head: string): Promise<Map<string, Uint8Array>> => {
  const carried = new Map<string, Uint8Array>()
  if (!SIG_RE.test(head)) return carried
  try {
    const pool = await sha256(new TextEncoder().encode(CONTENT_PACKS_MEANING))
    const response = await fetch(`/${pool}/${head}`)
    if (!response.ok || (response.headers.get('content-type') || '').includes('text/html')) return carried
    const members = decodeTransferPack(await gunzipBytes(new Uint8Array(await response.arrayBuffer()), INFLATE_LIMIT)) ?? []
    await Promise.all(members.map(async ([sig, bytes]) => {
      if (SIG_RE.test(sig) && await sha256(bytes) === sig) carried.set(sig, bytes)
    }))
  } catch { /* every sig comes loose instead */ }
  return carried
}
