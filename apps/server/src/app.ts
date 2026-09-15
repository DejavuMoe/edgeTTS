import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import fastifyRateLimit from "@fastify/rate-limit";
import { createAuthPreHandler, resolveAuthConfiguration } from "./auth.js";
import type { AppDependencies } from "./dependencies.js";
import {
  createSpeechRateLimiter,
  RATE_LIMITED_ERROR,
  resolveSpeechRateLimitConfig,
  type SpeechRateLimitOptions,
} from "./rate-limit.js";
import { healthRoutes } from "./routes/health.js";
import { createSpeechRoutes } from "./routes/speech.js";
import { createVoicesRoutes } from "./routes/voices.js";
import { registerStaticHosting, type StaticHostingOptions } from "./static.js";

export interface AppOptions extends StaticHostingOptions {
  readonly apiKey?: string | null | undefined;
  readonly requireApiKey?: boolean | string | undefined;
  readonly speechRateLimit?: SpeechRateLimitOptions | undefined;
}

export function createApp(dependencies: AppDependencies, options?: AppOptions): FastifyInstance {
  const app = Fastify({
    logger: process.env["NODE_ENV"] === "test" ? false : true,
  });

  const validatedKey = resolveAuthConfiguration(options);
  const authPreHandler = validatedKey ? createAuthPreHandler(validatedKey) : null;
  const rateLimitConfig = resolveSpeechRateLimitConfig(options?.speechRateLimit);

  app.addHook("onSend", async (_request, reply) => {
    reply.header("X-Frame-Options", "SAMEORIGIN");
  });

  void app.register(fastifyRateLimit, { global: false });

  app.setErrorHandler((error, request, reply) => {
    const statusCode =
      typeof error === "object" && error !== null && "statusCode" in error
        ? Number((error as { statusCode?: unknown }).statusCode)
        : reply.statusCode;

    if (statusCode === 429 || reply.statusCode === 429) {
      request.log.warn(
        {
          url: request.raw.url,
          method: request.raw.method,
        },
        "Speech rate limit exceeded",
      );
      return reply.code(429).type("application/json").send(RATE_LIMITED_ERROR);
    }
    return reply.send(error);
  });

  void app.register(healthRoutes, { prefix: "/api" });
  void app.register(healthRoutes);

  void app.register(async (scope) => {
    if (authPreHandler) {
      scope.addHook("preHandler", authPreHandler);
    }
    void scope.register(createVoicesRoutes(dependencies.ttsService), { prefix: "/api" });

    const speechLimiter = createSpeechRateLimiter(scope, rateLimitConfig);
    void scope.register(
      createSpeechRoutes(dependencies.ttsService, { rateLimiter: speechLimiter }),
    );
  });

  registerStaticHosting(app, options);

  return app;
}

export { createApp as buildApp };
