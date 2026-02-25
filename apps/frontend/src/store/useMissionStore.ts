import { create } from 'zustand';
import type { Task, Agent, ActivityLog } from '@claw-pilot/shared-types';
import { api } from '../api/client';

interface MissionState {
    tasks: Task[];
    agents: Agent[];
    activities: ActivityLog[];
    chatHistory: any[];
    isLoading: boolean;
    error: string | null;
    isSocketConnected: boolean;

    fetchInitialData: () => Promise<void>;
    updateTaskLocally: (task: Task) => void;
    updateTaskStatus: (taskId: string, status: string) => Promise<void>;
    addChatMessage: (msg: any) => void;
    setSocketConnected: (connected: boolean) => void;
}

export const useMissionStore = create<MissionState>((set, get) => ({
    tasks: [],
    agents: [],
    activities: [],
    chatHistory: [],
    isLoading: false,
    error: null,
    isSocketConnected: false,

    fetchInitialData: async () => {
        set({ isLoading: true, error: null });
        try {
            const [tasks, agents] = await Promise.all([
                api.getTasks(),
                api.getAgents(),
                // activities will be added later if the endpoint exists, let's keep it simple for now
            ]);
            set({ tasks, agents, isLoading: false });
        } catch (error: any) {
            set({ error: error.message || 'Failed to fetch data', isLoading: false });
        }
    },

    updateTaskLocally: (updatedTask: Task) => {
        set((state) => ({
            tasks: state.tasks.map((t) => (t.id === updatedTask.id ? updatedTask : t)),
        }));
    },

    updateTaskStatus: async (taskId: string, status: string) => {
        const { tasks, updateTaskLocally } = get();
        const taskToUpdate = tasks.find(t => t.id === taskId);

        if (!taskToUpdate) return;

        // 1. Optimistic UI update
        // We cast as any because our shared-types Task status is an enum, and the UI might pass string.
        // The enum in shared types allows: ['BACKLOG', 'TODO', 'ASSIGNED', 'IN_PROGRESS', 'REVIEW', 'DONE', 'STUCK']
        const optimisticTask = { ...taskToUpdate, status: status as any };
        updateTaskLocally(optimisticTask);

        try {
            // 2. Fire the API call
            const updatedTask = await api.updateTaskStatus(taskId, status);
            // 3. Confirm with the backend response
            updateTaskLocally(updatedTask);
        } catch (error) {
            console.error('Failed to update task status:', error);
            // Revert back to original on failure
            updateTaskLocally(taskToUpdate);
        }
    },

    addChatMessage: (msg: any) => {
        set((state) => ({
            chatHistory: [...(state as any).chatHistory, msg],
        }));
    },
    setSocketConnected: (connected: boolean) => set({ isSocketConnected: connected })
}));
