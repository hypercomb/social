// pools/bounded-body.ts
//
// A BODY FROM A HOST IS READ NO FURTHER THAN ITS CAP. A size limit checked
// after `arrayBuffer()` or `text()` is checked too late: by then the whole
// body is in memory, and a host that states no length (a chunked answer) or
// states the compressed one decides how much that is. Here the body is taken
// a piece at a time and let go the moment it runs past the limit, so what a
// followed host or a room's host can make this tab hold is the cap, never
// what it chose to send. A dependency: it registers nothing.

/**
 * A response's body, read no further than `limit` bytes: null once it runs
 * past, and the rest is never asked for. A stated length already past the
 * limit reads nothing. Only a response with no body stream is read whole.
 */
export async function readBodyCapped(response: Response, limit: number): Promise<Uint8Array | null> {
  if (Number(response.headers.get('content-length') ?? 0) > limit) {
    await response.body?.cancel().catch(() => undefined)
    return null
  }
  const reader = response.body?.getReader()
  if (!reader) {
    const all = new Uint8Array(await response.arrayBuffer())
    return all.byteLength > limit ? null : all
  }
  const parts: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > limit) {
      await reader.cancel().catch(() => undefined)
      return null
    }
    parts.push(value)
  }
  const out = new Uint8Array(size)
  let at = 0
  for (const part of parts) { out.set(part, at); at += part.byteLength }
  return out
}
