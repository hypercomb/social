import { HttpClient, HttpResponse } from '@angular/common/http'
import { Injectable, inject, signal } from '@angular/core'
import { Constants } from 'src/app/unsorted/constants'
import { HiveResolutionType } from '../hive-models'
import { firstValueFrom, timeout, catchError, of } from 'rxjs'
import { HiveScout } from '../hive-scout'
import { HiveLoaderBase } from './hive-loader.base'



@Injectable({ providedIn: 'root' })
export class ServerOracle extends HiveLoaderBase {

    public readonly type = HiveResolutionType.Server

    public override enabled = async (hiveName: string): Promise<boolean> => {
        this.resolving.set(true)
        this.logResolution(`Checking server enabled for ${hiveName}`)
        if (!hiveName) return false
        
        const headUrl = `${Constants.hypercombio}/${hiveName}`

        try {
            const headResp = await firstValueFrom(
                this.http.head<void>(headUrl, { observe: 'response' }).pipe(
                    timeout(Constants.ServerHeadTimeout ?? 200),
                    catchError(() => of<HttpResponse<void> | null>(null))
                )
            )

            const ok = !!headResp && headResp.status >= 200 && headResp.status < 400
            this.logResolution(`Server enabled result for ${hiveName}: ${ok}`)
            return ok
        } catch (err) {
            return false
        } finally {
            this.resolving.set(false)
        }
    }

    public override resolve(hiveName: string): Promise<HiveScout | null> | HiveScout | null {
        this.logResolution(`Resolving server hive for ${hiveName}`)
        return HiveScout.server(hiveName)
    }

    private readonly http = inject(HttpClient)

    // signals for live state tracking
    public readonly resolving = signal(false)

}


