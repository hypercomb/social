// auto-generated
// post-render preload lane — non-critical self-registering modules
// Classification is derived from source paths; do not edit manually.

let loading: Promise<void> | undefined

export function preloadEffects(): Promise<void> {
  return loading ??= Promise.all([
  import('./games/arkanoid/arkanoid.drone'),
  import('./games/arkanoid/arkanoid.queen'),
  import('./games/arkanoid/theme'),
  import('./games/bubble/bubble.drone'),
  import('./games/bubble/bubble.queen'),
  import('./games/roper/roper.drone'),
  import('./games/roper/roper.queen'),
  import('./games/solomon/solomon.drone'),
  import('./games/solomon/solomon.queen'),
  import('./games/tutor/game-registry')
  ]).then(() => undefined)
}
