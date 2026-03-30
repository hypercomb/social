// hypercomb-shared/core/tree-logger.ts

const SIG_RE = /^[a-f0-9]{64}$/i
const SYSTEM_DIRS = new Set(['__bees__', '__dependencies__', '__resources__', '__history__'])

export class OpfsTreeLogger {

    public log = async (): Promise<void> => {
        console.clear()
        try {
            const root = await navigator.storage.getDirectory()
            console.log('📂 /')
            await this.#walk(root, '  ')
        } catch (err) {
            console.log('[opfs] unable to read opfs root', err)
        }
    }

    #walk = async (dir: FileSystemDirectoryHandle, indent: string): Promise<void> => {
        const entries: Array<{ name: string; kind: FileSystemHandleKind; handle: FileSystemHandle }> = []

        for await (const [name, handle] of dir.entries()) {
            entries.push({ name, kind: handle.kind, handle })
        }

        // Directories first, then files; alphabetical within each group
        entries.sort((a, b) => {
            if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1
            return a.name.localeCompare(b.name)
        })

        for (const e of entries) {
            if (e.kind === 'directory') {
                const isSystem = SYSTEM_DIRS.has(e.name)
                const icon = isSystem ? '📦' : '📁'
                const childDir = e.handle as FileSystemDirectoryHandle
                const summary = isSystem ? await this.#summarizeSystemDir(childDir) : ''
                console.log(`${indent}${icon} ${e.name}/${summary}`)

                // System dirs: show summary only (skip deep walk)
                if (!isSystem) {
                    await this.#walk(childDir, indent + '  ')
                }
            } else {
                const label = await this.#describeFile(e.name, e.handle as FileSystemFileHandle)
                console.log(`${indent}📄 ${e.name}${label}`)
            }
        }
    }

    #describeFile = async (name: string, handle: FileSystemFileHandle): Promise<string> => {
        const bare = name.replace(/\.js$/i, '')
        if (SIG_RE.test(bare)) return '  🐝 marker'
        if (name === '0000') {
            try {
                const file = await handle.getFile()
                const text = await file.text()
                const props = JSON.parse(text) as Record<string, unknown>
                return `  (seed)  ${this.#formatSeedProps(props)}`
            } catch {
                return '  (seed)'
            }
        }
        return ''
    }

    #formatSeedProps = (props: Record<string, unknown>): string => {
        const parts: string[] = []
        if (props['name']) parts.push(`name="${props['name']}"`)
        if (props['link']) parts.push(`link="${props['link']}"`)
        const border = props['border'] as Record<string, unknown> | undefined
        if (border?.['color']) parts.push(`border=${border['color']}`)
        const bg = props['background'] as Record<string, unknown> | undefined
        if (bg?.['color']) parts.push(`bg=${bg['color']}`)
        const small = props['small'] as Record<string, unknown> | undefined
        if (small?.['image']) parts.push(`img=${String(small['image']).slice(0, 8)}…`)
        return parts.length ? parts.join('  ') : JSON.stringify(props)
    }

    #summarizeSystemDir = async (dir: FileSystemDirectoryHandle): Promise<string> => {
        let count = 0
        try {
            for await (const _ of dir.entries()) { count++; if (count > 999) break }
        } catch { /* unreadable */ }
        return count > 0 ? `  (${count} entries)` : '  (empty)'
    }
}

register('@hypercomb.social/OpfsTreeLogger', new OpfsTreeLogger())
