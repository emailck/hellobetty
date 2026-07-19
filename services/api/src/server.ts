import { buildApp } from "./app.js";
import { config } from "./config.js";

const app = await buildApp();

if (config.isDevelopmentSecret) {
  app.log.warn("Using local development JWT secret");
}

const shutdown = async () => {
  await app.close();
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({ host: config.host, port: config.port });
