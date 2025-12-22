// src/app/core/hypercomb.ts

import { inject, Injectable } from "@angular/core";
import { web } from "./hypercomb.web";
import { OpfsManager } from "./core/opfs.manager";
import { Router } from "@angular/router";

@Injectable({ providedIn: "root" })
export class hypercomb extends web {
    private readonly router = inject(Router);
    constructor(
        private readonly opfs: OpfsManager
    ) {
        super();
    }

    protected override write = async (text: string): Promise<void> => {
        const lineage = this.router.url
            .split('/')
            .filter(Boolean)

        const dir = await this.opfs.ensureDirs(lineage)

        await this.opfs.writeFile(dir, `${Date.now()}`, text)
    }
}
