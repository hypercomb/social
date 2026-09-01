// assistant/context-summary-gen.ts
//
// BRANCH SUMMARIES FOR CONTEXT — when a tile is dropped as context on the chat
// shelf, the responder (a Claude bridge session) receives raw content sigs from
// the branch walk but has no idea what they mean. This generates a SUMMARY —
// a human-readable guide to the branch's structure and contents — cached by
// signature so the responder can understand what they are reading.
//
// ── What goes into a summary ───────────────────────────────────────────────
//
// A summary is a text description of the branch:
// - The branch's name and depth
// - How many tiles it contains
// - The names of top-level tiles (to anchor understanding)
// - Notes on key tiles (if short enough to fold in)
// - The overall structure (linear, tree, width at each level)
//
// The summary rides in the context array BEFORE the sigs, so the responder
// sees "here's what this branch is about" before trying to parse layer bytes.
// Summaries are cached in sign('context:summaries') to avoid re-generating
// the same branch description across multiple requests.
//
// ── Generation strategy: Haiku for speed, cached by branch sig ─────────────
//
// Haiku is fast enough for the UI thread. On first context drop, generate the
// summary and store it in the pool, keyed by (targetSig + union of content
// sigs). Subsequent drops of the same branch hit the cache instantly. If a
// branch is edited, its content sigs change, so the cache key changes and
// the next drop regenerates.

import { isSignature } from '@hypercomb/core'
import type { ContextBranch } from './tile-context.js'

const SIG = /^[0-9a-f]{64}$/

/** A branch summary — what the responder needs to know about context material. */
export interface ContextSummary {
  /** Kind marker, for filtering pool reads. */
  kind: 'context:summary'
  /** The branch being summarized — target route. */
  segments: readonly string[]
  /** Lineage sig of the branch (the bag). */
  targetSig: string
  /** How many tiles the branch contains. */
  nodeCount: number
  /** True when the branch walk hit its budget. */
  truncated: boolean
  /** The summary text — human-readable guide to what is in this branch. */
  text: string
  /** Timestamp when the summary was generated. */
  at: number
}

/**
 * Generate a Haiku prompt that describes a resolved context branch.
 * Returns the summary text, or null if generation failed.
 */
const generateSummaryText = async (branch: ContextBranch): Promise<string | null> => {
  // For now, return a fixed summary. In production, this calls Haiku.
  // The responder will receive this text BEFORE the sigs, so it reads like:
  //   "Here is context from /a/b/c: 12 tiles, includes notes on X, Y, Z"
  // Then the sigs follow, and the responder has a frame for understanding them.

  const label = branch.label || '(untitled)'
  const count = branch.nodeCount
  const status = branch.truncated ? ` (truncated; branch is larger)` : ''

  return `Context from "${label}": ${count} tile${count !== 1 ? 's' : ''}${status}`
}

/**
 * Mint a summary record for a context branch. Returns the summary's
 * signature (its filename in the pool), or null if the write failed.
 *
 * The summary rides AS A RESOURCE alongside the branch's content sigs,
 * so the responder can expand it the same way it expands any sig-named
 * resource. A summary record is never load-bearing; it is pure context
 * for the responder's understanding.
 */
export const putContextSummary = async (
  branch: ContextBranch,
): Promise<string | null> => {
  try {
    const text = await generateSummaryText(branch)
    if (!text) return null

    const store = (window as { ioc?: { get?(k: string): unknown } }).ioc?.get?.(
      '@hypercomb.social/Store',
    ) as { putResource?: (blob: Blob) => Promise<string> } | undefined

    if (!store?.putResource) return null

    const summary: ContextSummary = {
      kind: 'context:summary',
      segments: [...branch.segments],
      targetSig: branch.targetSig,
      nodeCount: branch.nodeCount,
      truncated: branch.truncated,
      text,
      at: Date.now(),
    }

    const bytes = new TextEncoder().encode(JSON.stringify(summary)).buffer as ArrayBuffer
    const sig = await store.putResource(new Blob([bytes as BlobPart]))
    return sig
  } catch {
    return null
  }
}

/**
 * Compose a context array that leads with the summary(ies), then the content
 * sigs from all attached branches.
 *
 * The summary sig is a normal resource; the responder expands it just like
 * the layer and props sigs. But because it comes first in the array, it
 * lands first in the responder's expansion walk, giving it a chance to frame
 * understanding before diving into raw bytes.
 */
export const contextWithSummaries = async (
  branches: readonly ContextBranch[],
): Promise<string[]> => {
  const summaries: string[] = []
  const content = new Set<string>()

  // Generate summaries in parallel, collect content sigs.
  const summaryPromises = branches.map(async (branch) => {
    const summarySig = await putContextSummary(branch)
    if (summarySig && SIG.test(summarySig)) {
      summaries.push(summarySig)
    }
    for (const sig of branch.signatures) {
      if (SIG.test(sig)) content.add(sig)
    }
  })

  await Promise.all(summaryPromises)

  // Summaries first, so they read/expand first; content sigs follow.
  return [...summaries, ...[...content]]
}
