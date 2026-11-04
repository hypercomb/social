// core/nostr-kinds.ts
//
// THE ONE VOCABULARY OF NOSTR KINDS. A kind is a protocol number on the wire,
// the handler an event is for, never a meaning: meanings are pools, derived
// from a name (P1, P2). Every kind the hive speaks or hears is named here
// once, with one line on what rides it. A bee imports the name and never
// restates the number: the same five digits typed in three files is how a
// handler and a filter drift apart without anyone seeing it.
//
// A kind is never reused. A retired one stays in the table, marked, because
// an older build still sends it and a relay still replays it (H3).
//
// Ranges (NIP-01): 20000-29999 ephemeral, never stored by the relay;
// 30000-39999 parameterized replaceable, one stored event per (pubkey, kind,
// d-tag); 27235 is the NIP-98 HTTP authorization envelope.
//
// Core, not essentials: the eager boot lane (doctrine.spec.ts) admits no new
// essentials module into content-broker's or host-sync's static graph, and
// core is already where NIP98_KIND and KEY_LIST_KIND live.

import { KEY_LIST_KIND } from './key-list.js'
import { NIP98_KIND } from './nip98.js'

// ── ephemeral (20000-29999) ───────────────────────────────────────────────────

/** Content broker ask: "who holds this sig?" (`d` = sig, `t` = type). */
export const KIND_FETCH_REQUEST = 20400
/** Content broker stand-down: the asker has verified bytes, stop preparing. */
export const KIND_FETCH_CANCEL = 20402
/** Device pairing: a signal at the pair's rendezvous address. */
export const DEVICE_SIGNAL_KIND = 20573
/** The hive meeting's paired-channel frame (show-cell, hive-meeting). */
export const HIVE_MEETING_KIND = 29010
/** Meeting signalling (WebRTC offers/answers) — also the computation drone's
 *  job frames, on their own channel sig. One number, two speakers: named so
 *  nobody takes a third. */
export const MEETING_SIGNAL_KIND = 29011

// ── authorization ────────────────────────────────────────────────────────────

/** NIP-98: the signed envelope a host asks of every HTTP write. */
export const NIP98_AUTH_KIND = NIP98_KIND

// ── parameterized replaceable (30000-39999) ──────────────────────────────────

/** Swarm layer: a page's visuals (`d` = composed location sig). */
export const SWARM_LAYER_KIND = 30200
/** Swarm resource: content-addressed bytes (`d` = sha256 of the bytes). */
export const SWARM_RESOURCE_KIND = 30201
/** Swarm hide list: a key's hidden tile names per lineage (`d` = lineage sig). */
export const SWARM_HIDE_KIND = 30202
/** Swarm interest, drill request and standing (`d` = `parent:child` or `drill:<pubkey>`). */
export const SWARM_INTEREST_KIND = 30203
/** Swarm presence: where a participant stands (`d` = their presence sig). */
export const SWARM_PRESENCE_KIND = 30204
/** Swarm subscribe request: "X wants your broadcasts" at the leader's channel. */
export const SWARM_SUBSCRIBE_REQUEST_KIND = 30205
/** Swarm lifecycle: `{alive}` beacon or `{left}` tombstone (`d` = the key it speaks for). */
export const SWARM_LIFECYCLE_KIND = 30206
/** Client presence record on the room's presence channel (`d` = `c:<id>`). */
export const CLIENT_PRESENCE_KIND = 30207
/** Swarm withheld behaviours: the decoration kinds a key holds back (`d` = the key). */
export const SWARM_BEHAVIOR_KIND = 30208
/** Feedback channel item, store-and-forward for seven days (`d` = `i:<sig>`). */
export const FEEDBACK_ITEM_KIND = 30213
/** Peer models: a lender's offer of a local model. */
export const PEER_MODEL_OFFER_KIND = 30215
/** Peer models: a borrower's job request in the lender's inbox. */
export const PEER_MODEL_REQUEST_KIND = 30216
/** Peer models: the lender's reply to one job. */
export const PEER_MODEL_REPLY_KIND = 30217
/** Pheromone deposit: a signed interest signal on a signature (R1). */
export const PHEROMONE_DEPOSIT_KIND = 30218
/** Remote change channel item: a sealed change offered to the hive (`d` = `c:<tag>`). */
export const CHANGE_ITEM_KIND = 30219
/** Content broker answer: the bytes, or one chunk of them (`d` = sig or `sig#i`). */
export const KIND_FETCH_RESPONSE = 30401
/** A hive's index event behind a hive link. */
export const HIVE_INDEX_EVENT_KIND = 30564
/** Head claim: a publisher's signed word on a root's current head (T2 authority). */
export const HEAD_CLAIM_KIND = 30565
/** Vocabulary claim: a signed molecule vocabulary. */
export const VOCABULARY_CLAIM_KIND = 30566
/** Room pool membership record. */
export const ROOM_MEMBER_KIND = 30567
/** Calendar RSVP. */
export const RSVP_KIND = 30568
/** Room notice: the session-start notice re-posted while a session runs. */
export const ROOM_NOTICE_KIND = 30569
/** Key list: who may sign for an anchor (core key-list.ts). */
export const KEY_LIST_EVENT_KIND = KEY_LIST_KIND
/** Device delegation: an anchor lets a device publish for it. */
export const DEVICE_DELEGATION_KIND = 30571
/** Device proof: the paired device's handshake proof. */
export const DEVICE_PROOF_KIND = 30572

export type NostrKindEntry = {
  readonly kind: number
  readonly name: string
  readonly meaning: string
  /** Retired: nothing sends it now; the number stays taken (H3). */
  readonly retired?: true
}

/** The table behind the names: one row per kind, retired rows included. */
export const NOSTR_KINDS: readonly NostrKindEntry[] = Object.freeze([
  { kind: KIND_FETCH_REQUEST, name: 'KIND_FETCH_REQUEST', meaning: 'content broker ask: who holds this sig' },
  { kind: KIND_FETCH_CANCEL, name: 'KIND_FETCH_CANCEL', meaning: 'content broker stand-down: bytes verified, stop preparing' },
  { kind: 20410, name: 'CONSENT_REQUEST', meaning: 'granted-host consent handshake request — reserved, never built', retired: true },
  { kind: DEVICE_SIGNAL_KIND, name: 'DEVICE_SIGNAL_KIND', meaning: 'device pairing rendezvous signal' },
  { kind: HIVE_MEETING_KIND, name: 'HIVE_MEETING_KIND', meaning: 'hive meeting paired-channel frame' },
  { kind: MEETING_SIGNAL_KIND, name: 'MEETING_SIGNAL_KIND', meaning: 'meeting signalling; also the computation drone, on its own channel' },
  { kind: NIP98_AUTH_KIND, name: 'NIP98_AUTH_KIND', meaning: 'NIP-98 HTTP write authorization envelope' },
  { kind: SWARM_LAYER_KIND, name: 'SWARM_LAYER_KIND', meaning: 'swarm layer: a page\'s visuals at a composed location' },
  { kind: SWARM_RESOURCE_KIND, name: 'SWARM_RESOURCE_KIND', meaning: 'swarm resource: content-addressed bytes' },
  { kind: SWARM_HIDE_KIND, name: 'SWARM_HIDE_KIND', meaning: 'swarm hide list per key and lineage' },
  { kind: SWARM_INTEREST_KIND, name: 'SWARM_INTEREST_KIND', meaning: 'swarm interest, drill request, standing' },
  { kind: SWARM_PRESENCE_KIND, name: 'SWARM_PRESENCE_KIND', meaning: 'swarm presence: where a participant stands' },
  { kind: SWARM_SUBSCRIBE_REQUEST_KIND, name: 'SWARM_SUBSCRIBE_REQUEST_KIND', meaning: 'swarm subscribe request at a leader\'s channel' },
  { kind: SWARM_LIFECYCLE_KIND, name: 'SWARM_LIFECYCLE_KIND', meaning: 'swarm lifecycle: alive beacon or left tombstone' },
  { kind: CLIENT_PRESENCE_KIND, name: 'CLIENT_PRESENCE_KIND', meaning: 'client presence record' },
  { kind: SWARM_BEHAVIOR_KIND, name: 'SWARM_BEHAVIOR_KIND', meaning: 'swarm withheld behaviours' },
  { kind: 30210, name: 'FEEDBACK_CONSENT_REQUEST', meaning: 'feedback consent handshake — retired with the feedback window', retired: true },
  { kind: 30211, name: 'FEEDBACK_CONSENT_GRANT', meaning: 'feedback consent handshake — retired with the feedback window', retired: true },
  { kind: 30212, name: 'FEEDBACK_CONSENT_REVOKE', meaning: 'feedback consent handshake — retired with the feedback window', retired: true },
  { kind: FEEDBACK_ITEM_KIND, name: 'FEEDBACK_ITEM_KIND', meaning: 'feedback channel item, store-and-forward' },
  { kind: 30214, name: 'FEEDBACK_REPLY', meaning: 'per-recipient feedback reply — retired with the feedback window', retired: true },
  { kind: PEER_MODEL_OFFER_KIND, name: 'PEER_MODEL_OFFER_KIND', meaning: 'peer models: a lender\'s offer' },
  { kind: PEER_MODEL_REQUEST_KIND, name: 'PEER_MODEL_REQUEST_KIND', meaning: 'peer models: a job request' },
  { kind: PEER_MODEL_REPLY_KIND, name: 'PEER_MODEL_REPLY_KIND', meaning: 'peer models: a job reply' },
  { kind: PHEROMONE_DEPOSIT_KIND, name: 'PHEROMONE_DEPOSIT_KIND', meaning: 'pheromone deposit on a signature' },
  { kind: CHANGE_ITEM_KIND, name: 'CHANGE_ITEM_KIND', meaning: 'remote change channel item' },
  { kind: KIND_FETCH_RESPONSE, name: 'KIND_FETCH_RESPONSE', meaning: 'content broker answer: the bytes or one chunk' },
  { kind: 30411, name: 'CONSENT_GRANT', meaning: 'granted-host consent record — reserved, never built', retired: true },
  { kind: HIVE_INDEX_EVENT_KIND, name: 'HIVE_INDEX_EVENT_KIND', meaning: 'hive index event behind a hive link' },
  { kind: HEAD_CLAIM_KIND, name: 'HEAD_CLAIM_KIND', meaning: 'head claim: a publisher\'s signed word on a root\'s head' },
  { kind: VOCABULARY_CLAIM_KIND, name: 'VOCABULARY_CLAIM_KIND', meaning: 'vocabulary claim: a signed molecule vocabulary' },
  { kind: ROOM_MEMBER_KIND, name: 'ROOM_MEMBER_KIND', meaning: 'room pool membership record' },
  { kind: RSVP_KIND, name: 'RSVP_KIND', meaning: 'calendar RSVP' },
  { kind: ROOM_NOTICE_KIND, name: 'ROOM_NOTICE_KIND', meaning: 'room notice: the session-start notice' },
  { kind: KEY_LIST_EVENT_KIND, name: 'KEY_LIST_EVENT_KIND', meaning: 'key list: who may sign for an anchor' },
  { kind: DEVICE_DELEGATION_KIND, name: 'DEVICE_DELEGATION_KIND', meaning: 'device delegation: an anchor lets a device publish for it' },
  { kind: DEVICE_PROOF_KIND, name: 'DEVICE_PROOF_KIND', meaning: 'device proof: the paired device\'s handshake proof' },
])

/** The vocabulary's row for a kind, or undefined for a number nobody named. */
export const nostrKindEntry = (kind: number): NostrKindEntry | undefined =>
  NOSTR_KINDS.find(k => k.kind === kind)

/** Kinds whose `d` tag names the key the event speaks for: one slot per key,
 *  and an event in it is admitted only when `d` is its own pubkey (T2
 *  authority — nobody tombstones, beacons or withholds for another key). */
export const SPEAKS_FOR_KINDS: ReadonlySet<number> = new Set([SWARM_LIFECYCLE_KIND, SWARM_BEHAVIOR_KIND])
