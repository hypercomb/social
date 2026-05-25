// src/diamondcoreprocessor.com/presentation/tiles/site-view.drone.ts
import { Drone, SITE_VIEW_IOC_KEY, RESOURCE_URL_PREFIX } from "@hypercomb/core";
var SiteViewDrone = class extends Drone {
  namespace = "diamondcoreprocessor.com";
  genotype = "presentation";
  description = "Full-viewport site takeover. Mounts each cell's `context` HTML resource as the active page; lineage navigation drives page changes.";
  #mount = null;
  #viewActive = false;
  #registered = false;
  #lineageBound = false;
  #viewModeBound = false;
  #globalContextMenuBound = false;
  /**
   * Lineage of the cell where the current website session started —
   * captured the moment ViewMode flipped from hexagons → website (or
   * on boot if VM was already 'website'). Acts as the navigation
   * floor: right-click (and anchor `..`) inside the site can walk
   * up freely until segments shrink down to this length, then the
   * next "go up" exits the site instead of crossing into the parent
   * hexagon hierarchy. Null while not in a website session.
   */
  #siteEntrySegments = null;
  deps = {
    lineage: "@hypercomb.social/Lineage",
    store: "@hypercomb.social/Store"
  };
  listens = [];
  emits = ["view:active"];
  heartbeat = async () => {
    if (!this.#registered) {
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
    if (this.#siteEntrySegments === null) {
      const vm = window.ioc?.get("@hypercomb.social/ViewMode");
      if (vm?.mode === "website") this.#captureSiteEntry();
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
    const vm = window.ioc?.get("@hypercomb.social/ViewMode");
    if (vm?.mode === "website") {
      if (this.#siteEntrySegments === null) this.#captureSiteEntry();
    } else {
      this.#siteEntrySegments = null;
    }
    void this.#reconcile();
  };
  #captureSiteEntry() {
    const lineage = this.resolve("lineage");
    this.#siteEntrySegments = [...lineage?.explorerSegments?.() ?? []];
  }
  /** Window-level contextmenu handler. Active only in website mode —
   *  right-click as a universal "back to the site" gesture. The
   *  capture-phase listener fires before downstream consumers so the
   *  browser's default context menu never appears in this mode.
   *
   *  The "site root" is the cell where this website session began
   *  (`#siteEntrySegments`), not the hypercomb lineage root. Three
   *  cases, keyed on the relationship between current segments and
   *  the site entry:
   *
   *   • Inside the site (descendant of entry) → walk up one level.
   *   • At the site root (segments equal entry) → no-op. We stay
   *     rather than walking up into `/`, which usually has no
   *     content. The way out is the `/website` toggle, not right-
   *     click.
   *   • Outside the site (sibling or unrelated cell, e.g. an
   *     `<a href="/dashboard">` link navigated to a route not under
   *     the site root) → jump back to the entry. Without this the
   *     user gets stranded on a blank route with no page mounted.
   *
   *  We do NOT exit website mode in any case: the gesture is a
   *  back-to-the-site, not a back-to-hexagons. */
  #onGlobalContextMenu = (e) => {
    const vm = window.ioc?.get("@hypercomb.social/ViewMode");
    if (!vm || vm.mode !== "website") return;
    e.preventDefault();
    const lineage = this.resolve("lineage");
    const segments = [...lineage?.explorerSegments?.() ?? []];
    const entry = this.#siteEntrySegments ?? [];
    const insideSite = segments.length >= entry.length && entry.every((seg, i) => segments[i] === seg);
    if (insideSite) {
      if (segments.length <= entry.length) return;
      this.#navigate(segments.slice(0, -1));
      return;
    }
    this.#navigate(entry);
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
    let cellPageSig = await this.#findDecorationPage(segments, store);
    if (!cellPageSig) {
      cellPageSig = await this.#findContextPage(segments, store);
    }
    if (cellPageSig) {
      await this.#mountCellPage(segments, cellPageSig, store);
      return;
    }
    this.#teardown();
  }
  /** Decoration-based page lookup (the visual-bee migration target).
   *  Reads the cell's `decorations` slot, loads each sig from
   *  `__resources__`, filters by the website bee's declared
   *  `decorationKind` (looked up via VisualBeeRegistry), and returns the
   *  first match's `payload.htmlSig` — the HTML resource the renderer
   *  ultimately mounts.
   *
   *  Decoration JSONs live in `__resources__` (the shared content store)
   *  so peer-supplied decorations come through the same fetch pipeline
   *  as any other resource — adopter sees peer's `decorations` slot
   *  sigs in the merkle tree, and resolving them through getResource
   *  works whether the content is local or pulled from a relay.
   *
   *  Returns null if VisualBeeRegistry is unavailable, the website bee
   *  isn't registered yet, the cell has no `decorations` slot, or no
   *  entries match the kind. The caller then falls back to the legacy
   *  `context` slot for cells whose pages haven't been migrated. */
  async #findDecorationPage(segments, store) {
    if (!store.getResource) return null;
    const ioc = window.ioc;
    if (!ioc) return null;
    const registry = ioc.get("@diamondcoreprocessor.com/VisualBeeRegistry");
    const bee = registry?.get("website");
    if (!bee?.decorationKind) return null;
    const history = ioc.get("@diamondcoreprocessor.com/HistoryService");
    if (!history) return null;
    try {
      const locationSig = await history.sign({ explorerSegments: () => segments });
      const layer = await history.currentLayerAt(locationSig);
      if (!layer) return null;
      const decorations = layer.decorations;
      const sigs = Array.isArray(decorations) ? decorations.map((s) => String(s)).filter((s) => /^[0-9a-f]{64}$/.test(s)) : [];
      for (const decorationSig of sigs) {
        const blob = await store.getResource(decorationSig);
        if (!blob) continue;
        try {
          const record = JSON.parse(await blob.text());
          if (record?.kind !== bee.decorationKind) continue;
          const htmlSig = record?.payload?.htmlSig;
          if (typeof htmlSig === "string" && /^[0-9a-f]{64}$/.test(htmlSig)) {
            return htmlSig;
          }
        } catch {
        }
      }
    } catch {
    }
    return null;
  }
  /** Legacy per-cell page lookup. Reads the cell's layer at `segments`,
   *  scans its `context` slot for the first HTML-shaped resource,
   *  returns that sig. Probes the resource head to detect HTML rather
   *  than trusting position — a cell's bag is heterogeneous (prior
   *  impls, chrome refs, examples) and the renderer should pick the
   *  page kind by content, not by index.
   *
   *  Used as fallback when `#findDecorationPage` returns null — i.e. for
   *  cells whose pages were written before the visual-bee migration. */
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
    if (this.#mount && this.#mount.pageSig === pageSig) {
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
        const entry = this.#siteEntrySegments ?? [];
        if (segments.length <= entry.length) return;
        this.#navigate(segments.slice(0, -1));
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
      pageSig,
      sitePath: [...segments],
      unmount: () => {
        host.removeEventListener("click", onAnchorClick, true);
        for (const node of styleNodes) node.remove();
        for (const node of linkNodes) node.remove();
        for (const node of scriptNodes) node.remove();
      }
    };
  }
  #teardown() {
    if (this.#mount) {
      try {
        this.#mount.unmount();
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
function rewriteCellPageRefs(text) {
  let out = text.replace(/resource:([0-9a-f]{64})/g, `${RESOURCE_URL_PREFIX}$1`);
  out = out.replace(
    /((?:src|href|data-src)=)(["'])([0-9a-f]{64})\2/g,
    (_m, attr, q, sig) => `${attr}${q}${RESOURCE_URL_PREFIX}${sig}${q}`
  );
  return out;
}
var _siteView = new SiteViewDrone();
window.ioc.register("@diamondcoreprocessor.com/SiteViewDrone", _siteView);
export {
  SiteViewDrone
};
