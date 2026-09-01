// assistant/change-channel.ts
//
// ONE CHANNEL, INCLUDING YOUR OWN.
//
// A change made by the hive you are sitting in front of, and a change built
// for you on someone else's machine, are the same kind of thing: a set of
// updates addressed to a hive, which that hive ingests and is prompted about.
// So there is no "local path" and "remote path" — there is a channel, and the
// local hive has its own private signature on it.
//
// That is the point of doing it this way rather than special-casing local. The
// everyday case exercises the exact code the remote case depends on, so the
// remote path cannot rot unnoticed between uses; and a change is addressed the
// same way no matter who produced it, so nothing downstream has to ask where
// it came from.
//
// THE ADDRESS IS DERIVED FROM A SECRET, NOT PUBLISHED.
//
// The feedback channel derives its rendezvous from a FIXED constant
// (`sha256("hc:feedback-channel\0" + canonicalHost)`) so the whole community
// converges with no key exchange. That is right for feedback and wrong here:
// changes carry your tile names, your structure, and instructions that a
// parked session will act on. A publicly derivable address would let anyone
// who knows the scheme compute where to listen — or where to write.
//
// So the change channel is derived from a SHARED SECRET instead:
//
//   channelId = sha256("hc:change-channel\0" + secret)
//
// Same shape, one input changed — the secret replaces the constant. Set the
// same secret on your host and on each browser you use, and they meet; nobody
// without it can compute the address.
//
// WHAT THIS DOES AND DOES NOT GIVE YOU. An unguessable address makes the
// rendezvous private, NOT the payload. Anything relayed is still visible to
// whoever carries it, so a channel that leaves the machine needs the records
// encrypted to a key derived from the same secret — the channel id being only
// the public half. That is deliberately NOT implemented here: this file
// addresses changes, and a local channel never leaves the device. Do not
// enable a remote transport on top of this until the payload half exists,
// or "private" will mean "obscure".
//
// The secret is read from localStorage and never travels. This code neither
// prompts for it nor transmits it; setting it is the participant's act.

/** Where the participant's channel secret lives. Never sent anywhere. */
export const CHANGE_SECRET_KEY = 'hc:change-channel:secret'

/** Explicit channel id, when you want to target one directly and skip
 *  derivation entirely (mirrors the feedback channel's own escape hatch). */
export const CHANGE_CHANNEL_KEY = 'hc:change-channel:id'

const DOMAIN = 'hc:change-channel\0'

const sha256Hex = async (text: string): Promise<string> => {
  const bytes = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest('SHA-256', bytes.buffer as ArrayBuffer)
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

const readLocal = (key: string): string => {
  try { return String(window.localStorage.getItem(key) ?? '').trim() } catch { return '' }
}

/**
 * This hive's channel address.
 *
 * Order: an explicit id wins; otherwise derive from the secret; otherwise
 * fall back to a PER-INSTALL private id so an unconfigured hive still has a
 * channel of its own rather than sharing a default with every other install.
 * A shared default would be the worst outcome — every unconfigured hive
 * meeting on one address, which looks like it works right up until two of
 * them see each other's changes.
 */
export const changeChannelId = async (): Promise<string> => {
  const explicit = readLocal(CHANGE_CHANNEL_KEY)
  if (/^[0-9a-f]{64}$/.test(explicit)) return explicit

  const secret = readLocal(CHANGE_SECRET_KEY)
  if (secret) return sha256Hex(DOMAIN + secret)

  return sha256Hex(DOMAIN + localInstallSeed())
}

/** True when the participant has set a shared secret — i.e. this hive can
 *  meet their other devices. Without one the channel is still valid, just
 *  private to this install. */
export const changeChannelIsShared = (): boolean => !!readLocal(CHANGE_SECRET_KEY)

/** A random per-install value, minted once and kept locally. Not a secret to
 *  share — its only job is keeping unconfigured installs apart. */
const SEED_KEY = 'hc:change-channel:install'
const localInstallSeed = (): string => {
  const existing = readLocal(SEED_KEY)
  if (existing) return existing
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const seed = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('')
  try { window.localStorage.setItem(SEED_KEY, seed) } catch { /* private mode — a per-session channel still beats a shared one */ }
  return seed
}
