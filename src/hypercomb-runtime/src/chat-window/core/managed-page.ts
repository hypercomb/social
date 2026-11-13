// hypercomb-runtime/src/chat-window/core/managed-page.ts
//
// THE CHAT ON A MANAGED SITE DOOR (jwize, 2026-11-13: "The whole idea is we
// are upgrading something that we replicated", "The ai should be able to do
// anything it likes"). The worker serves the framework-free page at
// <name>.<zone> to a browser its owner marked through /@hypercomb, and puts a
// record in it: <script id="hc-manage" type="application/json"> naming the
// site's lineage, its title, its publisher and the head they published. That
// page holds a replica of the owner's card, and the owner is the one at the
// keyboard. There is no command line on it, so nothing there could ever grant
// a verb — and nothing needs to: on that page the chat is the owner's own
// hands on their own replica.
//
// MIRRORED: hypercomb-shim/src/bootstrap/manage-record.ts and essentials
// sharing/site-manage.view.ts read the same record (runtime may not import
// either). Every field is untrusted page text: shapes are checked, nothing
// is markup.

import type { MachineGrant } from '@hypercomb/core'

const SIG_RE = /^[0-9a-f]{64}$/

export type ManagedPage = {
  /** The site's lineage: the tile the card lives at, `business-card`. */
  readonly lineage: string
  readonly title: string
  readonly publisher: string | null
  /** The head the owner published, or null while unknown. */
  readonly head: string | null
}

/** ONLY THE WORKER'S RECORD COUNTS. The worker injects it into the served page
 *  as `<script type="application/json" id="hc-manage">` in <head>. Anything
 *  else with that id — a website page mounted inline on a normal hive can plant
 *  markup, and its scripts run in this document — is not a record: it would
 *  lift the chat's fences on a hive that is no managed site door. So the record
 *  must be that script, a direct child of <head>; and the page's answer is
 *  taken ONCE, the first time it is asked (at boot: the shim imports the chat
 *  eagerly), and published frozen on globalThis for the module copies that
 *  cannot import this file (essentials reads it) — an element planted later
 *  changes nothing. */
const SNAPSHOT_KEY = '__hypercombManagedPage'

/** The worker's record element in `doc`, or null for anything else. */
export function workerRecordText(doc: Pick<Document, 'getElementById'> & { head?: Element | null } | undefined): string | null {
  const el = doc?.getElementById('hc-manage') as (Element & { type?: string }) | null | undefined
  if (!el || el.tagName !== 'SCRIPT' || String(el.type ?? el.getAttribute?.('type') ?? '').toLowerCase() !== 'application/json') return null
  if (!doc?.head || el.parentElement !== doc.head) return null
  return el.textContent
}

let snapshot: { readonly page: ManagedPage | null } | undefined
let testing = false

/** This document's answer, taken once and shared frozen. */
function documentPage(): ManagedPage | null {
  if (snapshot) return snapshot.page
  const g = globalThis as Record<string, unknown>
  if (testing) {
    snapshot = { page: parseRecord(workerRecordText(globalThis.document)) }
    return snapshot.page
  }
  // Another copy of this module already answered for this document.
  if (Object.prototype.hasOwnProperty.call(g, SNAPSHOT_KEY)) {
    snapshot = { page: (g[SNAPSHOT_KEY] as ManagedPage | null) ?? null }
    return snapshot.page
  }
  const page = parseRecord(workerRecordText(globalThis.document))
  snapshot = { page: page ? Object.freeze(page) : null }
  try { Object.defineProperty(g, SNAPSHOT_KEY, { value: snapshot.page, writable: false, configurable: false, enumerable: false }) } catch { /* already fixed by another copy */ }
  return snapshot.page
}
if (typeof document !== 'undefined') documentPage()

/** For specs only: forget this module's answer so a test page can be read anew
 *  (and from then on read it as it stands, ignoring the frozen global). */
export function forgetManagedPageForTests(): void { snapshot = undefined; testing = true }

/** The record the worker put in the page, or null on every other page. With a
 *  document handed in (a spec), that document is read as it is. */
export function managedPage(doc?: Pick<Document, 'getElementById'> & { head?: Element | null }): ManagedPage | null {
  if (doc && doc !== globalThis.document) return parseRecord(workerRecordText(doc))
  return documentPage()
}

function parseRecord(raw: string | null | undefined): ManagedPage | null {
  try {
    if (!raw) return null
    const value = JSON.parse(raw) as Record<string, unknown>
    if (!value || typeof value !== 'object') return null
    const lineage = typeof value['lineage'] === 'string' ? value['lineage'].trim().slice(0, 200) : ''
    if (!lineage) return null
    const title = typeof value['title'] === 'string' && value['title'].trim() ? value['title'].trim().slice(0, 200) : lineage
    const publisher = typeof value['publisher'] === 'string' && SIG_RE.test(value['publisher']) ? value['publisher'] : null
    const head = typeof value['head'] === 'string' && SIG_RE.test(value['head']) ? value['head'] : null
    return { lineage, title, publisher, head }
  } catch {
    return null
  }
}

/**
 * WHAT THE OWNER GRANTS ON THEIR OWN REPLICA: every change, and nothing that
 * leaves it (jwize, 2026-11-13: "We have freedom to do anything in this
 * sandbox", "AI can't publish on the community but it can make changes").
 * The farthest REACH (destructive included) and no roster — a grant with no
 * `granted` list is one the gate does not ask a roster of (core
 * machine-admission.ts), so every verb a behaviour offers to models is
 * callable — but SCOPE stops at the hive: a verb declared `network` (publish,
 * republish, contribute, follow, groups, hide's signed mesh event, adopt, the
 * questions) is neither offered nor admitted. The chat's own writes are
 * declared at the hive (MACHINE_WRITE) and pass. Sharing is the owner's
 * Publish, never the model's.
 */
export const MANAGED_PAGE_GRANT: MachineGrant = Object.freeze({ reach: 'destructive', scope: 'hive' })

/** The grant the chat works under on this page: the owner's full grant on a
 *  managed site door, and the participant's own everywhere else — read live,
 *  exactly as core reads it. */
export const chatMachineGrant = (live: () => MachineGrant, doc?: Pick<Document, 'getElementById'>): MachineGrant =>
  managedPage(doc) ? MANAGED_PAGE_GRANT : live()
