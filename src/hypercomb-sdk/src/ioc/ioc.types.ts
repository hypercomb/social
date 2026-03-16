export interface IoCContainer {
  register(key: string, value: unknown): void
  get<T = unknown>(key: string): T | undefined
  has(key: string): boolean
  list(): readonly string[]
}
