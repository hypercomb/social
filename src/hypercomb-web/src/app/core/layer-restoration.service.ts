// src/app/core/layer-restoration.service.ts

import { Injectable } from '@angular/core'

@Injectable({ providedIn: 'root' })
export class LayerRestorationService {

    private static readonly DEFAULT_ORIGIN = 'https://storagehypercomb.blob.core.windows.net/content'
    private readonly decoder = new TextDecoder()
    private readonly encoder = new TextEncoder()


    public load = async (domainsRoot: FileSystemDirectoryHandle, depth: number): Promise<void> => {
        for await (const [name, entry] of domainsRoot.entries()) {
            if (entry.kind !== 'directory') continue

            // never treat platform folders as domains
            if (name === 'hypercomb') continue
            if (name.startsWith('__')) continue

            await this.loadDomain(entry as FileSystemDirectoryHandle, depth)
        }
    }

    // -------------------------------------------------
    // per-domain loader
    // -------------------------------------------------

    private loadDomain = async (
            rootDirectory: FileSystemDirectoryHandle,
            depth: number
        ): Promise<void> => {
        const currentDir = rootDirectory

        // __location__ is a helper with no effects
        // its contents are either:
        // - a root signature (preferred)
        // - or a full url prefix (supported as a fallback)
        const location = await this.readLocationPrefix(rootDirectory)
        if (!location) return

        // resolve the layers cache handle once per domain
        const layersDir = await rootDirectory.getDirectoryHandle('layers', { create: true })

        // recurse starting at domain root
        await this.loadRecursive(rootDirectory, layersDir, location, currentDir, depth)
    }

    private readLocationPrefix = async (
        rootDirectory: FileSystemDirectoryHandle
    ): Promise<string | null> => {

        let raw = ''

        try {
            const handle = await rootDirectory.getFileHandle('__location__', { create: false })
            const file = await handle.getFile()
            raw = (await file.text()).trim()
        } catch {
            // no location means the domain is inert
            return null
        }

        if (!raw) return null

        // allow full url prefixes for convenience
        if (/^https?:\/\//i.test(raw)) {
            return raw.replace(/\/+$/, '')
        }

        // otherwise treat it as the root signature
        const root = raw.trim()
        if (!this.isSignature(root)) {
            throw new Error('[layer-restoration] __location__ must be a url or 64-hex root signature')
        }

        return `${LayerRestorationService.DEFAULT_ORIGIN}/${root}`
    }

    private isSignature = (value: string): boolean =>
        /^[a-f0-9]{64}$/i.test(value)

    // -------------------------------------------------
    // recursion
    // -------------------------------------------------

    private loadRecursive = async (
        rootDirectory: FileSystemDirectoryHandle,
        layersDir: FileSystemDirectoryHandle,
        location: string,
        currentDir: FileSystemDirectoryHandle,
        depth: number
    ): Promise<void> => {

        if (depth < 0) return

        // 1. consume install-* files at this level
        for await (const [name, entry] of currentDir.entries()) {
            if (entry.kind !== 'file') continue
            if (!name.startsWith('install-')) continue

            const seedSig = name.slice('install-'.length).trim()
            if (!seedSig) continue

            await this.consumeInstall(rootDirectory, layersDir, location, currentDir, seedSig)
        }

        // 2. structural recursion (walk limit only)
        if (depth === 0) return

        for await (const [, entry] of currentDir.entries()) {
            if (entry.kind !== 'directory') continue

            await this.loadRecursive(
                rootDirectory,
                layersDir,
                location,
                entry as FileSystemDirectoryHandle,
                depth - 1
            )
        }
    }

    // -------------------------------------------------
    // install handling
    // -------------------------------------------------

    private consumeInstall = async (
        domainDir: FileSystemDirectoryHandle,
        layersDir: FileSystemDirectoryHandle,
        location: string,
        parentDir: FileSystemDirectoryHandle,
        seedSignature: string
    ): Promise<void> => {

        const layer = await this.lookupLayer(domainDir, layersDir, location, seedSignature)
        if (layer === null) return

        // plant next-level install markers
        for (const childSig of layer.children) {
            const sig = childSig.trim()
            if (!sig) continue
            await layersDir.getFileHandle(`install-${sig}`, { create: true })
        }

        // remove marker only after success
        await parentDir.removeEntry(`install-${seedSignature}`)
    }

    // -------------------------------------------------
    // layer lookup (opfs first, http fallback)
    // -------------------------------------------------

    private lookupLayer = async (
        domainDir: FileSystemDirectoryHandle,
        layersDir: FileSystemDirectoryHandle,
        location: string,
        signature: string
    ): Promise<{ name: string; children: string[] } | null> => {

        let jsonText: string | null = null

        // 1) opfs cache: <domainDir>/layers/<signature>
        try {
            const fileHandle =
                await layersDir.getFileHandle(signature, { create: false })
            const file = await fileHandle.getFile()
            jsonText = this.decoder.decode(await file.arrayBuffer())
        } catch {
            // not cached locally
        }

        // 2) http fallback: {location}/layers/{signature}
        if (!jsonText) {
            const url = `${location}/${signature}/layers/${signature}`
            const res = await fetch(url)

            if (!res.ok) {
                return null
            }

            jsonText = await res.text()

            // persist to opfs
            const handle = await layersDir.getFileHandle(signature, { create: true })
            const writable = await handle.createWritable()
            try {
                await writable.write(this.encoder.encode(jsonText))
            } finally {
                await writable.close()
            }
        }

        // 3) parse + validate
        let parsed: any
        try {
            parsed = JSON.parse(jsonText)
        } catch {
            throw new Error(`[layer-restoration] invalid layer json ${signature}`)
        }

        if (typeof parsed.name !== 'string' || !parsed.name.trim()) {
            throw new Error(`[layer-restoration] layer ${signature} missing name`)
        }

        if (!Array.isArray(parsed.children)) {
            throw new Error(`[layer-restoration] layer ${signature} missing children`)
        }

        return {
            name: parsed.name.trim(),
            children: parsed.children.map((c: string) => String(c).trim())
        }
    }
}
