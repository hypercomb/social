// hypercomb-essentials/src/diamondcoreprocessor.com/preferences/settings.drone.ts
import { Drone } from "@hypercomb/core";
var SettingsDrone = class extends Drone {
  namespace = "diamondcoreprocessor.com";
  description = "Registers user-configurable settings into IoC for other drones to resolve.";
  heartbeat = async () => {
  };
};
export {
  SettingsDrone
};
