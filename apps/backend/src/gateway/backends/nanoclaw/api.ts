import type { Agent } from "@claw-pilot/shared-types";
import type { GatewayBackend, LiveSession, WebhookConfig } from "../../types.js";
import { env } from "../../../config/env.js";
import { NanoClawClient } from "@claw-pilot/nanoclaw-gateway";
import { GatewayOfflineError, GatewayPairingRequiredError } from "../../errors.js";

const httpUrl = env.GATEWAY_URL.replace(/^ws(s?):\/\//, 'http$1://');
const client = new NanoClawClient(httpUrl, env.GATEWAY_TOKEN);

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
            return agents.map((a: any) => ({
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
    ): Promise<void> {
        try {
            await client.spawnTask(agentId, taskId, prompt, webhook);
        } catch (e) {
            handleNetworkError("spawnTaskSession", e);
        }
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
