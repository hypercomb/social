// src/app/core/resolve-import-map.ts

import { loadOpfsDependencies } from './dependency-loader'

export const resolveImportMap = async (): Promise<Record<string, string>> => {
  const deps = await loadOpfsDependencies()
  const imports: Record<string, string> = {}

  // hardcoded test binding
  const bindings: Record<string, string> = {
    '@essentials/pixi': 'dd0ae992a13acd6913bb742a2f3f576c6ff6885d33b5579d87fc5937d933eb84',
    '@essentials/hello': '8479fff6262d2f3c9e719748a224433df3ccd35fdc56231ef356aa68e32ffa48'
  }

  for (const [alias, sig] of Object.entries(bindings)) {
    const url = deps[sig]
    if (!url) {
      throw new Error(`missing dependency in OPFS: ${alias} (${sig})`)
    }
    imports[alias] = url
  }

  return imports
}
