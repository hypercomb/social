
export function fromPixi<T = any>(
  emitter: { on: (event: string, fn: (...args: any[]) => void) => void; off: (event: string, fn: (...args: any[]) => void) => void },
  event: string
): Observable<T> {
  return fromEventPattern<T>(
    (handler) => emitter.on(event, handler),
    (handler) => emitter.off(event, handler)
  )
}

/**
 * tile-specific shortcut, typed to DisplayObject (Sprite, Container, etc.)
 */
export function fromTileEvent<T = any>(
  tile: Container,
  event: string
): Observable<T> {
  return fromEventPattern<T>(
    (handler) => tile.on(event, handler),
    (handler) => tile.off(event, handler)
  )
}


