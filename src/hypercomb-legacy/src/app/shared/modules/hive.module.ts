import { NgModule } from "@angular/core"
import { HIVE_LOADERS, HIVE_RESOLVERS } from "../tokens/i-hive-resolver.token"
import { HiveStore } from "../../core/hive/hive-store"
import { HIVE_CONTROLLER_ST, HIVE_STATE, HIVE_STORE, LOOKUP_HIVES, RESOLUTION_COORDINATOR } from "../tokens/i-hive-store.token"
import { HiveLoader } from "src/app/hive/loaders/hive.loader"
import { NewHiveResolver } from "src/app/hive/resolvers/new-hive-resolver"
import { OpfsHiveResolver } from "src/app/hive/resolvers/opfs-hive.resolver"
import { NewHiveLoader } from "src/app/hive/loaders/new-hive.loader"
import { OpfsHiveLoader } from "src/app/hive/loaders/opfs.hive-loader"

@NgModule({
    providers: [
        { provide: HIVE_STORE, useExisting: HiveStore },
        { provide: HIVE_STATE, useExisting: HiveStore },

        // resolvers

        // { provide: HIVE_RESOLVERS, useClass: LocalHiveResolver, multi: true },
        { provide: HIVE_RESOLVERS, useClass: OpfsHiveResolver, multi: true },
        // { provide: HIVE_RESOLVERS, useClass: ServerHiveResolver, multi: true }, // server resolver
        { provide: HIVE_RESOLVERS, useClass: NewHiveResolver, multi: true },

        // data loader
        // { provide: HIVE_LOADERS, useClass: LocalHiveLoader, multi: true },
        { provide: HIVE_LOADERS, useClass: OpfsHiveLoader, multi: true },
        //{ provide: HIVE_LOADERS, useClass: ServerHiveLoader, multi: true },
        { provide: HIVE_LOADERS, useClass: NewHiveLoader, multi: true },

        // store
        { provide: HIVE_CONTROLLER_ST, useExisting: HiveStore },
        { provide: LOOKUP_HIVES, useExisting: HiveStore },

        // resolution coordinator
        { provide: RESOLUTION_COORDINATOR, useExisting: HiveLoader }
    ]
})
export class HiveModule { }


