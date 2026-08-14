// assistant-chat-config.ts — configuration facts shared by shell and services.

export const PARTICIPANT_AI_HOST_STORAGE_KEY = 'hc:ai-host'

/** Pure value seam: the bundled/default endpoint is deliberately excluded. */
export const participantAiHostConfiguredFor = (storedHost: string | null | undefined): boolean =>
  String(storedHost ?? '').trim().length > 0

/** Whether this participant explicitly named an AI host they control/use. */
export const isParticipantAiHostConfigured = (): boolean => {
  try {
    return participantAiHostConfiguredFor(
      globalThis.localStorage?.getItem(PARTICIPANT_AI_HOST_STORAGE_KEY),
    )
  } catch {
    return false
  }
}
