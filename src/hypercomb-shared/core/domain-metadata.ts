// src/app/core/domain-metadata.ts

export class DomainMetadataUtil {

  public static normalizeOrigin = (raw: string): string => {
    const value = raw.trim()

    try {
      const url = new URL(
        value.startsWith('http') ? value : `https://${value}`
      )

      // strip trailing slash only
      const normalized =
        `${url.protocol}//${url.host}${url.pathname}`.replace(/\/$/, '')

      return normalized + url.search + url.hash
    } catch {
      return value.replace(/\/$/, '')
    }
  }
}
