// query-service.ts

import { HttpClient } from "@angular/common/http"
import { Injectable, signal } from "@angular/core"
import { firstValueFrom } from "rxjs"
import { DebugService } from "src/app/core/diagnostics/debug-service"
import { Cell } from "src/app/cells/cell"
import { Constants } from "src/app/helper/constants"
import { CompressionService } from "src/app/helper/external-storage/compression-service"

interface QueryResponse {
  name?: string
  data?: string // base64-encoded, zipped payload
}

type LoadStatus = 'idle' | 'loading' | 'success' | 'error'

@Injectable({ providedIn: 'root' })
export class QueryService {
  // reactive stream of â€œrawâ€ tiles as they arrive
  private readonly _incoming = signal<Cell[]>([])
  public readonly incoming = this._incoming.asReadonly()

  private readonly _status = signal<LoadStatus>('idle')
  public readonly status = this._status.asReadonly()

  constructor(
    private readonly http: HttpClient,
    private readonly compression: CompressionService,
    private readonly debug: DebugService
  ) { }

  /**
   * Fetch + decompress raw hive data from server.
   * - Emits into `incoming` signal
   * - Returns the same array for convenience
   */
  public run = async (hiveId: string): Promise<Cell[]> => {
    const [hive, hiveUser = ''] = hiveId.split('#')
    const url =
      `${Constants.apiEndpoint}/QueryJsonDocument` +
      `?hiveId=${encodeURIComponent(hive)}&userId=${encodeURIComponent(hiveUser)}`

    this._status.set('loading')
    this.debug.log('net', `QueryService.run start url=${url}`)

    try {
      const json = await firstValueFrom(this.http.get<QueryResponse>(url))

      if (!json?.data) {
        this.debug.log('net', 'QueryService.run no data payload returned')
        this._incoming.set([])
        this._status.set('success')
        return []
      }

      const raw = await this.compression.decodeAndDecompress(json.data)
      const safe = Array.isArray(raw) ? raw : []
      this._incoming.set(safe)

      this.debug.log(
        'net',
        `QueryService.run decompressed count=${safe.length} hive=${hive} user=${hiveUser}`
      )

      this._status.set('success')
      return safe
    } catch (err) {
      this.debug.log('error', '[QueryService] run failure', err)
      this._incoming.set([])
      this._status.set('error')
      return []
    }
  }
}


