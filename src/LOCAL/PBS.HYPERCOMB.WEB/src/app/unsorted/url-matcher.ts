
import { UrlMatchResult, UrlSegment } from '@angular/router'

export function customUrlMatcher(segments: UrlSegment[]): UrlMatchResult | null {

    if (segments.length === 0) {
        return null
    }

    const fullPath = segments.map(segment => segment.path).join('/')
    const hashIndex = fullPath.indexOf('#')

    if (hashIndex > -1) {
        const hive = fullPath.substring(0, hashIndex + 4) // Include #1000 part
        const identifier = fullPath.substring(hashIndex + 5)

        return {
            consumed: segments,
            posParams: {
                hive: new UrlSegment(hive, {}),
                identifier: new UrlSegment(identifier, {})
            }
        }
    } else if (segments.length === 1) {
        return {
            consumed: segments,
            posParams: {
                hive: segments[0]
            }
        }
    }

    return null
}


