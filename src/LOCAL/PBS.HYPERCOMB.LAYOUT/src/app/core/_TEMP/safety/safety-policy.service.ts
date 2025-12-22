// src/app/core/safety/safety-policy.service.ts

import { Injectable } from '@angular/core'
import { DiamondCommit } from '../diamond-core/diamond-core.model'

interface ElevationGrant {
    lineage: string
    operationKey: string
    expiresAt: number
}

@Injectable({ providedIn: 'root' })
export class SafetyPolicy {

    private grants: ElevationGrant[] = []

    public allowFor(params: {
        lineage: string
        operationKey: string
        durationMs: number
    }): void {
        this.grants.push({
            lineage: params.lineage,
            operationKey: params.operationKey,
            expiresAt: performance.now() + params.durationMs
        })
    }

    public revoke(params: {
        lineage: string
        operationKey?: string
    }): void {
        this.grants = this.grants.filter(g => {
            if (g.lineage !== params.lineage) return true
            if (!params.operationKey) return false
            return g.operationKey !== params.operationKey
        })
    }

    // src/app/core/safety/safety-policy.service.ts

    public allows(params: {
        lineage: string
        operationKey: string
    }): boolean {
        const now = performance.now()

        return this.grants.some(g =>
            g.lineage === params.lineage &&
            g.operationKey === params.operationKey &&
            g.expiresAt > now
        )
    }


    public isElevated(
        lineage: string,
        operationKey?: string
    ): boolean {
        const now = performance.now()
        return this.grants.some(g =>
            g.lineage === lineage &&
            (!operationKey || g.operationKey === operationKey) &&
            g.expiresAt > now
        )
    }
}
