import { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { getGateway, GatewayOfflineError } from "../gateway/index.js";
import { env } from "../config/env.js";

const modelRoutes: FastifyPluginAsyncZod = async (fastify, opts) => {
  fastify.get("/", async (request, reply) => {
    const gw = getGateway();
    try {
      const models = await gw.getModels();
      return models;
    } catch (error) {
      if (error instanceof GatewayOfflineError) {
        fastify.log.warn(`[models] ${(error as Error).message}`);
        return reply.status(503).send({
          error: "OpenClaw gateway is unreachable. Model list unavailable.",
          gatewayUrl: env.GATEWAY_URL,
        });
      }
      fastify.log.error(error);
      return reply.status(500).send({ error: "Failed to fetch models." });
    }
  });
};

export default modelRoutes;
