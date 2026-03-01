import {
  randomUUID,
  createHash,
  generateKeyPairSync,
  sign as cryptoSign,
} from "crypto";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import WebSocket from "ws";
import { env } from "../../../config/env.js";
import { z } from "zod";

import {
  GatewayOfflineError,
  GatewayPairingRequiredError,
} from "../../errors.js";

export { GatewayOfflineError, GatewayPairingRequiredError };

const GATEWAY_CLIENT_ID = "gateway-client";
const GATEWAY_CLIENT_MODE = "backend";
const GATEWAY_ROLE = "operator";
const GATEWAY_SCOPES = [
  "operator.read",
  "operator.admin",
  "operator.approvals",
  "operator.pairing",
];

interface DeviceIdentity {
  version?: number;
  deviceId: string;
  publicKeyRaw: string;
  privateKeyPem: string;
  deviceToken?: string;
}

function base64urlEncode(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

function spkiToRaw(spkiDer: Buffer): Buffer {
  return spkiDer.slice(-32);
}

function loadOrCreateDeviceIdentity(): DeviceIdentity {
  const identityPath = env.GATEWAY_DEVICE_IDENTITY_PATH;
  try {
    const raw = readFileSync(identityPath, "utf8");
    const parsed = JSON.parse(raw) as DeviceIdentity;
    if (
      parsed.deviceId &&
      parsed.publicKeyRaw &&
      parsed.privateKeyPem &&
      (parsed.version ?? 0) >= 2
    ) {
      return parsed;
    }
  } catch {
    // Fall through to regenerate
  }

  console.log("[openclaw] Generating new device identity…");
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const rawKey = spkiToRaw(
    publicKey.export({ type: "spki", format: "der" }) as Buffer,
  );
  const identity: DeviceIdentity = {
    version: 2,
    deviceId: createHash("sha256").update(rawKey).digest("hex"),
    publicKeyRaw: base64urlEncode(rawKey),
    privateKeyPem: privateKey.export({
      type: "pkcs8",
      format: "pem",
    }) as string,
  };
  mkdirSync(dirname(identityPath), { recursive: true });
  writeFileSync(identityPath, JSON.stringify(identity, null, 2), "utf8");
  console.log(
    `[openclaw] Device identity created: ${identity.deviceId} (${identityPath})`,
  );
  return identity;
}

let _identity: DeviceIdentity | null = null;

function getIdentity(): DeviceIdentity {
  if (!_identity) {
    _identity = loadOrCreateDeviceIdentity();
    if (process.env.NODE_ENV !== "test") {
      console.log(`[openclaw] Device identity loaded: ${_identity.deviceId}`);
    }
  }
  return _identity;
}

function saveDeviceToken(token: string): void {
  const identity = getIdentity();
  if (identity.deviceToken === token) return;
  identity.deviceToken = token;
  try {
    writeFileSync(
      env.GATEWAY_DEVICE_IDENTITY_PATH,
      JSON.stringify(identity, null, 2),
      "utf8",
    );
    console.log(
      "[openclaw] Device token saved — subsequent connections will authenticate automatically.",
    );
  } catch (err) {
    console.error("[openclaw] Failed to persist device token:", err);
  }
}

function signConnect(
  nonce: string,
  identity: DeviceIdentity,
  authToken: string | undefined,
): { signature: string; signedAt: number } {
  const signedAt = Date.now();
  const canonical = [
    "v2",
    identity.deviceId,
    GATEWAY_CLIENT_ID,
    GATEWAY_CLIENT_MODE,
    GATEWAY_ROLE,
    GATEWAY_SCOPES.join(","),
    String(signedAt),
    authToken ?? "",
    nonce,
  ].join("|");
  const signatureBuffer = cryptoSign(
    null,
    Buffer.from(canonical, "utf8"),
    identity.privateKeyPem,
  );
  return { signature: base64urlEncode(signatureBuffer), signedAt };
}

export function isConnectionError(err: unknown): boolean {
  if (err instanceof GatewayPairingRequiredError) return false;
  if (!(err instanceof Error)) return false;
  const code = (err as NodeJS.ErrnoException).code ?? "";
  return (
    code === "ECONNREFUSED" ||
    code === "ECONNRESET" ||
    code === "ENOTFOUND" ||
    code === "ETIMEDOUT" ||
    code === "ECONNABORTED" ||
    err.message.includes(
      "WebSocket was closed before the connection was established",
    ) ||
    err.message.includes("Unexpected server response:")
  );
}

const WS_TIMEOUT = env.GATEWAY_WS_TIMEOUT;
const AI_TIMEOUT = env.GATEWAY_AI_TIMEOUT;
const CHALLENGE_WAIT_MS = 5_000;

export const LiveSessionSchema = z
  .object({
    key: z.string().optional(),
    agent: z.string().optional(),
    agentId: z.string().optional(),
    status: z.string().optional(),
  })
  .passthrough();

export type LiveSession = z.infer<typeof LiveSessionSchema>;

export const AgentConfigSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().optional(),
    capabilities: z.array(z.string()).optional(),
    role: z.string().optional(),
    model: z.string().optional(),
    fallback: z.string().optional(),
  })
  .passthrough();

export const GatewayConfigPayloadSchema = z.union([
  z.array(z.unknown()),
  z
    .object({
      hash: z.string().optional(),
      value: z.unknown().optional(),
      config: z.unknown().optional(),
      parsed: z.unknown().optional(),
    })
    .passthrough()
    .nullable(),
]);

export const GatewaySessionsPayloadSchema = z.union([
  z.array(LiveSessionSchema),
  z
    .object({
      sessions: z.array(LiveSessionSchema),
    })
    .passthrough(),
]);

export const GatewayModelsPayloadSchema = z
  .union([
    z.array(z.unknown()),
    z
      .object({
        models: z.array(z.unknown()),
      })
      .passthrough(),
  ])
  .nullable()
  .optional();

class GatewayClient {
  private ws: WebSocket | null = null;
  private connectPromise: Promise<void> | null = null;
  private pendingRequests = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (err: Error) => void;
      timer?: NodeJS.Timeout;
      method: string;
      schema?: z.ZodType<any>;
    }
  >();
  private connected = false;

  private cleanup() {
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
    this.connected = false;
    this.connectPromise = null;
    const err = new Error("Gateway connection closed unexpectedly");
    for (const req of this.pendingRequests.values()) {
      if (req.timer) clearTimeout(req.timer);
      req.reject(err);
    }
    this.pendingRequests.clear();
  }

  connect(): Promise<void> {
    if (this.connectPromise) return this.connectPromise;
    if (this.connected && this.ws?.readyState === WebSocket.OPEN)
      return Promise.resolve();

    this.connectPromise = new Promise((resolve, reject) => {
      const gatewayUrl = env.GATEWAY_URL;
      const origin = gatewayUrl.replace(
        /^ws(s?):\/\/([^/]+).*$/,
        "http$1://$2",
      );
      const identity = getIdentity();

      let ws: WebSocket;
      try {
        ws = new WebSocket(gatewayUrl, { headers: { Origin: origin } });
      } catch (err) {
        this.connectPromise = null;
        reject(err);
        return;
      }

      this.ws = ws;
      let challengeTimer: NodeJS.Timeout | undefined;
      const connectId = randomUUID();
      let settled = false;

      const settleConnect = (err?: Error) => {
        if (settled) return;
        settled = true;
        if (challengeTimer) clearTimeout(challengeTimer);
        this.connectPromise = null;
        if (err) {
          this.cleanup();
          reject(err);
        } else {
          this.connected = true;
          resolve();
        }
      };

      const sendConnect = (nonce: string) => {
        const authToken = identity.deviceToken ?? env.GATEWAY_TOKEN;
        const { signature, signedAt } = signConnect(nonce, identity, authToken);

        const connectParams: Record<string, unknown> = {
          minProtocol: 3,
          maxProtocol: 3,
          role: GATEWAY_ROLE,
          scopes: GATEWAY_SCOPES,
          client: {
            id: GATEWAY_CLIENT_ID,
            mode: GATEWAY_CLIENT_MODE,
            version: "1.0.0",
            platform: "node",
          },
          caps: [],
          commands: [],
          permissions: {},
          locale: "en-US",
          userAgent: "claw-pilot/1.0.0",
          device: {
            id: identity.deviceId,
            publicKey: identity.publicKeyRaw,
            signature,
            signedAt,
            nonce,
          },
        };

        if (authToken) {
          connectParams.auth = { token: authToken };
        }

        ws.send(
          JSON.stringify({
            type: "req",
            id: connectId,
            method: "connect",
            params: connectParams,
          }),
        );
      };

      ws.on("error", (err) => {
        if (!settled) settleConnect(err);
        else this.cleanup();
      });

      ws.on("open", () => {
        challengeTimer = setTimeout(() => {
          if (!this.connected && !settled) {
            settleConnect(
              new Error(
                `Gateway did not send connect.challenge within ${CHALLENGE_WAIT_MS}ms`,
              ),
            );
          }
        }, CHALLENGE_WAIT_MS);
      });

      ws.on("close", (code, reasonBuf) => {
        const reason = reasonBuf.toString("utf8");
        if (!settled) {
          if (code === 1008 || /pairing/i.test(reason)) {
            settleConnect(new GatewayPairingRequiredError(identity.deviceId));
          } else {
            settleConnect(
              new Error(
                `Gateway connection closed (${code}): ${reason || "no reason"}`,
              ),
            );
          }
        } else {
          this.cleanup();
        }
      });

      ws.on("message", (raw) => {
        let frame: Record<string, unknown>;
        try {
          frame = JSON.parse(String(raw));
        } catch {
          return;
        }

        if (!this.connected) {
          if (frame.type === "event" && frame.event === "connect.challenge") {
            if (challengeTimer) clearTimeout(challengeTimer);
            const challengePayload = frame.payload as
              | Record<string, unknown>
              | undefined;
            const nonce = String(challengePayload?.nonce ?? randomUUID());
            sendConnect(nonce);
            return;
          }

          if (frame.type === "res" && frame.id === connectId) {
            if (frame.ok === false) {
              const msg =
                (frame.error as Record<string, unknown> | undefined)?.message ??
                "unknown";
              settleConnect(new Error(`Gateway connect failed: ${msg}`));
              return;
            }

            try {
              const authPayload = (
                frame.payload as Record<string, unknown> | undefined
              )?.auth as Record<string, unknown> | undefined;
              const freshToken = authPayload?.deviceToken as string | undefined;
              if (freshToken) saveDeviceToken(freshToken);
            } catch {
              /* ignored */
            }

            settleConnect();
            return;
          }
          return;
        }

        if (frame.type === "res" && typeof frame.id === "string") {
          const req = this.pendingRequests.get(frame.id);
          if (req) {
            this.pendingRequests.delete(frame.id);
            if (req.timer) clearTimeout(req.timer);
            if (
              frame.ok === false ||
              Object.prototype.hasOwnProperty.call(frame, "error")
            ) {
              const msg =
                (frame.error as Record<string, unknown> | undefined)?.message ??
                "unknown";
              req.reject(
                new Error(`Gateway RPC '${req.method}' failed: ${msg}`),
              );
            } else {
              if (req.schema) {
                try {
                  const parsed = req.schema.parse(frame.payload);
                  req.resolve(parsed);
                } catch (err) {
                  req.reject(
                    new Error(
                      `Gateway response validation failed for '${req.method}': ${(err as Error).message}`,
                    ),
                  );
                }
              } else {
                req.resolve(frame.payload);
              }
            }
          }
        }
      });
    });

    return this.connectPromise;
  }

  async request<T = unknown>(
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number,
    schema?: z.ZodType<T>,
  ): Promise<T> {
    await this.connect();

    return new Promise((resolve, reject) => {
      const requestId = randomUUID();
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(
          new Error(`Gateway call '${method}' timed out after ${timeoutMs}ms`),
        );
      }, timeoutMs);

      this.pendingRequests.set(requestId, {
        resolve: resolve as (v: unknown) => void,
        reject,
        timer,
        method,
        schema,
      });
      this.ws!.send(
        JSON.stringify({ type: "req", id: requestId, method, params }),
      );
    });
  }

  _reset() {
    this.cleanup();
  }
}

const sharedClient = new GatewayClient();

export async function gatewayCall<T = unknown>(
  method: string,
  params: Record<string, unknown>,
  {
    timeout = WS_TIMEOUT,
    schema,
  }: { timeout?: number; schema?: z.ZodType<T> } = {},
): Promise<T> {
  return sharedClient.request<T>(method, params, timeout, schema);
}

export function __resetGatewayClientForTest() {
  sharedClient._reset();
}

export function extractValue(payload: any): any {
  if (!payload) return null;
  if (Array.isArray(payload)) return payload;
  if (typeof payload !== "object") return payload;

  const v = payload.value ?? payload.config ?? payload.parsed;
  if (v !== undefined) return v;

  return payload;
}

export function parseOpenclawConfig(
  parsed: unknown,
): import("@claw-pilot/shared-types").Agent[] {
  let raw: unknown[] = [];

  if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>;
    const section =
      obj.agents && typeof obj.agents === "object" && !Array.isArray(obj.agents)
        ? (obj.agents as Record<string, unknown>)
        : obj;

    if (Array.isArray(section.list)) {
      raw.push(...section.list);
    } else if (Array.isArray(obj.agents)) {
      raw.push(...obj.agents);
    }

    const reserved = ["list", "hash", "agents"];
    for (const [key, val] of Object.entries(section)) {
      if (reserved.includes(key)) continue;
      if (val && typeof val === "object" && !Array.isArray(val)) {
        raw.push({ id: key, ...(val as object) });
      }
    }
  } else if (Array.isArray(parsed)) {
    raw = parsed;
  }

  return raw.map((a: unknown) => {
    const agent = a as Record<string, unknown>;

    const tools = agent.tools as Record<string, unknown> | undefined;
    const capabilities = Array.isArray(tools?.allow)
      ? (tools!.allow as string[])
      : Array.isArray(agent.capabilities)
        ? (agent.capabilities as string[])
        : [];

    return {
      id: String(agent.id ?? agent.name ?? "unknown-agent"),
      name: String(agent.name ?? agent.id ?? "Unknown Agent"),
      status: "OFFLINE" as const,
      capabilities,
      role: typeof agent.role === "string" ? agent.role : undefined,
      model: typeof agent.model === "string" ? agent.model : undefined,
      fallback: typeof agent.fallback === "string" ? agent.fallback : undefined,
      workspace:
        typeof agent.workspace === "string" ? agent.workspace : undefined,
    };
  });
}
