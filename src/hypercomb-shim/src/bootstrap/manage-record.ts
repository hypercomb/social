// hypercomb-shim/src/bootstrap/manage-record.ts
//
// WHAT A MANAGED SITE DOOR'S PAGE IS TOLD (jwize, 2026-11-12: "I need to be only
// with the visual card and the chat ai to improve"). The worker serves this page
// at <name>.<zone> to a browser its owner marked through /@hypercomb, and puts a
// record in it: <script id="hc-manage" type="application/json">. Its presence
// is what makes this page a management page rather than a host's front door:
// the host console stays out of the way, the host's package installs itself on
// the first visit, and the site's card shows with the chat beside it
// (essentials sharing/site-manage.view.ts draws that part).
//
// Every field is untrusted text from a page record: shapes are checked, nothing
// is markup.

import { LEGACY_DIRECTORIES } from '@hypercomb/core'

const SIG_RE = /^[0-9a-f]{64}$/
// A bare host name (a machine's `localhost:<port>` included), never a URL.
const HOST_RE = /^(?:[a-z0-9-]+\.)*[a-z0-9-]+(?::\d{1,5})?$/

export type ManageRecord = {
  readonly lineage: string
  readonly title: string
  readonly publisher: string | null
  readonly head: string | null
  /** The zone root this page's publish writes to (worker.js writeFaceFor): the
   *  site door itself is read-only. A hint — managed-publish.ts checks the host
   *  serves the index this site reads before it writes there. */
  readonly writes: string | null
}

/** The leave route: the mark and the service worker go, and the address is the website again. */
export const MANAGE_LEAVE_HREF = '/@hypercomb/leave'

/** The zone a site door hangs off: `business-card.jwize.com` → `jwize.com`. A
 *  site door's own host:packages address is not a package host (it answers a raw
 *  listing); the zone root is the one that serves the publisher's packages. */
export function siteDoorZone(host: string): string {
  const bare = String(host || '').toLowerCase().replace(/:\d+$/, '')
  const labels = bare.split('.').filter(Boolean)
  return labels.length >= 3 ? labels.slice(1).join('.') : bare
}

/** Bees actually on this device: the sign('bees') pool (or its legacy drain
 *  source) holds an entry. Never the localStorage stamp: a visitor's look at the
 *  same address writes that stamp from a hive that lived only in memory. */
export async function beesOnDisk(): Promise<boolean> {
  try {
    const root = await navigator.storage.getDirectory()
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('bees')))
    const pool = [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('')
    for (const name of [pool, LEGACY_DIRECTORIES.bees]) {
      const dir = await root.getDirectoryHandle(name).catch(() => null)
      if (!dir) continue
      for await (const _entry of (dir as unknown as { keys(): AsyncIterable<string> }).keys()) return true
    }
    return false
  } catch {
    return false
  }
}

export function manageRecord(doc: Document = document): ManageRecord | null {
  try {
    const raw = doc.getElementById('hc-manage')?.textContent
    if (!raw) return null
    const value = JSON.parse(raw) as Record<string, unknown>
    const lineage = typeof value['lineage'] === 'string' ? value['lineage'].slice(0, 200) : ''
    if (!lineage) return null
    const title = typeof value['title'] === 'string' && value['title'] ? value['title'].slice(0, 200) : lineage
    const publisher = typeof value['publisher'] === 'string' && SIG_RE.test(value['publisher']) ? value['publisher'] : null
    const head = typeof value['head'] === 'string' && SIG_RE.test(value['head']) ? value['head'] : null
    const named = typeof value['writes'] === 'string' ? value['writes'].trim().toLowerCase() : ''
    const writes = named.length <= 253 && HOST_RE.test(named) ? named : null
    return { lineage, title, publisher, head, writes }
  } catch {
    return null
  }
}
