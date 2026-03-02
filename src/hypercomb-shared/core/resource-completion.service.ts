// src/app/common/header/search-bar/resource-completion.service.ts
import { computed } from '@angular/core'
import { ScriptPreloader } from './script-preloader'

export class ResourceCompletionService {

  private get preloader(): ScriptPreloader { return <ScriptPreloader>get("ScriptPreloader") }

  // always live (no snapshot)
  public readonly names = computed(() => this.preloader.actionNames())

}

register('ResourceCompletionService', new ResourceCompletionService())
