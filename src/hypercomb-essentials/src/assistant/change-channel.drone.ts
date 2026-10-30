// assistant/change-channel.drone.ts
//
// THE REMOTE HALF of the change channel: a change asked for on another
// machine reaches this hive, and this hive's answer goes back. Both cross the
// mesh's relay sealed (change-seal.ts), addressed to the channel id the shared
// secret derives (change-channel.ts). See documentation/change-channel.md.
//
// ON ONLY WITH A SHARED SECRET. Setting `hc:change-channel:secret` is the
// participant's own act and is what a shared secret is for: meeting their
// other devices and the sessions they hand it to. Without one the channel
// stays private to this install and nothing is subscribed or sent.
//
// A CHANGE THAT ARRIVES IS ONLY ASKED FOR. It is filed in the changes log as
// `requested` and the participant is told; nothing runs. Its sentences are
// said on this hive's command line only when the participant accepts it with
// the changes word (changes.queen.ts), and the answer, applied or declined,
// is sealed and sent back so the asker hears it.
//
// What arrives is checked before it is filed: it must open under the secret,
// be addressed to this channel, and have the shape of a change. Anything else
// is dropped without a word, since a relay is open to anyone.

import { Drone, EffectBus } from '@hypercomb/core'
import { CHANGE_SECRET_KEY, changeChannelId } from './change-channel.js'
import { sealChange, unsealChange } from './change-seal.js'
import { normalizeChangeRecord } from './change-record.js'
import { appendChangeRecord, type ChangeRecord } from './changes.js'

// NIP-33 parameterized-replaceable kind. Must be in SwarmDrone.configureKinds()
// or the mesh's relay filter drops it. 30218 is the pheromone deposit kind.
export const CHANGE_ITEM_KIND = 30219

const MESH_KEY = '@diamondcoreprocessor.com/NostrMeshDrone'
// A request must outlast a hive that is closed for a while: the relay replays
// what it still holds when the hive comes back.
const ITEM_TTL_SEC = 7 * 24 * 60 * 60

type MeshEvt = { payload: unknown }
type MeshSub = { close: () => void }
interface MeshLike {
  publish: (kind: number, sig: string, payload: unknown, extraTags?: string[][]) => Promise<boolean>
  subscribe: (sig: string, cb: (e: MeshEvt) => void, opts?: { sinceSec?: number | null }) => MeshSub
  isNetworkEnabled?: () => boolean
  setNetworkEnabled?: (enabled: boolean, persist?: boolean) => void
  nowSec?: () => number
}

const ioc = (): { get: <T>(k: string) => T | undefined } | undefined =>
  (window as { ioc?: { get: <T>(k: string) => T | undefined } }).ioc

const readSecret = (): string => {
  try { return String(window.localStorage.getItem(CHANGE_SECRET_KEY) ?? '').trim() } catch { return '' }
}

export class ChangeChannelDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'assistant'
  public override description =
    'Carries changes asked for on your other machines to this hive, sealed, and sends your answer back. On only with a shared change secret.'

  protected override emits: string[] = ['change:requested', 'toast:show', 'activity:log']

  #channel = ''
  #sub: MeshSub | null = null
  #starting = false

  protected override sense = () => true
  protected override heartbeat = async (): Promise<void> => { await this.#ensureActive() }

  /** Seal a record and send it on this hive's channel. False when the channel
   *  is not shared, the mesh is not ready, or no relay took it. */
  readonly send = async (record: ChangeRecord): Promise<boolean> => {
    const secret = readSecret()
    const mesh = ioc()?.get<MeshLike>(MESH_KEY)
    if (!secret || !mesh?.publish) return false
    const channel = await changeChannelId()
    if (record.channel !== channel) return false
    const sealed = await sealChange(secret, channel, record)
    const now = mesh.nowSec?.() ?? Math.floor(Date.now() / 1000)
    const tag = await sha256Hex(sealed)
    return mesh.publish(CHANGE_ITEM_KIND, channel, { v: 1, sealed }, [['d', `c:${tag}`], ['expiration', String(now + ITEM_TTL_SEC)]])
  }

  readonly #ensureActive = async (): Promise<void> => {
    if (this.#starting) return
    const secret = readSecret()
    if (!secret) { this.#stop(); return }
    this.#starting = true
    try {
      const channel = await changeChannelId()
      if (channel === this.#channel && this.#sub) return
      const mesh = ioc()?.get<MeshLike>(MESH_KEY)
      if (!mesh?.subscribe) return
      this.#stop()
      // Being on is an explicit "I want this live" (persist=false: the global
      // mesh preference belongs to other features).
      if (mesh.isNetworkEnabled && mesh.setNetworkEnabled && !mesh.isNetworkEnabled()) mesh.setNetworkEnabled(true, false)
      this.#channel = channel
      this.#sub = mesh.subscribe(channel, (e) => void this.#onEvent(channel, e), { sinceSec: ITEM_TTL_SEC })
    } finally {
      this.#starting = false
    }
  }

  #stop(): void {
    try { this.#sub?.close() } catch { /* already closed */ }
    this.#sub = null
    this.#channel = ''
  }

  readonly #onEvent = async (channel: string, e: MeshEvt): Promise<void> => {
    const secret = readSecret()
    if (!secret || channel !== this.#channel) return
    const payload = e?.payload as { sealed?: unknown } | string | null
    const sealed = typeof payload === 'string' ? payload : typeof payload?.sealed === 'string' ? payload.sealed : ''
    if (!sealed) return
    const record = normalizeChangeRecord(await unsealChange(secret, channel, sealed), channel)
    if (!record) return
    const written = await appendChangeRecord(record)
    if (!written?.added) return
    if (record.status === 'requested') {
      const count = record.sentences?.length ?? 0
      const message = `A change was asked for from elsewhere: "${record.task}", ${count} sentence${count === 1 ? '' : 's'}. Say changes to review it.`
      EffectBus.emit('change:requested', { id: record.id, task: record.task, sentences: count })
      EffectBus.emit('activity:log', { message, icon: '⇄' })
      EffectBus.emit('toast:show', { type: 'info', title: 'changes', message, duration: 10000 })
    }
  }
}

const sha256Hex = async (value: string): Promise<string> => {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes.buffer as ArrayBuffer)
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

const _changeChannel = new ChangeChannelDrone()
window.ioc.register('@diamondcoreprocessor.com/ChangeChannelDrone', _changeChannel)
