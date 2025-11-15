// hive-resolution-context.ts
export enum HiveResolutionType {
  None = 'None',
  Cache = 'Cache',
  Server = 'Server',
  Genus = 'Genus',
  Name = "Name",
  Fallback = "Fallback",
  Local = "Local",
  Opfs = "Opfs",
  LiveDb = "LiveDb",
  FirstOpfs = "FirstOpfs"
}


export interface IDexieHive {
  name: string
  file: File | undefined
  imageHash?: string
  background?: string
}