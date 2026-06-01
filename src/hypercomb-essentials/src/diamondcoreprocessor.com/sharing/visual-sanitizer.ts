// diamondcoreprocessor.com/sharing/visual-sanitizer.ts
//
// Closed-shape sanitizer for inbound peer visual properties.
//
// User intent: "visuals can carry no possibility of code injection".
// Peer-published 0000 contents land in our process via the swarm wire
// and may flow into the renderer (icon atlas binding) and into our own
// layer's `properties` slot at adopt time. Without a sanitizer, a
// malicious or buggy peer could ship arbitrary keys / value shapes that
// either confuse downstream readers or carry a payload that hits an
// unguarded sink — `link` rendered into an <a href="…">, `tags`
// concatenated into a UI fragment, an unknown key matched against a
// reserved field name on some future subsystem.
//
// Policy: default-deny whitelist. Keys not enumerated below are dropped.
// Values are validated by shape (scalar type, sig pattern, length cap,
// nested allowed structure) — anything else is dropped. The output is
// always a fresh object with only safe content; no in-place mutation of
// the input.
//
// What's allowed at the top level:
//   - `index`        : finite non-negative integer (slot position)
//   - `imageSig`     : 64-char lowercase hex (resource pointer)
//   - `small`        : { image?: sig, ... }  (substrate variants)
//   - `flat`         : { small?: { image?: sig } }
//   - `point`        : { image?: sig }
//   - `accent`       : short identifier-shaped string (preset name)
//   - `tags`         : array of short identifier-shaped strings
//   - `link`         : http(s) URL or root-relative path (NO javascript:,
//                      data:, file:, blob:, vbscript:, etc.)
//   - `hideText`     : boolean
//   - `thread`       : 64-char lowercase hex (assistant)
//   - `contentSig`   : 64-char lowercase hex (assistant)
//   - `stopReason`   : short identifier-shaped string (assistant)
//   - `layerSig`     : 64-char lowercase hex — the publisher's signature
//                      for this child's layer. Inert (just a pointer).
//                      Used by the receiver as a merkle handle: with the
//                      sig the receiver can call
//                      `swarm.requestSubtree(sig)` to pull deeper layers
//                      via the content broker even when the publisher
//                      never personally navigated into them. "Signatures
//                      are streamed so you can add them" — this is that
//                      stream.
//
// What's stripped on adopt (in addition to swarm-only metadata):
//   - session-only keys, paired-channel-era markers, the publisher's
//     `index` (local layout owns slot assignment).
//
// Anything else — entirely unknown keys, malformed values, oversized
// content — is silently dropped. The renderer falls back to label-only
// for the visual; the user can always re-trigger.

const SIG_RE = /^[0-9a-f]{64}$/
const IDENT_RE = /^[A-Za-z0-9_\-]{1,64}$/
const URL_SAFE_RE = /^(https?:\/\/|\/)[\w\-._~:/?#\[\]@!$&'()*+,;=%]{0,2048}$/

const MAX_TAGS = 32
const MAX_TAG_LEN = 64
const MAX_LINK_LEN = 2048

/** Coerce to non-negative finite integer; null on rejection. */
function asNonNegativeInt(v: unknown): number | null {
  if (typeof v !== 'number') return null
  if (!Number.isFinite(v)) return null
  if (v < 0) return null
  return Math.floor(v)
}

/** Resource signature (64 hex chars, lowercase). */
function asSig(v: unknown): string | null {
  return typeof v === 'string' && SIG_RE.test(v) ? v : null
}

/** Short identifier-shaped string. Used for accent names, tag values,
 *  stop reasons — any field whose render path expects an opaque label
 *  rather than free text. Bounded length + restricted charset keeps
 *  the value inert. */
function asIdent(v: unknown): string | null {
  return typeof v === 'string' && IDENT_RE.test(v) ? v : null
}

/** Tags array — capped count, each entry must pass `asIdent`. */
function asTags(v: unknown): readonly string[] | null {
  if (!Array.isArray(v)) return null
  const out: string[] = []
  for (let i = 0; i < v.length && out.length < MAX_TAGS; i++) {
    const e = asIdent(v[i])
    if (e !== null && e.length <= MAX_TAG_LEN) out.push(e)
  }
  return out.length > 0 ? out : null
}

/** Link URL. Allows http(s) absolute or root-relative; rejects every
 *  scheme that could execute (javascript:, data:, vbscript:, file:,
 *  blob:, about:, …) and rejects relative refs that could break out
 *  of the expected target context. Length-capped. */
function asSafeLink(v: unknown): string | null {
  if (typeof v !== 'string') return null
  if (v.length === 0 || v.length > MAX_LINK_LEN) return null
  if (!URL_SAFE_RE.test(v)) return null
  // Belt-and-braces: re-parse with URL when absolute. Browsers normalize
  // some weird inputs the regex doesn't fully cover; if URL throws or
  // produces a non-http(s) protocol, drop.
  if (v.startsWith('http')) {
    try {
      const u = new URL(v)
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    } catch { return null }
  }
  return v
}

/** Substrate variant container: only an optional `image` sig allowed. */
function asImageContainer(v: unknown): { image: string } | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const img = asSig((v as Record<string, unknown>)['image'])
  return img ? { image: img } : null
}

/** Nested `flat: { small: { image: sig } }` shape. */
function asFlatContainer(v: unknown): { small: { image: string } } | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const small = asImageContainer((v as Record<string, unknown>)['small'])
  return small ? { small } : null
}

/** Whitelist sanitizer. Walks the input once, copies only validated
 *  fields into a fresh output object. Returns the cleaned object (may
 *  be empty if nothing passed validation). */
export function sanitizeVisualProperties(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}

  const index = asNonNegativeInt(input['index'])
  if (index !== null) out['index'] = index

  const imageSig = asSig(input['imageSig'])
  if (imageSig) out['imageSig'] = imageSig

  const small = asImageContainer(input['small'])
  if (small) out['small'] = small

  const flat = asFlatContainer(input['flat'])
  if (flat) out['flat'] = flat

  const point = asImageContainer(input['point'])
  if (point) out['point'] = point

  const accent = asIdent(input['accent'])
  if (accent) out['accent'] = accent

  const tags = asTags(input['tags'])
  if (tags) out['tags'] = tags

  const link = asSafeLink(input['link'])
  if (link) out['link'] = link

  if (typeof input['hideText'] === 'boolean') out['hideText'] = input['hideText']

  const thread = asSig(input['thread'])
  if (thread) out['thread'] = thread

  const contentSig = asSig(input['contentSig'])
  if (contentSig) out['contentSig'] = contentSig

  const stopReason = asIdent(input['stopReason'])
  if (stopReason) out['stopReason'] = stopReason

  const layerSig = asSig(input['layerSig'])
  if (layerSig) out['layerSig'] = layerSig

  return out
}

/** Sanitize a single inbound visual entry (the wire-shape: `{ name,
 *  ...flat_props }`). Returns the cleaned entry with `name` preserved.
 *  Reject (return null) only when `name` itself is missing/invalid —
 *  every other field is filtered through the whitelist. */
export function sanitizeVisual(
  visual: Record<string, unknown>,
): { name: string } & Record<string, unknown> | null {
  const name = visual?.['name']
  if (typeof name !== 'string') return null
  const trimmed = name.trim()
  if (!trimmed || trimmed.length > 256) return null
  // Names that look like sig hex are suspicious — labels shouldn't be
  // 64-char hex strings. Reject to defend against accidental collision
  // with the resource-pool key space.
  if (SIG_RE.test(trimmed)) return null
  const props = sanitizeVisualProperties(visual)
  return { name: trimmed, ...props }
}
