import { NgModule } from "@angular/core"
import { HoneycombService } from "src/app/cells/storage/honeycomb-service"
import { HIVE_HYDRATION, HONEYCOMB_SVC, MODIFY_COMB_SVC } from "../tokens/i-comb-service.token"

@NgModule({
  providers: [
    HoneycombService,
    { provide: HONEYCOMB_SVC, useExisting: HoneycombService },
    { provide: HIVE_HYDRATION, useExisting: HoneycombService },
    { provide: MODIFY_COMB_SVC, useExisting: HoneycombService }
  ]
})
export class CombServiceModule { }
