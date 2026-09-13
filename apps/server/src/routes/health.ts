import type { FastifyPluginAsync } from "fastify";
import type { HealthResponse } from "@edgetts/shared";
import { HealthResponseSchema } from "@edgetts/shared";

export const healthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/health", async (_request, reply): Promise<HealthResponse> => {
    const payload: HealthResponse = { status: "ok" };
    HealthResponseSchema.parse(payload);
    return reply.code(200).type("application/json").send(payload);
  });
};
