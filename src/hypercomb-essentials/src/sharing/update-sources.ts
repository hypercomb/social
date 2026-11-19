// sharing/update-sources.ts
//
// THE HOSTS THIS DEVICE ASKS FOR THE PACKAGE.
//
// Two acts already ask hosts for the package's bytes: a managed site door
// taking an offered update (site-manage.view.ts) and the allowed take of an
// announced root everywhere else (upgrade-allow.ts takeIfAllowed). Each has
// its own list. A third reader now asks for something the package names but
// does not install, its TypeScript (owner, 2026-11-16: "Host the package's
// TypeScript without installing it, fetched only when a file is opened"), and
// it must ask exactly the hosts this device already asks for the package and
// no other. So the door's list moved here from the view, unchanged, and
// `packageHosts` answers with whichever of the two lists this page uses.
//
// A dependency: it registers nothing and writes nothing.

import { listCommunityHosts } from './community-hosts.js'
import { isManagedSiteDoor, managedSiteSegments } from './managed-record.js'
// Whom builds follow here — the same record the scout read the offer from (the
// Packages window reads it the same way: host-directory.view.ts #follow).
import { readInstallFollow } from './update-scout.service.js'

/** The zone a site door hangs off (`business-card.jwize.com` → `jwize.com`):
 *  the address that serves its publisher's packages. A NAME IS THE ROUTE AT ANY
 *  DEPTH (worker.js resolveSite): `knowledge.hyperdex.jwize.com` is the site
 *  `hyperdex/knowledge`, so when the host begins with the site's own route read
 *  leaf first, the zone is everything after it (`jwize.com`, never
 *  `hyperdex.jwize.com`). A host that does not (an own address, or no record)
 *  loses its first label, as before. MIRRORED from the shim's manage-record.ts
 *  siteDoorZone (a module may not import the shim). */
export function managedSiteZone(host: string, segments: readonly string[] | null = managedSiteSegments()): string {
  const bare = String(host || '').toLowerCase().replace(/:\d+$/, '')
  const name = (segments ?? []).map(segment => segment.toLowerCase()).reverse().join('.')
  if (name && bare.startsWith(`${name}.`) && bare.length > name.length + 1) return bare.slice(name.length + 1)
  const labels = bare.split('.').filter(Boolean)
  return labels.length >= 3 ? labels.slice(1).join('.') : bare
}

/** Where an offered update's bytes are asked for: the site's zone, then the
 *  hosts the follow record names (where the scout read the offer). */
export function updateSources(host: string, storage: Pick<Storage, 'getItem'> | null = safeStorage()): string[] {
  let followed: readonly string[] = []
  try { followed = storage ? readInstallFollow(storage)?.hosts ?? [] : [] } catch { followed = [] }
  return [...new Set([managedSiteZone(host), ...followed].filter(Boolean))]
}
const safeStorage = (): Storage | null => { try { return localStorage } catch { return null } }

/**
 * The hosts this device already asks for the package, in the order it asks
 * them. On a managed site door that is `updateSources`: the list the door
 * hands to the install port. Everywhere else it is the hosts the participant
 * carries, then the hosts the follow record names: the list the allowed take
 * hands to the install port. A follow that is off, with no carried host, is
 * an empty list, and nothing is asked. The page's own origin is never added:
 * a shell that is not a host serves no byte of the package.
 */
export async function packageHosts(deps: {
  door?: boolean
  host?: string
  storage?: Pick<Storage, 'getItem'> | null
  carried?: () => Promise<string[]>
} = {}): Promise<string[]> {
  const storage = deps.storage !== undefined ? deps.storage : safeStorage()
  if (deps.door ?? isManagedSiteDoor()) return updateSources(deps.host ?? location.host, storage)
  const carried = await (deps.carried ?? listCommunityHosts)().catch(() => [] as string[])
  let followed: readonly string[] = []
  try { followed = storage ? readInstallFollow(storage)?.hosts ?? [] : [] } catch { followed = [] }
  return [...new Set([...carried, ...followed].map(zone => String(zone ?? '').trim()).filter(Boolean))]
}
