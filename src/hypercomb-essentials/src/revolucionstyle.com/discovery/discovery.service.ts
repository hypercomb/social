// revolucionstyle.com/discovery/discovery.service.ts
import type { FlavorProfile, JournalEntry } from '../journal/journal-entry.js'

export class DiscoveryService {

  readonly similarity = (a: FlavorProfile, b: FlavorProfile): number => {
    const setA = new Set(a.selected)
    const setB = new Set(b.selected)
    if (setA.size === 0 && setB.size === 0) return 1

    let intersection = 0
    for (const id of setA) {
      if (setB.has(id)) intersection++
    }

    const union = setA.size + setB.size - intersection
    return union === 0 ? 0 : intersection / union
  }

  readonly findSimilar = (
    target: FlavorProfile,
    entries: { sig: string; entry: JournalEntry }[],
    threshold = 0.2,
  ): { sig: string; entry: JournalEntry; score: number }[] => {
    return entries
      .map(e => ({ ...e, score: this.similarity(target, e.entry.flavors) }))
      .filter(e => e.score >= threshold)
      .sort((a, b) => b.score - a.score)
  }
}

window.ioc.register(
  '@revolucionstyle.com/DiscoveryService',
  new DiscoveryService(),
)
