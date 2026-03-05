// hypercomb-essentials/src/diamondcoreprocessor.com/editor/tile-properties.ts

export const PROPERTIES_FILE = '0000'

export const isSignature = (value: unknown): boolean =>
  typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
