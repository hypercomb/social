// effect-bus.ts — typed pub/sub for drone-to-drone communication
// Drones emit and listen for effects instead of resolving each other via IoC.
//
// Last-value replay: when a handler subscribes to an effect that has already
// been emitted, the handler is called immediately with the most recent payload.
// This eliminates timing races between emitters and subscribers.

export type EffectHandler<T = unknown> = (payload: T) => void

class EffectBusImpl {
  private handlers = new Map<string, Set<EffectHandler<any>>>()
  private lastValue = new Map<string, unknown>()

  emit<T = unknown>(effect: string, payload: T): void {
    this.lastValue.set(effect, payload)
    const set = this.handlers.get(effect)
    if (!set) return
    for (const fn of set) fn(payload)
  }

  /** Emit without storing in last-value — for point-in-time events that
   *  should NOT replay to late subscribers (e.g. bee:disposed). */
  emitTransient<T = unknown>(effect: string, payload: T): void {
    const set = this.handlers.get(effect)
    if (!set) return
    for (const fn of set) fn(payload)
  }

  on<T = unknown>(effect: string, handler: EffectHandler<T>): () => void {
    let set = this.handlers.get(effect)
    if (!set) { set = new Set(); this.handlers.set(effect, set) }
    set.add(handler)

    // replay last value if this effect has already been emitted
    if (this.lastValue.has(effect)) {
      handler(this.lastValue.get(effect) as T)
    }

    return () => { set!.delete(handler) }
  }

  once<T = unknown>(effect: string, handler: EffectHandler<T>): () => void {
    const unsub = this.on<T>(effect, (payload) => {
      unsub()
      handler(payload)
    })
    return unsub
  }

  clear(): void {
    this.handlers.clear()
    this.lastValue.clear()
  }
}

export const EffectBus: EffectBusImpl =
  (globalThis as any).__hypercombEffectBus ??= new EffectBusImpl()
