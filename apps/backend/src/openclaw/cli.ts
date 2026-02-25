import { randomUUID } from 'crypto';
import WebSocket from 'ws';
import { Agent } from '@claw-pilot/shared-types';
import { env } from '../config/env.js';

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

/** Returns true for low-level connection errors (ECONNREFUSED, ENOTFOUND, ETIMEDOUT, WS close). */
function isConnectionError(err: unknown): boolean {
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
 * Maximum time (ms) to wait for a `connect.challenge` event from the gateway
 * before proceeding with the Mode-B connect handshake without a nonce.
 */
const CHALLENGE_WAIT_MS = 2_000;

/** Shape returned by `sessions.list`. */
interface LiveSession {
    key?: string;
    agent?: string;
    agentId?: string;
    status?: string;
}

/**
 * Opens a fresh WebSocket connection to the OpenClaw gateway, performs the
 * Mode-B (control_ui) authentication handshake, executes one RPC method, then
 * closes the connection.
 *
 * Mode B requires the gateway to have `disable_device_pairing: true`.
 * No Ed25519 key pair management is needed in this mode.
 *
 * Wire protocol: every message is a JSON text frame.
 *   Request:  { type: "req", id: uuid, method: string, params: {} }
 *   Response: { type: "res", id: uuid, ok: boolean, payload: any } | { ..., ok: false, error: { message } }
 *   Event:    { type: "event", event: string, payload: {} }
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
    const gatewayUrl = env.OPENCLAW_GATEWAY_URL;
    const token = env.OPENCLAW_GATEWAY_TOKEN;

    const wsUrl = token ? `${gatewayUrl}?token=${encodeURIComponent(token)}` : gatewayUrl;
    // Mode B requires an Origin header matching the gateway's scheme+host
    const origin = gatewayUrl.replace(/^ws(s?):\/\/([^/]+).*$/, 'http$1://$2');

    return new Promise<unknown>((resolve, reject) => {
        let settled = false;
        let ws: WebSocket;
        let timer: NodeJS.Timeout | undefined;
        let challengeTimer: NodeJS.Timeout | undefined;
        let connected = false;

        const connectId = randomUUID();
        const requestId = randomUUID();

        function settle(fn: () => void) {
            if (settled) return;
            settled = true;
            if (timer) clearTimeout(timer);
            if (challengeTimer) clearTimeout(challengeTimer);
            fn();
            try { ws.close(); } catch { /* ignore */ }
        }

        function sendConnect() {
            const connectParams: Record<string, unknown> = {
                minProtocol: 3,
                maxProtocol: 3,
                role: 'operator',
                scopes: ['operator.read', 'operator.admin', 'operator.approvals'],
                client: {
                    id: 'openclaw-control-ui',
                    version: '1.0.0',
                    platform: 'node',
                    mode: 'ui',
                },
            };
            if (token) {
                connectParams.auth = { token };
            }
            ws.send(JSON.stringify({ type: 'req', id: connectId, method: 'connect', params: connectParams }));
        }

        function sendRequest() {
            ws.send(JSON.stringify({ type: 'req', id: requestId, method, params }));
        }

        try {
            ws = new WebSocket(wsUrl, { headers: { Origin: origin } });
        } catch (err) {
            reject(err);
            return;
        }

        // Overall call timeout
        timer = setTimeout(() => {
            settle(() => reject(new Error(`Gateway call '${method}' timed out after ${timeout}ms`)));
        }, timeout);

        ws.on('error', (err) => settle(() => reject(err)));

        ws.on('open', () => {
            // Wait up to CHALLENGE_WAIT_MS for a connect.challenge event.
            // If none arrives, proceed with the connect handshake without a nonce (v1 signature, Mode B).
            challengeTimer = setTimeout(() => {
                if (!connected && !settled) sendConnect();
            }, CHALLENGE_WAIT_MS);
        });

        ws.on('message', (raw) => {
            let frame: Record<string, unknown>;
            try {
                frame = JSON.parse(String(raw));
            } catch {
                return; // ignore malformed frames
            }

            // ── Phase 1: handshake ──────────────────────────────────────────
            if (!connected) {
                if (frame.type === 'event' && frame.event === 'connect.challenge') {
                    // Challenge received — connect immediately (nonce is ignored in Mode B)
                    if (challengeTimer) {
                        clearTimeout(challengeTimer);
                        challengeTimer = undefined;
                    }
                    sendConnect();
                    return;
                }

                if (frame.type === 'res' && frame.id === connectId) {
                    if (frame.ok === false) {
                        const msg = (frame.error as Record<string, unknown> | undefined)?.message ?? 'unknown';
                        settle(() => reject(new Error(`Gateway connect failed: ${msg}`)));
                        return;
                    }
                    connected = true;
                    sendRequest();
                    return;
                }
                return;
            }

            // ── Phase 2: await method response ──────────────────────────────
            if (frame.type === 'res' && frame.id === requestId) {
                if (frame.ok === false || Object.prototype.hasOwnProperty.call(frame, 'error')) {
                    const msg = (frame.error as Record<string, unknown> | undefined)?.message ?? 'unknown';
                    settle(() => reject(new Error(`Gateway RPC '${method}' failed: ${msg}`)));
                } else {
                    settle(() => resolve(frame.payload));
                }
            }
        });
    });
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
        if (isConnectionError(e)) throw new GatewayOfflineError('models.list', e as Error);
        console.error('[openclaw] getModels unexpected error:', e);
        return [];
    }
}
