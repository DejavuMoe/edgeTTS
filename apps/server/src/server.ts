import { createApp } from "./app.js";
import { createProductionDependencies } from "./composition.js";
import { registerGracefulShutdown } from "./shutdown.js";

const host = process.env["HOST"] ?? "127.0.0.1";
const port = Number(process.env["PORT"] ?? "8080");

const dependencies = createProductionDependencies();
const app = createApp(dependencies);

registerGracefulShutdown(app);

try {
  await app.listen({ host, port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
