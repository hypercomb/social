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
import { EffectBus } from "@hypercomb/core";
var TILE_PROPERTIES_FILE = "0000";
var isSignature = (value) => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
var readCellProperties = async (cellDir) => {
  let fileHandle;
  try {
    fileHandle = await cellDir.getFileHandle(TILE_PROPERTIES_FILE);
  } catch {
    return {};
  }
  try {
    const file = await fileHandle.getFile();
    const text = await file.text();
    return JSON.parse(text);
  } catch (err) {
    console.warn("[tile-properties] failed to read/parse 0000 in", cellDir.name, err);
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
  #viewModeBound = false;
  #globalContextMenuBound = false;
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
    if (!this.#lineageBound) {
      const lineage = this.resolve("lineage");
      if (lineage?.addEventListener) {
        lineage.addEventListener("change", this.#onLineageChange);
        this.#lineageBound = true;
      }
    }
    if (!this.#viewModeBound) {
      const vm = window.ioc?.get("@hypercomb.social/ViewMode");
      if (vm?.addEventListener) {
        vm.addEventListener("change", this.#onViewModeChange);
        this.#viewModeBound = true;
      }
    }
    if (!this.#globalContextMenuBound) {
      window.addEventListener("contextmenu", this.#onGlobalContextMenu, true);
      this.#globalContextMenuBound = true;
    }
    void this.#reconcile();
  };
  dispose() {
    const lineage = this.resolve("lineage");
    if (this.#lineageBound && lineage?.removeEventListener) {
      lineage.removeEventListener("change", this.#onLineageChange);
    }
    const vm = window.ioc?.get("@hypercomb.social/ViewMode");
    if (this.#viewModeBound && vm?.removeEventListener) {
      vm.removeEventListener("change", this.#onViewModeChange);
    }
    if (this.#globalContextMenuBound) {
      window.removeEventListener("contextmenu", this.#onGlobalContextMenu, true);
    }
    this.#teardown();
  }
  #onLineageChange = () => {
    void this.#reconcile();
  };
  #onViewModeChange = () => {
    void this.#reconcile();
  };
  /** Window-level contextmenu handler. Active only in website mode —
   *  right-click navigates up one level, matching the iframe-injected
   *  hook and hexagon-view's right-button-down. The capture-phase
   *  listener fires before downstream consumers so the browser's
   *  default context menu never appears in this mode. */
  #onGlobalContextMenu = (e) => {
    const vm = window.ioc?.get("@hypercomb.social/ViewMode");
    if (!vm || vm.mode !== "website") return;
    e.preventDefault();
    const lineage = this.resolve("lineage");
    const segments = [...lineage?.explorerSegments?.() ?? []];
    if (segments.length === 0) return;
    this.#navigate(segments.slice(0, -1));
  };
  async #reconcile() {
    const lineage = this.resolve("lineage");
    const store = this.resolve("store");
    if (!lineage || !store?.hypercombRoot || !store?.getResource) return;
    const vm = window.ioc?.get("@hypercomb.social/ViewMode");
    if (vm && vm.mode !== "website") {
      this.#teardown();
      return;
    }
    if (window.location.hash) {
      try {
        window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
      } catch {
      }
    }
    const segments = [...lineage.explorerSegments?.() ?? []];
    const cellPageSig = await this.#findContextPage(segments, store);
    if (cellPageSig) {
      await this.#mountCellPage(segments, cellPageSig, store);
      return;
    }
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
  /** Per-cell page lookup. Reads the cell's layer at `segments`,
   *  scans its `context` slot for the first HTML-shaped resource,
   *  returns that sig. Probes the resource head to detect HTML rather
   *  than trusting position — a cell's bag is heterogeneous (prior
   *  impls, chrome refs, examples) and the renderer should pick the
   *  page kind by content, not by index. */
  async #findContextPage(segments, store) {
    const ioc = window.ioc;
    const history = ioc?.get("@diamondcoreprocessor.com/HistoryService");
    if (!history) return null;
    try {
      const locationSig = await history.sign({ explorerSegments: () => segments });
      const layer = await history.currentLayerAt(locationSig);
      if (!layer) return null;
      const context = layer.context;
      const sigs = Array.isArray(context) ? context.map((s) => String(s)).filter((s) => /^[0-9a-f]{64}$/.test(s)) : [];
      for (const sig of sigs) {
        const blob = await store.getResource(sig);
        if (!blob) continue;
        const head = await blob.slice(0, 64).text();
        if (/^\s*(?:﻿)?(<!doctype|<html|<svg|<\?xml)/i.test(head)) return sig;
      }
    } catch {
    }
    return null;
  }
  /** Mount the per-cell HTML inline in the live document. No iframe,
   *  no shadow DOM. The author's HTML is parsed, its `<style>` blocks
   *  are appended to <head> (tagged with a marker so we can lift them
   *  cleanly on unmount), its `<script>` blocks are recreated as live
   *  script elements so they actually run, and its `<body>` content
   *  is dropped into a host div pinned over the viewport.
   *
   *  CSS like `html { background: var(--bg) }` applies to the live
   *  page's html element — which is exactly the right scope: in
   *  website mode every other surface is `display:none` via the
   *  `hc-view-website` body class, so the page IS the cell's content.
   *  No selector rewrites needed.
   *
   *  Navigation: anchor clicks bubble to the host's click listener,
   *  which intercepts internal hrefs and updates lineage. The
   *  resource is already warm — the layer-slot preloader walks
   *  `context` slot sigs into the resource cache when the layer is
   *  visited, so render is a synchronous DOM operation. */
  async #mountCellPage(segments, pageSig, store) {
    if (this.#mount && this.#mount.kind === "cell-page" && this.#mount.siteSig === pageSig) {
      this.#mount.sitePath = [...segments];
      return;
    }
    const blob = await store.getResource(pageSig);
    if (!blob) {
      this.#teardown();
      return;
    }
    const rawHtml = await blob.text();
    this.#teardown();
    const parsed = new DOMParser().parseFromString(rewriteCellPageRefs(rawHtml), "text/html");
    const styleNodes = [];
    for (const s of Array.from(parsed.querySelectorAll("style"))) {
      const live = document.createElement("style");
      live.setAttribute("data-hc-cell-page", pageSig);
      live.textContent = s.textContent ?? "";
      document.head.appendChild(live);
      styleNodes.push(live);
    }
    const linkNodes = [];
    for (const l of Array.from(parsed.querySelectorAll('link[rel="stylesheet"]'))) {
      const live = document.createElement("link");
      live.setAttribute("data-hc-cell-page", pageSig);
      for (const a of Array.from(l.attributes)) live.setAttribute(a.name, a.value);
      document.head.appendChild(live);
      linkNodes.push(live);
    }
    const host = document.createElement("div");
    host.id = "hc-site-view-host";
    host.style.cssText = "position:fixed;inset:0;z-index:59988;overflow:auto;";
    document.body.appendChild(host);
    const body = parsed.body;
    if (body) {
      while (body.firstChild) host.appendChild(body.firstChild);
    }
    const scriptNodes = [];
    const runScripts = (sources) => {
      for (const s of sources) {
        const live = document.createElement("script");
        for (const a of Array.from(s.attributes)) live.setAttribute(a.name, a.value);
        live.textContent = s.textContent ?? "";
        host.appendChild(live);
        scriptNodes.push(live);
      }
    };
    runScripts(Array.from(parsed.head.querySelectorAll("script")));
    runScripts(Array.from(host.querySelectorAll("script")).filter((s) => !scriptNodes.includes(s)));
    const onAnchorClick = (e) => {
      const target = e.target;
      const a = target?.closest?.("a");
      if (!a) return;
      const href = a.getAttribute("href") ?? "";
      if (!href || /^(https?:|mailto:|tel:|data:|\/\/|#)/i.test(href)) return;
      if (href.startsWith(RESOURCE_URL_PREFIX)) return;
      e.preventDefault();
      if (href === ".." || href === "../") {
        if (segments.length > 0) this.#navigate(segments.slice(0, -1));
        return;
      }
      if (href.startsWith("/")) {
        const parts2 = href.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
        this.#navigate(parts2);
        return;
      }
      const parts = href.replace(/^\.\/+/, "").replace(/\/+$/, "").split("/").filter(Boolean);
      this.#navigate([...segments, ...parts]);
    };
    host.addEventListener("click", onAnchorClick, true);
    this.#mount = {
      host,
      kind: "cell-page",
      siteSig: pageSig,
      sitePath: [...segments],
      handle: {
        update: () => {
        },
        unmount: () => {
          host.removeEventListener("click", onAnchorClick, true);
          for (const node of styleNodes) node.remove();
          for (const node of linkNodes) node.remove();
          for (const node of scriptNodes) node.remove();
        }
      }
    };
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
    if (window.location.hash) {
      try {
        window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
      } catch {
      }
    }
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
function rewriteCellPageRefs(text) {
  let out = text.replace(/resource:([0-9a-f]{64})/g, `${RESOURCE_URL_PREFIX}$1`);
  out = out.replace(
    /((?:src|href|data-src)=)(["'])([0-9a-f]{64})\2/g,
    (_m, attr, q, sig) => `${attr}${q}${RESOURCE_URL_PREFIX}${sig}${q}`
  );
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
