import { NgModule } from "@angular/core"
import { CombQueryService } from "src/app/cells/storage/comb-query-service"
import { COMB_IMG_FACTORY, HIVE_IMG_REPOSITORY, MODIFY_IMG_SVC, QUERY_IMG_SVC } from "../tokens/i-hive-images.token"
import { ImageRepository } from "src/app/database/repository/image-repository"
import { CombImageFactory } from "src/app/common/tile-editor/tile-image/cell-image-factory"

@NgModule({
    providers: [
        { provide: HIVE_IMG_REPOSITORY, useExisting: ImageRepository },
        { provide: COMB_IMG_FACTORY, useExisting: CombImageFactory },   
        { provide: QUERY_IMG_SVC, useExisting: CombQueryService },
        { provide: MODIFY_IMG_SVC, useExisting: CombQueryService },
    ]
})
export class HiveImageModule { }
