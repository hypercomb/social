// platform.ts — cached platform detection (single source of truth)

export const isMac: boolean = /Mac|iMac|Macintosh/.test(navigator.userAgent)
