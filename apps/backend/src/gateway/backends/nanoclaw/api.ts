import type { Agent } from "@claw-pilot/shared-types";
import type {
    GatewayBackend,
    LiveSession,
    TaskStreamChunk,
    WebhookConfig,
} from "../../types.js";
import { env } from "../../../config/env.js";
import { NanoClawClient, NanoClawChannelClient } from "./client.js";
import type { ChannelResponse } from "./client.js";
import type { StreamSource } from "./client.js";
import { GatewayOfflineError, GatewayPairingRequiredError } from "../../errors.js";

// GATEWAY_URL → NanoClaw's HTTP API (agents, sessions, files, models)
const httpUrl = env.GATEWAY_URL.replace(/^ws(s?):\/\//, 'http$1://');
const client = new NanoClawClient(httpUrl, env.GATEWAY_TOKEN);

// NANOCLAW_WS_URL → NanoClaw's WebSocket channel (task/chat routing)
const channel = env.NANOCLAW_WS_URL
    ? new NanoClawChannelClient(env.NANOCLAW_WS_URL, env.GATEWAY_TOKEN)
    : null;

function handleNetworkError(method: string, e: unknown): never {
    if (e instanceof Error && e.name === 'NetworkError') {
        throw new GatewayOfflineError(method, e);
    }
    if (e instanceof Error && e.message.includes('401')) {
        throw new GatewayPairingRequiredError('nanoclaw-device');
    }
    throw e as Error;
}

export class NanoClawBackend implements GatewayBackend {
    agentIdToSessionKey(agentId: string): string {
        return `nanoclaw:${agentId}`;
    }

    async rawCall<T = unknown>(
        method: string,
        params: Record<string, unknown>,
        opts?: { timeout?: number },
    ): Promise<T> {
        try {
            if (method === "sessions.list") {
                return (await client.getSessions()) as T;
            }
            return {} as T;
        } catch (e) {
            handleNetworkError(method, e);
        }
    }

    async getAgents(): Promise<Agent[]> {
        try {
            const agents = await client.getAgents();
            console.log("[nanoclaw/api] getAgents raw response:", agents);

            if (!Array.isArray(agents)) {
                console.error("[nanoclaw/api] Expected agents to be an array, got:", typeof agents);
                return [];
            }

            return agents
                .filter((a: any) => !a.id || !a.id.startsWith("ws:"))
                .map((a: any) => ({
                    id: a.id,
                    name: a.name,
                    status: "OFFLINE" as const,
                    capabilities: a.capabilities || [],
                    model: a.model,
                    role: a.role,
                    workspace: a.workspace,
                }));
        } catch (e) {
            handleNetworkError("getAgents", e);
        }
    }

    async getLiveSessions(): Promise<LiveSession[]> {
        try {
            const sessions = await client.getSessions();
            return sessions.map((s: any) => ({
                key: s.id || `nanoclaw:${s.agentId}`,
                agent: s.agentId,
                agentId: s.agentId,
                status: s.status || "IDLE",
            }));
        } catch (e) {
            handleNetworkError("getLiveSessions", e);
        }
    }

    async routeChatToAgent(agentId: string, message: string): Promise<unknown> {
        try {
            if (channel) {
                const sessionId = `chat:${agentId}`;
                const result = await channel.sendTask(agentId, sessionId, message, env.GATEWAY_AI_TIMEOUT);
                if (result.status === 'error') {
                    throw new Error(result.error);
                } else if (result.status === 'stream') {
                    // Chat currently doesn't support streaming, wait for done
                    return { message: "Streaming not supported via routeChatToAgent yet." };
                }
                return { message: result.response };
            }
            return await client.sendMessage(agentId, message);
        } catch (e) {
            handleNetworkError("routeChatToAgent", e);
        }
    }

    async spawnTaskSession(
        agentId: string,
        taskId: string,
        prompt: string,
        webhook?: WebhookConfig,
        onStream?: (payload: TaskStreamChunk) => void,
    ): Promise<void> {
        // Strip ClawPilot's "delivery instructions" — they're only relevant
        // for OpenClaw (curl-based) agents, not NanoClaw channel tasks.
        const message = prompt
            .replace("IMPORTANT: Your final message will be automatically delivered to the user.", "")
            .replace("You MUST start your final output with \"completed: \" followed by the full text, answer, or result. Do NOT abbreviate or summarize.", "")
            .replace("If you encounter an unrecoverable error, start your message with \"error: \" followed by the description.", "");

        if (!channel) {
            // No WS channel configured — fall back to HTTP task API
            try {
                await client.spawnTask(agentId, taskId, message, webhook);
            } catch (e) {
                handleNetworkError("spawnTaskSession", e);
            }
            return;
        }

        const sessionId = `task:${taskId}`;

        // Fire-and-forget: send task over WS channel, deliver webhook when done
        channel.sendTask(agentId, sessionId, message, env.GATEWAY_AI_TIMEOUT, onStream)
            .then(async (result: ChannelResponse) => {
                if (!webhook) return;

                const payload = {
                    type: 'task_completed',
                    taskId,
                    status: result.status === 'done' ? 'success' : 'error',
                    result: result.status === 'done' ? result.response : undefined,
                    error: result.status === 'error' ? result.error : undefined,
                    timestamp: new Date().toISOString(),
                };

                try {
                    const res = await fetch(webhook.url, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            ...webhook.headers,
                        },
                        body: JSON.stringify(payload),
                    });
                    if (!res.ok) {
                        const text = await res.text();
                        console.error('[nanoclaw] webhook delivery failed:', res.status, text);
                    }
                } catch (e) {
                    console.error('[nanoclaw] webhook delivery error:', e);
                }
            })
            .catch(async (e: unknown) => {
                console.error('[nanoclaw] channel sendTask failed:', e);
                if (!webhook) return;
                try {
                    await fetch(webhook.url, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            ...webhook.headers,
                        },
                        body: JSON.stringify({
                            type: 'task_completed',
                            taskId,
                            status: 'error',
                            error: String(e),
                            timestamp: new Date().toISOString(),
                        }),
                    });
                } catch (we) {
                    console.error('[nanoclaw] webhook delivery for error failed:', we);
                }
            });
    }

    async generateAgentConfig(
        prompt: string,
        model?: string,
    ): Promise<Record<string, unknown>> {
        try {
            return (await client.generateConfig(prompt, model)) as unknown as Record<string, unknown>;
        } catch (e) {
            handleNetworkError("generateAgentConfig", e);
        }
    }

    async createAgent(
        name: string,
        workspace: string,
        model?: string,
        capabilities?: string[],
    ): Promise<void> {
        try {
            await client.createAgent({ name, workspace, model, capabilities });
        } catch (e) {
            handleNetworkError("createAgent", e);
        }
    }

    async updateAgentMeta(
        agentId: string,
        patch: { name?: string; model?: string; capabilities?: string[] },
    ): Promise<void> {
        try {
            await client.updateAgent(agentId, patch);
        } catch (e) {
            handleNetworkError("updateAgentMeta", e);
        }
    }

    async deleteAgent(agentId: string, deleteFiles = true): Promise<unknown> {
        try {
            return await client.deleteAgent(agentId);
        } catch (e) {
            handleNetworkError("deleteAgent", e);
        }
    }

    async getAgentFile(agentId: string, name: string): Promise<string> {
        try {
            const res = await client.getAgentFile(agentId, name);
            return res.content || "";
        } catch {
            return "";
        }
    }

    async getAgentWorkspaceFiles(
        agentId: string,
    ): Promise<{ soul: string; tools: string; agentsMd: string }> {
        const [soul, tools, agentsMd] = await Promise.all([
            this.getAgentFile(agentId, "SOUL.md"),
            this.getAgentFile(agentId, "TOOLS.md"),
            this.getAgentFile(agentId, "AGENTS.md"),
        ]);
        return { soul, tools, agentsMd };
    }

    async setAgentFiles(
        agentId: string,
        files: { soul?: string; tools?: string; agentsMd?: string },
    ): Promise<void> {
        try {
            const updates: Promise<unknown>[] = [];
            if (files.soul !== undefined) updates.push(client.setAgentFile(agentId, "SOUL.md", files.soul));
            if (files.tools !== undefined) updates.push(client.setAgentFile(agentId, "TOOLS.md", files.tools));
            if (files.agentsMd !== undefined) updates.push(client.setAgentFile(agentId, "AGENTS.md", files.agentsMd));
            await Promise.all(updates);
        } catch (e) {
            handleNetworkError("setAgentFiles", e);
        }
    }

    async getModels(): Promise<unknown> {
        try {
            return await client.getModels();
        } catch (e) {
            handleNetworkError("getModels", e);
        }
    }
}

/**
 * Fetch the raw container log for a NanoClaw WS session.
 * The sessionId is the part after "ws:" in the JID — e.g. "task:UUID".
 * Returns null if the gateway is offline or the session/log doesn't exist.
 */
export async function getContainerLog(sessionId: string, lines = 500): Promise<string | null> {
    try {
        return await client.getSessionLogs(sessionId, lines);
    } catch {
        return null;
    }
}
