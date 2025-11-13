import { Injectable, inject } from "@angular/core"
import { SerializationService } from "../database/persistence/serialization-service"
import { HONEYCOMB_SVC, QUERY_CELL_SVC } from "src/app/shared/tokens/i-comb-store.token"

@Injectable({ providedIn: 'root' })
export class WorkspaceBase {
    private readonly serializer = inject(SerializationService)

    // re-expose as getters
    public get serialization(): SerializationService { return this.serializer }
    public readonly mutate = inject(HONEYCOMB_SVC)
    public readonly query = inject(QUERY_CELL_SVC)
}
