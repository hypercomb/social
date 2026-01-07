import { effect, Injectable, NgZone, signal } from '@angular/core'

@Injectable({ providedIn: 'root' })
export class DebounceService {
  private throttleTimer: any
  private throttlePending = false
  private timers = new Map<string, any>()

  constructor(private ngZone: NgZone) {}

  // debounce: keyed, supports async
  public debounce(key: string, func: () => void | Promise<void>, wait: number = 300) {
    clearTimeout(this.timers.get(key))
    this.timers.set(
      key,
      setTimeout(async () => {
        try {
          await func()
        } finally {
          this.timers.delete(key)
        }
      }, wait)
    )
  }

  // throttle: supports async
  public throttle(func: () => void | Promise<void>, interval: number = 300) {
    if (!this.throttlePending) {
      this.throttlePending = true
      this.ngZone.run(async () => {
        await func()
      })
      this.ngZone.runOutsideAngular(() => {
        clearTimeout(this.throttleTimer)
        this.throttleTimer = setTimeout(() => {
          this.throttlePending = false
        }, interval)
      })
    }
  }
}

// helper for signals
export function debounced<T>(source: () => T, delay: number) {
  const debouncedSig = signal(source())
  let handle: any

  effect(() => {
    const value = source()
    clearTimeout(handle)
    handle = setTimeout(() => debouncedSig.set(value), delay)
  })

  return debouncedSig.asReadonly()
}
