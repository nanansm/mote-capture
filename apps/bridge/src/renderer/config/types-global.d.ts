// Bridge between renderer and the preload-injected `bridgeAPI`.
import type { BridgeAPI } from "../../main/preload";

declare global {
  interface Window {
    bridgeAPI: BridgeAPI;
  }
}

export {};
