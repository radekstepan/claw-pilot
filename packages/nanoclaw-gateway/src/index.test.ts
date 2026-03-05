import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NanoClawClient } from './index';

// Mock the global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('NanoClawClient', () => {
    let client: NanoClawClient;

    beforeEach(() => {
        vi.resetAllMocks();
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
