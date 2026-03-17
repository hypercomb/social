// hypercomb-shared/core/secret-strength.ts
// Pluggable secret strength evaluation — provider pattern via IoC.
// Any module can register a replacement at the same key.

export interface SecretStrengthProvider {
  evaluate(secret: string): number // 0.0 – 1.0
}

class DefaultSecretStrength implements SecretStrengthProvider {
  evaluate(secret: string): number {
    if (!secret) return 0

    // base score from length
    const len = secret.length
    let score: number
    if (len < 4) score = 0.1
    else if (len < 8) score = 0.3
    else if (len < 12) score = 0.5
    else score = 0.7

    // bonuses for character variety
    if (/[a-z]/.test(secret) && /[A-Z]/.test(secret)) score += 0.1
    if (/\d/.test(secret)) score += 0.1
    if (/[^a-zA-Z0-9]/.test(secret)) score += 0.1

    return Math.min(score, 1)
  }
}

register('@hypercomb.social/SecretStrengthProvider', new DefaultSecretStrength())
