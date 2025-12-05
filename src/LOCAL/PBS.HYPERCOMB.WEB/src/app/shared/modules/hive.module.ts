import { NgModule } from "@angular/core"
import { HiveFactory } from "../../hive/hive-factory"
import { HIVE_LOADERS, HIVE_RESOLVERS } from "../tokens/i-hive-resolver.token"
import { HIVE_FACTORY } from "../../inversion-of-control/ports/i-hive-factory-port"
import { REFRESH_HIVE_PORT } from "../../hive/refresh-hive-port"
import { HiveStore } from "../../cells/hive/hive-store"
import { HIVE_CONTROLLER_ST, HIVE_STATE, HIVE_STORE, LOOKUP_HIVES, RESOLUTION_COORDINATOR } from "../tokens/i-hive-store.token"
import { HiveLoader } from "src/app/hive/loaders/hive.loader"
import { HiveQueryService } from "src/app/hive/storage/hive-query.service"
import { QUERY_HIVE_SVC } from "../tokens/i-comb-query.token"
import { NewHiveLoader } from "src/app/hive/loaders/implementations/new-hive-loader"
import { ServerResolver } from "src/app/hive/loaders/implementations/server.loader"
import { LiveDbResolver } from "src/app/hive/resolvers/implementations/live-db-name-resolver"
import { NewHiveResolver } from "src/app/hive/resolvers/implementations/new-hive-resolver"
import { LiveDataLoader } from "src/app/hive/loaders/implementations/live-db.loader"

@NgModule({
    providers: [
        { provide: HIVE_FACTORY, useExisting: HiveFactory },
        { provide: REFRESH_HIVE_PORT, useExisting: HiveFactory },
        { provide: HIVE_STORE, useExisting: HiveStore },
        { provide: HIVE_STATE, useExisting: HiveStore },

        // resolvers

        { provide: HIVE_RESOLVERS, useClass: LiveDbResolver, multi: true },
        { provide: HIVE_RESOLVERS, useClass: ServerResolver, multi: true }, // server resolver
        { provide: HIVE_RESOLVERS, useClass: NewHiveResolver, multi: true },

        // data providers
        { provide: HIVE_LOADERS, useClass: LiveDataLoader, multi: true },
        { provide: HIVE_LOADERS, useClass: ServerResolver, multi: true },
        { provide: HIVE_LOADERS, useClass: NewHiveLoader, multi: true },

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


