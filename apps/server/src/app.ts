import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { createAuthPreHandler, resolveApiKey } from "./auth.js";
import type { AppDependencies } from "./dependencies.js";
import { healthRoutes } from "./routes/health.js";
import { createSpeechRoutes } from "./routes/speech.js";
import { createVoicesRoutes } from "./routes/voices.js";
import { registerStaticHosting, type StaticHostingOptions } from "./static.js";

export interface AppOptions extends StaticHostingOptions {
  readonly apiKey?: string | null | undefined;
}

export function createApp(dependencies: AppDependencies, options?: AppOptions): FastifyInstance {
  const app = Fastify({
    logger: process.env["NODE_ENV"] === "test" ? false : true,
  });

  const validatedKey = resolveApiKey(options?.apiKey);
  const authPreHandler = validatedKey ? createAuthPreHandler(validatedKey) : null;

  void app.register(healthRoutes, { prefix: "/api" });
  void app.register(healthRoutes);

  void app.register(async (scope) => {
    if (authPreHandler) {
      scope.addHook("preHandler", authPreHandler);
    }
    void scope.register(createVoicesRoutes(dependencies.ttsService), { prefix: "/api" });
    void scope.register(createSpeechRoutes(dependencies.ttsService));
  });

  registerStaticHosting(app, options);

  return app;
}

export { createApp as buildApp };
