// keys.mjs — a TEST-ONLY signer, node:crypto and nothing else.
//
// It stands in for the real identity (`hypercomb-essentials/src/sharing/
// nostr-signer.ts`, secp256k1/schnorr via nostr-tools) and it is deliberately a
// DIFFERENT curve, because that is the point of the injection seam: core's
// `acceptHeadClaim` defines the preimage and the acceptance order and takes the
// asymmetric primitive as an argument. If the same acceptance rules hold under
// ed25519 here and under schnorr in the app, the rules do not depend on the
// curve — the placement authentication does not live in the crypto.
//
// SHAPES MATCH THE REAL THING ON PURPOSE:
//   public key  32 bytes -> 64 lowercase hex  (the bucket DIRECTORY name;
//               `classifyDirectoryEntry` in hypercomb-core/src/core/
//               directory-safety.ts already calls a 64-hex directory a bucket)
//   signature   64 bytes -> 128 lowercase hex
//
// Verification here is SYNCHRONOUS because node's ed25519 verify is. Core's
// acceptor is async because WebCrypto and a NIP-07 extension are; the prototype
// mirror in head-claim.mjs is sync for the same reason. Nothing else differs.

import { createPublicKey, generateKeyPairSync, sign as nodeSign, verify as nodeVerify } from 'node:crypto'

const HEX64 = /^[0-9a-f]{64}$/

const publicKeyFromHex = (pubkeyHex) =>
  createPublicKey({
    key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(pubkeyHex, 'hex').toString('base64url') },
    format: 'jwk',
  })

/**
 * Mint an identity. `pubkey` is the bucket address AND the verifying key —
 * never `sign(pubkey)`, because hashing the address would sever it from the
 * thing that authenticates it and force the reader back to a field in the
 * bytes, which is the defect restated one level down.
 */
export const mintKeys = () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const pubkey = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url').toString('hex')
  return {
    pubkey,
    /** Sign an exact preimage STRING. There is no raw-bytes door and no
     *  pass-through: an object that already carries a signature can never be
     *  handed back unsigned (nostr-signer.ts:57 has exactly that trap). */
    sign: (preimage) =>
      nodeSign(null, Buffer.from(String(preimage), 'utf8'), privateKey).toString('hex'),
  }
}

/**
 * THE INJECTED VERIFIER, ed25519 flavour. Same contract as core's
 * `HeadClaimVerifier`: true ONLY if `pubkeyHex` signed EXACTLY `preimage`
 * producing `sigHex`. It never parses the preimage and never reads an identity
 * out of the signature envelope.
 */
export const verifyEd25519 = (pubkeyHex, preimage, sigHex) => {
  if (!HEX64.test(String(pubkeyHex ?? ''))) return false
  if (!/^[0-9a-f]{128}$/.test(String(sigHex ?? ''))) return false
  try {
    return nodeVerify(
      null,
      Buffer.from(String(preimage), 'utf8'),
      publicKeyFromHex(pubkeyHex),
      Buffer.from(sigHex, 'hex'),
    )
  } catch {
    return false
  }
}
