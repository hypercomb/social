// Simulate the namespace logic from build-module.ts
const NAMESPACE_SEGMENTS_MAX = 3;
const EMIT_DOMAIN_ROOT_NAMESPACE = false;
const PACKAGE_SPECIFIER = '@hypercomb/essentials';

const splitPath = (p) => p.split('/').filter(Boolean);

const namespaceRelDirFromRelDir = (relDir) => {
  const parts = splitPath(relDir);
  return parts.slice(0, Math.min(NAMESPACE_SEGMENTS_MAX, parts.length)).join('/');
};

const isDomainNamespace = (namespaceRelDir) =>
  splitPath(namespaceRelDir)[0]?.includes('.') ?? false;

const prefixesForNamespaceRelDir = (nsRelDir) => {
  const parts = splitPath(nsRelDir);
  const out = [];
  const start = isDomainNamespace(nsRelDir)
    ? (EMIT_DOMAIN_ROOT_NAMESPACE ? 1 : 2)
    : 1;
  for (let i = start; i <= Math.min(parts.length, NAMESPACE_SEGMENTS_MAX); i++) {
    out.push(parts.slice(0, i).join('/'));
  }
  return out;
};

const specifierFromNamespaceRelDir = (namespaceRelDir) =>
  isDomainNamespace(namespaceRelDir)
    ? `@${namespaceRelDir}`
    : `${PACKAGE_SPECIFIER}/${namespaceRelDir}`;

// Test with a few examples
const examples = [
  "assistant",
  "assistant/conversation",
  "presentation/background",
  "dolphin.com/commands",
];

console.log("Namespace mapping test:");
console.log("======================\n");

for (const example of examples) {
  const ns = namespaceRelDirFromRelDir(example);
  const prefixes = prefixesForNamespaceRelDir(ns);
  const specifiers = prefixes.map(specifierFromNamespaceRelDir);
  
  console.log(`Source path: ${example}`);
  console.log(`  → namespace: ${ns}`);
  console.log(`  → prefixes: ${JSON.stringify(prefixes)}`);
  console.log(`  → specifiers: ${JSON.stringify(specifiers)}`);
  console.log();
}
