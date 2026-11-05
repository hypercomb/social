// hypercomb-shim/src/bootstrap/minimized.ts
//
// IS A REVISION OPTIMIZED AND MINIMIZED? (jwize 2026-11-04: "only when it is optimized and minimized can it be in the
// showcase"). A minified revision leaves one of two marks on the host that serves it (documentation/derivations.md):
//   - its own root layer names `derivedFrom`: the head IS a derived root; or
//   - a derivation record is a member of the pool `derived:<head>`, which a live host lists as a newline file at
//     `/<sign('derived:<head>')>`.
// Either is enough. Anything else — a host that does not answer, a head with no record — is "not yet", and a "not yet"
// is asked again the next time, so a revision minified a moment ago is believed as soon as it is.

import { SignatureService, derivedMeaning } from '@hypercomb/core'
import { zoneOrigin } from './showcase-record'

const SIG = /^[0-9a-f]{64}$/
const LIMIT = 262_144

const text = async (url: string): Promise<string | null> => {
  try {
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(8_000) })
    if (!response.ok) return null
    const body = await response.text()
    return body.length <= LIMIT ? body : null
  } catch { return null }
}

const ask = async (zone: string, head: string): Promise<boolean> => {
  const sig = head.trim().toLowerCase()
  if (!SIG.test(sig)) return false
  const origin = zoneOrigin(zone)
  // 1. The head is itself a minified root.
  const layer = await text(`${origin}/${sig}`)
  if (layer) {
    try {
      const from = (JSON.parse(layer) as { derivedFrom?: unknown } | null)?.derivedFrom
      if (typeof from === 'string' && SIG.test(from)) return true
    } catch { /* not a layer: the pool is the other way to know */ }
  }
  // 2. A derivation record is a member of the pool derived:<head>.
  const meaning = derivedMeaning(sig)
  if (!meaning) return false
  const pool = await SignatureService.sign(new TextEncoder().encode(meaning).buffer as ArrayBuffer)
  const listing = await text(`${origin}/${pool}`)
  return !!listing && listing.split(/\s+/).some(line => SIG.test(line.trim().toLowerCase()))
}

const known = new Map<string, Promise<boolean>>()

/** Whether `head`, as served by `zone`, has been optimized and minimized. Only a yes is remembered. */
export const readMinimized = (zone: string, head: string): Promise<boolean> => {
  const key = `${zone}\n${head}`
  const found = known.get(key)
  if (found) return found
  const asked = ask(zone, head).catch(() => false)
  known.set(key, asked)
  void asked.then(yes => { if (!yes && known.get(key) === asked) known.delete(key) })
  return asked
}
