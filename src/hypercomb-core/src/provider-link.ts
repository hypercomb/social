// hypercomb-core/src/provider-link.ts

export interface ProviderLink {
  readonly label: string
  readonly url: string
  readonly trust?: 'official' | 'community' | 'third-party'
  readonly purpose?: string
}
