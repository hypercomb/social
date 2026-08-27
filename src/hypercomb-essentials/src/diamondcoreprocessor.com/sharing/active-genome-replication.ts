import type { ActiveGenomeService } from '../history/active-genome.service.js'
import type { ActiveGenomeMissing } from '../history/active-genome.js'
import type { SignatureReplicationService } from './signature-replication.service.js'

export type ActiveGenomeReplicationResult = {
  accepted: boolean
  inventorySignature: string | null
  inventoryObjects: number
  missing: ActiveGenomeMissing[]
  complete: boolean
}

/** Submit the computed active-genome record as an exact inventory. The relay
 * verifies and fetches the record plus only its enumerated current atoms; it
 * does not recursively follow carried roots into stale leaf generations. */
export async function replicateActiveGenome(
  replication: SignatureReplicationService,
  activeGenome: ActiveGenomeService,
  domain: string,
  sources: string[],
): Promise<ActiveGenomeReplicationResult> {
  const record = await activeGenome.current(true)
  const inventorySignature = activeGenome.recordSig
  const missing = record?.missing ? [...record.missing] : []
  if (!record || !inventorySignature) {
    return { accepted: false, inventorySignature: null, inventoryObjects: 0, missing, complete: false }
  }
  const exact = new Set<string>()
  for (const head of record.heads) {
    if (head.marker) exact.add(head.marker)
    exact.add(head.layer)
  }
  for (const object of record.objects) exact.add(object.sig)
  const accepted = await replication.replicate(domain, {
    signature: inventorySignature,
    sources,
    inventory: true,
    limit: exact.size + 1,
  })
  return {
    accepted,
    inventorySignature,
    inventoryObjects: exact.size,
    missing,
    complete: record.complete && missing.length === 0,
  }
}
