// hypercomb-legacy/src/app/hive/hive-route-watcher.ts

import { Injectable, inject } from "@angular/core"
import { Router, NavigationEnd } from "@angular/router"
import { filter } from "rxjs"
import { HypercombState } from "src/app/state/core/hypercomb-state"
import { HONEYCOMB_STORE } from "src/app/shared/tokens/i-honeycomb-store.token"
import { HIVE_STORE } from "src/app/shared/tokens/i-hive-store.token"
import { HiveLoader } from "./loaders/hive.loader"

//import { SpritesheetProvider } from "../user-interface/texture/spritesheet-provider"

@Injectable({ providedIn: "root" })
export class HiveRouteWatcher {
  protected readonly combstore = inject(HONEYCOMB_STORE)
  protected readonly hivestore = inject(HIVE_STORE)
  private readonly router = inject(Router)
  private readonly loader = inject(HiveLoader)
  private readonly state = inject(HypercombState)
  //private readonly spritesheetProvider = inject(SpritesheetProvider)

  constructor() {
    this.router.events
      .pipe(filter(e => e instanceof NavigationEnd))
      .subscribe(async () => {


        // -------------------------
        // ROUTE FORMAT EXPECTATIONS
        //
        // /crypto#1000
        // /crypto
        // /1000   (domain mode: crypto.<domain>/1000)
        //
        // Goal: ALWAYS produce crypto#1000
        // -------------------------

        // parse route segments
        const tree = this.router.parseUrl(this.router.url)
        const primary = tree.root.children["primary"]
        const seg = primary?.segments ?? []

        const part = seg[0]?.path ?? ""        // crypto  OR  1000
        const fragment = tree.fragment ?? ""    // hash fragment if written

        let base: string | null = null
        let id: string | null = null

        // If user typed crypto#1000 → Angular puts base in segment, id in fragment
        if (fragment) {
          base = part
          id = fragment
        }
        else {
          // no fragment:
          // If this is domain mode (crypto.domain/1000)
          // part is the id, and base is the subdomain
          const host = window.location.hostname
          const hostParts = host.split(".")

          const subdomain = hostParts.length > 1 ? hostParts[0] : null

          if (subdomain && !isNaN(Number(part))) {
            // crypto.domain/1000 → base=crypto, id=1000
            base = subdomain
            id = part
          }
          else {
            // localhost mode or the user typed /crypto
            // part may be base or id; preserve old behavior
            base = part
            id = null
          }
        }

        // fallback protections
        if (!base) return

        const hiveName = id ? `${base}#${id}` : base
        this.state.setHive(hiveName)
        
        // load hive
        const scout = await this.loader.resolve(hiveName)
        this.state.setScout(scout)
        await this.loader.load(scout)
        await this.loader.activate(scout.seed)
        // this.spritesheetProvider.primeLayer(layerId, cells)

      })
  }
}
