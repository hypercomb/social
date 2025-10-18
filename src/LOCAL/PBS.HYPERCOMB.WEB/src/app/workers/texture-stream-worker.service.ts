import { Injectable, signal, inject } from '@angular/core'
import { Cell } from '../cells/cell'
import { HypercombState } from 'src/app/state/core/hypercomb-state'

export interface WorkerInfo {
  cacheId: string
  bitmap: ImageBitmap
}

interface WorkerTask {
  id: string
  cacheId: string
  blob: Blob
  resolve: (bitmap: ImageBitmap) => void
  reject: (err: unknown) => void
}

@Injectable({ providedIn: 'root' })
export class TextureWorkerService {
  private _decoderInfo = signal<WorkerInfo | undefined>(undefined)
  public readonly decoderInfo = this._decoderInfo.asReadonly()
  private readonly hs = inject(HypercombState)

  private readonly worker = new Worker(
    new URL('./texture-stream.worker', import.meta.url),
    { type: 'module' }
  )

  private pending = new Map<string, WorkerTask>()

  constructor() {
    this.worker.onmessage = (event: MessageEvent) => {
      const { id, bitmap, error } = event.data
      const task = this.pending.get(id)
      if (!task) return
      this.pending.delete(id)
      this._decoderInfo.set(<WorkerInfo>{  cacheId: task.cacheId, bitmap: bitmap })
      if (error) task.reject(error)
      else task.resolve(bitmap)
    }
  }

  public async decode(cell: Cell): Promise<ImageBitmap> {
    const id = crypto.randomUUID()
    const cid = this.hs.cacheId(cell)

    return new Promise<ImageBitmap>((resolve, reject) => {
      this.pending.set(id, { id, cacheId: cid, blob: cell.image!.blob, resolve, reject })
      this.worker.postMessage({ id, cacheId: cid, blob: cell.image!.blob })
    })
  }

  public terminate(): void {
    this.worker.terminate()
  }
}
