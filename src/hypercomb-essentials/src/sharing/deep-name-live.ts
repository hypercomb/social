// sharing/deep-name-live.ts
//
// DOES A DEEP NAME ANSWER YET (jwize 2026-11-18: "we need the domains for
// development contexts"). A nested place's own name, `hyperdex.knowledge.<zone>`,
// is attached by the host when the place is published, and its certificate
// takes a few minutes to arrive (documentation/deep-names.md). Until it has, the
// name fails in the browser before any page is served — so a link is given the
// name only once one request to it has come back.
//
// The request is opaque (no-cors): it says the name answers, never what it
// said. Whether the place is PUBLISHED there is the signed index's to say, and
// the caller asks that first. The answer is kept in memory for this page only:
// it is a look at the network, not state.
//
// A dependency: it registers nothing and writes nothing.

const RETRY_MS = 60_000
const WAIT_MS = 8_000

const seen = new Map<string, { live: boolean; at: number }>()
const asking = new Map<string, Promise<boolean>>()

/** Has this name answered a request on this page? Never asks. */
export const deepNameLive = (host: string): boolean => seen.get(host)?.live === true

/** Ask the name once. A name that answered stays answered; one that did not is
 *  asked again only after a minute, however many callers ask. */
export function askDeepName(
  host: string,
  deps: { fetch?: typeof fetch; now?: () => number } = {},
): Promise<boolean> {
  const now = deps.now ?? Date.now
  const held = seen.get(host)
  if (held && (held.live || now() - held.at < RETRY_MS)) return Promise.resolve(held.live)
  const running = asking.get(host)
  if (running) return running
  const ask = (async (): Promise<boolean> => {
    const stop = new AbortController()
    const timer = setTimeout(() => stop.abort(), WAIT_MS)
    let live = false
    try {
      await (deps.fetch ?? fetch)(`https://${host}/`, { mode: 'no-cors', cache: 'no-store', credentials: 'omit', signal: stop.signal })
      live = true
    } catch { live = false } finally { clearTimeout(timer) }
    seen.set(host, { live, at: now() })
    asking.delete(host)
    return live
  })()
  asking.set(host, ask)
  return ask
}

/** For specs only. */
export function forgetDeepNamesForTests(): void { seen.clear(); asking.clear() }
