// Icon decoration primitive.
//
// Any node (category, op-kind, drone, tile, menu entry, …) can be
// decorated with an IconRef so a consumer knows how to render it as a
// visual glyph. The ref resolves to an SVG path `d` attribute — either
// inline, or looked up via a content-addressed resource signature.
//
// Both forms go through the same resolver so callers don't care which
// one they got. Signature-backed refs are warmed by the same preloader
// that hydrates layer resources, so by the time a consumer renders the
// decorated node the resource is already present in OPFS.

export type IconPathRef = { readonly kind: 'path'; readonly path: string }
export type IconSignatureRef = { readonly kind: 'signature'; readonly signature: string }

export type IconRef = IconPathRef | IconSignatureRef

export const IconRef = {
  path(path: string): IconPathRef {
    return { kind: 'path', path }
  },
  signature(signature: string): IconSignatureRef {
    return { kind: 'signature', signature }
  },
  isPath(ref: IconRef): ref is IconPathRef {
    return ref.kind === 'path'
  },
  isSignature(ref: IconRef): ref is IconSignatureRef {
    return ref.kind === 'signature'
  },
}
