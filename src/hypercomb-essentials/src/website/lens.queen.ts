// website/lens.queen.ts
//
// `lens` — a website tile, piece by piece: each piece's page in a binding
// syntax a person reads at a glance, beside that piece drawn alone.
//
//   lens                  the tile you stand on
//   lens /cafe-society    that tile (a route from the hive root with '/', else from where you stand)
//   lens brood            a panel the code draws, by its name in the shell (<hc-brood>)
//
// One way: the lens reads and never writes (lens.view.ts). The bee half of the
// feature: this file defines the element, adds it to the ShellSurfaceRegistry
// and opens it. The view is loaded only when asked for.

import { EffectBus, I18N_IOC_KEY, QueenBee, type I18nProvider } from '@hypercomb/core'

const SURFACE = 'hc-lens'
const OWNER = '@diamondcoreprocessor.com/Lens'
const REGISTRY_KEY = '@hypercomb.social/ShellSurfaceRegistry'
const LINEAGE_KEY = '@hypercomb.social/Lineage'

type RegistryLike = {
  add(surface: { name: string; owner?: string; element?: string; order?: number }): void
  all?: () => readonly { name?: string }[]
}
type Opener = HTMLElement & { open(segments: readonly string[]): Promise<void>; openPanel(name: string): Promise<void> }
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
const routeOf = (here: readonly string[], typed: string): string[] => {
  const parts = typed.split('/').map(s => s.trim()).filter(Boolean)
  return typed.trim().startsWith('/') ? parts : [...here, ...parts]
}

/** The panel a word names (`brood` is `<hc-brood>`), when the shell has one; else null and the word is a route. */
const panelNamed = (typed: string): string | null => {
  const word = typed.trim().toLowerCase().replace(/^<|>$/g, '')
  if (!word || word.includes('/') || /\s/.test(word)) return null
  const tag = word.includes('-') ? word : `hc-${word}`
  if (document.querySelector(tag)) return tag
  const registry = ioc()?.get?.<RegistryLike>(REGISTRY_KEY)
  return registry?.all?.().some(surface => surface?.name === tag) ? tag : null
}

/** Load the view, define its tag, put it in the shell once, and hand back the mounted element. */
async function lens(): Promise<Opener> {
  const { LensElement } = await import('./lens.view.js')
  if (!customElements.get(SURFACE)) customElements.define(SURFACE, LensElement)
  ioc()?.whenReady?.<RegistryLike>(REGISTRY_KEY, registry => {
    if (registry.all?.().some(surface => surface?.name === SURFACE)) return
    try { registry.add({ name: SURFACE, owner: OWNER, element: SURFACE, order: 262 }) } catch { /* hot reload */ }
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

export class LensQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'lens'
  // A route is an identifier, not words: handed over exactly as typed.
  override rawArgs = true
  override description = "See a website tile piece by piece, or a panel as the template its code draws"
  override examples = [
    { input: 'lens', result: "The tile's page in a binding syntax, beside it drawn alone, then the same for every tile filling its traits" },
    { input: 'lens /cafe-society', result: 'cafe-society and each of its parts, one card per piece' },
    { input: 'lens brood', result: 'The brood panel drawn again while watched, said as a template beside a copy of it' },
  ]

  // NOT OFFERED TO A MODEL: it only opens a panel for a person to read.

  protected async execute(args: string): Promise<void> {
    const lineage = ioc()?.get?.<{ explorerSegments?: () => readonly string[] }>(LINEAGE_KEY)
    const here = [...(lineage?.explorerSegments?.() ?? [])].map(String)
    const panel = panelNamed(args)
    if (panel) {
      try {
        await (await lens()).openPanel(panel)
      } catch (error) {
        const reason = String((error as Error)?.message ?? error)
        EffectBus.emit('activity:log', { message: words('lens.failed', 'The lens did not open ({reason})', { reason }), icon: '!' })
      }
      return
    }
    const segments = args.trim() ? routeOf(here, args) : here
    if (segments.length === 0) {
      EffectBus.emit('toast:show', { type: 'tip', message: words('lens.stand-on', 'Stand on a website tile, or name one: lens /cafe-society') })
      return
    }
    try {
      await (await lens()).open(segments)
    } catch (error) {
      const reason = String((error as Error)?.message ?? error)
      EffectBus.emit('activity:log', { message: words('lens.failed', 'The lens did not open ({reason})', { reason }), icon: '!' })
    }
  }
}

const _lens = new LensQueenBee()
window.ioc.register('@diamondcoreprocessor.com/LensQueenBee', _lens)
