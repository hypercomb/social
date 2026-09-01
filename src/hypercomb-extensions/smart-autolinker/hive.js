(function (root) {
  "use strict";

  const DEFAULT_LEDGER = "https://pluginthematrix.com/publications.json";
  const SIG_RE = /^[a-f0-9]{64}$/;
  const MAX_NODES = 400;
  const MAX_DEPTH = 6;
  const FETCH_BATCH = 6;

  // Mirror of hypercomb-core normalizeCell — a tile name folded to the URL
  // segment the published engine resolves.
  function normalizeCell(value) {
    return String(value || "")
      .trim()
      .toLocaleLowerCase()
      .replace(/[._\s]+/g, "-")
      .replace(/[^\p{L}\p{N}\-]/gu, "")
      .replace(/-{2,}/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 64)
      .replace(/-$/, "");
  }

  function emptyState() {
    return { ledger: DEFAULT_LEDGER, syncedAt: null, sites: [], replacements: [] };
  }

  function linkablePhrase(name) {
    const phrase = String(name || "").trim();
    return phrase.length >= 3 && !SIG_RE.test(phrase.toLowerCase()) ? phrase : null;
  }

  // BFS a published site's tree: head layer → children[] → named layers.
  // Every named node becomes a phrase → URL pair on that site's host. A
  // node's URL segment is its own folded name, so paths grow as layers
  // arrive: parent path + normalizeCell(child name).
  async function walkSite(site, io, caps = {}) {
    const maxNodes = caps.maxNodes ?? MAX_NODES;
    const maxDepth = caps.maxDepth ?? MAX_DEPTH;
    const base = String(site.url || `https://${site.host}/`).replace(/\/+$/, "");
    const replacements = [];
    const seenSigs = new Set([site.head]);
    const seenLinks = new Set();

    function mint(phrase, segments) {
      const url = segments.length
        ? base + "/" + segments.map(encodeURIComponent).join("/")
        : base + "/";
      // Folded cell names read dashed ("flavor-wheel") but get typed with
      // spaces — offer both spellings of the same creation.
      const spellings = [...new Set([phrase, phrase.replace(/-/g, " ").replace(/\s+/g, " ").trim()])];
      for (const spelling of spellings) {
        const key = spelling.toLocaleLowerCase() + "\n" + url;
        if (seenLinks.has(key)) continue;
        seenLinks.add(key);
        replacements.push({
          id: `hive:${site.host}:${segments.join("/") || "root"}:${spelling === phrase ? "cell" : "spaced"}`,
          phrase: spelling,
          url,
          groupId: "hive",
          siteHost: site.host,
          enabled: true
        });
      }
    }

    const rootPhrase = linkablePhrase(site.title);
    if (rootPhrase) mint(rootPhrase, []);

    const queue = [{ sig: site.head, parentSegments: [], depth: 0 }];
    let visited = 0;
    while (queue.length && visited < maxNodes) {
      const batch = queue.splice(0, FETCH_BATCH);
      visited += batch.length;
      const layers = await Promise.all(batch.map((entry) =>
        io.json(`${base}/${entry.sig}`).catch(() => null)
      ));
      layers.forEach((layer, index) => {
        const entry = batch[index];
        if (!layer || typeof layer !== "object") return;
        // A child slot may hold an incidence record ({meta, layer, relation})
        // rather than the layer itself — follow it one hop at the same depth.
        if (layer.meta && typeof layer.layer === "string") {
          const target = layer.layer.toLowerCase();
          if (SIG_RE.test(target) && !seenSigs.has(target)) {
            seenSigs.add(target);
            queue.push({ sig: target, parentSegments: entry.parentSegments, depth: entry.depth });
          }
          return;
        }
        let segments = entry.parentSegments;
        if (entry.depth > 0) {
          const segment = normalizeCell(layer.name);
          if (!segment) return;
          segments = [...entry.parentSegments, segment];
          const phrase = linkablePhrase(layer.name);
          if (phrase) mint(phrase, segments);
        }
        if (entry.depth >= maxDepth || !Array.isArray(layer.children)) return;
        for (const childSig of layer.children) {
          const sig = String(childSig || "").toLowerCase();
          if (!SIG_RE.test(sig) || seenSigs.has(sig)) continue;
          seenSigs.add(sig);
          queue.push({ sig, parentSegments: segments, depth: entry.depth + 1 });
        }
      });
    }
    return replacements;
  }

  // Fetch the ledger and walk every published site. `previous` lets a
  // re-sync keep per-site enabled flags and skip unchanged heads — same
  // signature, same tree, instant cache hit.
  async function syncPublications(ledgerUrl, io, previous = null) {
    const url = String(ledgerUrl || "").trim() || DEFAULT_LEDGER;
    const ledger = await io.json(url);
    if (!ledger || !Array.isArray(ledger.sites)) throw new Error("ledger has no sites");
    const sites = [];
    const replacements = [];
    for (const raw of ledger.sites) {
      const publisher = (raw.publishers || []).find((p) => p.primary && p.head)
        || (raw.publishers || []).find((p) => p.head);
      if (!publisher || !raw.host) continue;
      const prev = (previous?.sites || []).find((s) => s.host === raw.host);
      const enabled = prev ? prev.enabled !== false : true;
      const cached = prev && prev.head === publisher.head
        ? (previous?.replacements || []).filter((r) => r.siteHost === raw.host)
        : [];
      const items = cached.length ? cached : await walkSite({
        host: raw.host, url: raw.url, title: raw.title, head: publisher.head
      }, io);
      sites.push({ host: raw.host, title: raw.title || raw.host, head: publisher.head, enabled, count: items.length });
      replacements.push(...items);
    }
    return { ledger: url, syncedAt: io.now ? io.now() : Date.now(), sites, replacements };
  }

  root.SmartAutolinkerHive = { DEFAULT_LEDGER, normalizeCell, emptyState, walkSite, syncPublications };
})(globalThis);
