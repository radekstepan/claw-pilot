import WebSocket from 'ws';

export interface WebhookConfig {
    url: string;
    headers?: Record<string, string>;
}

/**
 * Agent interface as returned by NanoClaw API
 */
export interface Agent {
    id: string;
    name: string;
    folder: string;
    isMain?: boolean;
    requiresTrigger?: boolean;
}

/**
 * Claw-pilot style agent creation input.
 * This provides an abstraction layer so consumers don't need to know
 * about NanoClaw's internal constructs like jid, trigger, etc.
 */
export interface ClawPilotAgentInput {
    /** Agent display name */
    name: string;
    /** Workspace/environment identifier (e.g., 'production', 'staging') */
    workspace?: string;
    /** Model to use (e.g., 'claude-sonnet-4-6') */
    model?: string;
    /** Agent capabilities (e.g., ['code', 'browser', 'shell']) */
    capabilities?: string[];
    /** Optional: Direct NanoClaw JID if you know it (bypasses translation) */
    jid?: string;
    /** Optional: Direct folder name if you know it (bypasses translation) */
    folder?: string;
    /** Optional: Direct trigger pattern if you know it (bypasses translation) */
    trigger?: string;
    /** Whether this is the main control group */
    isMain?: boolean;
    /** Whether messages require a trigger */
    requiresTrigger?: boolean;
}

/**
 * Internal NanoClaw agent creation data
 */
export interface NanoClawAgentData {
    jid: string;
    name: string;
    folder: string;
    trigger: string;
    isMain?: boolean;
    requiresTrigger?: boolean;
}

export interface Task {
    id: string;
    group_folder: string;
    chat_jid: string;
    prompt: string;
    schedule_type: 'cron' | 'interval' | 'once';
    schedule_value: string;
    context_mode: 'group' | 'isolated';
    next_run: string | null;
    last_run: string | null;
    last_result: string | null;
    status: 'active' | 'paused' | 'completed';
    created_at: string;
}

export interface Session {
    folder: string;
    sessionId: string;
}

export interface Model {
    id: string;
    name: string;
}

export interface GenerateConfigRequest {
    prompt: string;
    model?: string;
}

export interface GenerateConfigResponse {
    config: {
        model: string;
        prompt: string;
        generated_at: string;
    };
}

export type ChannelResponse =
    | { status: 'done'; response: string }
    | { status: 'error'; error: string };

/**
 * Type guard to check if input is NanoClawAgentData (has jid)
 */
function isNanoClawAgentData(input: ClawPilotAgentInput | NanoClawAgentData): input is NanoClawAgentData {
    return 'jid' in input && !!input.jid;
}

/**
 * Translates claw-pilot style agent input to NanoClaw format.
 * This maintains the abstraction layer so consumers can work with
 * familiar concepts like 'workspace' and 'capabilities' without
 * needing to construct fake jids or triggers.
 */
function translateAgentInput(input: ClawPilotAgentInput | NanoClawAgentData): NanoClawAgentData {
    // If already in NanoClaw format (has jid), pass through
    if (isNanoClawAgentData(input)) {
        return {
            jid: input.jid,
            name: input.name,
            folder: input.folder || 'main',
            trigger: input.trigger || '@Agent',
            isMain: input.isMain,
            requiresTrigger: input.requiresTrigger
        };
    }

    // Translate from claw-pilot format
    const workspace = input.workspace || 'default';
    const model = input.model || 'claude-sonnet-4-6';
    const capabilities = input.capabilities || [];

    // Generate a synthetic JID based on workspace and model
    // Format: cp-{workspace}-{model-hash}@claw-pilot
    const modelShort = model.split('-').slice(1).join('-') || model.substring(0, 8);
    const jid = `cp-${workspace}-${modelShort}@claw-pilot`;

    // Generate folder name from workspace
    const folder = input.folder || `claw_${workspace}`;

    // Generate trigger based on capabilities
    let trigger = '@Agent';
    if (capabilities.length > 0) {
        trigger = `@${capabilities.join('-')}`;
    }

    return {
        jid,
        name: input.name,
        folder,
        trigger,
        isMain: input.isMain,
        requiresTrigger: input.requiresTrigger
    };
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

    // === Agents ===

    async getAgents(): Promise<Agent[]> {
        return this.request<Agent[]>('GET', '/api/agents');
    }

    /**
     * Create a new agent.
     * Accepts either NanoClaw-native format (jid, folder, trigger)
     * or claw-pilot abstraction (workspace, model, capabilities).
     */
    async createAgent(data: ClawPilotAgentInput | NanoClawAgentData): Promise<Agent> {
        const translated = translateAgentInput(data);
        return this.request<Agent>('POST', '/api/agents', translated);
    }

    /**
     * Update an existing agent.
     * Accepts either NanoClaw-native format or claw-pilot abstraction.
     */
    async updateAgent(
        id: string,
        data: Partial<ClawPilotAgentInput | NanoClawAgentData>
    ): Promise<Agent> {
        const translated: Partial<NanoClawAgentData> = {};

        if ('jid' in data && data.jid) translated.jid = data.jid;
        if (data.name) translated.name = data.name;
        if ('folder' in data && data.folder) translated.folder = data.folder;
        if ('trigger' in data && data.trigger) translated.trigger = data.trigger;
        if (data.isMain !== undefined) translated.isMain = data.isMain;
        if (data.requiresTrigger !== undefined) translated.requiresTrigger = data.requiresTrigger;

        // Translate workspace if provided
        if ('workspace' in data && data.workspace) {
            translated.folder = `claw_${data.workspace}`;
        }

        // Translate capabilities to trigger if provided
        if ('capabilities' in data && data.capabilities && data.capabilities.length > 0) {
            translated.trigger = `@${data.capabilities.join('-')}`;
        }

        return this.request<Agent>('PATCH', `/api/agents/${id}`, translated);
    }

    async deleteAgent(id: string): Promise<void> {
        return this.request<void>('DELETE', `/api/agents/${id}`);
    }

    // === Sessions ===

    async getSessions(): Promise<Session[]> {
        return this.request<Session[]>('GET', '/api/sessions');
    }

    // === Messaging ===

    async sendMessage(agentId: string, message: string): Promise<{ status: string; agentId: string }> {
        return this.request<{ status: string; agentId: string }>('POST', `/api/agents/${agentId}/chat`, { message });
    }

    // === Tasks ===

    async spawnTask(
        agentId: string,
        taskId: string,
        prompt: string,
        webhook?: WebhookConfig
    ): Promise<{ status: string; taskId: string; agentId: string; webhookRegistered: boolean }> {
        return this.request<{ status: string; taskId: string; agentId: string; webhookRegistered: boolean }>(
            'POST',
            `/api/agents/${agentId}/tasks`,
            { taskId, prompt, webhook }
        );
    }

    async getTask(agentId: string, taskId: string): Promise<Task> {
        return this.request<Task>('GET', `/api/agents/${agentId}/tasks/${taskId}`);
    }

    async cancelTask(agentId: string, taskId: string): Promise<{ status: string; taskId: string }> {
        return this.request<{ status: string; taskId: string }>('DELETE', `/api/agents/${agentId}/tasks/${taskId}`);
    }

    // === Files ===

    async getAgentFile(agentId: string, fileName: string): Promise<{ file: string; content: string }> {
        return this.request<{ file: string; content: string }>('GET', `/api/agents/${agentId}/files/${fileName}`);
    }

    async setAgentFile(agentId: string, fileName: string, content: string): Promise<{ status: string; file: string }> {
        return this.request<{ status: string; file: string }>('PUT', `/api/agents/${agentId}/files/${fileName}`, { content });
    }

    // === Models ===

    async getModels(): Promise<Model[]> {
        return this.request<Model[]>('GET', '/api/models');
    }

    async generateConfig(prompt: string, model?: string): Promise<GenerateConfigResponse> {
        return this.request<GenerateConfigResponse>('POST', '/api/generate-config', { prompt, model });
    }

    // === Health ===

    async healthCheck(): Promise<{ status: string; timestamp: string }> {
        // Health endpoint doesn't require auth
        const response = await fetch(`${this.baseUrl}/api/health`);
        if (!response.ok) {
            throw new Error(`Health check failed (${response.status})`);
        }
        return response.json();
    }
}

export class NanoClawChannelClient {
    private wsUrl: string;
    private token?: string;
    private connections = new Map<string, WebSocket>();
    private pending = new Map<string, {
        resolve: (v: ChannelResponse) => void;
        reject: (e: Error) => void;
        timer: ReturnType<typeof setTimeout>;
    }>();

    constructor(wsUrl: string, token?: string) {
        this.wsUrl = wsUrl.replace(/\/$/, '');
        this.token = token;
    }

    async sendTask(
        sessionId: string,
        task: string,
        timeoutMs = 1_800_000,
    ): Promise<ChannelResponse> {
        if (this.pending.has(sessionId)) {
            throw new Error(`Session '${sessionId}' already has a pending request`);
        }

        const ws = await this.getOrCreateConnection(sessionId);

        return new Promise<ChannelResponse>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(sessionId);
                reject(new Error(`Channel request timed out after ${timeoutMs}ms for session '${sessionId}'`));
            }, timeoutMs);

            this.pending.set(sessionId, { resolve, reject, timer });

            ws.send(JSON.stringify({ task, sessionId }));
        });
    }

    private getOrCreateConnection(sessionId: string): Promise<WebSocket> {
        const existing = this.connections.get(sessionId);
        if (existing && existing.readyState === WebSocket.OPEN) {
            return Promise.resolve(existing);
        }

        // Clean up old connection if exists
        if (existing) {
            this.connections.delete(sessionId);
            try { existing.close(); } catch { /* ignore */ }
        }

        return new Promise<WebSocket>((resolve, reject) => {
            const url = this.token
                ? `${this.wsUrl}?session=${sessionId}&token=${this.token}`
                : `${this.wsUrl}?session=${sessionId}`;
            const ws = new WebSocket(url);

            ws.on('open', () => {
                this.connections.set(sessionId, ws);
                resolve(ws);
            });

            ws.on('message', (data: Buffer) => {
                try {
                    const msg = JSON.parse(data.toString());
                    const pending = this.pending.get(sessionId);
                    if (pending && (msg.status === 'done' || msg.status === 'error')) {
                        clearTimeout(pending.timer);
                        this.pending.delete(sessionId);
                        pending.resolve(msg as ChannelResponse);
                    }
                } catch {
                    // Ignore malformed messages
                }
            });

            ws.on('error', (err) => {
                const pending = this.pending.get(sessionId);
                if (pending) {
                    clearTimeout(pending.timer);
                    this.pending.delete(sessionId);
                    pending.reject(err instanceof Error ? err : new Error(String(err)));
                }
                this.connections.delete(sessionId);
                reject(err);
            });

            ws.on('close', () => {
                const pending = this.pending.get(sessionId);
                if (pending) {
                    clearTimeout(pending.timer);
                    this.pending.delete(sessionId);
                    pending.reject(new Error(`WebSocket closed for session '${sessionId}'`));
                }
                this.connections.delete(sessionId);
            });
        });
    }

    close(): void {
        for (const [sessionId, ws] of this.connections) {
            try { ws.close(); } catch { /* ignore */ }
            const pending = this.pending.get(sessionId);
            if (pending) {
                clearTimeout(pending.timer);
                pending.reject(new Error('Channel client closed'));
            }
        }
        this.connections.clear();
        this.pending.clear();
    }
}
