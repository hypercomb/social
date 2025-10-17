import { Injectable } from '@angular/core'
import { IHiveImage } from 'src/app/core/models/i-hive-image'
import { HiveImage } from 'src/app/database/repository/hive-image'
import { ICombImageFactory } from 'src/app/shared/tokens/i-hive-images.token'

@Injectable({ providedIn: 'root' })
export class CombImageFactory implements ICombImageFactory {
    private defaultScale = 1        

    
    public async create(blob: Blob, cellId: number): Promise<IHiveImage> {
        return new HiveImage({
            cellId,
            blob,
            x: 0,
            y: 0,
            scale: this.defaultScale
        })
    }

}

