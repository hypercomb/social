// meeting/lobby/lobby-media.ts
//
// The lobby's small decisions, apart from the element so they can be tested
// without a camera: why a camera did not open, where the seven seats of the
// 1+6 circle sit and which are taken, how loud a microphone is, and what to
// call a device that has no name.

export type Failure = 'blocked' | 'missing' | 'busy' | 'error'

/** Why `getUserMedia` said no, in the four ways the participant can act on. */
export const failureOf = (error: unknown): Failure => {
  const name = (error as { name?: string } | null)?.name ?? ''
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'blocked'
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'missing'
  if (name === 'NotReadableError' || name === 'AbortError') return 'busy'
  return 'error'
}

/** A seat in the circle: its centre, in units of one seat's radius. */
export type Seat = { x: number; y: number }

/** The Cascade as seats: the leader in the middle, then six around. Pointy-top
 *  hexagons touch their neighbours at 0°, 60°, … so the ring sits at those
 *  angles, one centre-to-centre distance (radius × √3) out. */
export const SEATS = 7

export const seatPositions = (radius: number): readonly Seat[] => {
  const reach = radius * Math.sqrt(3)
  const seats: Seat[] = [{ x: 0, y: 0 }]
  for (let k = 0; k < SEATS - 1; k++) {
    const angle = (Math.PI / 3) * k
    seats.push({ x: reach * Math.cos(angle), y: reach * Math.sin(angle) })
  }
  return seats
}

/** Which seats are taken by `here` people: the middle first, then round. */
export const seatsTaken = (here: number): readonly boolean[] =>
  Array.from({ length: SEATS }, (_, seat) => seat < Math.max(0, Math.floor(here)))

/** Loudness from 0 to 1 of a time-domain byte buffer (128 is silence). A gentle
 *  curve so ordinary speech moves the bar instead of barely nudging it. */
export const levelOf = (samples: ArrayLike<number>): number => {
  if (!samples.length) return 0
  let sum = 0
  for (let i = 0; i < samples.length; i++) {
    const v = (samples[i] - 128) / 128
    sum += v * v
  }
  return Math.min(1, Math.sqrt(Math.sqrt(sum / samples.length)) * 1.4)
}

/** What a device is called in the list. Browsers hide labels until permission. */
export const deviceLabel = (device: { label: string }, index: number, kind: 'camera' | 'microphone'): string =>
  device.label.trim() || `${kind === 'camera' ? 'Camera' : 'Microphone'} ${index + 1}`
