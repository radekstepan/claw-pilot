import { randomUUID, createHash, generateKeyPairSync, sign as cryptoSign } from 'crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import WebSocket from 'ws';
import { Agent } from '@claw-pilot/shared-types';
import { env } from '../config/env.js';

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

/**
 * Thrown by higher-level gateway helpers (getAgents, getLiveSessions, etc.)
 * when the underlying TCP/WebSocket connection to the gateway is refused or
 * otherwise unreachable.  Callers can instanceof-check this to distinguish
 * a configuration/network problem from an unexpected runtime error.
 */
export class GatewayOfflineError extends Error {
    override readonly name = 'GatewayOfflineError';
    constructor(method: string, cause: Error) {
        super(`OpenClaw gateway unreachable (${method}): ${cause.message}`);
        this.cause = cause;
    }
}

/**
 * Thrown when the gateway closes the connection with code 1008 (pairing required).
 * This means the device identity has been presented to the gateway but has not yet
 * been approved. The user must run `openclaw devices approve --latest` on the gateway
 * machine, then all subsequent calls will succeed automatically.
 */
export class GatewayPairingRequiredError extends Error {
    override readonly name = 'GatewayPairingRequiredError';
    /** The stable device ID that was presented to the gateway — use this to identify the pending request. */
    readonly deviceId: string;
    constructor(deviceId: string) {
        super(`Gateway pairing required for device ${deviceId}. Run: openclaw devices approve --latest`);
        this.deviceId = deviceId;
    }
}

// ---------------------------------------------------------------------------
// Device identity
// ---------------------------------------------------------------------------

/** Gateway client constants — must match the values in the OpenClaw gateway schema. */
const GATEWAY_CLIENT_ID = 'gateway-client';
const GATEWAY_CLIENT_MODE = 'backend';
const GATEWAY_ROLE = 'operator';
/** Scopes used in both the connect params and the canonical signature payload. Order is significant. */
const GATEWAY_SCOPES = ['operator.read', 'operator.admin', 'operator.approvals', 'operator.pairing'];

interface DeviceIdentity {
    /** Format version. 2 = raw-key format (SHA-256 derived deviceId, base64url raw publicKey). */
    version?: number;
    /** SHA-256 hex of the raw 32-byte Ed25519 public key. */
    deviceId: string;
    /** Raw 32-byte Ed25519 public key encoded as base64url (no padding). */
    publicKeyRaw: string;
    privateKeyPem: string;
    /** DeviceToken returned by the gateway after first-time approval. Replaces the gateway bearer token on future connects. */
    deviceToken?: string;
}

/** base64url encode without padding (matches Python's `_base64url_encode`). */
function base64urlEncode(buf: Buffer): string {
    return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Extracts the raw 32-byte Ed25519 public key from an SPKI DER export.
 * SPKI DER for Ed25519 is always a 12-byte ASN.1 header followed by 32 bytes of raw key.
 */
function spkiToRaw(spkiDer: Buffer): Buffer {
    return spkiDer.slice(-32);
}

/**
 * Loads the device identity from disk, or generates a new Ed25519 key pair
 * and writes it out. The identity file persists the deviceId (stable UUID) and
 * the long-lived Ed25519 key pair so that the same identity is presented on
 * every reconnect — required for the gateway's one-time pairing flow.
 */
function loadOrCreateDeviceIdentity(): DeviceIdentity {
    const identityPath = env.OPENCLAW_DEVICE_IDENTITY_PATH;
    try {
        const raw = readFileSync(identityPath, 'utf8');
        const parsed = JSON.parse(raw) as DeviceIdentity;
        if (parsed.deviceId && parsed.publicKeyRaw && parsed.privateKeyPem && (parsed.version ?? 0) >= 2) {
            return parsed;
        }
        // Old format (UUID deviceId or SPKI publicKeyBase64) — fall through to regenerate
    } catch {
        // File doesn't exist or is corrupt — generate a fresh identity below
    }

    console.log('[openclaw] Generating new device identity…');
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const rawKey = spkiToRaw(publicKey.export({ type: 'spki', format: 'der' }) as Buffer);
    const identity: DeviceIdentity = {
        version: 2,
        deviceId: createHash('sha256').update(rawKey).digest('hex'),
        publicKeyRaw: base64urlEncode(rawKey),
        privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
    };
    mkdirSync(dirname(identityPath), { recursive: true });
    writeFileSync(identityPath, JSON.stringify(identity, null, 2), 'utf8');
    console.log(`[openclaw] Device identity created: ${identity.deviceId} (${identityPath})`);
    return identity;
}

/** Module-level singleton — loaded once on first import, mutated in-memory when deviceToken arrives. */
let _identity: DeviceIdentity | null = null;

function getIdentity(): DeviceIdentity {
    if (!_identity) {
        _identity = loadOrCreateDeviceIdentity();
        console.log(`[openclaw] Device identity loaded: ${_identity.deviceId}`);
    }
    return _identity;
}

/** Persists an updated deviceToken to the identity file and updates the in-memory singleton. */
function saveDeviceToken(token: string): void {
    const identity = getIdentity();
    if (identity.deviceToken === token) return; // no-op
    identity.deviceToken = token;
    try {
        writeFileSync(env.OPENCLAW_DEVICE_IDENTITY_PATH, JSON.stringify(identity, null, 2), 'utf8');
        console.log('[openclaw] Device token saved — subsequent connections will authenticate automatically.');
    } catch (err) {
        console.error('[openclaw] Failed to persist device token:', err);
    }
}

/**
 * Builds the canonical signature payload and signs it with the Ed25519 private key.
 *
 * The gateway verifies the signature against this exact pipe-delimited string (UTF-8 encoded):
 *   v2|{deviceId}|{clientId}|{clientMode}|{role}|{scope1,scope2,...}|{signedAtMs}|{authToken}|{nonce}
 *
 * This matches `build_device_auth_payload` in the OpenClaw Python client (device_identity.py).
 * The signature is returned as base64url without padding.
 */
function signConnect(
    nonce: string,
    identity: DeviceIdentity,
    authToken: string | undefined,
): { signature: string; signedAt: number } {
    const signedAt = Date.now();
    const canonical = [
        'v2',
        identity.deviceId,
        GATEWAY_CLIENT_ID,
        GATEWAY_CLIENT_MODE,
        GATEWAY_ROLE,
        GATEWAY_SCOPES.join(','),
        String(signedAt),
        authToken ?? '',
        nonce,
    ].join('|');
    const signatureBuffer = cryptoSign(null, Buffer.from(canonical, 'utf8'), identity.privateKeyPem);
    return { signature: base64urlEncode(signatureBuffer), signedAt };
}

// ---------------------------------------------------------------------------
// Low-level helpers
// ---------------------------------------------------------------------------

/** Returns true for low-level connection errors (ECONNREFUSED, ENOTFOUND, ETIMEDOUT, WS close). */
function isConnectionError(err: unknown): boolean {
    if (err instanceof GatewayPairingRequiredError) return false; // intentional gateway rejection
    if (!(err instanceof Error)) return false;
    const code = (err as NodeJS.ErrnoException).code ?? '';
    return (
        code === 'ECONNREFUSED' ||
        code === 'ECONNRESET' ||
        code === 'ENOTFOUND' ||
        code === 'ETIMEDOUT' ||
        code === 'ECONNABORTED' ||
        err.message.includes('WebSocket was closed before the connection was established')
    );
}

/** Timeout (ms) for fast/informational gateway RPC calls (health, sessions list, models, etc.). */
const WS_TIMEOUT = env.OPENCLAW_WS_TIMEOUT;

/** Timeout (ms) for heavy AI gateway calls (chat routing, session spawn, agent generation). */
const AI_TIMEOUT = env.OPENCLAW_AI_TIMEOUT;

/**
 * Maximum time (ms) to wait for a `connect.challenge` event from the gateway.
 * The challenge carries the nonce we must sign. We abort with an error if it
 * doesn't arrive — Mode A always issues a challenge on open.
 */
const CHALLENGE_WAIT_MS = 5_000;

/** Shape returned by `sessions.list`. */
interface LiveSession {
    key?: string;
    agent?: string;
    agentId?: string;
    status?: string;
}

// ---------------------------------------------------------------------------
// Core gateway call
// ---------------------------------------------------------------------------

class GatewayClient {
    private ws: WebSocket | null = null;
    private connectPromise: Promise<void> | null = null;
    private pendingRequests = new Map<
        string,
        { resolve: (value: unknown) => void; reject: (err: Error) => void; timer?: NodeJS.Timeout; method: string }
    >();
    private connected = false;

    private cleanup() {
        if (this.ws) {
            try { this.ws.close(); } catch { /* ignore */ }
            this.ws = null;
        }
        this.connected = false;
        this.connectPromise = null;
        const err = new Error('Gateway connection closed unexpectedly');
        for (const req of this.pendingRequests.values()) {
            if (req.timer) clearTimeout(req.timer);
            req.reject(err);
        }
        this.pendingRequests.clear();
    }

    /**
     * Ensures we have an active, paired connection to the gateway.
     */
    connect(): Promise<void> {
        if (this.connectPromise) return this.connectPromise;
        if (this.connected && this.ws?.readyState === WebSocket.OPEN) return Promise.resolve();

        this.connectPromise = new Promise((resolve, reject) => {
            const gatewayUrl = env.OPENCLAW_GATEWAY_URL;
            const origin = gatewayUrl.replace(/^ws(s?):\/\/([^/]+).*$/, 'http$1://$2');
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
                const authToken = identity.deviceToken ?? env.OPENCLAW_GATEWAY_TOKEN;
                const { signature, signedAt } = signConnect(nonce, identity, authToken);

                const connectParams: Record<string, unknown> = {
                    minProtocol: 3,
                    maxProtocol: 3,
                    role: GATEWAY_ROLE,
                    scopes: GATEWAY_SCOPES,
                    client: {
                        id: GATEWAY_CLIENT_ID,
                        mode: GATEWAY_CLIENT_MODE,
                        version: '1.0.0',
                        platform: 'node',
                    },
                    caps: [],
                    commands: [],
                    permissions: {},
                    locale: 'en-US',
                    userAgent: 'claw-pilot/1.0.0',
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

                ws.send(JSON.stringify({ type: 'req', id: connectId, method: 'connect', params: connectParams }));
            };

            ws.on('error', (err) => {
                if (!settled) settleConnect(err);
                else this.cleanup();
            });

            ws.on('open', () => {
                challengeTimer = setTimeout(() => {
                    if (!this.connected && !settled) {
                        settleConnect(new Error(`Gateway did not send connect.challenge within ${CHALLENGE_WAIT_MS}ms`));
                    }
                }, CHALLENGE_WAIT_MS);
            });

            ws.on('close', (code, reasonBuf) => {
                const reason = reasonBuf.toString('utf8');
                if (!settled) {
                    if (code === 1008 || /pairing/i.test(reason)) {
                        settleConnect(new GatewayPairingRequiredError(identity.deviceId));
                    } else {
                        settleConnect(new Error(`Gateway connection closed (${code}): ${reason || 'no reason'}`));
                    }
                } else {
                    this.cleanup();
                }
            });

            ws.on('message', (raw) => {
                let frame: Record<string, unknown>;
                try {
                    frame = JSON.parse(String(raw));
                } catch {
                    return;
                }

                if (!this.connected) {
                    if (frame.type === 'event' && frame.event === 'connect.challenge') {
                        if (challengeTimer) clearTimeout(challengeTimer);
                        const challengePayload = frame.payload as Record<string, unknown> | undefined;
                        const nonce = String(challengePayload?.nonce ?? randomUUID());
                        sendConnect(nonce);
                        return;
                    }

                    if (frame.type === 'res' && frame.id === connectId) {
                        if (frame.ok === false) {
                            const msg = (frame.error as Record<string, unknown> | undefined)?.message ?? 'unknown';
                            settleConnect(new Error(`Gateway connect failed: ${msg}`));
                            return;
                        }

                        try {
                            const authPayload = (frame.payload as Record<string, unknown> | undefined)?.auth as Record<string, unknown> | undefined;
                            const freshToken = authPayload?.deviceToken as string | undefined;
                            if (freshToken) saveDeviceToken(freshToken);
                        } catch { /* ignored */ }

                        settleConnect();
                        return;
                    }
                    return;
                }

                // Phase 2: Responses to multiplexed requests
                if (frame.type === 'res' && typeof frame.id === 'string') {
                    const req = this.pendingRequests.get(frame.id);
                    if (req) {
                        this.pendingRequests.delete(frame.id);
                        if (req.timer) clearTimeout(req.timer);
                        if (frame.ok === false || Object.prototype.hasOwnProperty.call(frame, 'error')) {
                            const msg = (frame.error as Record<string, unknown> | undefined)?.message ?? 'unknown';
                            req.reject(new Error(`Gateway RPC '${req.method}' failed: ${msg}`));
                        } else {
                            req.resolve(frame.payload);
                        }
                    }
                }
            });
        });

        return this.connectPromise;
    }

    async request(method: string, params: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
        await this.connect();

        return new Promise((resolve, reject) => {
            const requestId = randomUUID();
            const timer = setTimeout(() => {
                this.pendingRequests.delete(requestId);
                reject(new Error(`Gateway call '${method}' timed out after ${timeoutMs}ms`));
            }, timeoutMs);

            this.pendingRequests.set(requestId, { resolve, reject, timer, method });
            this.ws!.send(JSON.stringify({ type: 'req', id: requestId, method, params }));
        });
    }

    /** For testing only */
    _reset() {
        this.cleanup();
    }
}

const sharedClient = new GatewayClient();

/**
 * Executes an RPC method against the OpenClaw gateway over a persistent WebSocket connection.
 * Multiplexes multiple concurrent calls onto the same underlying socket.
 *
 * @param method  Gateway RPC method name (e.g. "chat.send", "sessions.list")
 * @param params  Method parameters object
 * @param options Optional per-call overrides (timeout)
 * @returns       The `payload` field from the successful response frame
 */
export async function gatewayCall(
    method: string,
    params: Record<string, unknown>,
    { timeout = WS_TIMEOUT }: { timeout?: number } = {},
): Promise<unknown> {
    return sharedClient.request(method, params, timeout);
}

/**
 * Resets the shared GatewayClient instance. Exposed strictly for unit testing
 * to ensure fresh mock WebSockets and handshake logic per test.
 * @internal
 */
export function __resetGatewayClientForTest() {
    sharedClient._reset();
}

/**
 * Maps a local agentId to a gateway session key using Mission Control conventions.
 *   'main' → mc-gateway:{OPENCLAW_GATEWAY_ID}:main
 *   other  → mc:mc-{agentId}:main
 * @internal exported for unit testing
 */
export function agentIdToSessionKey(agentId: string): string {
    if (agentId === 'main') {
        return `mc-gateway:${env.OPENCLAW_GATEWAY_ID}:main`;
    }
    return `mc:mc-${agentId}:main`;
}

/**
 * Normalises the three possible shapes of the `agents` field in the gateway
 * config into a flat Agent array:
 *   1. `{ agents: Agent[] }` — plain array
 *   2. `{ agents: { [id]: AgentData } }` — object map
 *   3. `Agent[]` — top-level array (no `agents` key)
 * @internal exported for unit testing
 */
export function parseOpenclawConfig(parsed: unknown): Agent[] {
    let raw: unknown[] = [];
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const obj = parsed as Record<string, unknown>;
        if (Array.isArray(obj.agents)) {
            raw = obj.agents as unknown[];
        } else if (obj.agents !== undefined && typeof obj.agents === 'object') {
            raw = Object.entries(obj.agents as Record<string, unknown>).map(
                ([id, data]) => ({ id, ...(data as object) }),
            );
        } else {
            // Bare top-level object treated as a single-agent map
            raw = Object.entries(obj).map(([id, data]) => ({ id, ...(data as object) }));
        }
    } else if (Array.isArray(parsed)) {
        raw = parsed;
    }

    return raw.map((a: unknown) => {
        const agent = a as Record<string, unknown>;
        return {
            id: String(agent.id ?? agent.name ?? 'unknown-agent'),
            name: String(agent.name ?? agent.id ?? 'Unknown Agent'),
            status: 'OFFLINE' as const,
            capabilities: Array.isArray(agent.capabilities) ? (agent.capabilities as string[]) : [],
            role: typeof agent.role === 'string' ? agent.role : undefined,
            model: typeof agent.model === 'string' ? agent.model : undefined,
            fallback: typeof agent.fallback === 'string' ? agent.fallback : undefined,
        };
    });
}

/**
 * Fetches agents from the gateway via `config.get`.
 * Returns an empty array if the gateway is unreachable or returns no agents.
 */
export async function getAgents(): Promise<Agent[]> {
    try {
        const payload = (await gatewayCall('config.get', {})) as Record<string, unknown> | null;
        if (!payload) return [];
        // config.get returns { hash, config, parsed } — prefer `config`, fall back to `parsed`
        const cfg = (payload.config ?? payload.parsed) as Record<string, unknown> | undefined;
        // Only proceed if the config actually has an `agents` key — bare gateway configs
        // that have other top-level keys (channels, etc.) must not be misinterpreted as agents.
        if (!cfg || !Object.prototype.hasOwnProperty.call(cfg, 'agents')) return [];
        return parseOpenclawConfig(cfg);
    } catch (e) {
        if (e instanceof GatewayPairingRequiredError) throw e;
        if (isConnectionError(e)) throw new GatewayOfflineError('config.get', e as Error);
        console.error('[openclaw] getAgents unexpected error:', e);
        return [];
    }
}

/**
 * Lists all active sessions on the gateway via `sessions.list`.
 * Handles both array and `{ sessions: [...] }` response shapes.
 */
export async function getLiveSessions(): Promise<LiveSession[]> {
    try {
        const payload = await gatewayCall('sessions.list', {});
        if (Array.isArray(payload)) return payload as LiveSession[];
        if (payload && typeof payload === 'object' && Array.isArray((payload as Record<string, unknown>).sessions)) {
            return (payload as Record<string, unknown[]>).sessions as LiveSession[];
        }
        return [];
    } catch (e) {
        if (e instanceof GatewayPairingRequiredError) throw e;
        if (isConnectionError(e)) throw new GatewayOfflineError('sessions.list', e as Error);
        console.error('[openclaw] getLiveSessions unexpected error:', e);
        return [];
    }
}

/**
 * Routes a chat message to an agent session on the gateway.
 * Creates the session if it does not yet exist.
 */
export async function routeChatToAgent(agentId: string, message: string): Promise<unknown> {
    try {
        const sessionKey = agentIdToSessionKey(agentId);
        // Ensure session exists (upsert by key)
        await gatewayCall('sessions.patch', { key: sessionKey }, { timeout: WS_TIMEOUT });
        return await gatewayCall(
            'chat.send',
            { sessionKey, message, deliver: false, idempotencyKey: randomUUID() },
            { timeout: AI_TIMEOUT },
        );
    } catch (e) {
        if (e instanceof GatewayPairingRequiredError) throw e;
        if (isConnectionError(e)) throw new GatewayOfflineError('chat.send', e as Error);
        console.error('[openclaw] routeChatToAgent unexpected error:', e);
        throw e;
    }
}

/**
 * Sends a prompt to the gateway main agent session and returns the response.
 * Used to generate new agent configurations.
 */
export async function generateAgentConfig(prompt: string): Promise<unknown> {
    try {
        const sessionKey = `mc-gateway:${env.OPENCLAW_GATEWAY_ID}:main`;
        const fullPrompt = `Generate a JSON configuration for a new AI agent based on this request: ${prompt}. Return ONLY a JSON object with 'name' (string) and 'capabilities' (array of strings).`;
        await gatewayCall('sessions.patch', { key: sessionKey }, { timeout: WS_TIMEOUT });
        return await gatewayCall(
            'chat.send',
            { sessionKey, message: fullPrompt, deliver: false, idempotencyKey: randomUUID() },
            { timeout: AI_TIMEOUT },
        );
    } catch (e) {
        if (e instanceof GatewayPairingRequiredError) throw e;
        if (isConnectionError(e)) throw new GatewayOfflineError('chat.send', e as Error);
        console.error('[openclaw] generateAgentConfig unexpected error:', e);
        throw e;
    }
}

/**
 * Creates a session for a task and delivers the initial prompt to it.
 */
export async function spawnTaskSession(agentId: string, taskId: string, prompt: string): Promise<void> {
    try {
        const sessionKey = `task-${taskId}`;
        await gatewayCall('sessions.patch', { key: sessionKey, label: sessionKey }, { timeout: WS_TIMEOUT });
        await gatewayCall(
            'chat.send',
            { sessionKey, message: prompt, deliver: true, idempotencyKey: randomUUID() },
            { timeout: AI_TIMEOUT },
        );
    } catch (e) {
        if (e instanceof GatewayPairingRequiredError) throw e;
        if (isConnectionError(e)) throw new GatewayOfflineError('chat.send', e as Error);
        console.error('[openclaw] spawnTaskSession unexpected error:', e);
        throw e;
    }
}

/**
 * Lists all available models on the gateway via `models.list`.
 */
export async function getModels(): Promise<unknown> {
    try {
        const payload = await gatewayCall('models.list', {});
        if (Array.isArray(payload)) return payload;
        if (payload && typeof payload === 'object' && Array.isArray((payload as Record<string, unknown>).models)) {
            return (payload as Record<string, unknown>).models;
        }
        return payload ?? [];
    } catch (e) {
        if (e instanceof GatewayPairingRequiredError) throw e;
        if (isConnectionError(e)) throw new GatewayOfflineError('models.list', e as Error);
        console.error('[openclaw] getModels unexpected error:', e);
        return [];
    }
}
