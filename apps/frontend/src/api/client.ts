import axios from 'axios';
import type { Task, Agent, ActivityLog, CreateTaskPayload, TaskStatus, RecurringTask, CreateRecurringPayload, AppConfig, CursorPageResponse, OffsetPageResponse } from '@claw-pilot/shared-types';
import { env } from '../config/env.js';

// Types for backend API responses not covered by shared-types
export interface Model {
    id: string;
    name: string;
    provider?: string;
}

export interface GatewayStatus {
    status: 'ONLINE' | 'OFFLINE' | 'PAIRING_REQUIRED';
    error?: string;
    /** Present when status is PAIRING_REQUIRED */
    deviceId?: string;
    /** Human-readable approval instructions */
    instructions?: string;
}

export interface GeneratedAgentConfig {
    name?: string;
    capabilities?: string[];
    [key: string]: unknown;
}

const API_BASE_URL = `${env.VITE_API_URL}/api`;

const apiClient = axios.create({
    baseURL: API_BASE_URL,
    headers: {
        'Content-Type': 'application/json',
        // Bearer token must match API_KEY configured in apps/backend/.env
        'Authorization': `Bearer ${env.VITE_API_KEY}`,
    },
});

export const api = {
    // Tasks
    getTasks: async (limit = 200, offset = 0): Promise<OffsetPageResponse<Task>> => {
        const response = await apiClient.get('/tasks', { params: { limit, offset } });
        return response.data;
    },
    createTask: async (payload: CreateTaskPayload): Promise<Task> => {
        const response = await apiClient.post('/tasks', payload);
        return response.data;
    },
    updateTask: async (taskId: string, patch: Partial<Task>): Promise<Task> => {
        const response = await apiClient.patch(`/tasks/${taskId}`, patch);
        return response.data;
    },
    updateTaskStatus: async (taskId: string, status: TaskStatus): Promise<Task> => {
        const response = await apiClient.patch(`/tasks/${taskId}`, { status });
        return response.data;
    },
    deleteTask: async (taskId: string): Promise<void> => {
        await apiClient.delete(`/tasks/${taskId}`);
    },
    reviewTask: async (taskId: string, action: 'approve' | 'reject', feedback?: string, prompt?: string): Promise<Task> => {
        const response = await apiClient.post(`/tasks/${taskId}/review`, { action, feedback, prompt });
        return response.data;
    },
    routeTask: async (taskId: string, agentId: string, prompt?: string): Promise<{ id: string; status: string }> => {
        const response = await apiClient.post(`/tasks/${taskId}/route`, { agentId, prompt });
        return response.data;
    },
    getTaskActivities: async (taskId: string): Promise<ActivityLog[]> => {
        const response = await apiClient.get(`/tasks/${taskId}/activities`);
        return response.data;
    },

    // Deliverables
    toggleDeliverable: async (deliverableId: string): Promise<Task> => {
        const response = await apiClient.patch(`/deliverables/${deliverableId}/complete`);
        return response.data;
    },
    reorderDeliverables: async (taskId: string, ids: string[]): Promise<Task> => {
        const response = await apiClient.patch(`/deliverables/${taskId}/reorder`, { ids });
        return response.data;
    },

    // Agents
    getAgents: async (): Promise<Agent[]> => {
        try {
            const response = await apiClient.get('/agents');
            return response.data;
        } catch (error: unknown) {
            if (axios.isAxiosError(error) && error.response?.status === 503) {
                // Gateway offline — banner already communicates this; return empty list silently
                return [];
            }
            throw error;
        }
    },
    generateAgent: async (prompt: string): Promise<GeneratedAgentConfig> => {
        const response = await apiClient.post('/agents/generate', { prompt });
        return response.data;
    },

    // Activity Logs — cursor-based, newest first
    getActivities: async (cursor?: string, limit = 50): Promise<CursorPageResponse<ActivityLog>> => {
        const response = await apiClient.get('/activities', { params: { cursor, limit } });
        return response.data;
    },

    // Recurring tasks
    getRecurring: async (): Promise<RecurringTask[]> => {
        const response = await apiClient.get('/recurring');
        return response.data;
    },
    createRecurring: async (payload: CreateRecurringPayload): Promise<RecurringTask> => {
        const response = await apiClient.post('/recurring', payload);
        return response.data;
    },
    updateRecurring: async (id: string, patch: Partial<RecurringTask>): Promise<RecurringTask> => {
        const response = await apiClient.patch(`/recurring/${id}`, patch);
        return response.data;
    },
    deleteRecurring: async (id: string): Promise<void> => {
        await apiClient.delete(`/recurring/${id}`);
    },
    triggerRecurring: async (id: string): Promise<Task> => {
        const response = await apiClient.post(`/recurring/${id}/trigger`);
        return response.data;
    },

    // Settings & System
    getModels: async (): Promise<Model[]> => {
        try {
            const response = await apiClient.get('/models');
            return response.data;
        } catch (error: unknown) {
            if (axios.isAxiosError(error) && error.response?.status === 503) {
                return [];
            }
            throw error;
        }
    },
    getGatewayStatus: async (): Promise<GatewayStatus> => {
        const response = await apiClient.get('/monitoring/gateway/status');
        return response.data;
    },
    getConfig: async (): Promise<AppConfig> => {
        const response = await apiClient.get('/config');
        return response.data;
    },
    saveConfig: async (patch: Partial<AppConfig>): Promise<AppConfig> => {
        const response = await apiClient.post('/config', patch);
        return response.data;
    },
    sync: async (since: string): Promise<import('@claw-pilot/shared-types').SyncResponse> => {
        const response = await apiClient.get('/sync', { params: { since } });
        return response.data;
    },
};
