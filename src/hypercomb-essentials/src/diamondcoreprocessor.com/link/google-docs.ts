// diamondcoreprocessor.com/link/google-docs.ts
// Pure Google Docs link parsing + Apps Script bridge client — no class, no IoC.
// Mirrors youtube.ts/photo.ts: small helpers a worker consumes.
//
// The bridge is the participant's OWN Apps Script deployment (see
// documentation/google-docs-bridge.md). It is the only route in: the Drive API
// proper needs a Cloud project and sensitive-scope review, and drive.google.com
// cannot be scraped (virtualized rows, no hrefs, no export path).

/** Doc IDs are long base64url-ish strings; 25 is comfortably below the real 44. */
const DOC_ID = /^[A-Za-z0-9_-]{25,}$/

/**
 * Extract a Google Docs document ID from the shapes a participant actually
 * pastes. Returns null for anything that is not a Google Doc link, so callers
 * can fall through to the generic link handling.
 *
 * Handles:
 *   docs.google.com/document/d/{id}/edit
 *   docs.google.com/document/u/0/d/{id}/edit   (account-scoped)
 *   drive.google.com/open?id={id}
 *   drive.google.com/file/d/{id}/view
 */
export function parseGoogleDocId(link: string): string | null {
  let url: URL
  try {
    url = new URL(link)
  } catch {
    return null
  }

  const host = url.hostname.toLowerCase()
  if (host !== 'docs.google.com' && host !== 'drive.google.com') return null

  // /open?id={id} carries the ID in the query rather than the path.
  const queryId = url.searchParams.get('id')
  if (queryId && DOC_ID.test(queryId)) return queryId

  // Everything else puts it in the segment after "d". The `u/0` account prefix
  // shifts the position, so find "d" rather than indexing a fixed slot.
  const segments = url.pathname.split('/').filter(Boolean)
  const marker = segments.indexOf('d')
  if (marker === -1) return null

  const id = segments[marker + 1]
  return id && DOC_ID.test(id) ? id : null
}

/** The canonical edit URL for a doc ID — what a tile links out to. */
export function googleDocUrl(id: string): string {
  return `https://docs.google.com/document/d/${id}/edit`
}

/** Where the participant's deployment lives. URL + token together are a credential. */
export type GoogleDocsBridge = {
  /** The Apps Script web app /exec URL. */
  endpoint: string
  /** The shared secret compiled into that deployment. */
  token: string
}

export type GoogleDocSummary = {
  id: string
  name: string
  url: string
  /** ISO timestamp of Drive's last modification. */
  modified: string
  owner: string | null
  /** Immediate Drive parents — a hint to mark from, not the hive's structure. */
  parents: { id: string; name: string }[]
}

export type GoogleDocBody = {
  id: string
  name: string
  /** Markdown, the only format that survives the round trip in both directions. */
  content: string
  /** Drive's monotonic version counter — carry it back into pushGoogleDoc. */
  version: string | null
  modified: string
}

/**
 * A push either lands, is refused as stale, or fails. `stale` is modelled as a
 * distinct outcome rather than an error string because it is the one case a
 * caller must never treat as "try again harder" — someone edited in Google
 * after the hive last pulled, and forcing would destroy their work.
 */
export type GoogleDocsPushResult =
  | { status: 'ok'; version: string | null }
  | { status: 'stale'; current: string | null }
  | { status: 'failed'; error: string }

/**
 * Apps Script cannot set HTTP status codes, so a failure arrives as HTTP 200
 * with `{ok:false}`. Checking `response.ok` alone would read every error as a
 * success — the envelope is the only truth.
 */
type Envelope<T> = ({ ok: true } & T) | { ok: false; error: string; current?: string }

async function callBridge<T>(
  bridge: GoogleDocsBridge,
  init: { search?: Record<string, string>; body?: unknown },
  fetcher: typeof fetch,
  signal?: AbortSignal,
): Promise<Envelope<T>> {
  const url = new URL(bridge.endpoint)
  for (const [key, value] of Object.entries(init.search ?? {})) url.searchParams.set(key, value)
  if (!init.body) url.searchParams.set('token', bridge.token)

  const response = await fetcher(url.toString(), {
    ...(init.body
      ? {
          method: 'POST',
          // NOT application/json. That content type triggers a CORS preflight
          // which Apps Script does not answer, and the request dies before it
          // ever runs. text/plain is a "simple request" and goes straight
          // through; doPost JSON.parses the body regardless.
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ ...(init.body as object), token: bridge.token }),
        }
      : {}),
    ...(signal ? { signal } : {}),
  })

  if (!response.ok) {
    return { ok: false, error: `bridge unreachable (${response.status})` }
  }

  try {
    return await response.json() as Envelope<T>
  } catch {
    return { ok: false, error: 'bridge returned a non-JSON body' }
  }
}

/**
 * Every Doc in the participant's account, following the bridge's continuation
 * tokens to the end. Paging is the bridge's own iterator state, so a large
 * Drive arrives in slices rather than timing out the script.
 *
 * `maxPages` is a runaway guard, not a limit anyone should hit; when it trips
 * the docs gathered so far are still returned, because a partial inventory the
 * participant can see beats an exception they cannot.
 */
export async function listGoogleDocs(
  bridge: GoogleDocsBridge,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
  maxPages = 50,
): Promise<GoogleDocSummary[]> {
  const docs: GoogleDocSummary[] = []
  let pageToken: string | null = null

  for (let page = 0; page < maxPages; page++) {
    // Annotated, not inferred: `pageToken` feeds the call that produces
    // `result` and is then reassigned from it, which TS reads as a circular
    // initializer (TS7022) if the type is left to inference.
    const search: Record<string, string> = { action: 'list' }
    if (pageToken) search['pageToken'] = pageToken

    const result: Envelope<{ docs: GoogleDocSummary[]; nextPageToken: string | null }> =
      await callBridge<{ docs: GoogleDocSummary[]; nextPageToken: string | null }>(
        bridge,
        { search },
        fetcher,
        signal,
      )

    if (!result.ok) throw new Error(result.error)
    docs.push(...result.docs)

    pageToken = result.nextPageToken
    if (!pageToken) break
  }

  return docs
}

/** Read a Doc's current body as markdown, with the version stamp to push against. */
export async function readGoogleDoc(
  bridge: GoogleDocsBridge,
  id: string,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<GoogleDocBody> {
  const result = await callBridge<GoogleDocBody>(
    bridge,
    { search: { action: 'get', id } },
    fetcher,
    signal,
  )

  if (!result.ok) throw new Error(result.error)
  return {
    id: result.id,
    name: result.name,
    content: result.content,
    version: result.version ?? null,
    modified: result.modified,
  }
}

/**
 * Replace a Doc's body with the hive's canonical markdown.
 *
 * `baseVersion` is the version this content was edited from. The bridge
 * refuses the write if Google has moved past it — pass null only to force,
 * knowingly.
 */
export async function pushGoogleDoc(
  bridge: GoogleDocsBridge,
  doc: { id: string; markdown: string; baseVersion: string | null },
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<GoogleDocsPushResult> {
  const result = await callBridge<{ version: string | null }>(
    bridge,
    { body: { action: 'update', id: doc.id, markdown: doc.markdown, baseVersion: doc.baseVersion } },
    fetcher,
    signal,
  )

  if (result.ok) return { status: 'ok', version: result.version ?? null }
  if (result.error === 'stale') return { status: 'stale', current: result.current ?? null }
  return { status: 'failed', error: result.error }
}
