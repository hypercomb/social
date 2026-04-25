// src/diamondcoreprocessor.com/presentation/tiles/pixi-host.worker.ts
import { Worker } from "@hypercomb/core";
import { Application, Container } from "pixi.js";
var PixiHostWorker = class extends Worker {
  namespace = "diamondcoreprocessor.com";
  description = "Initializes the Pixi.js application, canvas, and root container for all rendering drones.";
  effects = ["render"];
  app = null;
  host = null;
  // stable render root for all drones (this is what ZoomDrone scales/translates)
  container;
  deps = { settings: "@diamondcoreprocessor.com/Settings", axial: "@diamondcoreprocessor.com/AxialService" };
  listens = ["editor:mode"];
  emits = ["render:host-ready"];
  constructor() {
    super();
    this.onEffect("editor:mode", ({ active }) => {
      if (!this.host) return;
      this.host.style.visibility = active ? "hidden" : "visible";
    });
    this.onEffect("view:active", ({ active }) => {
      if (!this.host) return;
      this.host.style.visibility = active ? "hidden" : "visible";
    });
  }
  ready = async () => {
    if (this.app) return false;
    if (document.querySelector('[data-hypercomb-pixi="root"] canvas')) return false;
    const settings = this.resolve("settings");
    const host = document.getElementById("pixi-host");
    return !!settings && !!host;
  };
  act = async () => {
    if (document.querySelector('[data-hypercomb-pixi="root"] canvas')) return;
    const settings = this.resolve("settings");
    if (!settings) return;
    const axial = this.resolve("axial");
    if (axial?.initialize) axial.initialize(settings);
    const host = this.host = document.getElementById("pixi-host");
    if (!host) return;
    host.dataset["hypercombPixi"] = "root";
    host.style.position = "fixed";
    host.style.inset = "0";
    host.style.zIndex = "59989";
    host.style.pointerEvents = "none";
    document.body.appendChild(host);
    const app = this.app = new Application();
    await app.init({
      // Size to the host element, not the window, so anything that
      // narrows the host (the history sidebar taking a column on the
      // left via its injected CSS) also narrows the canvas. Without
      // this, resizeTo: window would keep the canvas at full viewport
      // width and the sidebar ended up painted on top of live tile
      // pixels, with hit-testing still firing through the overlay.
      resizeTo: host,
      backgroundAlpha: 0,
      resolution: devicePixelRatio || 1,
      autoDensity: true,
      antialias: true
    });
    app.stage.scale.set(1.8, 1.8);
    app.stage.interactiveChildren = false;
    host.appendChild(app.canvas);
    if ("ResizeObserver" in globalThis) {
      const ro = new ResizeObserver(() => {
        try {
          app.resize();
        } catch {
        }
      });
      ro.observe(host);
    }
    app.canvas.style.pointerEvents = "auto";
    app.canvas.style.touchAction = "none";
    this.container = new Container();
    app.stage.addChild(this.container);
    let fullscreenTransition = false;
    const applyCenter = () => {
      const screenSize = app.renderer.screen;
      const cx = Math.round(screenSize.width * 0.5);
      const cy = Math.round(screenSize.height * 0.5);
      const vp = window.ioc?.get("@diamondcoreprocessor.com/ViewportPersistence");
      const pan = vp?.lastPan;
      app.stage.position.set(cx + (pan?.dx ?? 0), cy + (pan?.dy ?? 0));
    };
    const center = () => {
      if (fullscreenTransition) return;
      requestAnimationFrame(() => {
        if (fullscreenTransition) return;
        requestAnimationFrame(() => {
          if (fullscreenTransition) return;
          applyCenter();
        });
      });
    };
    center();
    window.addEventListener("resize", center);
    window.addEventListener("orientationchange", center);
    if (screen.orientation && typeof screen.orientation.addEventListener === "function") {
      screen.orientation.addEventListener("change", center);
    }
    document.addEventListener("fullscreenchange", () => {
      fullscreenTransition = true;
      const stageX = app.stage.position.x;
      const stageY = app.stage.position.y;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const newCx = Math.round(app.renderer.screen.width * 0.5);
          const newCy = Math.round(app.renderer.screen.height * 0.5);
          const vp = window.ioc?.get("@diamondcoreprocessor.com/ViewportPersistence");
          if (vp) {
            vp.setPan(stageX - newCx, stageY - newCy);
          }
          fullscreenTransition = false;
        });
      });
    });
    this.emitEffect("render:host-ready", {
      app: this.app,
      container: this.container,
      canvas: this.app.canvas,
      renderer: this.app.renderer
    });
  };
};
var _pixiHost = new PixiHostWorker();
window.ioc.register("@diamondcoreprocessor.com/PixiHostWorker", _pixiHost);
export {
  PixiHostWorker
};
