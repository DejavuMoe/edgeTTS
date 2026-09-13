import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import type { AppDependencies } from "./dependencies.js";
import { healthRoutes } from "./routes/health.js";
import { createVoicesRoutes } from "./routes/voices.js";

export function createApp(dependencies: AppDependencies): FastifyInstance {
  const app = Fastify({
    logger: process.env["NODE_ENV"] === "test" ? false : true,
  });

  void app.register(healthRoutes, { prefix: "/api" });
  void app.register(createVoicesRoutes(dependencies.ttsService), { prefix: "/api" });

  return app;
}

export { createApp as buildApp };
