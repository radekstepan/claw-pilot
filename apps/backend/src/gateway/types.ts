import type { Agent } from "@claw-pilot/shared-types";

export interface LiveSession {
  key?: string;
  agent?: string;
  agentId?: string;
  status?: string;
  [key: string]: unknown;
}

export interface WebhookConfig {
  url: string;
  headers?: Record<string, string>;
}

export interface GatewayBackend {
  getAgents(): Promise<Agent[]>;
  createAgent(
    name: string,
    workspace: string,
    model?: string,
    capabilities?: string[],
  ): Promise<void>;
  updateAgentMeta(
    agentId: string,
    patch: { name?: string; model?: string; capabilities?: string[] },
  ): Promise<void>;
  deleteAgent(agentId: string, deleteFiles?: boolean): Promise<unknown>;

  getLiveSessions(): Promise<LiveSession[]>;
  routeChatToAgent(agentId: string, message: string): Promise<unknown>;
  spawnTaskSession(
    agentId: string,
    taskId: string,
    prompt: string,
    webhook?: WebhookConfig,
    onStream?: (chunk: string) => void,
  ): Promise<void>;
  agentIdToSessionKey(agentId: string): string;

  rawCall<T = unknown>(
    method: string,
    params: Record<string, unknown>,
    opts?: { timeout?: number },
  ): Promise<T>;

  getAgentFile(agentId: string, name: string): Promise<string>;
  getAgentWorkspaceFiles(
    agentId: string,
  ): Promise<{ soul: string; tools: string; agentsMd: string }>;
  setAgentFiles(
    agentId: string,
    files: { soul?: string; tools?: string; agentsMd?: string },
  ): Promise<void>;

  generateAgentConfig(
    prompt: string,
    model?: string,
  ): Promise<Record<string, unknown>>;
  getModels(): Promise<unknown>;
}
