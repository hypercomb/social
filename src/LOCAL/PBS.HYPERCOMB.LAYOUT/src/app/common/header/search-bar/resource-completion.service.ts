// src/app/common/header/search-bar/resource-completion.service.ts
import { Injectable, computed, inject } from '@angular/core'
import { ScriptPreloaderService } from '../../../core/script-preloader.service'

@Injectable({ providedIn: 'root' })
export class ResourceCompletionService {

  private readonly preloader = inject(ScriptPreloaderService)

  // always live (no snapshot)
  public readonly names = computed(() => this.preloader.actionNames())

}
