// history/revisions.queen.ts
//
// `revisions` — flip through a website tile's own versions, above the website.
//
//   revisions                  the tile you stand on
//   revisions /jaime-weise     that tile (a route from the hive root with '/', else from where you stand)
//
// The viewer (revision-viewer.view.ts) shows each version's page running as
// the site runs it, groups the versions into runs of the same page, and
// narrows a range down to the version where something changed. It is per tile:
// the tile's own lineage, never the hive-wide history (that is `history`).
//
// The bee half of the feature: this file defines the element, adds it to the
// ShellSurfaceRegistry and opens it. The view is loaded only when asked for.

import { EffectBus, I18N_IOC_KEY, QueenBee, type I18nProvider } from '@hypercomb/core'

const SURFACE = 'hc-revision-viewer'
const OWNER = '@diamondcoreprocessor.com/RevisionViewer'
const REGISTRY_KEY = '@hypercomb.social/ShellSurfaceRegistry'
const LINEAGE_KEY = '@hypercomb.social/Lineage'

type RegistryLike = {
  add(surface: { name: string; owner?: string; element?: string; order?: number }): void
  all?: () => readonly { name?: string }[]
}
type Opener = HTMLElement & { open(segments: readonly string[]): Promise<void> }

type Ioc = { get?: <T>(key: string) => T | undefined; whenReady?: <T>(key: string, cb: (value: T) => void) => void }
const ioc = (): Ioc | undefined => (window as unknown as { ioc?: Ioc }).ioc

/** A word in the person's language, or the English one where a catalog has none yet. */
const words = (key: string, fallback: string, params?: Record<string, string>): string => {
  try {
    const said = ioc()?.get?.<I18nProvider>(I18N_IOC_KEY)?.t?.(key, params)
    if (typeof said === 'string' && said && said !== key) return said
  } catch { /* the fallback below */ }
  return fallback.replace(/\{(\w+)\}/g, (_, name: string) => params?.[name] ?? '')
}

/** A typed route: from the hive root with a leading '/', else from where you stand. */
export function routeOf(here: readonly string[], typed: string): string[] {
  const parts = typed.split('/').map(s => s.trim()).filter(Boolean)
  return typed.trim().startsWith('/') ? parts : [...here, ...parts]
}

/** Load the view, define its tag, put it in the shell once, and hand back the mounted element. */
async function viewer(): Promise<Opener> {
  const { RevisionViewerElement } = await import('./revision-viewer.view.js')
  if (!customElements.get(SURFACE)) customElements.define(SURFACE, RevisionViewerElement)
  ioc()?.whenReady?.<RegistryLike>(REGISTRY_KEY, registry => {
    if (registry.all?.().some(surface => surface?.name === SURFACE)) return
    try { registry.add({ name: SURFACE, owner: OWNER, element: SURFACE, order: 260 }) } catch { /* hot reload */ }
  })
  // The registry's host mounts the element on its next pass; a page with no
  // host (or one that has not drawn yet) gets it on the body.
  // A timer, not a frame: a hidden tab never runs a frame callback.
  await new Promise(resolve => setTimeout(resolve, 40))
  let found = document.querySelector(SURFACE) as Opener | null
  if (!found) {
    found = document.createElement(SURFACE) as Opener
    document.body.appendChild(found)
  }
  return found
}

export class RevisionsQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'revisions'
  // A route is an identifier, not words: handed over exactly as typed.
  override rawArgs = true
  override description = "Flip through a website tile's versions, above it"
  override descriptionKey = 'slash.revisions'
  override examples = [
    { input: 'revisions', result: "The tile's versions open above its website, newest first" },
    { input: 'revisions /jaime-weise', result: "jaime-weise's versions open, each one running as the site ran it" },
  ]

  protected async execute(args: string): Promise<void> {
    const lineage = ioc()?.get?.<{ explorerSegments?: () => readonly string[] }>(LINEAGE_KEY)
    const here = [...(lineage?.explorerSegments?.() ?? [])].map(String)
    const segments = args.trim() ? routeOf(here, args) : here
    if (segments.length === 0) {
      EffectBus.emit('toast:show', { type: 'tip', message: words('revisions.stand-on', 'Stand on a website tile, or name one: revisions /jaime-weise') })
      return
    }
    try {
      await (await viewer()).open(segments)
    } catch (error) {
      const reason = String((error as Error)?.message ?? error)
      EffectBus.emit('activity:log', { message: words('revisions.failed', 'The revision viewer did not open ({reason})', { reason }), icon: '!' })
    }
  }
}

const _revisions = new RevisionsQueenBee()
window.ioc.register('@diamondcoreprocessor.com/RevisionsQueenBee', _revisions)
