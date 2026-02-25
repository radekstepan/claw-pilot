import axios from 'axios';
import type { Task, Agent, ActivityLog, ChatMessage, CreateTaskPayload, TaskStatus } from '@claw-pilot/shared-types';

// Types for backend API responses not covered by shared-types
export interface Model {
    id: string;
    name: string;
    provider?: string;
}

export interface GatewayStatus {
    status: string;
    memory?: string;
    uptime?: string;
    logs?: string;
}

export interface GeneratedAgentConfig {
    name?: string;
    capabilities?: string[];
    [key: string]: unknown;
}

const API_BASE_URL = `${import.meta.env.VITE_API_URL ?? 'http://localhost:54321'}/api`;

const apiClient = axios.create({
    baseURL: API_BASE_URL,
    headers: {
        'Content-Type': 'application/json',
    },
});

export const api = {
    // Tasks
    getTasks: async (): Promise<Task[]> => {
        const response = await apiClient.get('/tasks');
        return response.data;
    },
    createTask: async (payload: CreateTaskPayload): Promise<Task> => {
        const response = await apiClient.post('/tasks', payload);
        return response.data;
    },
    updateTaskStatus: async (taskId: string, status: TaskStatus): Promise<Task> => {
        const response = await apiClient.patch(`/tasks/${taskId}`, { status });
        return response.data;
    },

    // Chat
    sendChatMessageToAgent: async (message: string, agentId?: string): Promise<ChatMessage> => {
        const response = await apiClient.post('/chat/send-to-agent', { message, agentId });
        return response.data;
    },

    // Agents
    getAgents: async (): Promise<Agent[]> => {
        const response = await apiClient.get('/agents');
        return response.data;
    },
    generateAgent: async (prompt: string): Promise<GeneratedAgentConfig> => {
        const response = await apiClient.post('/agents/generate', { prompt });
        return response.data;
    },

    // Activity Logs
    getActivities: async (): Promise<ActivityLog[]> => {
        const response = await apiClient.get('/activities');
        return response.data;
    },
    // Settings & System
    getModels: async (): Promise<Model[]> => {
        const response = await apiClient.get('/models');
        return response.data;
    },
    getGatewayStatus: async (): Promise<GatewayStatus> => {
        const response = await apiClient.get('/monitoring/gateway/status');
        return response.data;
    }
};
