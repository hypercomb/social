// hypercomb-essentials/scripts/build-module.ts
// hypercomb-essentials/scripts/build-module.ts
// MINIMAL UPGRADE:
// - exclude *.keys.ts / *.keys.js at discovery time
// - add install.manifest.json at dist/<rootSignature>/install.manifest.json with only signatures (no root field)
// - nothing else changed (deploy, layers, signing untouched)
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs';
import { dirname, extname, join, relative, resolve } from 'path';
import { build } from 'esbuild';
import { SignatureService } from '@hypercomb/core';
// -------------------------------------------------
// esm globals
// -------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// -------------------------------------------------
// config
// -------------------------------------------------
const PROJECT_ROOT = resolve(__dirname, '..');
const SRC_ROOT = resolve(PROJECT_ROOT, 'src');
const DIST_ROOT = resolve(PROJECT_ROOT, 'dist');
const TARGET = 'es2022';
const NAMESPACE_SEGMENTS_MAX = 3;
const PLATFORM_EXTERNALS = ['@hypercomb/core', 'pixi.js'];
// hard rule: never generate @<domain> root aggregator
const EMIT_DOMAIN_ROOT_NAMESPACE = false;
// new: minimal manifest name
const INSTALL_MANIFEST_FILE = 'install.manifest.json';
// -------------------------------------------------
// helpers
// -------------------------------------------------
const ensureDir = (dir) => {
    mkdirSync(dir, { recursive: true });
};
const relPosix = (from, to) => relative(from, to).replace(/\\/g, '/') || '';
const walkFiles = (dir) => {
    if (!existsSync(dir))
        return [];
    const out = [];
    const names = readdirSync(dir).slice().sort((a, b) => a.localeCompare(b));
    for (const name of names) {
        const full = join(dir, name);
        const st = statSync(full);
        if (st.isDirectory())
            out.push(...walkFiles(full));
        else
            out.push(full);
    }
    return out;
};
const isSource = (f) => (f.endsWith('.ts') || f.endsWith('.js')) && !f.endsWith('.d.ts');
// exclude key-only files from artifact pipeline
const isKeysFile = (f) => f.endsWith('.keys.ts') || f.endsWith('.keys.js') || f.endsWith('-keys.ts') || f.endsWith('-keys.js');
const isDrone = (f) => f.endsWith('.drone.ts') || f.endsWith('.drone.js');
const isEntry = (f) => f.endsWith('.entry.ts') || f.endsWith('.entry.js');
const stripExt = (p) => p.slice(0, -extname(p).length);
const textToBytes = (text) => new TextEncoder().encode(text);
const toArrayBuffer = (bytes) => {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return copy.buffer;
};
const isSig = (v) => /^[a-f0-9]{64}$/i.test(v);
const jsFileName = (sig) => `${sig}.js`;
const writeSigJsFile = (dir, sig, bytes) => {
    if (!isSig(sig))
        throw new Error(`invalid signature: ${sig}`);
    writeFileSync(join(dir, jsFileName(sig)), bytes);
};
const layerFileName = (sig) => `${sig}.json`;
const writeLayerJsonFile = (dir, sig, json) => {
    if (!isSig(sig))
        throw new Error(`invalid signature: ${sig}`);
    writeFileSync(join(dir, layerFileName(sig)), json, 'utf8');
};
const splitPath = (p) => p.split('/').filter(Boolean);
const uniq = (xs) => Array.from(new Set(xs));
const uniqSorted = (xs) => uniq(xs).sort((a, b) => a.localeCompare(b));
const namespaceRelDirFromRelDir = (relDir) => {
    const parts = splitPath(relDir);
    return parts.slice(0, Math.min(NAMESPACE_SEGMENTS_MAX, parts.length)).join('/');
};
const specifierFromNamespaceRelDir = (namespaceRelDir) => `@${namespaceRelDir}`;
const prefixesForNamespaceRelDir = (nsRelDir) => {
    const parts = splitPath(nsRelDir);
    const out = [];
    const start = EMIT_DOMAIN_ROOT_NAMESPACE ? 1 : 2;
    for (let i = start; i <= Math.min(parts.length, NAMESPACE_SEGMENTS_MAX); i++) {
        out.push(parts.slice(0, i).join('/'));
    }
    return out;
};
const addToBucket = (map, relDir, fileName, kind) => {
    const bucket = map.get(relDir) ?? { drones: [], deps: [] };
    if (kind === 'dep')
        bucket.deps.push(fileName);
    else
        bucket.drones.push(fileName);
    map.set(relDir, bucket);
};
const discoverSources = () => walkFiles(SRC_ROOT)
    .filter(isSource)
    .filter(f => !isKeysFile(f))
    .filter(f => {
    const relPath = relPosix(SRC_ROOT, f);
    if (relPath === 'types' || relPath.startsWith('types/'))
        return false;
    if (isEntry(relPath))
        return false;
    const relDir = relPosix(SRC_ROOT, dirname(f));
    if (!relDir)
        return false;
    return true;
})
    .map(file => ({
    entry: file,
    relPath: relPosix(SRC_ROOT, file),
    relDir: relPosix(SRC_ROOT, dirname(file)),
    kind: isDrone(file) ? 'drone' : 'dependency',
}));
const readDirTree = (root, rel) => {
    const children = [];
    const full = join(root, rel);
    const names = readdirSync(full).slice().sort((a, b) => a.localeCompare(b));
    for (const name of names) {
        if (!rel && name === 'types')
            continue;
        const child = join(full, name);
        if (statSync(child).isDirectory()) {
            children.push(readDirTree(root, rel ? `${rel}/${name}` : name));
        }
    }
    return { rel, children };
};
const signJson = async (value) => {
    const json = JSON.stringify(value);
    const sig = await SignatureService.sign(toArrayBuffer(textToBytes(json)));
    return { sig, json };
};
const buildLayersFromTree = async (node, resourcesByDir, out, rootDependencies) => {
    const layers = [];
    for (const c of node.children) {
        layers.push(await buildLayersFromTree(c, resourcesByDir, out, rootDependencies));
    }
    const entry = resourcesByDir.get(node.rel) ?? { drones: [], deps: [] };
    const layer = {
        version: 1,
        name: node.rel.split('/').pop() || 'root',
        rel: node.rel,
        drones: uniqSorted(entry.drones),
        dependencies: node.rel ? [] : rootDependencies,
        layers,
    };
    const { sig, json } = await signJson(layer);
    out.set(sig, json);
    return sig;
};
// -------------------------------------------------
// build helpers
// -------------------------------------------------
const buildNamespaceDependency = async (namespaceRelDir, directMemberFiles, allNamespaceSpecifiers) => {
    const namespaceSpecifier = specifierFromNamespaceRelDir(namespaceRelDir);
    const namespaceRootFs = join(SRC_ROOT, namespaceRelDir);
    const resolveDir = existsSync(namespaceRootFs) ? namespaceRootFs : SRC_ROOT;
    const exportLines = directMemberFiles
        .map(f => {
        const relFromNs = relPosix(namespaceRootFs, f.entry);
        const relNoExt = stripExt(relFromNs);
        const spec = relNoExt.startsWith('.') ? relNoExt : `./${relNoExt}`;
        return `export * from '${spec}';`;
    })
        .sort();
    const entrySource = exportLines.length ? exportLines.join('\n') + '\n' : 'export {};\n';
    const externals = [
        ...PLATFORM_EXTERNALS,
        ...allNamespaceSpecifiers.filter(s => s !== namespaceSpecifier),
    ];
    const r = await build({
        stdin: {
            contents: entrySource,
            resolveDir,
            sourcefile: `virtual:${namespaceSpecifier}`,
            loader: 'ts',
        },
        bundle: true,
        format: 'esm',
        platform: 'browser',
        write: false,
        target: TARGET,
        tsconfig: resolve(PROJECT_ROOT, 'tsconfig.json'),
        external: externals,
    });
    const compiled = r.outputFiles?.[0]?.text;
    if (!compiled)
        throw new Error(`no output: ${namespaceSpecifier}`);
    const bytes = textToBytes(`// ${namespaceSpecifier}\n${compiled}`);
    const sig = await SignatureService.sign(toArrayBuffer(bytes));
    return { sig, bytes };
};
const buildDrone = async (entry, externals) => {
    const r = await build({
        entryPoints: [entry],
        bundle: true,
        format: 'esm',
        platform: 'browser',
        write: false,
        target: TARGET,
        tsconfig: resolve(PROJECT_ROOT, 'tsconfig.json'),
        external: externals,
    });
    const compiled = r.outputFiles?.[0]?.text;
    if (!compiled)
        throw new Error(`no output: ${entry}`);
    return textToBytes(compiled);
};
// -------------------------------------------------
// main
// -------------------------------------------------
const main = async () => {
    rmSync(DIST_ROOT, { recursive: true, force: true });
    ensureDir(DIST_ROOT);
    const sources = discoverSources();
    if (!sources.length)
        throw new Error('no sources found');
    const resourcesByDir = new Map();
    const dependencyBytes = new Map();
    const resourceBytes = new Map();
    const layers = new Map();
    // dependencies
    const deps = sources.filter(s => s.kind === 'dependency');
    const namespaceToMembers = new Map();
    const nsDerived = new Set();
    for (const src of deps) {
        const ns = namespaceRelDirFromRelDir(src.relDir);
        nsDerived.add(ns);
        const list = namespaceToMembers.get(ns) ?? [];
        list.push(src);
        namespaceToMembers.set(ns, list);
    }
    const nsAll = new Set();
    for (const ns of nsDerived) {
        for (const p of prefixesForNamespaceRelDir(ns))
            nsAll.add(p);
    }
    const allNs = Array.from(nsAll).sort();
    const allSpecifiers = allNs.map(specifierFromNamespaceRelDir);
    for (const ns of allNs) {
        const members = namespaceToMembers.get(ns) ?? [];
        const built = await buildNamespaceDependency(ns, members, allSpecifiers);
        dependencyBytes.set(built.sig, built.bytes);
        addToBucket(resourcesByDir, ns, jsFileName(built.sig), 'dep');
        for (const f of members)
            addToBucket(resourcesByDir, f.relDir, jsFileName(built.sig), 'dep');
    }
    const rootDependencies = uniqSorted(Array.from(dependencyBytes.keys()).map(jsFileName));
    const dependencySigs = Array.from(dependencyBytes.keys()).sort((a, b) => a.localeCompare(b));
    // drones
    const droneExternals = [...PLATFORM_EXTERNALS, ...allSpecifiers];
    for (const src of sources.filter(s => s.kind === 'drone')) {
        const bytes = await buildDrone(src.entry, droneExternals);
        const sig = await SignatureService.sign(toArrayBuffer(bytes));
        resourceBytes.set(sig, bytes);
        addToBucket(resourcesByDir, src.relDir, jsFileName(sig), 'drone');
    }
    // layers
    const tree = readDirTree(SRC_ROOT, '');
    const rootLayerSig = await buildLayersFromTree(tree, resourcesByDir, layers, rootDependencies);
    // write package
    const rootDir = join(DIST_ROOT, rootLayerSig);
    const layersDir = join(rootDir, '__layers__');
    const resDir = join(rootDir, '__drones__');
    const depDir = join(rootDir, '__dependencies__');
    ensureDir(layersDir);
    ensureDir(resDir);
    ensureDir(depDir);
    for (const [sig, json] of layers)
        writeLayerJsonFile(layersDir, sig, json);
    for (const [sig, bytes] of dependencyBytes)
        writeSigJsFile(depDir, sig, bytes);
    for (const [sig, bytes] of resourceBytes)
        writeSigJsFile(resDir, sig, bytes);
    // minimal install manifest (signatures only, no root)
    const installManifest = {
        version: 1,
        layers: Array.from(layers.keys()).sort((a, b) => a.localeCompare(b)),
        drones: Array.from(resourceBytes.keys()).sort((a, b) => a.localeCompare(b)),
        dependencies: dependencySigs,
    };
    writeFileSync(join(rootDir, INSTALL_MANIFEST_FILE), JSON.stringify(installManifest) + '\n', 'utf8');
    // deploy
    const ps1 = resolve(__dirname, 'deploy-azure.ps1');
    if (existsSync(ps1)) {
        const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1, '-Signature', rootLayerSig], { stdio: 'inherit' });
        if (r.status !== 0)
            throw new Error('deployment failed');
    }
};
main().catch(err => {
    console.error(err);
    process.exit(1);
});
