// secret-strength.ts — pluggable secret strength evaluation. The interface
// lives in core (mesh-zone.types.ts); any module can register a replacement
// at the same key.
//
// Moved down from hypercomb-shared in the everything-is-a-beehavior Phase 1.

import { SECRET_STRENGTH_KEY, type SecretStrengthProvider } from '@hypercomb/core'

class DefaultSecretStrength implements SecretStrengthProvider {
  evaluate(secret: string): number {
    if (!secret) return 0

    // base score from length — stays red until well past 8 chars
    const len = secret.length
    let score: number
    if (len < 6) score = 0.05
    else if (len < 9) score = 0.15
    else if (len < 12) score = 0.35
    else if (len < 16) score = 0.55
    else score = 0.7

    // bonuses for character variety
    if (/[a-z]/.test(secret) && /[A-Z]/.test(secret)) score += 0.1
    if (/\d/.test(secret)) score += 0.1
    if (/[^a-zA-Z0-9]/.test(secret)) score += 0.1

    return Math.min(score, 1)
  }
}

export const defaultSecretStrength = new DefaultSecretStrength()

/** Re-assert into the LIVE IoC map — but never over a replacement a module
 *  registered at the same key. */
export const ensureSecretStrengthRegistered = (): void => {
  if (!window.ioc?.has?.(SECRET_STRENGTH_KEY)) {
    window.ioc?.register?.(SECRET_STRENGTH_KEY, defaultSecretStrength)
  }
}
ensureSecretStrengthRegistered()
