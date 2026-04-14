// src/diamondcoreprocessor.com/presentation/tiles/site-view.drone.ts
import {
  Drone,
  TILE_CONTENT_REGISTRY_IOC_KEY,
  SITE_VIEW_IOC_KEY,
  CELL_WEBSITE_PROPERTY,
  CELL_RENDERER_PROPERTY,
  RESOURCE_URL_PREFIX,
  parseBundle
} from "@hypercomb/core";

// src/diamondcoreprocessor.com/editor/tile-properties.ts
var TILE_PROPERTIES_FILE = "0000";
var isSignature = (value) => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
var readCellProperties = async (cellDir) => {
  try {
    const fileHandle = await cellDir.getFileHandle(TILE_PROPERTIES_FILE);
    const file = await fileHandle.getFile();
    const text = await file.text();
    return JSON.parse(text);
  } catch {
    return {};
  }
};

// src/diamondcoreprocessor.com/presentation/tiles/site-view.drone.ts
var Registry = class {
  #byKey = /* @__PURE__ */ new Map();
  #byKind = /* @__PURE__ */ new Map();
  register(renderer) {
    if (this.#byKey.has(renderer.key)) this.unregister(renderer.key);
    this.#byKey.set(renderer.key, renderer);
    const bucket = this.#byKind.get(renderer.kind) ?? [];
    bucket.push(renderer);
    bucket.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    this.#byKind.set(renderer.kind, bucket);
  }
  unregister(key) {
    const r = this.#byKey.get(key);
    if (!r) return;
    this.#byKey.delete(key);
    const bucket = this.#byKind.get(r.kind)?.filter((x) => x.key !== key) ?? [];
    if (bucket.length) this.#byKind.set(r.kind, bucket);
    else this.#byKind.delete(r.kind);
  }
  resolve(kind) {
    return this.#byKind.get(kind)?.[0] ?? null;
  }
};
var SiteViewDrone = class extends Drone {
  namespace = "diamondcoreprocessor.com";
  genotype = "presentation";
  description = "Full-viewport site takeover. Reads a `websiteSig` decoration on the nearest ancestor, unpacks the bundle, and renders the page matching the current lineage path.";
  #registry = new Registry();
  #mount = null;
  #viewActive = false;
  #registered = false;
  #lineageBound = false;
  deps = {
    lineage: "@hypercomb.social/Lineage",
    store: "@hypercomb.social/Store"
  };
  listens = [];
  emits = ["view:active"];
  heartbeat = async () => {
    if (!this.#registered) {
      this.#registry.register(defaultWebsiteRenderer);
      window.ioc.register(TILE_CONTENT_REGISTRY_IOC_KEY, this.#registry);
      window.ioc.register(SITE_VIEW_IOC_KEY, this);
      this.#registered = true;
    }
    if (this.#lineageBound) return;
    const lineage = this.resolve("lineage");
    if (!lineage?.addEventListener) return;
    lineage.addEventListener("change", this.#onLineageChange);
    this.#lineageBound = true;
    void this.#reconcile();
  };
  dispose() {
    const lineage = this.resolve("lineage");
    if (this.#lineageBound && lineage?.removeEventListener) {
      lineage.removeEventListener("change", this.#onLineageChange);
    }
    this.#teardown();
  }
  #onLineageChange = () => {
    void this.#reconcile();
  };
  async #reconcile() {
    const lineage = this.resolve("lineage");
    const store = this.resolve("store");
    if (!lineage || !store?.hypercombRoot || !store?.getResource) return;
    const segments = [...lineage.explorerSegments?.() ?? []];
    const found = await this.#findNearestWebsite(store.hypercombRoot, segments);
    if (!found) {
      this.#teardown();
      return;
    }
    const { siteSig, sitePath, kind } = found;
    const pagePath = segments.slice(sitePath.length);
    const renderer = this.#registry.resolve(kind);
    if (!renderer) {
      this.#teardown();
      return;
    }
    if (this.#mount && this.#mount.siteSig === siteSig && this.#mount.kind === kind) {
      const frame2 = { pagePath, fullPath: segments };
      try {
        this.#mount.handle.update(frame2);
      } catch {
      }
      this.#mount.sitePath = sitePath;
      return;
    }
    const manifest = await this.#loadManifest(store, siteSig);
    if (!manifest) {
      this.#teardown();
      return;
    }
    this.#teardown();
    this.#setViewActive(true);
    const host = document.createElement("div");
    host.id = "hc-site-view-host";
    host.style.cssText = "position:fixed;inset:0;z-index:59988;background:#fff;overflow:hidden;";
    document.body.appendChild(host);
    const frame = { pagePath, fullPath: segments };
    const ctx = {
      host,
      manifest,
      getResource: (sig) => store.getResource(sig),
      frame,
      navigate: (path) => this.#navigate(path)
    };
    try {
      const handle = await renderer.mount(ctx);
      this.#mount = { handle, host, kind, siteSig, sitePath };
    } catch (err) {
      console.warn("[site-view] renderer failed:", err);
      host.remove();
      this.#setViewActive(false);
    }
  }
  async #findNearestWebsite(root, segments) {
    let dir = root;
    const visited = [{ dir: root, path: [] }];
    for (const seg of segments) {
      if (!dir) break;
      try {
        dir = await dir.getDirectoryHandle(seg);
      } catch {
        dir = null;
        break;
      }
      if (dir) visited.push({ dir, path: [...visited[visited.length - 1].path, seg] });
    }
    for (let i = visited.length - 1; i >= 0; i--) {
      const { dir: dir2, path } = visited[i];
      const props = await readCellProperties(dir2).catch(() => ({}));
      const sig = props[CELL_WEBSITE_PROPERTY];
      if (!isSignature(sig)) continue;
      let kind = "website";
      const override = props[CELL_RENDERER_PROPERTY];
      if (override && typeof override === "object" && typeof override.kind === "string") {
        kind = override.kind;
      }
      return { siteSig: sig, sitePath: path, kind };
    }
    return null;
  }
  async #loadManifest(store, siteSig) {
    try {
      const bundleBlob = await store.getResource(siteSig);
      if (!bundleBlob) return null;
      const bundleText = await bundleBlob.text();
      const sigs = parseBundle(bundleText);
      if (sigs.length === 0) return null;
      const manifestSig = sigs[0];
      const manifestBlob = await store.getResource(manifestSig);
      if (!manifestBlob) return null;
      const manifest = JSON.parse(await manifestBlob.text());
      if (manifest?.version !== 1) return null;
      return manifest;
    } catch {
      return null;
    }
  }
  #teardown() {
    if (this.#mount) {
      try {
        this.#mount.handle.unmount();
      } catch {
      }
      this.#mount.host.remove();
      this.#mount = null;
    }
    if (this.#viewActive) this.#setViewActive(false);
  }
  #setViewActive(active) {
    if (this.#viewActive === active) return;
    this.#viewActive = active;
    this.emitEffect("view:active", { active });
  }
  #navigate(path) {
    const lineage = this.resolve("lineage");
    if (!lineage) return;
    const current = [...lineage.explorerSegments?.() ?? []];
    const next = [...path];
    let common = 0;
    while (common < current.length && common < next.length && current[common] === next[common]) common++;
    for (let i = 0; i < current.length - common; i++) lineage.explorerUp?.();
    for (let i = common; i < next.length; i++) lineage.explorerEnter?.(next[i]);
  }
};
var defaultWebsiteRenderer = {
  key: "@diamondcoreprocessor.com/DefaultWebsiteRenderer",
  kind: "website",
  priority: 0,
  mount: async (ctx) => {
    const shadow = ctx.host.attachShadow({ mode: "open" });
    const viewport = document.createElement("div");
    viewport.style.cssText = "position:absolute;inset:0;overflow:auto;font:14px system-ui,sans-serif;background:#fafafa;color:#222;";
    shadow.appendChild(viewport);
    if (ctx.manifest.title) {
      try {
        document.title = ctx.manifest.title;
      } catch {
      }
    }
    const render = async (frame) => {
      const pageSig = pickPage(ctx.manifest, frame.pagePath);
      if (!pageSig) {
        viewport.innerHTML = defaultNotFound(frame.pagePath);
        return;
      }
      const html = await readText(ctx.getResource, pageSig);
      if (!html) {
        viewport.innerHTML = defaultNotFound(frame.pagePath);
        return;
      }
      viewport.innerHTML = rewriteAssetUrls(html, ctx.manifest);
      viewport.scrollTo({ top: 0 });
    };
    const onAnchorClick = (e) => {
      const a = e.composedPath().find((n) => n instanceof HTMLAnchorElement);
      if (!a) return;
      const href = a.getAttribute("href") ?? "";
      if (!href || /^(https?:|mailto:|tel:|data:|\/\/)/i.test(href)) return;
      if (href.startsWith(RESOURCE_URL_PREFIX)) return;
      e.preventDefault();
      const sitePrefix = ctx.frame.fullPath.slice(0, ctx.frame.fullPath.length - ctx.frame.pagePath.length);
      if (href === ".." || href === "../") {
        const currentPage = ctx.frame.pagePath;
        if (currentPage.length === 0) return;
        ctx.navigate([...sitePrefix, ...currentPage.slice(0, -1)]);
        return;
      }
      if (href.startsWith("/")) {
        const parts2 = href.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
        ctx.navigate([...sitePrefix, ...parts2]);
        return;
      }
      const parts = href.replace(/^[./]+/, "").replace(/\/+$/, "").split("/").filter(Boolean);
      ctx.navigate([...sitePrefix, ...ctx.frame.pagePath, ...parts]);
    };
    viewport.addEventListener("click", onAnchorClick, true);
    await render(ctx.frame);
    return {
      update: (frame) => {
        void render(frame);
      },
      unmount: () => {
        viewport.removeEventListener("click", onAnchorClick, true);
        shadow.replaceChildren();
      }
    };
  }
};
function pickPage(manifest, pagePath) {
  const key = pagePath.join("/");
  return manifest.pages?.[key] ?? manifest.entry ?? manifest.pages?.[""] ?? null;
}
async function readText(getResource, sig) {
  try {
    const blob = await getResource(sig);
    return blob ? await blob.text() : null;
  } catch {
    return null;
  }
}
function rewriteAssetUrls(text, manifest) {
  let out = text.replace(/resource:([0-9a-f]{64})/g, `${RESOURCE_URL_PREFIX}$1`);
  out = out.replace(
    /((?:src|href|data-src)=)(["'])([0-9a-f]{64})\2/g,
    (_m, attr, q, sig) => `${attr}${q}${RESOURCE_URL_PREFIX}${sig}${q}`
  );
  if (manifest.assets) {
    out = out.replace(/asset:([^"'\s<>()]+)/g, (_m, name) => {
      const sig = manifest.assets?.[name];
      return sig ? `${RESOURCE_URL_PREFIX}${sig}` : _m;
    });
  }
  return out;
}
function defaultNotFound(path) {
  return `<main style="padding:2rem;max-width:720px;margin:0 auto;font:14px system-ui,sans-serif">
    <h1>Page not found</h1>
    <p>No entry for <code>/${path.join("/")}</code> in this site's manifest.</p>
  </main>`;
}
var _siteView = new SiteViewDrone();
window.ioc.register("@diamondcoreprocessor.com/SiteViewDrone", _siteView);
export {
  SiteViewDrone
};
