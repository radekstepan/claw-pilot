export interface WebhookConfig {
    url: string;
    headers?: Record<string, string>;
}

export class NanoClawClient {
    private baseUrl: string;
    private token?: string;

    constructor(baseUrl: string, token?: string) {
        this.baseUrl = baseUrl.replace(/\/$/, '');
        this.token = token;
    }

    private async request<T>(method: string, endpoint: string, body?: any): Promise<T> {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json'
        };

        if (this.token) {
            headers['Authorization'] = `Bearer ${this.token}`;
        }

        try {
            const response = await fetch(`${this.baseUrl}${endpoint}`, {
                method,
                headers,
                body: body ? JSON.stringify(body) : undefined,
            });

            if (!response.ok) {
                const text = await response.text();
                throw new Error(`NanoClaw API error (${response.status}): ${text}`);
            }

            if (response.status === 204) {
                return {} as T;
            }

            return response.json() as Promise<T>;
        } catch (err) {
            if (err instanceof Error && (err.name === 'TypeError' || err.message.includes('fetch'))) {
                err.name = 'NetworkError';
            }
            throw err;
        }
    }

    async getAgents(): Promise<any[]> {
        return this.request<any[]>('GET', '/api/agents');
    }

    async createAgent(data: any): Promise<any> {
        return this.request<any>('POST', '/api/agents', data);
    }

    async updateAgent(id: string, data: any): Promise<any> {
        return this.request<any>('PATCH', `/api/agents/${id}`, data);
    }

    async deleteAgent(id: string): Promise<any> {
        return this.request<any>('DELETE', `/api/agents/${id}`);
    }

    async getSessions(): Promise<any[]> {
        return this.request<any[]>('GET', '/api/sessions');
    }

    async sendMessage(agentId: string, message: string): Promise<any> {
        return this.request<any>('POST', `/api/agents/${agentId}/chat`, { message });
    }

    async spawnTask(agentId: string, taskId: string, prompt: string, webhook?: WebhookConfig): Promise<any> {
        return this.request<any>('POST', `/api/agents/${agentId}/tasks`, { taskId, prompt, webhook });
    }

    async getAgentFile(agentId: string, fileName: string): Promise<any> {
        return this.request<any>('GET', `/api/agents/${agentId}/files/${fileName}`);
    }

    async setAgentFile(agentId: string, fileName: string, content: string): Promise<any> {
        return this.request<any>('PUT', `/api/agents/${agentId}/files/${fileName}`, { content });
    }

    async getModels(): Promise<any[]> {
        return this.request<any[]>('GET', '/api/models');
    }

    async generateConfig(prompt: string, model?: string): Promise<any> {
        return this.request<any>('POST', '/api/generate-config', { prompt, model });
    }
}
