// assistant/chat-layer-face.ts
//
// What the chat header can say about the layer it is standing on: the views
// that layer carries, and the behaviors bound there. The window asks for it
// through IoC and draws nothing when this module has not loaded.

import { hasDecorationKindAt, defaultViewForSegments, HEXAGONS_SURFACE } from '../commands/decoration-kind-index.js'
import { allBindings } from '../sharing/behavior-enablement.js'

export const CHAT_LAYER_FACE = '@hypercomb.social/ChatLayerFace'

export interface LayerFace {
  readonly views: readonly string[]
  readonly behaviors: readonly string[]
}

type FaceBee = {
  readonly view?: string
  readonly behavior?: string
  readonly decorationKind?: string
  readonly alsoKinds?: readonly string[]
  readonly legacyKinds?: readonly string[]
}

type FaceRegistry = { all?: () => readonly FaceBee[] }

/** Views and behaviors for a path, from lists the caller already resolved. */
export const faceOf = (
  views: readonly string[],
  bindings: Readonly<Record<string, readonly { path: string }[]>>,
  segments: readonly string[],
): LayerFace => {
  const here = `/${segments.map(segment => String(segment ?? '').trim()).filter(Boolean).join('/')}`
  const covers = (bound: string): boolean =>
    bound === here || (bound !== '/' && here.startsWith(`${bound}/`))
  const behaviors = Object.entries(bindings)
    .filter(([, list]) => list.some(binding => covers(binding.path)))
    .map(([kind]) => kind)
    .sort()
  return {
    views: [...new Set(views.map(view => view.trim()).filter(Boolean))].sort(),
    behaviors,
  }
}

const kindsOf = (bee: FaceBee): string[] =>
  [bee.decorationKind, ...(bee.alsoKinds ?? []), ...(bee.legacyKinds ?? [])].filter((kind): kind is string => !!kind)

/** The layer the chat is standing on. A view opens with its own door. */
export const layerFace = (segments: readonly string[]): LayerFace => {
  const holder = globalThis as { window?: { ioc?: { get?: <T>(key: string) => T | undefined } } }
  const registry = holder.window?.ioc?.get?.<FaceRegistry>('@diamondcoreprocessor.com/VisualBeeRegistry')
  const views = (registry?.all?.() ?? [])
    .filter(bee => bee.behavior !== 'navigation' && bee.view && kindsOf(bee).some(kind => hasDecorationKindAt(segments, kind)))
    .map(bee => bee.view as string)
  const marked = defaultViewForSegments(segments)
  if (marked && marked !== HEXAGONS_SURFACE && !views.includes(marked)) views.unshift(marked)
  return faceOf(views, allBindings(), segments)
}

/** The service the chat window asks through IoC. A dependency never registers
 *  itself — the chat queen (the bee) wires it. */
export const chatLayerFace = { of: layerFace }
