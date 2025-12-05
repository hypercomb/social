// hive-resolution-context.ts
export enum HiveResolutionType {
  None = 'None',
  Cache = 'Cache',
  Server = 'Server',
  NewHive = 'NewHive',
  Name = "Name",
  Fallback = "Fallback",
  Local = "Local",
  Opfs = "Opfs",
  LiveData = "LiveData",
}


export interface IDexieHive {
  name: string
  file: File | undefined
  imageHash?: string
  background?: string
}