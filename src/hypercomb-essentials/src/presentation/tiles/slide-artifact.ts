// presentation/tiles/slide-artifact.ts
//
// THE SLIDE ARTIFACT — one atomic thing that says "I am a screen", and nothing
// else.
//
// What used to live here — the relation, the site artifact, the hive walk, the
// ordering — moved to pheromones/enrollment.ts, because none of it is about
// slides. Any artifact can enrol in any other: a website, a slide, a photo, a
// page. A set has no member TYPE, so the model that expresses one cannot live
// inside any single type.
//
// What remains is genuinely slide-shaped: the kind, and the Life Primitive hop
// to the bytes.
//
//     decoration -> payload.content -> { meta:1, resource:<bytes>, relation:'slide' } -> bytes
//
// `content` is a declared EDGE field (core/edge-registry.ts), so every precise
// closure walker carries the envelope, and `nestedResourceSigs` carries the
// bytes behind it — sharing and adoption work with no per-feature hop.
// `resolveLocalResourceReference` is the read side and already follows the
// alternation. The retired `payload.contentSig` — a raw sig, an untyped hop —
// is read-only: nothing mints it any more.
//
// A slide knows nothing about any presentation it appears in. Its position is
// an attribute of its MEMBERSHIP and rides that mark, which is what lets one
// slide sit in three presentations at three different places. See
// documentation/website-artifact-paradigm.md.

import {
  contentEnvelope,
  contentRefOf,
  terminalContentSig,
  type MintStore,
} from './artifact-content.js'

/** Re-exported so a reader that holds a slide can follow its hop without
 *  knowing where the rule lives. The rule itself is not slide-shaped. */
export { terminalContentSig }

/** A tile carrying this IS a slide. It is not "a slide OF" anything. */
export const SLIDE_KIND = 'visual:diagram:slide'

/** RETIRED. The parent-container kind: a cell wore it and its CHILDREN were the
 *  slides. Read-only — existing decks still play, nothing writes it again. */
export const LEGACY_DECK_KIND = 'visual:diagram:deck'

/** The slot a slide's incidence is held in. Distinct from a picture's, so the
 *  same bytes used both ways mint two envelopes rather than colliding. */
export const SLIDE_RELATION = 'slide'

export type SlidePayload = {
  /** Life Primitive content hop — the signature of a meta envelope whose
   *  `resource` payload is the slide's bytes. Canonical. */
  readonly content?: string
  /** RETIRED raw-resource hop. Read-only compatibility. */
  readonly contentSig?: string
  readonly title?: string
  readonly caption?: string
  /** RETIRED. Position now rides the membership mark, where it belongs: a slide
   *  carrying its own order could only ever be in ONE presentation. Read as a
   *  fallback so container-model decks keep their sequence; never written. */
  readonly order?: number
}

/** The typed incidence around a slide's bytes. */
export const slideContentEnvelope = (bytesSig: string): Record<string, unknown> =>
  contentEnvelope(bytesSig, SLIDE_RELATION)

/** Store the incidence and return ITS signature — what `payload.content` holds. */
export async function mintSlideContent(store: MintStore, bytesSig: string): Promise<string> {
  const envelope = slideContentEnvelope(bytesSig)
  return await store.putResource(new Blob([JSON.stringify(envelope)], { type: 'application/json' }))
}

/** The hop a slide payload declares, canonical first. */
export const slideContentRef = (payload: SlidePayload | null): string | null =>
  contentRefOf(payload as Record<string, unknown> | null)

/** A slide's retired per-member position, for the ordering fallback. */
export const legacySlideOrder = (payload: SlidePayload | null): number | undefined =>
  typeof payload?.order === 'number' && Number.isFinite(payload.order) ? payload.order : undefined
