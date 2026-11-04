// meeting/meeting-feeds.ts
//
// WHICH FEEDS A MEETING ACTUALLY HAS. Two people each send voice and camera:
// four feeds. Cloudflare's SFU drops one when a second tracks request leaves
// before the previous offer and answer have finished (Realtime docs,
// "Negotiation": complete that exchange before the next mutation on the
// session). A track event can also fire before its mid is filled in, and a
// feed read only then is gone. The helpers here are the decisions the drone
// applies; the drone holds one queue across the whole exchange.

export type FeedTrack = { readonly mid: string; readonly trackName: string }

export type TrackEcho = {
  readonly mid?: string
  readonly trackName?: string
  readonly error?: unknown
  readonly errorCode?: unknown
}

const failed = (t: TrackEcho | undefined): boolean => !!t && (t.error != null || t.errorCode != null)

/** The local tracks the SFU actually took. An empty echo means the answer
 *  named none, so the offer stands. A track with `error` or `errorCode` is
 *  not advertised — the other side would subscribe to a feed that is not there. */
export const acceptedLocalTracks = (offered: readonly FeedTrack[], echoed: readonly TrackEcho[]): FeedTrack[] => {
  const named = offered.filter(t => t.mid && t.trackName)
  if (echoed.length === 0) return named
  const out: FeedTrack[] = []
  for (const offer of named) {
    const back = echoed.find(t => t.trackName === offer.trackName) ?? echoed.find(t => t.mid === offer.mid)
    if (!back || failed(back)) continue
    const mid = String(back.mid || offer.mid)
    if (mid) out.push({ mid, trackName: offer.trackName })
  }
  return out
}

export type HeldFeeds = { readonly session: string; readonly byName: ReadonlyMap<string, string> }

/** What to drop and what still to ask for. A track the SFU refused stays
 *  wanted. A track the publisher stopped advertising is dropped, so when it
 *  comes back it is subscribed again instead of remembered as already held. */
export const subscriptionPlan = (
  session: string,
  advertised: readonly string[],
  held: HeldFeeds | undefined,
): { readonly reset: boolean; readonly drop: readonly string[]; readonly want: readonly string[] } => {
  if (held && held.session !== session) {
    return { reset: true, drop: [...held.byName.keys()], want: [...advertised] }
  }
  const have = held?.byName ?? new Map<string, string>()
  const ads = new Set(advertised)
  return {
    reset: false,
    drop: [...have.keys()].filter(name => !ads.has(name)),
    want: advertised.filter(name => !have.has(name)),
  }
}

export type WireTrack = { readonly mid: string | null; readonly trackId: string | null }

/** Feeds present on the peer connection right now. A mid that is still null,
 *  or not yet mapped to a person, is not a feed — read the wire again once
 *  the answer has been applied. */
export const feedsFromWire = (
  wires: readonly WireTrack[],
  midOwner: ReadonlyMap<string, string>,
): { readonly owner: string; readonly trackId: string }[] => {
  const out: { owner: string; trackId: string }[] = []
  for (const wire of wires) {
    const owner = wire.mid ? midOwner.get(wire.mid) : undefined
    if (!owner || !wire.trackId) continue
    out.push({ owner, trackId: wire.trackId })
  }
  return out
}

/** One job at a time, including a job that throws. The meeting holds every
 *  SFU mutation and its SDP exchange in this, so a subscribe cannot leave
 *  while a publish's answer is still being applied. */
export const createSignalQueue = (): <T>(job: () => Promise<T>) => Promise<T> => {
  let tail: Promise<void> = Promise.resolve()
  return <T>(job: () => Promise<T>): Promise<T> => {
    const run = tail.then(job, job)
    tail = run.then(() => undefined, () => undefined)
    return run
  }
}

export type SpeakerSeat = { readonly id: string; readonly you?: boolean; readonly leads?: boolean }

/** Who fills the rectangular screen. A loud voice wins, except your own.
 *  Otherwise the leader, when that is someone else, then the first other
 *  person. You fill the screen only when the meeting is just you. */
export const speakerId = (seats: readonly SpeakerSeat[], loudId: string): string => {
  if (!seats.length) return ''
  if (loudId && seats.some(seat => seat.id === loudId && !seat.you)) return loudId
  const leader = seats.find(seat => seat.leads && !seat.you)
  if (leader) return leader.id
  const other = seats.find(seat => seat.id && !seat.you)
  if (other) return other.id
  return seats[0]?.id ?? ''
}

export type Face = { readonly name: string; readonly picture: string }

/** A name and picture carried on a meeting heartbeat. The picture is whatever
 *  `pictureOf` already allows a profile to show. */
export const faceOf = (raw: unknown, pictureOf: (value: unknown) => string | null): Face => {
  const record = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const name = String(record['name'] ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 64)
  return { name, picture: pictureOf(record['picture']) ?? '' }
}
