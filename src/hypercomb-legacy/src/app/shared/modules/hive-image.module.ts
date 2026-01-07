import { NgModule } from "@angular/core"
import { CombQueryService } from "src/app/cells/storage/comb-query-service"
import {  HIVE_IMG_REPOSITORY, MODIFY_IMG_SVC, QUERY_IMG_SVC } from "../tokens/i-hive-images.token"
import { ImageRepository } from "src/app/database/repository/image-repository"

@NgModule({
    providers: [
        { provide: HIVE_IMG_REPOSITORY, useExisting: ImageRepository },
        { provide: QUERY_IMG_SVC, useExisting: CombQueryService },
        { provide: MODIFY_IMG_SVC, useExisting: CombQueryService },
    ]
})
export class HiveImageModule { }
