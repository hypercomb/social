// diamondcoreprocessor.com/meeting/meeting.queen.ts
// /meeting — toggle meeting availability (join/leave).
// When joining, camera starts immediately so your video appears in your tile.

import { QueenBee } from '@hypercomb/core'

/**
 * meeting — join or leave the hive meeting.
 *
 * Type `/meeting` to toggle your availability.
 * Joining starts your camera; leaving stops it and disconnects peers.
 */
export class MeetingQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'meeting'
  override readonly aliases = ['meet', 'join']

  override description = 'Join or leave the hive meeting'

  protected execute(_args: string): void {
    const drone = window.ioc.get('@diamondcoreprocessor.com/HiveMeetingDrone') as any
    const isJoined = drone?.localAvailable === true

    if (!isJoined) {
      // joining — request camera from user gesture context
      navigator.mediaDevices.getUserMedia({ video: true, audio: true })
        .then(stream => {
          window.dispatchEvent(new CustomEvent('meeting:toggle-available', { detail: { stream } }))
        })
        .catch(() => {
          // camera denied — join without camera
          window.dispatchEvent(new CustomEvent('meeting:toggle-available'))
        })
    } else {
      // leaving
      window.dispatchEvent(new CustomEvent('meeting:toggle-available'))
    }
  }
}

const _meeting = new MeetingQueenBee()
window.ioc.register('@diamondcoreprocessor.com/MeetingQueenBee', _meeting)
