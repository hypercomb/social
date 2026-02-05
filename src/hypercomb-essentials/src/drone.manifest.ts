// src/drone.manifest.ts
export const DroneManifest = [
  {
    id: 'pixi-host',
    kind: 'module',
    entry: './pixi/pixi-host.drone.js'
  }
  ,{
    id: 'show-honeycomb',
    kind: 'module',
    entry: './pixi/show-honeycomb.drone.js'
  },
  {
    id: 'hello-world',
    kind: 'runtime',
    entry: '@essentials/hello', // signature-loaded
  }
]
