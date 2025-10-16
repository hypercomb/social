
// create a signal from a pixi event
export function fromTileEventSignal<T = any>(tile: any, event: string): Signal<T | null> {
  const s = signal<T | null>(null)
  tile.on(event, (e: T) => s.set(e))
  return s
}


