// diamondcoreprocessor.com/sharing/decoration-closure.ts
//
// Shared closure logic for decoration records (the visual-bee `decorations`
// layer slot).
//
// A decoration's SIGNATURE rides the layer's `decorations` slot, so it travels
// on the merkle tree like any other slot ref. But the decoration's CONTENT —
// for a website page, the HTML body (`payload.htmlSig`) and every image /
// stylesheet that body embeds — lives one or two resource-hops INSIDE the
// decoration record, invisible to a walker that only iterates layer slots.
// That is why a freshly imported hive lands the decoration JSON but 404s on
// the page body and its artwork.
//
// This module is the single, GENERIC bridge across that gap. Both the PUSH
// closure (host-sync → the operator's host) and the PULL closure
// (content-broker `adopt`) call `decorationClosureSigs` right after they
// stage / fetch a resource: if those bytes turn out to be a decoration
// record, the helper returns every further resource sig the decoration
// depends on, so the walker stages / fetches those too. Ordinary
// (non-decoration) resources fail the JSON/kind check and return `[]` — the
// walker keeps treating them as opaque leaves.
//
// It is NOT website-specific: any decoration kind that either (a) carries a
// flat `refs` closure array, or (b) carries a `payload.htmlSig` HTML body,
// becomes portable through the same hop. A `files:attachment` decoration, for
// instance, can opt in later by writing `refs` with no walker change.
//
// The embedded-ref forms `extractPageRefSigs` recognises are EXACTLY the forms
// `rewritePageRefs` rewrites at render time — both live on the two regexes
// defined here — so the set the closure pushes can never diverge from the set
// the renderer resolves.

const SIG_RE = /^[0-9a-f]{64}$/

// `resource:<sig>` — used in src/href, in CSS `url('resource:<sig>')`, and in
// shared-stylesheet links like `resource:<sig>/chrome.css`. A bare substring
// match catches all of these regardless of surrounding syntax. Fresh literal
// per call so the global `lastIndex` is never carried across invocations.
const resourcePrefixRe = (): RegExp => /resource:([0-9a-f]{64})/g
// Bare-sig `src|href|data-src="<sig>"` attributes.
const attrBareSigRe = (): RegExp => /((?:src|href|data-src)=)(["'])([0-9a-f]{64})\2/g

type Bytes = ArrayBuffer | Uint8Array

function toU8(bytes: Bytes): Uint8Array {
  return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
}

function decode(bytes: Bytes): string {
  return new TextDecoder().decode(toU8(bytes))
}

/** Cheap pre-check: does this resource look like a JSON object (a decoration
 *  record), so it's worth decoding + parsing? Skips the full UTF-8 decode of
 *  large binary resources (images) and of HTML bodies (which start with `<`),
 *  for which the closure descent is a guaranteed no-op. */
function looksLikeJsonObject(bytes: Bytes): boolean {
  const u8 = toU8(bytes)
  for (let i = 0; i < u8.length; i++) {
    const c = u8[i]
    if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) continue // whitespace
    return c === 0x7b // '{'
  }
  return false
}

/** Every resource signature a page's HTML embeds — both `resource:<sig>` forms
 *  (incl. CSS `url()` and `/chrome.css` links) and bare-sig src/href/data-src
 *  attributes. Deduped, lowercased. The single source of truth shared with
 *  `rewritePageRefs` below, so the closure walk and the render rewrite can
 *  never resolve a different set. */
export function extractPageRefSigs(text: string): string[] {
  const out = new Set<string>()
  for (const m of text.matchAll(resourcePrefixRe())) out.add(m[1].toLowerCase())
  for (const m of text.matchAll(attrBareSigRe())) out.add(m[3].toLowerCase())
  return [...out]
}

/** Rewrite a cell page's embedded resource refs to `${prefix}<sig>` URLs. The
 *  render-side counterpart of `extractPageRefSigs` — same two patterns, so the
 *  renderer and the closure walk stay locked together. (SiteViewDrone calls
 *  this with RESOURCE_URL_PREFIX.) */
export function rewritePageRefs(text: string, prefix: string): string {
  let out = text.replace(resourcePrefixRe(), `${prefix}$1`)
  out = out.replace(attrBareSigRe(), (_m, attr, q, sig) => `${attr}${q}${prefix}${sig}${q}`)
  return out
}

/**
 * The decoration-descent hop. Given the bytes of a resource a walker just
 * staged / fetched, return every FURTHER resource sig the walker should also
 * carry — or `[]` if these bytes aren't a decoration record.
 *
 *   - Not a JSON object, or no string `kind`  → `[]` (ordinary resource leaf).
 *   - `refs: string[]` present (non-empty)    → return it (forward path; no
 *                                                HTML fetch needed).
 *   - else `payload.htmlSig` (64-hex) present → `[htmlSig, ...sigs embedded in
 *                                                the HTML body]`, fetching the
 *                                                body via `fetchHtml` (legacy
 *                                                fallback — covers every
 *                                                already-built page that has no
 *                                                refs[] yet).
 *
 * `fetchHtml` is injected so each caller uses its own transport: host-sync
 * reads LOCAL bytes only (push what we hold); adopt fetches over the network
 * (pull onto this machine). Generic over decoration kind by design — scoped to
 * records with a `kind`, so it never blind-harvests arbitrary 64-hex strings.
 *
 * SINGLE-LEVEL by design: the closure is the decoration's own body plus the
 * sigs embedded DIRECTLY in that body (or its `refs`). It does NOT recurse into
 * fetched assets — a `resource:` ref nested inside a linked stylesheet/SVG, or
 * a decoration that points at another decoration, is NOT carried. Assets must
 * be referenced from `payload.htmlSig`'s body (or listed in `refs`). This is
 * symmetric with the render-side `rewritePageRefs` (also single-level), so the
 * closure carries exactly what the renderer can resolve. Today's pages satisfy
 * this (e.g. chrome.css is a leaf — gradients + external font links, no
 * `resource:` refs); if nested-asset CSS/SVG is ever introduced, extend BOTH
 * this walk and `rewritePageRefs`, guarded by each caller's visited set.
 */
export async function decorationClosureSigs(
  recordBytes: Bytes,
  fetchHtml: (sig: string) => Promise<Bytes | null>,
): Promise<string[]> {
  if (!looksLikeJsonObject(recordBytes)) return []

  let record: Record<string, unknown>
  try { record = JSON.parse(decode(recordBytes)) as Record<string, unknown> }
  catch { return [] }
  if (!record || typeof record !== 'object' || typeof record['kind'] !== 'string') return []

  const out = new Set<string>()

  // Forward path: a flat refs closure was recorded at write time.
  const refs = record['refs']
  if (Array.isArray(refs)) {
    for (const r of refs) {
      const s = String(r ?? '').toLowerCase()
      if (SIG_RE.test(s)) out.add(s)
    }
    if (out.size) return [...out]
    // refs present but empty / garbage — fall through to the htmlSig path.
  }

  // Legacy fallback: follow payload.htmlSig and parse the body for assets.
  const payload = record['payload']
  const htmlSig = payload && typeof payload === 'object'
    ? String((payload as Record<string, unknown>)['htmlSig'] ?? '').toLowerCase()
    : ''
  if (!SIG_RE.test(htmlSig)) return [...out]
  out.add(htmlSig)
  try {
    const bytes = await fetchHtml(htmlSig)
    if (bytes) for (const s of extractPageRefSigs(decode(bytes))) out.add(s)
    // INCOMPLETE-CLOSURE NOTE: if the body isn't reachable (a local-only caller
    // like host-sync whose machine doesn't hold the body → bytes === null),
    // only htmlSig is returned; the body's embedded images/stylesheets are NOT
    // enumerated. The closure completes once the body itself is held on the
    // pushing machine (host-sync runs on the AUTHORING machine, which normally
    // holds it) or is fetched by a network caller (adopt).
  } catch { /* body fetch threw — htmlSig still carried, assets not enumerated */ }
  return [...out]
}
