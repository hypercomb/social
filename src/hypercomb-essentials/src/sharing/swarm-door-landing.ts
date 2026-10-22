// sharing/swarm-door-landing.ts
//
// WHERE A ROOM LINK LANDS (documentation/swarm-pools.md, arrive = join).
// The invite word asks this when it hands out a meeting link.

import { swarmDoorOf, SWARM_DOOR_LABEL } from '@hypercomb/core'
import { doorPackageRoot } from './update-scout.service.js'

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
