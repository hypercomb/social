export interface Locator<T = unknown> {
  resolve(ref: string): Promise<T | null>
}
