/** Attribute only artifact references from an already-sanitized visual.
 * This is discovery, not a fetch: image bytes still resolve on demand. */
export const noteVisualHosts = (
  visuals: readonly Record<string, unknown>[],
  domains: string[],
  note: (sig: string, domains: string[]) => void,
): void => {
  const refs = new Set<string>()
  const add = (value: unknown): void => {
    if (typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)) refs.add(value)
  }
  const image = (value: unknown): void => {
    if (value && typeof value === 'object') add((value as Record<string, unknown>)['image'])
  }
  for (const visual of visuals) {
    add(visual['layerSig'])
    add(visual['imageSig'])
    image(visual['small'])
    image(visual['large'])
    image(visual['point'])
    const flat = visual['flat'] as Record<string, unknown> | undefined
    image(flat?.['small'])
    image(flat?.['large'])
  }
  if (domains.length) for (const sig of refs) note(sig, domains)
}
