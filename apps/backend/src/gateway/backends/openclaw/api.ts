import { randomUUID } from "crypto";
import type { Agent } from "@claw-pilot/shared-types";
import type {
  GatewayBackend,
  LiveSession,
  TaskStreamChunk,
  WebhookConfig,
} from "../../types.js";
import { env } from "../../../config/env.js";
import {
  gatewayCall,
  isConnectionError,
  GatewayOfflineError,
  GatewayPairingRequiredError,
  extractValue,
  parseOpenclawConfig,
  GatewayConfigPayloadSchema,
  GatewaySessionsPayloadSchema,
  GatewayModelsPayloadSchema,
} from "./client.js";

const WS_TIMEOUT = env.GATEWAY_WS_TIMEOUT;
const AI_TIMEOUT = env.GATEWAY_AI_TIMEOUT;

export class OpenClawBackend implements GatewayBackend {
  agentIdToSessionKey(agentId: string): string {
    if (agentId === "main") {
      return `mc-gateway:${env.GATEWAY_ID}:main`;
    }
    return `mc:mc-${agentId}:main`;
  }

  async rawCall<T = unknown>(
    method: string,
    params: Record<string, unknown>,
    opts?: { timeout?: number },
  ): Promise<T> {
    return gatewayCall<T>(method, params, { timeout: opts?.timeout });
  }

  async getAgents(): Promise<Agent[]> {
    try {
      const payload = await gatewayCall(
        "config.get",
        {},
        { schema: GatewayConfigPayloadSchema },
      );
      const value = extractValue(payload);

      if (!value) return [];
      return parseOpenclawConfig(value);
    } catch (e) {
      if (e instanceof GatewayPairingRequiredError) throw e;
      if (isConnectionError(e))
        throw new GatewayOfflineError("config.get", e as Error);
      console.error("[openclaw] getAgents unexpected error:", e);
      return [];
    }
  }

  async getLiveSessions(): Promise<LiveSession[]> {
    try {
      const payload = await gatewayCall(
        "sessions.list",
        {},
        { schema: GatewaySessionsPayloadSchema },
      );
      if (Array.isArray(payload)) return payload;
      if (
        payload &&
        typeof payload === "object" &&
        Array.isArray((payload as Record<string, unknown>).sessions)
      ) {
        return (payload as Record<string, unknown[]>).sessions as LiveSession[];
      }
      return [];
    } catch (e) {
      if (e instanceof GatewayPairingRequiredError) throw e;
      if (isConnectionError(e))
        throw new GatewayOfflineError("sessions.list", e as Error);
      console.error("[openclaw] getLiveSessions unexpected error:", e);
      return [];
    }
  }

  async routeChatToAgent(agentId: string, message: string): Promise<unknown> {
    try {
      const sessionKey = this.agentIdToSessionKey(agentId);
      await gatewayCall(
        "sessions.patch",
        { key: sessionKey },
        { timeout: WS_TIMEOUT },
      );
      return await gatewayCall(
        "chat.send",
        { sessionKey, message, deliver: false, idempotencyKey: randomUUID() },
        { timeout: AI_TIMEOUT },
      );
    } catch (e) {
      if (e instanceof GatewayPairingRequiredError) throw e;
      if (isConnectionError(e))
        throw new GatewayOfflineError("chat.send", e as Error);
      console.error("[openclaw] routeChatToAgent unexpected error:", e);
      throw e;
    }
  }

  async generateAgentConfig(
    prompt: string,
    model?: string,
  ): Promise<Record<string, unknown>> {
    try {
      const sessionKey = `mc-gateway:${env.GATEWAY_ID}:main`;
      const modelHint = model
        ? ` The agent should be assigned the model ID '${model}'.`
        : "";
      const fallbackModel = model ?? "claude-3-5-sonnet";
      const fullPrompt =
        `Generate a JSON configuration for a new AI agent based on this request: ${prompt}.${modelHint} ` +
        `Return ONLY a valid JSON object with exactly these keys: ` +
        `'name' (string, a short slug-style id, e.g. "data-viz-expert"), ` +
        `'capabilities' (array of strings describing what the agent can do), ` +
        `and 'model' (string — use '${fallbackModel}' unless the request specifies otherwise). ` +
        `Do not include any markdown or explanation — just the raw JSON object.`;
      await gatewayCall(
        "sessions.patch",
        { key: sessionKey },
        { timeout: WS_TIMEOUT },
      );
      const raw = (await gatewayCall(
        "chat.send",
        {
          sessionKey,
          message: fullPrompt,
          deliver: false,
          idempotencyKey: randomUUID(),
        },
        { timeout: AI_TIMEOUT },
      )) as Record<string, unknown> | string | null;

      const text =
        typeof raw === "string"
          ? raw
          : typeof raw?.message === "string"
            ? raw.message
            : JSON.stringify(raw ?? {});

      let parsed: Record<string, unknown> | null = null;
      try {
        parsed = JSON.parse(text) as Record<string, unknown>;
      } catch {
        const match = text.match(/\{[\s\S]*\}/);
        if (match) {
          try {
            parsed = JSON.parse(match[0]) as Record<string, unknown>;
          } catch {
            /* give up — return graceful degradation below */
          }
        }
      }

      if (parsed && typeof parsed === "object") {
        return parsed;
      }

      return {
        name: "new-agent",
        capabilities: [],
        model: fallbackModel,
        _raw: text,
      };
    } catch (e) {
      if (e instanceof GatewayPairingRequiredError) throw e;
      if (isConnectionError(e))
        throw new GatewayOfflineError("chat.send", e as Error);
      console.error("[openclaw] generateAgentConfig unexpected error:", e);
      throw e;
    }
  }

  async createAgent(
    name: string,
    workspace: string,
    model?: string,
    capabilities?: string[],
  ): Promise<void> {
    try {
      try {
        await gatewayCall(
          "agents.create",
          { name, workspace },
          { timeout: WS_TIMEOUT },
        );
      } catch (createErr) {
        const msg = (createErr as Error).message ?? "";
        if (/already|duplicate|conflict/i.test(msg)) {
          console.log(
            `[openclaw] createAgent: "${name}" already registered — skipping`,
          );
        } else {
          throw createErr;
        }
      }

      if (model !== undefined || capabilities !== undefined) {
        await this.updateAgentMeta(name, { model, capabilities });
      }
    } catch (e) {
      if (e instanceof GatewayPairingRequiredError) throw e;
      if (isConnectionError(e))
        throw new GatewayOfflineError("agents.create", e as Error);
      console.error("[openclaw] createAgent unexpected error:", e);
      throw e;
    }
  }

  async updateAgentMeta(
    agentId: string,
    patch: { name?: string; model?: string; capabilities?: string[] },
  ): Promise<void> {
    const {
      name: newName,
      model: newModel,
      capabilities: newCapabilities,
    } = patch;
    if (
      newName === undefined &&
      newModel === undefined &&
      newCapabilities === undefined
    )
      return;

    try {
      if (newName !== undefined) {
        const payload = await gatewayCall(
          "config.get",
          {},
          { schema: GatewayConfigPayloadSchema },
        );
        const listValue = extractValue(payload) as any;
        const rawList: Record<string, unknown>[] = Array.isArray(
          listValue?.agents?.list,
        )
          ? listValue.agents.list
          : [];
        const current = rawList.find((a) => (a.id ?? a.name) === agentId);
        const workspace =
          typeof current?.workspace === "string" ? current.workspace : "";

        await gatewayCall(
          "agents.update",
          { agentId, name: newName, workspace },
          { timeout: WS_TIMEOUT },
        );
      }

      if (newModel !== undefined || newCapabilities !== undefined) {
        const payload = await gatewayCall(
          "config.get",
          {},
          { schema: GatewayConfigPayloadSchema },
        );
        const hash =
          payload && !Array.isArray(payload) && typeof payload.hash === "string"
            ? payload.hash
            : undefined;
        const listValue = extractValue(payload) as any;
        const rawList: Record<string, unknown>[] = Array.isArray(
          listValue?.agents?.list,
        )
          ? listValue.agents.list
          : [];

        if (!rawList.some((a) => (a.id ?? a.name) === agentId)) {
          console.warn(
            `[openclaw] updateAgentMeta: agent "${agentId}" not found in agents.list`,
          );
          return;
        }

        const updatedList = rawList.map((a) => {
          if ((a.id ?? a.name) !== agentId) return a;
          const updated = { ...a };

          if (newModel !== undefined) updated.model = newModel;
          if (newCapabilities !== undefined) {
            updated.tools = {
              ...((updated.tools as Record<string, unknown>) || {}),
              allow: newCapabilities,
            };
            delete updated.capabilities;
          }

          return updated;
        });

        await gatewayCall(
          "config.patch",
          {
            baseHash: hash,
            raw: JSON.stringify({ agents: { list: updatedList } }),
          },
          { timeout: WS_TIMEOUT },
        );
      }
    } catch (e) {
      if (e instanceof GatewayPairingRequiredError) throw e;
      if (isConnectionError(e))
        throw new GatewayOfflineError("updateAgentMeta", e as Error);
      console.error("[openclaw] updateAgentMeta unexpected error:", e);
      throw e;
    }
  }

  private async listAgentFiles(agentId: string): Promise<string[]> {
    try {
      const payload = (await gatewayCall(
        "agents.files.list",
        { agentId },
        { timeout: WS_TIMEOUT },
      )) as { files?: Array<{ name?: string } | string> };
      const files = payload?.files ?? [];
      return files
        .map((f) => (typeof f === "string" ? f : (f?.name ?? "")))
        .filter(Boolean);
    } catch (e) {
      console.warn(
        `[openclaw] agents.files.list error for agentId='${agentId}':`,
        (e as Error).message,
      );
      return [];
    }
  }

  async getAgentFile(agentId: string, name: string): Promise<string> {
    try {
      const payload = (await gatewayCall(
        "agents.files.get",
        { agentId, name },
        { timeout: WS_TIMEOUT },
      )) as {
        content?: string;
        file?: { missing?: boolean };
      };
      if (payload?.file?.missing) return "";
      return payload?.content ?? "";
    } catch (e) {
      console.error(
        `[openclaw] getAgentFile (${name}) error for agentId='${agentId}':`,
        e,
      );
      return "";
    }
  }

  async getAgentWorkspaceFiles(
    agentId: string,
  ): Promise<{ soul: string; tools: string; agentsMd: string }> {
    const available = await this.listAgentFiles(agentId);

    const fetch = (name: string) =>
      available.includes(name)
        ? this.getAgentFile(agentId, name)
        : Promise.resolve("");

    const [soul, tools, agentsMd] = await Promise.all([
      fetch("SOUL.md"),
      fetch("TOOLS.md"),
      fetch("AGENTS.md"),
    ]);
    return { soul, tools, agentsMd };
  }

  async setAgentFiles(
    agentId: string,
    files: { soul?: string; tools?: string; agentsMd?: string },
  ): Promise<void> {
    try {
      const updates: Promise<unknown>[] = [];

      if (files.soul !== undefined)
        updates.push(
          gatewayCall(
            "agents.files.set",
            { agentId, name: "SOUL.md", content: files.soul },
            { timeout: WS_TIMEOUT },
          ),
        );
      if (files.tools !== undefined)
        updates.push(
          gatewayCall(
            "agents.files.set",
            { agentId, name: "TOOLS.md", content: files.tools },
            { timeout: WS_TIMEOUT },
          ),
        );
      if (files.agentsMd !== undefined)
        updates.push(
          gatewayCall(
            "agents.files.set",
            { agentId, name: "AGENTS.md", content: files.agentsMd },
            { timeout: WS_TIMEOUT },
          ),
        );

      await Promise.all(updates);
    } catch (e) {
      if (e instanceof GatewayPairingRequiredError) throw e;
      if (isConnectionError(e))
        throw new GatewayOfflineError("agents.files.set", e as Error);
      console.error("[openclaw] setAgentFiles unexpected error:", e);
      throw e;
    }
  }

  async spawnTaskSession(
    agentId: string,
    taskId: string,
    prompt: string,
    webhook?: WebhookConfig,
    _onStream?: (payload: TaskStreamChunk) => void,
  ): Promise<void> {
    try {
      const sessionKey = `task-${taskId}`;
      await gatewayCall(
        "sessions.patch",
        { key: sessionKey, label: sessionKey },
        { timeout: WS_TIMEOUT },
      );

      let message = prompt;
      if (webhook) {
        // Remove the automatic delivery language so the agent isn't tricked into just responding conversationally
        message = message
          .replace("IMPORTANT: Your final message will be automatically delivered to the user.", "")
          .replace("You MUST start your final output with \"completed: \" followed by the full text, answer, or result. Do NOT abbreviate or summarize.", "")
          .replace("If you encounter an unrecoverable error, start your message with \"error: \" followed by the description.", "");

        const authLine = webhook.headers?.Authorization
          ? `\n  Authorization: ${webhook.headers.Authorization}`
          : '';
        message += [
          ``,
          `When you have finished, you MUST use a web request (e.g. curl) to POST your result to:`,
          `  POST ${webhook.url}${authLine}`,
          `  Content-Type: application/json`,
          `  Body: { "agent_id": "${agentId}", "message": "completed: <FULL OUTPUT HERE>" }`,
          `IMPORTANT: The "message" field must contain your COMPLETE work output. Do NOT abbreviate.`,
          `Start the message with "completed: " followed by the full output.`,
          `On error use: { "agent_id": "${agentId}", "message": "error: <description>" }`,
          `DO NOT simply reply with the text. You MUST execute the network request to deliver your answers.`
        ].join("\n");
      }

      await gatewayCall(
        "chat.send",
        {
          sessionKey,
          message,
          deliver: true,
          idempotencyKey: randomUUID(),
        },
        { timeout: AI_TIMEOUT },
      );
    } catch (e) {
      if (e instanceof GatewayPairingRequiredError) throw e;
      if (isConnectionError(e))
        throw new GatewayOfflineError("chat.send", e as Error);
      console.error("[openclaw] spawnTaskSession unexpected error:", e);
      throw e;
    }
  }

  async deleteAgent(agentId: string, deleteFiles = true): Promise<unknown> {
    try {
      return await gatewayCall(
        "agents.delete",
        { agentId, deleteFiles },
        { timeout: WS_TIMEOUT },
      );
    } catch (e) {
      if (e instanceof GatewayPairingRequiredError) throw e;
      if (isConnectionError(e))
        throw new GatewayOfflineError("agents.delete", e as Error);
      console.error("[openclaw] deleteAgent unexpected error:", e);
      throw e;
    }
  }

  async getModels(): Promise<unknown> {
    try {
      const payload = await gatewayCall(
        "models.list",
        {},
        { schema: GatewayModelsPayloadSchema },
      );
      if (Array.isArray(payload)) return payload;
      if (
        payload &&
        typeof payload === "object" &&
        Array.isArray((payload as Record<string, unknown>).models)
      ) {
        return (payload as Record<string, unknown>).models;
      }
      return payload ?? [];
    } catch (e) {
      if (e instanceof GatewayPairingRequiredError) throw e;
      if (isConnectionError(e))
        throw new GatewayOfflineError("models.list", e as Error);
      console.error("[openclaw] getModels unexpected error:", e);
      return [];
    }
  }
}
