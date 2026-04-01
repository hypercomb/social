// src/diamondcoreprocessor.com/meeting/meeting-controls.worker.ts
import { Worker } from "@hypercomb/core";
var JOIN_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="96" height="96"><circle fill="none" stroke="white" stroke-width="6" cx="48" cy="48" r="30"/><path fill="white" d="M38 36v24l22-12z"/></svg>`;
var CAMERA_ON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="96" height="96"><rect fill="white" x="14" y="28" width="44" height="40" rx="6"/><path fill="white" d="M62 42l20-10v32l-20-10z"/></svg>`;
var CAMERA_OFF_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="96" height="96"><rect fill="white" x="14" y="28" width="44" height="40" rx="6" opacity="0.4"/><path fill="white" d="M62 42l20-10v32l-20-10z" opacity="0.4"/><rect fill="white" x="46" y="16" width="4" height="64" rx="2" transform="rotate(-45 48 48)"/></svg>`;
var ICON_Y = -12;
var MeetingControlsWorker = class extends Worker {
  namespace = "diamondcoreprocessor.com";
  genotype = "meeting";
  description = "Registers join/camera overlay buttons for hive meetings.";
  effects = ["network"];
  listens = ["render:host-ready", "tile:action", "meeting:state", "meeting:local-camera"];
  emits = ["overlay:register-action", "overlay:unregister-action", "meeting:toggle-available", "meeting:toggle-camera"];
  #meetingState = "idle";
  #cameraOn = false;
  #registered = false;
  ready = () => true;
  act = async () => {
    this.onEffect("render:host-ready", () => {
      this.#registerActions();
    });
    this.onEffect("meeting:state", ({ state }) => {
      const prev = this.#meetingState;
      this.#meetingState = state;
      if (prev !== state) this.#registerActions();
    });
    this.onEffect("meeting:local-camera", ({ on }) => {
      const prev = this.#cameraOn;
      this.#cameraOn = on;
      if (prev !== on) this.#registerActions();
    });
    this.onEffect("tile:action", (payload) => {
      switch (payload.action) {
        case "meeting-join":
          this.emitEffect("meeting:toggle-available", {});
          break;
        case "meeting-camera":
          this.emitEffect("meeting:toggle-camera", {});
          break;
      }
    });
  };
  #registerActions = () => {
    if (this.#registered) {
      this.emitEffect("overlay:unregister-action", { name: "meeting-join" });
      this.emitEffect("overlay:unregister-action", { name: "meeting-camera" });
    }
    this.#registered = true;
    const state = this.#meetingState;
    const cameraOn = this.#cameraOn;
    const actions = [];
    const available = state !== "idle";
    if (!available) {
      actions.push({
        name: "meeting-join",
        owner: this.iocKey,
        svgMarkup: JOIN_ICON_SVG,
        x: -14,
        y: ICON_Y,
        hoverTint: 11075544,
        profile: "public-own",
        visibleWhen: () => !available
      });
    }
    if (available) {
      actions.push({
        name: "meeting-camera",
        owner: this.iocKey,
        svgMarkup: cameraOn ? CAMERA_ON_SVG : CAMERA_OFF_SVG,
        x: -14,
        y: ICON_Y,
        hoverTint: cameraOn ? 16763080 : 11075544,
        profile: "public-own",
        visibleWhen: () => available
      });
    }
    if (actions.length > 0) {
      this.emitEffect("overlay:register-action", actions);
    }
  };
};
var _meetingControls = new MeetingControlsWorker();
window.ioc.register("@diamondcoreprocessor.com/MeetingControlsWorker", _meetingControls);
export {
  MeetingControlsWorker
};
