// comfy-desk/chunks/chunks.ts
//
// THE PROMPT IN PIECES. The words typed are split at their clauses, each
// accepted direction is one more piece, and the strip stays on screen while
// the ideas are chosen so any piece can be taken out of the prompt on the
// spot. The prompt the form holds is always these pieces joined.

import { make, type ChunksHandle, type ChunksPart } from '../parts.js'

/** Clauses: commas, semicolons, full stops and line breaks end one. */
export const splitChunks = (text: string): readonly string[] =>
  text.split(/[,;.\n]+/).map(piece => piece.trim().replace(/\s+/g, ' ')).filter(Boolean)

export const joinChunks = (chunks: readonly string[]): string =>
  chunks.map(chunk => chunk.trim()).filter(Boolean).join(', ')

class Chunks implements ChunksHandle {
  readonly el = make('div', 'cd-chunks')
  readonly #events: Parameters<ChunksPart['create']>[0]
  readonly #empty: string
  readonly #remove: string

  constructor(events: Parameters<ChunksPart['create']>[0], say: Parameters<ChunksPart['create']>[1]) {
    this.#events = events
    this.#empty = say('comfy.chunks-empty', 'Nothing written yet')
    this.#remove = say('comfy.chunk-remove', 'take this out')
    this.el.setAttribute('role', 'list')
    this.el.setAttribute('aria-label', say('comfy.chunks', 'the prompt, in pieces'))
  }

  show(chunks: readonly string[], busy: boolean): void {
    this.el.toggleAttribute('data-busy', busy)
    if (!chunks.length) {
      this.el.replaceChildren(make('span', 'cd-chunk-empty', this.#empty))
      return
    }
    this.el.replaceChildren(...chunks.map((chunk, index) => {
      const piece = make('span', 'cd-chunk')
      piece.setAttribute('role', 'listitem')
      const words = make('span', 'cd-chunk-words', chunk)
      const out = make('button', 'cd-chunk-out')
      out.type = 'button'
      out.title = this.#remove
      out.setAttribute('aria-label', `${this.#remove}: ${chunk}`)
      out.textContent = '×'
      out.addEventListener('click', () => this.#events.onRemove(index))
      piece.append(words, out)
      return piece
    }))
  }
}

export const chunksPart: ChunksPart = {
  split: splitChunks,
  join: joinChunks,
  create: (events, say) => new Chunks(events, say),
}
