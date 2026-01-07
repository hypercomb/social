export interface Source {
  readonly label: string
  readonly url: string
  readonly trust?: 'official' | 'community' | 'third-party'
  readonly disclaimerUrl?: string
}
