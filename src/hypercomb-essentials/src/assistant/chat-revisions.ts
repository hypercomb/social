// assistant/chat-revisions.ts
//
// A CONVERSATION BELONGS TO THE REVISION IT WAS HELD IN (jwize, 2026-11-16:
// "are the ai chats per instance or shared between revisions", then "there
// should be the ability to read all revisions but only have the ai chats for
// that instance").
//
// A conversation about a site is about work in progress. Opening another
// revision of the site should bring back the conversations that built it, and
// not the ones from a different line of work.
//
// NOTHING IS STAMPED ON A CONVERSATION. Which revision it belongs to is READ:
// the site's build records say which line was in hand at any moment
// (history/revision-lines.ts `lineAt`), and a conversation's turns say when
// it was held. So a conversation belongs to the line in hand when it began,
// and to the line in hand when it was last continued: a conversation carried
// on through "save under a new name" is in both, which is true of it. Work
// done before the first save belongs to the first line.
//
// The id is untouched (`chat:tile:/route[::seed]`), so every mint site, row
// mark, draft key and ask target works as it did, and a conversation minted
// by a path that knows nothing of revisions is still placed correctly.
//
// ONLY ON A MANAGED SITE DOOR, for the site's tile and the tiles under it. A
// hive's build passes mint records under many names (a site regen, a game
// stamp), and there a new label is not a participant changing what they work
// on: no conversation in the hive is hidden by one.

import { readBuildsAt, type BuildRecord } from '../history/builds-slot.js'
import { currentLine, lineAt, lineKey } from '../history/revision-lines.js'
import { managedSiteSegments } from '../sharing/managed-record.js'

/** What the rule reads of a conversation. */
export type RevisionConvo = {
  readonly convoId: string
  readonly startedAt?: number
  readonly lastAt?: number
}

/** A fresh conversation's id carries the moment it was minted
 *  (`…::<ms>-<random>`, chat-thread.ts newTileConvoId). 0 when it does not. */
const mintedAt = (convoId: string): number => {
  const cut = convoId.indexOf('::')
  if (cut < 0) return 0
  const stamp = /^(\d{12,14})-/.exec(convoId.slice(cut + 2))?.[1]
  return stamp ? Number(stamp) : 0
}

/** When a conversation began: its first turn, else the moment its id was
 *  minted, else 0 (a conversation nobody has spoken in yet). */
export const beganAt = (convo: RevisionConvo): number =>
  (convo.startedAt && convo.startedAt > 0 ? convo.startedAt : 0) || mintedAt(convo.convoId)

/**
 * Is this conversation one of the revision in hand? Always, while the tile
 * has no revisions. A conversation nobody has spoken in belongs to the line
 * in hand: it begins when it is first spoken in.
 */
export const conversationInLine = (records: readonly BuildRecord[], convo: RevisionConvo): boolean => {
  if (!records.length) return true
  const current = lineKey(currentLine(records))
  const began = beganAt(convo)
  if (!began) return true
  if (lineKey(lineAt(records, began)) === current) return true
  const last = convo.lastAt ?? 0
  return last > began && lineKey(lineAt(records, last)) === current
}

const pathOf = (segments: readonly string[]): string => '/' + segments.join('/')

/** The site's records on a managed site door, with the path they cover.
 *  Null on every other page, and when they cannot be read. */
export async function siteRevisionRecords(): Promise<{ readonly path: string; readonly records: readonly BuildRecord[] } | null> {
  const site = managedSiteSegments()
  if (!site?.length) return null
  try { return { path: pathOf(site), records: await readBuildsAt(site) } } catch { return null }
}

/**
 * Part a list of conversations into the ones a managed site door shows now
 * and the ones that belong to another revision of the site. Every
 * conversation is `held` on any other page. `path` is the tile a
 * conversation is about (`/business-card`, `/business-card/back`).
 */
export async function partByRevision<T extends RevisionConvo & { readonly path: string }>(
  chats: readonly T[],
): Promise<{ readonly held: T[]; readonly elsewhere: T[] }> {
  const site = await siteRevisionRecords()
  if (!site || !site.records.length) return { held: [...chats], elsewhere: [] }
  const held: T[] = []
  const elsewhere: T[] = []
  for (const chat of chats) {
    const under = chat.path === site.path || chat.path.startsWith(site.path + '/')
    if (!under || conversationInLine(site.records, chat)) held.push(chat)
    else elsewhere.push(chat)
  }
  return { held, elsewhere }
}
