// sharing/site-manage.drone.ts
//
// THE BEE OF A MANAGED SITE DOOR'S CARD (site-manage.view.ts). On a page the
// worker marked as managing a site — it carries <script id="hc-manage"> — this
// defines <hc-site-manage> and adds it to the shell, so the owner sees their
// card with the chat beside it instead of an empty hive. On every other page
// it does nothing at all: no element, no surface, no listener.
//
// The view is loaded only on such a page, so no other page pays for it.

import { managedRecordText } from './managed-record.js'

const SURFACE = 'hc-site-manage'
const OWNER = '@diamondcoreprocessor.com/SiteManageView'
const REGISTRY_KEY = '@hypercomb.social/ShellSurfaceRegistry'

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
