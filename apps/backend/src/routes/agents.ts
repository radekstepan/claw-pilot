import { FastifyPluginAsync } from "fastify";
import { getGateway, GatewayOfflineError } from "../gateway/index.js";
import { Agent } from "@claw-pilot/shared-types";
import { z } from "zod";
import { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { randomUUID } from "crypto";
import { enqueueAiJob, AI_PRIORITY_NORMAL } from "../services/aiQueue.js";

const agentRoutes: FastifyPluginAsyncZod = async (fastify, opts) => {
  fastify.get("/", async (request, reply) => {
    const gw = getGateway();
    try {
      const [agents, sessions] = await Promise.all([
        gw.getAgents(),
        gw.getLiveSessions(),
      ]);

      // Find active sessions that correspond to the agents
      const activeSessions = sessions.filter(
        (s) => s.status === "WORKING" || s.status === "IDLE",
      );

      const updatedAgents: Agent[] = agents.map((agent) => {
        const session = activeSessions.find(
          (s) => s.agent === agent.id || s.agentId === agent.id,
        );
        if (session) {
          return {
            ...agent,
            status: session.status === "WORKING" ? "WORKING" : "IDLE",
          };
        }
        return { ...agent, status: "OFFLINE" };
      });

      return updatedAgents;
    } catch (error) {
      if (error instanceof GatewayOfflineError) {
        fastify.log.warn(`[agents] ${error.message}`);
        return reply.status(503).send({
          error: "OpenClaw gateway is unreachable. Agents are unavailable.",
        });
      }
      fastify.log.error(error);
      return reply.status(500).send({ error: "Failed to fetch agents." });
    }
  });

  const GenerateAgentSchema = z.object({
    prompt: z.string(),
    model: z.string().optional(),
  });

  fastify.post(
    "/generate",
    {
      schema: { body: GenerateAgentSchema },
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const body = request.body as z.infer<typeof GenerateAgentSchema>;
      const { prompt, model } = body;
      const requestId = randomUUID();

      // Respond immediately — the generated config will arrive via Socket.io.
      reply.status(202).send({ requestId, status: "pending" });

      enqueueAiJob("generate-config", AI_PRIORITY_NORMAL, "generate-config", {
        requestId,
        prompt,
        model,
      });
    },
  );

  const DeployAgentSchema = z.object({
    name: z.string().min(1),
    capabilities: z.array(z.string()).optional(),
    model: z.string().optional(),
    workspace: z.string().min(1),
    // Behavioral files content
    soul: z.string().optional(),
    tools: z.string().optional(),
  });

  // POST /api/agents — deploys (creates) a new agent on the OpenClaw gateway.
  // Returns 202 immediately; emits agent_deployed or agent_deploy_error via Socket.io.
  fastify.post(
    "/",
    {
      schema: { body: DeployAgentSchema },
      config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const { name, workspace, model, capabilities, soul, tools } =
        request.body as z.infer<typeof DeployAgentSchema>;
      const requestId = randomUUID();

      reply.status(202).send({ requestId, status: "pending" });

      const gw = getGateway();
      void (async () => {
        try {
          // 1. Create the base agent entry and set model/capabilities
          await gw.createAgent(name, workspace, model, capabilities);

          // 2. Set SOUL/TOOLS/AGENTS files if provided
          if (soul !== undefined || tools !== undefined) {
            await gw.setAgentFiles(name, { soul, tools });
          }

          if (fastify.io) {
            fastify.io.emit("agent_deployed", { requestId, agentId: name });
          }
        } catch (error) {
          fastify.log.error(error, "createAgent failed");
          if (fastify.io) {
            fastify.io.emit("agent_deploy_error", {
              requestId,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      })();
    },
  );

  // PATCH /api/agents/:id — updates an agent's display name, model, capabilities, or files.
  // Synchronous (fast gateway RPC — no AI), returns 200 with updated agent list entry.
  const PatchAgentSchema = z
    .object({
      name: z.string().min(1).optional(),
      model: z.string().min(1).optional(),
      capabilities: z.array(z.string()).optional(),
      soul: z.string().optional(),
      tools: z.string().optional(),
    })
    .refine(
      (b) =>
        b.name !== undefined ||
        b.model !== undefined ||
        b.capabilities !== undefined ||
        b.soul !== undefined ||
        b.tools !== undefined,
      {
        message: "At least one field must be provided for update.",
      },
    );

  fastify.patch(
    "/:id",
    { schema: { body: PatchAgentSchema } },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as z.infer<typeof PatchAgentSchema>;
      const gw = getGateway();
      try {
        const { soul, tools, ...meta } = body;

        // 1. Update metadata (name, model, capabilities)
        if (Object.keys(meta).length > 0) {
          await gw.updateAgentMeta(id, meta);
        }

        // 2. Update behavioral files
        if (soul !== undefined || tools !== undefined) {
          await gw.setAgentFiles(id, { soul, tools });
        }

        // Re-fetch so the response reflects the updated state from the gateway.
        const [agents, sessions] = await Promise.all([
          gw.getAgents(),
          gw.getLiveSessions(),
        ]);
        const activeSessions = sessions.filter(
          (s) => s.status === "WORKING" || s.status === "IDLE",
        );
        const updated =
          agents.find((a) => a.id === id) ??
          agents.find((a) => a.name === body.name);
        if (!updated) return reply.send({ success: true });
        const session = activeSessions.find(
          (s) => s.agent === updated.id || s.agentId === updated.id,
        );
        const agentWithStatus: Agent = session
          ? {
              ...updated,
              status: session.status === "WORKING" ? "WORKING" : "IDLE",
            }
          : { ...updated, status: "OFFLINE" };
        return reply.send(agentWithStatus);
      } catch (error) {
        if (error instanceof GatewayOfflineError) {
          return reply
            .status(503)
            .send({ error: "OpenClaw gateway is unreachable." });
        }
        fastify.log.error(error);
        return reply.status(500).send({ error: "Failed to update agent." });
      }
    },
  );

  // DELETE /api/agents/:id — removes an agent from the gateway.
  fastify.delete("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const gw = getGateway();
    try {
      await gw.deleteAgent(id);
      return reply.send({ success: true });
    } catch (error) {
      if (error instanceof GatewayOfflineError) {
        return reply
          .status(503)
          .send({ error: "OpenClaw gateway is unreachable." });
      }
      fastify.log.error(error);
      return reply.status(500).send({ error: "Failed to delete agent." });
    }
  });

  fastify.get("/:id/files", async (request, reply) => {
    const { id } = request.params as { id: string };
    const gw = getGateway();
    try {
      const files = await gw.getAgentWorkspaceFiles(id);
      return reply.send(files);
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: "Failed to read agent files." });
    }
  });

  const UpdateAgentFilesSchema = z.object({
    soul: z.string().optional(),
    tools: z.string().optional(),
    agentsMd: z.string().optional(),
  });

  fastify.put(
    "/:id/files",
    { schema: { body: UpdateAgentFilesSchema } },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as z.infer<typeof UpdateAgentFilesSchema>;
      const gw = getGateway();
      try {
        await gw.setAgentFiles(id, body);
        return reply.send({ success: true });
      } catch (error) {
        fastify.log.error(error);
        return reply
          .status(500)
          .send({ error: "Failed to update agent files." });
      }
    },
  );
};

export default agentRoutes;
