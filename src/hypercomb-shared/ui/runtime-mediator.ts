// hypercomb-shared/ui/runtime-mediator.ts

// Push-only install model: the shells never pull-install here. Web installs
// via ensure-install (sentinel push / user-initiated bundled upgrade); dev
// imports essentials directly. The forward path is the pull replication
// protocol (documentation/install-by-replication.md) — one verb,
// replicate(root) — so the mediator's old genesis LayerInstaller call is
// retired. What remains is the serialized dependency load the OPFS
// explorer's domain-root sync relies on.

import { DependencyLoader } from '@hypercomb/shared/core'
import { type LocationParseResult } from '@hypercomb/shared/core/initializers/location-parser'

export class RuntimeMediator {

  private running: Promise<void> | null = null

  public sync = async (_parsed: LocationParseResult): Promise<void> => {
    const run = async (): Promise<void> => {
      const dependency = get('@hypercomb.social/DependencyLoader') as DependencyLoader
      await dependency.load()
    }

    this.running = (this.running ?? Promise.resolve()).then(run, run)
    await this.running
  }
}

register('@hypercomb.social/RuntimeMediator', new RuntimeMediator())
