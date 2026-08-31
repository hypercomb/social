import { SignatureService } from '@hypercomb/core'

export const SIGNATURE_PATTERN = /^[a-f0-9]{64}$/

export type SealedInstallPackage = {
  version?: number
  layers: string[]
  bees: string[]
  dependencies: string[]
  beeDeps?: Record<string, string[]>
  label?: string
  at?: string
  previous?: string | null
}

export type SealedPackageValidation = {
  valid: boolean
  errors: string[]
}

/**
 * Validate the closed, signature-addressed boundary an installer is allowed
 * to hydrate. Package identity is the root layer signature, so that root must
 * itself be present in the declared layer set. Nothing outside these sets is
 * an install candidate.
 */
export const validateSealedPackage = (
  packageSignature: string,
  pkg: SealedInstallPackage,
): SealedPackageValidation => {
  const errors: string[] = []
  const layers = new Set(pkg.layers ?? [])
  const bees = new Set(pkg.bees ?? [])
  const dependencies = new Set(pkg.dependencies ?? [])

  if (!SIGNATURE_PATTERN.test(packageSignature)) errors.push('package signature is not a lowercase SHA-256 signature')
  if (!layers.has(packageSignature)) errors.push('package root signature is not declared in layers')

  const checkSet = (kind: string, values: string[]): void => {
    const seen = new Set<string>()
    for (const signature of values) {
      if (!SIGNATURE_PATTERN.test(signature)) errors.push(`${kind} contains an invalid signature: ${signature}`)
      if (seen.has(signature)) errors.push(`${kind} contains a duplicate signature: ${signature}`)
      seen.add(signature)
    }
  }

  checkSet('layers', pkg.layers ?? [])
  checkSet('bees', pkg.bees ?? [])
  checkSet('dependencies', pkg.dependencies ?? [])

  for (const [bee, required] of Object.entries(pkg.beeDeps ?? {})) {
    if (!bees.has(bee)) errors.push(`beeDeps names an undeclared bee: ${bee}`)
    for (const dependency of required) {
      if (!dependencies.has(dependency)) errors.push(`bee ${bee} requires undeclared dependency: ${dependency}`)
    }
  }

  return { valid: errors.length === 0, errors }
}

/** Verify host bytes before they cross into the local signature heap. */
export const bytesMatchSignature = async (
  bytes: Uint8Array<ArrayBuffer>,
  expected: string,
): Promise<boolean> => (await SignatureService.sign(bytes.buffer)) === expected
