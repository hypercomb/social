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

/** The record the worker put in the page, or null on every other page. */
export function managedPage(doc: Pick<Document, 'getElementById'> | undefined = globalThis.document): ManagedPage | null {
  try {
    const raw = doc?.getElementById('hc-manage')?.textContent
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
 * WHAT THE OWNER GRANTS ON THEIR OWN REPLICA: everything. The farthest reach
 * and scope on the ladders, and no roster — a grant with no `granted` list is
 * one the gate does not ask a roster of (core machine-admission.ts), so every
 * verb a behaviour offers to models is callable. The Execution window still
 * shows each block; what it shows is never refused for want of a grant.
 */
export const MANAGED_PAGE_GRANT: MachineGrant = Object.freeze({ reach: 'destructive', scope: 'network' })

/** The grant the chat works under on this page: the owner's full grant on a
 *  managed site door, and the participant's own everywhere else — read live,
 *  exactly as core reads it. */
export const chatMachineGrant = (live: () => MachineGrant, doc?: Pick<Document, 'getElementById'>): MachineGrant =>
  managedPage(doc) ? MANAGED_PAGE_GRANT : live()
