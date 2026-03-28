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

const MANIFEST_FILE = 'manifest.json'

export const saveThread = async (
  threadsDir: FileSystemDirectoryHandle,
  manifest: ThreadManifest,
): Promise<void> => {
  const dir = await threadsDir.getDirectoryHandle(manifest.id, { create: true })
  const handle = await dir.getFileHandle(MANIFEST_FILE, { create: true })
  const writable = await handle.createWritable()
  try {
    await writable.write(JSON.stringify(manifest))
  } finally {
    await writable.close()
  }
}

export const loadThread = async (
  threadsDir: FileSystemDirectoryHandle,
  threadId: string,
): Promise<ThreadManifest | null> => {
  try {
    const dir = await threadsDir.getDirectoryHandle(threadId)
    const handle = await dir.getFileHandle(MANIFEST_FILE)
    const file = await handle.getFile()
    return JSON.parse(await file.text()) as ThreadManifest
  } catch {
    return null
  }
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
