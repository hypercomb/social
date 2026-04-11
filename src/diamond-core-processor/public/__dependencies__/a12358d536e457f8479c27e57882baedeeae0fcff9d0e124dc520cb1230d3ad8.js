// @diamondcoreprocessor.com/presentation
// hypercomb-essentials/src/diamondcoreprocessor.com/presentation/screen-service.ts
import { get } from "@hypercomb/core";
var ScreenService = class {
  listeners = /* @__PURE__ */ new Set();
  state = {
    isFullScreen: false,
    windowWidth: 0,
    windowHeight: 0,
    screenWidth: 0,
    screenHeight: 0,
    offsetX: 0,
    offsetY: 0
  };
  constructor() {
    this.sync();
    if (typeof window !== "undefined") {
      window.addEventListener("resize", () => this.sync());
    }
  }
  sync() {
    if (typeof window === "undefined") return;
    const screenstate = get("signature:screenstate");
    this.state = {
      isFullScreen: screenstate.isFullScreen,
      windowWidth: window.innerWidth,
      windowHeight: window.innerHeight,
      screenWidth: screen?.width ?? 0,
      screenHeight: screen?.height ?? 0,
      offsetX: screen ? (screen.width - window.outerWidth) / 2 : 0,
      offsetY: screen ? (screen.height - window.outerHeight) / 2 : 0
    };
    this.emit();
  }
  getSnapshot() {
    return this.state;
  }
  subscribe(fn) {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }
  emit() {
    for (const fn of this.listeners) fn(this.state);
  }
};

// hypercomb-essentials/src/diamondcoreprocessor.com/presentation/screen-state.ts
var ScreenState = class {
  isFullScreen = false;
};
export {
  ScreenService,
  ScreenState
};
