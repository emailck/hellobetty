import Fastify, { type FastifyError } from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import multipart from "@fastify/multipart";
import statik from "@fastify/static";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "./config.js";
import { createAuthRoutes } from "./routes/auth.js";
import { createAdminRoutes } from "./routes/admin.js";
import { createStudentRoutes } from "./routes/student.js";
import { createMediaRoutes } from "./routes/media.js";
import { AccountStore } from "./lib/account-store.js";
import { SpeechAssessmentWorker } from "./lib/speech-assessment-worker.js";
import type { SpeechAssessmentProvider } from "./domain/speech-assessment.js";

interface BuildAppOptions {
  speechAssessmentProvider?: SpeechAssessmentProvider;
  speechAssessmentPollIntervalMs?: number;
}

export async function buildApp(
  store = new AccountStore(config.databasePath),
  options: BuildAppOptions = {},
) {
  const app = Fastify({ logger: process.env.NODE_ENV !== "test" });
  const speechAssessmentWorker = new SpeechAssessmentWorker(
    store,
    options.speechAssessmentProvider ?? null,
    config.uploadsPath,
    options.speechAssessmentPollIntervalMs,
  );

  await app.register(cors, { origin: true });
  await app.register(jwt, { secret: config.jwtSecret });
  await app.register(multipart, { limits: { files: 1, fileSize: 20 * 1024 * 1024 } });
  const assetsPath = resolve(config.uploadsPath, "assets");
  mkdirSync(assetsPath, { recursive: true });
  await app.register(statik, { root: assetsPath, prefix: "/uploads/assets/" });
  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("Cache-Control", "no-store");
    return payload;
  });

  app.get("/health", async () => ({ status: "ok" }));
  await app.register(createMediaRoutes(store));
  await app.register(createAuthRoutes(store), { prefix: "/api/auth" });
  await app.register(createAdminRoutes(store, { speechAssessmentProvider: options.speechAssessmentProvider ?? null }), { prefix: "/api/admin" });
  await app.register(createStudentRoutes(store), { prefix: "/api/student" });
  speechAssessmentWorker.start();
  app.addHook("onClose", async () => {
    await speechAssessmentWorker.stop();
    store.close();
  });

  app.setErrorHandler((error: FastifyError, _request, reply) => {
    if (error.validation) {
      return reply.code(400).send({
        code: "VALIDATION_ERROR",
        message: "请检查填写内容",
      });
    }
    app.log.error(error);
    return reply.code(error.statusCode ?? 500).send({
      code: "INTERNAL_ERROR",
      message: "服务暂时不可用，请稍后再试",
    });
  });

  return app;
}
