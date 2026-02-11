// hypercomb-web/src/dev-manifest.module.d.ts

declare module '/dev/name.manifest.js' {
  export const imports: Record<string, string>
  export const domains: unknown
  export const resources: Record<string, string[]> | undefined

  export const nameManifest: {
    imports: Record<string, string>
    domains?: unknown
    resources?: Record<string, string[]>
  }
}

export {}
