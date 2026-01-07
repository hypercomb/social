import { IShortcut, IShortcutKey } from "./shortcut-model"

type RawShortcut = {
    cmd: string
    description: string
    category?: string
    keys: { key: string; ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean; primary?: boolean }[][]
    risk?: 'none' | 'warning' | 'danger'
    riskNote?: string
}

export const toShortcuts = (data: unknown): IShortcut[] => {
    if (!Array.isArray(data)) throw new Error('IShortcut config must be an array')

    return data.map((s: RawShortcut) => {
        if (!s.cmd || !s.description || !Array.isArray(s.keys)) {
            throw new Error(`Invalid shortcut entry: ${JSON.stringify(s)}`)
        }

        if (s.risk && !['warning', 'danger'].includes(s.risk)) {
            throw new Error(`Invalid risk: ${s.risk}`)
        }

        // normalize keys (lowercase key + ensure boolean modifiers)
        const normKeys: IShortcutKey[][] = s.keys.map(combo =>
            combo.map(k => ({
                key: String(k.key).toLowerCase(),
                ctrl: !!k.ctrl,
                shift: !!k.shift,
                alt: !!k.alt,
                meta: !!k.meta,
                primary: !!k.primary
            }))
        )

        return {
            ...state,
            keys: normKeys
        } as IShortcut
    })
}


