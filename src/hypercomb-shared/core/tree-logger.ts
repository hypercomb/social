// hypercomb-shared/core/tree-logger.ts
//
// Console dump of the OPFS tree, classified by the pools model: the
// root inventory is sig-named files (content bytes), sig-named dirs
// (lineage sigbags and sign(meaning) pools — pool addresses are derived
// via Store.poolSignature, never hardcoded) and, until the self-cleaning
// drains finish, legacy `__x__` / root-level `hypercomb.io` sources.
// Sig dirs and drain dirs get count-only summaries (no deep walk — a
// thousand-member pool would flood the console); root-level sig files
// collapse into a single count line. Everything else (domain trees,
// overrides) deep-walks as before.

import { Store } from './store'

const SIG_RE = /^[a-f0-9]{64}$/i
/** Legacy `__x__` dirs — drain sources awaiting self-clean removal. */
const LEGACY_DRAIN_RE = /^__.+__$/
/** Pools of meaning the logger knows how to label. */
const POOL_MEANINGS = [
    Store.BEES_MEANING, Store.DEPENDENCIES_MEANING, Store.CLIPBOARD_MEANING,
    Store.THREADS_MEANING, Store.COMPUTATION_MEANING, Store.MANIFESTS_MEANING,
    Store.OPTIMIZATION_MEANING, 'registry', 'receipts', 'structure', 'patches', 'roots',
]

export class OpfsTreeLogger {

    public log = async (): Promise<void> => {
        console.clear()
        // sign(meaning) → meaning, derived fresh (memoized inside Store).
        const pools = new Map<string, string>()
        for (const meaning of POOL_MEANINGS) {
            pools.set(await Store.poolSignature(meaning), meaning)
        }
        try {
            const root = await navigator.storage.getDirectory()
            console.log('📂 /')
            await this.#walk(root, '  ', pools, true)
        } catch (err) {
            console.log('[opfs] unable to read opfs root', err)
        }
    }

    #walk = async (
        dir: FileSystemDirectoryHandle,
        indent: string,
        pools: Map<string, string>,
        atRoot: boolean,
    ): Promise<void> => {
        const entries: Array<{ name: string; kind: FileSystemHandleKind; handle: FileSystemHandle }> = []

        for await (const [name, handle] of dir.entries()) {
            entries.push({ name, kind: handle.kind, handle })
        }

        // Directories first, then files; alphabetical within each group
        entries.sort((a, b) => {
            if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1
            return a.name.localeCompare(b.name)
        })

        let rootSigFiles = 0

        for (const e of entries) {
            if (e.kind === 'directory') {
                const childDir = e.handle as FileSystemDirectoryHandle
                const meaning = pools.get(e.name)
                const isLegacy = LEGACY_DRAIN_RE.test(e.name) ||
                    (atRoot && e.name === Store.LEGACY_HYPERCOMB_IO_DIRECTORY)
                if (meaning) {
                    // sign(meaning) pool — summarize, never deep-walk
                    console.log(`${indent}📦 ${e.name}/  pool: ${meaning}${await this.#summarize(childDir)}`)
                } else if (SIG_RE.test(e.name)) {
                    // lineage sigbag — markers only, summarize
                    console.log(`${indent}📁 ${e.name}/  (lineage sigbag)${await this.#summarize(childDir)}`)
                } else if (isLegacy) {
                    // legacy drain source — read-fallback only, self-clean removes it
                    console.log(`${indent}📦 ${e.name}/  (legacy drain)${await this.#summarize(childDir)}`)
                } else {
                    console.log(`${indent}📁 ${e.name}/`)
                    await this.#walk(childDir, indent + '  ', pools, false)
                }
            } else if (atRoot && SIG_RE.test(e.name.replace(/\.js$/i, ''))) {
                // flat content files at the root — count, don't flood
                rootSigFiles++
            } else {
                const label = await this.#describeFile(e.name, e.handle as FileSystemFileHandle)
                console.log(`${indent}📄 ${e.name}${label}`)
            }
        }

        if (rootSigFiles > 0) {
            console.log(`${indent}📄 ${rootSigFiles} sig-named content files`)
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
                return `  (cell)  ${this.#formatCellProps(props)}`
            } catch {
                return '  (cell)'
            }
        }
        return ''
    }

    #formatCellProps = (props: Record<string, unknown>): string => {
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

    #summarize = async (dir: FileSystemDirectoryHandle): Promise<string> => {
        let count = 0
        try {
            for await (const _ of dir.entries()) { count++; if (count > 999) break }
        } catch { /* unreadable */ }
        return count > 0 ? `  (${count} entries)` : '  (empty)'
    }
}

register('@hypercomb.social/OpfsTreeLogger', new OpfsTreeLogger())
