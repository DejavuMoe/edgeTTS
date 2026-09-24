import type { FastifyInstance } from "fastify";
import { createApp } from "./app.js";
import { createProductionDependencies } from "./composition.js";
import { loadServerConfig, type ServerConfig } from "./config.js";
import { registerGracefulShutdown } from "./shutdown.js";

let config: ServerConfig;
let app: FastifyInstance;
try {
  config = loadServerConfig();
  app = createApp(createProductionDependencies(config.tts), config.app);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

registerGracefulShutdown(app);

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
