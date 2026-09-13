// assistant/providers/key-owner.ts
//
// WHOSE KEY IS THIS? An OpenRouter key saved on the DeepSeek row returns 401
// on every call with nothing on screen saying why — it happened (2026-09-13).
// When a pasted key does not match the row's own format but does match
// another provider's, it belongs to that provider. Pure, so the console's
// Save button and a spec ask the same question.

import type { LlmProviderDescriptor } from './llm-provider.types.js'

type Keyed = Pick<LlmProviderDescriptor, 'id' | 'label' | 'keyPattern'>

/** The provider this key really belongs to, or undefined when it fits this
 *  row, fits nobody's format, or this row declares no format at all. */
export const keyBelongsElsewhere = <P extends Keyed>(
  value: string,
  row: Keyed,
  providers: readonly P[],
): P | undefined => {
  const key = String(value ?? '').trim()
  if (!key || !row.keyPattern || row.keyPattern.test(key)) return undefined
  return providers.find(other => other.id !== row.id && !!other.keyPattern?.test(key))
}
