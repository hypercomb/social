// hypercomb-core/src/core/code-reach.ts
//
// WHAT A CHANGE NEWLY REACHES — the fast half of the draft audit (jwize,
// 2026-09-23: "a code safety audit so we can author our own new code in real
// time"). A model writes one section of a running module back (runtime
// module-drafts.ts) and it runs on the next reload, in this hive, beside the
// participant's keys. Before it can, the CODE lists what the new section
// reaches that the old one did not, and anything on that list is held in the
// brood until a hand accepts it (brood.ts flagInBrood). JEV reads the change
// afterwards and may hold it too (essentials safety/brood-audit.ts
// auditDraft). Neither can ever let anything run.
//
// DETERMINISTIC AND DELIBERATELY CRUDE. Patterns over the whole text, comments
// included, so nothing hides behind a comment trick: a false alarm costs one
// accept, a miss costs the hive. Instant and the same answer every time, so a
// draft never waits on a model to be held. It proves nothing safe — a reach it
// has no pattern for is the reading's to find.

export type CodeReach = 'network' | 'storage' | 'secrets' | 'eval' | 'escape' | 'disguise'

/** In the order a list shows them. */
export const CODE_REACHES: readonly CodeReach[] = ['network', 'storage', 'secrets', 'eval', 'escape', 'disguise']

/** What each reach means, for a sentence ("it newly reaches the network"). */
export const CODE_REACH_LABELS: Readonly<Record<CodeReach, string>> = {
  network: 'the network',
  storage: 'stored data',
  secrets: 'secrets and keys',
  eval: 'text run as code',
  escape: 'a way out of the page',
  disguise: 'disguised code',
}

const PATTERNS: Readonly<Record<CodeReach, RegExp>> = {
  network: /\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b|\bEventSource\b|\bsendBeacon\b|\bRTCPeerConnection\b|\bimportScripts\s*\(|\bnew\s+(?:Shared)?Worker\s*\(/,
  storage: /\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b|\bnavigator\s*\.\s*storage\b|\bgetDirectory\s*\(|\bcaches\s*\.|\bdocument\s*\.\s*cookie\b|\bremoveEntry\s*\(|\bcreateWritable\s*\(/,
  secrets: /secret|private[_-]?key|\bnsec|api[_-]?key|password|\bcrypto\s*\.\s*subtle\b|\bsignEvent\b|\bfinalizeEvent\b|\bnavigator\s*\.\s*(?:clipboard|credentials)\b/i,
  eval: /\beval\s*\(|\bFunction\s*\(|\bimport\s*\(\s*(?!['"`][^'"`$]*['"`]\s*\))|\bset(?:Timeout|Interval)\s*\(\s*['"`]|\bcreateContextualFragment\b|\bsrcdoc\b/,
  escape: /\bpostMessage\s*\(|\bBroadcastChannel\b|\bwindow\s*\.\s*open\s*\(|\blocation\s*\.\s*(?:href|assign|replace)\b|\blocation\s*=(?!=)|\bdocument\s*\.\s*domain\b|\bserviceWorker\b|\bopener\b/,
  disguise: /\batob\s*\(|\bbtoa\s*\(|\bfromCharCode\b|\\x[0-9a-f]{2}|\\u\{?[0-9a-f]{4}|\b(?:window|self|globalThis)\s*\[|\bReflect\s*\.\s*(?:get|apply|construct)\b|[A-Za-z0-9+/]{120,}/i,
}

/** An address the code names outright: a new one is a new reach even where
 *  the old code already used the network. */
const ORIGIN = /\b(?:https?|wss?):\/\/([a-z0-9.-]+)/gi
const originsOf = (text: string): Set<string> =>
  new Set([...text.matchAll(ORIGIN)].map(match => (match[1] ?? '').toLowerCase()))

/** Every reach this text makes, in `CODE_REACHES` order. */
export const reachesOf = (text: string): readonly CodeReach[] => {
  const found = CODE_REACHES.filter(reach => PATTERNS[reach].test(text))
  return originsOf(text).size && !found.includes('network')
    ? CODE_REACHES.filter(reach => reach === 'network' || found.includes(reach))
    : found
}

/** What `after` reaches that `before` did not — the draft audit's list. A
 *  kind of reach the old code never made, or an address it never named. */
export const newReaches = (before: string, after: string): readonly CodeReach[] => {
  const had = new Set(reachesOf(before))
  const added = new Set(reachesOf(after).filter(reach => !had.has(reach)))
  const known = originsOf(before)
  for (const origin of originsOf(after)) if (!known.has(origin)) added.add('network')
  return CODE_REACHES.filter(reach => added.has(reach))
}

/** "the network and stored data" — the list as a phrase. */
export const reachPhrase = (reaches: readonly CodeReach[]): string => {
  const labels = reaches.map(reach => CODE_REACH_LABELS[reach])
  return labels.length <= 1 ? labels.join('') : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`
}
