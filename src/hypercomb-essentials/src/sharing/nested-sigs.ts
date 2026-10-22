// sharing/nested-sigs.ts
//
// Every signature a parsed JSON value names — the one walk that finds a
// record's references (a layer's children, a note's envelopes, a category
// tree's notes) so its closure can be fetched or handed on.

const SIG = /^[0-9a-f]{64}$/

/** Every 64-hex string anywhere in a parsed JSON value. */
export function nestedSigs(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') { const v = value.toLowerCase(); if (SIG.test(v)) out.push(v) }
  else if (Array.isArray(value)) for (const v of value) nestedSigs(v, out)
  else if (value && typeof value === 'object') for (const v of Object.values(value)) nestedSigs(v, out)
  return out
}
