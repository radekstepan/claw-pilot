import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NanoClawBackend } from './api.js';
import { GatewayOfflineError, GatewayPairingRequiredError } from '../../errors.js';

// We must declare the mock instance outside so vi.mock can capture it.
// To avoid "Cannot access 'mockClientInstance' before initialization", we use vi.hoisted
const mockClientInstance = vi.hoisted(() => ({
    getAgents: vi.fn(),
    getSessions: vi.fn(),
    sendMessage: vi.fn(),
    spawnTask: vi.fn(),
    generateConfig: vi.fn(),
    createAgent: vi.fn(),
    updateAgent: vi.fn(),
    deleteAgent: vi.fn(),
    getAgentFile: vi.fn(),
    setAgentFile: vi.fn(),
    getModels: vi.fn(),
}));

// Mock the env configuration
vi.mock('../../../config/env.js', () => ({
    env: {
        GATEWAY_URL: 'http://localhost:8080',
        GATEWAY_TOKEN: 'test-token',
    },
}));

// Mock the NanoClawClient
vi.mock('@claw-pilot/nanoclaw-gateway', () => {
    return {
        NanoClawClient: vi.fn(() => mockClientInstance),
    };
});

describe('NanoClawBackend Adapter', () => {
    let backend: NanoClawBackend;

    beforeEach(() => {
        vi.clearAllMocks();
        backend = new NanoClawBackend();
    });

    it('should map getAgents() response correctly', async () => {
        mockClientInstance.getAgents.mockResolvedValueOnce([
            { id: '1', name: 'Agent Smith', capabilities: ['chat'], model: 'gpt-4', role: 'dev', workspace: 'w1' }
        ]);

        const agents = await backend.getAgents();

        expect(mockClientInstance.getAgents).toHaveBeenCalled();
        expect(agents).toEqual([
            {
                id: '1',
                name: 'Agent Smith',
                status: 'OFFLINE',
                capabilities: ['chat'],
                model: 'gpt-4',
                role: 'dev',
                workspace: 'w1',
            }
        ]);
    });

    it('should map getLiveSessions() correctly', async () => {
        mockClientInstance.getSessions.mockResolvedValueOnce([
            { id: 'sess123', agentId: 'agent1', status: 'WORKING' }
        ]);

        const sessions = await backend.getLiveSessions();

        expect(mockClientInstance.getSessions).toHaveBeenCalled();
        expect(sessions).toEqual([
            {
                key: 'sess123',
                agent: 'agent1',
                agentId: 'agent1',
                status: 'WORKING',
            }
        ]);
    });

    it('should construct session key correctly', () => {
        const key = backend.agentIdToSessionKey('agent-xyz');
        expect(key).toBe('nanoclaw:agent-xyz');
    });

    it('should handle NetworkError by throwing GatewayOfflineError', async () => {
        const error = new Error('fetch failed');
        error.name = 'NetworkError';
        mockClientInstance.getModels.mockRejectedValueOnce(error);

        await expect(backend.getModels()).rejects.toThrow(GatewayOfflineError);
    });

    it('should handle 401 errors by throwing GatewayPairingRequiredError', async () => {
        const error = new Error('NanoClaw API error (401): Unauthorized');
        mockClientInstance.getAgents.mockRejectedValueOnce(error);

        await expect(backend.getAgents()).rejects.toThrow(GatewayPairingRequiredError);
    });

    it('should return empty string when getAgentFile fails', async () => {
        mockClientInstance.getAgentFile.mockRejectedValueOnce(new Error('File not found'));

        const content = await backend.getAgentFile('agent1', 'SOUL.md');

        expect(mockClientInstance.getAgentFile).toHaveBeenCalledWith('agent1', 'SOUL.md');
        expect(content).toBe('');
    });

    it('should batch getAgentWorkspaceFiles requests', async () => {
        mockClientInstance.getAgentFile.mockResolvedValueOnce({ content: 'soul-content' });
        mockClientInstance.getAgentFile.mockResolvedValueOnce({ content: 'tools-content' });
        mockClientInstance.getAgentFile.mockResolvedValueOnce({ content: 'agents-content' });

        const files = await backend.getAgentWorkspaceFiles('agent1');

        expect(mockClientInstance.getAgentFile).toHaveBeenCalledTimes(3);
        expect(files).toEqual({
            soul: 'soul-content',
            tools: 'tools-content',
            agentsMd: 'agents-content',
        });
    });

    it('should batch setAgentFiles updates', async () => {
        mockClientInstance.setAgentFile.mockResolvedValue({});

        await backend.setAgentFiles('agent1', { soul: 'new-soul', tools: 'new-tools' });

        expect(mockClientInstance.setAgentFile).toHaveBeenCalledTimes(2);
        expect(mockClientInstance.setAgentFile).toHaveBeenCalledWith('agent1', 'SOUL.md', 'new-soul');
        expect(mockClientInstance.setAgentFile).toHaveBeenCalledWith('agent1', 'TOOLS.md', 'new-tools');
    });

    it('should return sessions on rawCall sessions.list', async () => {
        mockClientInstance.getSessions.mockResolvedValueOnce([{ id: 'sess' }]);
        const res = await backend.rawCall('sessions.list', {});
        expect(res).toEqual([{ id: 'sess' }]);
    });
});
