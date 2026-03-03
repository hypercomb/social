// hypercomb-web/src/app/core/opfs-tree-logger.ts

export class OpfsTreeLogger {

    public log = async (): Promise<void> => {
        console.clear()
        try {
            const root = await navigator.storage.getDirectory()
            console.log('[opfs] /')
            await this.walk(root, '')
        } catch (err) {
            console.log('[opfs] unable to read opfs root (navigator.storage.getDirectory)', err)
        }
    }

    private walk = async (dir: FileSystemDirectoryHandle, indent: string, insideHistory = false): Promise<void> => {
        const entries: Array<{ name: string; kind: FileSystemHandleKind; handle: FileSystemHandle }> = []

        for await (const [name, handle] of dir.entries()) {
            entries.push({ name, kind: handle.kind, handle })
        }

        entries.sort((a, b) => {
            if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1
            return a.name.localeCompare(b.name)
        })

        for (const e of entries) {
            if (e.kind === 'directory') {
                const isHistory = e.name === '__history__'
                console.log(`${indent}📁 ${e.name}/`)
                await this.walk(e.handle as FileSystemDirectoryHandle, indent + '  ', insideHistory || isHistory)
            } else {
                if (insideHistory) {
                    const content = await this.readFileContent(e.handle as FileSystemFileHandle)
                    console.log(`${indent}📄 ${e.name} → ${content}`)
                } else {
                    console.log(`${indent}📄 ${e.name}`)
                }
            }
        }
    }

    private readFileContent = async (fileHandle: FileSystemFileHandle): Promise<string> => {
        try {
            const file = await fileHandle.getFile()
            const text = await file.text()
            return text.trim() || '(empty)'
        } catch {
            return '(unreadable)'
        }
    }
}

register('@hypercomb.social/OpfsTreeLogger', new OpfsTreeLogger())
