import { z } from "zod";
import { resolve } from "path";

const LOOPBACK_HOSTS = ["127.0.0.1", "localhost", "::1", "0.0.0.0"] as const;

const EnvSchema = z
  .object({
    /** Required — app refuses to start without a non-empty API key. */
    API_KEY: z
      .string()
      .min(1, "API_KEY must be set to a non-empty secret value"),

    /** TCP port for the HTTP server. Defaults to 54321. */
    PORT: z.coerce.number().int().positive().default(54321),

    /**
     * Interface to bind to. Must be a loopback address so the server is never
     * exposed on a public network interface.
     */
    HOST: z
      .string()
      .default("127.0.0.1")
      .refine(
        (h) => LOOPBACK_HOSTS.includes(h as (typeof LOOPBACK_HOSTS)[number]),
        {
          message: `HOST must be a loopback interface (${LOOPBACK_HOSTS.slice(0, 3).join(", ")}) or 0.0.0.0 for Docker containers`,
        },
      ),

    /**
     * Exact URL of the frontend that is allowed to make cross-origin requests.
     * Wildcard "*" is explicitly rejected.
     */
    ALLOWED_ORIGIN: z
      .string()
      .default("http://localhost:5173")
      .refine((o) => o.trim() !== "*", {
        message:
          'ALLOWED_ORIGIN cannot be the wildcard "*" — use the exact frontend URL',
      }),

    /** Controls error-message verbosity in the global error handler. */
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),

    /**
     * WebSocket URL of the OpenClaw gateway.
     * Example: ws://localhost:18789  or  wss://myhost:18789
     */
    OPENCLAW_GATEWAY_URL: z.string().url().default("ws://localhost:18789"),

    /**
     * Optional bearer token passed as `?token=…` on every gateway connection.
     * Leave unset when the gateway is configured without authentication.
     */
    OPENCLAW_GATEWAY_TOKEN: z.string().optional(),

    /**
     * Logical identifier for this gateway instance.
     * Used to construct the main-agent session key: mc-gateway:{id}:main
     */
    OPENCLAW_GATEWAY_ID: z.string().min(1).default("gateway"),

    /** Timeout (ms) for fast/informational gateway RPC calls (sessions list, health, etc.). */
    OPENCLAW_WS_TIMEOUT: z.coerce.number().int().positive().default(15_000),

    /** Timeout (ms) for heavy AI gateway calls (chat routing, session spawn, agent generation). */
    OPENCLAW_AI_TIMEOUT: z.coerce.number().int().positive().default(120_000),

    /**
     * Path to the device identity file (Ed25519 key pair + deviceToken).
     * Defaults to `data/device-identity.json` relative to the process working directory.
     * Override this in Docker / VPS deployments to point at a persistent volume.
     */
    OPENCLAW_DEVICE_IDENTITY_PATH: z
      .string()
      .default(resolve("data/device-identity.json")),

    /**
     * Publicly reachable base URL of this Claw-Pilot backend.
     * Used to build the callback URL that is embedded in every agent prompt so remote
     * agents know where to POST their progress/completion updates.
     * Example: http://100.78.90.125:54321  (Tailscale IP)
     *          http://claw-pilot:54321      (Docker service name)
     * Defaults to http://localhost:{PORT} — only correct when the agent runs on the same machine.
     */
    PUBLIC_URL: z.string().url().optional(),

    /**
     * Maximum number of AI gateway calls (routeChatToAgent, spawnTaskSession, generateAgentConfig)
     * that may execute concurrently. Additional jobs are queued (FIFO with priority support)
     * and executed as slots become available.
     *
     * Lower values protect resource-constrained hosts (local LLMs, low-RAM VPS).
     * Higher values increase throughput when the gateway / model can sustain the load.
     *
     * Recommended values:
     *   1 — fully serial, safest for local LLM execution
     *   3 — balanced default, good for most setups        (default)
     *   5 — higher throughput for capable hosts
     */
    AI_QUEUE_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(3),

    /**
     * Default workspace base path offered to users when creating a new agent.
     * The UI pre-fills the "Workspace Path" field with this value.
     * Typically the directory where the OpenClaw gateway stores agent workspaces.
     */
    OPENCLAW_DEFAULT_WORKSPACE: z.string().default("~/.openclaw/workspace"),
  })
  .superRefine((data, ctx) => {
    if (data.HOST === "0.0.0.0") {
      if (!data.PUBLIC_URL) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "PUBLIC_URL is required when HOST=0.0.0.0. Remote agents need a publicly reachable URL for callbacks. " +
            "Set PUBLIC_URL to your external URL (e.g., http://myhost:54321 or http://100.78.90.125:54321).",
          path: ["PUBLIC_URL"],
        });
        return;
      }

      const url = new URL(data.PUBLIC_URL);
      const hostname = url.hostname.toLowerCase();
      if (hostname === "localhost" || hostname === "127.0.0.1") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `PUBLIC_URL cannot use localhost/127.0.0.1 when HOST=0.0.0.0. Got: ${data.PUBLIC_URL}. Set PUBLIC_URL to your external IP or hostname.`,
          path: ["PUBLIC_URL"],
        });
      }
    }
  });

export type Env = z.infer<typeof EnvSchema>;

/**
 * Parses and validates process.env against the schema.
 * Throws a descriptive Error (crashing the process) if any required variable is
 * missing or any constraint is violated — the T3 Env pattern for fail-fast boot.
 */
function parseEnv(): Env {
  const result = EnvSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  • ${i.path.join(".") || "<root>"}: ${i.message}`)
      .join("\n");
    throw new Error(
      `\n[claw-pilot] ❌ Invalid environment configuration:\n\n${issues}\n\n` +
        `Fix the above issues in the root .env file and restart.\n`,
    );
  }
  return result.data;
}

export const env: Env = parseEnv();
