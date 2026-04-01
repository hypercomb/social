// diamondcoreprocessor.com/meeting/meeting.drone.ts

import { Drone, EffectBus } from '@hypercomb/core'
import {
  MEETING_KIND,
  meetingPeerId,
  meetingExtraTags,
  parseMeetingSignal,
  type SignalType,
  type InboundSignal,
  type JoinPayload,
  type LeavePayload,
  type OfferPayload,
  type AnswerPayload,
  type IcePayload,
} from './meeting-signaling.js'
import { MeetingPeer, type PeerCallbacks } from './meeting-peer.js'
import { MeetingSpatialAudio } from './meeting-audio.js'

// ── types ─────────────────────────────────────────────────────

type MeshEvt = { relay: string; sig: string; event: any; payload: any }
type MeshSub = { close: () => void }
type MeshApi = {
  subscribe: (sig: string, cb: (e: MeshEvt) => void) => MeshSub
  publish: (kind: number, sig: string, payload: any, extraTags?: string[][]) => Promise<boolean>
}

type MeetingRoom = {
  cell: string
  roomSig: string
  template: string
  localStream: MediaStream | null
  peers: Map<string, MeetingPeer>        // remotePeerId → peer
  slotAssignment: Map<string, number>    // remotePeerId → slot index
  nextSlot: number
  maxSlots: number
  meshSub: MeshSub | null
  audio: MeetingSpatialAudio
  active: boolean
}

type TagsChangedPayload = { updates: { cell: string; tag: string; color?: string }[] }
type TileActionPayload = { action: string; label: string; q: number; r: number; index: number }

// ── meeting icon SVG ──────────────────────────────────────────

const MEETING_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="96" height="96"><circle fill="white" cx="48" cy="32" r="10"/><circle fill="white" cx="28" cy="56" r="7"/><circle fill="white" cx="68" cy="56" r="7"/><path fill="white" d="M36 44c-2 0-4 2-4 4v16h32V48c0-2-2-4-4-4z"/><path fill="white" d="M16 64c-1 0-3 1-3 3v10h22V64z"/><path fill="white" d="M61 64v13h22V67c0-2-2-3-3-3z"/></svg>`

const MEETING_ICON_ACTIVE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="96" height="96"><circle fill="#80ff80" cx="48" cy="32" r="10"/><circle fill="#80ff80" cx="28" cy="56" r="7"/><circle fill="#80ff80" cx="68" cy="56" r="7"/><path fill="#80ff80" d="M36 44c-2 0-4 2-4 4v16h32V48c0-2-2-4-4-4z"/><path fill="#80ff80" d="M16 64c-1 0-3 1-3 3v10h22V64z"/><path fill="#80ff80" d="M61 64v13h22V67c0-2-2-3-3-3z"/></svg>`

// ── meeting keywords → template config ───────────────────────

const MEETING_TEMPLATES: Record<string, { maxSlots: number }> = {
  cascade: { maxSlots: 6 },  // 1 leader + 6 ring-1 = the Hypercomb
}

function isMeetingTag(tag: string): string | null {
  // exact match: 'cascade'
  if (MEETING_TEMPLATES[tag]) return tag
  // parameterized: 'cascade:19' → custom slot count
  const [base, param] = tag.split(':')
  if (MEETING_TEMPLATES[base]) return tag
  return null
}

function templateForTag(tag: string): { maxSlots: number; name: string } {
  const [base, param] = tag.split(':')
  const tpl = MEETING_TEMPLATES[base]
  if (!tpl) return { maxSlots: 6, name: 'cascade' }
  const maxSlots = param ? Math.max(1, parseInt(param, 10) - 1) || tpl.maxSlots : tpl.maxSlots
  return { maxSlots, name: base }
}

// ── derive room signature from cell ──────────────────────────

async function deriveRoomSig(cell: string): Promise<string> {
  const data = new TextEncoder().encode(cell + '/meeting')
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('')
}

// ── HypercombMeetingDrone ────────────────────────────────────

export class HypercombMeetingDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'meeting'

  override description = 'Enables video meetings on tiles tagged with meeting keywords (e.g. cascade).'

  protected override deps = { mesh: '@diamondcoreprocessor.com/NostrMeshDrone' }
  protected override listens = ['tags:changed', 'render:host-ready', 'tile:action']
  protected override emits = ['overlay:register-action', 'meeting:stream-ready', 'meeting:slot-assigned', 'mesh:publish', 'mesh:subscribe']

  #localPeerId = meetingPeerId()
  #rooms: Map<string, MeetingRoom> = new Map()  // cell → room
  #meetingCells: Set<string> = new Set()         // cells that have a meeting tag
  #cellTemplates: Map<string, string> = new Map() // cell → tag (e.g. 'cascade')
  #effectsRegistered = false
  #iconRegistered = false

  protected override heartbeat = async (): Promise<void> => {
    if (this.#effectsRegistered) return
    this.#effectsRegistered = true

    // 1. watch for meeting tags
    this.onEffect<TagsChangedPayload>('tags:changed', ({ updates }) => {
      for (const u of updates) {
        const mtag = isMeetingTag(u.tag)
        if (!mtag) continue
        this.#meetingCells.add(u.cell)
        this.#cellTemplates.set(u.cell, u.tag)
        // pre-subscribe to room sig so we can hear joins
        void this.#ensureRoomSubscription(u.cell, u.tag)
      }
    })

    // 2. register overlay icon once pixi is ready
    this.onEffect('render:host-ready', () => {
      if (this.#iconRegistered) return
      this.#iconRegistered = true
      this.emitEffect('overlay:register-action', [{
        name: 'meeting',
        owner: this.iocKey,
        svgMarkup: MEETING_ICON_SVG,
        x: -14,
        y: -10,
        hoverTint: 0xa8ffd8,
        profile: 'private' as const,
        visibleWhen: (ctx: { label: string }) => this.#meetingCells.has(ctx.label),
      }])
    })

    // 3. handle meeting icon click
    this.onEffect<TileActionPayload>('tile:action', (payload) => {
      if (payload.action !== 'meeting') return
      void this.#toggleMeeting(payload.label)
    })
  }

  // ── room subscription (passive, before joining) ────────────

  async #ensureRoomSubscription(cell: string, tag: string): Promise<void> {
    if (this.#rooms.has(cell)) return

    const roomSig = await deriveRoomSig(cell)
    const tpl = templateForTag(tag)

    const room: MeetingRoom = {
      cell,
      roomSig,
      template: tpl.name,
      localStream: null,
      peers: new Map(),
      slotAssignment: new Map(),
      nextSlot: 0,
      maxSlots: tpl.maxSlots,
      meshSub: null,
      audio: new MeetingSpatialAudio(),
      active: false,
    }

    this.#rooms.set(cell, room)

    // subscribe to signaling events for this room
    const mesh = this.resolve<MeshApi>('mesh')
    if (!mesh) return

    room.meshSub = mesh.subscribe(roomSig, (evt: MeshEvt) => {
      this.#onSignal(room, evt)
    })

    // ensure mesh is watching this sig on relays
    this.emitEffect('mesh:ensure-started', { signature: roomSig })
  }

  // ── toggle join/leave ──────────────────────────────────────

  async #toggleMeeting(cell: string): Promise<void> {
    const room = this.#rooms.get(cell)
    if (!room) return

    if (room.active) {
      this.#leaveRoom(room)
    } else {
      await this.#joinRoom(room)
    }
  }

  async #joinRoom(room: MeetingRoom): Promise<void> {
    try {
      room.localStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: {
          sampleRate: 48000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
    } catch (e) {
      console.warn('[HypercombMeeting] getUserMedia failed:', e)
      return
    }

    room.active = true

    // announce join
    const mesh = this.resolve<MeshApi>('mesh')
    if (mesh) {
      await mesh.publish(
        MEETING_KIND,
        room.roomSig,
        { peerId: this.#localPeerId },
        meetingExtraTags('join'),
      )
    }

    // emit local stream for rendering
    this.emitEffect('meeting:stream-ready', {
      cell: room.cell,
      slot: -1,  // -1 = leader/self (center hex)
      stream: room.localStream,
      peerId: this.#localPeerId,
    })
  }

  #leaveRoom(room: MeetingRoom): void {
    room.active = false

    // announce leave
    const mesh = this.resolve<MeshApi>('mesh')
    if (mesh) {
      void mesh.publish(
        MEETING_KIND,
        room.roomSig,
        { peerId: this.#localPeerId },
        meetingExtraTags('leave'),
      )
    }

    // close all peers
    for (const [id, peer] of room.peers) {
      peer.close()
      room.audio.removeParticipant(id)
    }
    room.peers.clear()
    room.slotAssignment.clear()
    room.nextSlot = 0

    // stop local media
    if (room.localStream) {
      for (const track of room.localStream.getTracks()) track.stop()
      room.localStream = null
    }

    room.audio.dispose()
    room.audio = new MeetingSpatialAudio()
  }

  // ── inbound signal handling ────────────────────────────────

  #onSignal(room: MeetingRoom, evt: MeshEvt): void {
    const signal = parseMeetingSignal(evt.event, room.roomSig)
    if (!signal) return

    // ignore our own events
    const payload = signal.payload as any
    if (payload.peerId === this.#localPeerId || payload.fromPeerId === this.#localPeerId) return

    // ignore targeted signals not meant for us
    if (signal.targetPeerId && signal.targetPeerId !== this.#localPeerId) return

    switch (signal.type) {
      case 'join':  this.#handleJoin(room, payload as JoinPayload); break
      case 'leave': this.#handleLeave(room, payload as LeavePayload); break
      case 'offer': this.#handleOffer(room, payload as OfferPayload); break
      case 'answer': this.#handleAnswer(room, payload as AnswerPayload); break
      case 'ice':   this.#handleIce(room, payload as IcePayload); break
    }
  }

  #handleJoin(room: MeetingRoom, payload: JoinPayload): void {
    if (!room.active || !room.localStream) return
    if (room.peers.has(payload.peerId)) return
    if (room.peers.size >= room.maxSlots) return

    // we initiate the offer to the new joiner
    void this.#createPeerAndOffer(room, payload.peerId)
  }

  #handleLeave(room: MeetingRoom, payload: LeavePayload): void {
    const peer = room.peers.get(payload.peerId)
    if (!peer) return
    peer.close()
    room.audio.removeParticipant(payload.peerId)
    room.peers.delete(payload.peerId)
    room.slotAssignment.delete(payload.peerId)
  }

  async #handleOffer(room: MeetingRoom, payload: OfferPayload): Promise<void> {
    if (!room.active || !room.localStream) return
    if (room.peers.has(payload.fromPeerId)) return
    if (room.peers.size >= room.maxSlots) return

    // create peer and send answer
    const peer = this.#createPeer(room, payload.fromPeerId)
    const answer = await peer.acceptOffer(payload.sdp)

    const mesh = this.resolve<MeshApi>('mesh')
    if (mesh) {
      await mesh.publish(
        MEETING_KIND,
        room.roomSig,
        { sdp: answer, fromPeerId: this.#localPeerId },
        meetingExtraTags('answer', payload.fromPeerId),
      )
    }
  }

  async #handleAnswer(room: MeetingRoom, payload: AnswerPayload): Promise<void> {
    const peer = room.peers.get(payload.fromPeerId)
    if (!peer) return
    await peer.acceptAnswer(payload.sdp)
  }

  async #handleIce(room: MeetingRoom, payload: IcePayload): Promise<void> {
    const peer = room.peers.get(payload.fromPeerId)
    if (!peer) return
    await peer.addIceCandidate(payload.candidate)
  }

  // ── peer creation ──────────────────────────────────────────

  #createPeer(room: MeetingRoom, remotePeerId: string): MeetingPeer {
    const slot = room.nextSlot++
    room.slotAssignment.set(remotePeerId, slot)

    const callbacks: PeerCallbacks = {
      onRemoteStream: (stream) => {
        // spatial audio
        room.audio.addParticipant(remotePeerId, slot, stream)

        // emit for rendering
        this.emitEffect('meeting:stream-ready', {
          cell: room.cell,
          slot,
          stream,
          peerId: remotePeerId,
        })

        this.emitEffect('meeting:slot-assigned', {
          cell: room.cell,
          slotIndex: slot,
          peerId: remotePeerId,
        })
      },
      onIceCandidate: (candidate) => {
        const mesh = this.resolve<MeshApi>('mesh')
        if (mesh) {
          void mesh.publish(
            MEETING_KIND,
            room.roomSig,
            { candidate, fromPeerId: this.#localPeerId },
            meetingExtraTags('ice', remotePeerId),
          )
        }
      },
      onDisconnected: () => {
        room.peers.delete(remotePeerId)
        room.audio.removeParticipant(remotePeerId)
        room.slotAssignment.delete(remotePeerId)
      },
    }

    const peer = new MeetingPeer(remotePeerId, room.localStream!, callbacks)
    room.peers.set(remotePeerId, peer)
    return peer
  }

  async #createPeerAndOffer(room: MeetingRoom, remotePeerId: string): Promise<void> {
    const peer = this.#createPeer(room, remotePeerId)
    const offer = await peer.createOffer()

    const mesh = this.resolve<MeshApi>('mesh')
    if (mesh) {
      await mesh.publish(
        MEETING_KIND,
        room.roomSig,
        { sdp: offer, fromPeerId: this.#localPeerId },
        meetingExtraTags('offer', remotePeerId),
      )
    }
  }

  // ── cleanup ────────────────────────────────────────────────

  protected override dispose = (): void => {
    for (const [, room] of this.#rooms) {
      if (room.active) this.#leaveRoom(room)
      room.meshSub?.close()
    }
    this.#rooms.clear()
  }
}

// ── IoC registration ─────────────────────────────────────────

const _meeting = new HypercombMeetingDrone()
window.ioc.register('@diamondcoreprocessor.com/HypercombMeetingDrone', _meeting)
