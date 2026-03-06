import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NanoClawClient, NanoClawChannelClient, ChannelResponse } from './index';

// ---------------------------------------------------------------------------
// WebSocket mock
// ---------------------------------------------------------------------------
// MockWebSocket is defined via vi.hoisted() so it exists before vi.mock hoisting.

const mockState = vi.hoisted(() => {
    type WsEventMap = Record<string, Array<(...args: any[]) => void>>;

    class MockWebSocket {
        static OPEN = 1;
        static CLOSED = 3;

        readyState = 1; // OPEN
        url: string;
        private _listeners: WsEventMap = {};
        sent: string[] = [];

        constructor(url: string) {
            this.url = url;
            // Emit 'open' asynchronously so the constructor completes first
            setTimeout(() => this._emit('open'), 0);
        }

        on(event: string, cb: (...args: any[]) => void) {
            (this._listeners[event] = this._listeners[event] || []).push(cb);
            return this;
        }

        send(data: string) { this.sent.push(data); }
        ping() { /* noop */ }

        close() {
            this.readyState = 3; // CLOSED
            this._emit('close');
        }

        _emit(event: string, ...args: any[]) {
            (this._listeners[event] || []).forEach(cb => cb(...args));
        }

        _triggerMessage(obj: object) {
            this._emit('message', Buffer.from(JSON.stringify(obj)));
        }
    }

    // Mutable box so tests can access the latest WS instance
    const state: { lastMockWs: MockWebSocket | null } = { lastMockWs: null };

    return { MockWebSocket, state };
});

vi.mock('ws', () => {
    const WS = vi.fn().mockImplementation((url: string) => {
        const ws = new mockState.MockWebSocket(url);
        mockState.state.lastMockWs = ws;
        return ws;
    });
    (WS as any).OPEN = 1;
    (WS as any).CLOSED = 3;
    return { default: WS };
});

// Mock the global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('NanoClawClient', () => {
    let client: NanoClawClient;

    beforeEach(() => {
        vi.clearAllMocks();
        client = new NanoClawClient('http://localhost:3000', 'test-token');
    });

    it('should handle successful GET requests', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ([{ id: '1', name: 'Agent 1', folder: 'main' }])
        } as Response);

        const agents = await client.getAgents();

        expect(mockFetch).toHaveBeenCalledWith('http://localhost:3000/api/agents', {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer test-token'
            },
            body: undefined
        });

        expect(agents).toEqual([{ id: '1', name: 'Agent 1', folder: 'main' }]);
    });

    it('should handle successful POST requests with NanoClaw-native format', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            status: 201,
            json: async () => ({ id: '2', name: 'New Agent', folder: 'main' })
        } as Response);

        const newAgent = await client.createAgent({
            jid: 'tg:123456789',
            name: 'New Agent',
            folder: 'main',
            trigger: '@Agent'
        });

        expect(mockFetch).toHaveBeenCalledWith('http://localhost:3000/api/agents', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer test-token'
            },
            body: JSON.stringify({ jid: 'tg:123456789', name: 'New Agent', folder: 'main', trigger: '@Agent' })
        });

        expect(newAgent).toEqual({ id: '2', name: 'New Agent', folder: 'main' });
    });

    it('should translate claw-pilot format to NanoClaw format', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            status: 201,
            json: async () => ({ id: 'cp-default-sonnet-4-6@claw-pilot', name: 'My Agent', folder: 'claw_production' })
        } as Response);

        const newAgent = await client.createAgent({
            name: 'My Agent',
            workspace: 'production',
            model: 'claude-sonnet-4-6',
            capabilities: ['code', 'browser']
        });

        expect(mockFetch).toHaveBeenCalledWith('http://localhost:3000/api/agents', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer test-token'
            },
            body: JSON.stringify({
                jid: 'cp-production-sonnet-4-6@claw-pilot',
                name: 'My Agent',
                folder: 'claw_production',
                trigger: '@code-browser',
                isMain: undefined,
                requiresTrigger: undefined
            })
        });

        expect(newAgent).toEqual({ id: 'cp-default-sonnet-4-6@claw-pilot', name: 'My Agent', folder: 'claw_production' });
    });

    it('should use default values when creating agent with minimal claw-pilot format', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            status: 201,
            json: async () => ({ id: '3', name: 'Minimal Agent', folder: 'claw_default' })
        } as Response);

        await client.createAgent({ name: 'Minimal Agent' });

        expect(mockFetch).toHaveBeenCalledWith('http://localhost:3000/api/agents', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer test-token'
            },
            body: JSON.stringify({
                jid: 'cp-default-sonnet-4-6@claw-pilot',
                name: 'Minimal Agent',
                folder: 'claw_default',
                trigger: '@Agent',
                isMain: undefined,
                requiresTrigger: undefined
            })
        });
    });

    it('should handle spawnTask with optional webhook', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({ success: true })
        } as Response);

        const webhook = { url: 'http://webhook', headers: { Authorization: 'token' } };
        await client.spawnTask('agent-1', 'task-1', 'Hello', webhook);

        expect(mockFetch).toHaveBeenCalledWith('http://localhost:3000/api/agents/agent-1/tasks', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer test-token'
            },
            body: JSON.stringify({ taskId: 'task-1', prompt: 'Hello', webhook })
        });
    });

    it('should throw an error on non-ok HTTP responses', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: false,
            status: 400,
            text: async () => 'Bad Request'
        } as Response);

        await expect(client.getAgents()).rejects.toThrow('NanoClaw API error (400): Bad Request');
    });

    it('should transform fetch network errors', async () => {
        mockFetch.mockRejectedValueOnce(new TypeError('fetch failed'));

        const promise = client.getAgents();

        await expect(promise).rejects.toThrow('fetch failed');
        // Check if error name was transformed
        await promise.catch(e => {
            expect(e.name).toBe('NetworkError');
        });
    });

    it('should handle empty base url path correctly (remove trailing slash)', async () => {
        const clientWithSlash = new NanoClawClient('http://localhost:3000/', 'test-token');

        mockFetch.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => []
        } as Response);

        await clientWithSlash.getAgents();

        expect(mockFetch).toHaveBeenCalledWith('http://localhost:3000/api/agents', expect.any(Object));
    });

    it('should handle 204 no content responses properly', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            status: 204,
            json: async () => ({})
        } as Response);

        const result = await client.deleteAgent('1');
        expect(result).toEqual({});
    });

    it('should handle health check without auth', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({ status: 'ok', timestamp: '2026-03-05T00:00:00.000Z' })
        } as Response);

        const health = await client.healthCheck();

        // Health check doesn't send auth headers
        expect(mockFetch).toHaveBeenCalledWith('http://localhost:3000/api/health');

        expect(health).toEqual({ status: 'ok', timestamp: '2026-03-05T00:00:00.000Z' });
    });

    it('should update agent with NanoClaw-native format', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({ id: '1', name: 'Updated', folder: 'main' })
        } as Response);

        await client.updateAgent('1', {
            name: 'Updated',
            jid: 'tg:123456789',
            trigger: '@NewAgent'
        });

        expect(mockFetch).toHaveBeenCalledWith('http://localhost:3000/api/agents/1', {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer test-token'
            },
            body: JSON.stringify({
                jid: 'tg:123456789',
                name: 'Updated',
                trigger: '@NewAgent'
            })
        });
    });

    it('should update agent with claw-pilot format (translates workspace)', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({ id: '1', name: 'Updated', folder: 'claw_staging' })
        } as Response);

        await client.updateAgent('1', {
            name: 'Updated',
            workspace: 'staging',
            capabilities: ['shell', 'fs']
        });

        expect(mockFetch).toHaveBeenCalledWith('http://localhost:3000/api/agents/1', {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer test-token'
            },
            body: JSON.stringify({
                name: 'Updated',
                folder: 'claw_staging',
                trigger: '@shell-fs'
            })
        });
    });
});

// ---------------------------------------------------------------------------
// NanoClawChannelClient tests
// ---------------------------------------------------------------------------

describe('NanoClawChannelClient', () => {
    let channelClient: NanoClawChannelClient;

    beforeEach(() => {
        mockState.state.lastMockWs = null;
        channelClient = new NanoClawChannelClient('ws://localhost:8081', 'test-token');
    });

    afterEach(() => {
        channelClient.close();
        vi.clearAllTimers();
    });

    it('connects to the correct URL with session and token', async () => {
        const { default: WS } = await import('ws');

        const promise = channelClient.sendTask('session-1', 'hello');

        // Wait for open event to fire
        await new Promise(r => setTimeout(r, 10));

        expect(WS).toHaveBeenCalledWith(
            'ws://localhost:8081?session=session-1&token=test-token'
        );

        // Resolve the pending task
        mockState.state.lastMockWs!._triggerMessage({ status: 'done', response: 'ok' });
        await promise;
    });

    it('resolves with done response when agent finishes', async () => {
        const promise = channelClient.sendTask('session-done', 'do work');

        await new Promise(r => setTimeout(r, 10));
        mockState.state.lastMockWs!._triggerMessage({ status: 'done', response: 'task complete' });

        const result = await promise;
        expect(result).toEqual({ status: 'done', response: 'task complete' });
    });

    it('resolves with error response when agent responds with error status', async () => {
        const promise = channelClient.sendTask('session-err', 'bad task');

        await new Promise(r => setTimeout(r, 10));
        mockState.state.lastMockWs!._triggerMessage({ status: 'error', error: 'something went wrong' });

        const result = await promise;
        expect(result).toEqual({ status: 'error', error: 'something went wrong' });
    });

    it('calls onStream for stream chunks before done', async () => {
        const chunks: string[] = [];
        const promise = channelClient.sendTask('session-stream', 'stream me', 5000, (chunk) => {
            chunks.push(chunk);
        });

        await new Promise(r => setTimeout(r, 10));

        mockState.state.lastMockWs!._triggerMessage({ status: 'stream', chunk: 'chunk1' });
        mockState.state.lastMockWs!._triggerMessage({ status: 'stream', chunk: 'chunk2' });
        mockState.state.lastMockWs!._triggerMessage({ status: 'done', response: 'final' });

        await promise;
        expect(chunks).toEqual(['chunk1', 'chunk2']);
    });

    it('sends the task JSON over the websocket', async () => {
        const promise = channelClient.sendTask('session-send', 'my task');

        await new Promise(r => setTimeout(r, 10));

        expect(mockState.state.lastMockWs!.sent).toHaveLength(1);
        expect(JSON.parse(mockState.state.lastMockWs!.sent[0])).toEqual({
            task: 'my task',
            sessionId: 'session-send',
        });

        mockState.state.lastMockWs!._triggerMessage({ status: 'done', response: 'ok' });
        await promise;
    });

    it('rejects when the WebSocket closes before a response', async () => {
        const promise = channelClient.sendTask('session-close', 'task');

        await new Promise(r => setTimeout(r, 10));
        mockState.state.lastMockWs!.close();

        await expect(promise).rejects.toThrow("WebSocket closed for session 'session-close'");
    });

    it('rejects when a WebSocket error occurs', async () => {
        const promise = channelClient.sendTask('session-wserr', 'task');

        await new Promise(r => setTimeout(r, 10));
        mockState.state.lastMockWs!._emit('error', new Error('tcp reset'));

        await expect(promise).rejects.toThrow('tcp reset');
    });

    it('rejects immediately when a duplicate sendTask on the same session is started', async () => {
        const promise1 = channelClient.sendTask('session-dup', 'first');
        await new Promise(r => setTimeout(r, 10));

        await expect(
            channelClient.sendTask('session-dup', 'second')
        ).rejects.toThrow("Session 'session-dup' already has a pending request");

        // Clean up first promise
        mockState.state.lastMockWs!._triggerMessage({ status: 'done', response: 'ok' });
        await promise1;
    });

    it('rejects all pending tasks and closes connections on close()', async () => {
        const promise = channelClient.sendTask('session-shutdown', 'task');

        await new Promise(r => setTimeout(r, 10));

        channelClient.close();

        // When close() calls ws.close(), the WS 'close' event fires synchronously
        // before the close() cleanup loop runs. The pending promise is therefore
        // rejected by the WS close handler with the session message.
        await expect(promise).rejects.toThrow("session 'session-shutdown'");
    });

    it('works without a token — omits token from URL', async () => {
        const { default: WS } = await import('ws');
        const noTokenClient = new NanoClawChannelClient('ws://localhost:8081');

        const promise = noTokenClient.sendTask('session-noauth', 'task');
        await new Promise(r => setTimeout(r, 10));

        expect(WS).toHaveBeenLastCalledWith(
            'ws://localhost:8081?session=session-noauth'
        );

        mockState.state.lastMockWs!._triggerMessage({ status: 'done', response: 'ok' });
        await promise;
        noTokenClient.close();
    });
});
