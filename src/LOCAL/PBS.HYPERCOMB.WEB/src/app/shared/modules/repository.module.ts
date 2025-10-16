import { NgModule } from "@angular/core";
import { CellRepository } from "src/app/database/repository/cell-repository";
import { CELL_REPOSITORY } from "../tokens/i-cell-repository.token";

@NgModule({
    providers: [
        { provide: CELL_REPOSITORY, useClass: CellRepository }
    ]
})
export class RepositoryModule { }


