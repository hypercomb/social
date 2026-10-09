// hypercomb-relay/nip05-names.js — who a key is, AT ITS HOST (NIP-05).
//
// A host is a domain, so a participant's name is their name at their host:
// `leanne@cafesociety.me`. NIP-05 makes the DOMAIN the voucher: the name is
// true when `https://<host>/.well-known/nostr.json` answers
// `{ "names": { "<name>": "<hex pubkey>" } }`. This module is that document,
// and the ONE rule for what counts as a name — the content worker
// (blossom-worker/worker.js) and the Node relay (relay.js) both answer through
// it, and the hive reads names through the same rule, so a name the hive shows
// is a name a host can vouch for (documentation/sealed-audiences.md, Names).
//
// Derived from the keys a host already serves, never a second list to keep:
// the caller hands over its keys in precedence order, each with the names it
// says that key carries (a binding's label, a profile's name).
//
// Pure ESM, no `node:` imports: the worker bundles it, and a browser may too.

/** The domain's own key. `_@host` shows as just `host`. */
export const PRIMARY = '_'

// A name AS WRITTEN: ASCII only, tested BEFORE it is lowercased. Unicode case
// mapping folds lookalikes into ASCII (U+212A KELVIN SIGN lowercases to `k`),
// so a rule that lowercased first would let `Kate` stand for `kate`.
const WRITTEN_RE = /^[A-Za-z0-9._-]{1,64}$/
// ASCII whitespace only. String#trim also strips U+FEFF, U+3000 and the rest of
// Unicode's spaces, which is a fold too.
const ASCII_SPACE = ' \t\n\v\f\r'

/** A NIP-05 local part, or null. Trimmed of ASCII whitespace, accepted only if
 *  what remains is already an ASCII name, then lowercased — never folded, never
 *  invented. Only a string is a name: `String(undefined)` would invent
 *  "undefined". `_` is the primary's alone. */
export function nip05Name(raw) {
  if (typeof raw !== 'string') return null
  let start = 0
  let end = raw.length
  while (start < end && ASCII_SPACE.includes(raw[start])) start++
  while (end > start && ASCII_SPACE.includes(raw[end - 1])) end--
  const written = raw.slice(start, end)
  if (!WRITTEN_RE.test(written)) return null
  const name = written.toLowerCase()
  return name !== PRIMARY ? name : null
}

const PUBKEY_RE = /^[0-9a-f]{64}$/

/**
 * The `/.well-known/nostr.json` body for one host.
 *
 * `entries` are the host's keys in precedence order —
 * `[{ pubkey, primary?, names: [string|undefined, ...] }]`. The first entry
 * marked `primary` answers as `_`, and also under its own names. A name two
 * DIFFERENT keys claim on this host is contested, and NEITHER gets it: the
 * host cannot vouch for one without wronging the other. One key may hold
 * several names.
 *
 * `query` is the request's `?name=`. Empty or absent: every name. Otherwise
 * only the entry whose name equals it lowercased, keyed EXACTLY as asked —
 * a NIP-05 client looks up `names[asked]` — or `{ names: {} }` when none does.
 * A query that is not an ASCII name as written matches nothing, so no
 * lookalike spelling is ever answered for a real name.
 */
export function nostrJson(entries, query) {
  const claims = new Map() // name → the one key holding it, or null once contested
  let primary = null
  for (const entry of Array.isArray(entries) ? entries : []) {
    const pubkey = typeof entry?.pubkey === 'string' ? entry.pubkey.trim().toLowerCase() : ''
    if (!PUBKEY_RE.test(pubkey)) continue
    if (entry.primary === true && primary === null) primary = pubkey
    for (const raw of Array.isArray(entry.names) ? entry.names : []) {
      const name = nip05Name(raw)
      if (name === null) continue
      if (!claims.has(name)) claims.set(name, pubkey)
      else if (claims.get(name) !== pubkey) claims.set(name, null)
    }
  }
  const all = []
  if (primary !== null) all.push([PRIMARY, primary])
  for (const [name, pubkey] of claims) if (pubkey !== null) all.push([name, pubkey])

  // Object.fromEntries DEFINES each key, so a name like `__proto__` is an
  // own property like any other rather than a prototype assignment.
  const asked = typeof query === 'string' ? query : ''
  if (!asked) return { names: Object.fromEntries(all) }
  if (!WRITTEN_RE.test(asked)) return { names: {} }
  const wanted = asked.toLowerCase()
  const hit = all.find(([name]) => name === wanted)
  return { names: Object.fromEntries(hit ? [[asked, hit[1]]] : []) }
}
