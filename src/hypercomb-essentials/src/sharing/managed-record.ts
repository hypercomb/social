// sharing/managed-record.ts
//
// ONLY THE WORKER'S RECORD MARKS A MANAGED SITE DOOR. The worker injects
// `<script type="application/json" id="hc-manage">` into the served page's
// <head>. A website page mounted inline on a normal hive can plant markup (and
// run script) in the same document, so nothing else with that id may count:
// it would turn a normal hive into a "managed" one. The runtime takes the
// page's answer once, at boot, and publishes it frozen on globalThis
// (hypercomb-runtime chat-window/core/managed-page.ts) — that answer is used
// when present; a page without it is read with the same strict check.
//
// Returns the record's JSON text (the readers parse their own fields).

const SNAPSHOT_KEY = '__hypercombManagedPage'

export function managedRecordText(doc: Document | undefined = typeof document === 'undefined' ? undefined : document): string | null {
  if (!doc) return null
  const g = globalThis as Record<string, unknown>
  if (doc === (globalThis as { document?: Document }).document && Object.prototype.hasOwnProperty.call(g, SNAPSHOT_KEY)) {
    const page = g[SNAPSHOT_KEY]
    return page ? JSON.stringify(page) : null
  }
  const el = doc.getElementById('hc-manage')
  if (!el || el.tagName !== 'SCRIPT' || String((el as HTMLScriptElement).type ?? '').toLowerCase() !== 'application/json') return null
  if (!doc.head || el.parentElement !== doc.head) return null
  return el.textContent
}

let siteOf: { readonly raw: string | null; readonly segments: string[] | null } | undefined

/** THE SITE'S OWN TILE on a managed site door, as the route its replica lives
 *  at — `business-card` → ['business-card'], `revolucion/meetup` →
 *  ['revolucion', 'meetup'] — or null on every other page. The same split the
 *  shim uses to point the page at it (manage-base.ts `siteSegments`). */
export function managedSiteSegments(doc: Document | undefined = typeof document === 'undefined' ? undefined : document): string[] | null {
  let raw: string | null = null
  try { raw = managedRecordText(doc) } catch { /* no record */ }
  if (siteOf && siteOf.raw === raw) return siteOf.segments
  let segments: string[] | null = null
  try {
    const lineage = raw ? (JSON.parse(raw) as Record<string, unknown>)?.['lineage'] : undefined
    const split = typeof lineage === 'string' ? lineage.split('/').map(segment => segment.trim()).filter(Boolean) : []
    segments = split.length ? split : null
  } catch { /* not a record */ }
  siteOf = { raw, segments }
  return segments
}

/** Is this page a managed site door: the worker's record, naming the site's
 *  lineage. One answer for every module that behaves differently there. */
export function isManagedSiteDoor(doc: Document | undefined = typeof document === 'undefined' ? undefined : document): boolean {
  try {
    const raw = managedRecordText(doc)
    if (!raw) return false
    const value = JSON.parse(raw) as Record<string, unknown>
    return !!value && typeof value['lineage'] === 'string' && value['lineage'].trim().length > 0
  } catch {
    return false
  }
}
