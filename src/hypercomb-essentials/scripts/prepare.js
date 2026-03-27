// hypercomb-essentials/scripts/prepare.ts
// production-grade prepare script
// - pre-cleans stale generated files (index.ts, *-keys.ts)
// - generates per-folder index.ts (barrel exports for tsup)
// - generates one master essentials-keys.ts (all IoC keys in one place)
// - drones exported as types only
// - deterministic
// - overwrites generated files
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs';
import { basename, dirname, extname, join, resolve } from 'path';
import ts from 'typescript';
import { fileURLToPath } from 'url';
// -------------------------------------------------
// anchors
// -------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SRC_ROOT = resolve(__dirname, '../src');
const TYPES_ROOT = join(SRC_ROOT, 'types');
// -------------------------------------------------
// helpers
// -------------------------------------------------
const isSource = (f) => (f.endsWith('.ts') || f.endsWith('.js')) && !f.endsWith('.d.ts');
const isBee = (f) => f.endsWith('.drone.ts') || f.endsWith('.drone.js') ||
    f.endsWith('.worker.ts') || f.endsWith('.worker.js');
const isGenerated = (f) => f.endsWith('-keys.ts') || basename(f) === 'index.ts';
const relFrom = (root, full) => full.replace(root, '').replace(/^[\\/]/, '').replace(/\\/g, '/');
const toPascal = (name) => name
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map(p => p[0].toUpperCase() + p.slice(1))
    .join('');
const toCamel = (name) => {
    const pascal = toPascal(name);
    return pascal[0].toLowerCase() + pascal.slice(1);
};
// -------------------------------------------------
// walking
// -------------------------------------------------
const safeStat = (path) => {
    try {
        return statSync(path);
    }
    catch (error) {
        if (error && error.code === 'ENOENT')
            return null;
        throw error;
    }
};
const walkDirs = (dir) => {
    if (!existsSync(dir))
        return [];
    const out = [];
    for (const name of readdirSync(dir).sort()) {
        const full = join(dir, name);
        const st = safeStat(full);
        if (st?.isDirectory()) {
            out.push(full);
            out.push(...walkDirs(full));
        }
    }
    return out;
};
const walkFiles = (dir) => {
    if (!existsSync(dir))
        return [];
    const out = [];
    for (const name of readdirSync(dir).sort()) {
        const full = join(dir, name);
        const st = safeStat(full);
        if (!st)
            continue;
        if (st.isDirectory())
            out.push(...walkFiles(full));
        else if (st.isFile())
            out.push(full);
    }
    return out;
};
// -------------------------------------------------
// pre-clean: remove all generated files before regenerating
// -------------------------------------------------
const preClean = () => {
    let removed = 0;
    for (const file of walkFiles(SRC_ROOT)) {
        const name = basename(file);
        if (name === 'index.ts' || name.endsWith('-keys.ts')) {
            rmSync(file, { force: true });
            removed++;
        }
    }
    const masterKeys = join(SRC_ROOT, 'essentials-keys.ts');
    if (existsSync(masterKeys)) {
        rmSync(masterKeys, { force: true });
        removed++;
    }
    if (removed)
        console.log(`[prepare] cleaned ${removed} stale generated file(s)`);
};
const parseExports = (file) => {
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const out = { value: [], type: [] };
    source.forEachChild(node => {
        if (ts.canHaveModifiers(node) && node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
            if (ts.isClassDeclaration(node) || ts.isFunctionDeclaration(node) || ts.isEnumDeclaration(node)) {
                if (node.name) {
                    if (isBee(file))
                        out.type.push(node.name.text);
                    else
                        out.value.push(node.name.text);
                }
            }
            if (ts.isVariableStatement(node)) {
                node.declarationList.declarations.forEach(d => {
                    if (ts.isIdentifier(d.name))
                        out.value.push(d.name.text);
                });
            }
            if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
                out.type.push(node.name.text);
            }
        }
        if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
            node.exportClause.elements.forEach(e => {
                const name = (e.name || e.propertyName)?.text;
                if (!name)
                    return;
                if (isBee(file))
                    out.type.push(name);
                else
                    out.value.push(name);
            });
        }
    });
    return {
        value: Array.from(new Set(out.value)).sort(),
        type: Array.from(new Set(out.type)).sort()
    };
};
// -------------------------------------------------
// master keys: one file with all IoC keys
// -------------------------------------------------
const collectAllKeys = (domain, domainRoot) => {
    const allDirs = [domainRoot, ...walkDirs(domainRoot)];
    const result = [];
    for (const dir of allDirs) {
        const folderRel = relFrom(domainRoot, dir);
        const moduleKey = folderRel ? `${domain}/${folderRel}` : `${domain}`;
        const bySymbol = new Map();
        for (const name of readdirSync(dir).sort()) {
            const full = join(dir, name);
            if (!statSync(full).isFile())
                continue;
            if (!isSource(full))
                continue;
            if (isGenerated(full))
                continue;
            const exp = parseExports(full);
            const stem = name.replace(extname(name), '');
            const keyBase = `@${moduleKey}/${stem}`;
            for (const sym of [...exp.value, ...exp.type])
                bySymbol.set(sym, keyBase);
        }
        if (bySymbol.size)
            result.push({ folderRel, symbols: bySymbol });
    }
    return result;
};
const writeMasterKeys = (allDomainKeys) => {
    const lines = [
        '// auto-generated — single facade for all IoC keys',
        '// do not edit manually',
        '',
    ];
    const allSymbols = new Map();
    for (const [, folders] of allDomainKeys) {
        for (const folder of folders) {
            for (const [sym, key] of folder.symbols)
                allSymbols.set(sym, key);
        }
    }
    for (const sym of Array.from(allSymbols.keys()).sort()) {
        lines.push(`export const ${sym} = '${allSymbols.get(sym)}'`);
    }
    lines.push('');
    lines.push('export const EssentialsKeys = {');
    for (const [domain, folders] of Array.from(allDomainKeys.entries()).sort(([a], [b]) => a.localeCompare(b))) {
        const domainProp = toCamel(domain.replace(/\.com$|\.ca$|\.io$/i, ''));
        lines.push(`  ${domainProp}: {`);
        for (const folder of folders) {
            const folderProp = folder.folderRel
                ? toCamel(folder.folderRel.split('/').pop())
                : '_root';
            const symbols = Array.from(folder.symbols.keys()).sort();
            lines.push(`    ${folderProp}: { ${symbols.join(', ')} },`);
        }
        lines.push('  },');
    }
    lines.push('} as const');
    lines.push('');
    writeFileSync(join(SRC_ROOT, 'essentials-keys.ts'), lines.join('\n'), 'utf8');
};
const buildDirMeta = (root) => {
    const dirs = [root, ...walkDirs(root)];
    const map = new Map();
    for (const dir of dirs) {
        const children = [];
        const exportFiles = [];
        for (const name of readdirSync(dir).sort()) {
            const full = join(dir, name);
            const st = statSync(full);
            if (st.isDirectory()) {
                children.push(full);
                continue;
            }
            if (!st.isFile())
                continue;
            if (!isSource(full))
                continue;
            if (isGenerated(full))
                continue;
            const base = name.replace(extname(name), '');
            if (base === 'index')
                continue;
            exportFiles.push(full);
        }
        map.set(dir, { children, exportFiles });
    }
    return map;
};
const computeHasDeepSources = (meta) => {
    const cache = new Map();
    const hasDeep = (dir) => {
        const hit = cache.get(dir);
        if (hit !== undefined)
            return hit;
        const m = meta.get(dir);
        if (!m) {
            cache.set(dir, false);
            return false;
        }
        if (m.exportFiles.length) {
            cache.set(dir, true);
            return true;
        }
        for (const child of m.children) {
            if (hasDeep(child)) {
                cache.set(dir, true);
                return true;
            }
        }
        cache.set(dir, false);
        return false;
    };
    return hasDeep;
};
// -------------------------------------------------
// folder index (exports subfolders + files; subfolders ensure you don't "stop after the first")
// -------------------------------------------------
const writeFolderIndex = (dir, meta, hasDeep) => {
    if (!hasDeep(dir))
        return;
    const m = meta.get(dir);
    if (!m)
        return;
    const lines = [];
    for (const child of m.children.sort()) {
        if (!hasDeep(child))
            continue;
        lines.push(`export * from './${basename(child)}'`);
    }
    for (const full of m.exportFiles.sort()) {
        const name = basename(full);
        const base = name.replace(extname(name), '');
        const rel = `./${base}`;
        if (isBee(full))
            lines.push(`export type * from '${rel}'`);
        else
            lines.push(`export * from '${rel}'`);
    }
    if (!lines.length)
        return;
    const content = `// auto-generated
// do not edit manually

${lines.join('\n')}
`;
    writeFileSync(join(dir, 'index.ts'), content, 'utf8');
};
// -------------------------------------------------
// main
// -------------------------------------------------
preClean();
rmSync(TYPES_ROOT, { recursive: true, force: true });
mkdirSync(TYPES_ROOT, { recursive: true });
const domains = readdirSync(SRC_ROOT)
    .filter(n => n !== 'types' && n !== 'essentials-keys.ts' && statSync(join(SRC_ROOT, n)).isDirectory())
    .sort();
const rootExports = [];
const allDomainKeys = new Map();
for (const domain of domains) {
    const domainRoot = join(SRC_ROOT, domain);
    const meta = buildDirMeta(domainRoot);
    const hasDeep = computeHasDeepSources(meta);
    if (hasDeep(domainRoot)) {
        rootExports.push(`export * from './${domain}'`);
    }
    allDomainKeys.set(domain, collectAllKeys(domain, domainRoot));
    const allDirs = [domainRoot, ...walkDirs(domainRoot)];
    for (const dir of allDirs) {
        writeFolderIndex(dir, meta, hasDeep);
    }
}
writeMasterKeys(allDomainKeys);
rootExports.push(`export { EssentialsKeys } from './essentials-keys'`);
const rootIndex = `// auto-generated
// package root entrypoint
// do not edit manually

${rootExports.sort().join('\n')}
`;
writeFileSync(join(SRC_ROOT, 'index.ts'), rootIndex, 'utf8');
console.log('[prepare] complete');
