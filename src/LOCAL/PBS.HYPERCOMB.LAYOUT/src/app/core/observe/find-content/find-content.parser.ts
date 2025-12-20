import { Injectable } from '@angular/core'
import { FindContentQuery, FindContentScope } from './find-content.model'

@Injectable({ providedIn: 'root' })
export class FindContentParser {
  public parse(text: string): FindContentQuery | null {
    const raw = text.trim()
    if (!raw) return null

    const lowered = raw.toLowerCase()
    const isFind =
      lowered.startsWith('find content') ||
      lowered.startsWith('find.content') ||
      lowered.startsWith('search content') ||
      lowered.startsWith('grep ')

    if (!isFind) return null

    return {
      raw,
      pattern: this.parsePattern(raw),
      scope: this.parseScope(lowered),
      caseSensitive: !lowered.includes('nocase') && !lowered.includes('-i')
    }
  }

  private parseScope(lowered: string): FindContentScope {
    if (lowered.includes('history')) return 'history'
    if (lowered.includes('windows')) return 'windows'
    if (lowered.includes('all')) return 'all'
    return 'source'
  }

  private parsePattern(raw: string): string {
    const quoted = /["']([^"']+)["']/.exec(raw)
    if (quoted?.[1]) return quoted[1].trim()

    const idx = raw.toLowerCase().indexOf('find content')
    if (idx >= 0) return raw.substring(idx + 12).trim()

    return raw.split(/\s+/).slice(1).join(' ').trim()
  }
}
