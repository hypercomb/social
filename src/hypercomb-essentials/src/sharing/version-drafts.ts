// sharing/version-drafts.ts
//
// AUTHORING THE MINIMAL BUILD FROM THE BROWSER, WITH A PARTICIPANT TO BUILD.
// The browser holds the version pools (version-pools.ts) and can read every
// file a revision carries. It cannot build — that would make a compiler a
// dependency the hive carries — so a change goes to a BUILDER, a participant
// with the tooling (any host restored from the pools has it):
//
//   1. a DRAFT, staged here: the revision it starts from (its base) and the
//      files it changes, each kept by its signature in this browser's pools
//         { name:'draft', label, base, files:<layer sig>, at }
//         layer { name:'draft-files', files: { path: sig | null } }   null = delete
//   2. the ASK (deployment-stages.md R12): a signed event naming the draft,
//      its size and the host it is sent to. Its signer is the draft's author.
//         kind 30568, content `hc:ask:v1\n<draft sig>`,
//         tags d=<draft sig>, h=<host>, bytes, count
//   3. SENT under the host's grant: every byte the draft needs and the ask
//      itself, each PUT at /<sig> with the participant's NIP-98 signature,
//      the same door every backup upload uses. The host meters it against
//      the key's quota; bytes the host already holds cost nothing.
//   4. the builder (hypercomb-shim host/builds.mjs `build-draft <host> <ask>`)
//      verifies the ask and every file, checks the base out of its pools,
//      lays the files over it, builds, tests and promotes; the revision names
//      the draft and the ask, so the author is known wherever it travels.
//   5. the browser pulls the new revision back (`/versions pull`).
//
// Nothing here runs code: a draft is text in a pool until a builder makes it
// a revision, and a revision runs only through the paths it always did.

import { SignatureService } from '@hypercomb/core'
import { nip98Header } from './hive-pointer.js'
import { BUILDS_MEANING, SIGNATURES_MEANING, opfsPools, type PoolIo } from './version-pools.js'

export const ASK_KIND = 30568
export const askPreimage = (draftSig: string): string => `hc:ask:v1\n${draftSig}`

const SIG = /^[a-f0-9]{64}$/
const SIGNER_KEY = '@diamondcoreprocessor.com/NostrSigner'
const encode = (text: string): Uint8Array => new TextEncoder().encode(text)
const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes)
const signOf = (bytes: Uint8Array): Promise<string> =>
  SignatureService.sign(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)

const keep = async (io: PoolIo, meaning: string, bytes: Uint8Array): Promise<string> => {
  const sig = await signOf(bytes)
  if (!await io.read(meaning, sig)) await io.write(meaning, sig, bytes)
  return sig
}
const readJson = async <T>(io: PoolIo, sig: string): Promise<T | null> => {
  const bytes = SIG.test(sig) ? await io.read(BUILDS_MEANING, sig) : null
  if (!bytes) return null
  try { return JSON.parse(decode(bytes)) as T } catch { return null }
}

type BuildRecord = { name?: string; label?: string; version?: string; workspace?: string; package?: string }
type Layer = { name?: string; files?: Record<string, string | null> }

/** Every file a host revision carries, by path → signature: its workspace,
 *  which is what a rebuild reads (builds.mjs WORKSPACE). */
export const revisionFiles = async (revision: string, io: PoolIo = opfsPools()): Promise<Record<string, string>> => {
  const record = await readJson<BuildRecord>(io, revision)
  if (record?.name !== 'build') throw new Error(`${revision.slice(0, 12)} is not a revision this browser holds`)
  if (!record.workspace) throw new Error(`${record.label} ${record.version} carries no workspace — draft from a host revision`)
  const layer = await readJson<Layer>(io, record.workspace)
  if (!layer?.files) throw new Error(`the workspace of ${record.version} is not held here`)
  return Object.fromEntries(Object.entries(layer.files).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
}

/** One file of a revision, as text. */
export const readRevisionFile = async (revision: string, path: string, io: PoolIo = opfsPools()): Promise<string> => {
  const sig = (await revisionFiles(revision, io))[path]
  if (!sig) throw new Error(`${path} is not in that revision`)
  const bytes = await io.read(BUILDS_MEANING, sig)
  if (!bytes) throw new Error(`${path} (${sig.slice(0, 12)}) is not held here`)
  return decode(bytes)
}

export type DraftRequest = {
  /** The host revision the draft starts from. */
  base: string
  /** The story the result is promoted in (default: hypercomb-essentials). */
  label?: string
  /** path → the file's new text; null deletes it. */
  files: Record<string, string | null>
}

/** Stage a draft in this browser's pools. Its signature names it. */
export const stageDraft = async (request: DraftRequest, io: PoolIo = opfsPools(), now = new Date()): Promise<string> => {
  const paths = Object.keys(request.files)
  if (!paths.length) throw new Error('a draft changes at least one file')
  const held = await revisionFiles(request.base, io)
  const named: Record<string, string | null> = {}
  for (const path of paths.sort()) {
    if (path.startsWith('/') || path.split('/').includes('..')) throw new Error(`${path} is not a path inside the tree`)
    const text = request.files[path]
    if (text === null) {
      if (!held[path]) throw new Error(`${path} cannot be deleted: the base does not carry it`)
      named[path] = null
    } else {
      named[path] = await keep(io, BUILDS_MEANING, encode(String(text)))
    }
  }
  const files = await keep(io, BUILDS_MEANING, encode(JSON.stringify({ name: 'draft-files', files: named })))
  const record = { name: 'draft', label: request.label ?? 'hypercomb-essentials', base: request.base, files, at: now.toISOString() }
  return keep(io, BUILDS_MEANING, encode(JSON.stringify(record)))
}

/** Every signature a draft needs on a host: the record, its files layer, the
 *  new files. The base is the builder's, from its own pools. */
export const draftClosure = async (draft: string, io: PoolIo = opfsPools()): Promise<string[]> => {
  const record = await readJson<{ name?: string; files?: string }>(io, draft)
  if (record?.name !== 'draft' || !record.files) throw new Error(`${draft.slice(0, 12)} is not a draft held here`)
  const layer = await readJson<Layer>(io, record.files)
  if (!layer?.files) throw new Error('the draft\'s files are not held here')
  return [draft, record.files, ...Object.values(layer.files).filter((sig): sig is string => typeof sig === 'string')]
}

type Signer = {
  signEvent(event: { kind: number; created_at: number; tags: string[][]; content: string }): Promise<Record<string, unknown>>
  getPublicKeyHex?(): Promise<string | null>
}
const signer = (): Signer | undefined =>
  (globalThis as { ioc?: { get?: <T>(key: string) => T | undefined } }).ioc?.get?.<Signer>(SIGNER_KEY)

const schemeFor = (host: string): string => /^https?:\/\//.test(host) ? '' : (/^(localhost|127\.|\[?::1)/.test(host) || /\.localhost(:\d+)?$/.test(host) ? 'http://' : 'https://')
const originOf = (host: string): string => `${schemeFor(host)}${host}`.replace(/\/+$/, '')

export type AskOutcome =
  | { ok: true; ask: string; draft: string; sent: number; held: number }
  | { ok: false; error: string; sent?: number }

/** Sign the ask for `draft` and send the draft and the ask to `host` under
 *  this key's grant. The returned ask signature is what a builder is given. */
export const askBuild = async (
  draft: string,
  host: string,
  { io = opfsPools(), sign = signer(), put = (url: string, init: RequestInit) => fetch(url, init) }: { io?: PoolIo; sign?: Signer; put?: (url: string, init: RequestInit) => Promise<Response> } = {},
): Promise<AskOutcome> => {
  if (!sign) return { ok: false, error: 'no signer here: the ask is signed by the author' }
  const closure = await draftClosure(draft, io)
  const bytesOf = new Map<string, Uint8Array>()
  for (const sig of closure) {
    const bytes = await io.read(BUILDS_MEANING, sig)
    if (!bytes) return { ok: false, error: `${sig.slice(0, 12)} is not held here` }
    bytesOf.set(sig, bytes)
  }
  const origin = originOf(host)
  const total = [...bytesOf.values()].reduce((n, bytes) => n + bytes.byteLength, 0)
  const event = await sign.signEvent({
    kind: ASK_KIND, created_at: Math.floor(Date.now() / 1000), content: askPreimage(draft),
    tags: [['d', draft], ['h', origin], ['bytes', String(total)], ['count', String(closure.length)]],
  })
  const askBytes = encode(JSON.stringify(event))
  const ask = await keep(io, SIGNATURES_MEANING, askBytes)
  bytesOf.set(ask, askBytes)

  let sent = 0, held = 0
  for (const [sig, bytes] of bytesOf) {
    const url = `${origin}/${sig}`
    const auth = await nip98Header(sign, url, 'PUT')
    if (!auth) return { ok: false, error: 'the upload could not be signed', sent }
    const response = await put(url, { method: 'PUT', headers: { Authorization: auth }, body: bytes as unknown as BodyInit }).catch(() => null)
    if (!response) return { ok: false, error: `${host} did not answer`, sent }
    if (response.status === 401 || response.status === 403) return { ok: false, error: `${host} refused this key: ${(await response.text().catch(() => '')).trim() || response.status}`, sent }
    if (!response.ok) return { ok: false, error: `${host} answered ${response.status} for ${sig.slice(0, 12)}`, sent }
    if (response.status === 200) held++
    else sent++
  }
  return { ok: true, ask, draft, sent, held }
}

/** The drafts this browser holds, newest first. */
export const listDrafts = async (io: PoolIo = opfsPools()): Promise<Array<{ sig: string; label: string; base: string; at: string; paths: string[] }>> => {
  const out: Array<{ sig: string; label: string; base: string; at: string; paths: string[] }> = []
  const head = '{"name":"draft",'
  for (const sig of await io.names(BUILDS_MEANING)) {
    const bytes = await io.read(BUILDS_MEANING, sig)
    if (!bytes || bytes.length < head.length || decode(bytes.subarray(0, head.length)) !== head) continue
    const record = await readJson<{ label?: string; base?: string; at?: string; files?: string }>(io, sig)
    const layer = record?.files ? await readJson<Layer>(io, record.files) : null
    out.push({ sig, label: String(record?.label ?? ''), base: String(record?.base ?? ''), at: String(record?.at ?? ''), paths: Object.keys(layer?.files ?? {}) })
  }
  return out.sort((a, b) => (a.at < b.at ? 1 : -1))
}
