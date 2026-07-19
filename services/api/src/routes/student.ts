import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AccountStore } from "../lib/account-store.js";
import {
  HomeworkAccessError,
  HomeworkSessionNotFoundError,
  InvalidCardSequenceError,
  InvalidItemSequenceError,
  InvalidItemSubmissionError,
  InvalidRecordingDurationError,
} from "../lib/account-store.js";
import { USER_ROLES, USER_STATUSES } from "../domain/user.js";
import type { AccessTokenPayload } from "../types/jwt.js";
import { config } from "../config.js";
import { getUploadKind, saveUpload } from "../lib/uploads.js";

function getRecordingDurationSeconds(fields: Record<string, unknown>): number | undefined {
  const rawField = fields.durationSeconds;
  if (rawField === undefined) return undefined;
  const field = Array.isArray(rawField) ? rawField[0] : rawField;
  if (!field || typeof field !== "object" || !("value" in field)) {
    throw new InvalidRecordingDurationError();
  }
  const value = Number((field as { value: unknown }).value);
  if (!Number.isFinite(value) || value <= 0) {
    throw new InvalidRecordingDurationError();
  }
  return Math.min(600, Math.max(1, Math.round(value)));
}

async function requireStudent(
  store: AccountStore,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  try {
    const token = await request.jwtVerify<AccessTokenPayload>();
    const user = store.findById(token.sub);
    if (!user || user.role !== USER_ROLES.STUDENT || user.status !== USER_STATUSES.ACTIVE) {
      return reply.code(403).send({ code: "FORBIDDEN", message: "当前账号不能完成学生作业" });
    }
  } catch {
    return reply.code(401).send({ code: "UNAUTHORIZED", message: "请先登录学生端" });
  }
}

export function createStudentRoutes(store: AccountStore) {
  return async function studentRoutes(app: FastifyInstance) {
    app.get(
      "/reading-homeworks",
      { preHandler: (request, reply) => requireStudent(store, request, reply) },
      async (request) => {
        const token = await request.jwtVerify<AccessTokenPayload>();
        return { occurrences: store.listStudentReadingOccurrences(token.sub) };
      },
    );

    app.get<{ Params: { occurrenceId: string } }>(
      "/reading-homeworks/:occurrenceId",
      { preHandler: (request, reply) => requireStudent(store, request, reply) },
      async (request, reply) => {
        const token = await request.jwtVerify<AccessTokenPayload>();
        try {
          return { occurrence: store.getStudentReadingOccurrence(request.params.occurrenceId, token.sub) };
        } catch (error) {
          if (error instanceof HomeworkAccessError) {
            return reply.code(404).send({ code: "HOMEWORK_NOT_FOUND", message: "没有找到这份绘本作业" });
          }
          throw error;
        }
      },
    );

    app.post<{ Params: { occurrenceId: string; cardId: string } }>(
      "/reading-homeworks/:occurrenceId/cards/:cardId/submissions",
      { preHandler: (request, reply) => requireStudent(store, request, reply) },
      async (request, reply) => {
        const token = await request.jwtVerify<AccessTokenPayload>();
        const file = await request.file();
        if (!file || getUploadKind(file.mimetype) !== "audio") {
          file?.file.resume();
          return reply.code(400).send({
            code: "AUDIO_REQUIRED",
            message: "请先录制一段音频再提交",
          });
        }
        try {
          const durationSeconds = getRecordingDurationSeconds(
            file.fields as Record<string, unknown>,
          );
          const uploaded = await saveUpload(file, config.uploadsPath, "submissions");
          const occurrence = store.submitReadingCard({
            occurrenceId: request.params.occurrenceId,
            cardId: request.params.cardId,
            studentId: token.sub,
            audioUrl: uploaded.url,
            durationSeconds,
          });
          return reply.code(201).send({ occurrence });
        } catch (error) {
          if (error instanceof HomeworkAccessError) {
            return reply.code(404).send({ code: "CARD_NOT_FOUND", message: "没有找到这张绘本卡片" });
          }
          if (error instanceof InvalidCardSequenceError) {
            return reply.code(409).send({ code: "CARD_LOCKED", message: "请先完成前一张卡片" });
          }
          if (error instanceof Error && error.message === "UPLOAD_TOO_LARGE") {
            return reply.code(413).send({ code: "UPLOAD_TOO_LARGE", message: "录音不能超过 20 MB" });
          }
          if (error instanceof InvalidRecordingDurationError) {
            file.file.resume();
            return reply.code(400).send({
              code: "DURATION_INVALID",
              message: "录音时长必须是正数",
            });
          }
          throw error;
        }
      },
    );

    app.get(
      "/practice-homeworks",
      { preHandler: (request, reply) => requireStudent(store, request, reply) },
      async (request) => {
        const token = await request.jwtVerify<AccessTokenPayload>();
        return { occurrences: store.listStudentPracticeOccurrences(token.sub) };
      },
    );

    app.get<{ Params: { occurrenceId: string } }>(
      "/practice-homeworks/:occurrenceId",
      { preHandler: (request, reply) => requireStudent(store, request, reply) },
      async (request, reply) => {
        const token = await request.jwtVerify<AccessTokenPayload>();
        try {
          return {
            occurrence: store.getStudentPracticeOccurrence(
              request.params.occurrenceId,
              token.sub,
            ),
          };
        } catch (error) {
          if (error instanceof HomeworkAccessError) {
            return reply.code(404).send({
              code: "HOMEWORK_NOT_FOUND",
              message: "没有找到这份练习",
            });
          }
          throw error;
        }
      },
    );

    app.post<{ Params: { occurrenceId: string; itemId: string } }>(
      "/practice-homeworks/:occurrenceId/items/:itemId/recordings",
      { preHandler: (request, reply) => requireStudent(store, request, reply) },
      async (request, reply) => {
        const token = await request.jwtVerify<AccessTokenPayload>();
        const file = await request.file();
        if (!file || getUploadKind(file.mimetype) !== "audio") {
          file?.file.resume();
          return reply.code(400).send({
            code: "AUDIO_REQUIRED",
            message: "请先录制一段音频再提交",
          });
        }
        try {
          const durationSeconds = getRecordingDurationSeconds(
            file.fields as Record<string, unknown>,
          );
          const uploaded = await saveUpload(file, config.uploadsPath, "submissions");
          const occurrence = store.submitPracticeRecording({
            occurrenceId: request.params.occurrenceId,
            itemId: request.params.itemId,
            studentId: token.sub,
            audioUrl: uploaded.url,
            durationSeconds,
          });
          return reply.code(201).send({ occurrence });
        } catch (error) {
          if (error instanceof HomeworkAccessError) {
            return reply.code(404).send({
              code: "ITEM_NOT_FOUND",
              message: "没有找到这个练习条目",
            });
          }
          if (error instanceof InvalidItemSequenceError) {
            return reply.code(409).send({
              code: "ITEM_LOCKED",
              message: "请先完成前一个练习",
            });
          }
          if (error instanceof InvalidItemSubmissionError) {
            return reply.code(409).send({
              code: "RECORDING_NOT_ALLOWED",
              message: "这个练习不接受录音答案",
            });
          }
          if (error instanceof Error && error.message === "UPLOAD_TOO_LARGE") {
            return reply.code(413).send({
              code: "UPLOAD_TOO_LARGE",
              message: "录音不能超过 20 MB",
            });
          }
          if (error instanceof InvalidRecordingDurationError) {
            file.file.resume();
            return reply.code(400).send({
              code: "DURATION_INVALID",
              message: "录音时长必须是正数",
            });
          }
          throw error;
        }
      },
    );

    app.post<{
      Params: { occurrenceId: string; itemId: string };
      Body: { answerText: string };
    }>(
      "/practice-homeworks/:occurrenceId/items/:itemId/answers",
      {
        preHandler: (request, reply) => requireStudent(store, request, reply),
        schema: {
          body: {
            type: "object",
            additionalProperties: false,
            required: ["answerText"],
            properties: {
              answerText: { type: "string", minLength: 1, maxLength: 100 },
            },
          },
        },
      },
      async (request, reply) => {
        const token = await request.jwtVerify<AccessTokenPayload>();
        try {
          const result = store.submitPracticeAnswer({
            occurrenceId: request.params.occurrenceId,
            itemId: request.params.itemId,
            studentId: token.sub,
            answerText: request.body.answerText,
          });
          return reply.code(201).send(result);
        } catch (error) {
          if (error instanceof HomeworkAccessError) {
            return reply.code(404).send({
              code: "ITEM_NOT_FOUND",
              message: "没有找到这个练习条目",
            });
          }
          if (error instanceof InvalidItemSequenceError) {
            return reply.code(409).send({
              code: "ITEM_LOCKED",
              message: "请先答对前一个练习",
            });
          }
          if (error instanceof InvalidItemSubmissionError) {
            return reply.code(409).send({
              code: "ANSWER_NOT_ALLOWED",
              message: "这个练习不接受文字答案",
            });
          }
          throw error;
        }
      },
    );

    app.post<{ Body: { occurrenceId: string } }>(
      "/homework-sessions",
      {
        preHandler: (request, reply) => requireStudent(store, request, reply),
        schema: {
          body: {
            type: "object",
            additionalProperties: false,
            required: ["occurrenceId"],
            properties: {
              occurrenceId: { type: "string", minLength: 1, maxLength: 100 },
            },
          },
        },
      },
      async (request, reply) => {
        const token = await request.jwtVerify<AccessTokenPayload>();
        try {
          return {
            session: store.startHomeworkSession({
              occurrenceId: request.body.occurrenceId,
              studentId: token.sub,
            }),
          };
        } catch (error) {
          if (error instanceof HomeworkAccessError) {
            return reply.code(404).send({
              code: "HOMEWORK_NOT_FOUND",
              message: "没有找到可开始的作业",
            });
          }
          throw error;
        }
      },
    );

    app.post<{ Params: { sessionId: string } }>(
      "/homework-sessions/:sessionId/complete",
      { preHandler: (request, reply) => requireStudent(store, request, reply) },
      async (request, reply) => {
        const token = await request.jwtVerify<AccessTokenPayload>();
        try {
          return {
            session: store.completeHomeworkSession({
              sessionId: request.params.sessionId,
              studentId: token.sub,
            }),
          };
        } catch (error) {
          if (error instanceof HomeworkSessionNotFoundError) {
            return reply.code(404).send({
              code: "SESSION_NOT_FOUND",
              message: "没有找到这次学习记录",
            });
          }
          throw error;
        }
      },
    );

    app.get(
      "/learning-stats",
      { preHandler: (request, reply) => requireStudent(store, request, reply) },
      async (request) => {
        const token = await request.jwtVerify<AccessTokenPayload>();
        return store.getLearningStats(token.sub);
      },
    );
  };
}
