// sharing/meeting-invite-secret.spec.ts — a stored invite never holds its
// secret (jwize, 2026-10-07: "the key can never be stored in a pool or
// public place"); it carries a check, and only the matching secret opens it.

import { describe, expect, it } from 'vitest'
import {
  MEETING_INVITE_KIND, MEETING_INVITE_VERSION, encodeInviteBundle, inviteSecretCheck,
  resolveInviteSecret, validateInviteBundle,
} from './meeting-invite.js'

describe('the invite bundle and its secret', () => {
  it('stores a check, never the secret, and still reads an older bundle that held it', async () => {
    const secretCheck = await inviteSecretCheck('downtown', 'river-stone')
    const bundle = { kind: MEETING_INVITE_KIND, v: MEETING_INVITE_VERSION, segments: ['cafe'], room: 'downtown', secretCheck }
    const blob = encodeInviteBundle({ ...bundle, secret: 'river-stone' })
    const stored = await new Promise<string>(resolve => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.readAsText(blob)
    })
    expect(stored).not.toContain('river-stone')
    expect(validateInviteBundle(JSON.parse(stored))).toMatchObject({ room: 'downtown', secretCheck })
    // Minted before 2026-10-07: the secret inside still opens it.
    expect(validateInviteBundle({ kind: MEETING_INVITE_KIND, room: 'downtown', secret: 'old' })?.secret).toBe('old')
    // Neither: not an invite.
    expect(validateInviteBundle({ kind: MEETING_INVITE_KIND, room: 'downtown' })).toBeNull()
  })

  it('opens only with the secret that matches its check', async () => {
    const secretCheck = await inviteSecretCheck('downtown', 'river-stone')
    const bundle = validateInviteBundle({ kind: MEETING_INVITE_KIND, room: 'downtown', secretCheck })!
    expect(await resolveInviteSecret(bundle, ['wrong', 'river-stone'])).toBe('river-stone')
    expect(await resolveInviteSecret(bundle, ['wrong', '', undefined])).toBeNull()
  })
})
