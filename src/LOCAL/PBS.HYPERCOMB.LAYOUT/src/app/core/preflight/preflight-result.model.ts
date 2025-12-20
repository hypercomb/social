// src/app/core/preflight/preflight-result.model.ts

export interface PreflightResult {
  allowed: boolean
  reason?: string
  targets: string[]      // resolved execution targets
}
