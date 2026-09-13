import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { healthRoutes } from "./routes/health.js";

export function buildApp(): FastifyInstance {
  const app = Fastify({
    logger: process.env["NODE_ENV"] === "test" ? false : true,
  });

  void app.register(healthRoutes, { prefix: "/api" });

  return app;
}
