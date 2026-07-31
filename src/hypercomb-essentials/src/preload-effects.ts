// auto-generated
// post-render preload lane — non-critical self-registering modules
// Classification is derived from source paths; do not edit manually.

let loading: Promise<void> | undefined

export function preloadEffects(): Promise<void> {
  return loading ??= Promise.all([
  import('./diamondcoreprocessor.com/games/arkanoid/arkanoid.drone'),
  import('./diamondcoreprocessor.com/games/arkanoid/arkanoid.queen'),
  import('./diamondcoreprocessor.com/games/arkanoid/theme'),
  import('./diamondcoreprocessor.com/games/bubble/bubble.drone'),
  import('./diamondcoreprocessor.com/games/bubble/bubble.queen'),
  import('./diamondcoreprocessor.com/games/roper/roper.drone'),
  import('./diamondcoreprocessor.com/games/roper/roper.queen'),
  import('./diamondcoreprocessor.com/games/solomon/solomon.drone'),
  import('./diamondcoreprocessor.com/games/solomon/solomon.queen'),
  import('./diamondcoreprocessor.com/games/tutor/game-registry')
  ]).then(() => undefined)
}
