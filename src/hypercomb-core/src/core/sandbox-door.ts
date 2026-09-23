// hypercomb-core/src/core/sandbox-door.ts
//
// THE ONE DOOR PREDICATE. A sandbox door is `try-<change>.<zone>`
// (documentation/module-sandbox.md): the host serves a PUBLISHER'S package
// there, and that code runs with full page power. Whatever the shell does
// differently at a door — hold no keys, hide the signer, draw the door bar,
// refuse the words that write — it asks this file, so there is one rule and
// not five regexes drifting apart. A doctrine ratchet (`src/doctrine.spec.ts`)
// refuses a second copy.
//
// The label rule is the host's own: the blossom worker's `SANDBOX_LABEL_RE`
// (hypercomb-relay/blossom-worker/worker.js) — one DNS label, `try-` and 1–57
// more characters that start and end alphanumeric. The worker is plain JS on
// another platform and keeps its own copy; the two must say the same thing.

const SANDBOX_LABEL_RE = /^try-[a-z0-9](?:[a-z0-9-]{0,55}[a-z0-9])?$/

/** Is this one DNS label a sandbox's name (`try-<change>`)? Case-sensitive,
 *  as a label the host listed is already lower-case. */
export const isSandboxLabel = (label: string): boolean => SANDBOX_LABEL_RE.test(String(label ?? ''))

/** The door a hostname is, or null: its first label when that label is a
 *  sandbox's name, and the zone it opens on. A port is never part of the
 *  zone, and `*.localhost` zones count — the local harness opens doors there. */
export const sandboxDoorOf = (hostname: string): { label: string; zone: string } | null => {
  const host = String(hostname ?? '').trim().toLowerCase().replace(/:\d{1,5}$/, '')
  const dot = host.indexOf('.')
  if (dot < 0) return null
  const label = host.slice(0, dot)
  const zone = host.slice(dot + 1)
  return zone && isSandboxLabel(label) ? { label, zone } : null
}

/** Is THIS page a sandbox door? False wherever there is no location (a
 *  worker without one, node, a test). */
export const isSandboxDoor = (): boolean => {
  try { return !!sandboxDoorOf(globalThis.location?.hostname ?? '') } catch { return false }
}
