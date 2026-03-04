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
            json: async () => ([{ id: '1', name: 'Agent 1' }])
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

        expect(agents).toEqual([{ id: '1', name: 'Agent 1' }]);
    });

    it('should handle successful POST requests with bodies', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            status: 201,
            json: async () => ({ id: '2', name: 'New Agent' })
        } as Response);

        const newAgent = await client.createAgent({ name: 'New Agent' });

        expect(mockFetch).toHaveBeenCalledWith('http://localhost:3000/api/agents', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer test-token'
            },
            body: JSON.stringify({ name: 'New Agent' })
        });

        expect(newAgent).toEqual({ id: '2', name: 'New Agent' });
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
});
