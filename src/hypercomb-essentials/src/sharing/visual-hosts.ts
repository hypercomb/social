/** The largest atom one participant serves, or assembles, over the mesh — a
 * content-broker answer (chunked, sha256-gated). Beyond it only an HTTP host
 * carries the bytes, so a tile no host keeps (the live swarm) whose own atom
 * is larger stays a name (swarm.drone #liveHold). One number, read by both. */
export const MESH_ANSWER_MAX_BYTES = 8 * 1024 * 1024

/** The artifact signatures an already-sanitized visual refers to: its layer
 * and every image variant the sanitizer admits. Discovery, not a fetch —
 * bytes still resolve on demand, and sha256 still gates every one. */
export const visualArtifactSigs = (
  visuals: readonly Record<string, unknown>[],
): string[] => {
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
  return [...refs]
}

/** Attribute only artifact references from an already-sanitized visual.
 * This is discovery, not a fetch: image bytes still resolve on demand. */
export const noteVisualHosts = (
  visuals: readonly Record<string, unknown>[],
  domains: string[],
  note: (sig: string, domains: string[]) => void,
): void => {
  if (!domains.length) return
  for (const sig of visualArtifactSigs(visuals)) note(sig, domains)
}
