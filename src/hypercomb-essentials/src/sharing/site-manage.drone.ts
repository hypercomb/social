// sharing/site-manage.drone.ts
//
// THE BEE OF A MANAGED SITE DOOR'S CARD (site-manage.view.ts). On a page the
// worker marked as managing a site — it carries <script id="hc-manage"> — this
// defines <hc-site-manage> and adds it to the shell, so the owner sees their
// card with the chat beside it instead of an empty hive. On every other page
// it does nothing at all: no element, no surface, no listener.
//
// The view is loaded only on such a page, so no other page pays for it.

import { frameReportWords, type FrameReport } from '../history/frame-watch.js'
import { managedRecordText } from './managed-record.js'

const SURFACE = 'hc-site-manage'
const OWNER = '@diamondcoreprocessor.com/SiteManageView'
const REGISTRY_KEY = '@hypercomb.social/ShellSurfaceRegistry'
/** What the chat asks after it writes one of the site's files. */
export const SITE_RUN_WATCH_KEY = '@diamondcoreprocessor.com/SiteRunWatch'

/**
 * WHAT THE SITE'S PAGE DID AFTER A WRITE, in plain lines (frame-watch.ts).
 * The chat window (the shell, which may not import this package) asks for it
 * by this key once a file write lands on a managed site door, and hands the
 * lines to the model with the write's own result: a model that writes a
 * script is told whether the page then threw. Empty when there is no card on
 * this page or it did not answer.
 */
export class SiteRunWatch {
  async say(): Promise<string[]> {
    const card = typeof document === 'undefined' ? null
      : document.querySelector(SURFACE) as (Element & { pageReport?: () => Promise<(FrameReport & { reran?: boolean }) | null> }) | null
    if (typeof card?.pageReport !== 'function') return []
    try {
      const report = await card.pageReport()
      if (!report) return []
      // Said plainly when the card did not run again: what follows is then
      // the run before the write, and proves nothing about the write.
      return report.reran === false
        ? ['The page did not run again after this write (the card may not carry this file), so this is what its last run reported:', ...frameReportWords(report)]
        : frameReportWords(report)
    } catch { return [] }
  }
}

type RegistryLike = { add(surface: { name: string; owner?: string; element?: string; order?: number }): void }
type Ioc = {
  register?: (key: string, value: unknown) => void
  whenReady?: <T>(key: string, cb: (value: T) => void) => void
}

/** What this bee did, for introspection. */
export class SiteManageDrone {
  readonly name = 'site-manage'
  #managing = false
  get managing(): boolean { return this.#managing }

  /** Mount the card on a managed site door's page; anywhere else, nothing. */
  start(doc: Document = document): void {
    // Only the worker's record counts (managed-record.ts): planted markup mounts nothing.
    if (this.#managing || typeof window === 'undefined' || !managedRecordText(doc)) return
    this.#managing = true
    ;(window as unknown as { ioc?: Ioc }).ioc?.register?.(SITE_RUN_WATCH_KEY, new SiteRunWatch())
    void import('./site-manage.view.js').then(({ SiteManageElement }) => {
      if (!customElements.get(SURFACE)) customElements.define(SURFACE, SiteManageElement)
    }).catch((error: unknown) => {
      console.warn('[site-manage] the card did not load', error)
    })
    const ioc = (window as unknown as { ioc?: Ioc }).ioc
    ioc?.whenReady?.<RegistryLike>(REGISTRY_KEY, registry => {
      // Low in the order: the card is the page's ground, everything else above it.
      try { registry.add({ name: SURFACE, owner: OWNER, element: SURFACE, order: 5 }) } catch { /* hot reload */ }
    })
  }
}

const _siteManage = new SiteManageDrone()
;(window as unknown as { ioc?: Ioc }).ioc?.register?.('@diamondcoreprocessor.com/SiteManageDrone', _siteManage)
_siteManage.start()
