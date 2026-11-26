// several-writes.ts
//
// SEVERAL FILES IN ONE REPLY (core work-fence.ts WRITES_PER_REPLY). A reply
// used to carry exactly one write block, so a change across a page, its
// script and its styles cost three rounds. Now each block of one reply is
// made in the order written, each as its own write: its own row in Execution,
// its own hold, its own hand.
//
// A block that is refused after an earlier one was made does not throw the
// earlier ones away: the model is told which was not made and that the ones
// after it were not tried, so it never believes a file exists that does not.
// A refusal of the FIRST block is thrown as it always was, and so is a stop
// or any failure that is not a refusal.
//
// A reply that mixes change blocks with write blocks (core work-fence.ts
// WorkStep) runs here too, every block a step in the order written, so a
// tile is made and its page written in one round. So does a Jev turn, where
// each block is judged on its own before it runs.
//
// Pure: the chat window hands it the blocks and the one-block runner.

export type SeveralWritesDeps<Block = readonly string[]> = {
  /** Run one block; resolves to what the model is told, rejects when it cannot be made. */
  readonly run: (block: Block, at: number) => Promise<string>
  /** A rejection the model can act on (a refused block), as opposed to a stop or a fault. */
  readonly refused: (error: unknown) => boolean
  /** The participant stopped the turn. */
  readonly stopped: () => boolean
  /** What one block is called to the model: "Write" (the default) or "Step". */
  readonly noun?: string
}

export const runSeveralWrites = async <Block = readonly string[]>(blocks: readonly Block[], deps: SeveralWritesDeps<Block>): Promise<string> => {
  if (blocks.length === 1) return deps.run(blocks[0]!, 0)
  const noun = deps.noun ?? 'Write'
  const said: string[] = []
  for (const [at, block] of blocks.entries()) {
    try {
      said.push(`${noun} ${at + 1} of ${blocks.length}:\n${await deps.run(block, at)}`)
    } catch (error) {
      if (!said.length || deps.stopped() || !deps.refused(error)) throw error
      const after = blocks.length - at - 1
      const reason = error instanceof Error ? error.message : String(error)
      said.push(`${noun} ${at + 1} of ${blocks.length} was NOT made: ${reason}.${after ? ` The ${after} after it ${after === 1 ? 'was' : 'were'} not tried.` : ''}`)
      break
    }
  }
  return said.join('\n\n')
}
