// database/model/i-hypercomb-image-entity.ts
export interface ISpriteImageEntity {
    imageId?: number
    hiveId: string
    blob?: Blob
    scale: number
    x: number
    y: number
}


