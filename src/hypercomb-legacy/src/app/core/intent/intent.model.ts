export interface Intent {
  id: string
  target?: string
  params?: Record<string, unknown>
}
