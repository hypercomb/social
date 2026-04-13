// src/diamondcoreprocessor.com/commands/toast.drone.ts
import { EffectBus } from "@hypercomb/core";
var DEFAULT_DURATIONS = {
  info: 5e3,
  success: 4e3,
  tip: 8e3,
  warning: 6e3
};
var MAX_VISIBLE = 5;
var ToastDrone = class extends EventTarget {
  #toasts = [];
  #nextId = 0;
  #timers = /* @__PURE__ */ new Map();
  get toasts() {
    return this.#toasts;
  }
  constructor() {
    super();
    EffectBus.on("toast:show", (request) => {
      if (!request?.message) return;
      this.#show(request);
    });
    EffectBus.on("toast:dismiss", (payload) => {
      if (payload?.id != null) this.dismiss(payload.id);
    });
    EffectBus.on("toast:clear", () => this.#clearAll());
  }
  #show(request) {
    const id = this.#nextId++;
    const duration = request.duration ?? DEFAULT_DURATIONS[request.type] ?? 5e3;
    const toast = {
      id,
      type: request.type,
      title: request.title ?? "",
      message: request.message,
      duration,
      actionLabel: request.actionLabel ?? null,
      actionEffect: request.actionEffect ?? null,
      actionPayload: request.actionPayload ?? null,
      fading: false,
      createdAt: Date.now()
    };
    this.#toasts = [toast, ...this.#toasts].slice(0, MAX_VISIBLE);
    this.#emit();
    if (duration > 0) {
      const timer = setTimeout(() => this.dismiss(id), duration);
      this.#timers.set(id, timer);
    }
  }
  dismiss(id) {
    const toast = this.#toasts.find((t) => t.id === id);
    if (!toast || toast.fading) return;
    const timer = this.#timers.get(id);
    if (timer != null) {
      clearTimeout(timer);
      this.#timers.delete(id);
    }
    toast.fading = true;
    this.#toasts = [...this.#toasts];
    this.#emit();
    setTimeout(() => {
      this.#toasts = this.#toasts.filter((t) => t.id !== id);
      this.#emit();
    }, 280);
  }
  executeAction(id) {
    const toast = this.#toasts.find((t) => t.id === id);
    if (!toast?.actionEffect) return;
    EffectBus.emit(toast.actionEffect, toast.actionPayload);
    this.dismiss(id);
  }
  #clearAll() {
    for (const timer of this.#timers.values()) clearTimeout(timer);
    this.#timers.clear();
    this.#toasts = [];
    this.#emit();
  }
  #emit() {
    this.dispatchEvent(new Event("change"));
    EffectBus.emit("toast:state", { toasts: this.#toasts });
  }
};
var _toast = new ToastDrone();
window.ioc.register("@diamondcoreprocessor.com/ToastDrone", _toast);
export {
  ToastDrone
};
