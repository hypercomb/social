// assistant/providers/credential-owner.ts
//
// WHOSE KEY IS USED. A provider pays with its own key — or with the key of
// the configurator it came from: every model added through OpenRouter is its
// own provider (Jaime, 2026-09-13) and all of them use the one OpenRouter
// key, read grant and read budget. Every place that asks "is there a key",
// "which key", or "may it read" asks through this, so a model provider never
// needs a key row, a grant, or a budget of its own.

import type { LlmProviderDescriptor } from './llm-provider.types.js'

export const credentialOwner = (provider: Pick<LlmProviderDescriptor, 'id' | 'credentialsFrom'>): string =>
  provider.credentialsFrom ?? provider.id
