// src/dependencies.ts

export type HostedDependency = {
  name: string
  entry: string
  alias: string
}

export const HostedDependencies: HostedDependency[] = [
  {
    name: 'pixi',
    entry: 'node_modules/pixi.js/lib/index.js',
    alias: '@essentials/pixi'
  },
  {
    name: 'hypercomb-essentials',
    entry: 'src/hello-world/hello-world.entry.ts',
    alias: '@essentials/hello'
  }
]
