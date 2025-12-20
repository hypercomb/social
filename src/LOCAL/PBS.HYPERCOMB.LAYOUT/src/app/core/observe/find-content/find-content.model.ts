export type FindContentScope = 'source' | 'history' | 'all' | 'windows'

export interface FindContentQuery {
  raw: string
  pattern: string
  scope: FindContentScope
  caseSensitive: boolean
}

export interface FindContentHit {
  path: string
  line: number
  column: number
  preview: string
}

export interface FindContentResult {
  query: FindContentQuery
  hits: FindContentHit[]
  scannedFiles: number
  matchedFiles: number
  durationMs: number
  truncated: boolean
  missingRoots: string[]
}
