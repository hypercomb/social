import { Injectable } from '@angular/core'
import { environment } from 'src/environments/environment';

@Injectable({ providedIn: 'root' })
export class DebugService {
  private static readonly state: Record<string, unknown> = {}

  /** expose a state class under a short name */
  public static expose<T>(name: string, instance: unknown) : T | undefined {
    if (environment.production) return undefined

    DebugService.state[name] = instance
      ; (window as any).state = DebugService.state  // âœ… namespaced for autocomplete
    return undefined
  }

  /** remove a state */
  public static remove(name: string) {
    if (environment.production) return
    delete DebugService.state[name]
  }

  /** list all registered states */
  public static all(): Record<string, unknown> {
    if (environment.production) return {}
    return DebugService.state
  }
  private readonly enabled: string[] = [
    // 'scaling',
    // 'import',
    // 'data-resolution',
    // 'name-resolution',
    // 'startup',
    // 'database',
    // 'tile-image',
    // 'opfs-explorer',
    // 'scheduler',
    // 'refreshTile',
    // 'carousel',
    // 'hive',
    // 'cell',
    // 'editor',
    // 'actions',
    // 'debug',
    'layout',
    // 'comb',
    // 'storage',
    // 'pinch',
    // 'zoom',
    // 'render',
    //'mousewheel',
  ]
  private readonly enabledSet = new Set(this.enabled)

  private shouldLog(category: string): boolean {
    return this.enabledSet.has(category)
  }

  public log(category: string, ...args: any[]): void {
    if (this.shouldLog(category)) console.log(`[${category}]`, ...args)
  }

  public info(category: string, ...args: any[]): void {
    if (this.shouldLog(category)) console.info(`[${category}]`, ...args)
  }

  public warn(category: string, ...args: any[]): void {
    if (this.shouldLog(category)) console.warn(`[${category}] Warning:`, ...args)
  }

  public error(category: string, ...args: any[]): void {
    if (this.shouldLog(category)) console.error(`[${category}] Error:`, ...args)
  }

  public enable(category: string): void {
    this.enabledSet.add(category)
  }

  public disable(category: string): void {
    this.enabledSet.delete(category)
  }

  public isEnabled(category: string): boolean {
    return this.enabledSet.has(category)
  }
}