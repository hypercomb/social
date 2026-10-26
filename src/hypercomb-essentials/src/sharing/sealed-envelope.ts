// sharing/sealed-envelope.ts
//
// THE ENVELOPE: HOW A PARTICIPANT GETS THE KEY (jwize 2026-10-25: "we can send the encrypted information there
// … and then the participants get the key to view it"; documentation/sealed-audiences.md, "What is new" item 1).
//
// A private branch is published as ciphertext; hosts carry bytes they cannot read. One secret (the DOOR) opens the
// key index that names the version's head and every atom's key. The door secret reaches each participant sealed to
// THEIR public key (NIP-44), so the envelope is public data that only that participant's private key opens. Nothing
// secret travels, and a host never sees a key.
//
//   { seal: 1, door: <sig of the sealed key index>, from: <publisher pubkey>, seals: { <member pubkey>: <NIP-44 payload> } }
//
// The publisher is always one of the members, so their other devices open it too. Removing a member governs FUTURE
// versions (republish under a new door secret): what someone already fetched they keep — inherent to replication.
//
// Pure: it takes a `Nip44` capability (the signer passes straight through) and does no I/O.

const SIG = /^[0-9a-f]{64}$/
const SECRET = /^[0-9a-f]{64}$/
export const ENVELOPE_MEMBERS_MAX = 64

/** What the signer lends: seal a text to a peer's public key, and open what a peer sealed to this key. */
export type Nip44 = {
  readonly encrypt: (peerPubkey: string, plaintext: string) => Promise<string | null>
  readonly decrypt: (peerPubkey: string, payload: string) => Promise<string | null>
}

export type Envelope = {
  readonly seal: 1
  /** The signature of the sealed key index this envelope's secret opens. */
  readonly door: string
  /** The publisher: whose key sealed every payload, so a member knows whose key to open it with. */
  readonly from: string
  readonly seals: Readonly<Record<string, string>>
}

/** A fresh door secret: 32 random bytes, hex. */
export const newDoorSecret = (random: (n: number) => Uint8Array = n => crypto.getRandomValues(new Uint8Array(n))): string =>
  [...random(32)].map(byte => byte.toString(16).padStart(2, '0')).join('')

/** Seal one door secret to every member (and to the publisher). Null when any seal could not be made: an envelope
 *  that silently leaves someone out is worse than none. */
export async function sealEnvelope(
  options: { door: string; secret: string; publisher: string; members: readonly string[] },
  nip44: Nip44,
): Promise<Envelope | null> {
  const { door, secret, publisher } = options
  if (!SIG.test(door) || !SECRET.test(secret) || !SIG.test(publisher)) return null
  const members = [...new Set([publisher, ...options.members.map(key => String(key).toLowerCase())])]
  if (members.some(key => !SIG.test(key)) || members.length > ENVELOPE_MEMBERS_MAX) return null
  const seals: Record<string, string> = {}
  for (const member of members) {
    const payload = await nip44.encrypt(member, secret).catch(() => null)
    if (!payload) return null
    seals[member] = payload
  }
  return { seal: 1, door, from: publisher, seals }
}

/** The door secret this key can open, or null when the envelope has no seal for it, or the seal does not open. */
export async function openEnvelope(envelope: Envelope, me: string, nip44: Nip44): Promise<string | null> {
  const mine = envelope.seals[String(me).toLowerCase()]
  if (!mine) return null
  const opened = await nip44.decrypt(envelope.from, mine).catch(() => null)
  return opened && SECRET.test(opened) ? opened : null
}

/** An envelope believed only as far as its shape: null for anything else. */
export const parseEnvelope = (raw: unknown): Envelope | null => {
  const record = raw as Record<string, unknown> | null
  if (!record || typeof record !== 'object' || record['seal'] !== 1) return null
  const door = String(record['door'] ?? '')
  const from = String(record['from'] ?? '')
  if (!SIG.test(door) || !SIG.test(from)) return null
  const given = record['seals']
  if (!given || typeof given !== 'object' || Array.isArray(given)) return null
  const seals: Record<string, string> = {}
  for (const [key, value] of Object.entries(given as Record<string, unknown>)) {
    if (!SIG.test(key) || typeof value !== 'string' || !value || value.length > 8192) return null
    seals[key] = value
    if (Object.keys(seals).length > ENVELOPE_MEMBERS_MAX) return null
  }
  return { seal: 1, door, from, seals }
}

/** The envelope's bytes: canonical (members in code-unit order), so the same envelope always has the same signature. */
export const envelopeBytes = (envelope: Envelope): Uint8Array => {
  const seals: Record<string, string> = {}
  for (const key of Object.keys(envelope.seals).sort()) seals[key] = envelope.seals[key]!
  return new TextEncoder().encode(JSON.stringify({ seal: 1, door: envelope.door, from: envelope.from, seals }))
}

/** Who is in the audience: visible by design (a decision of 2026-10-02), never what they can read. */
export const envelopeMembers = (envelope: Envelope): string[] => Object.keys(envelope.seals).sort()
