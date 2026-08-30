const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const hiveSource = fs.readFileSync(path.join(__dirname, "hive.js"), "utf8");
eval(hiveSource);
const hive = globalThis.SmartAutolinkerHive;

const SIG = (n) => n.repeat(64).slice(0, 64);

// A tiny published universe: one ledger, one site, three layers deep.
const universe = {
  "https://ledger.test/publications.json": {
    sites: [{
      host: "revolucion.test",
      url: "https://revolucion.test/",
      title: "Revolución",
      lineage: "revolucion",
      publishers: [{ pubkey: SIG("e"), primary: true, head: SIG("a") }]
    }, {
      host: "unpublished.test",
      url: "https://unpublished.test/",
      title: "Nothing yet",
      publishers: [{ pubkey: SIG("e"), primary: true, head: null }]
    }]
  },
  // Children point at incidence records ({meta, layer, relation}) which in
  // turn name the child layer — exactly how published trees ship.
  [`https://revolucion.test/${SIG("a")}`]: {
    name: "revolucion",
    children: [SIG("1"), SIG("c"), SIG("d")]
  },
  [`https://revolucion.test/${SIG("1")}`]: { meta: 1, layer: SIG("b"), relation: "children" },
  [`https://revolucion.test/${SIG("b")}`]: {
    name: "Flavor Wheel",
    children: [SIG("f")]
  },
  [`https://revolucion.test/${SIG("c")}`]: { name: "el-bar" },
  // A sig-named child (a part, not a creation) is walked but never linked.
  [`https://revolucion.test/${SIG("d")}`]: { name: SIG("d") },
  [`https://revolucion.test/${SIG("f")}`]: { name: "Earthy & Sweet" }
};

let fetches = 0;
const io = {
  json: async (url) => {
    fetches += 1;
    if (!(url in universe)) throw new Error(`404 ${url}`);
    return structuredClone(universe[url]);
  },
  now: () => 1700000000000
};

async function run() {
  {
    // normalizeCell matches the engine's URL segment fold.
    assert.equal(hive.normalizeCell("Flavor Wheel"), "flavor-wheel");
    assert.equal(hive.normalizeCell("Earthy & Sweet"), "earthy-sweet");
    assert.equal(hive.normalizeCell("Revolución"), "revolución");
  }
  {
    fetches = 0;
    const state = await hive.syncPublications("https://ledger.test/publications.json", io);
    assert.equal(state.sites.length, 1, "site without a published head is skipped");
    assert.equal(state.sites[0].host, "revolucion.test");
    assert.equal(state.sites[0].head, SIG("a"));

    const byPhrase = new Map(state.replacements.map((item) => [item.phrase, item.url]));
    assert.equal(byPhrase.get("Revolución"), "https://revolucion.test/");
    assert.equal(byPhrase.get("Flavor Wheel"), "https://revolucion.test/flavor-wheel");
    assert.equal(byPhrase.get("el-bar"), "https://revolucion.test/el-bar");
    assert.equal(byPhrase.get("el bar"), "https://revolucion.test/el-bar", "dashed cell name also minted with spaces");
    assert.equal(byPhrase.get("Earthy & Sweet"), "https://revolucion.test/flavor-wheel/earthy-sweet");
    assert.equal(state.replacements.length, 5, "sig-named part mints no replacement");
    assert.ok(state.replacements.every((item) => item.groupId === "hive"));
    assert.ok(state.replacements.every((item) => item.siteHost === "revolucion.test"));

    // Re-sync with the same head walks nothing — signature cache hit.
    const before = fetches;
    state.sites[0].enabled = false;
    const again = await hive.syncPublications("https://ledger.test/publications.json", io, state);
    assert.equal(fetches, before + 1, "only the ledger is re-fetched");
    assert.equal(again.replacements.length, 5);
    assert.equal(again.sites[0].enabled, false, "per-site toggle survives re-sync");
  }
  {
    // A hole in the tree (missing layer) is skipped, the rest still mints.
    const holed = {
      host: "holed.test", url: "https://holed.test/", title: "Holed",
      head: SIG("a")
    };
    const holedIo = {
      json: async (url) => {
        if (url.endsWith(SIG("a"))) return { name: "holed", children: [SIG("b"), SIG("c")] };
        if (url.endsWith(SIG("c"))) return { name: "Survivor" };
        throw new Error("404");
      }
    };
    const items = await hive.walkSite(holed, holedIo);
    assert.deepEqual(items.map((item) => item.phrase).sort(), ["Holed", "Survivor"]);
  }
  console.log("hive.test.cjs: all assertions passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
