// hypercomb-web/src/app/core/layer-install.types.ts

export type LayerInstallFile = {
  signature: string
  name?: string
  children?: string[]
  bees?: string[]
}

export type LayerInstallContext = {
  domain: string
  location: string | null
  signature: string
  domainLayersDir: FileSystemDirectoryHandle
}

export interface LayerInstallSource {
  id: string
  canResolve: (ctx: LayerInstallContext) => boolean | Promise<boolean>
  resolve: (ctx: LayerInstallContext) => Promise<LayerInstallFile | null>
}
