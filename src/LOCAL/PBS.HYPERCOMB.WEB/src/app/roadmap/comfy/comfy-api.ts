import { inject, Injectable } from "@angular/core"
import { DebugService } from "src/app/core/diagnostics/debug-service"
import { ComfyHistory } from "src/app/core/models/comfy-history"

@Injectable({
    providedIn: 'root'
})
export class ComfyService {
    private readonly debug = inject(DebugService)

    async getHistory(): Promise<ComfyHistory> {

        try {
            const response = await fetch("http://localhost:8818/history")
            const json = await response.json()
            this.debug.log('misc', "History:", json)
            return <ComfyHistory>json
        }
        catch (error) {
            console.error("Error fetching history:", error)
            throw error
        }
    }
}


