// resource-completion.service.ts (moved down from hypercomb-shared in the
// everything-is-a-beehavior Phase 1)

/** The slice of ScriptPreloader this needs — reached through IoC, never an
 *  import (the preloader is shim machinery). */
type ActionNameSource = { actionNames: readonly string[] }

export class ResourceCompletionService {

  private get preloader(): ActionNameSource | undefined { return window.ioc?.get?.("@hypercomb.social/ScriptPreloader") as ActionNameSource | undefined }

  // always live (no snapshot)
  public get names(): readonly string[] { return this.preloader?.actionNames ?? [] }

}

export const resourceCompletionService = new ResourceCompletionService()

/** Re-assert into the LIVE IoC map (the llm-provider-registry lesson). */
export const ensureResourceCompletionRegistered = (): void => {
  if (!window.ioc?.has?.('@hypercomb.social/ResourceCompletionService')) {
    window.ioc?.register?.('@hypercomb.social/ResourceCompletionService', resourceCompletionService)
  }
}
ensureResourceCompletionRegistered()
