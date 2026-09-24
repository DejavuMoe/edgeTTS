import Fastify from "fastify";
import type { FastifyInstance, FastifyServerOptions } from "fastify";
import fastifyRateLimit from "@fastify/rate-limit";
import { createAuthPreHandler, resolveAuthConfiguration } from "./auth.js";
import type { AppDependencies } from "./dependencies.js";
import {
  createSpeechRateLimiter,
  RateLimitedError,
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
  /** Defaults to disabled under NODE_ENV=test and enabled otherwise. */
  readonly logger?: FastifyServerOptions["logger"] | undefined;
}

export function createApp(dependencies: AppDependencies, options?: AppOptions): FastifyInstance {
  const app = Fastify({
    logger: options?.logger ?? process.env["NODE_ENV"] !== "test",
  });

  const validatedKey = resolveAuthConfiguration(options);
  const authPreHandler = validatedKey ? createAuthPreHandler(validatedKey) : null;
  const rateLimitConfig = resolveSpeechRateLimitConfig(options?.speechRateLimit);

  app.addHook("onSend", async (_request, reply) => {
    reply.header("X-Frame-Options", "SAMEORIGIN");
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "strict-origin-when-cross-origin");
    reply.header("Permissions-Policy", "microphone=(), camera=(), geolocation=()");
    reply.header(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'self'; form-action 'self'",
    );
  });

  void app.register(fastifyRateLimit, { global: false });

  app.setErrorHandler((error, request, reply) => {
    const candidate =
      typeof error === "object" && error !== null && "statusCode" in error
        ? Number((error as { statusCode?: unknown }).statusCode)
        : reply.statusCode;

    const statusCode =
      Number.isInteger(candidate) && candidate >= 400 && candidate <= 599 ? candidate : 500;
    const [code, message] =
      statusCode >= 500
        ? ["INTERNAL_ERROR", "Internal server error"]
        : statusCode === 429
          ? [
              "RATE_LIMITED",
              error instanceof RateLimitedError ? error.message : "Too many requests",
            ]
          : statusCode === 413
            ? ["PAYLOAD_TOO_LARGE", "Request body is too large"]
            : statusCode === 415
              ? ["UNSUPPORTED_MEDIA_TYPE", "Unsupported content type"]
              : ["INVALID_REQUEST", "Invalid request"];
    // Parser and plugin errors can contain user input; log only the status.
    if (statusCode >= 500) request.log.error({ statusCode }, "Unhandled request error");
    return reply.code(statusCode).type("application/json").send({ error: { code, message } });
  });

  void app.register(healthRoutes, { prefix: "/api" });
  void app.register(healthRoutes);

  void app.register(async (scope) => {
    if (authPreHandler) {
      scope.addHook("preHandler", authPreHandler);
    }
    const voicesLimiter = scope.rateLimit({
      max: 60,
      timeWindow: 60_000,
      keyGenerator: () => "voices-global",
      errorResponseBuilder: (_request, context) =>
        new RateLimitedError("Too many voice requests", context.statusCode),
    });
    void scope.register(createVoicesRoutes(dependencies.ttsService, voicesLimiter), {
      prefix: "/api",
    });

    const speechLimiter = createSpeechRateLimiter(scope, rateLimitConfig);
    void scope.register(
      createSpeechRoutes(dependencies.ttsService, { rateLimiter: speechLimiter }),
    );
  });

  if (!registerStaticHosting(app, options)) {
    app.setNotFoundHandler((_request, reply) =>
      reply.code(404).send({ error: { code: "NOT_FOUND", message: "Route not found" } }),
    );
  }

  return app;
}
