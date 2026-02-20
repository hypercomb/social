// hypercomb-essentials/scripts/_shared.ts
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { basename, extname, join, relative } from 'path';
export const relPosix = (from, to) => relative(from, to).replace(/\\/g, '/') || '';
export const walkFiles = (dir) => {
    if (!existsSync(dir))
        return [];
    const out = [];
    for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        const st = statSync(full);
        if (st.isDirectory())
            out.push(...walkFiles(full));
        else
            out.push(full);
    }
    return out;
};
export const ensureDir = (dir) => {
    mkdirSync(dir, { recursive: true });
};
export const rmDir = (dir) => {
    rmSync(dir, { recursive: true, force: true });
};
export const isDrone = (file) => file.endsWith('.drone.ts') || file.endsWith('.drone.js');
export const stripExt = (p) => p.slice(0, -extname(p).length);
export const fileBase = (p) => basename(stripExt(p));
export const textToBytes = (text) => new TextEncoder().encode(text);
export const toArrayBuffer = (bytes) => {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return copy.buffer;
};
export const isSig = (v) => /^[a-f0-9]{64}$/i.test(v);
export const writeSigFile = (dir, sig, bytes) => {
    if (!isSig(sig))
        throw new Error(`invalid signature: ${sig}`);
    writeFileSync(join(dir, sig), bytes);
};
export const readText = (path) => readFileSync(path, 'utf8');
export const isUnderDir = (file, dirAbs) => {
    const f = file.replace(/\\/g, '/');
    const d = dirAbs.replace(/\\/g, '/').replace(/\/+$/, '');
    return f.startsWith(d + '/');
};
// reads only the first line and extracts the first token that starts with "@essentials/"
export const readEssentialsTokenFromFirstLine = (text) => {
    const first = text.split('\n', 1)[0]?.trim() ?? '';
    if (!first.startsWith('//'))
        return null;
    const parts = first.split(/\s+/);
    const token = parts[1] ?? '';
    if (!token.startsWith('@essentials/'))
        return null;
    return token;
};
// ensures each dependency has a unique specifier so import map can bind it 1:1
// - if missing/invalid: @essentials/default/<base>
// - if only a namespace (two segments): @essentials/<group>/<base>
// - if already qualified: keep
export const normalizeEssentialsSpecifier = (token, base) => {
    if (!token || !token.startsWith('@essentials/'))
        return `@essentials/default/${base}`;
    const parts = token.split('/');
    if (parts.length === 2)
        return `${token}/${base}`;
    if (parts.length === 3 && !parts[2])
        return `${parts[0]}/${parts[1]}/${base}`;
    return token;
};
export const toNamespace = (specifier) => {
    const parts = specifier.split('/');
    if (parts.length < 2)
        return specifier;
    return `${parts[0]}/${parts[1]}`;
};
// removes a single leading essentials header line if present
export const stripLeadingEssentialsHeaderLine = (text) => {
    const lines = text.split('\n');
    const first = lines[0]?.trim() ?? '';
    if (first.startsWith('//')) {
        const parts = first.split(/\s+/);
        const token = parts[1] ?? '';
        if (token.startsWith('@essentials/'))
            return lines.slice(1).join('\n');
    }
    return text;
};
