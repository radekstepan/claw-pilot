import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Task } from '@claw-pilot/shared-types';

// Mock the api module before importing the store so the store picks up the mocks
vi.mock('../api/client', () => ({
    api: {
        getTasks: vi.fn().mockResolvedValue([]),
        createTask: vi.fn(),
        updateTaskStatus: vi.fn(),
        sendChatMessageToAgent: vi.fn(),
        getAgents: vi.fn().mockResolvedValue([]),
        generateAgent: vi.fn(),
        getActivities: vi.fn().mockResolvedValue([]),
        getModels: vi.fn(),
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
            chatHistory: [],
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
