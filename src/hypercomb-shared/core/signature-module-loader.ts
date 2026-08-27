export type ModuleImporter = (url: string) => Promise<unknown>

const SIGNATURE = /^[a-f0-9]{64}$/i

/** Absolute URL for a content-addressed ESM file inside an OPFS pool. */
export const signatureModuleUrl = (poolSignature: string, contentSignature: string): string => {
  if (!SIGNATURE.test(poolSignature)) throw new Error(`invalid pool signature: ${poolSignature}`)
  if (!SIGNATURE.test(contentSignature)) throw new Error(`invalid content signature: ${contentSignature}`)
  return `/opfs/${poolSignature.toLowerCase()}/${contentSignature.toLowerCase()}`
}

const browserImport: ModuleImporter = url => import(/* @vite-ignore */ url)

/** Import immutable module bytes by signature; aliases never enter execution. */
export const importSignatureModule = (
  poolSignature: string,
  contentSignature: string,
  importer: ModuleImporter = browserImport,
): Promise<unknown> => importer(signatureModuleUrl(poolSignature, contentSignature))
