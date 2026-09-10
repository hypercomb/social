/** WHAT THE BEES ACTUALLY KNOW.
 *
 *  The chatter over the hive used to be pure boast — "my hive is bigger" —
 *  which is fine theatre for four seconds and worthless after that (Jaime,
 *  2026-09-09: *"tell something about the architecture, don’t just brag"*).
 *  A bee flying over THIS hive is standing on a real design, so it should be
 *  able to say a true thing about it.
 *
 *  Every beat below is a fact about how this system is actually built. They
 *  serve two masters and must stay true for both:
 *
 *  1. **Grounding for the model.** `HIVE_TOPICS[n].facts` is handed to the
 *     provider that writes a pair’s script, one topic per round, with a
 *     standing instruction not to invent architecture that is not in the
 *     list. This is why the generated banter can teach instead of puff.
 *  2. **The curated fallback.** `beats` are ready to speak as-is, so a hive
 *     with NO model configured — or one whose provider is down — still says
 *     something worth reading instead of the same eight boasts on a loop.
 *
 *  Keep a beat under ~155 characters: the bubble box is a fixed 154px wide at
 *  a fixed screen size, so length here becomes height on screen, not width.
 *
 *  If the architecture changes, these lines are wrong and must change with
 *  it. They are prose about doctrine, not decoration. */

export interface HiveTopic {
  /** Stable id, recorded on a pair’s cached script so a later round can ask
   *  for ground the pair has not already covered. */
  id: string
  /** How the topic is announced to the model. */
  title: string
  /** Terse, checkable statements. The model may rephrase, never extend. */
  facts: readonly string[]
  /** Speakable lines for the no-model path. */
  beats: readonly string[]
}

export const HIVE_TOPICS: readonly HiveTopic[] = [
  {
    id: 'signatures',
    title: 'content addressing — everything is named by the hash of its own bytes',
    facts: [
      'Every layer, drone, dependency and resource is named by the SHA-256 of its own bytes.',
      'Identical content yields an identical name, so the same thing is only ever stored once.',
      'Holding a signature IS the lookup: the file sits at the content root under that name. No index, no query.',
      'Content never mutates. An edit mints a new signature; the old one keeps resolving forever.',
    ],
    beats: [
      'Everything here is named by the hash of its own bytes. Say the same name twice and you said the same thing twice — it is stored once.',
      'There is no lookup table to consult. Hold a signature and the file is already addressed: the content root, then sixty-four hex characters.',
      'Nothing is ever edited in place. A change mints a new name and the old one still resolves, which is why undo costs nothing here.',
      'Two hives that built the same thing agree on its name without ever having met. Same bytes, same signature — that is the whole handshake.',
    ],
  },
  {
    id: 'layers',
    title: 'layers — a merkle protocol, recursive by default',
    facts: [
      'A layer is a list of the signatures it holds; signing that list signs everything beneath it.',
      'A layer holding layers is still just a layer. There is no container type and no special nesting case.',
      'Because a child is referenced by signature, a subtree can be shared or verified on its own.',
    ],
    beats: [
      'A layer is just a list of the signatures under it. Sign the list and you have signed the whole tree beneath it — that is the merkle trick.',
      'Nesting is not a special case here. A layer holding layers is still one layer. Composition all the way down, and no container class anywhere.',
      'Any branch can travel alone. It is referenced by signature, so a subtree verifies itself without the tree it grew on.',
    ],
  },
  {
    id: 'lineage',
    title: 'history — numbered markers, where the highest one is the present',
    facts: [
      'History is a folder of numbered marker files; the highest marker IS the current root.',
      'Undo re-points to the marker below rather than rewriting anything, so no past state is lost.',
      'History never branches: a change is a forward commit onto the same line.',
      'There is no separate publish step — a host serves whatever the top marker names.',
    ],
    beats: [
      'History is a folder of numbered markers, and the highest marker IS the present. No head pointer to corrupt, no branch to merge back.',
      'Undo just reads the marker below and re-points. Nothing is rewritten, so a state you once had is a state you can always get back to.',
      'There is no build step between making and publishing. The history entry IS the deploy — a host serves whatever the top marker names.',
    ],
  },
  {
    id: 'pools',
    title: 'pools of meaning — folder names derived from a word',
    facts: [
      'The only folders are signature-named: history bags, and pools whose name is the hash of a meaning word.',
      'A pool address is derived at runtime from the word, never hardcoded, so two hives agree on it without coordinating.',
      'There are no typed folders. The root is flat, sig-named files alongside signature-named folders.',
      'Because a word is an address, the same word is a search address across every community host.',
    ],
    beats: [
      'Folders are signatures too. The threads pool is literally the hash of the word “threads”, so two strangers agree where threads live.',
      'There is no folder called layers, or resources, or history. The root is flat, sig-named bytes plus folders that are themselves signatures.',
      'A word is an address. Ask the same word of every host in the swarm and you have asked all of them the exact same question.',
    ],
  },
  {
    id: 'modules',
    title: 'drones — every feature is an interchangeable signed module',
    facts: [
      'Features are drones: modules fetched from local storage by signature at runtime, registered under a name like @domain.com/Thing.',
      'The web shell imports none of them; it resolves them through a service locator, so any of them can be forked or swapped.',
      'Drones talk over a bus with last-value replay: a late subscriber is handed the last value immediately, so there is no timing race.',
      'Only the processor announces the end of a pulse, so one frame of work coalesces into a single repaint.',
    ],
    beats: [
      'Every feature is a module loaded at runtime by signature. The shell hardcodes none of it, which is why any of us can be forked and swapped.',
      'We talk over a bus that replays its last value. Subscribe late and you are handed what you missed, so nothing here races the boot.',
      'One voice ends the frame — the processor, after every drone has pulsed. That is why the hive repaints once instead of everyone at once.',
      'I am not built into this window. I am bytes with a signature, fetched and registered, and something better could take my name tomorrow.',
    ],
  },
  {
    id: 'replication',
    title: 'replication — bytes copy between hosts, and hosts stay dumb',
    facts: [
      'There is no installer. Bytes reach a reader by replication from whichever host holds them.',
      'The signature checks itself on arrival: a corrupted copy simply is not the file it claimed to be.',
      'Encryption keys stay on the client, so a host can serve content it cannot read.',
      'Sharing means handing over a name; the receiving side fetches only what it does not already hold.',
    ],
    beats: [
      'Nothing installs here. Bytes replicate from whatever host has them, and the signature checks itself — a bad copy is simply not the file.',
      'Hosts are deliberately dumb. The key never leaves the client, so a node can serve content it is unable to read. That is honest hosting.',
      'Sharing is handing over a name. Your side fetches only what it lacks, and most of a shared tree is usually already sitting in your store.',
    ],
  },
  {
    id: 'derived',
    title: 'derived caches — recomputable, never load-bearing',
    facts: [
      'Caches are keyed by the signature they were derived from, so a changed source has no record yet — invalidation is automatic.',
      'No read path may require a cache: a cold hive must produce the same answer from layers alone.',
      'Caches live in their own pools and can be wiped whole without losing anything true.',
    ],
    beats: [
      'Every cache is keyed by the signature it was derived from. Change the source and the cache simply has no entry — invalidation for free.',
      'No cache here is load-bearing. Delete all of them and a cold hive rebuilds the same answer out of layers alone, only slower.',
      'Speed and truth are kept in different folders on purpose. One of the two you are allowed to throw away at any moment.',
    ],
  },
  {
    id: 'artifacts',
    title: 'artifacts and marks — a creation stands alone, relations are worn',
    facts: [
      'A creation starts as one artifact carrying what it is; when it needs to be finer, it is broken apart into parts that each stand alone.',
      'Relations are marks the members wear, never a parent object that holds them.',
      'Classification lives on the tile as a mark, so regrouping never means editing code.',
      'Because a mark is worn rather than owned, one part can belong to several things at once.',
    ],
    beats: [
      'A creation is one artifact carrying what it is. Break it apart and every part stands alone — no parent object holding the pieces together.',
      'Relations are marks the members wear, not a box drawn around them. That is how a part belongs to two things without either one owning it.',
      'How things are grouped lives on the tile, not in the source. You can reclassify this whole hive without a single line of code changing.',
    ],
  },
]

/** Round-robin over the topics, wrapping in both directions. */
export const topicAt = (n: number): HiveTopic =>
  HIVE_TOPICS[((n % HIVE_TOPICS.length) + HIVE_TOPICS.length) % HIVE_TOPICS.length]

/** Every speakable beat, flattened — the fallback deck. */
export const loreBeats = (): readonly string[] => HIVE_TOPICS.flatMap(topic => topic.beats)
