// diamondcoreprocessor.com/presentation/tiles/home-widgets.ts
//
// Widget renderers for the home view. A child tile of a home cell that
// carries a `visual:home:widget` decoration renders through this registry
// instead of as a plain doorway card — the tile IS the widget; the
// decoration payload picks the renderer (`payload.type`) and carries its
// configuration. Tiles are pieces of a flexible design: the same tile
// renders as a doorway, a widget, a gallery — whatever behavior it wears.
//
// The registry is IoC-exposed so any module can contribute widget types
// (a gallery, a feed, a clock…) without touching this file:
//
//   window.ioc.get('@diamondcoreprocessor.com/HomeWidgetRegistry')
//     .register('gallery', (host, context) => { ... })

import { EffectBus } from '@hypercomb/core'
import { childNamesOf } from '../../history/layer-placement.js'

export const HOME_WIDGET_KIND = 'visual:home:widget'

/** The lineage where collections (reference sets) live — each set is its own
 *  root; the `sets` page is just the index of them (root-hop convention). */
const SETS_SEGMENTS: readonly string[] = ['sets']

export type HomeWidgetContext = {
  /** The widget tile's own segments (home segments + tile name). */
  readonly segments: readonly string[]
  /** The widget tile's name. */
  readonly label: string
  /** The decoration payload ({ type, ...config }). */
  readonly payload: Record<string, unknown>
  /** Leave the home view (back to hexagons) without navigating. */
  exit(): void
  /** Leave the home view and travel to a lineage. */
  navigate(segments: readonly string[]): void
  /** Re-render the home view (after the widget changed data). */
  refresh(): void
  /** Translate an app-catalog key, with a literal fallback. */
  t(key: string, fallback: string, params?: Record<string, string | number>): string
}

/** Renders into `host`; may return a cleanup function (called on unmount). */
export type HomeWidgetRenderer = (host: HTMLElement, context: HomeWidgetContext) => void | (() => void)

const renderers = new Map<string, HomeWidgetRenderer>()

export function registerHomeWidget(type: string, renderer: HomeWidgetRenderer): void {
  const cleaned = String(type ?? '').trim()
  if (cleaned) renderers.set(cleaned, renderer)
}

export function homeWidgetRenderer(type: string): HomeWidgetRenderer | undefined {
  return renderers.get(String(type ?? '').trim())
}

export function homeWidgetTypes(): readonly string[] {
  return [...renderers.keys()]
}

// Community-extensible surface.
window.ioc.register('@diamondcoreprocessor.com/HomeWidgetRegistry', {
  register: registerHomeWidget,
  get: homeWidgetRenderer,
  types: homeWidgetTypes,
})

// ── shared look — steel on ink, the chrome palette, nothing flashy ─────────

export const HOME_INK = '#0c1118'
export const HOME_TEXT = '#d8e6ee'
export const HOME_DIM = 'rgba(216,230,238,0.55)'
export const HOME_STEEL = 'rgb(126,182,214)'
export const HOME_CARD_BG = 'rgba(126,182,214,0.06)'
export const HOME_CARD_BORDER = '1px solid rgba(126,182,214,0.18)'

type HistoryShape = {
  sign(l: { explorerSegments?: () => readonly string[] }): Promise<string>
  currentLayerAt(sig: string): Promise<Record<string, unknown> | null>
  getLayerBySig(sig: string): Promise<Record<string, unknown> | null>
  commitLayer(locationSig: string, layer: Record<string, unknown>): Promise<string>
}

const history = (): HistoryShape | undefined =>
  window.ioc?.get<HistoryShape>('@diamondcoreprocessor.com/HistoryService')

const element = (tag: string, css: string, text?: string): HTMLElement => {
  const node = document.createElement(tag)
  node.style.cssText = css
  if (text !== undefined) node.textContent = text
  return node
}

const BACKSLASH = String.fromCharCode(92)

/** Names become path segments — drop separators and control characters
 *  (mirrors the UNSAFE_CELL_NAME guard in layer-placement.ts). */
const safeCellName = (raw: string): string =>
  [...raw].filter(ch => ch !== '/' && ch !== BACKSLASH && ch.charCodeAt(0) > 31).join('').trim()

// ── welcome — a time-of-day greeting card ──────────────────────────────────

registerHomeWidget('welcome', (host, context) => {
  const hour = new Date().getHours()
  const part = hour < 5 ? 'night' : hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening'
  const fallbacks: Record<string, string> = {
    night: 'Up late', morning: 'Good morning', afternoon: 'Good afternoon', evening: 'Good evening',
  }
  host.appendChild(element('div',
    `font-size:22px;font-weight:600;color:${HOME_TEXT};margin-bottom:8px;`,
    context.t(`home.greeting.${part}`, fallbacks[part])))
  host.appendChild(element('div',
    `font-size:14px;line-height:1.6;color:${HOME_DIM};`,
    context.t('home.widget.welcome.body', 'Take a breath — everything here is yours to shape.')))
})

// ── collections — your reference sets, and a place to start a new one ──────

registerHomeWidget('collections', (host, context) => {
  let disposed = false

  const render = async (): Promise<void> => {
    const h = history()
    let names: string[] = []
    if (h) {
      try {
        const locationSig = await h.sign({ explorerSegments: () => [...SETS_SEGMENTS] })
        const layer = await h.currentLayerAt(locationSig)
        names = await childNamesOf(h, layer as Parameters<typeof childNamesOf>[1])
      } catch { /* cold read — render as empty */ }
    }
    if (disposed) return

    host.textContent = ''
    host.appendChild(element('div',
      `font-size:16px;font-weight:600;color:${HOME_TEXT};margin-bottom:10px;`,
      context.t('home.widget.collections.title', 'Collections')))

    if (names.length === 0) {
      host.appendChild(element('div',
        `font-size:13px;line-height:1.6;color:${HOME_DIM};margin-bottom:12px;`,
        context.t('home.widget.collections.empty', 'No collections yet — name one below and start gathering.')))
    } else {
      const chips = element('div', 'display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px;')
      for (const name of names) {
        const chip = element('button',
          `all:unset;cursor:pointer;padding:6px 14px;border-radius:16px;font-size:13px;` +
          `color:${HOME_TEXT};background:${HOME_CARD_BG};border:${HOME_CARD_BORDER};`, name)
        chip.addEventListener('click', () => context.navigate([name]))
        chip.addEventListener('mouseenter', () => { chip.style.borderColor = 'rgba(126,182,214,0.45)' })
        chip.addEventListener('mouseleave', () => { chip.style.borderColor = 'rgba(126,182,214,0.18)' })
        chips.appendChild(chip)
      }
      host.appendChild(chips)
    }

    const row = element('div', 'display:flex;gap:8px;align-items:center;')
    const input = element('input',
      `flex:1;min-width:0;padding:8px 12px;border-radius:6px;font-size:13px;outline:none;` +
      `color:${HOME_TEXT};background:rgba(12,17,24,0.6);border:${HOME_CARD_BORDER};`) as HTMLInputElement
    input.placeholder = context.t('home.widget.collections.placeholder', 'name a new collection…')
    const button = element('button',
      `all:unset;cursor:pointer;padding:8px 16px;border-radius:6px;font-size:13px;font-weight:600;` +
      `color:${HOME_INK};background:${HOME_STEEL};`,
      context.t('home.widget.collections.create', 'Create'))

    const create = (): void => {
      const name = safeCellName(input.value)
      if (!name) return
      if (!names.includes(name)) {
        // Smallest correct create primitive: LayerCommitter appends the child
        // into the sets index. The set itself is a ROOT lineage (root-hop
        // convention) and self-mints on first visit.
        EffectBus.emit('cell:added', { cell: name, segments: [...SETS_SEGMENTS] })
      }
      context.navigate([name])
    }
    button.addEventListener('click', create)
    input.addEventListener('keydown', e => { if (e.key === 'Enter') create() })
    row.appendChild(input)
    row.appendChild(button)
    host.appendChild(row)

    host.appendChild(element('div',
      `font-size:12px;line-height:1.5;color:${HOME_DIM};margin-top:10px;`,
      context.t('home.widget.collections.hint',
        'Collections are pools of reference material — gather things once, employ them anywhere.')))
  }

  void render()
  return () => { disposed = true }
})

// ── portal — a doorway pinned to any place ──────────────────────────────────

registerHomeWidget('portal', (host, context) => {
  const raw = context.payload['segments']
  const target = Array.isArray(raw) ? raw.map(s => String(s)) : [...context.segments]
  const label = typeof context.payload['label'] === 'string' && context.payload['label']
    ? String(context.payload['label'])
    : (target.length ? target[target.length - 1] : context.t('home.portal.hive', 'the hive'))

  const button = element('button',
    'all:unset;cursor:pointer;display:block;width:100%;box-sizing:border-box;')
  button.appendChild(element('div',
    `font-size:16px;font-weight:600;color:${HOME_TEXT};margin-bottom:6px;`, label))
  button.appendChild(element('div',
    `font-size:12px;color:${HOME_DIM};`,
    '/' + target.join('/')))
  button.addEventListener('click', () => context.navigate(target))
  host.appendChild(button)
})
