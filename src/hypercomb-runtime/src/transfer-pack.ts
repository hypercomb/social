// hypercomb-runtime/src/transfer-pack.ts
//
// THE TRANSFER PACK (documentation/atomic-modules-plan.md, "Atomize for the
// editor, optimize for the reader"). One file carrying many content-addressed
// files, so a cold install is one request instead of hundreds. It packs the
// TRANSFER only: every member unpacks into the store under its own signature,
// and the browser still loads one module per atom.
//
// A DERIVED RECORD. The `transfer:packs` pool names a package's pack by the
// package's root signature; the pack itself is content-addressed like any
// file. Anyone may mint one, a reader re-hashes every member against its own
// name, and a reader with no pack — or a wrong one — installs the same
// package from loose files. Nothing may make it load-bearing.
//
// FORMAT, before gzip: a magic line, a JSON line of [signature, byteLength]
// pairs in the order the bytes follow, then the members' bytes back to back.
// Pure: the essentials build mints packs with the same two functions.

export const TRANSFER_PACKS_MEANING = 'transfer:packs'

const MAGIC = 'hypercomb-pack 1'
const NEWLINE = 10

/** Pack members, sorted by signature so the same set packs to the same bytes. */
export const encodeTransferPack = (members: ReadonlyArray<readonly [string, Uint8Array]>): Uint8Array<ArrayBuffer> => {
  const sorted = [...members].sort(([a], [b]) => a.localeCompare(b))
  const head = new TextEncoder().encode(`${MAGIC}\n${JSON.stringify(sorted.map(([sig, bytes]) => [sig, bytes.byteLength]))}\n`)
  const out = new Uint8Array(head.byteLength + sorted.reduce((total, [, bytes]) => total + bytes.byteLength, 0))
  out.set(head, 0)
  let at = head.byteLength
  for (const [, bytes] of sorted) {
    out.set(bytes, at)
    at += bytes.byteLength
  }
  return out
}

/** The members, or null when these are not pack bytes. Verifies nothing: the
 *  reader hashes each member against its own name. */
export const decodeTransferPack = (bytes: Uint8Array): Array<[string, Uint8Array<ArrayBuffer>]> | null => {
  const first = bytes.indexOf(NEWLINE)
  const second = first < 0 ? -1 : bytes.indexOf(NEWLINE, first + 1)
  if (second < 0) return null
  const decoder = new TextDecoder()
  if (decoder.decode(bytes.subarray(0, first)) !== MAGIC) return null
  let index: unknown
  try { index = JSON.parse(decoder.decode(bytes.subarray(first + 1, second))) } catch { return null }
  if (!Array.isArray(index)) return null
  const members: Array<[string, Uint8Array<ArrayBuffer>]> = []
  let at = second + 1
  for (const entry of index) {
    if (!Array.isArray(entry) || typeof entry[0] !== 'string' || !Number.isInteger(entry[1]) || entry[1] < 0) return null
    const end = at + (entry[1] as number)
    if (end > bytes.byteLength) return null
    members.push([entry[0], bytes.slice(at, end)])
    at = end
  }
  return members
}

const streamOf = (bytes: Uint8Array): ReadableStream<BufferSource> => new Blob([bytes as Uint8Array<ArrayBuffer>]).stream()

/** gzip and back, with the platform's own streams — the browser's and Node's
 *  alike. Sig-named files travel uncompressed; a pack of JavaScript does not. */
export const gzipBytes = async (bytes: Uint8Array): Promise<Uint8Array<ArrayBuffer>> =>
  new Uint8Array(await new Response(streamOf(bytes).pipeThrough(new CompressionStream('gzip'))).arrayBuffer())
export const gunzipBytes = async (bytes: Uint8Array): Promise<Uint8Array<ArrayBuffer>> =>
  new Uint8Array(await new Response(streamOf(bytes).pipeThrough(new DecompressionStream('gzip'))).arrayBuffer())
