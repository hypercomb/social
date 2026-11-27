// pools/room-entries.ts
//
// ENTRIES A ROOM KEEPS TOGETHER. The classroom case: one leader's host, many
// participants with no host of their own, all joined to the same room. What a
// participant offers under a meaning lands on the room's host, signed by the
// participant who made it, and the whole room reads it back as one set whether
// or not its maker is still online (T1: sharing requires hosting, and the
// room's host is the one host everybody in the room already named).
//
// The mechanism is the swarm's own room pool (sharing/room-pool.ts), asked at
// another address:
//
//   address  sign(meaning \0 room \0 secret \0 host). It holds the room's
//            secret, so only the room can ask it. NEVER derived through the
//            pool registry, which keeps every meaning it derives in a list
//            anyone can read, and never logged.
//   member   the kind-30567 event readMember checks: ['pool', address],
//            ['head', the entry's atom], ['page', what the entry is OF], plus
//            ['name', what its maker calls themselves], so a node keeps a name
//            after its maker left, and ['gone', '1'] to take an entry back.
//   standing each signer's newest member per page (standingMembers). A host
//            deletes nothing, so taking an entry back is a newer member that
//            says gone (H4: hide, never delete; M3: the set only grows).
//
// The parts go before the head that names them, and the head before the member
// that points at it (T1). A listing is never proof (M1, M2): a member is
// trusted by its own signed bytes, and an entry only when its bytes hash to the
// head the member names (S3, T2). Every read is bounded in time, size and
// count: a body is let go the moment it runs past its size, and one read's
// members are taken a signer at a time, so no one key holds the room's read.
// A refusal is words; nothing here throws.
//
// It knows nothing about what an entry is: any colon meaning (P4). Whom a room
// admits is the host's own rule. A host that keeps bytes only for its own
// people refuses a participant's key, and the answer says so: the entry is
// then shared live, while its maker is here, and no longer.
//
// A dependency: it registers nothing.

import { I18N_IOC_KEY, SignatureService, get, roomPreimage, type I18nProvider } from '@hypercomb/core'
import { HOST_CONCURRENCY, fetchWithDeadline, mapBounded } from '../sharing/bounded-fetch.js'
import { nip98Header } from '../sharing/hive-pointer.js'
import { isJoinedHere } from '../sharing/membership.js'
import { readPoolListing } from '../sharing/pool-listing.js'
import { listingNames, memberTemplate, readMember, standingMembers, type RoomMember } from '../sharing/room-pool.js'
import { originOf } from '../sharing/zone-door.js'
import { readBodyCapped } from './bounded-body.js'
import type { PoolNode } from './pool-node.js'

const SIG = /^[0-9a-f]{64}$/
/** An entry is a row, not content: what a reader takes as a head unless it asks for more. */
const ENTRY_MAX_BYTES = 2 * 1024
/** A member is a claim (the host's own cap). */
const MEMBER_MAX_BYTES = 4096
/** Members fetched, and heads fetched, by one read. */
const MEMBERS_PER_READ = 256
/** Members remembered for one address, and addresses remembered, on this page. */
const MEMBERS_HELD_MAX = 4096
const ROOMS_HELD_MAX = 8
/** Further atoms one entry may name. */
const CLOSURE_MAX = 64
const NAME_MAX = 48
const SAID_MAX = 160
const HOST_TIMEOUT_MS = 8_000
/** A key that never answers (an extension's prompt left open) must not hold the line of shares. */
const SIGN_TIMEOUT_MS = 10_000

const MESH_KEY = '@diamondcoreprocessor.com/NostrMeshDrone'
const SWARM_KEY = '@diamondcoreprocessor.com/SwarmDrone'
const SIGNER_KEY = '@diamondcoreprocessor.com/NostrSigner'
const STORE_KEY = '@hypercomb.social/Store'
const ROOM_STORE_KEY = '@hypercomb.social/RoomStore'
const SECRET_STORE_KEY = '@hypercomb.social/SecretStore'

const t = (key: string, fallback: string, params?: Record<string, string | number>): string => {
  let said: string | undefined
  try { said = get<I18nProvider>(I18N_IOC_KEY)?.t(key, params) } catch { said = undefined }
  const text = said && said !== key ? said : fallback
  return params ? text.replace(/\{(\w+)\}/g, (hole, name: string) => name in params ? String(params[name]) : hole) : text
}

const exact = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
const signatureOf = (bytes: Uint8Array): Promise<string> => SignatureService.sign(exact(bytes))

/** `work`, given up on after `ms`: an await with no deadline of its own gets one. */
const within = <T>(work: Promise<T>, ms: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('timed out')), ms) })
  return Promise.race([work, late]).finally(() => clearTimeout(timer))
}

/** A meaning entries are left under: `family:name`, no spaces, nothing unprintable (P4). */
const isRoomMeaning = (meaning: unknown): meaning is string =>
  typeof meaning === 'string' && meaning.includes(':') && meaning.length <= 160 && !/[\s\u0000-\u001f\u007f]/.test(meaning)

const sigOf = (value: unknown): string => {
  const sig = String(value ?? '').trim().toLowerCase()
  return SIG.test(sig) ? sig : ''
}

/** One line of at most `max` characters: line breaks and unprintables become spaces, runs of space fold. */
const oneLine = (value: unknown, max: number): string =>
  Array.from(String(value ?? '').replace(/[\s\u0000-\u001f\u007f-\u009f]+/g, ' ').trim()).slice(0, max).join('').trim()

// ── what it works with ──────────────────────────────────────────────────────

/** The participant's own key, as far as this file needs it. */
export interface RoomEntriesSigner {
  signEvent(evt: { kind: number; created_at: number; tags: string[][]; content: string }): Promise<Record<string, unknown>>
  /** The key it signs with when one is already held. Never mints one and never asks for one. */
  knownPublicKeyHex?(): Promise<string | null>
}

/** What the room's host said to a write. No `status`: it never answered. `said`: its own words. */
export type RoomHostAnswer =
  | { readonly ok: true }
  | { readonly ok: false; readonly status?: number; readonly said?: string; readonly unsigned?: true }

/** Every external this file touches. Each is optional: the live one stands in for any left out. */
export interface RoomEntriesDeps {
  /** Is this tab joined to a room? */
  joined?(): boolean
  room?(): string
  secret?(): string
  /** The room's host: the meeting point this tab dials. '' when none. */
  host?(): string
  signer?(): RoomEntriesSigner | null
  /** The bytes this hive holds under a signature, or null. */
  bytesOf?(sig: string): Promise<Uint8Array | null>
  /** Send one atom to the host at `/<sig>`. */
  putAtom?(host: string, sig: string, bytes: Uint8Array): Promise<RoomHostAnswer>
  /** Send one signed member to the host at `/<address>/<name>`. */
  putMember?(host: string, address: string, name: string, bytes: Uint8Array): Promise<RoomHostAnswer>
  /** The host's listing of an address (newline names), or null when it listed nothing readable. */
  listing?(host: string, address: string): Promise<string | null>
  /** One member's bytes from the host, or null. */
  member?(host: string, address: string, name: string): Promise<Uint8Array | null>
  /** The bytes the host serves under a signature, no larger than `limit`, or null. */
  atom?(host: string, sig: string, limit: number): Promise<Uint8Array | null>
  /** What the participant calls themselves in the room. */
  myName?(): string
  /** Milliseconds, on the room's clock when it is known. */
  now?(): number
}

type Valued = { value?: unknown }
type MeshShape = { swarmHost?: () => string; now?: () => number }
type SwarmShape = { myLabel?: () => string }
type StoreShape = {
  getResourceLocal?(sig: string): Promise<Blob | null>
  getResource?(sig: string): Promise<Blob | null>
}

const liveBytesOf = async (sig: string): Promise<Uint8Array | null> => {
  const store = get<StoreShape>(STORE_KEY)
  const blob = await store?.getResourceLocal?.(sig).catch(() => null) ?? await store?.getResource?.(sig).catch(() => null) ?? null
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null
}

const liveNow = (): number => {
  const now = get<MeshShape>(MESH_KEY)?.now?.()
  return typeof now === 'number' && Number.isFinite(now) && now > 0 ? now : Date.now()
}

/** A GET of bytes no larger than `limit`. A host that holds nothing there answers a quiet 204 (`?held`). */
const liveBytes = async (url: string, limit: number): Promise<Uint8Array | null> => {
  const response = await fetchWithDeadline(url, {}, { timeoutMs: HOST_TIMEOUT_MS })
  if (response.status !== 200) return null
  return readBodyCapped(response, limit)
}

/** A PUT signed by the participant's own key (NIP-98), answered with the host's code and words. */
const signedPut = async (url: string, bytes: Uint8Array, signer: RoomEntriesSigner | null): Promise<RoomHostAnswer> => {
  const auth = signer ? await within(nip98Header(signer, url, 'PUT'), SIGN_TIMEOUT_MS).catch(() => null) : null
  if (!auth) return { ok: false, unsigned: true }
  let response: Response
  try {
    response = await fetchWithDeadline(url, { method: 'PUT', headers: { Authorization: auth }, body: exact(bytes) }, { timeoutMs: HOST_TIMEOUT_MS })
  } catch { return { ok: false } }
  if (response.ok) return { ok: true }
  return { ok: false, status: response.status, said: await response.text().catch(() => '') }
}

/** Hosts that said, on this page, that they take this key's uploads. */
const takers = new Set<string>()

/**
 * The question before the upload: `GET /<sig>?takes`, signed as the upload
 * would be. A host that knows it answers in a 200 with the code and words the
 * upload would get, so a host that keeps bytes for its own people is never
 * sent any. Null: send the upload (it takes, or nothing was learned).
 */
const askTakes = async (host: string, url: string, signer: RoomEntriesSigner | null): Promise<RoomHostAnswer | null> => {
  const ask = `${url}?takes&held`
  const auth = signer ? await within(nip98Header(signer, ask, 'GET'), SIGN_TIMEOUT_MS).catch(() => null) : null
  if (!auth) return { ok: false, unsigned: true }
  try {
    const response = await fetchWithDeadline(ask, { headers: { Authorization: auth }, cache: 'no-store' }, { timeoutMs: HOST_TIMEOUT_MS })
    if (response.status !== 200 || !(response.headers.get('content-type') ?? '').toLowerCase().includes('json')) return null
    const said = await response.json() as { takes?: unknown; status?: unknown; reason?: unknown } | null
    if (said?.takes === true) { takers.add(host); return null }
    if (said?.takes !== false) return null
    const status = Number(said.status)
    return { ok: false, status: status >= 400 && status <= 599 ? status : 403, said: String(said.reason ?? '') }
  } catch { return null }
}

const livePutAtom = async (host: string, sig: string, bytes: Uint8Array, signer: RoomEntriesSigner | null): Promise<RoomHostAnswer> => {
  const url = `${originOf(host)}/${sig}`
  if (!takers.has(host)) {
    const refused = await askTakes(host, url, signer)
    if (refused) return refused
  }
  const put = await signedPut(url, bytes, signer)
  if (!put.ok && (put.status === 401 || put.status === 403)) takers.delete(host)
  return put
}

/** The deps as this file runs them: what the caller gave, the live one for the rest, resolved when called. */
const withLive = (deps: RoomEntriesDeps = {}): Required<RoomEntriesDeps> => {
  const signer = deps.signer ?? (() => get<RoomEntriesSigner>(SIGNER_KEY) ?? null)
  return {
    joined: deps.joined ?? isJoinedHere,
    room: deps.room ?? (() => String(get<Valued>(ROOM_STORE_KEY)?.value ?? '')),
    secret: deps.secret ?? (() => String(get<Valued>(SECRET_STORE_KEY)?.value ?? '')),
    host: deps.host ?? (() => String(get<MeshShape>(MESH_KEY)?.swarmHost?.() ?? '')),
    signer,
    bytesOf: deps.bytesOf ?? liveBytesOf,
    putAtom: deps.putAtom ?? ((host, sig, bytes) => livePutAtom(host, sig, bytes, signer())),
    putMember: deps.putMember ?? ((host, address, name, bytes) => signedPut(`${originOf(host)}/${address}/${name}`, bytes, signer())),
    listing: deps.listing ?? ((host, address) => readPoolListing(originOf(host), address, { timeoutMs: HOST_TIMEOUT_MS, fresh: true })),
    member: deps.member ?? ((host, address, name) => liveBytes(`${originOf(host)}/${address}/${name}`, MEMBER_MAX_BYTES)),
    atom: deps.atom ?? ((host, sig, limit) => liveBytes(`${originOf(host)}/${sig}?held`, limit)),
    myName: deps.myName ?? (() => String(get<SwarmShape>(SWARM_KEY)?.myLabel?.() ?? '')),
    now: deps.now ?? liveNow,
  }
}

const hostOf = (deps: Required<RoomEntriesDeps>): string => {
  const host = String(deps.host() ?? '').trim()
  return originOf(host) ? host : ''
}

// ── the address, and where the tab stands ───────────────────────────────────

/**
 * Where a room keeps its entries of one meaning on its host. '' when there is
 * no room to address (no host, no room, no secret) or the meaning is not
 * `family:name`. It carries the room's secret: never register it, never log it.
 */
export async function roomEntriesAddress(meaning: string, room: string, secret: string, host: string): Promise<string> {
  if (!isRoomMeaning(meaning) || !String(room ?? '').trim() || !String(secret ?? '').trim()) return ''
  const preimage = roomPreimage(room, secret, host)
  return preimage ? SignatureService.sign(new TextEncoder().encode(`${meaning}\u0000${preimage}`).buffer as ArrayBuffer) : ''
}

/** What this tab is joined to, for a surface that must say where an entry goes. Never the secret. */
export function roomStanding(deps?: RoomEntriesDeps): { joined: boolean; host: string; room: string } {
  try {
    const live = withLive(deps)
    return { joined: live.joined() === true, host: hostOf(live), room: String(live.room() ?? '').trim() }
  } catch { return { joined: false, host: '', room: '' } }
}

// ── leaving an entry ────────────────────────────────────────────────────────

/** One entry a participant leaves in the room, or takes back. */
export interface RoomEntryInput {
  /** The signature of the entry atom being offered. */
  readonly head: string
  /** A stable 64-hex identity for the thing the entry is OF: a newer member for the same page replaces the older. */
  readonly page: string
  /** What the participant calls themselves: one line, at most 48 characters. Their room name when left out. */
  readonly name?: string
  /** Further atoms the entry names, which must be on the host for it to read. Sent before the head. */
  readonly closure?: readonly string[]
  /** True takes the entry back: the host deletes nothing, so this is a newer member that says gone. */
  readonly gone?: boolean
}

/** `live`: the host does not keep this key's entries, so the entry is shared only while its maker is in the room. */
export type RoomEntryShared =
  | { ok: true; host: string; kept: true }
  | { ok: false; reason: string; live?: true }

const refuse = (reason: string): RoomEntryShared => ({ ok: false, reason })

/** A host's refusal as words a person can read. A key the host does not admit is `live`, never an error. */
const refusal = (host: string, answer: Exclude<RoomHostAnswer, { ok: true }>): RoomEntryShared => {
  if (answer.unsigned) return refuse(t('room-entries.refuse.sign', 'The entry could not be signed.'))
  const said = oneLine(answer.said, SAID_MAX)
  if (answer.status === 401 || answer.status === 403) {
    return {
      ok: false,
      live: true,
      reason: said
        ? t('room-entries.live.said', '{host} keeps entries only for its own people ({said}). Your entry is shared live while you are here.', { host, said })
        : t('room-entries.live.plain', '{host} keeps entries only for its own people. Your entry is shared live while you are here.', { host }),
    }
  }
  if (answer.status === undefined) {
    return refuse(t('room-entries.refuse.unreachable', '{host} did not answer. The entry was not kept there.', { host }))
  }
  return refuse(t('room-entries.refuse.host', '{host} did not take the entry ({said}).', { host, said: said || String(answer.status) }))
}

/** The stamp of the member last written for an address and page: the next one is always newer. Memory only. */
const lastWritten = new Map<string, number>()

async function shareNow(meaning: string, input: RoomEntryInput, live: Required<RoomEntriesDeps>): Promise<RoomEntryShared> {
  if (!isRoomMeaning(meaning)) {
    return refuse(t('room-entries.refuse.meaning', 'An entry is left under a name like family:name, with a colon and no spaces.'))
  }
  if (live.joined() !== true) {
    return refuse(t('room-entries.refuse.not-joined', 'Join a room first. An entry is shared with the room you are in.'))
  }
  const host = hostOf(live)
  const address = host ? await roomEntriesAddress(meaning, live.room(), live.secret(), host) : ''
  if (!address) return refuse(t('room-entries.refuse.no-host', 'This room has no host, so there is nowhere to keep an entry.'))

  const head = sigOf(input?.head)
  const page = sigOf(input?.page)
  const closure = [...new Set((input?.closure ?? []).map(sigOf))]
  if (!head || !page || closure.includes('')) {
    return refuse(t('room-entries.refuse.signature', 'The entry, or a piece it names, is not a signature.'))
  }
  if (closure.length > CLOSURE_MAX) {
    return refuse(t('room-entries.refuse.closure', 'This entry names more than {max} other pieces.', { max: CLOSURE_MAX }))
  }
  const signer = live.signer()
  if (!signer) return refuse(t('room-entries.refuse.signer', 'This device has no key to sign the entry with.'))

  // The parts, then the head that names them: a member never points at bytes the host does not hold.
  // Taking an entry back sends none: its member names the head only to say which entry is gone.
  if (!input.gone) {
    for (const sig of [...closure.filter(part => part !== head), head]) {
      const bytes = await within(live.bytesOf(sig), HOST_TIMEOUT_MS).catch(() => null)
      if (!bytes || await signatureOf(bytes) !== sig) {
        return refuse(t('room-entries.refuse.missing', 'A piece of this entry is not held here, so it cannot be sent.'))
      }
      const put = await live.putAtom(host, sig, bytes).catch((): RoomHostAnswer => ({ ok: false }))
      if (!put.ok) return refusal(host, put)
    }
  }

  const written = `${address}:${page}`
  const at = Math.max(Math.floor(live.now() / 1000), (lastWritten.get(written) ?? 0) + 1)
  const name = oneLine(input.name ?? live.myName(), NAME_MAX)
  const base = memberTemplate(address, page, head, at)
  const template = { ...base, tags: [...base.tags, ...(name ? [['name', name]] : []), ...(input.gone ? [['gone', '1']] : [])] }
  let bytes: Uint8Array
  try { bytes = new TextEncoder().encode(JSON.stringify(await within(signer.signEvent(template), SIGN_TIMEOUT_MS))) } catch {
    return refuse(t('room-entries.refuse.sign', 'The entry could not be signed.'))
  }
  const memberName = await signatureOf(bytes)
  // What goes up is what every reader will accept: this address, this head, this page, a valid signature.
  const member = await entryMember(address, memberName, bytes)
  if (!member || member.head !== head || member.page !== page) {
    return refuse(t('room-entries.refuse.sign', 'The entry could not be signed.'))
  }
  const put = await live.putMember(host, address, memberName, bytes).catch((): RoomHostAnswer => ({ ok: false }))
  if (!put.ok) return refusal(host, put)
  lastWritten.set(written, at)
  return { ok: true, host, kept: true }
}

/** One share at a time: a burst of presses reaches the host in the order it was made. */
let line: Promise<unknown> = Promise.resolve()

/**
 * Leave an entry in the room, or take one back (`gone`): its closure, then its
 * head, go to the room's host as atoms, then a member signed by the
 * participant's own key points at the head. Refuses when this tab is not
 * joined, when the room has no host, and when the meaning has no colon. A host
 * that does not admit the key answers `live: true`, with words. Never throws.
 */
export function shareRoomEntry(meaning: string, input: RoomEntryInput, deps?: RoomEntriesDeps): Promise<RoomEntryShared> {
  const turn = line
    .then(() => shareNow(meaning, input, withLive(deps)))
    .catch(() => refuse(t('room-entries.refuse.failed', 'The entry could not be shared with the room.')))
  line = turn
  return turn
}

// ── reading the room back ───────────────────────────────────────────────────

/** One entry as the room holds it: who signed it, what they call themselves, and its verified bytes. */
export interface RoomEntryRead {
  /** The public key that signed the member. */
  signer: string
  /** What the signer called themselves when they left it. */
  name?: string
  head: string
  page: string
  /** Seconds: when the member was signed. */
  at: number
  /** The entry atom: bytes that hash to `head`. */
  bytes: Uint8Array
  /** True for the reader's own key. */
  you: boolean
}

/** A member as read, with the two tags this file adds. */
interface HeldMember extends RoomMember {
  readonly label: string
  readonly gone: boolean
}

/** address, then member name: the member as read, or null for bytes that are not one. A member's bytes hash to
 *  its name, so its reading never changes and it is fetched once. Memory only, the oldest address let go first. */
const rooms = new Map<string, Map<string, HeldMember | null>>()

const heldFor = (address: string): Map<string, HeldMember | null> => {
  let held = rooms.get(address)
  if (!held) {
    held = new Map()
    rooms.set(address, held)
    if (rooms.size > ROOMS_HELD_MAX) rooms.delete(rooms.keys().next().value as string)
  }
  return held
}

const hold = (held: Map<string, HeldMember | null>, name: string, member: HeldMember | null): void => {
  if (held.has(name) || held.size < MEMBERS_HELD_MAX) held.set(name, member)
}

const tagOf = (tags: unknown, name: string): string => {
  const hit = Array.isArray(tags) ? tags.find((tag): tag is unknown[] => Array.isArray(tag) && tag[0] === name) : undefined
  return typeof hit?.[1] === 'string' ? hit[1] : ''
}

/** Bytes as a member of this address (readMember's checks, signature included) with its name and gone tags. */
const entryMember = async (address: string, name: string, bytes: Uint8Array): Promise<HeldMember | null> => {
  const member = await readMember(address, name, bytes)
  if (!member) return null
  const tags = (JSON.parse(new TextDecoder().decode(bytes)) as { tags?: unknown }).tags
  return { ...member, label: oneLine(tagOf(tags, 'name'), NAME_MAX), gone: tagOf(tags, 'gone') === '1' }
}

/** One atom from the host, kept only when it is no larger than `limit` and hashes to its name (S3). */
const verifiedAtom = async (live: Required<RoomEntriesDeps>, host: string, sig: string, limit: number): Promise<Uint8Array | null> => {
  const bytes = await live.atom(host, sig, limit).catch(() => null)
  return bytes && bytes.byteLength > 0 && bytes.byteLength <= limit && await signatureOf(bytes) === sig ? bytes : null
}

/**
 * The members one read takes, newest first. A stamp ahead of the room's clock
 * counts as now, and the cut is taken a signer at a time (everyone's newest,
 * then everyone's second newest), so no one key can stamp or crowd the rest
 * out of the read.
 */
const takenForRead = (standing: readonly HeldMember[], nowSeconds: number): HeldMember[] => {
  const dated = (member: HeldMember): number => Math.min(member.at, nowSeconds)
  // Two members dated the same keep the order their own stamps give, then their names: never an order that changes between reads.
  const newestFirst = (a: HeldMember, b: HeldMember): number => dated(b) - dated(a) || b.at - a.at || (a.name < b.name ? -1 : 1)
  const current = [...standing].sort(newestFirst)
  const turns = new Map<string, number>()
  const turnOf = new Map<HeldMember, number>()
  for (const member of current) {
    const turn = turns.get(member.signer) ?? 0
    turnOf.set(member, turn)
    turns.set(member.signer, turn + 1)
  }
  return [...current]
    .sort((a, b) => (turnOf.get(a) as number) - (turnOf.get(b) as number) || newestFirst(a, b))
    .slice(0, MEMBERS_PER_READ)
    .sort(newestFirst)
    .map(member => member.at > nowSeconds ? { ...member, at: nowSeconds } : member)
}

/**
 * The room's entries of one meaning: the host's listing of the address, every
 * member verified, the newest per signer and page, without those taken back,
 * each with its entry atom fetched and checked against the head it names.
 * Newest first, and no entry is dated later than the room's clock. One call
 * fetches at most 256 members it has not read before and at most 256 heads, a
 * few at once, the heads shared out a signer at a time; a head larger than
 * `maxHeadBytes` (an entry: 2 KB) is not taken. [] when not joined or
 * unreachable. Never throws.
 */
export async function readRoomEntries(
  meaning: string,
  deps?: RoomEntriesDeps,
  options: { maxHeadBytes?: number } = {},
): Promise<RoomEntryRead[]> {
  try {
    const live = withLive(deps)
    if (live.joined() !== true) return []
    const host = hostOf(live)
    const address = host ? await roomEntriesAddress(meaning, live.room(), live.secret(), host) : ''
    if (!address) return []
    const listing = await live.listing(host, address).catch(() => null)
    if (listing === null) return []

    const held = heldFor(address)
    const unread = [...new Set(listingNames(listing))].filter(name => !held.has(name)).slice(0, MEMBERS_PER_READ)
    const fetched = await mapBounded(unread, HOST_CONCURRENCY, async (name) => {
      const bytes = await live.member(host, address, name)
      // Bytes that are not the ones named may be a bad transfer: asked again next time, never remembered.
      if (!bytes || bytes.byteLength > MEMBER_MAX_BYTES || await signatureOf(bytes) !== name) return undefined
      return entryMember(address, name, bytes)
    })
    const read = new Map(held)
    unread.forEach((name, index) => {
      const member = fetched[index]
      if (member === undefined) return
      read.set(name, member)
      hold(held, name, member)
    })

    const members = [...read.values()].filter((member): member is HeldMember => member !== null)
    const standing = takenForRead(
      standingMembers(members).map(member => read.get(member.name) as HeldMember).filter(member => !member.gone),
      Math.floor(live.now() / 1000),
    )

    const limit = Math.max(1, Math.floor(options.maxHeadBytes ?? ENTRY_MAX_BYTES))
    const heads = [...new Set(standing.map(member => member.head))]
    const atoms = await mapBounded(heads, HOST_CONCURRENCY, head => verifiedAtom(live, host, head, limit))
    const bytesOf = new Map(heads.map((head, index) => [head, atoms[index] ?? null]))
    const own = sigOf(await live.signer()?.knownPublicKeyHex?.().catch(() => null))

    const entries: RoomEntryRead[] = []
    for (const member of standing) {
      const bytes = bytesOf.get(member.head)
      if (!bytes) continue
      entries.push({
        signer: member.signer,
        ...(member.label ? { name: member.label } : {}),
        head: member.head,
        page: member.page,
        at: member.at,
        bytes,
        you: !!own && member.signer === own,
      })
    }
    return entries
  } catch { return [] }
}

/** Where an entry came from, as a node: the participant who signed it (pools/pool-node.ts). */
export const roomEntryNode = (read: RoomEntryRead): PoolNode => ({
  kind: 'participant',
  id: read.signer,
  ...(read.name ? { name: read.name } : {}),
  ...(read.you ? { you: true } : {}),
})

/**
 * One verified atom from the room's host, no larger than `limit`: for a reader
 * that then needs what an entry names. Null when not joined, when the room has
 * no host, or when the host serves nothing that hashes to `sig`. Never throws.
 */
export async function roomAtom(sig: string, limit: number, deps?: RoomEntriesDeps): Promise<Uint8Array | null> {
  try {
    const live = withLive(deps)
    const wanted = sigOf(sig)
    const host = live.joined() === true ? hostOf(live) : ''
    if (!wanted || !host) return null
    return await verifiedAtom(live, host, wanted, Math.floor(limit))
  } catch { return null }
}
