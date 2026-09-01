// comfy/comfy-folder.ts
//
// THE LIVE CONNECTION — ComfyUI's own folder, opened from Windows Explorer.
//
// A ComfyUI install is tens of gigabytes of checkpoints, LoRAs, VAEs and an
// output folder that grows forever. NONE OF THAT MAY EVER ENTER THIS SYSTEM.
// A hive is content-addressed and everything in it travels — to a publish, to
// an adopter, into a deploy — so a copied model folder would not just be
// large, it would be large FOREVER and in every direction.
//
// So the connection is LIVE, not a copy. The participant points Hypercomb at
// their ComfyUI folder once, in the ordinary Windows file picker
// (`showDirectoryPicker` — the same door /folder-sync and the substrate use),
// the browser keeps the handle, and from then on the pictures are READ WHERE
// THEY LIE. Browsing costs nothing but a preview URL; the file stays on disk,
// owned by ComfyUI, deleted by ComfyUI, and never mirrored anywhere.
//
// EXACTLY ONE PICTURE EVER CROSSES: the one the participant keeps. Putting a
// picture on a tile means it is theirs and it must travel with the tile, so
// that one is copied into the store like any dropped image — and even that is
// size-capped (`MAX_IMPORT_BYTES`), because a 200-megapixel upscale on a tile
// face is a mistake the whole network would have to carry.
//
// IT IS ALSO THE FASTER DOOR. Reading a finished picture off disk needs no
// CORS header, no `/view` round trip and no second copy in ComfyUI's memory —
// so a participant who has linked the folder can generate even if their
// server was started without `--enable-cors-header` (the queue still needs
// HTTP; the pictures no longer do).

import { EffectBus } from '@hypercomb/core'
import {
  getHandle,
  isFolderAccessSupported,
  linkFolder,
  queryPermission,
  removeHandle,
  requestPermission,
} from '../substrate/folder-handles.js'
import type { ComfyFileRef } from './comfy-host.js'

/** Which linked folder is ComfyUI's. Device-local — a folder handle cannot
 *  travel, and neither can a path. */
export const COMFY_FOLDER_KEY = 'hc:comfy:folder'

/**
 * THE CAP ON WHAT MAY BECOME A TILE'S FACE. Twenty-four megabytes is far
 * above any sane generation (a 2048² PNG is ~6 MB) and far below the size at
 * which one picture starts to dominate a publish. A file over it is not an
 * error — it is a picture that belongs in the folder it is already in.
 */
export const MAX_IMPORT_BYTES = 24 * 1024 * 1024

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif'])

/** ComfyUI's own layout. The participant may pick the install root or the
 *  output folder itself, and both should work — asking them which one is
 *  asking them to know something the directory already says. */
const OUTPUT_DIRS = ['output', 'ComfyUI/output']
const INPUT_DIRS = ['input', 'ComfyUI/input']

export interface ComfyFolderState {
  supported: boolean
  linked: boolean
  label: string
  /** 'granted' once the participant has said yes and the handle still works. */
  permission: PermissionState | 'none'
}

type DirHandle = FileSystemDirectoryHandle & {
  entries(): AsyncIterable<[string, FileSystemHandle]>
}

const readId = (): string => {
  try { return localStorage.getItem(COMFY_FOLDER_KEY) ?? '' } catch { return '' }
}

const writeId = (id: string): void => {
  try {
    if (id) localStorage.setItem(COMFY_FOLDER_KEY, id)
    else localStorage.removeItem(COMFY_FOLDER_KEY)
  } catch { /* session-only */ }
}

/** Walk a slash path down from a handle. Absent → undefined, never a throw. */
const descend = async (root: DirHandle, path: string): Promise<DirHandle | undefined> => {
  let current: DirHandle = root
  for (const segment of path.split('/').filter(Boolean)) {
    try {
      current = await current.getDirectoryHandle(segment, { create: false }) as DirHandle
    } catch { return undefined }
  }
  return current
}

export class ComfyFolder extends EventTarget {
  #root: DirHandle | null = null
  #label = ''

  get label(): string { return this.#label }
  get linked(): boolean { return !!this.#root || !!readId() }

  #announce(): void {
    this.dispatchEvent(new CustomEvent('change'))
    EffectBus.emit('comfy:folder-changed', { linked: this.linked, label: this.#label })
  }

  /** Re-open the folder the participant linked last time. Chrome keeps the
   *  handle but not necessarily the permission — a reload usually needs one
   *  more click, which is the browser's rule and not ours to route around. */
  async restore(): Promise<boolean> {
    const id = readId()
    if (!id) return false
    const entry = await getHandle(id)
    if (!entry?.handle) { writeId(''); return false }
    this.#root = entry.handle as DirHandle
    this.#label = entry.label ?? ''
    const state = await queryPermission(entry.handle)
    this.#announce()
    return state === 'granted'
  }

  /** Open the Windows picker. Must be called from a click. */
  async link(): Promise<boolean> {
    if (!isFolderAccessSupported()) return false
    const entry = await linkFolder('ComfyUI')
    if (!entry) return false
    const previous = readId()
    if (previous && previous !== entry.id) { try { await removeHandle(previous) } catch { /* gone */ } }
    writeId(entry.id)
    this.#root = entry.handle as DirHandle
    this.#label = entry.label ?? 'ComfyUI'
    this.#announce()
    return true
  }

  async unlink(): Promise<void> {
    const id = readId()
    if (id) { try { await removeHandle(id) } catch { /* gone */ } }
    writeId('')
    this.#root = null
    this.#label = ''
    this.#announce()
  }

  async state(): Promise<ComfyFolderState> {
    const supported = isFolderAccessSupported()
    if (!this.#root) {
      return { supported, linked: !!readId(), label: this.#label, permission: 'none' }
    }
    let permission: PermissionState | 'none' = 'none'
    try { permission = await queryPermission(this.#root) } catch { /* treat as none */ }
    return { supported, linked: true, label: this.#label, permission }
  }

  /** Ask for read access. A click away, and only ever from one. */
  async allow(): Promise<boolean> {
    if (!this.#root) return false
    try { return await requestPermission(this.#root) === 'granted' } catch { return false }
  }

  /** ComfyUI's output (or input) directory, wherever the participant's pick
   *  put us relative to it. */
  async directory(which: 'output' | 'input' = 'output'): Promise<DirHandle | undefined> {
    if (!this.#root) return undefined
    for (const path of which === 'output' ? OUTPUT_DIRS : INPUT_DIRS) {
      const found = await descend(this.#root, path)
      if (found) return found
    }
    // The participant may have picked `output` itself — in which case the
    // root IS the answer, and only for outputs.
    return which === 'output' ? this.#root : undefined
  }

  /**
   * One file ComfyUI named, read off disk. `subfolder` is ComfyUI's own — a
   * SaveImage with a prefix like `portraits/hypercomb` puts its files there,
   * and the same reference works over HTTP or here.
   */
  async read(file: ComfyFileRef): Promise<Blob | null> {
    const base = await this.directory(file.type === 'input' ? 'input' : 'output')
    if (!base) return null
    const dir = file.subfolder ? await descend(base, file.subfolder) : base
    if (!dir) return null
    try {
      const handle = await dir.getFileHandle(file.filename, { create: false })
      const held = await handle.getFile()
      return held.size ? held : null
    } catch { return null }
  }

  /**
   * The newest pictures in the output folder, as previews. NOTHING IS
   * COPIED: each entry carries an object URL pointing at the file on disk and
   * its size, so a surface can show the folder and the participant can keep
   * exactly one. The caller revokes the URLs it stops showing.
   *
   * Bounded by `limit` because an output folder holds a year of runs and the
   * strip shows a dozen.
   */
  async recent(limit = 24): Promise<{ file: ComfyFileRef; url: string; size: number; at: number }[]> {
    const dir = await this.directory('output')
    if (!dir) return []
    const found: { name: string; handle: FileSystemFileHandle; at: number; size: number }[] = []
    try {
      for await (const [name, entry] of dir.entries()) {
        if (entry.kind !== 'file') continue
        const extension = name.split('.').pop()?.toLowerCase() ?? ''
        if (!IMAGE_EXTENSIONS.has(extension)) continue
        try {
          const held = await (entry as FileSystemFileHandle).getFile()
          if (!held.size) continue
          found.push({ name, handle: entry as FileSystemFileHandle, at: held.lastModified, size: held.size })
        } catch { /* skip unreadable */ }
      }
    } catch { return [] }
    found.sort((a, b) => b.at - a.at)
    const out: { file: ComfyFileRef; url: string; size: number; at: number }[] = []
    for (const entry of found.slice(0, limit)) {
      try {
        const held = await entry.handle.getFile()
        out.push({
          file: { filename: entry.name, subfolder: '', type: 'output' },
          url: URL.createObjectURL(held),
          size: entry.size,
          at: entry.at,
        })
      } catch { /* raced with ComfyUI writing — skip */ }
    }
    return out
  }
}

export const comfyFolder = new ComfyFolder()

/** Is this file small enough to become a tile's face and travel with it?
 *  Pure, so the rule can be stated in one place and tested. */
export const importable = (size: number): boolean => size > 0 && size <= MAX_IMPORT_BYTES

/** The refusal, said the way a participant would want to hear it. */
export const tooLargeMessage = (size: number): string =>
  `that picture is ${(size / (1024 * 1024)).toFixed(1)} MB — over the ${Math.round(MAX_IMPORT_BYTES / (1024 * 1024))} MB `
  + 'a tile face may carry into a publish; it stays in your ComfyUI folder'
