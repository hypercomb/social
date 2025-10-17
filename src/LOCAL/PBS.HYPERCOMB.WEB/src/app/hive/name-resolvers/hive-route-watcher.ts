import { Injectable, inject } from "@angular/core"
import { Router, NavigationEnd } from "@angular/router"
import { filter } from "rxjs"
import { HiveLoader } from "./hive-loader"
import { HypercombState } from "src/app/state/core/hypercomb-state"
import { DatabaseService } from "src/app/database/database-service"
import { ImageDatabase } from "src/app/database/images/image-database"
import { COMB_STORE } from "src/app/shared/tokens/i-comb-store.token"
import { HIVE_STORE } from "src/app/shared/tokens/i-hive-store.token"

@Injectable({ providedIn: "root" })
export class HiveRouteWatcher {
    protected readonly combstore = inject(COMB_STORE)
    protected readonly hivestore = inject(HIVE_STORE)
    private readonly database = inject(DatabaseService)
    private readonly imageDatabase = inject(ImageDatabase)
    private readonly router = inject(Router)
    private readonly loader = inject(HiveLoader)
    private readonly state = inject(HypercombState)

    constructor() {
        this.router.events
            .pipe(filter(e => e instanceof NavigationEnd))
            .subscribe(async () => {

                // intialize databasebases
                if (!this.database.db()) {
                    await this.database.ensureHiveDb()
                    await this.database.openShared()
                    await this.imageDatabase.initialize()
                }

                // make sure the screen is clear
                await this.combstore.invalidate()

                // get the current route + fragment
                const tree = this.router.parseUrl(this.router.url)
                const firstPart = tree.root.children["primary"]?.segments[0]?.path
                const fragment = tree.fragment ?? ""
                const name = fragment ? `${firstPart}#${fragment}` : firstPart

                // load set and activate the hive
                const scout = await this.loader.resolve(name)
                this.state.setScout(scout) // set the scout
                await this.loader.load(scout) // hydrate + stage
                await this.loader.activate(scout)
            })
    }
}

