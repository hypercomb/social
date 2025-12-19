import { Intent } from '../intent/intent.model'
import { CapabilityDoc } from './capability-doc.model'

export interface Capability<TOutput = unknown> {
  readonly capabilityId: string

  supports(intentId: string): boolean

  describe(): CapabilityDoc

  execute(intent: Intent): Promise<TOutput>
}
