import { Injectable } from '@angular/core'
import { IHiveImage } from 'src/app/core/models/i-hive-image'
import { HiveImage } from 'src/app/database/repository/hive-image'

@Injectable({ providedIn: 'root' })
export class HiveImageFactory {
    private defaultScale = 1

    public create(blob: Blob, cellId: number): IHiveImage {
        return new HiveImage({
            cellId,
            blob,
            x: 0,
            y: 0,
            scale: this.defaultScale
        })
    }

}

