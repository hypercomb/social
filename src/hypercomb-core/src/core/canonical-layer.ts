// One byte form for every layer writer, including the cold host shell.
export type CanonicalLayerContent = {
  name: string
  children?: string[]
  [slot: string]: unknown
}

export const canonicalizeLayer = <T extends CanonicalLayerContent>(layer: T): T => {
  const out = { name: layer.name } as T
  for (const key of Object.keys(layer).filter(key => key !== 'name').sort()) {
    const value = layer[key]
    if (value === undefined || value === null) continue
    if (Array.isArray(value) && value.length === 0) continue
    if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value as object).length === 0) continue
    ;(out as CanonicalLayerContent)[key] = value
  }
  return out
}

export const canonicalLayerJson = (layer: CanonicalLayerContent): string =>
  JSON.stringify(canonicalizeLayer(layer))
