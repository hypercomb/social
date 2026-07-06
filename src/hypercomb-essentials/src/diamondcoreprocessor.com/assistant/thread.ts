// diamondcoreprocessor.com/assistant/thread.ts

import { SignatureService } from '@hypercomb/core'
import type { ChatMessage } from './llm-api.js'

// ── types ───────────────────────────────────────────────

export type ThreadTurn = {
  role: 'user' | 'assistant'
  contentSig: string
  tileName: string
  at: number
  meta?: {
    stopReason: string
    inputTokens: number
    outputTokens: number
  }
}

export type ThreadManifest = {
  id: string
  model: string
  systemPrompt: string
  turns: ThreadTurn[]
  createdAt: number
  updatedAt: number
}

// ── thread identity ─────────────────────────────────────

export const computeThreadId = async (
  systemPrompt: string,
  firstMessage: string,
): Promise<string> => {
  const encoder = new TextEncoder()
  const bytes = encoder.encode(systemPrompt + '\0' + firstMessage)
  return SignatureService.sign(bytes.buffer as ArrayBuffer)
}

// ── OPFS persistence ────────────────────────────────────

// Legacy fixed-name manifest — a read-fallback/drain source only. The
// manifest is now a CONTENT-ADDRESSED member of the (already sig-named)
// thread-id bucket: `<threads pool>/<threadId>/<sign(manifest bytes)>`.
// The signature is the address; no human filename. saveThread self-heals
// the legacy name on the next write; loadThread reads it until then.
const LEGACY_MANIFEST_FILE = 'manifest.json'
const SIG_RE = /^[0-9a-f]{64}$/

export const saveThread = async (
  threadsDir: FileSystemDirectoryHandle,
  manifest: ThreadManifest,
): Promise<void> => {
  const dir = await threadsDir.getDirectoryHandle(manifest.id, { create: true })
  const bytes = new TextEncoder().encode(JSON.stringify(manifest)).buffer as ArrayBuffer
  const sig = await SignatureService.sign(bytes)
  // Write the content-addressed member first...
  const handle = await dir.getFileHandle(sig, { create: true })
  const writable = await handle.createWritable()
  try {
    await writable.write(bytes)
  } finally {
    await writable.close()
  }
  // ...then drop any prior manifest (an older sig, or the legacy
  // `manifest.json`), leaving exactly one current document.
  for await (const [name, h] of (dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
    if (h.kind === 'file' && name !== sig) {
      try { await dir.removeEntry(name) } catch { /* raced; harmless */ }
    }
  }
}

const readThreadBucket = async (
  threadsDir: FileSystemDirectoryHandle,
  threadId: string,
): Promise<ThreadManifest | null> => {
  let dir: FileSystemDirectoryHandle
  try { dir = await threadsDir.getDirectoryHandle(threadId) } catch { return null }
  // Content-addressed member first...
  try {
    for await (const [name, h] of (dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
      if (h.kind !== 'file' || !SIG_RE.test(name)) continue
      const file = await (h as FileSystemFileHandle).getFile()
      if (file.size > 0) return JSON.parse(await file.text()) as ThreadManifest
    }
  } catch { /* fall through to the legacy name */ }
  // ...then the legacy fixed-name manifest (drains on next save).
  try {
    const handle = await dir.getFileHandle(LEGACY_MANIFEST_FILE)
    return JSON.parse(await (await handle.getFile()).text()) as ThreadManifest
  } catch { return null }
}

export const loadThread = async (
  threadsDir: FileSystemDirectoryHandle,
  threadId: string,
  legacyThreadsDir?: FileSystemDirectoryHandle,
): Promise<ThreadManifest | null> => {
  // sign('threads') pool bucket first, then the legacy `__threads__`
  // bucket during the drain window (Store's bucket-drain migrates it).
  return (await readThreadBucket(threadsDir, threadId))
    ?? (legacyThreadsDir ? await readThreadBucket(legacyThreadsDir, threadId) : null)
}

export const listThreads = async (
  threadsDir: FileSystemDirectoryHandle,
): Promise<string[]> => {
  const ids: string[] = []
  for await (const [name, handle] of (threadsDir as any).entries()) {
    if (handle.kind === 'directory') ids.push(name)
  }
  return ids
}

// ── message reconstruction ──────────────────────────────

export const buildMessages = async (
  getResource: (sig: string) => Promise<Blob | null>,
  manifest: ThreadManifest,
): Promise<ChatMessage[]> => {
  const messages: ChatMessage[] = []

  for (const turn of manifest.turns) {
    const blob = await getResource(turn.contentSig)
    if (!blob) continue
    const text = await blob.text()
    messages.push({ role: turn.role, content: text })
  }

  return messages
}
