import { NgModule } from "@angular/core"
import { CombService } from "src/app/cells/storage/comb-service"
import { HIVE_HYDRATION, COMB_SERVICE, MODIFY_COMB_SVC } from "../tokens/i-comb-service.token"

@NgModule({
  providers: [
    CombService,
    { provide: COMB_SERVICE, useExisting: CombService },
    { provide: HIVE_HYDRATION, useExisting: CombService },
    { provide: MODIFY_COMB_SVC, useExisting: CombService }
  ]
})
export class CombServiceModule { }
