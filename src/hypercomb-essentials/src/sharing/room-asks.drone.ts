// sharing/room-asks.drone.ts
//
// ON ARRIVAL, WHAT THE ROOM ASKS (documentation/swarm-pools.md, step six).
// When this tab completes its room, the room's tiles are read for what they
// ask (room-asks.ts) and — once per room — a toast says so: one button per
// asked behaviour this shell has, which runs its word as typing it would
// (`notes` is the notes desk's own door), and a plain line for any it lacks.
// Nothing is turned on by itself, and no window opens but from its button.

import { Drone, EffectBus, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { isJoinedHere } from './membership.js'
import { currentRoomAsks, sortAsks } from './room-asks.js'

/** How long a room's tiles get to arrive before the room is read, and how
 *  long it keeps being re-read as peers arrive. */
const SETTLE_MS = 3_000
const WATCH_MS = 60_000

type SlashShape = { entries?: () => readonly { name?: string; aliases?: readonly string[] }[] }
type RoomPoolShape = { address?: () => Promise<string> }

const get = <T>(key: string): T | undefined =>
  (window as { ioc?: { get?: <V>(k: string) => V | undefined } }).ioc?.get?.<T>(key)

export class RoomAsksDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override description = 'On arriving in a room, says what the room asks for and offers to turn each on'

  protected override listens = ['swarm:zone-complete', 'swarm:peers-changed']
  protected override emits = ['toast:show']

  /** Rooms already answered this session (their pool address). */
  #answered = new Set<string>()
  /** When each room was first read — a room is watched for a while, not forever. */
  #firstRead = new Map<string, number>()
  #timer: ReturnType<typeof setTimeout> | null = null

  constructor() {
    super()
    // A room is read once its tiles start arriving: on completing the zone,
    // or — where a tab never says it completed — on the first peers it sees
    // while joined. Then it keeps being re-read for a while as more arrive.
    const start = (): void => { if (isJoinedHere()) this.#schedule() }
    EffectBus.on('swarm:zone-complete', start)
    EffectBus.on('swarm:peers-changed', start)
  }

  #schedule(): void {
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = setTimeout(() => { this.#timer = null; void this.#check() }, SETTLE_MS)
  }

  async #check(): Promise<void> {
    if (!isJoinedHere()) return
    const room = await get<RoomPoolShape>('@diamondcoreprocessor.com/RoomPool')?.address?.().catch(() => '') ?? ''
    const key = room || 'room'
    if (this.#answered.has(key)) return
    const first = this.#firstRead.get(key) ?? Date.now()
    this.#firstRead.set(key, first)
    if (Date.now() - first > WATCH_MS) return
    const asked = await currentRoomAsks()
    if (!asked.length) return
    this.#answered.add(key)

    const known = new Set<string>()
    for (const e of get<SlashShape>('@diamondcoreprocessor.com/SlashBehaviourDrone')?.entries?.() ?? []) {
      for (const n of [e.name, ...(e.aliases ?? [])]) if (n) known.add(String(n).toLowerCase())
    }
    const { have, lack } = sortAsks(asked, word => word === 'notes' || known.has(word))
    const t = (k: string, fallback: string, params?: Record<string, string | number>): string => {
      const v = get<I18nProvider>(I18N_IOC_KEY)?.t(k, params)
      return v && v !== k ? v : fallback
    }
    const lines = [t('room.asks.arrive', `This room asks for: ${asked.join(', ')}.`, { words: asked.join(', ') })]
    if (lack.length) lines.push(t('room.asks.lack', `This hive has no ${lack.join(', ')}.`, { words: lack.join(', ') }))
    EffectBus.emit('toast:show', {
      type: lack.length ? 'warning' : 'info',
      title: t('room.asks.title', 'The room asks'),
      message: lines.join(' '),
      duration: 0,
      actions: have.map((word, i) => word === 'notes'
        ? { label: t('invite.join.openNotes', 'Open the notes'), effect: 'notes:panel', payload: { visible: true }, kind: i === 0 ? 'primary' : 'secondary' }
        : { label: t('room.asks.turnOn', `Turn on ${word}`, { word }), effect: 'command-line:remote-submit', payload: { text: word }, kind: i === 0 ? 'primary' : 'secondary' }),
    })
  }
}

const _roomAsks = new RoomAsksDrone()
window.ioc.register('@diamondcoreprocessor.com/RoomAsksDrone', _roomAsks)
