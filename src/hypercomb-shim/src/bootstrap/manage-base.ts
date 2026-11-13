// hypercomb-shim/src/bootstrap/manage-base.ts
//
// A MANAGED SITE DOOR STANDS AT ITS SITE. The owner's page at <name>.<zone> is
// served at /@hypercomb (the mark) and then on every path while the browser is
// marked (blossom-worker serveManagement). Its hive must stand at the site's
// own tile — /<lineage> — not at a tile called "@hypercomb": the card, the
// chat, every change the chat makes and the publish key all name that one
// tile (lineageKey([lineage]) is the root the worker reads the head from).
//
// This is the site door's URL base, exactly as the visitor shell sets it for a
// published site (hypercomb-web main.visitor.ts): the subdomain names the
// creation, so Navigation prepends [lineage] when it reads the address and
// strips it when it writes one. The /@hypercomb trigger, and a redundant
// leading /<lineage> from an old link, are normalized off the address once.
//
// Run before the bees mount, so no reader ever sees the hive at the wrong place.

import type { ManageRecord } from './manage-record'

/** The address the manage trigger is served at (blossom-worker isManagePath). */
const MANAGE_SEGMENT = '@hypercomb'

export type UrlBaseNavigation = { setUrlBase?: (segments: readonly string[]) => void }

const decode = (s: string): string => { try { return decodeURIComponent(s) } catch { return s } }

/** The path a managed page shows once it stands at its site: the trigger and
 *  a leading /<lineage> dropped, everything after them kept as written. */
export function managedPath(pathname: string, lineage: string): string {
  const parts = String(pathname || '/').split('/').filter(Boolean)
  if (parts[0] && decode(parts[0]).trim().toLowerCase() === MANAGE_SEGMENT) parts.shift()
  const own = String(lineage || '').trim().toLowerCase()
  if (own && parts[0] && decode(parts[0]).trim().toLowerCase() === own) parts.shift()
  return '/' + parts.join('/')
}

/** Point the page's Lineage at [lineage]. Returns the base it set, or null on
 *  a page that is not a managed site door (or has no navigation yet). */
export function standAtManagedSite(
  record: Pick<ManageRecord, 'lineage'> | null,
  navigation: UrlBaseNavigation | undefined,
  win: Pick<Window, 'location' | 'history' | 'dispatchEvent'> = window,
): readonly string[] | null {
  const lineage = String(record?.lineage ?? '').trim()
  if (!lineage || typeof navigation?.setUrlBase !== 'function') return null
  const base = [lineage]
  navigation.setUrlBase(base)
  const { pathname, search, hash } = win.location
  const next = managedPath(pathname, lineage)
  if (next !== pathname) {
    // The search and the hash ride through: an #invite= link is read later.
    try { win.history.replaceState(win.history.state, '', next + search + hash) } catch { /* the base still holds */ }
  }
  // Lineage followed the raw address when it was made; read it again.
  try { win.dispatchEvent(new Event('navigate')) } catch { /* no listener yet */ }
  return base
}
