// sharing/client-presence.drone.ts
//
// CLIENT PRESENCE — every client install (a browser profile's web shell, a
// native --instance, a Store install) announces itself on the participant's
// relay so ALL of their clients can be listed from any one of them. This is
// what lets DCP show the Chrome client while running in Edge: the roster is
// aggregated HERE (the hive shell has the mesh + the room/secret pair) and
// handed to DCP through the portal handoff — DCP itself stays mesh-free.
//
// ADDRESSING — room+secret scoped, one rendezvous for the participant:
//
//   clientsChannel = sha256("hc:clients\0" + room + "\0" + secret)
//
// Every install of the same participant computes the same channel with no
// exchange; each publishes a NIP-33 replaceable record (d = "c:"+clientId,
// scoped per pubkey — every install has its own nostr keypair, so records
// never replace each other) with a NIP-40 expiration. No room/secret set ⇒
// solo participant ⇒ no channel; the roster is just this install.
//
// The record is display/bookkeeping metadata only — never resolution. The
// installed package is reported by its rootLayerSig; DCP resolves that to a
// `generation` (vN) against the manifest it already has.
//
// KIND 30207 — MUST stay in SwarmDrone.configureKinds() or the relay filter
// drops it (same rule as the whole FEEDBACK_* family).

import { Drone, EffectBus, SignatureService, getClientIdentity } from '@hypercomb/core'

export const CLIENT_PRESENCE_KIND = 30207

const MESH_KEY = '@diamondcoreprocessor.com/NostrMeshDrone'
const ROOM_KEY = '@hypercomb.social/RoomStore'
const SECRET_KEY = '@hypercomb.social/SecretStore'

const HEX64 = /^[0-9a-f]{64}$/
// Relay retention — a client that hasn't spoken for a week drops off the
// roster naturally (NIP-40). Long, because the roster lists INSTALLS, not
// live sessions: a laptop opened weekly should still appear.
const PRESENCE_TTL_SEC = 7 * 24 * 60 * 60
// Re-announce cadence while the app is open.
const REPUBLISH_MS = 30 * 60_000
// The aggregated roster, readable by the shells (portal handoff).
const ROSTER_KEY = 'hc:clients:roster'
// The shell records its installed package sig here (ensure-install).
const SYNC_SIG_KEY = 'sentinel.sync-signature'

type MeshEvt = { relay: string; sig: string; event: { kind?: number; pubkey?: string } | null; payload: unknown }
type MeshSub = { close: () => void }
interface MeshLike {
  publish: (kind: number, sig: string, payload: unknown, extraTags?: string[][]) => Promise<boolean>
  subscribe: (sig: string, cb: (e: MeshEvt) => void, opts?: { sinceSec?: number | null }) => MeshSub
}
interface ValueLike { value: string }

/** One client install as announced on the relay / held in the roster. */
export type ClientPresenceRecord = {
  id: string
  name: string
  platform: string
  packageSig?: string
  lastSeen: number
}

const ioc = (): { get: <T>(k: string) => T | undefined } | undefined =>
  (window as { ioc?: { get: <T>(k: string) => T | undefined } }).ioc

const enc = new TextEncoder()

export class ClientPresenceDrone extends Drone {

  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'sharing'

  public override description =
    'Announces this client install (id, name, platform, installed package sig) on the participant\'s room+secret-scoped relay channel and aggregates every install\'s announcement into a local roster, so any one client — and DCP via the portal handoff — can list all of them.'

  protected override listens: string[] = []
  protected override emits: string[] = ['clients:roster']

  #initialized = false
  #sub: MeshSub | null = null
  #timer: ReturnType<typeof setInterval> | null = null

  protected override sense = () => true
  protected override heartbeat = async (): Promise<void> => {
    if (this.#initialized) return
    this.#initialized = true

    const reg = (window as { ioc?: { whenReady?: (key: string, cb: (v: unknown) => void) => void } }).ioc
    reg?.whenReady?.(MESH_KEY, () => void this.#ensureStarted())
    await this.#ensureStarted()
  }

  /** The participant's clients rendezvous — '' without a room/secret pair. */
  static async channel(): Promise<string> {
    const room = (ioc()?.get<ValueLike>(ROOM_KEY)?.value ?? '').trim()
    const secret = (ioc()?.get<ValueLike>(SECRET_KEY)?.value ?? '').trim()
    if (!room || !secret) return ''
    return SignatureService.sign(enc.encode(`hc:clients\0${room}\0${secret}`).buffer as ArrayBuffer)
  }

  readonly #ensureStarted = async (): Promise<void> => {
    if (this.#sub) return
    const mesh = ioc()?.get<MeshLike>(MESH_KEY)
    if (!mesh?.subscribe || !mesh.publish) return   // whenReady retries
    const channel = await ClientPresenceDrone.channel()
    // Always seed the roster with SELF, channel or not — the portal handoff
    // reads the roster, and a solo participant still has one client.
    this.#upsert(this.#selfRecord())
    if (!channel) return

    // Full-TTL replay: announcements published while this browser was closed
    // must still arrive on the next open.
    this.#sub = mesh.subscribe(channel, (e) => this.#onPresence(e), { sinceSec: PRESENCE_TTL_SEC })

    await this.#announce(mesh, channel)
    this.#timer = setInterval(() => void this.#announce(mesh, channel), REPUBLISH_MS)
  }

  #selfRecord(): ClientPresenceRecord {
    const identity = getClientIdentity()
    let packageSig = ''
    try { packageSig = (localStorage.getItem(SYNC_SIG_KEY) ?? '').trim().toLowerCase() } catch { /* unavailable */ }
    return {
      id: identity.id,
      name: identity.name,
      platform: identity.platform,
      packageSig: HEX64.test(packageSig) ? packageSig : undefined,
      lastSeen: Date.now(),
    }
  }

  readonly #announce = async (mesh: MeshLike, channel: string): Promise<void> => {
    const record = this.#selfRecord()
    this.#upsert(record)
    const expiresAt = Math.floor(Date.now() / 1000) + PRESENCE_TTL_SEC
    // Replaceable per client: one live record per install (d scoped to our
    // pubkey), refreshed on every announce.
    await mesh.publish(CLIENT_PRESENCE_KIND, channel, record, [['d', `c:${record.id}`], ['expiration', String(expiresAt)]])
  }

  readonly #onPresence = (e: MeshEvt): void => {
    if (!e || Number(e.event?.kind) !== CLIENT_PRESENCE_KIND) return
    const p = (e.payload && typeof e.payload === 'object') ? e.payload as Partial<ClientPresenceRecord> : null
    const id = String(p?.id ?? '').trim().toLowerCase()
    if (!HEX64.test(id)) return
    this.#upsert({
      id,
      name: String(p?.name ?? '').trim().slice(0, 60) || id.slice(0, 10),
      platform: String(p?.platform ?? '').trim().slice(0, 20) || 'web',
      packageSig: HEX64.test(String(p?.packageSig ?? '')) ? String(p?.packageSig) : undefined,
      lastSeen: Number(p?.lastSeen) || Date.now(),
    })
  }

  /** The aggregated roster, newest-first. */
  public roster(): ClientPresenceRecord[] {
    try {
      const parsed = JSON.parse(localStorage.getItem(ROSTER_KEY) ?? '[]')
      if (!Array.isArray(parsed)) return []
      return parsed.filter((r): r is ClientPresenceRecord =>
        !!r && typeof r === 'object' && HEX64.test(String(r.id ?? '')))
    } catch { return [] }
  }

  #upsert(record: ClientPresenceRecord): void {
    const rest = this.roster().filter(r => r.id !== record.id)
    const prior = this.roster().find(r => r.id === record.id)
    // A relay replay can arrive out of order — never move lastSeen backwards.
    if (prior && prior.lastSeen > record.lastSeen) record = { ...record, lastSeen: prior.lastSeen, packageSig: record.packageSig ?? prior.packageSig }
    const next = [record, ...rest].sort((a, b) => b.lastSeen - a.lastSeen)
    try { localStorage.setItem(ROSTER_KEY, JSON.stringify(next)) } catch { /* non-fatal */ }
    this.emitEffect('clients:roster', { clients: next })
  }

  public override dispose(): void {
    this.#sub?.close()
    this.#sub = null
    if (this.#timer) { clearInterval(this.#timer); this.#timer = null }
    super.dispose?.()
  }
}

const _clientPresence = new ClientPresenceDrone()
window.ioc.register('@diamondcoreprocessor.com/ClientPresenceDrone', _clientPresence)
