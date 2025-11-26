import { NgModule } from "@angular/core"
import { HoneycombStore } from "src/app/cells/storage/honeycomb-store"
import { COMB_STORE, STAGING_ST } from "../tokens/i-comb-store.token"
import { CombQueryService } from "src/app/cells/storage/comb-query-service"

@NgModule({
  providers: [
    HoneycombStore,
    { provide: COMB_STORE, useExisting: HoneycombStore },
    { provide: STAGING_ST, useExisting: HoneycombStore },
  
    // Comb Query
    { provide: 'QUERY_COMB_SVC', useExisting: CombQueryService }
  ]
})
export class CombStoreModule {}
