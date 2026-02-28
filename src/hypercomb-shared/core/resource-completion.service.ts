// src/app/common/header/search-bar/resource-completion.service.ts
import { Injectable, computed } from '@angular/core'
import { ScriptPreloader } from './script-preloader'

@Injectable({ providedIn: 'root' })
export class ResourceCompletionService {

  private get preloader(): ScriptPreloader { return <ScriptPreloader>window.ioc.get("ScriptPreloader") }

  // always live (no snapshot)
  public readonly names = computed(() => this.preloader.actionNames())

}
