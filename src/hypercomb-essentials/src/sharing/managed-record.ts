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
