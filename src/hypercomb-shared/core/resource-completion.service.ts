// src/app/common/header/search-bar/resource-completion.service.ts
import type { ScriptPreloader } from './script-preloader'

export class ResourceCompletionService {

  private get preloader(): ScriptPreloader { return <ScriptPreloader>get("@hypercomb.social/ScriptPreloader") }

  // always live (no snapshot)
  public get names(): readonly string[] { return this.preloader.actionNames }

}

register('@hypercomb.social/ResourceCompletionService', new ResourceCompletionService())
