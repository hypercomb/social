// src/dependencies.ts

export type HostedDependency = {
  name: string
  entry: string
  alias: string
}

export const HostedDependencies: HostedDependency[] = [
  {
    name: 'hypercomb-essentials', 
    entry: 'src/hello-world/hello-world.entry.ts',
    alias: '@essentials/hello'
  }
]
