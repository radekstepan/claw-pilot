import { randomUUID, createHash, generateKeyPairSync, sign as cryptoSign } from 'crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import WebSocket from 'ws';
import { Agent } from '@claw-pilot/shared-types';
import { env } from '../config/env.js';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

export class GatewayOfflineError extends Error {
    override readonly name = 'GatewayOfflineError';
    constructor(method: string, cause: Error) {
        super(`OpenClaw gateway unreachable (${method}): ${cause.message}`);
        this.cause = cause;
    }
}

export class GatewayPairingRequiredError extends Error {
    override readonly name = 'GatewayPairingRequiredError';
    readonly deviceId: string;
    constructor(deviceId: string) {
        super(`Gateway pairing required for device ${deviceId}. Run: openclaw devices approve --latest`);
        this.deviceId = deviceId;
    }
}

// ---------------------------------------------------------------------------
// Device identity
// ---------------------------------------------------------------------------

const GATEWAY_CLIENT_ID = 'gateway-client';
const GATEWAY_CLIENT_MODE = 'backend';
const GATEWAY_ROLE = 'operator';
const GATEWAY_SCOPES = ['operator.read', 'operator.admin', 'operator.approvals', 'operator.pairing'];

interface DeviceIdentity {
    version?: number;
    deviceId: string;
    publicKeyRaw: string;
    privateKeyPem: string;
    deviceToken?: string;
}

function base64urlEncode(buf: Buffer): string {
    return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function spkiToRaw(spkiDer: Buffer): Buffer {
    return spkiDer.slice(-32);
}

function loadOrCreateDeviceIdentity(): DeviceIdentity {
    const identityPath = env.OPENCLAW_DEVICE_IDENTITY_PATH;
    try {
        const raw = readFileSync(identityPath, 'utf8');
        const parsed = JSON.parse(raw) as DeviceIdentity;
        if (parsed.deviceId && parsed.publicKeyRaw && parsed.privateKeyPem && (parsed.version ?? 0) >= 2) {
            return parsed;
        }
    } catch {
        // Fall through to regenerate
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

let _identity: DeviceIdentity | null = null;

function getIdentity(): DeviceIdentity {
    if (!_identity) {
        _identity = loadOrCreateDeviceIdentity();
        if (process.env.NODE_ENV !== 'test') {
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
        writeFileSync(env.OPENCLAW_DEVICE_IDENTITY_PATH, JSON.stringify(identity, null, 2), 'utf8');
        console.log('[openclaw] Device token saved — subsequent connections will authenticate automatically.');
    } catch (err) {
        console.error('[openclaw] Failed to persist device token:', err);
    }
}

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

function isConnectionError(err: unknown): boolean {
    if (err instanceof GatewayPairingRequiredError) return false;
    if (!(err instanceof Error)) return false;
    const code = (err as NodeJS.ErrnoException).code ?? '';
    return (
        code === 'ECONNREFUSED' ||
        code === 'ECONNRESET' ||
        code === 'ENOTFOUND' ||
        code === 'ETIMEDOUT' ||
        code === 'ECONNABORTED' ||
        err.message.includes('WebSocket was closed before the connection was established') ||
        err.message.includes('Unexpected server response:')
    );
}

const WS_TIMEOUT = env.OPENCLAW_WS_TIMEOUT;
const AI_TIMEOUT = env.OPENCLAW_AI_TIMEOUT;
const CHALLENGE_WAIT_MS = 5_000;

export const LiveSessionSchema = z.object({
    key: z.string().optional(),
    agent: z.string().optional(),
    agentId: z.string().optional(),
    status: z.string().optional(),
}).passthrough();

export type LiveSession = z.infer<typeof LiveSessionSchema>;

export const AgentConfigSchema = z.object({
    id: z.string().optional(),
    name: z.string().optional(),
    capabilities: z.array(z.string()).optional(),
    role: z.string().optional(),
    model: z.string().optional(),
    fallback: z.string().optional(),
}).passthrough();

export const GatewayConfigPayloadSchema = z.union([
    z.array(z.unknown()),
    z.object({
        hash: z.string().optional(),
        value: z.unknown().optional(),
        config: z.unknown().optional(),
        parsed: z.unknown().optional(),
    }).passthrough().nullable()
]);

export const GatewaySessionsPayloadSchema = z.union([
    z.array(LiveSessionSchema),
    z.object({
        sessions: z.array(LiveSessionSchema)
    }).passthrough()
]);

export const GatewayModelsPayloadSchema = z.union([
    z.array(z.unknown()),
    z.object({
        models: z.array(z.unknown())
    }).passthrough()
]).nullable().optional();

// ---------------------------------------------------------------------------
// Core gateway call
// ---------------------------------------------------------------------------

class GatewayClient {
    private ws: WebSocket | null = null;
    private connectPromise: Promise<void> | null = null;
    private pendingRequests = new Map<
        string,
        { resolve: (value: unknown) => void; reject: (err: Error) => void; timer?: NodeJS.Timeout; method: string; schema?: z.ZodType<any> }
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

                if (frame.type === 'res' && typeof frame.id === 'string') {
                    const req = this.pendingRequests.get(frame.id);
                    if (req) {
                        this.pendingRequests.delete(frame.id);
                        if (req.timer) clearTimeout(req.timer);
                        if (frame.ok === false || Object.prototype.hasOwnProperty.call(frame, 'error')) {
                            const msg = (frame.error as Record<string, unknown> | undefined)?.message ?? 'unknown';
                            req.reject(new Error(`Gateway RPC '${req.method}' failed: ${msg}`));
                        } else {
                            if (req.schema) {
                                try {
                                    const parsed = req.schema.parse(frame.payload);
                                    req.resolve(parsed);
                                } catch (err) {
                                    req.reject(new Error(`Gateway response validation failed for '${req.method}': ${(err as Error).message}`));
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

    async request<T = unknown>(method: string, params: Record<string, unknown>, timeoutMs: number, schema?: z.ZodType<T>): Promise<T> {
        await this.connect();

        return new Promise((resolve, reject) => {
            const requestId = randomUUID();
            const timer = setTimeout(() => {
                this.pendingRequests.delete(requestId);
                reject(new Error(`Gateway call '${method}' timed out after ${timeoutMs}ms`));
            }, timeoutMs);

            this.pendingRequests.set(requestId, { resolve: resolve as (v: unknown) => void, reject, timer, method, schema });
            this.ws!.send(JSON.stringify({ type: 'req', id: requestId, method, params }));
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
    { timeout = WS_TIMEOUT, schema }: { timeout?: number; schema?: z.ZodType<T> } = {},
): Promise<T> {
    return sharedClient.request<T>(method, params, timeout, schema);
}

export function __resetGatewayClientForTest() {
    sharedClient._reset();
}

export function agentIdToSessionKey(agentId: string): string {
    if (agentId === 'main') {
        return `mc-gateway:${env.OPENCLAW_GATEWAY_ID}:main`;
    }
    return `mc:mc-${agentId}:main`;
}

export function parseOpenclawConfig(parsed: unknown): Agent[] {
    let raw: unknown[] = [];

    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const obj = parsed as Record<string, unknown>;
        const section = (obj.agents && typeof obj.agents === 'object' && !Array.isArray(obj.agents))
            ? (obj.agents as Record<string, unknown>)
            : obj;

        if (Array.isArray(section.list)) {
            raw.push(...section.list);
        } else if (Array.isArray(obj.agents)) {
            raw.push(...obj.agents);
        }

        const reserved = ['list', 'hash', 'agents'];
        for (const [key, val] of Object.entries(section)) {
            if (reserved.includes(key)) continue;
            if (val && typeof val === 'object' && !Array.isArray(val)) {
                raw.push({ id: key, ...(val as object) });
            }
        }
    } else if (Array.isArray(parsed)) {
        raw = parsed;
    }

    return raw.map((a: unknown) => {
        const agent = a as Record<string, unknown>;

        // Map OpenClaw tools.allow back to UI "capabilities"
        const tools = agent.tools as Record<string, unknown> | undefined;
        const capabilities = Array.isArray(tools?.allow)
            ? (tools!.allow as string[])
            : (Array.isArray(agent.capabilities) ? agent.capabilities as string[] : []);

        return {
            id: String(agent.id ?? agent.name ?? 'unknown-agent'),
            name: String(agent.name ?? agent.id ?? 'Unknown Agent'),
            status: 'OFFLINE' as const,
            capabilities,
            role: typeof agent.role === 'string' ? agent.role : undefined,
            model: typeof agent.model === 'string' ? agent.model : undefined,
            fallback: typeof agent.fallback === 'string' ? agent.fallback : undefined,
            workspace: typeof agent.workspace === 'string' ? agent.workspace : undefined,
        };
    });
}

function extractValue(payload: any): any {
    if (!payload) return null;
    if (Array.isArray(payload)) return payload;
    if (typeof payload !== 'object') return payload;

    const v = payload.value ?? payload.config ?? payload.parsed;
    if (v !== undefined) return v;

    return payload;
}

export async function getAgents(): Promise<Agent[]> {
    try {
        const payload = await gatewayCall('config.get', {}, { schema: GatewayConfigPayloadSchema });
        const value = extractValue(payload);

        if (!value) return [];
        return parseOpenclawConfig(value);
    } catch (e) {
        if (e instanceof GatewayPairingRequiredError) throw e;
        if (isConnectionError(e)) throw new GatewayOfflineError('config.get', e as Error);
        console.error('[openclaw] getAgents unexpected error:', e);
        return [];
    }
}

export async function getLiveSessions(): Promise<LiveSession[]> {
    try {
        const payload = await gatewayCall('sessions.list', {}, { schema: GatewaySessionsPayloadSchema });
        if (Array.isArray(payload)) return payload;
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

export async function routeChatToAgent(agentId: string, message: string): Promise<unknown> {
    try {
        const sessionKey = agentIdToSessionKey(agentId);
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

export async function generateAgentConfig(prompt: string, model?: string): Promise<Record<string, unknown>> {
    try {
        const sessionKey = `mc-gateway:${env.OPENCLAW_GATEWAY_ID}:main`;
        const modelHint = model
            ? ` The agent should be assigned the model ID '${model}'.`
            : '';
        const fallbackModel = model ?? 'claude-3-5-sonnet';
        const fullPrompt =
            `Generate a JSON configuration for a new AI agent based on this request: ${prompt}.${modelHint} ` +
            `Return ONLY a valid JSON object with exactly these keys: ` +
            `'name' (string, a short slug-style id, e.g. "data-viz-expert"), ` +
            `'capabilities' (array of strings describing what the agent can do), ` +
            `and 'model' (string — use '${fallbackModel}' unless the request specifies otherwise). ` +
            `Do not include any markdown or explanation — just the raw JSON object.`;
        await gatewayCall('sessions.patch', { key: sessionKey }, { timeout: WS_TIMEOUT });
        const raw = await gatewayCall(
            'chat.send',
            { sessionKey, message: fullPrompt, deliver: false, idempotencyKey: randomUUID() },
            { timeout: AI_TIMEOUT },
        ) as Record<string, unknown> | string | null;

        const text =
            typeof raw === 'string'
                ? raw
                : typeof raw?.message === 'string'
                    ? raw.message
                    : JSON.stringify(raw ?? {});

        let parsed: Record<string, unknown> | null = null;
        try {
            parsed = JSON.parse(text) as Record<string, unknown>;
        } catch {
            const match = text.match(/\{[\s\S]*\}/);
            if (match) {
                try {
                    parsed = JSON.parse(match[0]) as Record<string, unknown>;
                } catch { /* give up — return graceful degradation below */ }
            }
        }

        if (parsed && typeof parsed === 'object') {
            return parsed;
        }

        return { name: 'new-agent', capabilities: [], model: fallbackModel, _raw: text };
    } catch (e) {
        if (e instanceof GatewayPairingRequiredError) throw e;
        if (isConnectionError(e)) throw new GatewayOfflineError('chat.send', e as Error);
        console.error('[openclaw] generateAgentConfig unexpected error:', e);
        throw e;
    }
}

export async function createAgent(name: string, workspace: string, model?: string, capabilities?: string[]): Promise<void> {
    try {
        // Step 1: create agent (which auto-scaffolds the workspace directory)
        try {
            await gatewayCall('agents.create', { name, workspace }, { timeout: WS_TIMEOUT });
        } catch (createErr) {
            const msg = (createErr as Error).message ?? '';
            // Non-fatal if the agent already exists
            if (/already|duplicate|conflict/i.test(msg)) {
                console.log(`[openclaw] createAgent: "${name}" already registered — skipping`);
            } else {
                throw createErr;
            }
        }

        // Step 2: apply model and capabilities (mapped to tools.allow internally) via config.patch
        if (model !== undefined || capabilities !== undefined) {
            await updateAgentMeta(name, { model, capabilities });
        }
    } catch (e) {
        if (e instanceof GatewayPairingRequiredError) throw e;
        if (isConnectionError(e)) throw new GatewayOfflineError('agents.create', e as Error);
        console.error('[openclaw] createAgent unexpected error:', e);
        throw e;
    }
}

export async function updateAgentMeta(
    agentId: string,
    patch: { name?: string; model?: string; capabilities?: string[] },
): Promise<void> {
    const { name: newName, model: newModel, capabilities: newCapabilities } = patch;
    if (newName === undefined && newModel === undefined && newCapabilities === undefined) return;

    try {
        if (newName !== undefined) {
            const payload = await gatewayCall('config.get', {}, { schema: GatewayConfigPayloadSchema });
            const listValue = extractValue(payload) as any;
            const rawList: Record<string, unknown>[] = Array.isArray(listValue?.agents?.list) ? listValue.agents.list : [];
            const current = rawList.find((a) => (a.id ?? a.name) === agentId);
            const workspace = typeof current?.workspace === 'string' ? current.workspace : '';

            await gatewayCall('agents.update', { agentId, name: newName, workspace }, { timeout: WS_TIMEOUT });
        }

        if (newModel !== undefined || newCapabilities !== undefined) {
            const payload = await gatewayCall('config.get', {}, { schema: GatewayConfigPayloadSchema });
            const hash = (payload && !Array.isArray(payload) && typeof payload.hash === 'string') ? payload.hash : undefined;
            const listValue = extractValue(payload) as any;
            const rawList: Record<string, unknown>[] = Array.isArray(listValue?.agents?.list) ? listValue.agents.list : [];

            if (!rawList.some((a) => (a.id ?? a.name) === agentId)) {
                console.warn(`[openclaw] updateAgentMeta: agent "${agentId}" not found in agents.list`);
                return;
            }

            const updatedList = rawList.map((a) => {
                if ((a.id ?? a.name) !== agentId) return a;
                const updated = { ...a };

                if (newModel !== undefined) updated.model = newModel;
                if (newCapabilities !== undefined) {
                    // OpenClaw schema strictly rejects 'capabilities' at the root.
                    // Map the UI field to 'tools.allow'.
                    updated.tools = { ...((updated.tools as Record<string, unknown>) || {}), allow: newCapabilities };
                    delete updated.capabilities;
                }

                return updated;
            });

            await gatewayCall(
                'config.patch',
                { baseHash: hash, raw: JSON.stringify({ agents: { list: updatedList } }) },
                { timeout: WS_TIMEOUT },
            );
        }
    } catch (e) {
        if (e instanceof GatewayPairingRequiredError) throw e;
        if (isConnectionError(e)) throw new GatewayOfflineError('updateAgentMeta', e as Error);
        console.error('[openclaw] updateAgentMeta unexpected error:', e);
        throw e;
    }
}


async function listAgentFiles(agentId: string): Promise<string[]> {
    try {
        const payload = await gatewayCall('agents.files.list', { agentId }, { timeout: WS_TIMEOUT }) as { files?: Array<{ name?: string } | string> };
        const files = payload?.files ?? [];
        return files.map((f) => (typeof f === 'string' ? f : (f?.name ?? ''))).filter(Boolean);
    } catch (e) {
        console.warn(`[openclaw] agents.files.list error for agentId='${agentId}':`, (e as Error).message);
        return [];
    }
}

export async function getAgentFile(agentId: string, name: string): Promise<string> {
    try {
        const payload = await gatewayCall('agents.files.get', { agentId, name }, { timeout: WS_TIMEOUT }) as {
            content?: string;
            file?: { missing?: boolean };
        };
        // Gateway returns `file.missing: true` for files that are registered but not yet
        // written to disk — treat this as a normal empty state, not an error.
        if (payload?.file?.missing) return '';
        return payload?.content ?? '';
    } catch (e) {
        console.error(`[openclaw] getAgentFile (${name}) error for agentId='${agentId}':`, e);
        return '';
    }
}

/** Fetch SOUL.md, TOOLS.md, AGENTS.md for an agent.
 *  Uses agents.files.list first so we only request files that actually exist. */
export async function getAgentWorkspaceFiles(agentId: string): Promise<{ soul: string; tools: string; agentsMd: string }> {
    const available = await listAgentFiles(agentId);

    const fetch = (name: string) =>
        available.includes(name) ? getAgentFile(agentId, name) : Promise.resolve('');

    const [soul, tools, agentsMd] = await Promise.all([
        fetch('SOUL.md'),
        fetch('TOOLS.md'),
        fetch('AGENTS.md'),
    ]);
    return { soul, tools, agentsMd };
}


export async function setAgentFiles(
    agentId: string,
    files: { soul?: string; tools?: string; agentsMd?: string },
): Promise<void> {
    try {
        const updates: Promise<unknown>[] = [];

        if (files.soul !== undefined) updates.push(gatewayCall('agents.files.set', { agentId, name: 'SOUL.md', content: files.soul }, { timeout: WS_TIMEOUT }));
        if (files.tools !== undefined) updates.push(gatewayCall('agents.files.set', { agentId, name: 'TOOLS.md', content: files.tools }, { timeout: WS_TIMEOUT }));
        if (files.agentsMd !== undefined) updates.push(gatewayCall('agents.files.set', { agentId, name: 'AGENTS.md', content: files.agentsMd }, { timeout: WS_TIMEOUT }));

        await Promise.all(updates);
    } catch (e) {
        if (e instanceof GatewayPairingRequiredError) throw e;
        if (isConnectionError(e)) throw new GatewayOfflineError('agents.files.set', e as Error);
        console.error('[openclaw] setAgentFiles unexpected error:', e);
        throw e;
    }
}

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

export async function deleteAgent(agentId: string, deleteFiles = true): Promise<unknown> {
    try {
        return await gatewayCall('agents.delete', { agentId, deleteFiles }, { timeout: WS_TIMEOUT });
    } catch (e) {
        if (e instanceof GatewayPairingRequiredError) throw e;
        if (isConnectionError(e)) throw new GatewayOfflineError('agents.delete', e as Error);
        console.error('[openclaw] deleteAgent unexpected error:', e);
        throw e;
    }
}

export async function getModels(): Promise<unknown> {
    try {
        const payload = await gatewayCall('models.list', {}, { schema: GatewayModelsPayloadSchema });
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
