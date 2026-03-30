// Analyze the domain/namespace redundancy

const NAMESPACE_SEGMENTS_MAX = 3;
const EMIT_DOMAIN_ROOT_NAMESPACE = false;

const splitPath = (p) => p.split('/').filter(Boolean);

const namespaceRelDirFromRelDir = (relDir) => {
  const parts = splitPath(relDir);
  return parts.slice(0, Math.min(NAMESPACE_SEGMENTS_MAX, parts.length)).join('/');
};

const prefixesForNamespaceRelDir = (nsRelDir) => {
  const parts = splitPath(nsRelDir);
  const out = [];
  const start = EMIT_DOMAIN_ROOT_NAMESPACE ? 1 : 2;
  for (let i = start; i <= Math.min(parts.length, NAMESPACE_SEGMENTS_MAX); i++) {
    out.push(parts.slice(0, i).join('/'));
  }
  return out;
};

// Test with nested paths to show the redundancy
console.log("DOMAIN/NAMESPACE REDUNDANCY ANALYSIS");
console.log("====================================\n");

console.log("The prefixesForNamespaceRelDir() function creates PARENT prefixes:");
console.log("- When EMIT_DOMAIN_ROOT_NAMESPACE = false (current), start = 2");
console.log("- This means it skips the domain level and only emits level 2 and up\n");

const testCases = [
  {
    sourceDir: "diamondcoreprocessor.com/navigation/pan",
    depth: 3,
    label: "3-level path (domain/category/subcategory)"
  },
  {
    sourceDir: "diamondcoreprocessor.com/presentation/background",
    depth: 3,
    label: "3-level path"
  },
  {
    sourceDir: "diamondcoreprocessor.com/assistant",
    depth: 2,
    label: "2-level path (domain/category)"
  },
];

for (const tc of testCases) {
  console.log(`\n--- ${tc.label} ---`);
  console.log(`Source directory: ${tc.sourceDir}`);
  
  const ns = namespaceRelDirFromRelDir(tc.sourceDir);
  console.log(`Full namespace (first ${NAMESPACE_SEGMENTS_MAX} levels): ${ns}`);
  
  const parts = splitPath(ns);
  console.log(`Path parts: [${parts.map(p => `"${p}"`).join(', ')}] (length: ${parts.length})`);
  
  const prefixes = prefixesForNamespaceRelDir(ns);
  console.log(`Prefixes generated (start from index 2): [${prefixes.map(p => `"${p}"`).join(', ')}]`);
  
  console.log(`\nRedundancy check:`);
  if (prefixes.length > 0 && parts.length > 1) {
    const fullMatch = prefixes.some(p => p === ns);
    const domainLevel = parts[0];
    const categoryLevel = parts.length > 1 ? parts[1] : null;
    
    console.log(`  Domain: "${domainLevel}"`);
    console.log(`  Category: "${categoryLevel}"`);
    if (parts.length > 2) {
      console.log(`  Subcategory: "${parts[2]}"`);
    }
    console.log(`  Full namespace "${ns}" IS ${fullMatch ? 'included' : 'NOT included'} in prefixes`);
    console.log(`  → Generates module @${parts[0]}/${parts[1]} AND @${parts[0]}/${parts[1]}/${parts[2]}`);
    console.log(`  → This creates two namespaces for the SAME domain!`);
  }
}

console.log("\n\nSUMMARY OF REDUNDANCY:");
console.log("=====================");
console.log("With start = 2 (current), for a path like:");
console.log("  diamondcoreprocessor.com/navigation/pan");
console.log("");
console.log("The code generates BOTH:");
console.log("  1. @diamondcoreprocessor.com/navigation (level 2)");
console.log("  2. @diamondcoreprocessor.com/navigation/pan (level 3)");
console.log("");
console.log("This means:");
console.log("  - Domain 'diamondcoreprocessor.com' → multiple namespace entries");
console.log("  - No 'domain → [packages]' mapping, instead:");
console.log("    - 'domain/category → [packages]'");
console.log("    - 'domain/category/subcategory → [packages]'");
console.log("");
console.log("If start = 1, it would ALSO generate:");
console.log("  0. @diamondcoreprocessor.com (level 1 - domain root)");
console.log("  1. @diamondcoreprocessor.com/navigation (level 2)");
console.log("  2. @diamondcoreprocessor.com/navigation/pan (level 3)");
