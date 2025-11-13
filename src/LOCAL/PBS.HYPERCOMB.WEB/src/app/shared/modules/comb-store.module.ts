import { NgModule } from "@angular/core"
import { CombStore } from "src/app/cells/storage/honeycomb-store"
import { COMB_STORE, STAGING_ST } from "../tokens/i-comb-store.token"
import { CombQueryService } from "src/app/cells/storage/comb-query-service"

@NgModule({
  providers: [
    CombStore,
    { provide: COMB_STORE, useExisting: CombStore },
    { provide: STAGING_ST, useExisting: CombStore },
  
    // Comb Query
    { provide: 'QUERY_COMB_SVC', useExisting: CombQueryService }
  ]
})
export class CombStoreModule {}
