// src/app/core/capabilities/capability-bootstrap.ts

import { CapabilityScanner } from './capability-scanner'
import { HasSelectionCapability } from './impl/has-selection.capability'

export function registerCapabilities(scanner: CapabilityScanner): void {
  scanner.register(new HasSelectionCapability())
}
