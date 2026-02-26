import { create } from 'zustand';
import { toast } from 'sonner';
import type { Task, Agent, ActivityLog, ChatMessage, TaskStatus, CreateTaskPayload, RecurringTask, CreateRecurringPayload } from '@claw-pilot/shared-types';
import { api } from '../api/client';

interface MissionState {
    tasks: Task[];
    agents: Agent[];
    activities: ActivityLog[];
    chatHistory: ChatMessage[];
    recurringTasks: RecurringTask[];
    isLoading: boolean;
    error: string | null;
    isSocketConnected: boolean;
    /** null = not yet known (first tick pending), true = reachable, false = offline */
    gatewayOnline: boolean | null;
    /** True when the gateway has received our device identity but pairing approval is still pending. */
    gatewayPairingRequired: boolean;
    /** Stable device ID presented to the gateway — shown in pairing instructions. */
    gatewayDeviceId: string | null;
    /** Cursor for the next page of activities (null = no more pages). */
    activitiesCursor: string | null;
    /** Cursor for the next page of chat history (null = no more pages). */
    chatCursor: string | null;
    /** IDs of tasks whose status PATCH is currently in-flight (optimistic update pending confirmation). */
    updatingTaskIds: Set<string>;
    /** Agent IDs for which claw-pilot currently has an in-flight AI gateway request.
     * This gives sub-second "thinking" feedback independent of the 10s sessionMonitor poll. */
    busyAgentIds: Set<string>;
    /** Timestamp of the last successful full fetch or sync, for delta syncs. */
    lastSyncAt: string | null;

    fetchInitialData: () => Promise<void>;
    syncData: (since: string) => Promise<void>;
    updateTaskLocally: (task: Task) => void;
    addTaskLocally: (task: Task) => void;
    deleteTaskLocally: (taskId: string) => void;
    updateTaskStatus: (taskId: string, status: TaskStatus) => Promise<void>;
    updateTask: (taskId: string, patch: Partial<Task>) => Promise<void>;
    deleteTask: (taskId: string) => Promise<void>;
    toggleDeliverable: (deliverableId: string, parentTaskId: string) => Promise<void>;
    createTask: (payload: CreateTaskPayload) => Promise<void>;
    addChatMessage: (msg: ChatMessage) => void;
    clearChatHistory: () => Promise<void>;
    setSocketConnected: (connected: boolean) => void;
    setGatewayOnline: (online: boolean) => void;
    setGatewayPairing: (required: boolean, deviceId?: string) => void;
    loadMoreActivities: () => Promise<void>;
    loadMoreChat: () => Promise<void>;
    routeTask: (taskId: string, agentId: string, prompt?: string) => Promise<void>;
    setBusyAgent: (agentId: string, busy: boolean) => void;
    // Recurring
    fetchRecurring: () => Promise<void>;
    createRecurring: (payload: CreateRecurringPayload) => Promise<void>;
    deleteRecurring: (id: string) => Promise<void>;
    updateRecurring: (id: string, patch: Partial<RecurringTask>) => Promise<void>;
    triggerRecurring: (id: string) => Promise<void>;
}

export const useMissionStore = create<MissionState>((set, get) => ({
    tasks: [],
    agents: [],
    activities: [],
    chatHistory: [],
    recurringTasks: [],
    isLoading: false,
    error: null,
    isSocketConnected: false,
    gatewayOnline: null,
    gatewayPairingRequired: false,
    gatewayDeviceId: null,
    activitiesCursor: null,
    chatCursor: null,
    updatingTaskIds: new Set<string>(),
    busyAgentIds: new Set<string>(),
    lastSyncAt: null,

    fetchInitialData: async () => {
        set({ isLoading: true, error: null });
        try {
            const [tasksPage, agents, activitiesPage, chatPage] = await Promise.all([
                api.getTasks(),
                api.getAgents(),
                api.getActivities(),
                api.getChatHistory(),
            ]);
            set({
                tasks: tasksPage.data,
                agents,
                activities: activitiesPage.data,
                activitiesCursor: activitiesPage.nextCursor,
                chatHistory: chatPage.data.slice().reverse(), // oldest first for display
                chatCursor: chatPage.nextCursor,
                isLoading: false,
                lastSyncAt: new Date().toISOString(),
            });
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : 'Failed to fetch data';
            set({ error: msg, isLoading: false });
            toast.error(msg);
        }
    },

    syncData: async (since: string) => {
        try {
            const [syncPayload, agents] = await Promise.all([
                api.sync(since),
                api.getAgents(),
            ]);

            set((state) => {
                // Merge tasks
                const taskMap = new Map(state.tasks.map(t => [t.id, t]));
                for (const t of syncPayload.tasks) taskMap.set(t.id, t);
                const activeSet = new Set(syncPayload.activeTaskIds);
                const nextTasks = Array.from(taskMap.values()).filter(t => activeSet.has(t.id));

                // Merge recurring tasks
                const recMap = new Map(state.recurringTasks.map(t => [t.id, t]));
                for (const t of syncPayload.recurringTasks) recMap.set(t.id, t);
                const nextRecurring = Array.from(recMap.values());

                // Merge activities (prevent dupes, keep descending order)
                const actMap = new Map(state.activities.map(a => [a.id, a]));
                for (const a of syncPayload.activities) actMap.set(a.id, a);
                const nextActivities = Array.from(actMap.values())
                    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

                // Merge chat (prevent dupes, keep ascending order)
                const chatMap = new Map(state.chatHistory.map(c => [c.id, c]));
                for (const c of syncPayload.chatHistory) chatMap.set(c.id, c);
                const nextChat = Array.from(chatMap.values())
                    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

                return {
                    tasks: nextTasks.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()),
                    recurringTasks: nextRecurring,
                    activities: nextActivities,
                    chatHistory: nextChat,
                    agents,
                    lastSyncAt: new Date().toISOString(),
                };
            });
        } catch (error: unknown) {
            console.error('Delta sync failed, falling back to full fetch', error);
            // Fallback to full fetch if sync fails
            get().fetchInitialData();
        }
    },

    updateTaskLocally: (updatedTask: Task) => {
        set((state) => ({
            tasks: state.tasks.map((t) => (t.id === updatedTask.id ? updatedTask : t)),
        }));
    },

    addTaskLocally: (newTask: Task) => {
        set((state) => {
            // Guard against duplicates (e.g., the creator's own createTask already added it)
            if (state.tasks.some((t) => t.id === newTask.id)) return {};
            return { tasks: [newTask, ...state.tasks] };
        });
    },

    deleteTaskLocally: (taskId: string) => {
        set((state) => ({ tasks: state.tasks.filter((t) => t.id !== taskId) }));
    },

    updateTaskStatus: async (taskId: string, status: TaskStatus) => {
        const { tasks, updateTaskLocally } = get();
        const taskToUpdate = tasks.find(t => t.id === taskId);

        if (!taskToUpdate) return;

        // Mark in-flight
        set((s) => ({ updatingTaskIds: new Set(s.updatingTaskIds).add(taskId) }));

        // 1. Optimistic UI update
        const optimisticTask: Task = { ...taskToUpdate, status };
        updateTaskLocally(optimisticTask);

        const clearUpdating = () =>
            set((s) => { const next = new Set(s.updatingTaskIds); next.delete(taskId); return { updatingTaskIds: next }; });

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
        } finally {
            clearUpdating();
        }
    },

    updateTask: async (taskId: string, patch: Partial<Task>) => {
        const { tasks, updateTaskLocally } = get();
        const snapshot = tasks.find(t => t.id === taskId);
        if (!snapshot) return;
        // Optimistic update
        updateTaskLocally({ ...snapshot, ...patch });
        try {
            const updated = await api.updateTask(taskId, patch);
            updateTaskLocally(updated);
        } catch (error: unknown) {
            updateTaskLocally(snapshot);
            toast.error(error instanceof Error ? error.message : 'Failed to update task. Changes reverted.');
            throw error;
        }
    },

    deleteTask: async (taskId: string) => {
        const { tasks, deleteTaskLocally } = get();
        const snapshot = [...tasks];
        deleteTaskLocally(taskId);
        try {
            await api.deleteTask(taskId);
            toast.success('Task deleted.');
        } catch (error: unknown) {
            set({ tasks: snapshot });
            toast.error(error instanceof Error ? error.message : 'Failed to delete task. Changes reverted.');
            throw error;
        }
    },

    toggleDeliverable: async (deliverableId: string, parentTaskId: string) => {
        const { tasks, updateTaskLocally } = get();
        const task = tasks.find(t => t.id === parentTaskId);
        if (!task) return;
        // Optimistic toggle
        const optimisticTask: Task = {
            ...task,
            deliverables: task.deliverables?.map(d =>
                d.id === deliverableId
                    ? { ...d, status: d.status === 'COMPLETED' ? 'PENDING' : 'COMPLETED' }
                    : d
            ),
        };
        updateTaskLocally(optimisticTask);
        try {
            const updatedTask = await api.toggleDeliverable(deliverableId);
            updateTaskLocally(updatedTask);
        } catch (error: unknown) {
            updateTaskLocally(task);
            toast.error(error instanceof Error ? error.message : 'Failed to update deliverable. Changes reverted.');
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

    clearChatHistory: async () => {
        try {
            await api.clearChatHistory();
            // Optimistic: clear local state immediately (the socket event will
            // also clear other connected clients)
            set({ chatHistory: [], chatCursor: null });
            toast.success('Chat history cleared.');
        } catch (error: unknown) {
            toast.error(error instanceof Error ? error.message : 'Failed to clear chat history.');
        }
    },

    setSocketConnected: (connected: boolean) => set({ isSocketConnected: connected }),
    setGatewayOnline: (online: boolean) => set({ gatewayOnline: online }),
    setGatewayPairing: (required: boolean, deviceId?: string) => {
        if (required) {
            set({ gatewayPairingRequired: true, gatewayDeviceId: deviceId ?? null, gatewayOnline: false });
        } else {
            set({ gatewayPairingRequired: false, gatewayDeviceId: null });
        }
    },

    loadMoreActivities: async () => {
        const { activitiesCursor } = get();
        if (activitiesCursor === null) return; // already at end
        try {
            const page = await api.getActivities(activitiesCursor);
            set((state) => ({
                activities: [...state.activities, ...page.data],
                activitiesCursor: page.nextCursor,
            }));
        } catch (error: unknown) {
            toast.error(error instanceof Error ? error.message : 'Failed to load more activity.');
        }
    },

    loadMoreChat: async () => {
        const { chatCursor } = get();
        if (chatCursor === null) return; // already at end
        try {
            const page = await api.getChatHistory(chatCursor);
            // Prepend older messages in chronological order before existing history
            set((state) => ({
                chatHistory: [...page.data.slice().reverse(), ...state.chatHistory],
                chatCursor: page.nextCursor,
            }));
        } catch (error: unknown) {
            toast.error(error instanceof Error ? error.message : 'Failed to load more chat history.');
        }
    },

    routeTask: async (taskId: string, agentId: string, prompt?: string) => {
        const { tasks, updateTaskLocally } = get();
        const snapshot = tasks.find(t => t.id === taskId);
        if (!snapshot) return;
        // Mark in-flight
        set((s) => ({ updatingTaskIds: new Set(s.updatingTaskIds).add(taskId) }));
        const clearUpdating = () =>
            set((s) => { const next = new Set(s.updatingTaskIds); next.delete(taskId); return { updatingTaskIds: next }; });
        // Optimistic update: mark as ASSIGNED with the chosen agent
        updateTaskLocally({ ...snapshot, agentId, status: 'ASSIGNED' });
        try {
            await api.routeTask(taskId, agentId, prompt);
            toast.success('Task dispatched to agent.');
        } catch (error: unknown) {
            updateTaskLocally(snapshot);
            toast.error(error instanceof Error ? error.message : 'Failed to route task. Changes reverted.');
            throw error;
        } finally {
            clearUpdating();
        }
    },

    setBusyAgent: (agentId: string, busy: boolean) => {
        set((s) => {
            const next = new Set(s.busyAgentIds);
            if (busy) next.add(agentId);
            else next.delete(agentId);
            return { busyAgentIds: next };
        });
    },

    // Recurring
    fetchRecurring: async () => {
        try {
            const recurringTasks = await api.getRecurring();
            set({ recurringTasks });
        } catch (error: unknown) {
            toast.error(error instanceof Error ? error.message : 'Failed to fetch scheduled missions.');
        }
    },

    createRecurring: async (payload: CreateRecurringPayload) => {
        try {
            const newTask = await api.createRecurring(payload);
            set((state) => ({ recurringTasks: [newTask, ...state.recurringTasks] }));
            toast.success('Scheduled mission created.');
        } catch (error: unknown) {
            toast.error(error instanceof Error ? error.message : 'Failed to create scheduled mission.');
            throw error;
        }
    },

    deleteRecurring: async (id: string) => {
        const { recurringTasks } = get();
        const snapshot = [...recurringTasks];
        set((state) => ({ recurringTasks: state.recurringTasks.filter(t => t.id !== id) }));
        try {
            await api.deleteRecurring(id);
        } catch (error: unknown) {
            set({ recurringTasks: snapshot });
            toast.error(error instanceof Error ? error.message : 'Failed to delete scheduled mission.');
        }
    },

    updateRecurring: async (id: string, patch: Partial<RecurringTask>) => {
        try {
            const updated = await api.updateRecurring(id, patch);
            set((state) => ({
                recurringTasks: state.recurringTasks.map(t => t.id === id ? updated : t)
            }));
        } catch (error: unknown) {
            toast.error(error instanceof Error ? error.message : 'Failed to update scheduled mission.');
        }
    },

    triggerRecurring: async (id: string) => {
        try {
            const newTask = await api.triggerRecurring(id);
            set((state) => ({ tasks: [newTask, ...state.tasks] }));
            toast.success('Mission triggered — task added to board.');
        } catch (error: unknown) {
            toast.error(error instanceof Error ? error.message : 'Failed to trigger scheduled mission.');
        }
    },
}));

