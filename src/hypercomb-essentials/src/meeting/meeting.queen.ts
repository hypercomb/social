// meeting/meeting.queen.ts

import { QueenBee, EffectBus } from '@hypercomb/core'

/**
 * `meeting` — the swarm's meeting (hive-meeting.drone.ts, meeting-lobby.md).
 *
 *   meeting                   start it (or join it), camera OFF, and a
 *                             toast with the link to copy
 *   meeting camera            turn your camera on, or off again
 *   meeting lobby             check your camera and the room's rules first
 *   meeting leave             leave it
 *   meeting lead 2            hand the lead to seat 2 (whoever started it)
 *   meeting lead me           take it back
 *   meeting follow 3          follow seat 3 instead of the leader
 *   meeting follow leader     follow the leader again
 *   meeting rules go create   what the room asks of the people in it, while
 *                             you lead it (`go` alone by default: following)
 *
 * One meeting per swarm, so nothing needs selecting: the swarm IS the place.
 * Not in a swarm yet? The lobby says so, and its copy-link asks you to go
 * public first.
 */
export class MeetingQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'meeting'
  readonly command = 'meeting'
  override description = 'Start or join the meeting of your swarm, and copy its link'
  override descriptionKey = 'slash.meeting'
  override options = ['lobby', 'camera', 'leave', 'rules', 'lead', 'follow']
  override examples = [
    { input: '/meeting', result: 'Starts the meeting of your swarm, or joins it, and copies its link' },
    { input: '/meeting lobby', result: 'Check your camera and the rules of the room before joining' },
    { input: '/meeting camera', result: 'Turns your camera on, or off again (it starts off)' },
    { input: '/meeting leave', result: 'Leaves the meeting' },
    { input: '/meeting rules go create trait', result: 'The words the people following you allow: go, create, trait' },
  ]

  protected async execute(args: string): Promise<void> {
    const words = args.trim().split(/\s+/).filter(Boolean)
    const head = (words[0] ?? '').toLowerCase()

    // Video is off by default: the camera is yours to turn on.
    if (head === 'camera') {
      EffectBus.emitTransient('meeting:toggle-camera', {})
      return
    }

    if (head === 'leave') {
      EffectBus.emitTransient('meeting:leave', {})
      return
    }

    if (head === 'lead' || head === 'follow') {
      const who = (words[1] ?? '').toLowerCase()
      if (!who) {
        EffectBus.emit('activity:log', { message: head === 'lead' ? 'meeting: say meeting lead <seat>, or meeting lead me' : 'meeting: say meeting follow <seat>, or meeting follow leader', icon: '🐝' })
        return
      }
      EffectBus.emitTransient(head === 'lead' ? 'meeting:lead' : 'meeting:follow', { who })
      return
    }

    if (head === 'rules') {
      const rules = words.slice(1).map(w => w.toLowerCase())
      EffectBus.emitTransient('meeting:rules-set', { rules })
      EffectBus.emit('activity:log', {
        message: rules.length ? `meeting: this room asks for ${rules.join(', ')}` : 'meeting: this room asks only to follow (go)',
        icon: '🐝',
      })
      return
    }

    if (head === 'lobby') {
      const room = window.ioc?.get<{ value?: unknown }>('@hypercomb.social/RoomStore')?.value
      EffectBus.emitTransient('meeting:lobby-open', { cell: typeof room === 'string' ? room : '' })
      return
    }

    // `meeting` STARTS THE MEETING (jwize, 2026-11-02: "meeting starts
    // meeting", "just make it easy to connect").
    EffectBus.emitTransient('meeting:start', {})
  }
}

// ── registration ────────────────────────────────────────────

const _meeting = new MeetingQueenBee()
window.ioc.register('@diamondcoreprocessor.com/MeetingQueenBee', _meeting)
