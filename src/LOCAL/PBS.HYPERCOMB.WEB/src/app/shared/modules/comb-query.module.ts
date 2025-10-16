import { NgModule } from "@angular/core"
import { CombQueryService } from "src/app/cells/storage/comb-query-service"
import { QUERY_COMB_SVC } from "../tokens/i-comb-query.token"

@NgModule({
  providers: [
    CombQueryService,
    { provide: QUERY_COMB_SVC, useExisting: CombQueryService }
  ]
})
export class CombQueryModule {}
