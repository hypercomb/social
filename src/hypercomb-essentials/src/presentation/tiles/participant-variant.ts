// A participant stack variant is a complete visual/property projection, not
// an image choice. This pure adapter keeps show-cell's peer path aligned with
// the same fields its local properties path reads.

const SIG_RE = /^[0-9a-f]{64}$/i
const COLOR_RE = /^#?[0-9a-f]{6}$/i

export type ParticipantVariantVisual = {
  readonly imageSig?: string
  readonly borderColor?: [number, number, number]
  readonly tags: readonly string[]
  readonly hasLink: boolean
  readonly hasSubstrate: boolean
  readonly hideText: boolean
}

const nestedImage = (value: unknown): string | undefined => {
  const image = (value as Record<string, unknown> | undefined)?.['image']
  return typeof image === 'string' && SIG_RE.test(image) ? image.toLowerCase() : undefined
}

const borderRgb = (value: unknown): [number, number, number] | undefined => {
  const raw = (value as Record<string, unknown> | undefined)?.['color']
  if (typeof raw !== 'string' || !COLOR_RE.test(raw)) return undefined
  const hex = raw.startsWith('#') ? raw.slice(1) : raw
  return [
    parseInt(hex.slice(0, 2), 16) / 255,
    parseInt(hex.slice(2, 4), 16) / 255,
    parseInt(hex.slice(4, 6), 16) / 255,
  ]
}

/** Project the selected participant's admitted properties into the concrete
 * fields the hex renderer consumes. No field falls back to local state: doing
 * so would manufacture a hybrid variant that no participant published. */
export const participantVariantVisual = (
  properties: Readonly<Record<string, unknown>> | undefined,
  flat: boolean,
): ParticipantVariantVisual => {
  const props = properties ?? {}
  const flatBag = props['flat'] as Record<string, unknown> | undefined
  const direct = typeof props['imageSig'] === 'string' && SIG_RE.test(props['imageSig'])
    ? props['imageSig'].toLowerCase()
    : undefined
  const imageSig = (flat ? nestedImage(flatBag?.['small']) : undefined)
    ?? nestedImage(props['small'])
    ?? nestedImage(props['point'])
    ?? direct
  const tags = Array.isArray(props['tags'])
    ? props['tags'].filter((tag): tag is string => typeof tag === 'string')
    : []
  const borderColor = borderRgb(props['border'])
  return {
    ...(imageSig ? { imageSig } : {}),
    ...(borderColor ? { borderColor } : {}),
    tags,
    hasLink: typeof props['link'] === 'string' && props['link'].length > 0,
    hasSubstrate: props['substrate'] === true,
    hideText: props['hideText'] === true,
  }
}
