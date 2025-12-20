import { Intent } from '../intent/models/intent.model'
import { CapabilityDoc } from './capability-doc.model'

export interface Capability<TOutput = unknown> {
  readonly capabilityId: string

  supports(intent: string): boolean

  describe(): CapabilityDoc

  execute(intent: Intent): Promise<TOutput>
}
