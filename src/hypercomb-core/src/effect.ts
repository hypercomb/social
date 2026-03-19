// hypercomb-core/src/effect.ts

export type Effect =
  | 'filesystem'
  | 'render'
  | 'history'
  | 'network'
  | 'memory'
  | 'external'
