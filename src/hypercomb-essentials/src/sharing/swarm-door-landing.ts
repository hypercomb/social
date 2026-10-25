// sharing/swarm-door-landing.ts
//
// WHERE A ROOM LINK LANDS (documentation/swarm-pools.md, arrive = join).
// The invite word asks this when it hands out a meeting link.

import { meetingPointKey, swarmDoorOf, SWARM_DOOR_LABEL } from '@hypercomb/core'
import { doorPackageRoot } from './update-scout.service.js'
import { publishSwarmLink, swarmLinkText } from './swarm-link.js'

const HOST_SYNC_KEY = '@diamondcoreprocessor.com/HostSyncService'
const LOOPBACK_HOST_RE = /^(?:(?:[a-z0-9-]+\.)*localhost|127(?:\.\d+){3}|\[::1\])$/i

type PutOne = (host: string, sig: string, bytes: Uint8Array) => Promise<{ ok: true } | { ok: false; reason: 'refused' | 'unreachable' }>

/** Whether a guest could reach the room's meeting point at all: it names a
 *  host, and that host is not this machine's own loopback. */
export const guestsCanReach = (relay: string): boolean => {
  if (!meetingPointKey(relay)) return false
  try { return !LOOPBACK_HOST_RE.test(new URL(relay).hostname) } catch { return false }
}

/** A ROOM'S SEALED LINK (swarm-link.ts): its login — host, location, secret,
 *  code, page — sealed and kept on the room's meeting host as ciphertext, and
 *  handed out as #swarm=<sig>@<host>~<key> on the page it lands on. '' when
 *  the room meets nowhere a guest can reach (no host, a loopback one), or the
 *  host will not keep it — then the caller says so or hands out #meet=. The
 *  invite word and `room host` both make it here, so one login seals to one
 *  #swarm= fragment wherever it is shared. */
export async function sealedRoomLink(
  room: string,
  secret: string,
  relay: string,
  code: string | undefined,
  page: readonly string[],
  landing: (host: string) => Promise<string> = host => landingOrigin(host),
): Promise<string> {
  if (!guestsCanReach(relay)) return ''
  const host = meetingPointKey(relay)
  const putOne = (globalThis as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.(HOST_SYNC_KEY) as { putOne?: PutOne } | undefined
  if (typeof putOne?.putOne !== 'function') return ''
  const login = { host, location: room, secret, ...(code ? { code } : {}), ...(page.length ? { page: [...page] } : {}) }
  try {
    const r = await publishSwarmLink(login, ({ host: at, sig, bytes }) => putOne.putOne!(at, sig, bytes))
    return r.ok ? swarmLinkText(await landing(host), r.parts) : ''
  } catch { return '' }
}

/** How long the share waits to learn whether the host opened a swarm door. */
const DOOR_PROBE_MS = 2_500

/** WHERE A ROOM LINK LANDS (documentation/swarm-pools.md, arrive = join). When
 *  the room's meeting host has opened its swarm door — `swarm.<host>`, the
 *  participant shell pinned to what the host signed as `install:swarm` — the
 *  link lands THERE, so whoever opens it runs the room's package before they
 *  attach. Otherwise, as before, on the page the sharer stands on. A sharer
 *  already on the door lands guests where they are. Never a loopback host. */
export async function landingOrigin(
  meetingHost: string,
  here: string = globalThis.location?.origin ?? '',
  probe: (origin: string) => Promise<string | null> = origin => doorPackageRoot(origin, (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(DOOR_PROBE_MS) })),
): Promise<string> {
  try { if (swarmDoorOf(new URL(here).hostname)) return here } catch { return here }
  const zone = String(meetingHost ?? '').trim().toLowerCase().replace(/:\d{1,5}$/, '')
  if (!zone || /^(?:(?:[a-z0-9-]+\.)*localhost|127(?:\.\d+){3}|\[::1\])$/.test(zone)) return here
  const door = `https://${SWARM_DOOR_LABEL}.${zone}`
  return (await probe(door)) ? door : here
}
