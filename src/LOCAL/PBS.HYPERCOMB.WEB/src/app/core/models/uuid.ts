export function uuidv4(): string {
    // use crypto if available
    try {
        const buf = new Uint8Array(16)
            ; (globalThis.crypto || (globalThis as any).msCrypto).getRandomValues(buf)
        // set version bits
        buf[6] = (buf[6] & 0x0f) | 0x40
        buf[8] = (buf[8] & 0x3f) | 0x80
        const hex = Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('')
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
    } catch {
        // fallback
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0
            const v = c === 'x' ? r : (r & 0x3 | 0x8)
            return v.toString(16)
        })
    }
}
