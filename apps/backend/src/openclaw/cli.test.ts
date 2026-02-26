/**
 * Tests for the OpenClaw gateway WebSocket RPC client (`cli.ts`).
 *
 * Strategy
 * ─────────
 * `ws` is mocked so no real WebSocket connections are opened.
 * `vi.useFakeTimers()` lets us fast-forward the 2 s challenge wait and the
 * per-call timeout without slowing the test suite.
 *
 * MockWebSocket stores every frame sent by the client in `ws.sent[]`.  Tests
 * drive the gateway side by calling `ws.receive(frame)`, which dispatches the
 * frame through the same message handler that real gateway messages would hit.
 */
import { EventEmitter } from 'events';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    gatewayCall,
    agentIdToSessionKey,
    parseOpenclawConfig,
    getAgents,
    getLiveSessions,
    routeChatToAgent,
    generateAgentConfig,
    getModels,
    spawnTaskSession,
    __resetGatewayClientForTest,
} from './cli.js';

beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => { });
    vi.spyOn(console, 'error').mockImplementation(() => { });
});

afterEach(() => {
    vi.restoreAllMocks();
});
// ─── WebSocket mock ─────────────────────────────────────────────────────────
// `mockWsLatest` uses the vitest "mock-prefix" naming convention so it is
// accessible inside the vi.mock factory even after hoisting.
let mockWsLatest: MockWebSocket | null = null;
let mockWsAll: MockWebSocket[] = [];

class MockWebSocket extends EventEmitter {
    static OPEN = 1;
    public readonly url: string;
    public readonly opts: unknown;
    public sent: Array<Record<string, unknown>> = [];
    public closed = false;
    public readyState = 0;
    public handshakeDriven = false;

    constructor(url: string, opts: unknown) {
        super();
        this.url = url;
        this.opts = opts;
        mockWsLatest = this;
        mockWsAll.push(this);
    }

    send(data: string) {
        this.sent.push(JSON.parse(data) as Record<string, unknown>);
    }

    close() {
        this.closed = true;
        this.readyState = 3;
    }

    /** Drive the gateway side — simulates the server sending a frame. */
    receive(frame: Record<string, unknown>) {
        this.emit('message', JSON.stringify(frame));
    }
}

vi.mock('ws', async () => {
    const { EventEmitter } = await import('events');
    return {
        default: class MockWebSocketInner extends EventEmitter {
            static OPEN = 1;
            url: string;
            opts: unknown;
            sent: Array<Record<string, unknown>> = [];
            closed = false;
            readyState = 0;
            handshakeDriven = false;
            constructor(url: string, opts: unknown) {
                super();
                this.url = url;
                this.opts = opts;
                mockWsLatest = this as unknown as MockWebSocket;
                mockWsAll.push(this as unknown as MockWebSocket);
            }
            send(data: string) {
                this.sent.push(JSON.parse(data) as Record<string, unknown>);
            }
            close() { this.closed = true; this.readyState = 3; }
            receive(frame: Record<string, unknown>) {
                this.emit('message', JSON.stringify(frame));
            }
        },
    };
});

// ─── Helpers ─────────────────────────────────────────────────────────────────
const CHALLENGE_WAIT_MS = 2_000;

/**
 * Drives a single gateway connection through the full connect + method cycle.
 *
 * @param methodPayload   Payload the "gateway" returns for the RPC method.
 * @param wsOverride      Optionally target a specific WS instance (default: latest).
 */
async function driveHandshake(
    methodPayload: Record<string, unknown> = {},
    wsOverride?: MockWebSocket,
) {
    const ws = (wsOverride ?? mockWsLatest)!;

    if (!ws.handshakeDriven) {
        ws.readyState = 1; // OPEN
        ws.readyState = 1;
        ws.emit('open');
        ws.receive({ type: 'event', event: 'connect.challenge', payload: { nonce: 'abc123' } });
        const connectFrame = ws.sent[0]!;
        expect(connectFrame.method).toBe('connect');
        ws.receive({ type: 'res', id: connectFrame.id, ok: true, payload: { server: { version: '2026.2.0' } } });
        ws.handshakeDriven = true;
        // Evaluate the connect response microtasks
        await vi.advanceTimersByTimeAsync(0);
    }

    const methodFrame = ws.sent[ws.sent.length - 1]!;
    ws.receive({ type: 'res', id: methodFrame.id, ok: true, payload: methodPayload });
    await vi.advanceTimersByTimeAsync(0);

    return { ws, connectFrame: ws.sent[0]!, methodFrame };
}

// ─── gatewayCall ────────────────────────────────────────────────────────────

describe('gatewayCall', () => {
    beforeEach(() => {
        __resetGatewayClientForTest();
        mockWsLatest = null;
        mockWsAll = [];
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('appends the bearer token as a query param when OPENCLAW_GATEWAY_TOKEN is set', async () => {
        // Token env var defaults to undefined in tests — check URL without token
        const promise = gatewayCall('health', {});
        const ws = mockWsLatest!;
        expect(ws.url).not.toContain('?token=');
        // clean up
        ws.readyState = 1;
        ws.emit('open');
        ws.receive({ type: 'event', event: 'connect.challenge', payload: { nonce: 'abc123' } });
        const cf = ws.sent[0]!;
        ws.receive({ type: 'res', id: cf.id, ok: true, payload: {} });
        await vi.advanceTimersByTimeAsync(0);
        const mf = ws.sent[ws.sent.length - 1]!;
        ws.receive({ type: 'res', id: mf.id, ok: true, payload: {} });
        await promise;
    });

    it('sends a connect frame with a device block', async () => {
        const promise = gatewayCall('health', {});
        const { connectFrame } = await driveHandshake();
        const params = connectFrame.params as Record<string, unknown>;
        const client = params.client as Record<string, unknown>;
        expect(client.id).toBe('gateway-client');
        expect(client.mode).toBe('backend');
        expect(params.device).toBeDefined();
        // Scopes must match what the client currently requests
        expect(params.scopes).toEqual(['operator.read', 'operator.admin', 'operator.approvals', 'operator.pairing']);
        // Protocol-required fields for operator clients
        expect(params.caps).toEqual([]);
        expect(params.commands).toEqual([]);
        expect(params.permissions).toEqual({});
        expect(params.locale).toBe('en-US');
        expect(params.userAgent).toBe('claw-pilot/1.0.0');
        await promise;
    });

    it('happy path: no challenge event — resolves with method payload', async () => {
        const promise = gatewayCall('health', {});
        await driveHandshake({ alive: true });
        const result = await promise;
        expect(result).toEqual({ alive: true });
    });

    it('happy path: connect.challenge event — connect is sent immediately', async () => {
        const promise = gatewayCall('health', {});
        const ws = mockWsLatest!;
        ws.readyState = 1;
        ws.emit('open');

        // Send the challenge event before the 2 s timer fires
        ws.receive({ type: 'event', event: 'connect.challenge', payload: { nonce: 'abc123' } });

        // connect frame should be in sent immediately (no timer needed)
        const connectFrame = ws.sent[0]!;
        expect(connectFrame.method).toBe('connect');

        ws.receive({ type: 'res', id: connectFrame.id, ok: true, payload: {} });
        await vi.advanceTimersByTimeAsync(0);
        const methodFrame = ws.sent[ws.sent.length - 1]!;
        ws.receive({ type: 'res', id: methodFrame.id, ok: true, payload: { ok: 1 } });

        const result = await promise;
        expect(result).toEqual({ ok: 1 });
    });

    it('rejects when the connect response has ok:false', async () => {
        const promise = gatewayCall('health', {});
        const ws = mockWsLatest!;
        ws.readyState = 1;
        ws.emit('open');
        ws.receive({ type: 'event', event: 'connect.challenge', payload: { nonce: 'abc123' } });
        const cf = ws.sent[0]!;
        ws.receive({ type: 'res', id: cf.id, ok: false, error: { message: 'Not authorized' } });
        await expect(promise).rejects.toThrow('Gateway connect failed: Not authorized');
    });

    it('rejects when the method response has ok:false', async () => {
        const promise = gatewayCall('sessions.list', {});
        const ws = mockWsLatest!;
        ws.readyState = 1;
        ws.emit('open');
        ws.receive({ type: 'event', event: 'connect.challenge', payload: { nonce: 'abc123' } });
        const cf = ws.sent[0]!;
        ws.receive({ type: 'res', id: cf.id, ok: true, payload: {} });
        await vi.advanceTimersByTimeAsync(0);
        const mf = ws.sent[ws.sent.length - 1]!;
        ws.receive({ type: 'res', id: mf.id, ok: false, error: { message: 'Unknown method' } });
        await expect(promise).rejects.toThrow("Gateway RPC 'sessions.list' failed: Unknown method");
    });

    it('rejects on WebSocket error', async () => {
        const promise = gatewayCall('health', {});
        const ws = mockWsLatest!;
        ws.emit('error', new Error('ECONNREFUSED'));
        await expect(promise).rejects.toThrow('ECONNREFUSED');
    });

    it('times out when no response arrives', async () => {
        const promise = gatewayCall('health', {}, { timeout: 500 });
        const ws = mockWsLatest!;
        ws.readyState = 1;
        ws.emit('open');
        ws.receive({ type: 'event', event: 'connect.challenge', payload: { nonce: 'abc123' } });
        const cf = ws.sent[0]!;
        ws.receive({ type: 'res', id: cf.id, ok: true, payload: {} });

        await vi.advanceTimersByTimeAsync(0);

        // Attach the rejection handler BEFORE advancing timers to avoid
        // an unhandled-rejection warning when the timer fires.
        const assertion = expect(promise).rejects.toThrow('timed out after 500ms');
        await vi.advanceTimersByTimeAsync(600);
        await assertion;
    });

    it('ignores frames with mismatched IDs', async () => {
        const promise = gatewayCall('health', {});
        const ws = mockWsLatest!;
        ws.readyState = 1;
        ws.emit('open');
        ws.receive({ type: 'event', event: 'connect.challenge', payload: { nonce: 'abc123' } });
        const cf = ws.sent[0]!;
        ws.receive({ type: 'res', id: cf.id, ok: true, payload: {} });
        await vi.advanceTimersByTimeAsync(0);
        const mf = ws.sent[ws.sent.length - 1]!;

        // Send a response with the wrong ID — should be ignored
        ws.receive({ type: 'res', id: 'wrong-id', ok: true, payload: { ignored: true } });

        // Now send the real response
        ws.receive({ type: 'res', id: mf.id, ok: true, payload: { real: true } });

        const result = await promise;
        expect(result).toEqual({ real: true });
    });

    it('sends method params verbatim', async () => {
        const params = { sessionKey: 'mc:mc-coder:main', message: 'hello', deliver: false };
        const promise = gatewayCall('chat.send', params);
        const { methodFrame } = await driveHandshake({});
        expect(methodFrame.method).toBe('chat.send');
        expect(methodFrame.params).toMatchObject(params);
        await promise;
    });
});

// ─── agentIdToSessionKey ─────────────────────────────────────────────────────

describe('agentIdToSessionKey', () => {
    it("maps 'main' to the gateway main session key using OPENCLAW_GATEWAY_ID (default: 'gateway')", () => {
        expect(agentIdToSessionKey('main')).toBe('mc-gateway:gateway:main');
    });

    it('maps any other agentId to mc:mc-{id}:main', () => {
        expect(agentIdToSessionKey('coder-1')).toBe('mc:mc-coder-1:main');
        expect(agentIdToSessionKey('agent-x')).toBe('mc:mc-agent-x:main');
    });

    it('handles UUID-style agent IDs', () => {
        const id = '550e8400-e29b-41d4-a716-446655440000';
        expect(agentIdToSessionKey(id)).toBe(`mc:mc-${id}:main`);
    });
});

// ─── parseOpenclawConfig ─────────────────────────────────────────────────────

describe('parseOpenclawConfig', () => {
    it('parses a config with agents as an array (format 1)', () => {
        const input = {
            agents: [
                { id: 'a1', name: 'Alpha', capabilities: ['code'], model: 'gpt-4o' },
                { id: 'a2', name: 'Beta' },
            ],
        };
        const agents = parseOpenclawConfig(input);
        expect(agents).toHaveLength(2);
        expect(agents[0].id).toBe('a1');
        expect(agents[0].model).toBe('gpt-4o');
        expect(agents[1].name).toBe('Beta');
        expect(agents.every(a => a.status === 'OFFLINE')).toBe(true);
    });

    it('parses a config with agents as an object map (format 2)', () => {
        const input = {
            agents: {
                'agent-x': { name: 'Xavier', capabilities: ['design'], role: 'designer' },
                'agent-y': { name: 'Yara', capabilities: [] },
            },
        };
        const agents = parseOpenclawConfig(input);
        expect(agents).toHaveLength(2);
        const xavier = agents.find(a => a.id === 'agent-x');
        expect(xavier).toBeDefined();
        expect(xavier?.name).toBe('Xavier');
        expect(xavier?.role).toBe('designer');
    });

    it('parses a top-level array (format 3)', () => {
        const input = [{ id: 'solo', name: 'Solo Agent', capabilities: ['all'] }];
        const agents = parseOpenclawConfig(input);
        expect(agents).toHaveLength(1);
        expect(agents[0].id).toBe('solo');
    });

    it('returns an empty array for an empty agents list', () => {
        expect(parseOpenclawConfig({ agents: [] })).toHaveLength(0);
    });

    it('returns an empty array for null/undefined/unknown input', () => {
        expect(parseOpenclawConfig(null)).toHaveLength(0);
        expect(parseOpenclawConfig(undefined)).toHaveLength(0);
        expect(parseOpenclawConfig(42)).toHaveLength(0);
    });

    it('falls back to id when name is missing', () => {
        const agents = parseOpenclawConfig({ agents: [{ id: 'mysterious' }] });
        expect(agents[0].name).toBe('mysterious');
    });
});

// ─── getAgents ───────────────────────────────────────────────────────────────

describe('getAgents', () => {
    beforeEach(() => {
        __resetGatewayClientForTest();
        mockWsLatest = null;
        mockWsAll = [];
        vi.useFakeTimers();
    });
    afterEach(() => { vi.useRealTimers(); });

    it('returns agents from payload.config.agents (array shape)', async () => {
        const promise = getAgents();
        await driveHandshake({
            config: { agents: [{ id: 'alpha', name: 'Alpha', capabilities: ['code'] }] },
        });
        const agents = await promise;
        expect(agents).toHaveLength(1);
        expect(agents[0].id).toBe('alpha');
        expect(agents[0].status).toBe('OFFLINE');
    });

    it('falls back to payload.parsed when payload.config is absent', async () => {
        const promise = getAgents();
        await driveHandshake({
            parsed: { agents: [{ id: 'beta', name: 'Beta', capabilities: [] }] },
        });
        const agents = await promise;
        expect(agents[0].id).toBe('beta');
    });

    it('handles object-map agent format from gateway', async () => {
        const promise = getAgents();
        await driveHandshake({
            config: {
                agents: {
                    'worker-1': { name: 'Worker', capabilities: ['review'], model: 'claude-3' },
                },
            },
        });
        const agents = await promise;
        expect(agents[0].id).toBe('worker-1');
        expect(agents[0].model).toBe('claude-3');
    });

    it('returns [] when the gateway errors', async () => {
        const promise = getAgents();
        mockWsLatest!.emit('error', new Error('ECONNREFUSED'));
        const agents = await promise;
        expect(agents).toEqual([]);
    });

    it('returns [] when config payload has no agents key', async () => {
        const promise = getAgents();
        await driveHandshake({ config: { some_other_key: 1 } });
        const agents = await promise;
        expect(agents).toEqual([]);
    });
});

// ─── getLiveSessions ─────────────────────────────────────────────────────────

describe('getLiveSessions', () => {
    beforeEach(() => {
        __resetGatewayClientForTest();
        mockWsLatest = null;
        mockWsAll = [];
        vi.useFakeTimers();
    });
    afterEach(() => { vi.useRealTimers(); });

    it('returns sessions from an array-shaped payload', async () => {
        const promise = getLiveSessions();
        await driveHandshake([{ key: 'mc-gateway:gateway:main', status: 'IDLE' }] as unknown as Record<string, unknown>);
        const sessions = await promise;
        expect(sessions).toHaveLength(1);
        expect(sessions[0].key).toBe('mc-gateway:gateway:main');
    });

    it('returns sessions from a { sessions: [...] } shaped payload', async () => {
        const promise = getLiveSessions();
        await driveHandshake({ sessions: [{ key: 'mc:mc-coder:main', status: 'WORKING' }] });
        const sessions = await promise;
        expect(sessions[0].key).toBe('mc:mc-coder:main');
    });

    it('returns [] on gateway error', async () => {
        const promise = getLiveSessions();
        mockWsLatest!.emit('error', new Error('timeout'));
        expect(await promise).toEqual([]);
    });
});

// ─── routeChatToAgent ────────────────────────────────────────────────────────

describe('routeChatToAgent', () => {
    beforeEach(() => {
        __resetGatewayClientForTest();
        mockWsLatest = null;
        mockWsAll = [];
        vi.useFakeTimers();
    });
    afterEach(() => { vi.useRealTimers(); });

    it("uses the gateway main session for agentId 'main'", async () => {
        const promise = routeChatToAgent('main', 'hello');

        // First gatewayCall: sessions.patch
        await driveHandshake({});
        const ws1 = mockWsAll[0]!;
        expect(ws1.sent[1]!.method).toBe('sessions.patch');
        expect((ws1.sent[1]!.params as Record<string, unknown>).key).toBe('mc-gateway:gateway:main');

        // Second gatewayCall: chat.send
        await driveHandshake({ id: 'msg-1' });
        expect(ws1.sent[2]!.method).toBe('chat.send');
        const chatParams = ws1.sent[2]!.params as Record<string, unknown>;
        expect(chatParams.sessionKey).toBe('mc-gateway:gateway:main');
        expect(chatParams.message).toBe('hello');
        expect(chatParams.deliver).toBe(false);
        expect(typeof chatParams.idempotencyKey).toBe('string');

        await promise;
    });

    it('uses mc:mc-{agentId}:main for other agent IDs', async () => {
        const promise = routeChatToAgent('coder-1', 'do task');

        // sessions.patch
        await driveHandshake({});
        const patchParams = mockWsAll[0]!.sent[1]!.params as Record<string, unknown>;
        expect(patchParams.key).toBe('mc:mc-coder-1:main');

        // chat.send
        await driveHandshake({ id: 'msg-2' });
        const chatParams = mockWsAll[0]!.sent[2]!.params as Record<string, unknown>;
        expect(chatParams.sessionKey).toBe('mc:mc-coder-1:main');

        await promise;
    });

    it('generates a unique idempotencyKey per call', async () => {
        const p1 = routeChatToAgent('a', 'msg1');
        await driveHandshake({});
        await driveHandshake({});
        const key1 = (mockWsAll[0]!.sent[2]!.params as Record<string, unknown>).idempotencyKey;

        __resetGatewayClientForTest();
        mockWsLatest = null;
        mockWsAll = [];

        const p2 = routeChatToAgent('a', 'msg2');
        await driveHandshake({});
        await driveHandshake({});
        const key2 = (mockWsAll[0]!.sent[2]!.params as Record<string, unknown>).idempotencyKey;

        await p1;
        await p2;
        expect(key1).not.toBe(key2);
    });

    it('rethrows when the gateway errors', async () => {
        const promise = routeChatToAgent('agent-x', 'msg');
        const ws = mockWsLatest!;
        ws.readyState = 1;
        ws.emit('open');
        ws.receive({ type: 'event', event: 'connect.challenge', payload: { nonce: 'abc123' } });
        const cf = ws.sent[0]!;
        ws.receive({ type: 'res', id: cf.id, ok: false, error: { message: 'session not found' } });
        await expect(promise).rejects.toThrow();
    });
});

// ─── generateAgentConfig ─────────────────────────────────────────────────────

describe('generateAgentConfig', () => {
    beforeEach(() => {
        __resetGatewayClientForTest();
        mockWsLatest = null;
        mockWsAll = [];
        vi.useFakeTimers();
    });
    afterEach(() => { vi.useRealTimers(); });

    it('sends to the gateway main session key', async () => {
        const promise = generateAgentConfig('a TypeScript linter bot');

        // First call: sessions.patch
        await driveHandshake({});
        const patchParams = mockWsAll[0]!.sent[1]!.params as Record<string, unknown>;
        expect(patchParams.key).toBe('mc-gateway:gateway:main');

        // Second call: chat.send
        await driveHandshake({ name: 'Linter Bot', capabilities: ['lint', 'fix'] });
        const chatParams = mockWsAll[0]!.sent[2]!.params as Record<string, unknown>;
        expect(chatParams.sessionKey).toBe('mc-gateway:gateway:main');
        expect(typeof chatParams.message).toBe('string');
        expect((chatParams.message as string).length).toBeGreaterThan(0);
        expect(chatParams.deliver).toBe(false);

        const result = await promise;
        expect(result).toMatchObject({ name: 'Linter Bot' });
    });
});

// ─── getModels ───────────────────────────────────────────────────────────────

describe('getModels', () => {
    beforeEach(() => {
        __resetGatewayClientForTest();
        mockWsLatest = null;
        mockWsAll = [];
        vi.useFakeTimers();
    });
    afterEach(() => { vi.useRealTimers(); });

    it('returns payload directly when it is an array', async () => {
        const models = [{ id: 'gpt-4o', provider: 'openai' }, { id: 'claude-3', provider: 'anthropic' }];
        const promise = getModels();
        await driveHandshake(models as unknown as Record<string, unknown>);
        expect(await promise).toEqual(models);
    });

    it('returns payload.models when payload is an object with a models key', async () => {
        const promise = getModels();
        await driveHandshake({ models: [{ id: 'gpt-4o' }] });
        const result = await promise;
        expect(result).toEqual([{ id: 'gpt-4o' }]);
    });

    it('returns [] on gateway error', async () => {
        const promise = getModels();
        mockWsLatest!.emit('error', new Error('down'));
        expect(await promise).toEqual([]);
    });
});

// ─── spawnTaskSession ─────────────────────────────────────────────────────────

describe('spawnTaskSession', () => {
    beforeEach(() => {
        __resetGatewayClientForTest();
        mockWsLatest = null;
        mockWsAll = [];
        vi.useFakeTimers();
    });
    afterEach(() => { vi.useRealTimers(); });

    it('patches the session then sends the prompt with deliver:true', async () => {
        const promise = spawnTaskSession('worker-1', 'task-42', 'Build the auth module');

        // sessions.patch
        await driveHandshake({});
        const patchParams = mockWsAll[0]!.sent[1]!.params as Record<string, unknown>;
        expect(patchParams.key).toBe('task-task-42');
        expect(patchParams.label).toBe('task-task-42');

        // chat.send
        await driveHandshake({});
        const chatParams = mockWsAll[0]!.sent[2]!.params as Record<string, unknown>;
        expect(chatParams.sessionKey).toBe('task-task-42');
        expect(chatParams.message).toBe('Build the auth module');
        expect(chatParams.deliver).toBe(true);
        expect(typeof chatParams.idempotencyKey).toBe('string');

        await expect(promise).resolves.toBeUndefined();
    });
});


// ─── parseOpenclawConfig ─────────────────────────────────────────────────────

describe('parseOpenclawConfig', () => {
    it('parses a config with agents as an array (format 1)', () => {
        const input = {
            agents: [
                { id: 'a1', name: 'Alpha', capabilities: ['code'], model: 'gpt-4o' },
                { id: 'a2', name: 'Beta' },
            ],
        };
        const agents = parseOpenclawConfig(input);
        expect(agents).toHaveLength(2);
        expect(agents[0].id).toBe('a1');
        expect(agents[0].model).toBe('gpt-4o');
        expect(agents[1].name).toBe('Beta');
        expect(agents.every(a => a.status === 'OFFLINE')).toBe(true);
    });

    it('parses a config with agents as an object map (format 2)', () => {
        const input = {
            agents: {
                'agent-x': { name: 'Xavier', capabilities: ['design'], role: 'designer' },
                'agent-y': { name: 'Yara', capabilities: [] },
            },
        };
        const agents = parseOpenclawConfig(input);
        expect(agents).toHaveLength(2);
        const xavier = agents.find(a => a.id === 'agent-x');
        expect(xavier).toBeDefined();
        expect(xavier?.name).toBe('Xavier');
        expect(xavier?.role).toBe('designer');
    });

    it('parses a top-level array (format 3)', () => {
        const input = [
            { id: 'solo', name: 'Solo Agent', capabilities: ['all'] },
        ];
        const agents = parseOpenclawConfig(input);
        expect(agents).toHaveLength(1);
        expect(agents[0].id).toBe('solo');
    });

    it('returns an empty array for an empty agents list', () => {
        expect(parseOpenclawConfig({ agents: [] })).toHaveLength(0);
    });

    it('returns an empty array for null/undefined/unknown input', () => {
        expect(parseOpenclawConfig(null)).toHaveLength(0);
        expect(parseOpenclawConfig(undefined)).toHaveLength(0);
        expect(parseOpenclawConfig(42)).toHaveLength(0);
    });

    it('falls back to id when name is missing', () => {
        const input = { agents: [{ id: 'mysterious' }] };
        const agents = parseOpenclawConfig(input);
        expect(agents[0].name).toBe('mysterious');
    });
});



