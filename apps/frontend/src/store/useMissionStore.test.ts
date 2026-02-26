import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Agent, Task } from '@claw-pilot/shared-types';

// Mock the api module before importing the store so the store picks up the mocks
vi.mock('../api/client', () => ({
    api: {
        getTasks:      vi.fn().mockResolvedValue({ data: [], total: 0, limit: 200, offset: 0 }),
        createTask:    vi.fn(),
        updateTaskStatus: vi.fn(),
        getAgents:     vi.fn().mockResolvedValue([]),
        generateAgent: vi.fn(),
        getActivities: vi.fn().mockResolvedValue({ data: [], nextCursor: null }),
        getAgentFiles: vi.fn().mockResolvedValue({ soul: '', tools: '', agentsMd: '' }),
        getModels:     vi.fn().mockResolvedValue([]),
        getGatewayStatus: vi.fn(),
    },
}));

// Import AFTER mocking
import { useMissionStore } from './useMissionStore';
import { api } from '../api/client';

const INITIAL_TASK: Task = {
    id: 'TASK-001',
    title: 'Test task',
    status: 'TODO',
    priority: 'MEDIUM',
};

describe('useMissionStore — updateTaskStatus', () => {
    beforeEach(() => {
        // Reset store state before each test
        useMissionStore.setState({
            tasks: [INITIAL_TASK],
            agents: [],
            activities: [],
            isLoading: false,
            error: null,
            isSocketConnected: false,
        });
        vi.clearAllMocks();
    });

    it('applies an optimistic status update immediately before the API resolves', async () => {
        // Arrange: return a deferred promise so we can inspect state before it settles
        let resolveApi!: (task: Task) => void;
        vi.mocked(api.updateTaskStatus).mockReturnValue(
            new Promise<Task>((res) => { resolveApi = res; })
        );

        // Act: start the transition without awaiting
        const pending = useMissionStore.getState().updateTaskStatus('TASK-001', 'IN_PROGRESS');

        // Assert: state is already updated optimistically
        expect(useMissionStore.getState().tasks[0].status).toBe('IN_PROGRESS');

        // Settle the API response
        resolveApi({ ...INITIAL_TASK, status: 'IN_PROGRESS' });
        await pending;

        // Assert: state still shows confirmed value
        expect(useMissionStore.getState().tasks[0].status).toBe('IN_PROGRESS');
    });

    it('reverts the task status when the API call fails', async () => {
        // Arrange: API will reject
        vi.mocked(api.updateTaskStatus).mockRejectedValue(new Error('Network error'));

        // Act: perform the update and wait for it to complete
        await useMissionStore.getState().updateTaskStatus('TASK-001', 'IN_PROGRESS');

        // Assert: status has been rolled back to the original
        expect(useMissionStore.getState().tasks[0].status).toBe('TODO');
    });

    it('leaves other tasks unaffected during an update', async () => {
        const secondTask: Task = { id: 'TASK-002', title: 'Other task', status: 'ASSIGNED' };
        useMissionStore.setState({ tasks: [INITIAL_TASK, secondTask] });

        vi.mocked(api.updateTaskStatus).mockRejectedValue(new Error('fail'));

        await useMissionStore.getState().updateTaskStatus('TASK-001', 'IN_PROGRESS');

        // Second task should be untouched
        const tasks = useMissionStore.getState().tasks;
        expect(tasks.find(t => t.id === 'TASK-002')?.status).toBe('ASSIGNED');
    });
});

// ---------------------------------------------------------------------------
// Agent store actions
// ---------------------------------------------------------------------------
const AGENT_ARCHITECT: Agent = {
    id: 'architect',
    name: 'Architect',
    status: 'IDLE',
    model: 'claude-sonnet-4',
    capabilities: ['planning', 'review'],
};

const AGENT_DEVELOPER: Agent = {
    id: 'developer',
    name: 'Developer',
    status: 'WORKING',
    model: 'claude-sonnet-4',
    capabilities: ['coding', 'testing'],
};

describe('useMissionStore — agents', () => {
    beforeEach(() => {
        useMissionStore.setState({
            tasks: [],
            agents: [],
            activities: [],
            isLoading: false,
            error: null,
            isSocketConnected: false,
        });
        vi.clearAllMocks();
    });

    it('fetchInitialData populates agents from getAgents response', async () => {
        vi.mocked(api.getAgents).mockResolvedValue([AGENT_ARCHITECT, AGENT_DEVELOPER]);

        await useMissionStore.getState().fetchInitialData();

        const agents = useMissionStore.getState().agents;
        expect(agents).toHaveLength(2);
        expect(agents.find(a => a.id === 'architect')?.model).toBe('claude-sonnet-4');
        expect(agents.find(a => a.id === 'developer')?.status).toBe('WORKING');
    });

    it('fetchInitialData preserves model and capabilities fields', async () => {
        vi.mocked(api.getAgents).mockResolvedValue([AGENT_ARCHITECT]);

        await useMissionStore.getState().fetchInitialData();

        const agent = useMissionStore.getState().agents[0];
        expect(agent.capabilities).toEqual(['planning', 'review']);
        expect(agent.model).toBe('claude-sonnet-4');
    });

    it('refreshAgents replaces the agents array in the store', async () => {
        // Seed with stale data
        useMissionStore.setState({ agents: [AGENT_ARCHITECT] });

        const updated: Agent = { ...AGENT_ARCHITECT, name: 'Renamed Architect', status: 'OFFLINE' };
        vi.mocked(api.getAgents).mockResolvedValue([updated, AGENT_DEVELOPER]);

        await useMissionStore.getState().refreshAgents();

        const agents = useMissionStore.getState().agents;
        expect(agents).toHaveLength(2);
        expect(agents.find(a => a.id === 'architect')?.name).toBe('Renamed Architect');
        expect(agents.find(a => a.id === 'developer')?.status).toBe('WORKING');
    });

    it('refreshAgents does not throw when getAgents fails — store remains unchanged', async () => {
        useMissionStore.setState({ agents: [AGENT_ARCHITECT] });
        vi.mocked(api.getAgents).mockRejectedValue(new Error('gateway offline'));

        // Should not throw
        await expect(useMissionStore.getState().refreshAgents()).resolves.toBeUndefined();

        // Store is unchanged
        expect(useMissionStore.getState().agents).toHaveLength(1);
    });
});
