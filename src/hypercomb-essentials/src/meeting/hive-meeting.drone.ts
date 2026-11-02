// meeting/hive-meeting.drone.ts
//
// THE SWARM'S MEETING (jwize, 2026-11-02). One meeting per swarm: its address
// is sign('meeting \0 ' + room, secret, host) (meeting-seats.ts), so everyone
// in the swarm who types `meeting` meets here, nobody outside can, and walking
// around the hive never ends it. It is live the moment someone joins; whoever
// joins later is connected as they arrive.
//
// THE LEADER IS THE MIDDLE, AND PEOPLE FOLLOW. The leader is whoever has been
// in longest (meeting-seats.ts leaderOf); their face takes the centre hex and
// the others fill the ring by arrival. Every heartbeat carries the path its
// sender stands on; when the leader moves, a follower who allowed `go` walks
// to the same path in their own hive. Small paths, said locally.
//
// THE LEADER'S LINES COME THROUGH, AND EACH PERSON ALLOWS THEM. What the
// leader says on their own command line (`command-line:said`) is sent to the
// meeting. The room states its BEHAVIOUR REQUIREMENTS — the words it uses,
// `go` by default, `meeting rules …` to name others — and each person allows
// or disallows each one in the lobby. On their side a line whose word they
// allowed runs through the machine door (judged against their grant like any
// outside line); a word they disallowed is dropped; a word the room never
// stated waits on their `$` line for Enter or Esc. No code is sent: only
// directions, each one allowed.

import {
  Drone, EffectBus, EXTERNAL_CALL, REMOTE_SUBMIT, canonicalVerbOf, hypercomb, meetingPointKey,
  type ExternalCallRequest, type RemoteSubmitRequest,
} from '@hypercomb/core'
import { audioConstraints, bitrateOf, frameRateOf, isQuality, qualityConstraints, videoConstraints, type Quality } from './meeting-quality.js'
import { showsPicture } from './meeting-picture.js'
import { followStep, followedBy, isFollowed, leaderOf, meetingAddress, meetingPreimage, originatorOf, pathKey, seatOrder, type Member } from './meeting-seats.js'
import { isJoinedHere, ownZone, readTabZone } from '../sharing/membership.js'
import { SESSION_ID, SfuClient, sfuBase } from './sfu-client.js'

type MeshEvt = { relay: string; sig: string; event: any; payload: any }
type MeshSub = { close: () => void }
type MeshApi = {
  ensureStartedForSig: (sig: string) => void
  subscribe?: (sig: string, cb: (e: MeshEvt) => void) => MeshSub
  publish?: (kind: number, sig: string, payload: any, extraTags?: string[][]) => Promise<boolean>
  meetingRelay?: () => string
}
type LineageLike = EventTarget & { explorerSegments?: () => readonly string[] }
type NavigationLike = { goRaw?: (segments: readonly string[]) => void }

export type MeetingState = 'idle' | 'gathering' | 'active' | 'ended'

type Heard = Member & { lastSeenMs: number; rules?: readonly string[]; sfu?: { session: string; tracks: readonly string[] } }


// The SFU's own address arrives in its answer; Cloudflare's STUN helps the
// browser find its way out. The only ICE server the shell's outgoing firewall
// is to allow (documentation/meeting-lobby.md, "Video").
const RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }],
  bundlePolicy: 'max-bundle',
}
/** How often a session tells the meeting point it is still in use. */
const VIDEO_BEAT_MS = 30_000

const MEETING_KIND = 29010
const AVAILABILITY_TTL_MS = 30_000
const AVAILABILITY_PUBLISH_MS = 5_000
/** The seats the hive draws: the leader and the ring of six. */
const SEATS = 7
/** What a room asks for when its leader has named nothing: following. */
const DEFAULT_RULES: readonly string[] = ['go']
const INDICATOR = 'meeting'
/** The mark on the tile the leader stands in. A meeting belongs to no tile
 *  (jwize, 2026-11-02: "there is no relationship between a tile and a
 *  meeting"); the mark only says where its leader is right now. */
const HERE_ACTION = 'meeting-here'
const HERE_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><circle cx="12" cy="12" r="10" fill="none" stroke="white" stroke-width="2"/><path d="M8 9.5h6a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1zm7 2 2.5-1.5v4L15 12.5z" fill="white"/></svg>'

const verbOf = (text: string): string =>
  canonicalVerbOf(text) || (text.trim().split(/\s+/)[0] ?? '').toLowerCase()

const cleanRules = (raw: unknown): string[] =>
  Array.isArray(raw)
    ? [...new Set(raw.map(r => String(r ?? '').trim().toLowerCase()).filter(r => /^[a-z][a-z0-9-]*$/.test(r)))].slice(0, 32)
    : []

export class HiveMeetingDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'meeting'

  public override description =
    'The swarm\'s meeting: one per swarm, live when someone joins, the longest-present in the middle and everyone following; the leader\'s lines come through and each person allows them.'
  public override effects = ['network'] as const

  protected override deps = {
    mesh: '@diamondcoreprocessor.com/NostrMeshDrone',
  }

  protected override listens = [
    'meeting:toggle-camera', 'meeting:toggle-available', 'meeting:join', 'meeting:leave',
    'meeting:rules-set', 'meeting:start', 'meeting:copy-link', 'meeting:lead', 'meeting:follow', 'command-line:said', 'indicator:activate', 'indicator:dismiss', 'indicator:query',
    'mesh:public-changed', 'mesh:zone', 'mesh:room', 'mesh:secret',
    'render:host-ready', 'overlay:request-register', 'tile:action',
  ]
  protected override emits = [
    'meeting:state', 'meeting:streams', 'meeting:local-camera', 'meeting:presence', 'meeting:spend',
    'indicator:set', 'indicator:clear', 'activity:log', 'toast:show', 'mesh:open-modal', 'overlay:register-action',
    EXTERNAL_CALL, REMOTE_SUBMIT,
  ]

  /** The picture the lobby chose; the camera and every sender follow it. */
  #quality: Quality = 'auto'

  #state: MeetingState = 'idle'
  #preimage = ''
  #currentSig = ''
  #meshSub: MeshSub | null = null

  // own identity and place in the meeting
  #publisherId = ''
  #localAvailable = false
  #since = 0
  #lastAvailPublishMs = 0
  /** The words this person allowed in the lobby. */
  #allowed = new Set<string>(DEFAULT_RULES)
  /** The room's requirements, as this person states them if they lead. */
  #ownRules: string[] = [...DEFAULT_RULES]
  /** Whom this person handed the lead to — counts only while they are the
   *  originator. '' keeps it. */
  #lead = ''
  /** Whom this person chose to follow; '' follows the leader. */
  #following = ''
  #lastTargetId = ''

  // who else is in, and following them
  #heard = new Map<string, Heard>()
  #lastLeaderPath: string | null = null
  #lastLineSeq = new Map<string, number>()
  #lineSeq = 0
  #lastPresence = ''

  // the video (Cloudflare's SFU)
  #sfu: SfuClient | null = null
  #pc: RTCPeerConnection | null = null
  #videoStarting = false
  #videoSaid = false
  #videoBeat: ReturnType<typeof setInterval> | null = null
  /** What this person publishes: mid and track name. */
  #published: { mid: string; trackName: string }[] = []
  /** Whom this person receives, and the mids that carry them. */
  #subscribed = new Map<string, string[]>()
  #midOwner = new Map<string, string>()
  #remoteStreams = new Map<string, MediaStream>()
  #localStream: MediaStream | null = null
  #cameraOn = false

  #effectsRegistered = false
  /** The meeting's own beat while its room is heard. Its messages are
   *  ephemeral — a relay keeps none — so a heartbeat waiting on the hive's
   *  pulse was lost whenever nobody was listening at that moment, and two
   *  people in one meeting never saw each other. */
  #beat: ReturnType<typeof setInterval> | null = null

  protected override sense = (): boolean => true

  protected override heartbeat = async (): Promise<void> => {
    this.#ensureEffects()
    this.#ensureIdentity()
    await this.#syncRoom()
    this.#pruneExpired()
    this.#publishAvailability()
    this.#announcePresence()
  }

  // ─── who is here, for the lobby and the command line ─────────

  #members = (): Member[] => {
    const all: Member[] = [...this.#heard.values()]
    if (this.#localAvailable) all.push({ id: this.#publisherId, since: this.#since, path: this.#here(), lead: this.#lead, follows: this.#following })
    return all
  }

  #leader = (): Heard | Member | undefined => leaderOf(this.#members())

  /** Whom this person follows: the one they chose, else the leader. */
  #target = (): Member | undefined => followedBy(this.#publisherId, this.#members(), this.#following)

  /** The requirements this person meets: those of whom they follow, or their
   *  own while they follow nobody. */
  #rules = (): readonly string[] => {
    const target = this.#target()
    if (!target) return this.#ownRules
    return (this.#heard.get(target.id)?.rules) ?? DEFAULT_RULES
  }

  /** The seat a person names: 1 is the middle. */
  #seatId = (who: string): string => {
    const seats = seatOrder(this.#members())
    const n = Number(who)
    return Number.isInteger(n) && n >= 1 && n <= seats.length ? seats[n - 1]!.id : ''
  }

  #announcePresence = (): void => {
    const members = this.#members()
    const leader = leaderOf(members)
    const presence = {
      swarm: !!this.#currentSig,
      here: members.length,
      needed: SEATS,
      joined: this.#localAvailable,
      leader: leader?.id ?? '',
      leaderIsYou: !!leader && leader.id === this.#publisherId,
      rules: [...this.#rules()],
      allowed: [...this.#allowed],
      seats: seatOrder(members).map((m, i) => ({
        seat: i + 1, id: m.id, you: m.id === this.#publisherId,
        leads: m.id === leader?.id, originator: m.id === originatorOf(members)?.id,
      })),
      following: this.#target()?.id ?? '',
    }
    this.#refreshMark()
    const key = JSON.stringify(presence)
    if (key === this.#lastPresence) return
    this.#lastPresence = key
    this.emitEffect('meeting:presence', presence)
    this.#paintIndicator(presence)
  }

  /** The meeting on the command line: in it, or live in the swarm while you
   *  are not. Nothing when there is no meeting. */
  #paintIndicator = (p: {
    here: number; joined: boolean; leaderIsYou: boolean; rules: readonly string[]
    seats: readonly { seat: number; id: string; you: boolean; leads: boolean; originator: boolean }[]; following: string
  }): void => {
    if (!this.#currentSig || (!p.joined && p.here === 0)) {
      EffectBus.emit('indicator:clear', { key: INDICATOR })
      return
    }
    const leadLine = p.leaderIsYou ? 'you lead: people follow where you go' : 'you follow the leader'
    const rules = p.rules.map(r => `${r} ${this.#allowed.has(r) ? '✓' : '✗'}`).join(' · ')
    EffectBus.emit('indicator:set', {
      key: INDICATOR,
      icon: 'videocam',
      label: p.joined ? `meeting · ${p.here}` : `meeting live · ${p.here}`,
      items: p.joined
        ? [
            { text: leadLine },
            ...p.seats.map(s => ({
              text: `${s.seat} · ${s.you ? 'you' : s.id.slice(0, 6)}${s.leads ? ' · leads' : ''}${s.originator && !s.leads ? ' · started it' : ''}${s.id === p.following ? ' · you follow' : ''}`,
            })),
            { text: rules || 'no behaviours', detail: 'what this room asks of you' },
            { text: 'meeting follow <seat> · meeting lead <seat>', detail: 'click: copy the link · ×: leave' },
          ]
        : [{ text: `${p.here} in the meeting` }, { text: 'click to join' }],
      actionable: true,
      dismissable: p.joined,
    })
  }

  // ─── effect subscriptions ────────────────────────────────────

  #ensureEffects = (): void => {
    if (this.#effectsRegistered) return
    this.#effectsRegistered = true

    const resync = (): void => { void this.#syncRoom() }
    this.onEffect('mesh:public-changed', resync)
    this.onEffect('mesh:zone', resync)
    this.onEffect('mesh:room', resync)
    this.onEffect('mesh:secret', resync)

    const join = (stream: unknown): void => {
      if (this.#localAvailable) return
      this.#localAvailable = true
      this.#since = Date.now()
      this.#lastLeaderPath = null
      // VIDEO IS OFF BY DEFAULT (jwize, 2026-11-02): a person joins sending
      // their voice only. Their camera runs for THEM — "even off you need to
      // see your video on your screen so you can see it works" — and reaches
      // the others only when they turn it on.
      if (stream instanceof MediaStream) this.#acceptStream(stream)
      else void this.#joinWithDevices()
      this.#setState('active')
      this.#lastAvailPublishMs = 0
      this.#publishAvailability()
      this.#announcePresence()
    }
    const leave = (): void => {
      if (!this.#localAvailable) return
      this.#localAvailable = false
      this.#endMeeting()
      this.#setState('ended')
      this.#setState('idle')
      this.#announcePresence()
    }

    this.onEffect('meeting:toggle-available', payload => {
      if (this.#localAvailable) leave()
      else join((payload as { stream?: unknown } | undefined)?.stream)
    })
    this.onEffect('meeting:toggle-camera', () => {
      if (this.#localAvailable) void this.#toggleCamera()
    })

    // The lobby's way in and out, idempotent.
    this.onEffect<{ stream?: unknown; quality?: unknown; allowed?: unknown }>('meeting:join', payload => {
      if (isQuality(payload?.quality)) this.#quality = payload.quality
      if (Array.isArray(payload?.allowed)) this.#allowed = new Set(cleanRules(payload.allowed))
      join(payload?.stream)
    })
    this.onEffect('meeting:leave', leave)

    // `meeting`: start it, or join it — and the way to bring someone in.
    // Not in a swarm, there is nowhere to meet yet: the toast's button opens
    // the swarm selector, one click from connected.
    this.onEffect('meeting:start', () => { void this.#start(join) })
    this.onEffect('meeting:copy-link', () => { this.#copyLink() })

    // `meeting lead <seat>` / `meeting lead me`: the originator hands the
    // lead over, or takes it back. Anyone else is told only they can.
    this.onEffect<{ who?: string }>('meeting:lead', ({ who }) => {
      const members = this.#members()
      if (originatorOf(members)?.id !== this.#publisherId) {
        EffectBus.emit('activity:log', { message: 'meeting: only whoever started the meeting can hand the lead over', icon: '✗' })
        return
      }
      const id = who === 'me' ? '' : this.#seatId(String(who ?? ''))
      if (who !== 'me' && !id) { EffectBus.emit('activity:log', { message: `meeting: no one sits in seat ${who}`, icon: '✗' }); return }
      this.#lead = id === this.#publisherId ? '' : id
      this.#lastAvailPublishMs = 0
      this.#publishAvailability()
      this.#announcePresence()
      this.#emitStreams()
    })
    // `meeting follow <seat>` / `meeting follow leader`.
    this.onEffect<{ who?: string }>('meeting:follow', ({ who }) => {
      const id = who === 'leader' ? '' : this.#seatId(String(who ?? ''))
      if (who !== 'leader' && !id) { EffectBus.emit('activity:log', { message: `meeting: no one sits in seat ${who}`, icon: '✗' }); return }
      this.#following = id === this.#publisherId ? '' : id
      this.#lastAvailPublishMs = 0
      this.#publishAvailability()
      this.#follow()
      this.#announcePresence()
    })

    // `meeting rules go create trait`: what this room asks, when you lead it.
    this.onEffect<{ rules?: unknown }>('meeting:rules-set', payload => {
      const rules = cleanRules(payload?.rules)
      this.#ownRules = rules.length ? rules : [...DEFAULT_RULES]
      for (const rule of this.#ownRules) this.#allowed.add(rule)
      this.#lastAvailPublishMs = 0
      this.#publishAvailability()
      this.#announcePresence()
    })

    // The leader's own lines, from their own Enter.
    this.onEffect<{ text?: unknown }>('command-line:said', payload => {
      const text = typeof payload?.text === 'string' ? payload.text.trim() : ''
      if (text) this.#relay(text)
    })

    // Walking: the leader says where they are as soon as they move.
    const lineage = window.ioc?.get<LineageLike>('@hypercomb.social/Lineage')
    lineage?.addEventListener?.('change', () => {
      if (!this.#localAvailable) return
      this.#lastAvailPublishMs = 0
      this.#publishAvailability()
    })

    // THE MARK ON THE LEADER'S TILE: seen by everyone in the swarm who is not
    // the leader, on the tile the leader stands in, at the level that holds
    // it. A press joins (and walks in), or, already in, walks back to them.
    this.onEffect('render:host-ready', () => this.#registerHere())
    this.onEffect('overlay:request-register', () => this.#registerHere())
    this.onEffect<{ action?: string; label?: string }>('tile:action', payload => {
      if (payload?.action !== HERE_ACTION) return
      if (!this.#localAvailable) { void this.#start(join); return }
      const leader = this.#leader()
      if (leader?.path) window.ioc?.get<NavigationLike>('@hypercomb.social/Navigation')?.goRaw?.(leader.path)
    })

    // The command line's meeting chip: in it, copy the link; not yet, join.
    this.onEffect<{ key?: string }>('indicator:activate', ({ key }) => {
      if (key !== INDICATOR) return
      if (this.#localAvailable) this.#copyLink()
      else void this.#start(join)
    })
    this.onEffect<{ key?: string }>('indicator:dismiss', ({ key }) => { if (key === INDICATOR) leave() })
    this.onEffect('indicator:query', () => { this.#lastPresence = ''; this.#announcePresence() })

    // bridge: window custom events from the Angular controls bar
    window.addEventListener('meeting:toggle-available', ((e: CustomEvent) => {
      if (this.#localAvailable) leave()
      else join(e.detail?.stream)
    }) as EventListener)
    window.addEventListener('meeting:toggle-camera', () => {
      if (this.#localAvailable) void this.#toggleCamera()
    })
  }

  /** The leader's tile, as seen from where this person stands: its name when
   *  the leader is one level below here, else ''. */
  #leaderTileHere = (): string => {
    const leader = this.#leader()
    if (!leader?.path?.length || leader.id === this.#publisherId) return ''
    const parent = pathKey(leader.path.slice(0, -1))
    return parent === pathKey(this.#here()) ? String(leader.path[leader.path.length - 1]) : ''
  }

  #registerHere = (): void => {
    const visibleWhen = (ctx: { label: string }): boolean => !!this.#currentSig && ctx.label === this.#leaderTileHere()
    this.emitEffect('overlay:register-action', (['private', 'public-own', 'public-external'] as const).map(profile => ({
      name: HERE_ACTION,
      owner: this.iocKey,
      svgMarkup: HERE_ICON_SVG,
      x: 10,
      y: -10,
      hoverTint: 0xa8ffd8,
      profile,
      visibleWhen,
    })))
  }

  /** Redraw the tiles when where the leader stands has changed, so the mark
   *  moves with them. The processor is the only one that redraws. */
  #lastLeaderTile = ''
  #refreshMark = (): void => {
    const key = `${pathKey(this.#here())}|${this.#leaderTileHere()}`
    if (key === this.#lastLeaderTile) return
    this.#lastLeaderTile = key
    void new hypercomb().act()
  }

  #copyLink = (): void => {
    const invite = window.ioc?.get<{ meetingLink?: () => Promise<void> }>('@diamondcoreprocessor.com/InviteQueenBee')
    void invite?.meetingLink?.()
  }

  #start = async (join: (stream: unknown) => void): Promise<void> => {
    await this.#syncRoom()
    if (!this.#currentSig) {
      EffectBus.emit('toast:show', {
        type: 'info', duration: 0, title: 'meeting',
        message: 'You are not in a swarm yet, so there is nowhere to meet. Start one, then type meeting again.',
        actionLabel: 'start a swarm', actionEffect: 'mesh:open-modal', actionPayload: { join: true },
      })
      return
    }
    const others = this.#heard.size
    join(undefined)
    // Walk to the leader at once rather than at the next beat.
    this.#lastLeaderPath = null
    this.#follow()
    EffectBus.emit('activity:log', {
      message: others
        ? `meeting: you joined ${others} ${others === 1 ? 'person' : 'people'}; you follow the leader`
        : 'meeting: started; you lead, and whoever joins follows where you go',
      icon: '🐝',
    })
    // The link, straight away: copied (or shared) where the device allows,
    // else shown to copy — the invite's own delivery.
    this.#copyLink()
  }

  #ensureIdentity = (): void => {
    if (this.#publisherId) return
    try { this.#publisherId = localStorage.getItem('hc:show-honeycomb:publisher-id') ?? '' } catch { /* ignore */ }
    // A tab that has not yet been given one still meets: an id for this page.
    if (!this.#publisherId) this.#publisherId = crypto.randomUUID().replace(/-/g, '')
  }

  #here = (): string[] => {
    const lineage = window.ioc?.get<LineageLike>('@hypercomb.social/Lineage')
    return (lineage?.explorerSegments?.() ?? []).map(String).filter(Boolean)
  }

  // ─── the room ────────────────────────────────────────────────

  /** Follow the swarm: the meeting's address is the swarm's, or nothing when
   *  this tab is in no swarm. A change of swarm ends what was here. */
  #syncRoom = async (): Promise<void> => {
    const zone = isJoinedHere() ? ownZone() : null
    let host = ''
    try { host = meetingPointKey(this.resolve<MeshApi>('mesh')?.meetingRelay?.() ?? '') } catch { host = '' }
    const preimage = zone ? meetingPreimage(zone.room, zone.secret, host) : ''
    if (preimage === this.#preimage) return
    this.#preimage = preimage
    const sig = await meetingAddress(preimage)
    if (preimage !== this.#preimage) return // moved again while signing
    this.#switchSig(sig)
  }

  #switchSig = (sig: string): void => {
    if (this.#meshSub) {
      try { this.#meshSub.close() } catch { /* ignore */ }
      this.#meshSub = null
    }
    if (this.#localAvailable) {
      this.#localAvailable = false
      this.#endMeeting()
      this.#setState('ended')
      this.#setState('idle')
    }
    this.#heard.clear()
    this.#lastLineSeq.clear()
    this.#currentSig = sig
    this.#lastPresence = ''
    this.#announcePresence()
    if (this.#beat) { clearInterval(this.#beat); this.#beat = null }
    if (!sig) return
    this.#beat = setInterval(() => {
      this.#pruneExpired()
      this.#publishAvailability()
      this.#follow()
      this.#announcePresence()
    }, AVAILABILITY_PUBLISH_MS)

    const mesh = this.resolve<MeshApi>('mesh')
    if (!mesh || typeof mesh.subscribe !== 'function') return
    try { mesh.ensureStartedForSig(sig) } catch { /* the mesh starts on its own */ }
    this.#meshSub = mesh.subscribe(sig, evt => this.#onMeshEvent(evt))
  }

  #onMeshEvent = (evt: MeshEvt): void => {
    const p = evt.payload
    if (!p || typeof p.type !== 'string') return
    switch (p.type) {
      case 'meeting-availability': this.#handleAvailability(p); break
      case 'meeting-line': this.#handleLine(p); break
    }
  }

  // ─── availability, leading and following ─────────────────────

  #handleAvailability = (p: any): void => {
    const id = typeof p.publisherId === 'string' ? p.publisherId : ''
    if (!id || id === this.#publisherId) return
    const isNew = !this.#heard.has(id)
    const sfuSession = typeof p.sfu?.session === 'string' && SESSION_ID.test(p.sfu.session) ? p.sfu.session : ''
    const sfuTracks = Array.isArray(p.sfu?.tracks)
      ? p.sfu.tracks.map((t: unknown) => String(t ?? '')).filter((t: string) => /^[A-Za-z0-9_.:-]{1,96}$/.test(t)).slice(0, 4)
      : []
    const sfu = sfuSession && sfuTracks.length ? { session: sfuSession, tracks: sfuTracks } : undefined
    const since = Number(p.since)
    const path = Array.isArray(p.path) ? p.path.map((s: unknown) => String(s ?? '')).filter(Boolean).slice(0, 64) : undefined
    this.#heard.set(id, {
      id,
      since: Number.isFinite(since) && since > 0 ? since : Date.now(),
      ...(path ? { path } : {}),
      rules: cleanRules(p.rules),
      ...(sfu ? { sfu } : {}),
      lead: typeof p.lead === 'string' ? p.lead : '',
      follows: typeof p.follows === 'string' ? p.follows : '',
      lastSeenMs: Date.now(),
    })
    if (this.#localAvailable && sfu) void this.#subscribeTo(id)
    // Someone new: say who we are at once, rather than at our next beat.
    if (isNew && this.#localAvailable) { this.#lastAvailPublishMs = 0; this.#publishAvailability() }
    this.#follow()
    this.#announcePresence()
    this.#emitStreams()
  }

  /** When the leader has moved, walk where they went — only for someone who
   *  allowed `go`, and in their own hive. */
  #follow = (): void => {
    if (!this.#localAvailable) return
    const target = this.#target()
    // A new person to follow is walked to at once.
    if ((target?.id ?? '') !== this.#lastTargetId) { this.#lastTargetId = target?.id ?? ''; this.#lastLeaderPath = null }
    const step = followStep({ selfId: this.#publisherId, leader: target, lastLeaderPath: this.#lastLeaderPath, here: this.#here() })
    if (target) this.#lastLeaderPath = pathKey(target.path)
    if (!step || !this.#allowed.has('go')) return
    window.ioc?.get<NavigationLike>('@hypercomb.social/Navigation')?.goRaw?.(step)
  }

  #publishAvailability = (): void => {
    if (!this.#localAvailable || !this.#currentSig || !this.#publisherId) return
    const now = Date.now()
    if (now - this.#lastAvailPublishMs < AVAILABILITY_PUBLISH_MS) return
    this.#lastAvailPublishMs = now
    const mesh = this.resolve<MeshApi>('mesh')
    if (!mesh || typeof mesh.publish !== 'function') return
    void mesh.publish(MEETING_KIND, this.#currentSig, {
      type: 'meeting-availability',
      publisherId: this.#publisherId,
      since: this.#since,
      path: this.#here(),
      rules: this.#ownRules,
      lead: this.#lead,
      follows: this.#following,
      ...(this.#sfu && this.#published.length ? { sfu: { session: this.#sfu.sessionId, tracks: this.#published.map(t => t.trackName) } } : {}),
      ts: now,
    }, [
      ['publisher', this.#publisherId],
      ['mode', 'meeting-availability'],
    ])
  }

  #pruneExpired = (): void => {
    const now = Date.now()
    for (const [id, entry] of this.#heard) {
      if (now - entry.lastSeenMs > AVAILABILITY_TTL_MS) {
        this.#heard.delete(id)
        this.#dropMember(id)
      }
    }
  }

  // ─── the leader's lines ──────────────────────────────────────

  /** Send a line the leader said to the meeting. `go` travels as the path
   *  in the heartbeat, and `meeting` lines are the leader's own business. */
  #relay = (text: string): void => {
    if (!this.#localAvailable || !this.#currentSig) return
    // Sent only when someone follows this person: typing in a meeting is
    // not broadcast to people who are not following you.
    if (!isFollowed(this.#publisherId, this.#members())) return
    const verb = verbOf(text)
    if (!verb || verb === 'go' || verb === 'meeting') return
    const mesh = this.resolve<MeshApi>('mesh')
    if (!mesh || typeof mesh.publish !== 'function') return
    void mesh.publish(MEETING_KIND, this.#currentSig, {
      type: 'meeting-line',
      publisherId: this.#publisherId,
      seq: ++this.#lineSeq,
      text: text.slice(0, 4000),
    }, [
      ['publisher', this.#publisherId],
      ['mode', 'meeting-line'],
    ])
  }

  /** A line from the leader: allowed runs, disallowed is dropped, a word the
   *  room never stated waits on the `$` line. */
  #handleLine = (p: any): void => {
    if (!this.#localAvailable) return
    const from = typeof p.publisherId === 'string' ? p.publisherId : ''
    const text = typeof p.text === 'string' ? p.text.trim() : ''
    const seq = Number(p.seq)
    const target = this.#target()
    if (!text || !from || !target || from !== target.id || from === this.#publisherId) return
    if (Number.isFinite(seq)) {
      if (seq <= (this.#lastLineSeq.get(from) ?? 0)) return
      this.#lastLineSeq.set(from, seq)
    }
    const verb = verbOf(text)
    const rules = this.#rules()
    if (this.#allowed.has(verb) && rules.includes(verb)) {
      EffectBus.emitTransient<RemoteSubmitRequest>(REMOTE_SUBMIT, { text })
      return
    }
    if (rules.includes(verb)) {
      EffectBus.emit('activity:log', { message: `meeting: the leader said "${text}" — you did not allow ${verb}, so it did not run`, icon: '✗' })
      return
    }
    const leads = this.#leader()?.id === from
    EffectBus.emitTransient<ExternalCallRequest>(EXTERNAL_CALL, { from: leads ? 'the meeting\'s leader' : 'whom you follow', lines: [text] })
  }

  #setState = (next: MeetingState): void => {
    if (this.#state === next) return
    this.#state = next
    this.emitEffect('meeting:state', { state: next, threshold: 1 })
    window.dispatchEvent(new CustomEvent('meeting:state', { detail: { state: next, threshold: 1 } }))
  }

  // ─── the video, through Cloudflare's SFU (sfu-client.ts) ─────────────
  //
  // One peer connection per person, to the SFU at the meeting point: publish
  // your camera and microphone once, subscribe to everyone else's. Nobody
  // connects to anybody else, so nobody learns another person's address.
  // Video that cannot start (not set up, the month's budget used, a firewall)
  // is said once; the meeting goes on without it.

  async #startVideo(): Promise<void> {
    if (this.#pc || this.#videoStarting || !this.#localAvailable || !this.#localStream || !this.#currentSig) return
    this.#videoStarting = true
    try {
      let relay = ''
      try { relay = this.resolve<MeshApi>('mesh')?.meetingRelay?.() ?? '' } catch { relay = '' }
      const base = sfuBase(relay)
      if (!base) throw new Error('this swarm meets at no address video can reach')
      const client = new SfuClient({ base, meeting: this.#currentSig, access: readTabZone()?.code ?? '' })
      await client.open()
      const pc = new RTCPeerConnection(RTC_CONFIG)
      pc.ontrack = (e: RTCTrackEvent) => {
        const owner = this.#midOwner.get(e.transceiver?.mid ?? '')
        if (!owner) return
        let stream = this.#remoteStreams.get(owner)
        if (!stream) { stream = new MediaStream(); this.#remoteStreams.set(owner, stream) }
        stream.addTrack(e.track)
        this.#emitStreams()
      }
      const local: { mid: string; trackName: string }[] = []
      const transceivers: RTCRtpTransceiver[] = []
      for (const track of this.#localStream.getAudioTracks()) {
        transceivers.push(pc.addTransceiver(track, { direction: 'sendonly', streams: [this.#localStream] }))
      }
      // The camera's slot is published whether it is shared or not, so
      // sharing later is a track swapped into a sender, never a
      // renegotiation. Not shared, the slot carries no frames — the local
      // preview runs all the same.
      const camera = this.#localStream.getVideoTracks()[0]
      transceivers.push(camera && this.#cameraOn
        ? pc.addTransceiver(camera, { direction: 'sendonly', streams: [this.#localStream] })
        : pc.addTransceiver('video', { direction: 'sendonly', streams: [this.#localStream] }))
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      for (const t of transceivers) {
        const kind = t.sender.track?.kind ?? t.receiver.track.kind
        if (t.mid) local.push({ mid: t.mid, trackName: `${this.#publisherId}-${kind}` })
      }
      const answer = await client.publish(offer.sdp ?? '', local)
      await pc.setRemoteDescription({ type: 'answer', sdp: answer })
      if (!this.#localAvailable) { pc.close(); return } // left while it started
      this.#sfu = client
      this.#pc = pc
      this.#published = local
      // Shared while this was starting: the camera goes into its slot now.
      if (this.#cameraOn) {
        const camera = this.#localStream?.getVideoTracks().find(t => t.readyState === 'live')
        const mid = local.find(p => p.trackName.endsWith('-video'))?.mid
        const sender = mid ? pc.getTransceivers().find(t => t.mid === mid)?.sender : undefined
        if (camera && sender && !sender.track) await sender.replaceTrack(camera).catch(() => { /* ignore */ })
      }
      this.#tuneSenders()
      this.#videoBeat = setInterval(() => {
        void this.#sfu?.beat().catch(() => { /* the next beat tries again */ })
        void this.#pollSpend()
      }, VIDEO_BEAT_MS)
      void this.#pollSpend()
      this.#lastAvailPublishMs = 0
      this.#publishAvailability()
      for (const id of this.#heard.keys()) void this.#subscribeTo(id)
    } catch (error) {
      if (!this.#videoSaid) {
        this.#videoSaid = true
        EffectBus.emit('activity:log', {
          message: `meeting: no video between people — ${String((error as Error)?.message ?? error)}. The meeting goes on without it.`,
          icon: '📷',
        })
      }
    } finally {
      this.#videoStarting = false
    }
  }

  /** What the meeting's video has cost, for everyone in it: the meeting point
   *  keeps one ledger, so every client reads the same figures. Each session is
   *  charged what it was sent, so a person's share is read off the session
   *  they published under; a session whose person has left is "left". */
  async #pollSpend(): Promise<void> {
    const client = this.#sfu
    if (!client) return
    try {
      const spend = await client.spend()
      if (this.#sfu !== client) return // left while it was asked
      const byMember: Record<string, number> = {}
      let named = 0
      const credit = (id: string, session: string): void => {
        const gb = spend.meeting.sessions[session]
        if (gb === undefined) return
        byMember[id] = gb
        named += gb
      }
      credit(this.#publisherId, client.sessionId)
      for (const [id, member] of this.#heard) if (member.sfu) credit(id, member.sfu.session)
      this.emitEffect('meeting:spend', {
        month: spend.month, monthGb: spend.gb, capGb: spend.capGb,
        meetingGb: spend.meeting.gb, byMember, leftGb: Math.max(0, spend.meeting.gb - named),
      })
    } catch { /* the next beat asks again */ }
  }

  /** Subscribe to one person's published tracks, once. */
  async #subscribeTo(id: string): Promise<void> {
    const member = this.#heard.get(id)
    const client = this.#sfu
    const pc = this.#pc
    if (!client || !pc || !member?.sfu || this.#subscribed.has(id)) return
    this.#subscribed.set(id, [])
    try {
      const answer = await client.subscribe(member.sfu.session, member.sfu.tracks)
      const mids: string[] = []
      for (const t of answer.tracks) {
        if (t.error || !t.mid) continue
        this.#midOwner.set(String(t.mid), id)
        mids.push(String(t.mid))
      }
      this.#subscribed.set(id, mids)
      if (answer.offer) {
        await pc.setRemoteDescription({ type: 'offer', sdp: answer.offer })
        const local = await pc.createAnswer()
        await pc.setLocalDescription(local)
        await client.renegotiate(local.sdp ?? '')
      }
    } catch {
      this.#subscribed.delete(id) // the next heartbeat tries again
    }
  }

  /** Someone left: stop receiving them. */
  #dropMember(id: string): void {
    const mids = this.#subscribed.get(id) ?? []
    this.#subscribed.delete(id)
    for (const mid of mids) this.#midOwner.delete(mid)
    if (mids.length) void this.#sfu?.close(mids).catch(() => { /* gone already */ })
    if (this.#remoteStreams.delete(id)) this.#emitStreams()
  }

  #endMeeting = (): void => {
    if (this.#videoBeat) { clearInterval(this.#videoBeat); this.#videoBeat = null }
    const mids = [...this.#published.map(t => t.mid), ...[...this.#subscribed.values()].flat()]
    if (this.#sfu && mids.length) void this.#sfu.close(mids).catch(() => { /* the session expires anyway */ })
    try { this.#pc?.close() } catch { /* ignore */ }
    this.#pc = null
    this.#sfu = null
    this.#published = []
    this.#subscribed.clear()
    this.#midOwner.clear()
    this.#remoteStreams.clear()

    // stop local media
    if (this.#localStream) {
      for (const track of this.#localStream.getTracks()) track.stop()
      this.#localStream = null
    }
    this.#cameraOn = false

    this.emitEffect('meeting:streams', { streams: new Map<string, MediaStream>() })
    this.emitEffect('meeting:spend', null)
    this.emitEffect('meeting:local-camera', { on: false })
    window.dispatchEvent(new CustomEvent('meeting:local-camera', { detail: { on: false } }))
  }

  /** The picture the lobby chose, on the one sender that carries it. */
  #tuneSenders = (): void => {
    const pc = this.#pc
    if (!pc) return
    const maxBitrate = bitrateOf(this.#quality, 1)
    const maxFramerate = frameRateOf(this.#quality)
    for (const sender of pc.getSenders()) {
      if (sender.track?.kind !== 'video') continue
      const params = sender.getParameters()
      if (!params.encodings?.length) continue
      params.encodings[0]!.maxBitrate = maxBitrate
      params.encodings[0]!.maxFramerate = maxFramerate
      sender.setParameters(params).catch(() => { /* best effort */ })
    }
  }

  // ─── camera ──────────────────────────────────────────────────

  /** Accept a pre-acquired MediaStream (from the lobby's user gesture, or
   *  asked for at join). Its camera stays on as YOUR preview; what the others
   *  get is the voice until the camera is shared. */
  #acceptStream = (stream: MediaStream): void => {
    if (this.#localStream && this.#localStream !== stream) {
      for (const track of this.#localStream.getTracks()) track.stop()
    }
    this.#localStream = stream
    this.#cameraOn = false
    const video = videoConstraints(this.#quality)
    for (const track of stream.getVideoTracks()) void track.applyConstraints(video).catch(() => { /* keep what it has */ })
    this.emitEffect('meeting:local-camera', { on: false })
    window.dispatchEvent(new CustomEvent('meeting:local-camera', { detail: { on: false } }))
    this.#emitStreams()
    void this.#startVideo()
  }

  /** Joining without the lobby: camera and microphone, for the preview and
   *  the voice. Without a camera, the microphone; without either, nothing —
   *  you still hear and see the others. */
  #joinWithDevices = async (): Promise<void> => {
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia(qualityConstraints(this.#quality))
    } catch {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints() })
      } catch {
        stream = new MediaStream()
      }
    }
    if (!this.#localAvailable) { for (const track of stream.getTracks()) track.stop(); return }
    this.#acceptStream(stream)
  }

  /** Share the camera, or stop sharing it. Off, the video sender sends
   *  nothing but the camera keeps running for your own preview. On, the
   *  camera's track goes into the sender — no renegotiation, the SFU keeps
   *  the same track. */
  #toggleCamera = async (): Promise<void> => {
    // The video sender by the mid it was published under: not shared, its
    // track is null, so asking the track's kind would find nothing — or the
    // microphone's sender.
    const videoMid = this.#published.find(p => p.trackName.endsWith('-video'))?.mid
    const videoSender = videoMid ? this.#pc?.getTransceivers().find(t => t.mid === videoMid)?.sender : undefined
    const say = (): void => {
      this.emitEffect('meeting:local-camera', { on: this.#cameraOn })
      window.dispatchEvent(new CustomEvent('meeting:local-camera', { detail: { on: this.#cameraOn } }))
      this.#emitStreams()
    }
    if (!this.#localStream) return say() // still joining: the devices are being asked for
    if (this.#cameraOn) {
      if (videoSender) await videoSender.replaceTrack(null).catch(() => { /* ignore */ })
      this.#cameraOn = false
      return say()
    }
    let track = this.#localStream.getVideoTracks().find(t => t.readyState === 'live')
    if (!track) {
      try {
        const fresh = await navigator.mediaDevices.getUserMedia({ video: videoConstraints(this.#quality) })
        track = fresh.getVideoTracks()[0]
      } catch (e) {
        console.warn('[hive-meeting] camera access denied:', e)
        return say()
      }
      if (!track) return say()
      for (const old of this.#localStream.getVideoTracks()) this.#localStream.removeTrack(old)
      this.#localStream.addTrack(track)
    }
    if (videoSender) await videoSender.replaceTrack(track).catch(() => { /* ignore */ })
    this.#cameraOn = true
    this.#tuneSenders()
    say()
  }

  /** Every face in seat order: the leader first — the centre hex — then by
   *  arrival. */
  #emitStreams = (): void => {
    const byId = new Map<string, MediaStream>(this.#remoteStreams)
    // Your own face shows on YOUR screen whether it is shared or not.
    if (this.#localStream && showsPicture(this.#localStream)) byId.set(this.#publisherId, this.#localStream)
    const streams = new Map<string, MediaStream>()
    for (const member of seatOrder(this.#members())) {
      const stream = byId.get(member.id)
      if (stream) { streams.set(member.id, stream); byId.delete(member.id) }
    }
    for (const [id, stream] of byId) streams.set(id, stream)
    this.emitEffect('meeting:streams', { streams })
  }

  // ─── public read-only accessors (for IoC consumers) ─────────

  public get meetingState(): MeetingState { return this.#state }
  public get localAvailable(): boolean { return this.#localAvailable }
  public get cameraOn(): boolean { return this.#cameraOn }
  public get peerCount(): number { return this.#remoteStreams.size }
  public get meetingSig(): string { return this.#currentSig }

  // ─── cleanup ─────────────────────────────────────────────────

  protected override dispose = (): void => {
    if (this.#beat) { clearInterval(this.#beat); this.#beat = null }
    this.#endMeeting()
    if (this.#meshSub) {
      try { this.#meshSub.close() } catch { /* ignore */ }
    }
  }
}

const _hiveMeeting = new HiveMeetingDrone()
window.ioc.register('@diamondcoreprocessor.com/HiveMeetingDrone', _hiveMeeting)
