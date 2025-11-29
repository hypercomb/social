import { HttpClient, HttpHeaders } from "@angular/common/http"
import { inject, Injectable, Injector } from "@angular/core"
import { firstValueFrom } from "rxjs"
import { HypercombData } from "src/app/actions/hypercomb-data"
import { HiveService } from "src/app/hive/storage/hive-service"
import { QUERY_HIVE_SVC } from "src/app/shared/tokens/i-comb-query.token"
import { Constants } from "src/app/helper/constants"

@Injectable({
  providedIn: 'root'
})
export class UpdateHiveTagService extends HypercombData {
  private readonly query = inject(QUERY_HIVE_SVC)

  constructor(injector: Injector,
    private http: HttpClient,
    private hive: HiveService
  ) {
    super(injector)
  }

  public checkTags = async () => {

    const hives = await this..fetchHives()

    const updatePromises = hives.map(h => this.checkAndUpdateHive(h.Name))
    await Promise.all(updatePromises)
  }

  private updateHive = async (hiveName: string, etag: string) => {
    // try {
    //   const hive = await this.hive.get(hiveName)
    //   hive._etag = etag
    //   await this.hive_actions.updateHive(hive)

    //   this.debug.log('db', `Updated hive ${hiveName} with new e-tag.`)
    // } catch (error) {
    //   console.error(`Error updating hive ${hiveName}:`, error)
    // }
    throw new Error('Method not implemented.')
  }

  private checkAndUpdateHive = async (hiveId: string) => {
    try {

      const hive = await this.hive.get(hiveId)

      // No tag then no hive to update
      delete (<any>hive).ETag
      if (hive._etag) return

      const headers = new HttpHeaders({ 'Content-Type': 'application/json' })
      const url = `${Constants.apiEndpoint}/GetHiveTag?hiveId=${hiveId}`

      const result = await firstValueFrom(this.http.get<any>(url, { headers }))
      this.debug.log('db', 'Document status:', result)

      if (result._etag && result._etag !== hive._etag) {
        await this.updateHive(hiveId, result._etag)
      }
    } catch (error) {
      console.error(`Error checking or updating hive ${hiveId}:`, error)
    }
  }
}


