// chat-versions.ts
//
// A version the chat can point at. A resource's version is its signature.
// A trial's version is the origin a write named. Deploy opens that address.

export interface ChatVersion {
  readonly href: string
  readonly label: string
}

const TRIAL_HEAD = 'try-'

const trialPattern = (): RegExp =>
  new RegExp(`https?:\\/\\/${TRIAL_HEAD}[a-z0-9-]+\\.[a-z0-9.-]+(?::\\d+)?(?:\\/[^\\s)]*)?`, 'gi')

/** Trial origins named in a receipt or a step. The same origin once. */
export const versionsIn = (text: string): ChatVersion[] => {
  const seen = new Set<string>()
  const out: ChatVersion[] = []
  for (const match of String(text ?? '').matchAll(trialPattern())) {
    const href = match[0].replace(/\/$/, '')
    if (seen.has(href)) continue
    seen.add(href)
    const host = href.replace(/^https?:\/\//, '').split('/')[0] ?? href
    out.push({ href, label: host.split('.')[0] || host })
  }
  return out
}

/** The shelf link for one resource. Anything that is not a signature is skipped. */
export const resourceVersion = (sig: string | undefined): ChatVersion | null => {
  const clean = String(sig ?? '').trim().toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(clean)) return null
  return { href: `/@resource/${clean}`, label: clean.slice(0, 8) }
}
