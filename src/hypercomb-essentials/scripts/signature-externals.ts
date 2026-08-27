import type { Plugin } from 'esbuild'

const SIGNATURE = /^[a-f0-9]{64}$/i

export type SignatureExternalMap = Readonly<Record<string, string>>

export const signatureModuleUrl = (poolSignature: string, contentSignature: string): string => {
  if (!SIGNATURE.test(poolSignature) || !SIGNATURE.test(contentSignature)) {
    throw new Error('signature module URLs require 64-hex pool and content signatures')
  }
  return `/opfs/${poolSignature.toLowerCase()}/${contentSignature.toLowerCase()}`
}

/**
 * Resolve selected bare platform specifiers to immutable OPFS module URLs at
 * bundle time. The emitted module graph therefore carries its executable
 * addresses in its own signed bytes and needs no browser import map.
 */
export const signatureExternalPlugin = (
  poolSignature: string,
  signatures: SignatureExternalMap,
): Plugin => ({
  name: 'hypercomb-signature-externals',
  setup(build) {
    build.onResolve({ filter: /.*/ }, args => {
      const signature = signatures[args.path]
      if (!signature) return null
      return {
        path: signatureModuleUrl(poolSignature, signature),
        external: true,
      }
    })
  },
})
