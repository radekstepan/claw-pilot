import { env } from "../config/env.js";
import type { GatewayBackend } from "./types.js";
import { OpenClawBackend } from "./backends/openclaw/api.js";

let _gateway: GatewayBackend | null = null;

export function getGateway(): GatewayBackend {
  if (_gateway) return _gateway;

  switch (env.BACKEND_TYPE) {
    case "openclaw":
      _gateway = new OpenClawBackend();
      return _gateway;
    case "nanoclaw":
      throw new Error("NanoClaw backend not yet implemented");
    default:
      throw new Error(`Unknown BACKEND_TYPE: ${env.BACKEND_TYPE}`);
  }
}

export function __resetGatewayForTest(): void {
  _gateway = null;
}
