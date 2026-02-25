import axios from 'axios';
import type { Task, Agent, ActivityLog } from '@claw-pilot/shared-types';

const API_BASE_URL = 'http://localhost:54321/api';

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
    updateTaskStatus: async (taskId: string, status: string): Promise<Task> => {
        const response = await apiClient.patch(`/tasks/${taskId}`, { status });
        return response.data;
    },

    // Chat
    sendChatMessageToAgent: async (message: string, agentId?: string): Promise<any> => {
        const response = await apiClient.post('/chat/send-to-agent', { message, agentId });
        return response.data;
    },

    // Agents
    getAgents: async (): Promise<Agent[]> => {
        const response = await apiClient.get('/agents');
        return response.data;
    },
    generateAgent: async (prompt: string): Promise<any> => {
        const response = await apiClient.post('/agents/generate', { prompt });
        return response.data;
    },

    // Activity Logs
    getActivities: async (): Promise<ActivityLog[]> => {
        // Assuming there is or will be an activities endpoint
        // You might need to adjust this depending on the exact backend route
        const response = await apiClient.get('/activities');
        return response.data;
    }
};
