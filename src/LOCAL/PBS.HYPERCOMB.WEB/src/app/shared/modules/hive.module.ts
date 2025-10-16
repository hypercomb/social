﻿import { NgModule } from "@angular/core"
import { HiveFactory } from "../../hive/hive-factory"
import { HIVE_DATA_RESOLVERS, HIVE_NAME_RESOLVERS } from "../tokens/i-hive-resolver.token"
import { HIVE_FACTORY } from "../../inversion-of-control/ports/i-hive-factory-port"
import { ServerOracle } from "../../hive/name-resolvers/server-resolver"
import { REFRESH_HIVE_PORT } from "../../hive/refresh-hive-port"
import { HiveStore } from "../../cells/hive/hive-store"
import { HIVE_CONTROLLER_ST, HIVE_STATE, HIVE_STORE, LOOKUP_HIVES, RESOLUTION_COORDINATOR } from "../tokens/i-hive-store.token"
import { Genus } from "src/app/hive/name-resolvers/genus-resolver"
import { FallbackDataResolver } from "src/app/hive/data-resolvers/fallback-data.loader"
import { FallbackNameResolver } from "src/app/hive/name-resolvers/fallback-name-resolver"
import { ServerDataResolver } from "src/app/hive/data-resolvers/server-data.loader"
import { HiveLoader } from "src/app/hive/name-resolvers/hive-loader"
import { OpfsNameResolver } from "src/app/hive/name-resolvers/opfs-name-resolver"
import { HiveQueryService } from "src/app/hive/storage/hive-query.service"
import { QUERY_HIVE_SVC } from "../tokens/i-comb-query.token"
import { LiveDbNameResolver } from "src/app/hive/name-resolvers/live-db-name-resolver"
import { LiveDbDataLoader } from "src/app/hive/data-resolvers/live-db-data.loader"
import { FirstOpfsNameResolver } from "src/app/hive/name-resolvers/first-opfs-name-resolver"
import { FirstOpfsLoader } from "src/app/hive/data-resolvers/first-opfs-loader"
import { OpfsHiveLoader } from "src/app/hive/data-resolvers/opfs-hive-loader"

@NgModule({
    providers: [
        // factory
        { provide: HIVE_FACTORY, useClass: HiveFactory },
        { provide: REFRESH_HIVE_PORT, useExisting: HiveFactory },
        { provide: HIVE_STORE, useExisting: HiveStore },
        { provide: HIVE_STATE, useExisting: HiveStore },

        // resolvers

        { provide: HIVE_NAME_RESOLVERS, useClass: LiveDbNameResolver, multi: true },
        { provide: HIVE_NAME_RESOLVERS, useClass: FirstOpfsNameResolver, multi: true }, // first-opfs resolver
        { provide: HIVE_NAME_RESOLVERS, useClass: OpfsNameResolver, multi: true },   // local db resolver
        { provide: HIVE_NAME_RESOLVERS, useClass: ServerOracle, multi: true }, // server resolver
        { provide: HIVE_NAME_RESOLVERS, useClass: FallbackNameResolver, multi: true },
        { provide: HIVE_NAME_RESOLVERS, useClass: Genus, multi: true },

        // data providers
        { provide: HIVE_DATA_RESOLVERS, useClass: LiveDbDataLoader, multi: true },
        { provide: HIVE_DATA_RESOLVERS, useClass: FirstOpfsLoader, multi: true },
        { provide: HIVE_DATA_RESOLVERS, useClass: OpfsHiveLoader, multi: true },
        { provide: HIVE_DATA_RESOLVERS, useClass: ServerDataResolver, multi: true },
        { provide: HIVE_DATA_RESOLVERS, useClass: FallbackDataResolver, multi: true },

        // service
        { provide: QUERY_HIVE_SVC, useClass: HiveQueryService },
        // store
        { provide: HIVE_CONTROLLER_ST, useExisting: HiveStore },
        { provide: LOOKUP_HIVES, useExisting: HiveStore },

        // resolution coordinator
        { provide: RESOLUTION_COORDINATOR, useExisting: HiveLoader }
    ]
})
export class HiveModule { }


