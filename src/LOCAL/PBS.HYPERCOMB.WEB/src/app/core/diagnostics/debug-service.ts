import { Injectable } from '@angular/core'

@Injectable({ providedIn: 'root' })
export class DebugService {
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