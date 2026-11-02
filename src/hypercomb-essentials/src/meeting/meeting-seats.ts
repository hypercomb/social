// meeting/meeting-seats.ts
//
// THE SWARM'S MEETING, worked out without a browser: where it is, who leads
// it, where everyone sits, and when a follower moves.
//
// ONE MEETING PER SWARM (jwize, 2026-11-02: "the meeting room just needs to
// open when you type meeting"). A swarm is host + room + secret
// (swarm-room-identity.md), and every room address is
// sign(`<label> \0 ` + roomPreimage(...)) — so the meeting's address is
// sign(`meeting \0 ` + roomPreimage(room, secret, host)). Same words, same
// meeting; a stranger outside the swarm cannot derive it, and a page change
// does not move it.
//
// THE LEADER IS THE MIDDLE ("let's just make the leader the middle and then
// people follow you where ever you go in the hive"). The ORIGINATOR is whoever
// has been in the meeting longest: earliest `since`, ties broken by id so
// every member computes the same answer. The originator leads, or hands the
// lead to someone and takes it back ("you could give up leadership and take
// it back if you are the originator"): only the originator's `lead` counts.
// Seat 1 (the centre hex) is the leader; the ring fills in order of arrival.
// Anyone may follow someone else instead ("people could follow someone else
// and so on"); with nobody chosen, they follow the leader.
//
// FOLLOWING IS A PATH, SAID LOCALLY ("we are just sending small paths that get
// executed locally"). The leader's heartbeat carries the segments it stands
// on; a follower walks there when the leader MOVES — not on every beat, so a
// follower who looks around is brought back at the leader's next step, not
// every five seconds.

import { roomPreimage } from '@hypercomb/core'

export const MEETING_LABEL = 'meeting'

/** The text a swarm's meeting address is signed from, or '' when there is no
 *  swarm to meet in (no host named: no room, nothing to sign). */
export const meetingPreimage = (room: string, secret: string, host: unknown): string => {
  const tail = roomPreimage(room, secret, host)
  return tail && room.trim() && secret.trim() ? `${MEETING_LABEL}\0${tail}` : ''
}

/** sign(preimage) — the swarm meeting's mesh address. '' for ''. */
export const meetingAddress = async (preimage: string): Promise<string> => {
  if (!preimage) return ''
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(preimage))
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

export type Member = {
  readonly id: string
  /** When this member joined the meeting (their own clock, ms). */
  readonly since: number
  /** The segments they stand on, as they last said. */
  readonly path?: readonly string[]
  /** Whom they handed the lead to — read only from the originator. */
  readonly lead?: string
  /** Whom they chose to follow; '' or absent follows the leader. */
  readonly follows?: string
}

const earlier = (a: Member, b: Member): number =>
  a.since !== b.since ? a.since - b.since : a.id < b.id ? -1 : a.id > b.id ? 1 : 0

/** The originator: in longest, ties by id. undefined when nobody is in. */
export const originatorOf = (members: readonly Member[]): Member | undefined =>
  [...members].sort(earlier)[0]

/** The leader: whom the originator handed the lead to, while they are here;
 *  else the originator. undefined when nobody is in. */
export const leaderOf = (members: readonly Member[]): Member | undefined => {
  const originator = originatorOf(members)
  const handed = originator?.lead ? members.find(m => m.id === originator.lead) : undefined
  return handed ?? originator
}

/** Everyone in seat order: the leader first (the middle), then by arrival. */
export const seatOrder = (members: readonly Member[]): readonly Member[] => {
  const leader = leaderOf(members)
  const rest = [...members].sort(earlier).filter(m => m.id !== leader?.id)
  return leader ? [leader, ...rest] : rest
}

/** Whom `selfId` follows: the member they chose while that member is here
 *  and is not themselves, else the leader — undefined when that is
 *  themselves (nobody to follow). */
export const followedBy = (selfId: string, members: readonly Member[], chosen: string): Member | undefined => {
  const pick = chosen && chosen !== selfId ? members.find(m => m.id === chosen) : undefined
  const target = pick ?? leaderOf(members)
  return target && target.id !== selfId ? target : undefined
}

/** Whether anyone follows `selfId` — the only time their lines are sent. */
export const isFollowed = (selfId: string, members: readonly Member[]): boolean =>
  members.some(m => m.id !== selfId && followedBy(m.id, members, m.follows ?? '')?.id === selfId)

/** Segments as a comparable key. */
export const pathKey = (path: readonly string[] | undefined): string =>
  (path ?? []).map(s => String(s ?? '').trim()).filter(Boolean).join('/')

/** Where a follower should walk, or null to stay. Only when the leader's path
 *  CHANGED since last heard (`lastLeaderPath`), or on first hearing it, and
 *  only when it is not where the follower already stands. Never for the
 *  leader. */
export const followStep = (args: {
  readonly selfId: string
  readonly leader: Member | undefined
  readonly lastLeaderPath: string | null
  readonly here: readonly string[]
}): readonly string[] | null => {
  const { selfId, leader, lastLeaderPath, here } = args
  if (!leader || leader.id === selfId || !leader.path) return null
  const target = pathKey(leader.path)
  if (lastLeaderPath !== null && target === lastLeaderPath) return null
  if (target === pathKey(here)) return null
  return target ? target.split('/') : []
}
