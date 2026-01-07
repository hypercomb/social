// i-import-transform.ts
export interface IImportTransform {
  supports(table: string): boolean
  transform(table: string, value: any, key?: any): { value: any; key?: any }
}
