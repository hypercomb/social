// build-asks.js
//
// THE ASKS A HOST HOLDS FOR ITS BUILDERS — one answer for every host that
// keeps grants (the blossom worker today; any host that leases its surface,
// documentation/deployment-stages.md R12).
//
// An ASK is a participant's signed request that a builder build a draft of
// the minimal build (essentials sharing/version-drafts.ts askBuild): a nostr
// event, kind 30568, content `hc:ask:v1\n<draft sig>`, tags `d` (the draft),
// `h` (the host it was sent to). Its author uploads the draft and then the
// ask, like any bytes, under their own grant. The host RECOGNISES the ask
// there — no one declares it — and notes it in the pool `host:asks`, one
// member per ask, when all of this holds:
//
//   - it is an ask for one draft, and its signature verifies;
//   - the key that signed it is the key that uploaded it, and those bytes and
//     the draft it names are held as that key's own uploads (stored under its
//     grant first, whoever else re-uploads them since), the draft a draft —
//     so nobody can queue someone else's ask, and every ask costs its author
//     a real draft of their own;
//   - its `h` names this host, and a zone this host has an operator for;
//   - it is recent (ASK_TTL_DAYS), the same window a builder builds in
//     (hypercomb-shim host/builder.mjs ASK_TTL_DAYS).
//
// The pool is PRIVATE to builders: listing it publishes drafts (anyone holding
// an ask can fetch its draft's files by signature). Each ask belongs to the
// most specific zone its host falls in, and is listed only to a signed request
// (NIP-98) from that zone's operator, or a key the operator's signed index
// names under `builders` — a key named so builds for every zone that operator
// runs on the host. Everyone else is answered exactly as for a pool the host
// does not hold.
//
// History falls off, zone by zone: each zone keeps at most ASKS_PER_AUTHOR
// open asks per author and ASKS_MAX in all, the newest the host RECEIVED
// first (an author's own clock earns no place), none older than
// ASK_TTL_DAYS. The ask's bytes stay at /<sig> (they are the author's, under
// their grant); only the listing forgets.
//
// AN ANSWER is a builder's signed word on one ask (hypercomb-shim host/
// builder.mjs answerEvent): a nostr event, kind 30569, content
// `hc:answer:v1\n<ask sig>\n<state>` — built, refused or failed — tags `d`
// (the ask: one slot per builder per ask), `p` (the ask's author), `h` (the
// host it answers on), `s` (the state), `why` (one short line, for refused and
// failed) and, for built, one `b` per revision it promoted (sig, label,
// version) and one `g` per signature of the builder's on them — each readable
// from the host by its signature, at /<sig> or in its version pools. The builder uploads it under its own grant, like any bytes, and
// the host notes it in the pool `host:answers` when all of this holds:
//
//   - it is an answer, shaped as one, and its signature verifies;
//   - the key that signed it uploaded it, and those bytes are its own;
//   - its `h` names this host, in a zone the key builds for (the zone's
//     operator, or a builder the operator's signed index names);
//   - the ask it names is held here as its author's own upload, verifies, is
//     its `p`'s, was sent to the same zone, and is recent;
//   - it is recent (ANSWER_TTL_DAYS).
//
// Answers are as private as asks: a refusal names an ask, and an ask names a
// draft. The listing goes to a signed request only — each key sees the
// answers to its own asks, and the builders of a zone see the zone's — and a
// built answer takes its ask off the builders' listing: built is done.
// History falls off by builder, so no builder's answers crowd out another's:
// per zone, a builder's newest word per ask, its newest ANSWERS_PER_AUTHOR to
// each author and ANSWERS_PER_BUILDER in all, none past ANSWER_TTL_DAYS.

export const ASK_KIND = 30568
export const ASKS_MEANING = 'host:asks'
export const ASK_TTL_DAYS = 7
export const ASKS_PER_AUTHOR = 4
export const ASKS_MAX = 128
/** An ask is a small event; anything larger is not one, and is not parsed. */
export const MAX_ASK_BYTES = 4096
/** A draft record is small (essentials version-drafts.ts stageDraft): the
 *  base, the files layer, a label and a time. */
export const MAX_DRAFT_BYTES = 16_384
/** A curated few, like MAX_LISTED: past this the rest are ignored. */
export const MAX_BUILDERS = 16

const SIG_RE = /^[0-9a-f]{64}$/
const DAY = 86_400
/** A clock a little ahead of ours is allowed; an ask from further ahead is not
 *  (the builder allows the same: builder.mjs takeAsk, 600 000 ms). */
export const AHEAD_SECS = 600

export const askPreimage = (draft) => `hc:ask:v1\n${draft}`

export const ANSWER_KIND = 30569
export const ANSWERS_MEANING = 'host:answers'
/** What a builder says of an ask: built it, would not, or could not. */
export const ANSWER_STATES = Object.freeze(['built', 'refused', 'failed'])
/** An answer outlives its ask: an author away for the week still finds it. */
export const ANSWER_TTL_DAYS = 14
/** Per builder: its answers to one author (an author holds four open asks)… */
export const ANSWERS_PER_AUTHOR = 8
/** …and all its answers in a zone: room for a word on every ask the zone
 *  lists (ASKS_MAX) twice over, so no answer to an open ask is ever swept to
 *  make room. A zone's builders are a curated few (MAX_BUILDERS and the
 *  operator), so this bounds the zone too. */
export const ANSWERS_PER_BUILDER = 256
export const MAX_ANSWER_BYTES = 4096
/** One short line: why it was refused, or the last words of the failure. */
export const MAX_WHY = 280
/** A build promotes the package and the host; a few more are allowed. */
export const MAX_BUILT = 4
export const answerPreimage = (ask, state) => `hc:answer:v1\n${ask}\n${state}`

const tag = (evt, name) => (Array.isArray(evt?.tags) ? evt.tags : []).find((t) => Array.isArray(t) && t[0] === name)?.[1]

/** The origin a host string names, normalized (lowercase, no default port,
 *  no path): https unless it is loopback. The builder compares the same way
 *  (hypercomb-shim host/builder.mjs originOf). */
export function originOf(host) {
  const text = String(host ?? '').trim()
  if (!text) return ''
  const loopback = /^(localhost|127\.|\[::1\])/i.test(text) || /^[^/:]+\.localhost(?::\d+)?(?:\/|$)/i.test(text)
  const withScheme = /^https?:\/\//i.test(text) ? text : `${loopback ? 'http' : 'https'}://${text}`
  try { return new URL(withScheme).origin } catch { return '' }
}

/** The most specific of `zones` a hostname falls in, or null. Nested zones
 *  are allowed (signed site bindings): the deepest one governs. */
export function zoneOf(hostname, zones) {
  const host = String(hostname ?? '').toLowerCase()
  return [...zones].sort((a, b) => b.length - a.length).find((zone) => host === zone || host.endsWith('.' + zone)) ?? null
}

/**
 * The ask these bytes are, if they are one SHAPED as one — kind, content, a
 * draft named by its signature, a pubkey — or null. The signature itself is
 * the caller's to verify (each host has its own verifier); `noteable` below
 * puts the whole rule together.
 */
export function askShape(bytes) {
  if (!bytes || bytes.byteLength > MAX_ASK_BYTES) return null
  let evt
  try { evt = JSON.parse(new TextDecoder().decode(bytes)) } catch { return null }
  if (!evt || typeof evt !== 'object' || Number(evt.kind) !== ASK_KIND) return null
  const draft = String(tag(evt, 'd') ?? '').toLowerCase()
  if (!SIG_RE.test(draft) || evt.content !== askPreimage(draft)) return null
  const author = String(evt.pubkey ?? '').toLowerCase()
  if (!SIG_RE.test(author)) return null
  return { evt, draft, author, host: String(tag(evt, 'h') ?? ''), at: Number(evt.created_at) || 0 }
}

/**
 * Is this upload an ask a host should note? Returns `{ ok, record }` —
 * `{ author, draft, at, origin }` — or the reason it is not. `uploader` is the
 * key the upload was authorized by; `origin` is the origin the upload
 * reached. Whether the bytes and the draft are held as the uploader's own is
 * the host's to check (it knows its store); so is the zone.
 */
export async function noteable(bytes, { uploader, origin, now = Math.floor(Date.now() / 1000), verify }) {
  const ask = askShape(bytes)
  if (!ask) return { ok: false, reason: 'not an ask' }
  if (ask.author !== String(uploader ?? '').toLowerCase()) return { ok: false, reason: 'an ask is uploaded by its own author' }
  const here = originOf(origin)
  if (!here || originOf(ask.host) !== here) return { ok: false, reason: 'the ask names another host' }
  if (!(ask.at > now - ASK_TTL_DAYS * DAY) || ask.at > now + AHEAD_SECS) return { ok: false, reason: 'the ask is not recent' }
  if (!(await verify(ask.evt))) return { ok: false, reason: 'the ask does not verify' }
  return { ok: true, record: { author: ask.author, draft: ask.draft, at: ask.at, origin: here } }
}

/** A label or a version as a revision names it: short, one line. */
const NAME_RE = /^[^\u0000-\u001f\u007f]{1,64}$/
/** One line of why. */
const WHY_RE = /^[^\u0000-\u001f\u007f]+$/

/**
 * The answer these bytes are, if they are one SHAPED as one — exactly as a
 * builder signs it (hypercomb-shim host/builder.mjs answerEvent) — or null:
 * kind and content; the ask (`d`) and the author (`p`) by their lowercase
 * hex; one known state; for refused and failed, one line of why; for built,
 * no why, the revisions (`b`: signature, label, version) and the builder's
 * signatures on them (`g`). The signature itself is the caller's to verify.
 */
export function answerShape(bytes) {
  if (!bytes || bytes.byteLength > MAX_ANSWER_BYTES) return null
  let evt
  try { evt = JSON.parse(new TextDecoder().decode(bytes)) } catch { return null }
  if (!evt || typeof evt !== 'object' || Number(evt.kind) !== ANSWER_KIND || !Array.isArray(evt.tags)) return null
  const ask = String(tag(evt, 'd') ?? '')
  const state = String(tag(evt, 's') ?? '')
  if (!SIG_RE.test(ask) || !ANSWER_STATES.includes(state) || evt.content !== answerPreimage(ask, state)) return null
  const builder = String(evt.pubkey ?? '')
  const author = String(tag(evt, 'p') ?? '')
  if (!SIG_RE.test(builder) || !SIG_RE.test(author)) return null
  const named = (name) => evt.tags.filter((t) => Array.isArray(t) && t[0] === name)
  const why = tag(evt, 'why')
  if (state === 'built' ? why !== undefined : !(typeof why === 'string' && why.length <= MAX_WHY && WHY_RE.test(why))) return null
  const built = named('b')
  const signatures = named('g')
  if (built.length > MAX_BUILT || signatures.length > MAX_BUILT * 2) return null
  if (built.some((t) => !SIG_RE.test(String(t[1] ?? '')) || !NAME_RE.test(String(t[2] ?? '')) || !NAME_RE.test(String(t[3] ?? '')))) return null
  if (signatures.some((t) => !SIG_RE.test(String(t[1] ?? '')))) return null
  if (state === 'built' ? built.length === 0 : built.length + signatures.length > 0) return null
  return { evt, ask, state, builder, author, host: String(tag(evt, 'h') ?? ''), at: Number(evt.created_at) || 0 }
}

/**
 * Is this upload an answer a host should note? Returns `{ ok, record }` —
 * `{ builder, ask, author, state, at, origin }` — or the reason it is not.
 * Whether the uploader builds for the zone, whether the bytes are its own,
 * and whether the ask is held are the host's to check.
 */
export async function noteableAnswer(bytes, { uploader, origin, now = Math.floor(Date.now() / 1000), verify }) {
  const answer = answerShape(bytes)
  if (!answer) return { ok: false, reason: 'not an answer' }
  if (answer.builder !== String(uploader ?? '').toLowerCase()) return { ok: false, reason: 'an answer is uploaded by its own builder' }
  const here = originOf(origin)
  if (!here || originOf(answer.host) !== here) return { ok: false, reason: 'the answer names another host' }
  if (!(answer.at > now - ANSWER_TTL_DAYS * DAY) || answer.at > now + AHEAD_SECS) return { ok: false, reason: 'the answer is not recent' }
  if (!(await verify(answer.evt))) return { ok: false, reason: 'the answer does not verify' }
  return { ok: true, record: { builder: answer.builder, ask: answer.ask, author: answer.author, state: answer.state, at: answer.at, origin: here } }
}

/** Are these bytes a draft record (essentials version-drafts.ts stageDraft):
 *  `{ name: 'draft', base, files }`, both named by their signatures? */
export function isDraft(bytes) {
  if (!bytes || bytes.byteLength > MAX_DRAFT_BYTES) return false
  try {
    const record = JSON.parse(new TextDecoder().decode(bytes))
    return record?.name === 'draft' && SIG_RE.test(String(record.base ?? '')) && SIG_RE.test(String(record.files ?? ''))
  } catch { return false }
}

/** The builder keys one signed index names, leniently: a malformed entry is
 *  dropped, never the whole index (the index also opens doors). */
export function buildersOf(content) {
  const raw = content && typeof content === 'object' ? content.builders : undefined
  if (!Array.isArray(raw)) return []
  const out = []
  for (const value of raw) {
    const key = typeof value === 'string' ? value.trim().toLowerCase() : ''
    if (!SIG_RE.test(key) || out.includes(key)) continue
    out.push(key)
    if (out.length >= MAX_BUILDERS) break
  }
  return out
}

/**
 * HISTORY FALLS OFF, ZONE BY ZONE. Given the pool's members
 * `{ name, author, at, noted, zone }` (`at` the ask's own time, `noted` when
 * the host received it), the names to forget: every ask older than
 * ASK_TTL_DAYS, and within each zone every author's beyond their newest
 * ASKS_PER_AUTHOR and everything beyond the newest ASKS_MAX — newest by
 * receipt. A member whose record is unreadable (no author, zone or receipt)
 * is forgotten.
 */
export function sweep(members, now = Math.floor(Date.now() / 1000)) {
  const drop = new Set()
  const zones = new Map()
  for (const member of members) {
    if (!member.author || !member.zone || !(member.noted > 0) || !(member.at > now - ASK_TTL_DAYS * DAY)) { drop.add(member.name); continue }
    if (!zones.has(member.zone)) zones.set(member.zone, [])
    zones.get(member.zone).push(member)
  }
  for (const inZone of zones.values()) {
    inZone.sort((a, b) => (b.noted - a.noted) || (a.name < b.name ? -1 : 1))
    const perAuthor = new Map()
    let kept = 0
    for (const member of inZone) {
      const seen = perAuthor.get(member.author) ?? 0
      if (seen >= ASKS_PER_AUTHOR || kept >= ASKS_MAX) { drop.add(member.name); continue }
      perAuthor.set(member.author, seen + 1)
      kept++
    }
  }
  return [...drop]
}

/**
 * ANSWERS FALL OFF, BUILDER BY BUILDER. Given the pool's members `{ name,
 * builder, ask, author, at, noted, zone }`, the names to forget: every answer
 * older than ANSWER_TTL_DAYS; a builder's older answers to the same ask (its
 * newest word stands); and within each zone, every builder's beyond its newest
 * ANSWERS_PER_AUTHOR to one author and its newest ANSWERS_PER_BUILDER in all —
 * newest by receipt. One builder's flood only ever evicts its own answers. A
 * member whose record is unreadable is forgotten.
 */
export function sweepAnswers(members, now = Math.floor(Date.now() / 1000)) {
  const drop = new Set()
  const live = []
  for (const member of members) {
    if (!member.builder || !member.ask || !member.author || !member.zone || !(member.noted > 0)
      || !(member.at > now - ANSWER_TTL_DAYS * DAY)) { drop.add(member.name); continue }
    live.push(member)
  }
  live.sort((a, b) => (b.noted - a.noted) || (a.name < b.name ? -1 : 1))
  const said = new Set()
  const perBuilder = new Map()
  const perAuthor = new Map()
  for (const member of live) {
    const slot = `${member.zone}\n${member.builder}\n${member.ask}`
    const builderKey = `${member.zone}\n${member.builder}`
    const authorKey = `${builderKey}\n${member.author}`
    if (said.has(slot) || (perBuilder.get(builderKey) ?? 0) >= ANSWERS_PER_BUILDER || (perAuthor.get(authorKey) ?? 0) >= ANSWERS_PER_AUTHOR) {
      drop.add(member.name)
      continue
    }
    said.add(slot)
    perBuilder.set(builderKey, (perBuilder.get(builderKey) ?? 0) + 1)
    perAuthor.set(authorKey, (perAuthor.get(authorKey) ?? 0) + 1)
  }
  return [...drop]
}
