export interface Source {
  // human-readable label
  readonly label: string

  // where the file can be fetched
  readonly url: string

  // optional trust hint (not enforcement)
  readonly trust?: 'official' | 'community' | 'third-party'

  // optional legal / disclaimer reference
  readonly disclaimerUrl?: string
}
