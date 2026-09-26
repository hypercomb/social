// hypercomb blossom-worker — the PUBLIC CONTENT ENDPOINT
// Cloudflare Worker speaking the Blossom dialect over an R2 bucket.
//
// Doctrine: swarms resolve around hosts; public content posts to the CDN.
// This is the CDN tier. A host (relay.js) is a participant's living edge —
// it captures, packages, serves, and can say no. The CDN tier is dumber and
// wider: an R2 bucket of sig-named blobs behind Cloudflare's edge, for
// content that is ALREADY public. Private and group content never lands
// here — it stays host-tier (see documentation/consent-hosting.md).
//
// The wire shape is Blossom (BUD-01/02/06) because hypercomb's flat
// `GET /<sig>` heap and Blossom's `GET /<sha256>` are the same URL — a
// signature IS a sha256 of the bytes. Where the dialects differ (upload
// auth), we accept both on their natural routes:
//
//   GET/HEAD /<sig>   open read — immutable, edge-cacheable, Range-capable
//   PUT /<sig>        hypercomb host-sync shape — NIP-98 (kind 27235)
//   PUT /upload       Blossom BUD-02 — kind 24242, t=upload
//   HEAD /upload      Blossom BUD-06 preflight — X-SHA-256/X-Content-Length
//
// Two guards on every write, independent (same doctrine as relay.js):
//   1. content-integrity — sha256(body) MUST equal the declared sig.
//      Bytes authenticate themselves; a forged sig is computationally
//      impossible. Idempotent: same sig == same bytes, so an existing
//      object returns 200 without a rewrite (dedup is free).
//   2. writer-authorization — a schnorr-signed nostr event proves WHO
//      without ever sending a secret. Instead of relay.js's static
//      --writers allowlist, this tier meters an auto-grant guest list:
//      Pool sign('host:grants')/<pubkey> → { quotaBytes, usedBytes, expiresAt }
//      (KV GRANTS read as a drain source only).
//
// Never logs or echoes request bodies. Only dependency: @noble/curves
// (schnorr verify — wrangler bundles it).

import { schnorr } from '@noble/curves/secp256k1'
import { HOST_LISTING_FLOOR, listedMeanings } from '../host-listing.js'

const SIG_RE = /^[0-9a-f]{64}$/
// A hostname LABEL, per DNS. A lineage is only a name the wildcard can bring to
// life if it is one of these: `install:essentials` is a perfectly good creation
// and not a hostname, and the ledger must never advertise an address DNS refuses
// before the router ever sees it. Checked here, in the one place that decides
// what an implicit name is, so the router and the directory cannot disagree.
const DNS_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const NIP98_KIND = 27235      // NIP-98 HTTP auth (hypercomb host-sync PUTs)
const BLOSSOM_KIND = 24242    // Blossom BUD-02 upload auth
const HIVE_KIND = 30564       // hive index — publisher-signed {lineageKey → head sig} manifest
const AUTH_SKEW_SECS = 60     // freshness window — bounds replay of a captured token
const HIVE_MAX_BYTES = 65_536 // a hive index is a small map, never a byte store

// ── published application domains ───────────────────────────────────────────
//
// SITE_BINDINGS is operator configuration, never publisher content. It binds a
// hostname to the publisher keys allowed to appear there and the lineage each
// key contributes. DCP keeps publishing through the existing signed hive
// index; the website view is derived from that verified index on every read.
//
// { "pluginthematrix.com": {
//     "title":"Plugin the Matrix", "lineage":"pluginthematrix",
//     "publishers":[{"pubkey":"<64-hex>","label":"Jaime","primary":true}]
//   },
//   "revolucion.pluginthematrix.com": {
//     "title":"Revolución", "lineage":"revolucion",
//     "publishers":[{"pubkey":"<64-hex>","label":"Jaime","primary":true}]
// } }

// Parsed once per env. `resolveSite` calls this, the ledger calls `resolveSite`
// once per candidate door, and a directory read would otherwise re-parse the
// whole binding blob tens of times to answer one request.
const bindingCache = new WeakMap()

// A request's bindings once the operators' signed records are in. Set on a
// per-request VIEW of env (bindingsEnv), never on env itself: an isolate reuses
// one env across requests, and a revoked publisher must be gone on the next read.
const POOL_BINDINGS = Symbol('pool-bindings')

function siteBindings(env) {
  if (env?.[POOL_BINDINGS]) return env[POOL_BINDINGS]
  const cached = bindingCache.get(env)
  if (cached) return cached
  const parsed = parseBindings(env)
  bindingCache.set(env, parsed)
  return parsed
}

function parseBindings(env) {
  let rawBindings
  try { rawBindings = JSON.parse(String(env.SITE_BINDINGS || '{}')) } catch { return {} }
  const bindings = {}
  for (const [rawHost, raw] of Object.entries(rawBindings || {})) {
    const entry = normalizeBinding(rawHost, raw)
    if (entry) bindings[entry[0]] = entry[1]
  }
  return bindings
}

/** One binding, normalized: `[host, binding]`, or null. The SAME rule for an
 *  entry of the wrangler var and for a site inside an operator's signed record,
 *  so the two sources cannot give one zone two shapes. The essentials encoder
 *  (`normalizeBoundSite`, sharing/community-hosts.ts) mirrors it, and
 *  site-bindings.vector.json pins the two together. */
function normalizeBinding(rawHost, raw) {
  if (!raw || typeof raw !== 'object') return null
  const host = String(rawHost || '').trim().toLowerCase()
  const lineage = String(raw.lineage || '').split('/').map((s) => s.trim()).filter(Boolean).join('/')
  if (!host || !lineage) return null
  const publishers = (Array.isArray(raw.publishers) ? raw.publishers : [])
    .map((p) => ({
      pubkey: String(p?.pubkey || '').toLowerCase(),
      label: String(p?.label || '').trim(),
      primary: p?.primary === true,
    }))
    .filter((p) => SIG_RE.test(p.pubkey))
  return [host, {
    title: String(raw.title || lineage.split('/').at(-1) || 'Published Hypercomb').trim(),
    // A site's OWN tab mark, when it has one. Same-origin absolute path
    // only — in practice a content-addressed `/<sig>/name.svg`, which this
    // worker already serves with the type the suffix declares. Saying
    // nothing means the Hypercomb hexagon, which every door carries by
    // default; this is the opt-OUT, not the source of the icon.
    icon: iconPath(raw.icon),
    lineage,
    publishers,
    // WHAT IS DEPLOYED, which the script cannot see: Cloudflare does not hand
    // a worker its own routes, and a binding whose route is commented out
    // resolves here and is never reached. Both default true — saying nothing
    // keeps today's answer.
    //
    // These gate what the directory ADVERTISES, never what `resolveSite`
    // serves. If a request somehow arrives, answer it; routing is the edge's
    // job. Advertising a door that cannot be dialled is this file's job.
    routed: raw.routed !== false,      // is THIS host served?
    wildcard: raw.wildcard !== false,  // is `*.<host>` served?
    // THE FRONT DOOR: this host is a domain's entrance (management + the
    // hives switched on here), not a hive — the shim host card answers it.
    frontDoor: raw.frontDoor === true,
  }]
}

/** An operator-declared site icon, or null. Off-origin is refused rather than
 *  passed through: the visitor fetches this on every load, so an absolute URL
 *  would hand a third party the reader's IP on every page view (see
 *  documentation/no-third-party-requests.md) — and the visitor CSP would block
 *  it anyway, costing the site its mark for nothing. */
function iconPath(raw) {
  const icon = String(raw || '').trim()
  if (!icon.startsWith('/') || icon.startsWith('//')) return null
  return icon
}

function siteBinding(env, hostname) {
  return siteBindings(env)[String(hostname || '').toLowerCase()] || null
}

// Publish IS the naming step: any first-level subdomain of a bound zone is an
// IMPLICIT site — lineage = the label, publishers = the zone's allowlist. No
// per-name configuration; a name goes live the moment an approved publisher's
// signed index carries a root for it, and says "nothing here" until then.
// content.<zone> stays the write/relay face and is never a site.
function resolveSite(env, hostname) {
  const host = String(hostname || '').toLowerCase()
  const bindings = siteBindings(env)
  const exact = bindings[host]
  if (exact) return { site: exact, implicit: false, zone: null }
  const zone = Object.keys(bindings).find(h => host !== h && host.endsWith('.' + h))
  if (!zone || host === `content.${zone}`) return { site: null, implicit: false, zone: zone ?? null }
  const label = host.slice(0, -(zone.length + 1))
  if (!DNS_LABEL_RE.test(label)) return { site: null, implicit: false, zone }
  return {
    site: { title: label, lineage: label, publishers: bindings[zone].publishers },
    implicit: true,
    zone,
  }
}

async function anyPublishedRoot(env, site, read = indexReader(env), host = '') {
  const publisher = site.publishers?.find(p => p.primary) || site.publishers?.[0]
  return !!publisher && !!await publishedRoot(env, publisher, site.lineage, read, host)
}

// The icon files the shells link and browsers probe unasked. A closed list:
// this hands out shell assets on hosts that otherwise serve only signed
// content, so it names exactly the marks rather than opening a directory.
const MARK_PATHS = new Set([
  '/favicon.ico', '/favicon.svg', '/favicon-16.png', '/favicon-32.png',
  '/favicon-48.png', '/apple-touch-icon.png', '/icon.svg',
  '/icon-192.png', '/icon-512.png',
])

function nothingHere(hostname, zone) {
  const name = zone ? hostname.slice(0, -(zone.length + 1)) : hostname
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="/favicon.ico" sizes="48x48"><link rel="icon" href="/favicon.svg" type="image/svg+xml"><title>nothing here yet</title><body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#0b1218;color:#dce7ef;font:16px/1.6 system-ui,sans-serif"><main style="text-align:center;padding:2rem"><h1 style="font-size:1.3rem;margin:0 0 .5rem">nothing published at ${name}${zone ? '.' + zone : ''}</h1><p style="opacity:.7;margin:0">Publishing a hive named “${name}” makes this address its website. <a href="https://${zone ?? hostname}/" style="color:#7eb6d6">${zone ?? hostname}</a></p></main>`,
    { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...CORS } },
  )
}

// ── open is a signed mark ────────────────────────────────────────────────────
//
// A door shows a page only while the publisher's SIGNED index names its
// lineage. That entry IS the open mark: only the publisher's key can write it
// (putHive), and it is re-verified on every read (verifiedIndex). Withdrawing
// the entry (unpublish) hides the door again — the bytes stay content-
// addressed, so anyone already holding a signature (a shared link carries the
// sealed head) still resolves it, and nobody without one can find it here.
// There is no global hold and no per-browser override: the retired
// VISITOR_HOLD curtain hid what was signed open and opened what was not.

/** A publisher's index, parsed and signature-checked: `{roots, createdAt}`, or
 *  null when the key holds nothing this host will trust. */
async function verifiedIndex(env, pubkey) {
  let evt
  try { evt = JSON.parse((await heldIndexRaw(env, pubkey)) ?? 'null') } catch { return null }
  if (!evt || Number(evt.kind) !== HIVE_KIND || evt.pubkey !== pubkey) return null
  if (!(await verifyEventSig(evt))) return null
  let content
  try { content = JSON.parse(evt.content) } catch { return null }
  if (!content?.roots || typeof content.roots !== 'object' || Array.isArray(content.roots)
    || !validOfferingDeclarations(content.offerings)) return null
  const doors = content.doors && typeof content.doors === 'object' && !Array.isArray(content.doors) ? content.doors : {}
  return { roots: content.roots, doors, offerings: content.offerings ?? {}, listed: listedMeanings(content), createdAt: Number(evt.created_at || 0) }
}

/** One request's index reads, memoized by pubkey. The ledger asks the same
 *  key for every site it reports; a page passes one reader to its gate and its
 *  package. A reader never outlives the request that made it, so an index is
 *  never answered stale. */
function indexReader(env) {
  const reads = new Map()
  return (pubkey) => {
    if (!reads.has(pubkey)) reads.set(pubkey, verifiedIndex(env, pubkey))
    return reads.get(pubkey)
  }
}

// ── the allowlist as content (documentation/signed-site-bindings.md, Plan A) ──
//
// SITE_OPERATORS = {"<zone>": "<operator pubkey>"} names whose signed index
// speaks for a zone's bindings. That index names the zone's binding artifact
// under `binding:<zone>`, and the artifact's bytes must hash to that name.
// When every link holds, the record REPLACES the var's entries for that zone.
// Anything short of it — no operator, no key in the index, missing or forged
// bytes, a malformed record — leaves SITE_BINDINGS in charge, which is exactly
// today's answer. A lost operator key is recovered by redeploying
// SITE_OPERATORS (decided 2026-09-13), the same act that puts a zone's routes
// on this worker in the first place.

const COMMUNITY_HOSTS_POOL = 'community:hosts'
const BINDING_KIND = 'visual:binding:artifact'

/** sign(meaning): SHA-256 of the meaning's UTF-8 bytes, lowercase hex — the
 *  SAME derivation as core's pool registry. A worker that computed another
 *  address would read a pool no client writes, silently; the vector pins it
 *  from both sides. */
async function poolAddress(meaning) {
  return sha256Hex(new TextEncoder().encode(meaning))
}

function siteOperators(env) {
  let raw
  try { raw = JSON.parse(String(env.SITE_OPERATORS || '{}')) } catch { return [] }
  return Object.entries(raw && typeof raw === 'object' ? raw : {})
    .map(([zone, pubkey]) => [String(zone || '').trim().toLowerCase(), String(pubkey || '').trim().toLowerCase()])
    .filter(([zone, pubkey]) => zone && SIG_RE.test(pubkey))
}

const withinZone = (host, zone) => host === zone || host.endsWith('.' + zone)

/** A binding artifact's bytes, believed only when they hash to their name:
 *  the flat heap first, then the `community:hosts` pool that holds it. */
async function bindingBytes(env, sig) {
  for (const key of [sig, `${await poolAddress(COMMUNITY_HOSTS_POOL)}/${sig}`]) {
    try {
      const object = await env.CONTENT?.get?.(key)
      if (!object) continue
      const bytes = new Uint8Array(await object.arrayBuffer())
      if (await sha256Hex(bytes) === sig) return bytes
    } catch { /* try the next place */ }
  }
  return null
}

/** One zone's `[host, binding]` entries from its operator's signed record, or
 *  null unless every link verifies. */
async function operatorRecord(env, read, zone, pubkey) {
  const index = await read(pubkey)
  const sig = String(index?.roots?.[`binding:${zone}`] || '').toLowerCase()
  if (!SIG_RE.test(sig)) return null
  const bytes = await bindingBytes(env, sig)
  if (!bytes) return null
  let record
  try { record = JSON.parse(new TextDecoder().decode(bytes)) } catch { return null }
  if (record?.kind !== BINDING_KIND || record.meaning !== `binding:${zone}` || record.payload?.zone !== zone) return null
  if (!Array.isArray(record.payload.sites)) return null
  const entries = []
  for (const raw of record.payload.sites) {
    const entry = normalizeBinding(raw?.host, raw)
    // A record speaks for its own zone and nothing beyond it.
    if (entry && withinZone(entry[0], zone)) entries.push(entry)
  }
  return entries
}

/** The var's bindings with each operated zone's record in place of that
 *  zone's entries, in the var's order: the directory lists sites in binding
 *  order, and a migrated zone must answer what the var did, byte for byte. A
 *  host inside a deeper operated zone belongs to that zone's record. */
function mergeBindings(fromVar, records) {
  const zones = [...records.keys()].sort((a, b) => b.length - a.length)
  const zoneOf = (host) => zones.find((zone) => withinZone(host, zone)) ?? null
  const merged = {}
  const placed = new Set()
  const place = (zone) => {
    if (placed.has(zone)) return
    placed.add(zone)
    for (const [host, binding] of records.get(zone)) if (zoneOf(host) === zone) merged[host] = binding
  }
  for (const [host, binding] of Object.entries(fromVar)) {
    const zone = zoneOf(host)
    if (zone) place(zone)
    else merged[host] = binding
  }
  for (const zone of records.keys()) place(zone)
  return merged
}

/** A per-request view of env whose bindings include the operators' signed
 *  records — or env itself when no zone is operated or none verifies. */
/** How long one isolate trusts the operators' signed bindings and a site's
 *  open answer. Every request routes through them; a change is seen within
 *  this window (the same bound as the bag's newest marker). */
const SITE_TTL_MS = 5_000
const heldBindings = new WeakMap()

async function bindingsEnv(env, read = indexReader(env)) {
  const operators = siteOperators(env)
  if (!operators.length) return env
  const held = heldBindings.get(env)
  if (held && Date.now() - held.at < SITE_TTL_MS && held.hives === env.HIVES?.get) return held.view
  const view = await readBindingsEnv(env, read, operators)
  heldBindings.set(env, { at: Date.now(), view, hives: env.HIVES?.get })
  return view
}

async function readBindingsEnv(env, read, operators) {
  const records = new Map()
  for (const [zone, pubkey] of operators) {
    const entries = await operatorRecord(env, read, zone, pubkey)
    if (entries) records.set(zone, entries)
  }
  if (!records.size) return env
  const view = Object.create(env)
  view[POOL_BINDINGS] = mergeBindings(siteBindings(env), records)
  return view
}

/** Does this signed index open `lineage` on `host`? An entry WITH doors
 *  is obeyed exactly: only the domains it lists. An entry with NO doors was
 *  signed before doors existed and opens as it did then — everywhere (jwize
 *  2026-09-25: data never heals, older versions keep working). Nothing is
 *  inferred or written; the branch becomes explicit the next time its
 *  publisher publishes with doors. The same reading as the Publish window's
 *  doorOn. */
function opensOn(index, lineage, host) {
  if (!host) return false
  const listed = index?.doors?.[lineage]
  if (listed === undefined) return true
  if (!Array.isArray(listed)) return false
  const h = String(host).toLowerCase()
  return listed.some((z) => {
    const zone = String(z || '').toLowerCase()
    return !!zone && (h === zone || h.endsWith('.' + zone))
  })
}

/** WHAT A DOOR IS — the record every numbered marker of its location bag,
 *  `sign(<host>)/000x`, holds. A visitor asks that signature for the newest
 *  marker and reads the door there; no named route describes a site (jwize
 *  2026-09-25: only signatures are queried, and state lives only in pools of
 *  meaning — `/site.json` is retired). Minted only from the publisher's
 *  signed index and the operator's binding. `layer` is the head: the field
 *  every marker has always carried, so a head read never changes. */
function locationMeta(site, pubkey, head, index) {
  const signed = (key) => {
    const value = String(index?.roots?.[key] || '').toLowerCase()
    return SIG_RE.test(value) ? value : ''
  }
  // THE ARRIVAL PLAN, beside the root under the same signature: the bees
  // this branch's first view needs (hypercomb-runtime arrival-plan.ts).
  const plan = signed(`plan:${site.lineage}`)
  // THE PUBLISHER'S PARTICIPANT-ONLY FEATURES (essentials
  // participant-features.ts): a snapshot of their `features:participant`
  // pool, named under their key. A read-only reader never loads them.
  const quiet = signed('pool:features:participant')
  return {
    layer: head,
    pubkey,
    lineage: site.lineage,
    title: site.title,
    // Absent ⇒ the visitor keeps the Hypercomb mark its shell already links.
    ...(site.icon ? { icon: site.icon } : {}),
    ...(plan ? { plan } : {}),
    ...(quiet ? { quiet } : {}),
    publishedAt: Number(index?.createdAt || 0),
  }
}

/** Two records describe the same door when all but the stamp agree — so an
 *  index write that leaves this door as it was appends nothing. */
function sameLocationState(a, b) {
  const state = (record) => JSON.stringify(Object.entries(record ?? {})
    .filter(([key]) => key !== 'publishedAt')
    .sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)))
  return state(a) === state(b)
}

async function publishedRoot(env, publisher, lineage, read = indexReader(env), host = '') {
  let site = null
  if (host) {
    site = resolveSite(env, host).site
    const selected = site?.publishers?.find(p => p.primary) || site?.publishers?.[0]
    if (!site || site.lineage !== lineage || selected?.pubkey !== publisher.pubkey) return null
  }
  const index = await read(publisher.pubkey)
  const head = String(index?.roots?.[lineage] || '').toLowerCase()
  if (!SIG_RE.test(head)) return null
  if (!opensOn(index, lineage, host)) return null
  const meta = locationMeta(site ?? { lineage }, publisher.pubkey, head, index)
  // A published route is a location, not a mutable signature alias. The
  // signed index authorizes the route; its hostname bag names the current
  // revision. A disagreement is a closed door until the publisher repairs it.
  if (host && !siteBinding(env, host)?.frontDoor
    && await currentRouteHead(env, host, head, meta) !== head) return null
  return {
    head,
    pubkey: publisher.pubkey,
    label: publisher.label || publisher.pubkey.slice(0, 12) + '…',
    publishedAt: index.createdAt,
    ...(meta.plan ? { plan: meta.plan } : {}),
    ...(meta.quiet ? { quiet: meta.quiet } : {}),
  }
}

/** One site as the ledger reports it — the same shape for a hand-bound host
 *  and for one the naming rule brought to life. */
async function ledgerEntry(env, read, protocol, host, site) {
  // `host`/`url` stay what they have always been — the primary door — so a
  // reader that never learns about `hosts` keeps working unchanged. The entry's
  // own host leads the list by force rather than by argument: an invariant a
  // consumer can rely on should not depend on two orderings agreeing.
  const doors = await hostsOfLineage(env, read, site.lineage)
  const ordered = [...doors.filter((d) => d.host === host), ...doors.filter((d) => d.host !== host)]
  return {
    host,
    url: `${protocol}//${host}/`,
    hosts: ordered.map((door, i) => ({
      host: door.host,
      url: `${protocol}//${door.host}/`,
      primary: i === 0,
      implicit: door.implicit,
    })),
    title: site.title,
    lineage: site.lineage,
    publishers: await Promise.all(site.publishers.map(async (publisher) => {
      const publication = await publishedRoot(env, publisher, site.lineage, read, host)
      return {
        pubkey: publisher.pubkey,
        label: publisher.label || publisher.pubkey.slice(0, 12) + '…',
        primary: publisher.primary,
        head: publication?.head ?? null,
        publishedAt: publication?.publishedAt ?? null,
      }
    })),
  }
}

/** The hosts a wildcard label can hang off: a bound host that is not itself a
 *  subdomain of another bound host, and whose `*` route is deployed. This is the
 *  apex the zone's `*` DNS record covers, so it is the only place an implicit
 *  name actually answers — and `wildcard: false` says the route is not up yet,
 *  which is the difference between a name being live and a name 404ing. */
function wildcardZones(bindings) {
  const hosts = Object.keys(bindings)
  return hosts.filter((h) => bindings[h].wildcard && !hosts.some((g) => g !== h && h.endsWith('.' + g)))
}

/** The zone a host hangs off — itself when it IS one. */
const zoneOfHost = (zones, host) => zones.find((z) => host === z || host.endsWith('.' + z)) ?? null

/**
 * EVERY address the router serves this lineage at, primary first.
 *
 * One creation answers on as many doors as there are zones carrying it, and
 * reporting only the first was the directory saying `dylan.pluginthematrix.com`
 * while `dylan.hypercomb.com` served the same bytes. A consumer that wanted the
 * other door had to re-derive `<lineage>.<zone>` and probe for it — worker logic
 * living somewhere else, which is how the two drift.
 *
 * Two ways a door exists, in that order of authority:
 *   • an explicit binding naming this lineage — a hand-bound door, and the
 *     primary when there is one;
 *   • the wildcard rule — `<lineage>.<zone>`, for a TOP-LEVEL lineage only. A
 *     nested one (`games/arkanoid`) needs its own binding, because the wildcard
 *     maps a single label and never a path.
 *
 * Four rules keep this honest, and each of them is a door the list must NOT
 * contain:
 *   • every candidate goes back through `resolveSite` — the directory may never
 *     advertise an address the router would refuse;
 *   • the route has to be deployed (`routed` / `wildcard` on the binding). A
 *     commented-out route resolves here and is never reached from the outside;
 *   • the lineage must actually be PUBLISHED at that door. A zone whose
 *     allowlist does not carry the publisher resolves fine and then serves
 *     "nothing published here", so structure alone is not a door;
 *   • at most one door per zone. A creation bound at a zone's apex is already
 *     there, and `hypercomb.hypercomb.com` is noise, not a second address.
 */
async function hostsOfLineage(env, read, lineage) {
  const bindings = siteBindings(env)
  const zones = wildcardZones(bindings)
  const doors = []
  const claimed = new Set()
  const consider = async (candidate) => {
    const host = String(candidate || '').toLowerCase()
    const zone = zoneOfHost(zones, host)
    if (zone && claimed.has(zone)) return
    const { site, implicit } = resolveSite(env, host)
    if (!site || site.lineage !== lineage) return
    if (!(await anyPublishedRoot(env, site, read, host))) return
    if (zone) claimed.add(zone)
    doors.push({ host, implicit })
  }
  for (const [host, bound] of Object.entries(bindings)) {
    if (bound.lineage === lineage && bound.routed) await consider(host)
  }
  if (lineage && !lineage.includes('/') && DNS_LABEL_RE.test(lineage)) {
    for (const zone of zones) await consider(`${lineage}.${zone}`)
  }
  return doors
}

// Publishing IS the naming step, so the ledger must report the sites that rule
// brings to life — not only the hand-bound ones. Every TOP-LEVEL root in an
// approved publisher's verified index is already live at `<root>.<zone>`
// (resolveSite), and enumerating only SITE_BINDINGS left those names off the
// directory forever: publishing a new creation went live but never earned a
// plate. Each candidate is resolved back through resolveSite, so this can
// never advertise an address the router would refuse to serve.
/** The host's publications and its open trials: one-file indexes answered at
 *  their pools' own addresses, sign('host:publications') and sign('host:trials'). */
const HOST_PUBLICATIONS_MEANING = 'host:publications'
const HOST_TRIALS_MEANING = 'host:trials'

async function servePublications(request, env) {
  const protocol = new URL(request.url).protocol
  const read = indexReader(env)
  const bindings = siteBindings(env)
  const sites = []
  // One plate per creation, on BOTH loops. Two bindings naming one lineage used
  // to earn two entries; now that an entry carries every door the creation
  // answers on, they would be the same plate twice.
  const named = new Set()
  for (const [host, site] of Object.entries(bindings)) {
    if (named.has(site.lineage)) continue
    named.add(site.lineage)
    sites.push(await ledgerEntry(env, read, protocol, host, site))
  }

  // The names publishing brought to life. An explicit binding already claimed
  // its lineage above; the first zone to name an implicit one keeps it.
  for (const zone of wildcardZones(bindings)) {
    const publisher = bindings[zone].publishers.find(p => p.primary) || bindings[zone].publishers[0]
    if (publisher) {
      const index = await read(publisher.pubkey)
      if (!index) continue
      for (const [lineage, sig] of Object.entries(index.roots)) {
        // Nested lineages need their own custom domain + binding — the
        // wildcard maps a single label, never a path.
        if (named.has(lineage) || lineage.includes('/')) continue
        if (!SIG_RE.test(String(sig || '').toLowerCase())) continue
        const host = `${lineage}.${zone}`
        const resolved = resolveSite(env, host)
        if (!resolved.implicit || resolved.site?.lineage !== lineage) continue
        // Switched off on this domain: the next zone that opens it keeps the plate.
        if (!opensOn(index, lineage, host)) continue
        named.add(lineage)
        sites.push(await ledgerEntry(env, read, protocol, host, resolved.site))
      }
    }
  }
  return json(200, { sites }, { 'Cache-Control': 'no-store' })
}

// GET /<sig>/ — THE DIRECTORY BRANCH (documentation/host-packages-pool.md).
// A pool is a directory, reached at the one address every client derives for
// itself: sign(meaning), trailing slash. The hive's host directory, the offers
// window and every cross-host word search open THIS door and nothing else. A
// live relay answers by readdir; here the heap is R2, so the pool's members
// are the objects under the prefix `<sig>/`, and the listing is their names —
// one per line, text/plain, no-store, because a pool GROWS. A public pool with
// nothing under it is an EMPTY listing (a host with no packages yet), never the
// SPA fallback: a 307 to / or a page of HTML at a pool's address is the one
// answer that makes a live host read as "does not answer".
// Only LISTED pools answer in public: the host contract's floor, plus any
// meaning a site operator's signed index declares in `listed`
// (hypercomb-relay/host-listing.js — the relay reads the same file). Every
// other address is "no pool at this address", so a derivable one (a word's
// pool, a path's history bag) never enumerates what a publisher switched off.
const HOST_OFFERINGS_MEANING = 'host:offerings'

/** How long one isolate trusts the operators' declared listing. Every word is
 *  a cross-host search address, so undeclared probes are common; they must
 *  not each cost an index read and a signature check (the free plan's caps). */
const LISTING_TTL_MS = 60_000
const declaredListings = new WeakMap()

/** The addresses the operators' signed indexes (SITE_OPERATORS) declare,
 *  read at most once per isolate per LISTING_TTL_MS. */
async function declaredListing(env, read) {
  const holder = env.HIVES ?? env
  const held = declaredListings.get(holder)
  if (held && Date.now() - held.at < LISTING_TTL_MS) return held.addresses
  const addresses = new Set()
  for (const pubkey of new Set(siteOperators(env).map(([, pubkey]) => pubkey))) {
    const index = await read(pubkey)
    for (const meaning of index?.listed ?? []) addresses.add(await poolAddress(meaning))
  }
  declaredListings.set(holder, { at: Date.now(), addresses })
  return addresses
}

/** Is this pool listed here? The floor answers without an index read — the
 *  addresses every follower asks stay on the hot path; anything else is
 *  listed only while an operator's signed index declares it. */
async function listedPool(env, sig, read = indexReader(env)) {
  if ((await Promise.all(HOST_LISTING_FLOOR.map(poolAddress))).includes(sig)) return true
  return (await declaredListing(env, read)).has(sig)
}
const ROUTE_MARKER_RE = /^\d{8}$/
const PUBLIC_LEAF_MEANINGS = new Set(['themes:text'])

/** An optional signed public switch, keyed by a creation's stable location.
 *  The ordinary meaning pool stays private: only these selected locations
 *  enter the public host:offerings projection. */
function validOfferingDeclarations(raw) {
  if (raw === undefined) return true
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false
  return Object.entries(raw).every(([location, offer]) =>
    SIG_RE.test(location) && offer && typeof offer === 'object' && !Array.isArray(offer)
    && typeof offer.meaning === 'string' && offer.meaning.includes(':') && offer.meaning.length <= 160
    && typeof offer.key === 'string' && offer.key.length > 0 && offer.key.length <= 256
    && SIG_RE.test(String(offer.head || ''))
    && typeof offer.title === 'string' && offer.title.trim().length > 0 && offer.title.length <= 120
    && typeof offer.host === 'string' && offer.host.length <= 253
    && offer.host.includes('.') && offer.host.split('.').every(label => DNS_LABEL_RE.test(label)))
}

async function creationLocationMatches(location, offer) {
  return await poolAddress(`${offer.meaning}:${offer.key}`) === location
}

/** A shared bucket must not merge two hosts' equal meaning:key locations.
 *  The URL stays /content/<location>/ on each host; only R2 keys are scoped. */
async function creationBagLocation(host, location) {
  return `locations/${await poolAddress(host.toLowerCase())}/${location}`
}

/** Verify the immediate typed closure before an offering is advertised.
 *  Further references inside arbitrary beehaviors still belong to the
 *  publisher's closure stage; a text theme's layer has no such references. */
async function heldCreationBytes(env, sig, maxBytes = 1_048_576) {
  const object = await env.CONTENT?.get?.(sig)
  if (!object || Number(object.size ?? 0) > maxBytes) return null
  const bytes = new Uint8Array(await object.arrayBuffer())
  return bytes.byteLength <= maxBytes && await sha256Hex(bytes) === sig ? bytes : null
}

async function hasCreationHead(env, offer) {
  if (!PUBLIC_LEAF_MEANINGS.has(offer.meaning)) return false
  const metaBytes = await heldCreationBytes(env, offer.head, 65_536)
  if (!metaBytes) return false
  let meta
  try { meta = JSON.parse(new TextDecoder().decode(metaBytes)) } catch { return false }
  if (!meta || typeof meta !== 'object' || meta.meta !== 1
    || meta.relation !== offer.meaning || !SIG_RE.test(String(meta.layer || ''))
    || ['layer', 'resource', 'dependency', 'bee'].filter(key => meta[key] !== undefined).length !== 1) return false
  const layerBytes = await heldCreationBytes(env, meta.layer)
  if (!layerBytes) return false
  let layer
  try { layer = JSON.parse(new TextDecoder().decode(layerBytes)) } catch { return false }
  // This first public leaf has no executable reference closure. `source` is
  // only provenance and may name an older revision without being installed.
  return !!layer && typeof layer === 'object' && !Array.isArray(layer)
    && layer.name === 'text-theme'
    && typeof layer.label === 'string' && layer.label.trim().length > 0 && layer.label.length <= 80
    && typeof layer.read === 'string' && layer.read.length > 0
    && typeof layer.code === 'string' && layer.code.length > 0
    && (layer.source === undefined || SIG_RE.test(String(layer.source)))
    && Object.keys(layer).every(key => ['name', 'label', 'read', 'code', 'source'].includes(key))
}

function creationMember(pubkey, location, offer) {
  return { kind: 'host:creation', meaning: offer.meaning, key: offer.key,
    location, pubkey, title: offer.title, host: offer.host }
}

async function retainCreationMember(env, pubkey, location, offer) {
  if (!env.CONTENT?.put || !env.CONTENT?.get) return false
  const bytes = new TextEncoder().encode(JSON.stringify(creationMember(pubkey, location, offer)))
  const name = await sha256Hex(bytes)
  const key = `${await poolAddress(HOST_OFFERINGS_MEANING)}/${name}`
  const existing = await env.CONTENT.get(key)
  if (existing) return await sha256Hex(new Uint8Array(await existing.arrayBuffer())) === name
  const written = await env.CONTENT.put(key, bytes, {
    onlyIf: new Headers({ 'If-None-Match': '*' }),
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
  })
  if (written !== null) return true
  const raced = await env.CONTENT.get(key)
  return !!raced && await sha256Hex(new Uint8Array(await raced.arrayBuffer())) === name
}

/** One location per DNS name. Only a served, signed route may enumerate it;
 *  the ordinary pool route intentionally never lists arbitrary location bags. */
async function routeLocation(env, host) {
  return `${await poolAddress(host.toLowerCase())}/`
}

async function locationMarkers(env, location) {
  if (!env.CONTENT?.list) return null
  const prefix = `${location}/`
  const names = []
  let cursor
  do {
    const page = await env.CONTENT.list({ prefix, cursor, limit: 1000 })
    for (const object of page.objects ?? []) {
      const name = String(object.key ?? '').slice(prefix.length)
      if (ROUTE_MARKER_RE.test(name)) names.push(name)
    }
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
  return [...new Set(names)].sort()
}

async function routeMarkers(env, host) {
  return locationMarkers(env, await poolAddress(host.toLowerCase()))
}

/** How long one isolate trusts a location's newest marker. Every page request
 *  gates on it; a write in this isolate drops the entry at once, and another
 *  isolate's write is seen within this window. */
const LOCATION_TTL_MS = 5_000
const newestAt = new Map()

/** A location's marker names and its newest record, cached per isolate. */
async function newestLocation(env, location) {
  const held = newestAt.get(location)
  if (held && Date.now() - held.at < LOCATION_TTL_MS && held.env === env.CONTENT) return held
  const names = await locationMarkers(env, location)
  const record = names?.length ? await locationRecord(env, location, names.at(-1)) : null
  const fresh = { names, record, at: Date.now(), env: env.CONTENT }
  newestAt.set(location, fresh)
  return fresh
}

/** One marker's record, or null. Markers are small, immutable JSON. */
async function locationRecord(env, location, name) {
  if (!ROUTE_MARKER_RE.test(name) || !env.CONTENT?.get) return null
  const object = await env.CONTENT.get(`${location}/${name}`)
  if (!object || Number(object.size ?? 0) > 65_536) return null
  const bytes = await object.arrayBuffer()
  if (bytes.byteLength > 65_536) return null
  try {
    const record = JSON.parse(new TextDecoder().decode(bytes))
    return record && typeof record === 'object' && !Array.isArray(record) && SIG_RE.test(String(record.layer)) ? record : null
  } catch { return null }
}

async function locationMarkerHead(env, location, name) {
  const record = await locationRecord(env, location, name)
  return record ? String(record.layer) : null
}

async function routeMarkerHead(env, host, name) {
  return locationMarkerHead(env, await poolAddress(host.toLowerCase()), name)
}

async function putLocationMarker(env, location, name, record) {
  if (!env.CONTENT?.put || !env.CONTENT?.head || !ROUTE_MARKER_RE.test(name) || !SIG_RE.test(String(record?.layer))) return false
  const key = `${location}/${name}`
  // A numbered member is immutable. The conditional R2 put closes the race
  // between two writers that both saw the next number free. There is no
  // transaction with the signed-index KV; reads verify both authorities.
  if (await env.CONTENT.head(key)) return false
  newestAt.delete(location)
  const written = await env.CONTENT.put(key, new TextEncoder().encode(JSON.stringify(record)), {
    onlyIf: new Headers({ 'If-None-Match': '*' }),
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
  })
  return written !== null
}

/** Existing published routes get one absence-only migration marker. Once a
 *  bag exists, a GET never advances it from the index or repairs a mismatch.
 *  The one forward write a GET may make keeps the head exactly where it is: a
 *  newest marker from before doors carried their meta gains a successor with
 *  the SAME head and the meta, so the bag describes its door (data moves
 *  forward; nothing is rewritten or deleted). */
async function currentRouteHead(env, host, signedHead, meta) {
  const location = await poolAddress(host.toLowerCase())
  const { names: markers, record: newest } = await newestLocation(env, location)
  if (!markers) return null
  if (markers.length === 0) {
    if (!SIG_RE.test(String(signedHead))) return null
    if (await putLocationMarker(env, location, '00000000', meta ?? { layer: signedHead })) return signedHead
    // Another first reader may have seeded the same marker. Re-read it;
    // never use this branch to append a changed index head.
    const seeded = await locationMarkers(env, location)
    return seeded?.length ? locationMarkerHead(env, location, seeded.at(-1)) : null
  }
  const latest = newest
  if (!latest) return null
  // A marker from before doors carried their meta is not an authority over
  // the signed index: an older worker passed index writes without advancing
  // bags. Whether it names the signed head or an older one, it gains a
  // successor holding the index's record — a forward commit, nothing
  // rewritten (jwize 2026-09-25: older versions keep working). A marker that
  // DOES carry meta stays the authority: a disagreement there closes the door.
  if (meta && typeof latest.pubkey !== 'string') {
    const next = Number(markers.at(-1)) + 1
    if (Number.isSafeInteger(next) && next <= 99_999_999
      && await putLocationMarker(env, location, String(next).padStart(8, '0'), meta)) return signedHead
    return latest.layer === signedHead ? signedHead : null
  }
  return String(latest.layer)
}

/** Called only after a publisher-authenticated, signed index update. */
async function advanceRouteMeta(env, host, meta) {
  return advanceLocation(env, await poolAddress(host.toLowerCase()), meta)
}

/** Append `record` unless the newest marker already says the same. */
async function advanceLocation(env, location, record) {
  const markers = await locationMarkers(env, location)
  if (!markers) return false
  const latest = markers.at(-1)
  if (latest && sameLocationState(await locationRecord(env, location, latest), record)) return true
  const next = latest ? Number(latest) + 1 : 0
  if (!Number.isSafeInteger(next) || next > 99_999_999) return false
  return putLocationMarker(env, location, String(next).padStart(8, '0'), record)
}

/** A direct bag read is scoped to this route and still gated by its signed
 *  publisher. A caller cannot enumerate private pools by guessing a hash. */
async function serveRouteLocation(request, env, site, member) {
  const host = new URL(request.url).hostname.toLowerCase()
  const read = indexReader(env)
  const approved = site.publishers.find(p => p.primary) || site.publishers[0]
  if (!approved || !await publishedRoot(env, approved, site.lineage, read, host)) {
    return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store', ...CORS } })
  }
  const names = await routeMarkers(env, host)
  if (!names?.length) return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store', ...CORS } })
  if (member) {
    if (!names.includes(member)) return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store', ...CORS } })
    const object = await env.CONTENT.get(`${await routeLocation(env, host)}${member}`)
    if (!object || !await routeMarkerHead(env, host, member)) {
      return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store', ...CORS } })
    }
    return new Response(request.method === 'HEAD' ? null : object.body, {
      status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=31536000, immutable', ...CORS },
    })
  }
  return new Response(request.method === 'HEAD' ? null : names.join('\n') + '\n', {
    status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...CORS },
  })
}

function selectedHostPublisher(env, host) {
  const site = siteBindings(env)[host]
  return site?.publishers?.find(p => p.primary) || site?.publishers?.[0] || null
}

async function activeCreation(env, host, location, read) {
  const publisher = selectedHostPublisher(env, host)
  if (!publisher) return null
  const index = await read(publisher.pubkey)
  const offer = index?.offerings?.[location]
  if (!offer || offer.host !== host || !PUBLIC_LEAF_MEANINGS.has(offer.meaning)
    || !await creationLocationMatches(location, offer)) return null
  const bag = await creationBagLocation(host, location)
  const markers = await locationMarkers(env, bag)
  if (!markers?.length || await locationMarkerHead(env, bag, markers.at(-1)) !== offer.head) return null
  if (!await hasCreationHead(env, offer)) return null
  return { offer, publisher, markers, bag }
}

/** A declared creation alone opens its location bag on the selected host.
 *  Withdrawn declarations stop enumeration; named immutable bytes remain on
 *  the flat heap. Unknown hashes continue to their normal route. */
async function serveCreationLocation(request, env, host, location, member) {
  const publisher = selectedHostPublisher(env, host)
  if (!publisher) return null
  const read = indexReader(env)
  const index = await read(publisher.pubkey)
  if (!index?.offerings?.[location] || index.offerings[location].host !== host) return null
  const headers = { 'Cache-Control': 'no-store', ...CORS }
  const current = await activeCreation(env, host, location, read)
  if (!current) return new Response(null, { status: 404, headers })
  if (member) {
    if (!current.markers.includes(member)) return new Response(null, { status: 404, headers })
    const object = await env.CONTENT.get(`${current.bag}/${member}`)
    if (!object || !await locationMarkerHead(env, current.bag, member)) return new Response(null, { status: 404, headers })
    return new Response(request.method === 'HEAD' ? null : object.body, {
      status: 200, headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=31536000, immutable' },
    })
  }
  return new Response(request.method === 'HEAD' ? null : current.markers.join('\n') + '\n', {
    status: 200, headers: { ...headers, 'Content-Type': 'text/plain; charset=utf-8' },
  })
}

/** The public pool discovers open locations in this domain. The location's
 *  sigbag is the revision history; offering members are not root history. */
async function offeredMembers(request, env) {
  const url = new URL(request.url)
  const host = url.hostname.toLowerCase()
  const scoped = await bindingsEnv(env)
  const bindings = siteBindings(scoped)
  const read = indexReader(scoped)
  const zones = wildcardZones(bindings)
  const portal = bindings[host]?.frontDoor === true || zones.includes(host)
  const offered = new Map()
  const add = async (door, site) => {
    if (site.frontDoor) return
    const publisher = site.publishers?.find(p => p.primary) || site.publishers?.[0]
    if (publisher) {
      // Membership names a stable location. Its signed route authorization
      // can be projected without walking every location bag; the member's
      // reader and the route itself verify the bag's current marker.
      const index = await read(publisher.pubkey)
      if (!SIG_RE.test(String(index?.roots?.[site.lineage] || '').toLowerCase())
        || !opensOn(index, site.lineage, door)) return
      const key = `${publisher.pubkey}:${site.lineage}:${door}`
      if (!offered.has(key)) offered.set(key, {
        kind: 'host:offering', title: site.title, route: `${url.protocol}//${door}/`,
        lineage: site.lineage, pubkey: publisher.pubkey,
        location: await poolAddress(door),
      })
    }
  }
  for (const [door, site] of Object.entries(bindings)) {
    if (!site.routed || (portal ? !withinZone(door, host) : door !== host)) continue
    await add(door, site)
  }
  if (portal && zones.includes(host)) {
    for (const publisher of bindings[host]?.publishers ?? []) {
      const index = await read(publisher.pubkey)
      if (!index) continue
      for (const [lineage, head] of Object.entries(index.roots)) {
        if (lineage === bindings[host].lineage) continue
        if (!DNS_LABEL_RE.test(lineage) || !SIG_RE.test(String(head || '').toLowerCase())) continue
        const door = `${lineage}.${host}`
        const resolved = resolveSite(scoped, door)
        if (resolved.implicit && resolved.site?.lineage === lineage) await add(door, resolved.site)
      }
    }
  } else if (!bindings[host]) {
    const resolved = resolveSite(scoped, host)
    if (resolved.implicit && resolved.site) await add(host, resolved.site)
  }
  const publisher = selectedHostPublisher(scoped, host)
  if (publisher) {
    const index = await read(publisher.pubkey)
    for (const [location, offer] of Object.entries(index?.offerings ?? {})) {
      if (offer.host !== host || !await activeCreation(scoped, host, location, read)) continue
      offered.set(`creation:${publisher.pubkey}:${location}`, creationMember(publisher.pubkey, location, offer))
    }
  }
  const encoder = new TextEncoder()
  const members = []
  for (const record of offered.values()) {
    const bytes = encoder.encode(JSON.stringify(record))
    const name = await sha256Hex(bytes)
    members.push({ name, bytes })
  }
  return members.sort((a, b) => a.name.localeCompare(b.name))
}

/** The signed index may publish many kinds of roots. Only route names the
 *  operator actually serves, with this key selected as publisher, get a
 *  location marker — the door's meta record (locationMeta), by host.
 *  Private and package pools never pass this route test. */
async function routeMetaForIndex(env, pubkey, evt) {
  const scoped = await bindingsEnv(env)
  const bindings = siteBindings(scoped)
  const zones = wildcardZones(bindings)
  const index = { ...JSON.parse(evt.content), createdAt: Number(evt.created_at || 0) }
  const found = new Map()
  for (const [host, site] of Object.entries(bindings)) {
    if (!site.routed || site.frontDoor) continue
    const selected = site.publishers.find(p => p.primary) || site.publishers[0]
    const head = String(index.roots[site.lineage] || '').toLowerCase()
    if (selected?.pubkey === pubkey && SIG_RE.test(head) && opensOn(index, site.lineage, host)) {
      found.set(host, locationMeta(site, pubkey, head, index))
    }
  }
  for (const zone of zones) {
    const selected = bindings[zone].publishers.find(p => p.primary) || bindings[zone].publishers[0]
    if (selected?.pubkey !== pubkey) continue
    for (const [lineage, rawHead] of Object.entries(index.roots)) {
      if (!DNS_LABEL_RE.test(lineage) || lineage === 'content') continue
      const head = String(rawHead || '').toLowerCase()
      const host = `${lineage}.${zone}`
      const resolved = resolveSite(scoped, host)
      if (SIG_RE.test(head) && resolved.implicit && resolved.site?.lineage === lineage
        && opensOn(index, lineage, host)) found.set(host, locationMeta(resolved.site, pubkey, head, index))
    }
  }
  return found
}

async function advancePublishedLocations(env, pubkey, evt) {
  for (const [host, meta] of await routeMetaForIndex(env, pubkey, evt)) {
    if (!await advanceRouteMeta(env, host, meta)) return false
  }
  const scoped = await bindingsEnv(env)
  const { offerings = {} } = JSON.parse(evt.content)
  for (const [location, offer] of Object.entries(offerings)) {
    if (selectedHostPublisher(scoped, offer.host)?.pubkey !== pubkey) continue
    if (!PUBLIC_LEAF_MEANINGS.has(offer.meaning)) continue
    if (!await hasCreationHead(env, offer)
      || !await retainCreationMember(env, pubkey, location, offer)
      || !await advanceLocation(env, await creationBagLocation(offer.host, location), { layer: offer.head })) return false
  }
  return true
}

async function serveOfferingsPool(request, env, member) {
  const headers = { 'Cache-Control': member ? 'public, max-age=31536000, immutable' : 'no-store', ...CORS }
  if (member) {
    let found = null
    if (env.CONTENT?.get) {
      const held = await env.CONTENT.get(`${await poolAddress(HOST_OFFERINGS_MEANING)}/${member}`)
      if (held) {
        const bytes = new Uint8Array(await held.arrayBuffer())
        if (await sha256Hex(bytes) === member) found = { name: member, bytes }
      }
    }
    if (!found) found = (await offeredMembers(request, env)).find(row => row.name === member)
    return found
      ? new Response(request.method === 'HEAD' ? null : found.bytes, { status: 200, headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' } })
      : new Response(null, { status: 404, headers })
  }
  const members = await offeredMembers(request, env)
  return members.length
    ? new Response(request.method === 'HEAD' ? null : members.map(row => row.name).join('\n') + '\n', { status: 200, headers: { ...headers, 'Content-Type': 'text/plain; charset=utf-8' } })
    : new Response(null, { status: 404, headers })
}

async function servePoolListing(request, env, sig) {
  const headers = { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...CORS }
  if (!await listedPool(env, sig)) {
    return new Response(request.method === 'HEAD' ? null : 'no pool at this address\n', {
      status: 404, headers: { ...headers, 'X-Reason': 'no pool at this address' },
    })
  }
  const prefix = `${sig}/`
  const names = []
  if (env.CONTENT?.list) {
    let cursor
    do {
      const page = await env.CONTENT.list({ prefix, cursor, limit: 1000 })
      for (const obj of page.objects ?? []) {
        const name = String(obj.key ?? '').slice(prefix.length)
        if (name && !name.includes('/')) names.push(name)
      }
      cursor = page.truncated ? page.cursor : undefined
    } while (cursor)
  }
  // A PUBLIC POOL WITH NOTHING IN IT IS AN EMPTY LISTING, not a 404. Every
  // client derives these addresses and asks every door it follows, so a door
  // that publishes nothing is asked all the time — and a browser prints every
  // 404 to the console whatever the page does with it. An empty set is the
  // true answer and a quiet one (hypercomb.io, Update all, 2026-09-25).
  names.sort()
  const listing = names.length ? names.join('\n') + '\n' : ''
  return new Response(request.method === 'HEAD' ? null : listing, { status: 200, headers })
}

/** The shim host card, fetched from its static origin and answered as this
 *  domain's own page. Same path, same query; the origin is configuration. */
async function serveFrontDoor(request, env) {
  const origin = String(env.HOST_DOOR_ORIGIN || '').replace(/\/+$/, '')
  if (!origin.startsWith('https://')) return text(503, 'front door is not configured')
  const url = new URL(request.url)
  const upstream = await fetch(origin + url.pathname + url.search, {
    method: request.method,
    headers: { accept: request.headers.get('accept') || '*/*' },
  })
  const headers = new Headers(upstream.headers)
  headers.set('Access-Control-Allow-Origin', '*')
  return new Response(request.method === 'HEAD' ? null : upstream.body, { status: upstream.status, headers })
}

// Some byte mirrors also welcome people. This is a read-side shell on the
// same hostname, not a SITE_BINDINGS entry: the mirror's signed PUT, hive and
// content routes must keep working exactly as before.
function servesHostDoor(env, hostname) {
  return String(env.HOST_DOOR_HOSTS || '').split(/[\s,]+/)
    .some(host => host && host.toLowerCase() === hostname.toLowerCase())
}

// ── the sandbox door ─────────────────────────────────────────────────────
//
// A MODULE CHANGE IS TRIED IN PUBLIC BEFORE IT GOES LIVE (documentation/
// module-sandbox.md; jwize 2026-09-22). `module commit` in a hive uploads the
// new package to this heap and stamps `install:try-<change>` in the
// publisher's signed index. `try-<change>.<zone>` is its door: a full hive —
// the participant shell, not the read-only visitor — whose own origin names
// that package, so whoever opens it runs the change, reads its code, and can
// draft on top of it. The origin is the sandbox: its storage is its own and
// touches nobody's hive. Promotion is a pointer move elsewhere; withdrawing
// the key closes the door and leaves every file where it was.
//
// The door answers three things itself, and hands everything else to the
// participant shell (SANDBOX_SHELL_ORIGIN — the deployed web shell):
//   /content/<sign('host:packages')>/          the pool, one member
//   /content/<sign('host:packages')>/00000000  `<root>\n<label>`
//   /content/<sig>                             the package's files, from the heap
//   /content/<sign('transfer:packs')>/<root>   the package's transfer pack, if named
//   /<sign(<door host>)>/000x                  what the door is: who published it, and what
//   /<sign('assess:<root>')>/<pubkey>          who assessed it, re-verified as read
const SANDBOX_LABEL_RE = /^try-[a-z0-9](?:[a-z0-9-]{0,55}[a-z0-9])?$/
const HOST_PACKAGES_MEANING = 'host:packages'
// One member per package, named by its root and holding its transfer pack's
// signature (hypercomb-runtime transfer-pack.ts). The door answers it from the
// publisher's `pack:try-<change>`, so only the publisher's key can move it.
const TRANSFER_PACKS_MEANING = 'transfer:packs'

/** The approved publisher whose signed index names this sandbox, and its root. */
async function sandboxRoot(env, site, selected, read = indexReader(env)) {
  const channel = `install:${site.lineage}`
  const publishers = selected ? site.publishers.filter((p) => p.pubkey === selected) : site.publishers
  for (const publisher of publishers) {
    const index = await read(publisher.pubkey)
    const root = String(index?.roots?.[channel] || '').toLowerCase()
    if (!SIG_RE.test(root)) continue
    // Beside the sandbox, the change as a reader needs it and the host AI's
    // reading of it (essentials module-review.ts) — public, by signature.
    const beside = (key) => { const sig = String(index?.roots?.[key] || '').toLowerCase(); return SIG_RE.test(sig) ? sig : null }
    return { root, pubkey: publisher.pubkey, label: publisher.label || '', publishedAt: index.createdAt, change: beside(`change:${site.lineage}`), review: beside(`review:${site.lineage}`), jev: beside(`jev:${site.lineage}`), pack: beside(`pack:${site.lineage}`) }
  }
  return null
}

/** THE ONE PACKAGE A HOST NAME RUNS, answered as its `host:packages` pool
 *  (one member: the root and its name) and its transfer pack. A door answers
 *  it from `install:try-<change>`; a promoted site from `install:<site>`.
 *  Any other path is not this answer's (null). */
async function answerPackage(request, url, found, lineage) {
  const pool = await poolAddress(HOST_PACKAGES_MEANING)
  const plain = { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...CORS }
  const body = (value) => (request.method === 'HEAD' ? null : value)
  if (url.pathname === `/content/${pool}/`) return new Response(body('00000000\n'), { status: 200, headers: plain })
  if (url.pathname === `/content/${pool}/00000000`) return new Response(body(`${found.root}\n${lineage}`), { status: 200, headers: plain })
  if (url.pathname.startsWith(`/content/${pool}/`)) return new Response(body('not a member\n'), { status: 404, headers: plain })
  // THE TRANSFER PACK: a cold visitor asks for it by the root it is installing,
  // so it is answered for the root this name serves and for no other. A hint —
  // a name with none says so, and the visitor installs file by file.
  const packs = await poolAddress(TRANSFER_PACKS_MEANING)
  if (url.pathname === `/content/${packs}/${found.root}` && found.pack) return new Response(body(found.pack), { status: 200, headers: plain })
  if (url.pathname.startsWith(`/content/${packs}/`)) return new Response(body('no pack\n'), { status: 404, headers: plain })
  return null
}

/** WHAT A PROMOTED SITE RUNS (jwize 2026-09-24: "try.yoursub.domain.com then
 *  when deployed will be on yoursub.domain.com"). `module promote <change>`
 *  stamps the trial's root as `install:<change>` in the publisher's signed
 *  index, so `<change>.<zone>` runs the package `try-<change>.<zone>` ran —
 *  the same signature, moved by one pointer. Read from the publisher the
 *  site's hive is read from; none stamped ⇒ the visitor engine's own package. */
/** Is this site open, and what package does it run? A page asks fresh and
 *  leaves the answer for its host; the bundled, content-addressed assets the
 *  page then pulls reuse it for SITE_TTL_MS instead of re-reading indexes. */
const openSites = new Map()
async function siteOpen(env, site, read, host, reuse) {
  const key = host.toLowerCase()
  const held = openSites.get(key)
  if (reuse && held && Date.now() - held.at < SITE_TTL_MS && held.content === env.CONTENT && held.hives === env.HIVES?.get) return held
  const open = await anyPublishedRoot(env, site, read, host)
  const promoted = open ? await sitePackage(env, site, read) : null
  const answer = { open, promoted, at: Date.now(), content: env.CONTENT, hives: env.HIVES?.get }
  openSites.set(key, answer)
  return answer
}

/** The head of the package pool this page installs from — the newest
 *  host:packages marker, as ensureInstall would read it: the promoted
 *  package's member, or the bundle's own. */
async function installPointer(request, env, site, promoted) {
  const pool = await poolAddress(HOST_PACKAGES_MEANING)
  if (promoted) return { pool, marker: '00000000', text: `${promoted.root}\n${site.lineage}` }
  if (!env.ASSETS?.fetch) return null
  try {
    const url = new URL(request.url)
    url.search = ''
    url.pathname = `/content/${pool}/`
    const listing = await env.ASSETS.fetch(new Request(url))
    if (!listing.ok) return null
    const marker = (await listing.text()).split(/\r?\n/).map((name) => name.trim())
      .filter((name) => ROUTE_MARKER_RE.test(name)).sort().at(-1)
    if (!marker) return null
    url.pathname = `/content/${pool}/${marker}`
    const entry = await env.ASSETS.fetch(new Request(url))
    if (!entry.ok) return null
    const text = await entry.text()
    if (text.includes('<')) return null
    const modified = entry.headers.get('last-modified')
    return { pool, marker, text, ...(modified ? { at: modified } : {}) }
  } catch { return null }
}

async function sitePackage(env, site, read = indexReader(env)) {
  const publisher = site.publishers?.find(p => p.primary) || site.publishers?.[0]
  if (!publisher) return null
  const index = await read(publisher.pubkey)
  const sig = (key) => { const value = String(index?.roots?.[key] || '').toLowerCase(); return SIG_RE.test(value) ? value : null }
  const root = sig(`install:${site.lineage}`)
  return root ? { root, pack: sig(`pack:${site.lineage}`) } : null
}

async function serveSandbox(request, env, site, zone) {
  const url = new URL(request.url)
  const found = await sandboxRoot(env, site, String(url.searchParams.get('publisher') || '').toLowerCase())
  if (!found) return nothingHere(url.hostname, zone)
  const answered = await answerPackage(request, url, found, site.lineage)
  if (answered) return answered
  const plain = { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...CORS }
  const body = (value) => (request.method === 'HEAD' ? null : value)
  const moduleMatch = url.pathname.match(/^\/content\/([0-9a-f]{64})$/)
  if (moduleMatch) return serveModule(request, env, moduleMatch[1])
  if (url.pathname.startsWith('/content/')) return new Response(body('not held\n'), { status: 404, headers: plain })
  return serveSandboxShell(request, env, zone)
}

// ── public assessments (documentation/module-sandbox.md) ─────────────────
//
// ANYONE MAY ASSESS A SANDBOX, under their own key: an assessment is a record
// in the heap (verdict + a note, both by signature) that the assessor names in
// their OWN signed index as `assess:<package root>`. The signature on their
// index is the signature on the assessment. The door lists every assessment
// of its root, so the index write keeps a derived list of who assessed which
// root — never trusted on its own: every listed assessor's index is read and
// re-verified, and one who dropped the key is simply not shown.
const ASSESS_KEY_RE = /^assess:([0-9a-f]{64})$/
const ASSESS_VERDICTS = new Set(['accept', 'refuse', 'unclear'])
const JEV_VERDICTS = new Set(['follows', 'unsure', 'breaks'])
const ASSESSMENTS_SHOWN = 50

async function noteAssessors(env, pubkey, evt) {
  let roots = {}
  try { roots = JSON.parse(evt.content)?.roots ?? {} } catch { return }
  for (const key of Object.keys(roots)) {
    const root = ASSESS_KEY_RE.exec(key)?.[1]
    if (!root) continue
    // A member of the root's pool, named by the assessor's key. Membership
    // only: what they said is read, and re-verified, from their index.
    await addPoolMember(env, `assess:${root}`, pubkey)
  }
}

// ── the community's translations (documentation/community-translations.md)
//
// A TRANSLATOR names a catalog in their OWN signed index as `i18n:<locale>`;
// a hive that lacks keys names its list as `i18n-missing:<locale>`. The index
// write keeps one derived list per locale of who did each — never trusted on
// its own: every listed index is read and re-verified when the locale is
// served, and a key that was dropped is simply not shown. The locale's index
// is answered at the pool's own derived address `sign('i18n:<locale>')` —
// the one-file index every published pool uses — so a hive computes where to
// look. There is no named route (jwize 2026-09-25).
const I18N_KEY_RE = /^i18n:([a-z]{2,3}(?:-[a-z0-9]{2,8})?)$/
const I18N_MISSING_KEY_RE = /^i18n-missing:([a-z]{2,3}(?:-[a-z0-9]{2,8})?)$/
const I18N_LOCALE_RE = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/
const I18N_SHOWN = 64

// Who translated a locale and who lacks it are members of the locale's pools,
// sign('i18n:<locale>') and sign('i18n-missing:<locale>'), named by the key;
// the locales this host has heard of are members of sign('i18n:locales'). The
// KV lists that held them before are read as drain sources, never written.
async function noteTranslators(env, pubkey, evt) {
  let roots = {}
  try { roots = JSON.parse(evt.content)?.roots ?? {} } catch { return }
  for (const key of Object.keys(roots)) {
    const translator = I18N_KEY_RE.exec(key)?.[1]
    const missing = I18N_MISSING_KEY_RE.exec(key)?.[1]
    const locale = translator ?? missing
    if (!locale) continue
    await addPoolMember(env, translator ? `i18n:${locale}` : `i18n-missing:${locale}`, pubkey)
    await addPoolMember(env, 'i18n:locales', locale)
  }
}

/** The keys a locale's pool holds, with the KV list it replaced drained in. */
async function localeMembers(env, meaning, legacyKey) {
  const keys = new Set([...await drainedList(env, legacyKey), ...await poolMemberNames(env, meaning)])
  return [...keys].filter((pk) => SIG_RE.test(pk)).slice(-I18N_SHOWN)
}

/** The locale a pool address stands for, when it is one this host has heard of. */
async function localeAtAddress(env, sig) {
  const locales = new Set([...await drainedList(env, 'i18n:locales'), ...await poolMemberNames(env, 'i18n:locales')])
  for (const locale of locales) {
    if (I18N_LOCALE_RE.test(String(locale)) && (await poolAddress(`i18n:${locale}`)) === sig) return locale
  }
  return null
}

async function serveTranslations(request, env, locale) {
  if (!I18N_LOCALE_RE.test(String(locale || ''))) return text(404, 'not found')
  const read = indexReader(env)
  const labels = new Map()
  for (const zone of Object.values(siteBindings(env))) for (const p of zone.publishers ?? []) if (p.label) labels.set(p.pubkey, p.label)
  const translators = []
  for (const pubkey of await localeMembers(env, `i18n:${locale}`, `translators:${locale}`)) {
    const index = await read(pubkey)
    const sig = String(index?.roots?.[`i18n:${locale}`] || '').toLowerCase()
    const record = await heapRecord(env, sig)
    if (record?.kind !== 'i18n-catalog' || record.locale !== locale) continue
    translators.push({ pubkey, label: labels.get(pubkey) || '', catalog: sig, at: Number(index.createdAt || 0) })
  }
  const missing = []
  for (const pubkey of await localeMembers(env, `i18n-missing:${locale}`, `missing:${locale}`)) {
    const index = await read(pubkey)
    const sig = String(index?.roots?.[`i18n-missing:${locale}`] || '').toLowerCase()
    const record = await heapRecord(env, sig)
    if (record?.kind !== 'i18n-missing' || record.locale !== locale) continue
    missing.push({ pubkey, record: sig, keys: (Array.isArray(record.keys) ? record.keys : []).filter((k) => typeof k === 'string').slice(0, 2000), at: Number(index.createdAt || 0) })
  }
  return json(200, { meaning: `i18n:${locale}`, locale, members: translators.map((t) => t.catalog), translators, missing }, { 'Cache-Control': 'no-store' })
}

/** A small JSON record from the heap, or null. */
async function heapRecord(env, sig) {
  if (!SIG_RE.test(String(sig || ''))) return null
  try {
    const obj = await env.CONTENT.get(sig)
    return obj ? JSON.parse(new TextDecoder().decode(await obj.arrayBuffer())) : null
  } catch { return null }
}

/** Who assessed a root: the members of its pool, sign('assess:<root>'), each
 *  named by the assessor's key. The KV list kept before assessors were a pool
 *  is read as a drain source and never written. */
async function assessorsOf(env, root) {
  const keys = new Set([...await drainedList(env, `assessors:${root}`), ...await poolMemberNames(env, `assess:${root}`)])
  return [...keys].filter((pubkey) => SIG_RE.test(pubkey))
}

/** Every current, signed assessment of a package root, newest last. Every
 *  assessor's index is read and re-verified; one who dropped the key is not shown. */
async function assessmentsOf(env, root, read) {
  const out = []
  for (const pubkey of await assessorsOf(env, root)) {
    const index = await read(pubkey)
    const record = String(index?.roots?.[`assess:${root}`] || '').toLowerCase()
    const body = await heapRecord(env, record)
    if (body?.kind !== 'module-assessment' || body.root !== root) continue
    out.push({ pubkey, record, verdict: ASSESS_VERDICTS.has(body.verdict) ? body.verdict : 'unclear', at: Number(index.createdAt || 0) })
  }
  return out.sort((a, b) => a.at - b.at).slice(-ASSESSMENTS_SHOWN)
}

/** WHAT A SANDBOX DOOR IS — the record in its own bag, sign(<try-host>): the
 *  door's twin of locationMeta. The door answers from the publisher's signed
 *  index; the bag is where a reader finds that answer, by signature. */
function sandboxMeta(site, found) {
  return {
    sandbox: true,
    layer: found.root,
    pubkey: found.pubkey,
    lineage: site.lineage,
    title: site.lineage,
    channel: `install:${site.lineage}`,
    ...(found.label ? { publisher: found.label } : {}),
    ...(found.change ? { change: found.change } : {}),
    ...(found.review ? { review: found.review } : {}),
    ...(found.jev ? { jev: found.jev } : {}),
    ...(found.pack ? { pack: found.pack } : {}),
    publishedAt: Number(found.publishedAt || 0),
  }
}

/** A sandbox door's two pools, by signature: its own bag (what it is) and
 *  sign('assess:<root>') (who assessed what it runs). The bag is kept current
 *  as it is read — a record that no longer says what the signed index says
 *  gains a successor, nothing rewritten. Null for any other address. */
async function serveSandboxPools(request, env, site, pool, member) {
  const host = new URL(request.url).hostname.toLowerCase()
  const found = await sandboxRoot(env, site, '')
  if (!found) return null
  const none = () => new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store', ...CORS } })
  const body = (value) => (request.method === 'HEAD' ? null : value)
  const listing = (names) => new Response(body(names.length ? names.join('\n') + '\n' : ''), {
    status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...CORS },
  })
  const record = (value, cache) => new Response(body(JSON.stringify(value)), {
    status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cache, ...CORS },
  })
  if (pool === await poolAddress(host)) {
    if (member && !ROUTE_MARKER_RE.test(member)) return none()
    await advanceLocation(env, pool, sandboxMeta(site, found))
    const names = await locationMarkers(env, pool)
    if (!names?.length) return none()
    if (!member) return listing(names)
    const held = names.includes(member) ? await locationRecord(env, pool, member) : null
    return held ? record(held, 'public, max-age=31536000, immutable') : none()
  }
  if (pool === await poolAddress(`assess:${found.root}`)) {
    const assessed = await assessmentsOf(env, found.root, indexReader(env))
    if (!member) return listing(assessed.map((a) => a.pubkey))
    const one = assessed.find((a) => a.pubkey === member)
    return one ? record(one, 'no-store') : none()
  }
  return null
}

// ── the trials on a zone (documentation/module-sandbox.md, "The communal build")
//
// EVERY OPEN TRIAL, LISTED FROM WHAT ITS DOOR SERVES. A trial is an
// `install:try-<change>` key in the verified index of a publisher the zone
// approves; its door is `try-<change>.<zone>`. Each candidate goes through
// resolveSite and sandboxRoot — the two reads the door itself makes — so the
// listing never names a door that answers "nothing here", and where two
// publishers name one trial it lists the one the door serves. Beside each: the
// source files its change touched, the paths it turned off and what it took
// from other builds (the change record), when it was committed, and how the
// host's AI and Jev read it. People's
// assessments stay in each door's sign('assess:<root>') pool, re-verified as read.
const TRIALS_SHOWN = 100

async function serveTrials(request, env, zone) {
  const url = new URL(request.url)
  const bindings = siteBindings(env)
  const trials = []
  if (wildcardZones(bindings).includes(zone)) {
    const read = indexReader(env)
    const listed = new Set()
    const paths = (list) => (Array.isArray(list) ? list : []).filter((path) => typeof path === 'string' && path).slice(0, 20)
    for (const publisher of bindings[zone].publishers) {
      const index = await read(publisher.pubkey)
      for (const key of Object.keys(index?.roots ?? {})) {
        const name = key.startsWith('install:') ? key.slice('install:'.length) : ''
        if (!SANDBOX_LABEL_RE.test(name) || listed.has(name) || trials.length >= TRIALS_SHOWN) continue
        const resolved = resolveSite(env, `${name}.${zone}`)
        if (!resolved.implicit || resolved.zone !== zone) continue
        const found = await sandboxRoot(env, resolved.site, '', read)
        if (!found) continue
        listed.add(name)
        const [change, review, jev] = await Promise.all([
          found.change ? heapRecord(env, found.change) : null,
          found.review ? heapRecord(env, found.review) : null,
          found.jev ? heapRecord(env, found.jev) : null,
        ])
        trials.push({
          name, door: `${url.protocol}//${name}.${zone}${url.port ? ':' + url.port : ''}`,
          package: found.root, pubkey: found.pubkey, publisher: found.label,
          at: Number.isFinite(change?.at) ? change.at : null,
          sections: paths(Array.isArray(change?.changes) ? change.changes.map((file) => file?.section) : []),
          off: paths(change?.off),
          taken: (Array.isArray(change?.taken) ? change.taken : []).filter((pick) => typeof pick?.path === 'string' && pick.path && SIG_RE.test(String(pick?.root || ''))).slice(0, 20).map((pick) => ({ path: pick.path, root: pick.root })),
          ...(found.change ? { change: found.change } : {}),
          ...(found.review ? { review: found.review, reviewVerdict: ASSESS_VERDICTS.has(review?.verdict) ? review.verdict : 'unclear' } : {}),
          ...(found.jev ? { jev: found.jev, jevVerdict: JEV_VERDICTS.has(jev?.verdict) ? jev.verdict : 'unsure' } : {}),
        })
      }
    }
  }
  trials.sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
  return json(200, { zone, trials }, { 'Cache-Control': 'no-store' })
}

// A LOOPBACK ZONE is this machine (scripts/local-content-host.mjs): there a
// door and its zone's content face speak plain http.
const LOOPBACK_ZONE_RE = /^(?:[a-z0-9-]+\.)*localhost$/
// No device for any page this worker serves — a published site or a door.
const PERMISSIONS_POLICY = 'camera=(), microphone=(), geolocation=(), payment=(), usb=()'

/** The participant shell, fetched from where it is deployed. https only, but
 *  a loopback origin on http, for proving the door on one machine.
 *
 *  THE DOOR'S OWN POLICY, on every response it sends. The publisher's package
 *  runs here with full page power, so the page is held to what a hive needs:
 *  it reaches https and wss hosts — on a loopback zone also exactly that
 *  zone's two http faces, never a bare http: or ws: that would open the
 *  visitor's own machine (a local model, the bridge) — it is never framed,
 *  posts no form, takes no device and keeps no cookie. Scripts are left alone
 *  on purpose: the shell injects an import map and loads its bees as blob:
 *  modules, and a script-src would stop the boot. */
async function serveSandboxShell(request, env, zone) {
  const origin = String(env.SANDBOX_SHELL_ORIGIN || '').replace(/\/+$/, '')
  const loopback = /^http:\/\/((?:[a-z0-9-]+\.)*localhost|127(?:\.\d+){3})(:\d{1,5})?$/i.test(origin)
  const url = new URL(request.url)
  const upstream = origin.startsWith('https://') || loopback
    ? await fetch(origin + url.pathname + url.search, {
      method: request.method,
      headers: { accept: request.headers.get('accept') || '*/*' },
    })
    : text(503, 'the sandbox shell is not configured')
  const headers = new Headers(upstream.headers)
  headers.delete('content-encoding')
  headers.delete('content-length')
  const port = url.port ? `:${url.port}` : ''
  const local = LOOPBACK_ZONE_RE.test(String(zone || '')) ? ` http://${zone}${port} http://content.${zone}${port}` : ''
  // worker-src keeps a data: worker (an opaque origin) out; blob: and the
  // shell's own scripts are what a hive's workers are made of.
  headers.set('Content-Security-Policy', `connect-src 'self' https: wss: blob: data:${local}; worker-src 'self' blob:; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'none'`)
  headers.set('Permissions-Policy', PERMISSIONS_POLICY)
  headers.set('Referrer-Policy', 'no-referrer')
  headers.set('Cross-Origin-Opener-Policy', 'same-origin')
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.delete('set-cookie')
  return new Response(request.method === 'HEAD' ? null : upstream.body, { status: upstream.status, headers })
}

/** The door's record as page data: JSON with every '<' escaped, so no value
 *  can close the script element. */
function doorScript(record, id = 'hc-door') {
  return `<script id="${id}" type="application/json">${JSON.stringify(record).replace(/</g, '\\u003c')}</script>`
}

/** Past this a publisher's signed index stays off the page and is fetched. */
const PAGE_INDEX_MAX = 65_536

/** The signed index event as page data, exactly its bytes with '<' escaped —
 *  a JSON escape, so the event still verifies byte for byte once parsed. */
function indexScript(raw) {
  return `<script id="hc-index" type="application/json">${raw.replace(/</g, '\\u003c')}</script>`
}

async function serveVisitorAsset(request, env, { spa = true, door = null, install = null, index = null } = {}) {
  if (!env.ASSETS?.fetch) return text(503, 'visitor engine is not deployed')
  let response = await env.ASSETS.fetch(request)
  // Under /content/ a miss is a miss. The engine walks its package pool by
  // marker until the first gap; a page of HTML where a marker should be reads
  // as a member that will not parse, and the old 307 to / read as a host that
  // does not answer.
  if (response.status === 404 && !spa) return text(404, 'not in this package')
  if (response.status === 404) {
    const url = new URL(request.url)
    url.pathname = '/index.html'
    response = await env.ASSETS.fetch(new Request(url, request))
  }
  const headers = new Headers(response.headers)
  headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; frame-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'none'")
  headers.set('Permissions-Policy', PERMISSIONS_POLICY)
  headers.set('Referrer-Policy', 'no-referrer')
  headers.set('X-Content-Type-Options', 'nosniff')
  // A door exists to be pulled FROM. The visitor engine's own assets — the
  // package manifest and the atoms under /content/ above all — are public,
  // immutable and reader-verified, so no request's origin changes the answer;
  // without this header a hive replicating from another origin died as an
  // opaque "Failed to fetch" and the door read as publishing nothing.
  headers.set('Access-Control-Allow-Origin', '*')
  if (door && response.status === 200 && String(response.headers.get('content-type') || '').includes('text/html')) {
    const html = await response.text()
    const at = html.indexOf('</head>')
    if (at >= 0) {
      headers.delete('Content-Length')
      headers.set('Cache-Control', 'no-store')
      const body = html.slice(0, at) + doorScript(door) + (install ? doorScript(install, 'hc-install') : '') + (index ? indexScript(index) : '') + html.slice(at)
      return new Response(request.method === 'HEAD' ? null : body, { status: 200, headers })
    }
    return new Response(request.method === 'HEAD' ? null : html, { status: 200, headers })
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

// ── responses ────────────────────────────────────────────────────────────────

// Permissive CORS on everything: content is public, uploaders come from any
// origin (hypercomb.io, operator domains, other Blossom clients).
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, PUT, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Range, X-SHA-256, X-Content-Length',
  'Access-Control-Expose-Headers': 'ETag, Accept-Ranges, Content-Range, Content-Length, X-Reason',
  'Access-Control-Max-Age': '86400',
}

// DOORS WRITE NOTHING (documentation/module-sandbox.md). A sandbox door runs
// its publisher's package with full page power, so a request whose Origin is a
// door — a `try-` first label, on any zone — is told only the reads it may
// make: the router refuses it every write, and its preflight advertises none.
const DOOR_CORS = { ...CORS, 'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS' }

// An OPAQUE origin (`Origin: null`) is treated as a door too: it is what a
// sandboxed srcdoc frame or a data: worker the package opens sends, and no
// writer of ours sends it (the CLI and native clients send no Origin; shells
// have real ones). The limit, said plainly: this stops writes made FROM the
// browser. A signature the package coaxes out of an extension can be replayed
// from elsewhere, so the extension's own prompt — and the door bar's "refuse
// prompts here" — stay the real guard for that.
function fromSandboxDoor(request) {
  const origin = request.headers.get('origin')
  if (origin === 'null') return true
  try { return SANDBOX_LABEL_RE.test(new URL(origin).hostname.split('.')[0]) } catch { return false }
}

// Immutable forever — content-addressed bytes can never change under a sig.
const IMMUTABLE = 'public, max-age=31536000, immutable'

// Plain-text response. The message rides X-Reason too (BUD-06's error
// channel — HEAD responses have no body, so the header carries the why).
function text(status, msg) {
  return new Response(msg + '\n', {
    status,
    // Header values are ByteStrings. Keep the UTF-8 prose in the body and an
    // ASCII-safe equivalent in BUD-06's HEAD/error channel.
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Reason': String(msg).replace(/[^\x20-\x7e]/g, '-'),
      ...CORS,
    },
  })
}

function json(status, obj, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS, ...extraHeaders },
  })
}

// ── crypto ───────────────────────────────────────────────────────────────────

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// NIP-01 event verification: id = sha256 of the canonical serialization,
// sig = BIP-340 schnorr over the id. Both checked — an event whose id
// doesn't match its own content is a forgery regardless of the signature.
async function verifyEventSig(evt) {
  if (!evt || typeof evt !== 'object') return false
  if (!SIG_RE.test(String(evt.pubkey || ''))) return false
  if (!/^[0-9a-f]{128}$/i.test(String(evt.sig || ''))) return false
  if (!Array.isArray(evt.tags) || typeof evt.content !== 'string') return false
  const serial = JSON.stringify([0, evt.pubkey, evt.created_at, evt.kind, evt.tags, evt.content])
  const id = await sha256Hex(new TextEncoder().encode(serial))
  if (String(evt.id || '').toLowerCase() !== id) return false
  try { return schnorr.verify(evt.sig, id, evt.pubkey) } catch { return false }
}

// ── auth events ──────────────────────────────────────────────────────────────

function tagValue(evt, name) {
  return (evt.tags.find((t) => Array.isArray(t) && t[0] === name) || [])[1]
}

function tagValues(evt, name) {
  return evt.tags.filter((t) => Array.isArray(t) && t[0] === name).map((t) => String(t[1] ?? ''))
}

// Authorization: Nostr <base64(event JSON)> — shared envelope for both
// dialects. base64 payload is UTF-8 (clients btoa an encodeURIComponent'd
// string), so decode bytes properly, not via raw atob charcodes-as-text.
function parseAuthEvent(request) {
  const header = String(request.headers.get('authorization') || '').trim()
  const m = /^Nostr\s+(.+)$/i.exec(header)
  if (!m) return null
  try {
    const raw = Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0))
    return JSON.parse(new TextDecoder().decode(raw))
  } catch { return null }
}

// Dialect 1 — NIP-98 (kind 27235), the hypercomb host-sync shape.
// Binds method + full URL + freshness. The payload tag is verified WHEN
// PRESENT; the deployed HostSyncService signs only [u, method] tags, and
// the body is bound implicitly anyway — the URL sig == sha256(body) is
// enforced by the caller (same reasoning as relay.js's writer auth).
async function verifyNip98(request, evt, expectedMethod = 'PUT') {
  if (!evt) return { ok: false, reason: 'missing Nostr authorization header' }
  if (Number(evt.kind) !== NIP98_KIND) return { ok: false, reason: 'wrong auth event kind (expected NIP-98 27235)' }
  if (!(await verifyEventSig(evt))) return { ok: false, reason: 'invalid auth event signature' }
  const now = Math.floor(Date.now() / 1000)
  if (Math.abs(now - Number(evt.created_at || 0)) > AUTH_SKEW_SECS) return { ok: false, reason: 'auth token outside freshness window' }
  if (String(tagValue(evt, 'method') || '').toUpperCase() !== expectedMethod) return { ok: false, reason: 'auth method tag mismatch' }
  let signedUrl
  try { signedUrl = new URL(String(tagValue(evt, 'u'))).href } catch { return { ok: false, reason: 'auth u tag is not a URL' } }
  if (signedUrl !== new URL(request.url).href) return { ok: false, reason: 'auth u tag does not match request URL' }
  return { ok: true, pubkey: String(evt.pubkey).toLowerCase() }
}

// Dialect 2 — Blossom BUD-02 (kind 24242): t tag 'upload', at least one
// x tag equal to sha256(body), expiration in the future, created_at not
// in the future. One event may authorize several blobs (multiple x tags).
async function verifyBud02(evt, bodyHash) {
  if (!evt) return { ok: false, reason: 'missing Nostr authorization header' }
  if (Number(evt.kind) !== BLOSSOM_KIND) return { ok: false, reason: 'wrong auth event kind (expected Blossom 24242)' }
  if (!(await verifyEventSig(evt))) return { ok: false, reason: 'invalid auth event signature' }
  const now = Math.floor(Date.now() / 1000)
  if (Number(evt.created_at || 0) > now + AUTH_SKEW_SECS) return { ok: false, reason: 'auth event created_at is in the future' }
  if (!(Number(tagValue(evt, 'expiration') || 0) > now)) return { ok: false, reason: 'auth event expired (or missing expiration tag)' }
  if (!tagValues(evt, 't').includes('upload')) return { ok: false, reason: "auth event missing t tag 'upload'" }
  if (!tagValues(evt, 'x').map((x) => x.toLowerCase()).includes(bodyHash)) return { ok: false, reason: 'no x tag matches the sha256 of the upload' }
  return { ok: true, pubkey: String(evt.pubkey).toLowerCase() }
}

// ── quota (the auto-grant guest list) ────────────────────────────────────────
//
// The guest list is a pool of meaning (jwize 2026-09-25: state lives only in
// pools of meaning): each key's grant { quotaBytes, usedBytes, expiresAt } is
// the member of sign('host:grants') named by the key. Never listed, so never
// public — only GET /grant hands a key its own row. The KV namespace (GRANTS)
// that held it before is read as a drain source and never written. Policy
// via env:
//   AUTO_GRANT           '1' (default) mints a grant on first valid upload
//   DEFAULT_QUOTA_BYTES  104857600 (100 MB)
//   GRANT_TTL_DAYS       90
//
// The quota is an anti-abuse throttle, not billing: a malicious uploader
// can waste granted bytes, never corrupt a reader (every read is sha256-
// gated at the client). Existing-object PUTs consume nothing — the bytes
// are already here. Under AUTO_GRANT an EXPIRED grant re-mints fresh, same
// as an unknown pubkey: the guest list forgets you, it doesn't ban you.
// With AUTO_GRANT off, missing and expired both close the door (403).
//
// Last write wins; two racing uploads can under-count briefly. Acceptable
// for a guest list — the ceiling holds on the next read.

const HOST_GRANTS_MEANING = 'host:grants'
const HOST_AI_METERS_MEANING = 'host:ai-meters'

/** A private ledger row: the member of sign(meaning) named by the key. Read
 *  from the pool; a row only the KV namespace holds is carried into the pool
 *  the first time it is read (the KV entry is left as it was). */
async function readLedger(env, meaning, member, drainKey) {
  const key = `${await poolAddress(meaning)}/${member}`
  try {
    const object = await env.CONTENT?.get?.(key)
    if (object) return JSON.parse(await object.text())
  } catch { /* unreadable row — try the drain source */ }
  let drained = null
  try { drained = drainKey ? ((await env.GRANTS?.get?.(drainKey)) ?? null) : null } catch { drained = null }
  if (drained === null) return null
  let row = null
  try { row = JSON.parse(drained) } catch { return null }
  if (row !== null && env.CONTENT?.put) {
    try {
      await env.CONTENT.put(key, drained, { onlyIf: new Headers({ 'If-None-Match': '*' }),
        httpMetadata: { contentType: 'application/json; charset=utf-8' } })
    } catch { /* carried next time */ }
  }
  return row
}

async function writeLedger(env, meaning, member, row) {
  await env.CONTENT.put(`${await poolAddress(meaning)}/${member}`, JSON.stringify(row), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
  })
}

const readGrant = (env, pubkey) => readLedger(env, HOST_GRANTS_MEANING, pubkey, pubkey)

function policy(env) {
  return {
    autoGrant: String(env.AUTO_GRANT ?? '1') === '1',
    defaultQuota: Number(env.DEFAULT_QUOTA_BYTES ?? 104_857_600),
    ttlDays: Number(env.GRANT_TTL_DAYS ?? 90),
  }
}

// Would this pubkey be allowed to store `size` more bytes? Returns the
// (possibly freshly minted, NOT yet persisted) grant on ok — persistence
// happens in consume(), only after bytes actually land.
async function admit(env, pubkey, size) {
  const p = policy(env)
  const now = Math.floor(Date.now() / 1000)
  const held = await readGrant(env, pubkey)
  let grant = held && typeof held === 'object' ? held : null
  const expired = !!grant && Number(grant.expiresAt || 0) <= now
  if (!grant || expired) {
    if (!p.autoGrant) {
      return {
        ok: false, kind: expired ? 'expired' : 'missing',
        reason: expired
          ? 'your hosting grant has expired — ask the operator for a renewal'
          : 'no hosting grant for this key and auto-grants are off — ask the operator for one',
      }
    }
    grant = { quotaBytes: p.defaultQuota, usedBytes: 0, expiresAt: now + p.ttlDays * 86_400 }
  }
  if (Number(grant.usedBytes || 0) + size > Number(grant.quotaBytes || 0)) {
    return { ok: false, kind: 'exhausted', reason: 'hosting quota used up — this key has no room left for new bytes' }
  }
  return { ok: true, grant }
}

async function consume(env, pubkey, grant, size) {
  grant.usedBytes = Number(grant.usedBytes || 0) + size
  await writeLedger(env, HOST_GRANTS_MEANING, pubkey, grant)
}

// ── read side (BUD-01) ───────────────────────────────────────────────────────

function blobHeaders(sig, obj, contentLength) {
  return {
    'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream',
    'Content-Length': String(contentLength),
    'ETag': `"${sig}"`,
    'Accept-Ranges': 'bytes',
    'Cache-Control': IMMUTABLE,
    // The bytes are immutable but their MIME depends on what the REQUEST is
    // for (module imports get text/javascript) — cache per purpose.
    'Vary': 'Sec-Fetch-Dest',
    // Strangers' bytes must never become pages acting under this domain:
    // sandbox neuters scripts/forms/top-nav on anything a browser would
    // render (HTML/SVG/XML), nosniff stops type-guessing around it. Media,
    // JSON, and octet-stream consumers are unaffected — hive clients fetch
    // and hash-verify bytes; they never render this origin directly.
    'Content-Security-Policy': 'sandbox',
    'X-Content-Type-Options': 'nosniff',
    ...CORS,
  }
}

// A name suffix (`/<sig>/chrome.css`) declares the PRESENTATION type the way
// a module import does: content-addressed storage holds most bytes as
// octet-stream, and with nosniff the browser refuses those as stylesheets or
// images. sha256 gating is unchanged — the extension only picks the MIME.
const SUFFIX_TYPES = {
  css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8', json: 'application/json; charset=utf-8',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', ico: 'image/x-icon',
  woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf',
  mp3: 'audio/mpeg', mp4: 'video/mp4', webm: 'video/webm', wav: 'audio/wav',
  txt: 'text/plain; charset=utf-8', md: 'text/markdown; charset=utf-8',
}
function suffixType(pathname) {
  const dot = pathname.lastIndexOf('.')
  if (dot < 0) return null
  return SUFFIX_TYPES[pathname.slice(dot + 1).toLowerCase()] ?? null
}

async function serveBlob(request, env, sig, typeOverride) {
  // If-None-Match short-circuit, no R2 op. Content-addressing makes this
  // unconditionally correct: an ETag match means the client's cached bytes
  // hash to the sig — they ARE the content, whatever this bucket holds.
  const inm = String(request.headers.get('if-none-match') || '')
  if (inm.replace(/^W\//, '').replace(/"/g, '').toLowerCase() === sig) {
    return new Response(null, { status: 304, headers: { 'ETag': `"${sig}"`, 'Cache-Control': IMMUTABLE, ...CORS } })
  }

  const headersFor = (obj, len) => {
    const h = blobHeaders(sig, obj, len)
    if (typeOverride) h['Content-Type'] = typeOverride
    return h
  }

  if (request.method === 'HEAD') {
    const head = await env.CONTENT.head(sig)
    if (!head) return text(404, 'sig not held')
    return new Response(null, { status: 200, headers: headersFor(head, head.size) })
  }

  // Range per BUD-01: hand the Range header straight to R2; an
  // unsatisfiable/garbled range throws → 416 with the full size.
  const ranged = request.headers.has('range')
  let object
  try {
    object = await env.CONTENT.get(sig, ranged ? { range: request.headers } : undefined)
  } catch {
    const head = await env.CONTENT.head(sig)
    if (!head) return text(404, 'sig not held')
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${head.size}`, ...CORS } })
  }
  if (!object) return text(404, 'sig not held')

  if (ranged && object.range) {
    const size = object.size
    const offset = object.range.suffix != null ? size - object.range.suffix : (object.range.offset ?? 0)
    const length = object.range.suffix != null ? object.range.suffix : (object.range.length ?? size - offset)
    return new Response(object.body, {
      status: 206,
      headers: { ...headersFor(object, length), 'Content-Range': `bytes ${offset}-${offset + length - 1}/${size}` },
    })
  }
  return new Response(object.body, { status: 200, headers: headersFor(object, object.size) })
}

// /content/<sig> — a signed module import from the visitor engine. The same
// immutable blob as the flat read, re-typed: ES modules are refused by the
// browser unless the response carries a JavaScript MIME, and content-addressed
// storage often holds them as octet-stream (or worse, the SPA fallback served
// index.html here). sha256 gating is unchanged — the type is presentation.
async function serveModule(request, env, sig) {
  // The deployed renderer package ships its modules as extension-less
  // content/<sig> asset files — served first (edge-cached), but with no
  // extension the asset host guesses no MIME at all. Fall back to the R2
  // heap for modules that arrive by publish rather than by deploy.
  let response = null
  if (env.ASSETS?.fetch) {
    // The renderer package ships its modules as content/<sig> asset files;
    // probe that shape regardless of which URL shape the import used, so
    // flat-root module imports find deploy-shipped modules too.
    const assetUrl = new URL(request.url)
    assetUrl.pathname = `/content/${sig}`
    response = await env.ASSETS.fetch(new Request(assetUrl, request))
  }
  if (!response || response.status === 404) response = await serveBlob(request, env, sig)
  if (response.status !== 200 && response.status !== 206 && response.status !== 304) return response
  const headers = new Headers(response.headers)
  headers.set('Content-Type', 'text/javascript; charset=utf-8')
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

// ── write side ───────────────────────────────────────────────────────────────

// Shared store: existence → quota → put → meter. Returns a shape the two
// routes dress differently (plain text for /<sig>, BUD-02 descriptor for
// /upload). `size`/`type` reflect what the bucket holds after the call.
async function storeBlob(env, pubkey, sig, body, contentType) {
  const existing = await env.CONTENT.head(sig)
  if (existing) {
    // Same sig == same bytes — nothing to write, nothing to meter. But a
    // SECOND publisher now relies on them: mark the object shared, so the
    // first uploader's "remove from my hosts" can never take it away (see
    // forgetSigs). Rare — identical bytes from two keys — and one rewrite.
    const claim = existing.customMetadata ?? {}
    const type = existing.httpMetadata?.contentType || 'application/octet-stream'
    if (claim.owner && claim.owner !== pubkey && claim.shared !== '1') {
      const obj = await env.CONTENT.get(sig)
      if (obj) await env.CONTENT.put(sig, obj.body, { httpMetadata: { contentType: type }, customMetadata: { owner: claim.owner, shared: '1' } })
    }
    return { outcome: 'exists', size: existing.size, type }
  }
  const adm = await admit(env, pubkey, body.byteLength)
  if (!adm.ok) return { outcome: 'denied', kind: adm.kind, reason: adm.reason }
  const type = contentType || 'application/octet-stream'
  // THE CLAIM: who put these bytes here. Only an object its owner alone
  // claims can ever be forgotten; anything stored before claims existed has
  // none, and is never deleted.
  await env.CONTENT.put(sig, body, { httpMetadata: { contentType: type }, customMetadata: { owner: pubkey } })
  await consume(env, pubkey, adm.grant, body.byteLength)
  return { outcome: 'stored', size: body.byteLength, type }
}

// POST /forget — REMOVE FROM MY HOSTS (documentation/remove-from-my-hosts.md).
// A publisher (NIP-98, method POST) names sigs it no longer wants held. Each
// is deleted only when the publisher is its sole claimant: the object's owner
// is this key and no other publisher ever uploaded the same bytes. Unclaimed
// (stored before claims), shared, someone else's, or a head the publisher's
// own index still names: kept, with the reason. Deleting is the host
// forgetting — anyone who already holds the bytes keeps them.
const FORGET_MAX = 1000

async function forgetSigs(request, env) {
  const auth = await verifyNip98(request, parseAuthEvent(request), 'POST')
  if (!auth.ok) return text(401, auth.reason)
  let body
  try { body = await request.json() } catch { return text(400, 'body is not JSON') }
  const sigs = [...new Set((Array.isArray(body?.sigs) ? body.sigs : []).map((s) => String(s || '').toLowerCase()))]
    .filter((s) => SIG_RE.test(s))
  if (sigs.length === 0) return text(400, 'no sigs named')
  if (sigs.length > FORGET_MAX) return text(413, `at most ${FORGET_MAX} sigs per call`)
  const index = await verifiedIndex(env, auth.pubkey)
  const heads = new Set(Object.values(index?.roots ?? {}).map((s) => String(s).toLowerCase()))
  for (const offer of Object.values(index?.offerings ?? {})) {
    heads.add(offer.head)
    const metaBytes = await heldCreationBytes(env, offer.head, 65_536)
    if (metaBytes) {
      try {
        const meta = JSON.parse(new TextDecoder().decode(metaBytes))
        if (SIG_RE.test(String(meta?.layer || ''))) heads.add(meta.layer)
      } catch { /* A malformed head cannot name a protected layer. */ }
    }
  }
  const removed = []
  const kept = {}
  for (const sig of sigs) {
    if (heads.has(sig)) { kept[sig] = 'still-open'; continue }
    const head = await env.CONTENT.head(sig)
    if (!head) { kept[sig] = 'not-held'; continue }
    const claim = head.customMetadata ?? {}
    if (!claim.owner) { kept[sig] = 'unclaimed'; continue }
    if (claim.owner !== auth.pubkey) { kept[sig] = 'not-yours'; continue }
    if (claim.shared === '1') { kept[sig] = 'shared'; continue }
    await env.CONTENT.delete(sig)
    removed.push(sig)
  }
  return json(200, { removed, kept }, { 'Cache-Control': 'no-store' })
}

// PUT /<sig> — hypercomb host-sync shape (NIP-98). The URL names the
// content; sha256(body) must equal it.
async function putSig(request, env, sig) {
  const evt = parseAuthEvent(request)
  const auth = await verifyNip98(request, evt)
  if (!auth.ok) return text(401, auth.reason)

  const body = await request.arrayBuffer()
  const actual = await sha256Hex(body)
  if (actual !== sig) return text(400, `hash mismatch: sha256(body)=${actual.slice(0, 12)}… != ${sig.slice(0, 12)}…`)
  const payload = tagValue(evt, 'payload')
  if (payload != null && String(payload).toLowerCase() !== actual) return text(401, 'auth payload tag does not match body sha256')

  const stored = await storeBlob(env, auth.pubkey, sig, body, request.headers.get('content-type'))
  if (stored.outcome === 'denied') return text(403, stored.reason)
  if (stored.outcome === 'exists') return text(200, `already held ${sig}`)
  return text(201, `stored ${sig}`)
}

// PUT /upload — Blossom BUD-02. The x tag names the content; sha256(body)
// must be among the x tags. Responds with a blob descriptor either way
// (an existing blob is a successful upload that cost nothing).
async function putUpload(request, env) {
  const evt = parseAuthEvent(request)
  const body = await request.arrayBuffer()
  const sig = await sha256Hex(body)
  const auth = await verifyBud02(evt, sig)
  if (!auth.ok) return text(401, auth.reason)

  const stored = await storeBlob(env, auth.pubkey, sig, body, request.headers.get('content-type'))
  if (stored.outcome === 'denied') return text(403, stored.reason)
  return json(200, {
    url: new URL(request.url).origin + '/' + sig,
    sha256: sig,
    size: stored.size,
    type: stored.type,
    uploaded: Math.floor(Date.now() / 1000),
  })
}

// HEAD /upload — BUD-06 preflight: would this upload be accepted? Nothing
// is stored, no grant is minted (minting waits for real bytes). The verdict
// rides the status + X-Reason header (HEAD has no body).
async function headUpload(request, env) {
  const declared = String(request.headers.get('x-sha-256') || '').toLowerCase()
  if (!SIG_RE.test(declared)) return text(400, 'missing or malformed X-SHA-256 header')
  const size = Number(request.headers.get('x-content-length'))
  if (!Number.isFinite(size) || size < 0) return text(400, 'missing or malformed X-Content-Length header')

  const auth = await verifyBud02(parseAuthEvent(request), declared)
  if (!auth.ok) return text(401, auth.reason)

  if (await env.CONTENT.head(declared)) return text(200, 'already held — upload will be a no-op')
  const adm = await admit(env, auth.pubkey, size)
  if (!adm.ok) return text(adm.kind === 'exhausted' ? 413 : 403, adm.reason)
  return text(200, 'upload will be accepted')
}

// ── grant status (the quota meter) ───────────────────────────────────────────
//
// GET /grant, NIP-98-authenticated (method tag GET, u = this URL): a pubkey
// may read ITS OWN ledger row — nothing else, nobody else's. Reading never
// mints or mutates a grant; `state:'none'` with the default quota tells a
// fresh key what an auto-grant WOULD give it. Feeds the client's share-flow
// meter ("2.1 MB of 100 MB") and the plain-language over-quota moment.
async function getGrant(request, env) {
  const auth = await verifyNip98(request, parseAuthEvent(request), 'GET')
  if (!auth.ok) return text(401, auth.reason)
  const p = policy(env)
  const now = Math.floor(Date.now() / 1000)
  const held = await readGrant(env, auth.pubkey)
  const grant = held && typeof held === 'object' ? held : null
  const state = !grant ? 'none' : Number(grant.expiresAt || 0) <= now ? 'expired' : 'active'
  const body = state === 'active'
    ? { state, quotaBytes: Number(grant.quotaBytes || 0), usedBytes: Number(grant.usedBytes || 0), expiresAt: Number(grant.expiresAt || 0) }
    : { state, quotaBytes: p.autoGrant ? p.defaultQuota : 0, usedBytes: 0, expiresAt: null, autoGrant: p.autoGrant }
  return json(200, body, { 'Cache-Control': 'no-store' })
}

// ── hive pointers (path → head, one signed index per publisher) ──────────────
//
// GET/PUT /<sign('hive:indexes')>/<pubkey> — the ONE mutable object per publisher on an
// otherwise immutable heap: a schnorr-signed nostr event (kind 30564) whose
// content is {"v":1,"roots":{"<lineageKey>":"<headSig>", …}} mapping the
// publisher's PUBLIC lineage keys to their current sealed head sigs. This is
// the pointer that makes a statically-hosted hive live: bytes are already
// here under their sigs; the index says which sig is "now".
//
// Trust model mirrors the byte side: the event is signed by the pubkey in
// the path, so a client that pins the pubkey (it rides in the hive-link
// bundle) verifies the index END-TO-END — this worker, or any mirror
// serving the same JSON from a static file, can withhold an index but never
// forge one. Monotonic created_at closes the rollback hole: a replayed
// older index can never overwrite a newer one.
//
// ADDRESSED BY SIGNATURE, HELD IN A POOL (jwize 2026-09-25: only signatures
// are queried; state lives only in pools of meaning). The index is the member
// of sign('hive:indexes') named by its publisher's key:
// GET/PUT /<sign('hive:indexes')>/<pubkey>. The KV namespace (HIVES) that held
// indexes before is read as a drain source and never written.
const HIVE_INDEXES_MEANING = 'hive:indexes'

/** A signed index is self-verifying, so a copy a few seconds old is safe to
 *  hand out: every reader checks the schnorr signature against the key it
 *  pins, and compares the stamp with what it already signed. The edge cache
 *  holds the bytes for INDEX_EDGE_SECONDS per publisher; a write drops the
 *  copy in its own colo, and every other colo catches up within the window. */
const INDEX_EDGE_SECONDS = 5
const indexCacheKey = async (pubkey) =>
  new Request(`https://hive-indexes.invalid/${await poolAddress(HIVE_INDEXES_MEANING)}/${pubkey}`)
const edgeCache = () => globalThis.caches?.default ?? null

async function heldIndexRaw(env, pubkey) {
  const edge = edgeCache()
  if (edge) {
    try {
      const hit = await edge.match(await indexCacheKey(pubkey))
      if (hit) return await hit.text()
    } catch { /* read the pool */ }
  }
  const raw = await readHeldIndex(env, pubkey)
  if (edge && raw) {
    try {
      await edge.put(await indexCacheKey(pubkey), new Response(raw, {
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': `public, max-age=${INDEX_EDGE_SECONDS}` },
      }))
    } catch { /* uncached is only slower */ }
  }
  return raw
}

async function readHeldIndex(env, pubkey) {
  const key = `${await poolAddress(HIVE_INDEXES_MEANING)}/${pubkey}`
  const object = await env.CONTENT?.get?.(key)
  if (object) return new TextDecoder().decode(await object.arrayBuffer())
  // DRAIN: an index only the KV namespace holds is carried into its pool member
  // the first time it is read, so every later read is one get. The KV entry is
  // left as it was.
  const drained = (await env.HIVES?.get?.(pubkey)) ?? null
  if (drained && env.CONTENT?.put) {
    try {
      await env.CONTENT.put(key, drained, { onlyIf: new Headers({ 'If-None-Match': '*' }),
        httpMetadata: { contentType: 'application/json; charset=utf-8' } })
    } catch { /* read again next time */ }
  }
  return drained
}

async function holdIndex(env, pubkey, evt) {
  try { await edgeCache()?.delete(await indexCacheKey(pubkey)) } catch { /* the window closes it */ }
  await env.CONTENT.put(`${await poolAddress(HIVE_INDEXES_MEANING)}/${pubkey}`, JSON.stringify(evt), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
  })
}

/** The member names of a pool of meaning: the R2 keys under sign(meaning)/. */
async function poolMemberNames(env, meaning) {
  const pool = await poolAddress(meaning)
  const names = []
  if (!env.CONTENT?.list) return names
  let cursor
  do {
    const page = await env.CONTENT.list({ prefix: `${pool}/`, cursor, limit: 1000 })
    for (const object of page.objects ?? []) {
      const name = String(object.key ?? '').slice(pool.length + 1)
      if (name && !name.includes('/')) names.push(name)
    }
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
  return names
}

/** Membership only: an empty member named `name` under sign(meaning). */
async function addPoolMember(env, meaning, name) {
  const key = `${await poolAddress(meaning)}/${name}`
  if (!env.CONTENT?.put || await env.CONTENT.head?.(key)) return
  await env.CONTENT.put(key, new Uint8Array(0), { onlyIf: new Headers({ 'If-None-Match': '*' }) })
}

/** A KV list a pool replaced: read as a drain source, never written. */
async function drainedList(env, key) {
  try {
    const list = JSON.parse((await env.HIVES?.get?.(key)) ?? '[]')
    return Array.isArray(list) ? list.map(String) : []
  } catch { return [] }
}

function validHiveEventContent(evt) {
  let parsed
  try { parsed = JSON.parse(evt.content) } catch { return false }
  if (!parsed || typeof parsed !== 'object') return false
  const roots = parsed.roots
  if (!roots || typeof roots !== 'object' || Array.isArray(roots)) return false
  for (const [key, sig] of Object.entries(roots)) {
    if (typeof key !== 'string' || !key.trim()) return false
    if (!SIG_RE.test(String(sig || ''))) return false
  }
  return validOfferingDeclarations(parsed.offerings)
}

async function validOfferingLocations(evt) {
  const { offerings = {} } = JSON.parse(evt.content)
  for (const [location, offer] of Object.entries(offerings)) {
    if (!await creationLocationMatches(location, offer)) return false
  }
  return true
}

// PUT /<sign('hive:indexes')>/<pubkey> — NIP-98 proves the CALLER, the body event proves the
// INDEX. Both must be the path pubkey: a valid guest can't plant an index
// under someone else's key, and a leaked index event can't be replanted by
// a stranger (the NIP-98 envelope binds this URL + freshness).
async function putHive(request, env, pubkey) {
  const auth = await verifyNip98(request, parseAuthEvent(request))
  if (!auth.ok) return text(401, auth.reason)
  if (auth.pubkey !== pubkey) return text(403, 'auth pubkey does not match the hive being written')

  const body = await request.arrayBuffer()
  if (body.byteLength > HIVE_MAX_BYTES) return text(413, 'hive index too large')
  let evt
  try { evt = JSON.parse(new TextDecoder().decode(body)) } catch { return text(400, 'body is not a JSON nostr event') }
  if (Number(evt?.kind) !== HIVE_KIND) return text(400, `wrong event kind (expected hive index ${HIVE_KIND})`)
  if (String(evt?.pubkey || '').toLowerCase() !== pubkey) return text(403, 'index event pubkey does not match the hive being written')
  if (!(await verifyEventSig(evt))) return text(401, 'invalid index event signature')
  if (!validHiveEventContent(evt)) return text(400, 'index content is not {"v","roots":{lineageKey: sig}}')
  if (!await validOfferingLocations(evt)) return text(400, 'offering location is not the hash of its meaning and key')

  let stored = null
  try { stored = JSON.parse((await heldIndexRaw(env, pubkey)) ?? 'null') } catch { stored = null }
  if (stored) {
    if (String(stored.id || '') === String(evt.id || '')) {
      return await advancePublishedLocations(env, pubkey, evt)
        ? text(200, 'index already current')
        : text(503, 'signed index is held but a route location is not current; retry this index')
    }
    if (Number(evt.created_at || 0) <= Number(stored.created_at || 0)) {
      return text(409, 'a newer (or same-age) index is already held - refusing rollback')
    }
  }
  if (!env.CONTENT?.put) return text(503, 'this host holds no pools')
  await holdIndex(env, pubkey, evt)
  await noteTranslators(env, pubkey, evt)
  await noteAssessors(env, pubkey, evt)
  if (!await advancePublishedLocations(env, pubkey, evt)) {
    return text(503, 'signed index is held but a route location is not current; retry this index')
  }
  // NOTE: the message rides the X-Reason header (ByteString) — ASCII only.
  return text(stored ? 200 : 201, `hive index updated for ${pubkey.slice(0, 12)}...`)
}

// GET /<sign('hive:indexes')>/<pubkey> — open read, never cached: the whole point of the
// pointer is freshness. The client re-verifies the schnorr signature, so
// serving it needs no auth and grants no trust.
async function getHive(request, env, pubkey) {
  const raw = await heldIndexRaw(env, pubkey)
  if (raw == null) return text(404, 'no hive index for this key')
  return new Response(raw, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...CORS,
    },
  })
}

// ── host AI (the immediate-answer tier) ──────────────────────────────────────
//
// POST /ai/ask — the host FIELDS conversational requests so a participant can
// talk to their hive from anywhere and get an answer NOW, without their home
// server being awake. The worker relays to the Anthropic API (Haiku by
// default) and streams the reply straight through as SSE — first tokens in
// well under a second. This is the shallow immediate tier; the home Claude
// Code bridge (ws:2401, full agent) remains the deep one.
//
// Trust model mirrors the byte side — a schnorr-signed NIP-98 event proves
// WHO without secrets:
//   AI_WRITERS set   → allowlist (comma-separated pubkeys): only the
//                      operator's own keys may spend their API money.
//   AI_WRITERS unset → any valid signer, throttled by a per-pubkey per-day
//                      token meter, the member of sign('host:ai-meters')
//                      named by the key ({ day, used }). An
//                      anti-abuse ceiling, not billing — same doctrine as
//                      the byte quota.
//
// Context rides as CONTENT SIGS (signature doctrine — reference, never
// inline): the client names sigs already on this CDN; the worker resolves
// them from R2, inlines capped text, and the model sees the participant's
// actual content. Bytes never ride the request twice.
//
// The API key is a Wrangler secret, never a var:
//   wrangler secret put ANTHROPIC_API_KEY

const AI_Q_MAX = 4_000            // question chars
const AI_CTX_SIGS_MAX = 8         // context sigs per ask
const AI_CTX_EACH_MAX = 16_384    // bytes considered per context sig
const AI_CTX_TOTAL_MAX = 49_152   // total context chars inlined

function aiPolicy(env) {
  return {
    model: String(env.AI_MODEL || 'claude-haiku-4-5'),
    maxTokens: Number(env.AI_MAX_TOKENS || 1024),
    dailyTokens: Number(env.AI_DAILY_TOKENS || 100_000),
    writers: String(env.AI_WRITERS || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean),
    system: String(env.AI_SYSTEM ||
      'You are the assistant of a Hypercomb hive host. Answer briefly and concretely. ' +
      'When tile content is provided as context, ground your answer in it.'),
  }
}

// Per-day token meter (estimate: chars/4 in + max_tokens reserved out). One
// row per key holds only today: a row from another day reads as zero and the
// next write replaces it, so the ledger never grows. Today's row in the old
// KV namespace (`ai:<pubkey>:<day>`) is read as a drain source.
async function aiAdmit(env, pubkey, estimate) {
  const p = aiPolicy(env)
  if (p.writers.length) {
    return p.writers.includes(pubkey)
      ? { ok: true, meter: null }
      : { ok: false, reason: 'this key is not on the AI writers list — ask the operator' }
  }
  // WHOSE WORD COUNTS (module-sandbox.md): a key costs nothing to mint, so a
  // per-key meter bounds nobody. With no list, the host AI answers the people
  // this host already admitted — its zones' operators and bound publishers,
  // the keys whose trials it reviews — and the meter stays their ceiling.
  if (!(await aiAdmitted(env)).has(pubkey)) {
    return { ok: false, reason: 'this host answers its own publishers only — ask from a host that binds your key' }
  }
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const row = await readLedger(env, HOST_AI_METERS_MEANING, pubkey, null)
  let used = 0
  if (row && typeof row === 'object' && row.day === day) used = Number(row.used) || 0
  else {
    try { used = Number(JSON.parse((await env.GRANTS?.get?.(`ai:${pubkey}:${day}`)) ?? '0')) || 0 } catch { used = 0 }
  }
  if (used + estimate > p.dailyTokens) {
    return { ok: false, reason: 'daily AI allowance used up for this key — try again tomorrow' }
  }
  return { ok: true, meter: { pubkey, day, used, estimate } }
}

/** Every key this host admitted: each zone's operator and every publisher
 *  bound to a site on it (the wrangler var and the operators' signed records). */
async function aiAdmitted(env) {
  const scoped = await bindingsEnv(env)
  const keys = new Set(siteOperators(env).map(([, pubkey]) => pubkey))
  for (const site of Object.values(siteBindings(scoped))) {
    for (const publisher of site?.publishers ?? []) keys.add(String(publisher?.pubkey || '').toLowerCase())
  }
  return keys
}

async function aiConsume(env, meter) {
  if (!meter) return
  try {
    await writeLedger(env, HOST_AI_METERS_MEANING, meter.pubkey, { day: meter.day, used: meter.used + meter.estimate })
  } catch { /* meter write raced — ceiling holds on next read */ }
}

// Resolve context sigs from the R2 heap into capped text blocks. Non-text or
// missing sigs are skipped silently — context is best-effort, the question
// always goes through.
async function aiContext(env, sigs) {
  const parts = []
  let total = 0
  for (const sig of sigs.slice(0, AI_CTX_SIGS_MAX)) {
    if (!SIG_RE.test(String(sig || ''))) continue
    let obj = null
    try { obj = await env.CONTENT.get(sig, { range: { offset: 0, length: AI_CTX_EACH_MAX } }) } catch { obj = null }
    if (!obj) continue
    let text = ''
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(await obj.arrayBuffer()) } catch { continue }
    if (!text.trim()) continue
    const room = AI_CTX_TOTAL_MAX - total
    if (room <= 0) break
    const clipped = text.slice(0, room)
    total += clipped.length
    parts.push(`--- context ${sig.slice(0, 12)}… ---\n${clipped}`)
  }
  return parts.length ? parts.join('\n\n') + '\n\n' : ''
}

async function aiAsk(request, env) {
  if (!env.ANTHROPIC_API_KEY) return text(503, 'AI is not configured on this host (missing ANTHROPIC_API_KEY secret)')

  const auth = await verifyNip98(request, parseAuthEvent(request), 'POST')
  if (!auth.ok) return text(401, auth.reason)

  let body
  try { body = await request.json() } catch { return text(400, 'body is not JSON') }
  const question = String(body?.question || '').trim()
  if (!question) return text(400, 'missing question')
  if (question.length > AI_Q_MAX) return text(413, `question too long (max ${AI_Q_MAX} chars)`)
  const sigs = Array.isArray(body?.context) ? body.context : []
  const wantStream = body?.stream !== false

  const p = aiPolicy(env)
  const context = await aiContext(env, sigs)
  const estimate = Math.ceil((question.length + context.length) / 4) + p.maxTokens
  const adm = await aiAdmit(env, auth.pubkey, estimate)
  if (!adm.ok) return text(429, adm.reason)

  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: p.model,
      max_tokens: p.maxTokens,
      system: p.system,
      messages: [{ role: 'user', content: context + question }],
      stream: wantStream,
    }),
  })

  if (!upstream.ok) {
    // Never leak the upstream body verbatim (it may include request echoes);
    // status + a terse reason is enough for the client to display.
    return text(upstream.status === 429 ? 429 : 502, `AI upstream error (${upstream.status})`)
  }

  await aiConsume(env, adm.meter)

  if (wantStream) {
    // SSE passthrough — the client parses Anthropic's event shapes directly.
    return new Response(upstream.body, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-AI-Model': p.model,
        ...CORS,
      },
    })
  }
  return new Response(upstream.body, {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-AI-Model': p.model, ...CORS },
  })
}

// ── router ───────────────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const requestUrl = new URL(request.url)
    const { pathname } = requestUrl
    const method = request.method
    // Which site this host is — resolved once, and only by a branch that needs
    // it. The flat sig read and the pool listing never ask, so the hot path
    // pays no index read for the operators' signed bindings.
    let routing = null
    const route = async () => {
      if (!routing) {
        const scoped = await bindingsEnv(env)
        routing = { env: scoped, ...resolveSite(scoped, requestUrl.hostname) }
      }
      return routing
    }

    // DOORS WRITE NOTHING, at any host this worker serves. A signed request
    // from a door — the visitor's own key through NIP-07, or one the package
    // minted — would write as if the visitor's hive had. Assessing, taking,
    // drafting and committing happen at home, so this sits above every route.
    const fromDoor = fromSandboxDoor(request)
    if (fromDoor && method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
      return text(403, 'a sandbox door writes nothing — do this from your own hive')
    }

    // Application domains run Core with a narrower host capability profile.
    // The relay host may accept signed writes; a published Core host never
    // does. Keep this boundary above every mutation endpoint so adding another
    // relay feature cannot accidentally grant it to websites.
    if (method !== 'GET' && method !== 'HEAD' && (await route()).site) {
      return text(405, 'published Core hosts are read-only')
    }

    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: fromDoor ? DOOR_CORS : CORS })

    // A DOOR RUNS NO WORKER FROM THE HEAP. A worker takes its policy from its
    // own script's response, not from the page, and heap bytes carry only
    // `sandbox`, which a worker ignores — so a package that uploads a script
    // and starts it as a (service) worker at its door would escape the door's
    // connect-src and reach the visitor's machine. The shell's own workers are
    // never heap bytes, so on a door host a worker asking for one is refused.
    if (SANDBOX_LABEL_RE.test(requestUrl.hostname.split('.')[0])
      && /^(?:worker|sharedworker|serviceworker)$/.test(String(request.headers.get('sec-fetch-dest') || '').toLowerCase())
      && /^\/(?:(?:@resource\/)?[0-9a-f]{64}(?:\/[^/]+)?|content\/[0-9a-f]{64})$/.test(pathname)) {
      return text(403, 'a sandbox door runs no worker from the heap')
    }

    // DRAIN ROUTES — the retired names, answering the SAME bytes as the
    // signature addresses, for the installs already in use: their update scout
    // and their publish still call these. The addresses are the truth; retire
    // each route once nothing in use calls it (jwize 2026-09-25).
    const drainIndex = pathname.match(/^\/hive\/([0-9a-f]{64})$/)
    if (drainIndex) {
      if (method === 'GET' || method === 'HEAD') return getHive(request, env, drainIndex[1])
      if (method === 'PUT') return putHive(request, env, drainIndex[1])
      return text(405, 'method not allowed')
    }
    if (method === 'GET' || method === 'HEAD') {
      if (pathname === '/publications.json') return servePublications(request, (await route()).env)
      if (pathname === '/trials.json') {
        const routed = await route()
        return serveTrials(request, routed.env, routed.implicit ? routed.zone : requestUrl.hostname)
      }
      const drainLocale = pathname.match(/^\/i18n\/([a-z]{2,3}(?:-[a-z0-9]{2,8})?)\.json$/)
      if (drainLocale) return serveTranslations(request, env, drainLocale[1])
    }

    // A PUBLISHER'S SIGNED INDEX — the member of sign('hive:indexes') named by
    // their key (see putHive/getHive). Before every heap and pool branch, which
    // would read /<sig>/<name> as a named file.
    const indexMatch = pathname.match(/^\/([0-9a-f]{64})\/([0-9a-f]{64})$/)
    if (indexMatch && indexMatch[1] === await poolAddress(HIVE_INDEXES_MEANING)) {
      if (method === 'GET' || method === 'HEAD') return getHive(request, env, indexMatch[2])
      if (method === 'PUT') return putHive(request, env, indexMatch[2])
      return text(405, 'method not allowed')
    }

    // A SANDBOX DOOR'S POOLS — its own bag and its assessments — answered
    // before the published-route bag and the pool listing, which would read
    // both as private. The label test is free: only a try- host pays a read.
    const sandboxPool = pathname.match(/^\/(?:content\/)?([0-9a-f]{64})\/([0-9a-f]{64}|[0-9]{8})?$/)
    if (sandboxPool && (method === 'GET' || method === 'HEAD') && SANDBOX_LABEL_RE.test(requestUrl.hostname.split('.')[0])) {
      const routed = await route()
      if (routed.site && routed.implicit && SANDBOX_LABEL_RE.test(routed.site.lineage)) {
        const answered = await serveSandboxPools(request, routed.env, routed.site, sandboxPool[1], sandboxPool[2])
        if (answered) return answered
      }
    }

    // The only exposed location bag is this DNS door's own hashed name. Its
    // newest numbered marker is the head, but the publisher's signed index
    // must still authorize that exact route and agree with the marker.
    const routeBagPath = pathname.match(/^\/(?:content\/)?([0-9a-f]{64})\/(?:([0-9]{8}))?$/)
    if (routeBagPath && routeBagPath[1] === await poolAddress(requestUrl.hostname.toLowerCase())) {
      if (method !== 'GET' && method !== 'HEAD') return text(405, 'method not allowed')
      const routed = await route()
      if (!routed.site || routed.site.frontDoor) return new Response(null, { status: 404, headers: CORS })
      return serveRouteLocation(request, routed.env, routed.site, routeBagPath[2])
    }

    if (routeBagPath && pathname.startsWith('/content/')
      && !(await listedPool(env, routeBagPath[1]))
      && (method === 'GET' || method === 'HEAD')) {
      const location = routeBagPath[1]
      const scoped = await bindingsEnv(env)
      const creation = await serveCreationLocation(request, scoped, requestUrl.hostname.toLowerCase(),
        location, routeBagPath[2])
      if (creation) return creation
      // An undeclared R2 bag is private even if the static visitor also has
      // files under /content/. With no R2 bag, the established asset path may
      // still answer a shipped directory such as the package pool.
      if ((await locationMarkers(env, await creationBagLocation(requestUrl.hostname.toLowerCase(), location)))?.length) {
        return new Response(null, { status: 404, headers: CORS })
      }
    }

    // A host's offering pool is its live, domain-scoped projection of signed
    // hive heads. The pool address and its members are the entire catalog.
    const offeringPath = pathname.match(/^\/(?:content\/)?([0-9a-f]{64})\/([0-9a-f]{64})?$/)
    if (offeringPath && offeringPath[1] === await poolAddress(HOST_OFFERINGS_MEANING)) {
      if (method === 'GET' || method === 'HEAD') return serveOfferingsPool(request, env, offeringPath[2])
      return text(405, 'method not allowed')
    }

    // Flat sig endpoint — the canonical read: https://<host>/<sig>.
    // Lowercase 64-hex only; this bucket is flat from birth (no legacy
    // typed-dir layout ever lands here, so no fallback probing).
    // `/@resource/<sig>` is accepted as a READ alias: hypercomb clients
    // probe both URL shapes (the relay serves both), and without the alias
    // every @resource probe against this endpoint was a guaranteed 404 —
    // half the console-noise wall of 2026-07-16. Same object, same
    // immutable caching; reads only (writes stay on the canonical shapes).
    // An optional one-segment suffix (`/<sig>/chrome.css`) is a READ-ONLY
    // human name: pages authored in the hive reference shared chrome and art
    // as `resource:<sig>/<name>`, and the visitor rewrites those verbatim.
    // The bytes come from the sig alone; without this the suffixed form fell
    // through to the SPA asset handler, which 307'd to `/` and served the
    // page's stylesheet as index.html — the unstyled-website bug.
    const sigMatch = pathname.match(/^\/(?:(@resource)\/)?([0-9a-f]{64})(?:\/[^/]+)?$/)
    if (sigMatch) {
      const isAlias = !!sigMatch[1]
      const named = pathname.length > pathname.indexOf(sigMatch[2]) + 64
      if (method === 'GET' || method === 'HEAD') {
        // Everything serves from the root — one flat heap, one URL shape.
        // Content-addressed bytes carry no type, so the type comes from the
        // REQUEST: a module import declares itself (Sec-Fetch-Dest: script /
        // worker) and gets a JavaScript MIME; every other consumer gets the
        // stored type. No typed prefix needed for modules either.
        const dest = String(request.headers.get('sec-fetch-dest') || '').toLowerCase()
        const heap = (dest === 'script' || dest === 'worker' || dest === 'sharedworker')
          ? await serveModule(request, env, sigMatch[2])
          : await serveBlob(request, env, sigMatch[2], named ? suffixType(pathname) : null)
        // The one-file indexes answered at a pool's own derived address —
        // what a published-pool probe fetches: the community's translations,
        // and this host's publications and trials (jwize 2026-09-25: no named
        // route answers them).
        if (heap.status === 404 && !isAlias && !named) {
          const locale = await localeAtAddress(env, sigMatch[2])
          if (locale) return serveTranslations(request, env, locale)
          if (sigMatch[2] === await poolAddress(HOST_PUBLICATIONS_MEANING)) return servePublications(request, (await route()).env)
          if (sigMatch[2] === await poolAddress(HOST_TRIALS_MEANING)) {
            const routed = await route()
            return serveTrials(request, routed.env, routed.implicit ? routed.zone : requestUrl.hostname)
          }
        }
        // A front-door apex also serves the shim's OWN bytes (its pinned
        // bootstrap, its packages), which live with the card, not in the heap.
        if (heap.status === 404 && (siteBindings(env)[requestUrl.hostname.toLowerCase()]?.frontDoor
          || servesHostDoor(env, requestUrl.hostname))) {
          return serveFrontDoor(request, env)
        }
        return heap
      }
      if (method === 'PUT' && !isAlias && !named) return putSig(request, env, sigMatch[2])
      return text(405, 'method not allowed')
    }

    // The directory branch: a pool at its address, on every door. It sits
    // ABOVE the mark, the site and the relay banner because the address is
    // derived, not chosen — no rewrite may answer it with a page.
    const poolMatch = pathname.match(/^\/([0-9a-f]{64})\/$/)
    if (poolMatch) {
      if (method === 'GET' || method === 'HEAD') return servePoolListing(request, env, poolMatch[1])
      return text(405, 'method not allowed')
    }

    // The mark answers on EVERY door under a bound zone — a published site, a
    // name with nothing published yet, the relay face, an error page. All of
    // them are Hypercomb, and a browser that gets a 404 here paints the blank
    // globe, which says something untrue about the page. The bytes come from
    // the visitor engine's own asset root (built by
    // `node scripts/build-favicons.cjs`), so they are same-origin everywhere.
    //
    // This is only the DEFAULT: a site that declares its own icon in its
    // descriptor has the visitor replace the <link> tags at boot, and never
    // asks for these paths.
    if (MARK_PATHS.has(pathname) && (method === 'GET' || method === 'HEAD') && env.ASSETS?.fetch) {
      const markUrl = new URL(requestUrl)
      markUrl.search = ''
      const mark = await env.ASSETS.fetch(new Request(markUrl, request))
      if (mark.status === 200) {
        const headers = new Headers(mark.headers)
        headers.set('Cache-Control', 'public, max-age=3600')
        headers.set('Access-Control-Allow-Origin', '*')
        return new Response(mark.body, { status: 200, headers })
      }
    }

    const routed = await route()
    const { site, implicit, zone: siteZone } = routed
    env = routed.env

    if (!site && pathname === '/upload') {
      if (method === 'PUT') return putUpload(request, env)
      if (method === 'HEAD') return headUpload(request, env)
      return text(405, 'method not allowed')
    }

    if (!site && pathname === '/forget') {
      if (method === 'POST') return forgetSigs(request, env)
      return text(405, 'method not allowed')
    }

    if (!site && pathname === '/grant') {
      if (method === 'GET') return getGrant(request, env)
      return text(405, 'method not allowed')
    }

    // Host AI — the immediate conversational tier (see aiAsk above).
    if (!site && pathname === '/ai/ask') {
      if (method === 'POST') return aiAsk(request, env)
      return text(405, 'method not allowed')
    }


    // THE FRONT DOOR — an apex is the entrance to its domain, not a hive: the
    // shim host card (HOST_DOOR_ORIGIN, a static Pages deployment) draws it,
    // and lists the hives switched on here from sign('host:publications'). Every
    // machine read stays on this worker — flat sigs and pools are answered
    // above, the index and the ledger here — so the card reads the one heap.
    if (site?.frontDoor && (method === 'GET' || method === 'HEAD')) {
      return serveFrontDoor(request, env)
    }

    // A published application domain is a normal Core host over the same heap.
    // Machine endpoints expose only signed coordinates; EVERY human route,
    // including /revisions, receives the shared read-only engine.
    if (site && (method === 'GET' || method === 'HEAD')) {
      // Every open trial on this zone — from its apex or any door on it.
      // A `try-` name under a zone is a sandbox door, not a website.
      if (implicit && SANDBOX_LABEL_RE.test(site.lineage)) return serveSandbox(request, env, site, siteZone)
      // Signed module imports — the visitor engine maps bee/dependency
      // imports to /content/<sig>. Same immutable blob as the flat read,
      // but with a JavaScript MIME: browsers enforce strict MIME checks on
      // ES modules, and the SPA fallback was answering these with index.html
      // (an empty/HTML Content-Type), which bricked every module load.
      const moduleMatch = pathname.match(/^\/content\/([0-9a-f]{64})$/)
      if (moduleMatch) return serveModule(request, env, moduleMatch[1])
      // A door — named or wildcard — is a website only while an approved
      // publisher's signed index carries its lineage (the open mark, above).
      // Until then, and again after a withdrawal, an honest 404 page.
      const read = indexReader(env)
      const opened = await siteOpen(env, site, read, requestUrl.hostname, pathname.startsWith('/content/'))
      if (!opened.open) return nothingHere(requestUrl.hostname, implicit ? siteZone : null)
      // A promoted trial: the site runs its publisher's package, not the
      // engine's own.
      if (pathname.startsWith('/content/')) {
        const answered = opened.promoted && await answerPackage(request, requestUrl, opened.promoted, site.lineage)
        if (answered) return answered
      }
      // Everything under /content/ is a FILE the build shipped — the package
      // pool above all — and is never held and never a page.
      if (pathname.startsWith('/content/')) return serveVisitorAsset(request, env, { spa: false })
      // THE PAGE CARRIES ITS DOOR: the record the gate just read from the bag
      // at sign(<host>), so the visitor needs no round trip before its plan.
      // …and the head of its host:packages pool, so the install walks no
      // listing and no marker before it starts. The two reads run side by side.
      // …and its publisher's signed index, so the visitor verifies it against
      // the key it pins with no round trip. The reads run side by side.
      const frontDoor = !!siteBinding(env, requestUrl.hostname)?.frontDoor
      const publisher = site.publishers?.find((p) => p.primary) || site.publishers?.[0]
      const [located, pointer, signedIndex] = frontDoor ? [null, null, null] : await Promise.all([
        newestLocation(env, await poolAddress(requestUrl.hostname.toLowerCase())),
        installPointer(request, env, site, opened.promoted),
        publisher ? heldIndexRaw(env, publisher.pubkey).catch(() => null) : null,
      ])
      const door = located?.record ?? null
      const install = door ? pointer : null
      const index = door && signedIndex && signedIndex.length <= PAGE_INDEX_MAX ? signedIndex : null
      return serveVisitorAsset(request, env, { door, install, index })
    }

    // A zone subdomain that could not even become an implicit site (nested
    // label, garbled name): fail closed with a human answer, never the relay
    // banner. content.<zone> is exempt above — it IS the relay face.
    if (!site && siteZone && requestUrl.hostname !== `content.${siteZone}` && (method === 'GET' || method === 'HEAD')) {
      return nothingHere(requestUrl.hostname, siteZone)
    }

    if ((method === 'GET' || method === 'HEAD') && servesHostDoor(env, requestUrl.hostname)) {
      return serveFrontDoor(request, env)
    }

    // Bare / names the endpoint (relay.js landing instinct, one line).
    if (pathname === '/' && (method === 'GET' || method === 'HEAD')) {
      return text(200, 'hypercomb public content endpoint — GET /<sig> · Blossom BUD-01/02/06')
    }

    return text(404, 'not found')
  },
}
