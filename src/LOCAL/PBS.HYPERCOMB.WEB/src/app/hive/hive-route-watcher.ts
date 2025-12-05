import { Injectable, inject } from "@angular/core"
import { Router, NavigationEnd } from "@angular/router"
import { filter } from "rxjs"
import { HypercombState } from "src/app/state/core/hypercomb-state"
import { DatabaseService } from "src/app/database/database-service"
import { HONEYCOMB_STORE } from "src/app/shared/tokens/i-honeycomb-store.token"
import { HIVE_STORE } from "src/app/shared/tokens/i-hive-store.token"
import { HiveLoader } from "./loaders/hive.loader"

@Injectable({ providedIn: "root" })
export class HiveRouteWatcher {
  protected readonly combstore = inject(HONEYCOMB_STORE)
  protected readonly hivestore = inject(HIVE_STORE)
  private readonly database = inject(DatabaseService)
  private readonly router = inject(Router)
  private readonly loader = inject(HiveLoader)
  private readonly state = inject(HypercombState)

  constructor() {
    this.router.events
      .pipe(filter(e => e instanceof NavigationEnd))
      .subscribe(async () => {

        // initialize dexie hive database if needed
        if (!this.database.db()) {
          await this.database.ensureHiveDb()
          await this.database.openShared()
        }

        // extract the meadow name (subdomain)
        const host = window.location.hostname    // e.g. cigars.hypercomb.io
        const parts = host.split('.')
        const primaryName = this.extractHiveName(parts)

        // extract id from route (if present)
        const tree = this.router.parseUrl(this.router.url)
        const primary = tree.root.children['primary']
        const id = primary?.segments[0]?.path ?? null

        // build hive identifier: meadow only → community; meadow+id → hive
        const hiveName = id ? `${primaryName}#${id}` : primaryName

        // load + stage + activate hive
        const scout = await this.loader.resolve(hiveName)
        this.state.setScout(scout)
        const hive = await this.loader.load(scout)
        await this.loader.activate(hive)
      })
  }

  // helper: derive meadow (subdomain) safely
  private extractHiveName(parts: string[]): string {
    // if local environment, allow fallback to first part
    if (parts.length < 3) return parts[0] ?? 'local'
    return parts[0]   // subdomain (meadow name)
  }
}
