// src/app/common/header/search-bar/resource-completion.service.ts

import { DestroyRef, Injectable, inject, signal } from '@angular/core'
import { ScriptPreloaderService } from '../../../core/script-preloader.service'

@Injectable({ providedIn: 'root' })
export class ResourceCompletionService {

  public readonly names = signal<readonly string[]>([])

  private initialized = false
  private readonly destroyRef = inject(DestroyRef)
  private readonly preloader = inject(ScriptPreloaderService)

  // ----------------------------------
  // test seam
  // ----------------------------------

  // set to true to force test completions (no opfs needed)
  private static readonly USE_TEST_COMPLETIONS = true

  private static readonly TEST_COMPLETIONS: readonly string[] = [
    'open portal',
    'open profile',
    'open project',
    'open preferences',
    'run hello world',
    'run health check',
    'show actions',
    'show resources',
    'sync',
    'search',
  ]

  private readonly onSynchronize = (): void => {
    void this.refresh()
  }

  public constructor() {
    window.addEventListener('synchronize', this.onSynchronize)
    this.destroyRef.onDestroy(() => window.removeEventListener('synchronize', this.onSynchronize))
  }

  public initialize = async (): Promise<void> => {
    if (this.initialized) return
    this.initialized = true
    await this.refresh()
  }

  public refresh = async (): Promise<void> => {
    // ----------------------------------
    // test completions
    // ----------------------------------
    if (ResourceCompletionService.USE_TEST_COMPLETIONS) {
      this.names.set(ResourceCompletionService.TEST_COMPLETIONS)
      return
    }

    // ----------------------------------
    // real completions from warmed scripts
    // ----------------------------------
    await this.preloader.refresh()
    this.names.set(this.preloader.actionNames())
  }
}
