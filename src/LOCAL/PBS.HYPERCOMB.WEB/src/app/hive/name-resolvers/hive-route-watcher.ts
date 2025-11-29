import { Injectable, inject } from "@angular/core"
import { Router, NavigationEnd } from "@angular/router"
import { filter } from "rxjs"
import { HiveLoader } from "./hive-loader"
import { HypercombState } from "src/app/state/core/hypercomb-state"
import { DatabaseService } from "src/app/database/database-service"
import { HONEYCOMB_STORE } from "src/app/shared/tokens/i-comb-store.token"
import { HIVE_STORE } from "src/app/shared/tokens/i-hive-store.token"
import { Hive } from "src/app/cells/cell"
import { OpfsHiveService } from "../storage/opfs-hive-service"

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

        // clear screen layout
        await this.combstore.invalidate()

        // parse route → hive name
        const tree = this.router.parseUrl(this.router.url)
        const primary = tree.root.children['primary']
        const firstPart = primary?.segments[0]?.path
        const fragment = tree.fragment ?? ''
        const name = fragment ? `${firstPart}#${fragment}` : firstPart

        // load + stage + activate hive
        const scout = await this.loader.resolve(name)
        this.state.setScout(scout)
        await this.loader.load(scout)
        await this.loader.activate(scout)
      })
  }
}
