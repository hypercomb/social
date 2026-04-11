// @diamondcoreprocessor.com/preferences
// hypercomb-essentials/src/diamondcoreprocessor.com/preferences/settings.ts
import { isMac as _isMac } from "@hypercomb/core";
var Settings = class {
  hexagonSide = 200;
  // point-top dimensions (default)
  get height() {
    return this.hexagonSide * 2;
  }
  get width() {
    return this.hexagonSide * Math.sqrt(3);
  }
  get hexagonOffsetX() {
    return this.width / 2;
  }
  get hexagonOffsetY() {
    return this.height / 2;
  }
  // orientation-aware dimensions
  hexWidth(orientation) {
    return orientation === "flat-top" ? this.hexagonSide * 2 : this.hexagonSide * Math.sqrt(3);
  }
  hexHeight(orientation) {
    return orientation === "flat-top" ? this.hexagonSide * Math.sqrt(3) : this.hexagonSide * 2;
  }
  // editor canvas is always a square that fits both orientations
  get editorSize() {
    return this.hexagonSide * 2;
  }
  // expose dimensions as a readonly object (no mutation from outside)
  get hexagonDimensions() {
    return this;
  }
  // platform-specific
  isMac = _isMac;
  // rendering / interaction settings
  bitDepth = 0.8;
  panThreshold = 25;
  rings = 50;
  fillColor = "#242a30";
};
window.ioc.register("@diamondcoreprocessor.com/Settings", new Settings());

// hypercomb-essentials/src/diamondcoreprocessor.com/preferences/zoom-settings.ts
var ZoomSettings = () => ({
  minScale: 0.2,
  maxScale: 8,
  defaultScale: 1,
  pinchJitterPx: 4,
  pinchForceTakeover: true
});
window.ioc.register("@diamondcoreprocessor.com/ZoomSettings", ZoomSettings());
export {
  Settings,
  ZoomSettings
};
