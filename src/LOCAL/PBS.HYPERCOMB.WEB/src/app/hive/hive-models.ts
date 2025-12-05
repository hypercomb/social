// hive-resolution-context.ts
export enum HiveResolutionType {
  None = 'None',
  Cache = 'Cache',
  Server = 'Server',
  New = 'New',
  Name = "Name",
  Local = "Local",
  Opfs = "Opfs"
}


export interface IDexieHive {
  name: string
  file: File | undefined
  imageHash?: string
  background?: string
}