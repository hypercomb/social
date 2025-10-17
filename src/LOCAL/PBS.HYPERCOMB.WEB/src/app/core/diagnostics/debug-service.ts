import { Injectable } from '@angular/core'

@Injectable({ providedIn: 'root' })
export class DebugService {
  // master toggle list – comment/uncomment to focus logs
  private readonly enabled: string[] = [
    'scaling',
    //'render',
    'import',
    'data-resolution',
    'name-resolution',
    'startup',
    'database',
    'tile-image',
    'opfs-explorer',
    'scheduler',
    'refreshTile',
    //'shortcuts',
    'carousel',
    'hive',
    'cell',
    'editor',
    'actions',
    'debug',
    'layout',
    'comb',
    'storage  ',
  ]

  private readonly enabledSet = new Set(this.enabled)

  // ─────────────────────────────────────────────
  // core logger
  // ─────────────────────────────────────────────
  private shouldLog(category: string): boolean {
    return this.enabledSet.has(category)
  }

  // ─────────────────────────────────────────────
  // unified output
  // ─────────────────────────────────────────────
  public log(category: string, ...args: any[]): void {
    if (this.shouldLog(category)) console.log(`[${category}]`, ...args)
  }

  public info(category: string, ...args: any[]): void {
    if (this.shouldLog(category)) console.info(`[${category}]`, ...args)
  }

  public warn(category: string, ...args: any[]): void {
    if (this.shouldLog(category)) console.warn(`[${category}] ⚠️`, ...args)
  }

  public error(category: string, ...args: any[]): void {
    if (this.shouldLog(category)) console.error(`[${category}] ❌`, ...args)
  }

  // ─────────────────────────────────────────────
  // optional dynamic control
  // ─────────────────────────────────────────────
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
