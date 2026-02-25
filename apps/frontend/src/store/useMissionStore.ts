import { create } from 'zustand';
import { toast } from 'sonner';
import type { Task, Agent, ActivityLog, ChatMessage, TaskStatus, CreateTaskPayload } from '@claw-pilot/shared-types';
import { api } from '../api/client';

interface MissionState {
    tasks: Task[];
    agents: Agent[];
    activities: ActivityLog[];
    chatHistory: ChatMessage[];
    isLoading: boolean;
    error: string | null;
    isSocketConnected: boolean;

    fetchInitialData: () => Promise<void>;
    updateTaskLocally: (task: Task) => void;
    updateTaskStatus: (taskId: string, status: TaskStatus) => Promise<void>;
    createTask: (payload: CreateTaskPayload) => Promise<void>;
    addChatMessage: (msg: ChatMessage) => void;
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
            const [tasks, agents, activities] = await Promise.all([
                api.getTasks(),
                api.getAgents(),
                api.getActivities().catch(() => []) // Fallback in case endpoint is not fully ready
            ]);
            set({ tasks, agents, activities, isLoading: false });
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : 'Failed to fetch data';
            set({ error: msg, isLoading: false });
            toast.error(msg);
        }
    },

    updateTaskLocally: (updatedTask: Task) => {
        set((state) => ({
            tasks: state.tasks.map((t) => (t.id === updatedTask.id ? updatedTask : t)),
        }));
    },

    updateTaskStatus: async (taskId: string, status: TaskStatus) => {
        const { tasks, updateTaskLocally } = get();
        const taskToUpdate = tasks.find(t => t.id === taskId);

        if (!taskToUpdate) return;

        // 1. Optimistic UI update
        const optimisticTask: Task = { ...taskToUpdate, status };
        updateTaskLocally(optimisticTask);

        try {
            // 2. Fire the API call
            const updatedTask = await api.updateTaskStatus(taskId, status);
            // 3. Confirm with the backend response
            updateTaskLocally(updatedTask);
        } catch (error: unknown) {
            // Revert back to original on failure
            updateTaskLocally(taskToUpdate);
            const isReviewGate =
                error instanceof Error && error.message.includes('403');
            if (isReviewGate) {
                toast.error('Review gate: only a human lead can mark a task as DONE.', {
                    duration: 5000,
                });
            } else {
                toast.error(
                    error instanceof Error ? error.message : 'Failed to update task. Changes reverted.'
                );
            }
        }
    },

    createTask: async (payload: CreateTaskPayload) => {
        try {
            const newTask = await api.createTask(payload);
            set((state) => ({ tasks: [newTask, ...state.tasks] }));
            toast.success('Task created successfully.');
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : 'Failed to create task.';
            toast.error(msg);
            throw error;
        }
    },

    addChatMessage: (msg: ChatMessage) => {
        set((state) => ({
            chatHistory: [...state.chatHistory, msg],
        }));
    },
    setSocketConnected: (connected: boolean) => set({ isSocketConnected: connected })
}));
