import { inject, Injectable } from "@angular/core"
import { ServerInitializer } from "./server-initializer.service"


export interface IDomainInitializer {
    enabled: (input: string) => Promise<boolean>
    initialize: (input: string) => Promise<void>
}
@Injectable({ providedIn: 'root' })
export class DomainInitializer {

    public initializers: IDomainInitializer[] = [inject(ServerInitializer)]
    public initialize = async (): Promise<void> => {
        const domain ='https://storagehypercomb.blob.core.windows.net/content/e7ecd3544a11072255ad3a10adcff6d2ec4333aa884be8b52f5c780a2d570306'

        for (const instance of this.initializers) {
            if (await instance.enabled(domain)) {
                await instance.initialize(domain)
                return
            }
        }
    }
}