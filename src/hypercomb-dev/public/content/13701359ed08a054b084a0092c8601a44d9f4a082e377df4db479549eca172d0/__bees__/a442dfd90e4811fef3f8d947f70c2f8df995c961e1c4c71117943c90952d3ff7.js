// src/diamondcoreprocessor.com/presentation/pixi-host.drone.ts
import { Worker } from "@hypercomb/core";
import { Application, Container } from "pixi.js";
var PixiHostWorker = class extends Worker {
  namespace = "diamondcoreprocessor.com";
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
  }
  ready = async () => {
    if (this.app) return false;
    const settings = this.resolve("settings");
    const host = document.getElementById("pixi-host");
    return !!settings && !!host;
  };
  act = async () => {
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
      resizeTo: window,
      backgroundAlpha: 0,
      resolution: devicePixelRatio || 1,
      autoDensity: true,
      antialias: true
    });
    app.stage.scale.set(1.8, 1.8);
    host.appendChild(app.canvas);
    this.container = new Container();
    app.stage.addChild(this.container);
    const center = () => {
      const s = app.renderer.screen;
      const cx = s.width * 0.5;
      const cy = s.height * 0.5;
      const vp = window.ioc?.get("@diamondcoreprocessor.com/ViewportPersistence");
      const pan = vp?.lastPan;
      app.stage.position.set(cx + (pan?.dx ?? 0), cy + (pan?.dy ?? 0));
    };
    center();
    window.addEventListener("resize", () => requestAnimationFrame(center));
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
