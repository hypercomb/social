export interface IHiveImage {
    id?: number
    blob: Blob 
    cellId: number
    scale: number
    x: number
    y: number
    getBlob(): Promise<Blob>
}


