import { HttpClient, HttpHeaders } from '@angular/common/http'
import { inject, Injectable } from '@angular/core'
import { firstValueFrom } from 'rxjs'
import { HiveService } from 'src/app/hive/storage/hive-service'
import { HypercombState } from 'src/app/state/core/hypercomb-state'
import { Constants } from 'src/app/unsorted/constants'


@Injectable({
  providedIn: 'root'
})
export class CheckHiveUpdatesService {
  private http = inject(HttpClient)


  public checkIfDocumentChanged = async (hiveId: string): Promise<any> => {
throw new Error('Method not implemented.')
    // const hive = await this.query.fetchByHive()

    // // no tag then no hive to update
    // if (!hive._etag) return

    // const headers = new HttpHeaders({ 'Content-Type': 'application/json' })
    // const url = `${Constants.apiEndpoint}/CheckHiveUpdates?hiveId=${hiveId}`

    // try {
    //   const result = await firstValueFrom(this.http.get<any>(url, { headers }))
    //   return result
    // } catch (error) {
    //   console.error('Error checking if document changed', error)
    //   throw error
    // }
  }
}


