// diamondcoreprocessor.com/format/format.provider.ts

export interface FormatEntry {
  key: string
  label: string
  value: unknown
  preview?: string
}

export interface FormatProvider {
  readonly key: string
  extract(props: Record<string, unknown>): FormatEntry | null
  apply(props: Record<string, unknown>, value: unknown): Record<string, unknown>
}
