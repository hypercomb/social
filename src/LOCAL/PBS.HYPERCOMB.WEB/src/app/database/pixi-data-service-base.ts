import { inject } from "@angular/core"
import { DebounceService } from "../common/debounce-service"
import { PixiServiceBase } from "../pixi/pixi-service-base"
import { MODIFY_COMB_SVC } from "../shared/tokens/i-comb-service.token"

export abstract class PixiDataServiceBase extends PixiServiceBase {
    protected readonly modify = inject(MODIFY_COMB_SVC)
    protected readonly debounce = inject(DebounceService)
    
    private readonly debouncedSave = () =>
        this.debounce.debounce('save.cell-transform', async () => {
            const entry = this.stack.top()
            const cell = entry?.cell
            if (!cell) return
            await this.modify.updateSilent(cell)
        }, 250)


    protected saveTransform = (): void => {
        this.debouncedSave()
    }
}
