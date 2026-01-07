// transformers.module.ts
import { NgModule } from '@angular/core'
import { TileTransformer } from './tile-transformer'

@NgModule({
    providers: [
        TileTransformer,
        HiveTransformer,
        TagTransformer
    ]
})
export class TransformersModule { }


