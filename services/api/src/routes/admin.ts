import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import type { AccountStore } from "../lib/account-store.js";
import { toPublicUser, USER_ROLES, USER_STATUSES } from "../domain/user.js";
import { SCHEDULE_UNITS } from "../domain/homework.js";
import {
  InvalidHomeworkStudentsError,
  InvalidHomeworkItemsError,
  InvalidPictureBookCardsError,
  ReviewSubmissionNotFoundError,
} from "../lib/account-store.js";
import type { AccessTokenPayload } from "../types/jwt.js";
import { config } from "../config.js";
import { getUploadKind, saveUpload } from "../lib/uploads.js";

interface UserListQuery {
  page?: string;
  pageSize?: string;
  search?: string;
}

interface PublishHomeworkBody {
  title: string;
  instructions?: string;
  studentIds: string[];
  templateType?:
    | "STANDARD"
    | "READ_ALOUD_PICTURE_BOOK"
    | "SENTENCE_READ_ALOUD"
    | "WORD_READ_ALOUD"
    | "WORD_IMAGE_MATCH"
    | "WORD_SCRAMBLE"
    | "WORD_FILL_BLANK";
  cards?: Array<{ imageUrl: string; sampleAudioUrl: string; referenceText: string }>;
  items?: Array<{
    promptText?: string;
    imageUrl?: string;
    sampleAudioUrl?: string;
    answerText?: string;
    choices?: string[];
  }>;
  schedule: {
    startsAt: string;
    unit: "DAY" | "WEEK";
    interval: number;
    occurrenceLimit: number;
  };
}

interface ReviewBody {
  grade: "A" | "B" | "C" | "D";
  feedbackAudioUrl?: string;
}

async function requireStaff(
  store: AccountStore,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  try {
    const token = await request.jwtVerify<AccessTokenPayload>();
    const user = store.findById(token.sub);
    if (
      !user ||
      user.status !== USER_STATUSES.ACTIVE ||
      (user.role !== USER_ROLES.ADMIN && user.role !== USER_ROLES.TEACHER)
    ) {
      return reply.code(403).send({
        code: "FORBIDDEN",
        message: "当前账号没有老师管理权限",
      });
    }
  } catch {
    return reply.code(401).send({
      code: "UNAUTHORIZED",
      message: "请先登录管理台",
    });
  }
}

export function createAdminRoutes(store: AccountStore) {
  return async function adminRoutes(app: FastifyInstance) {
  app.get<{ Querystring: UserListQuery }>(
    "/users",
    {
      preHandler: (request, reply) => requireStaff(store, request, reply),
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            page: { type: "string", pattern: "^[0-9]+$" },
            pageSize: { type: "string", pattern: "^[0-9]+$" },
            search: { type: "string", maxLength: 40 },
          },
        },
      },
    },
    async (request) => {
      const page = Math.max(1, Number(request.query.page ?? 1));
      const pageSize = Math.min(
        100,
        Math.max(1, Number(request.query.pageSize ?? 20)),
      );
      const search = request.query.search?.trim() ?? "";
      const { users, total, activeCount } = store.listStudents(
        page,
        pageSize,
        search,
      );

      return {
        users: users.map(toPublicUser),
        pagination: { page, pageSize, total },
        summary: { studentCount: total, activeCount },
      };
    },
  );

  app.get<{ Params: { studentId: string } }>(
    "/students/:studentId/learning-stats",
    {
      preHandler: (request, reply) => requireStaff(store, request, reply),
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["studentId"],
          properties: {
            studentId: { type: "string", minLength: 1, maxLength: 100 },
          },
        },
      },
    },
    async (request, reply) => {
      const student = store.findById(request.params.studentId);
      if (
        !student ||
        student.role !== USER_ROLES.STUDENT ||
        student.status !== USER_STATUSES.ACTIVE
      ) {
        return reply.code(404).send({
          code: "STUDENT_NOT_FOUND",
          message: "没有找到可查看的学生账号",
        });
      }
      return store.getLearningStats(student.id);
    },
  );

  app.post<{ Body: PublishHomeworkBody }>(
    "/homeworks",
    {
      preHandler: (request, reply) => requireStaff(store, request, reply),
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["title", "studentIds", "schedule"],
          properties: {
            title: { type: "string", minLength: 2, maxLength: 100 },
            instructions: { type: "string", maxLength: 2000 },
            templateType: {
              type: "string",
              enum: [
                "STANDARD",
                "READ_ALOUD_PICTURE_BOOK",
                "SENTENCE_READ_ALOUD",
                "WORD_READ_ALOUD",
                "WORD_IMAGE_MATCH",
                "WORD_SCRAMBLE",
                "WORD_FILL_BLANK",
              ],
            },
            cards: {
              type: "array",
              minItems: 1,
              maxItems: 80,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["imageUrl", "sampleAudioUrl", "referenceText"],
                properties: {
                  imageUrl: { type: "string", minLength: 1, maxLength: 500 },
                  sampleAudioUrl: { type: "string", minLength: 1, maxLength: 500 },
                  referenceText: { type: "string", minLength: 1, maxLength: 500 },
                },
              },
            },
            items: {
              type: "array",
              minItems: 1,
              maxItems: 100,
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  promptText: { type: "string", minLength: 1, maxLength: 500 },
                  imageUrl: { type: "string", minLength: 1, maxLength: 500 },
                  sampleAudioUrl: { type: "string", minLength: 1, maxLength: 500 },
                  answerText: { type: "string", minLength: 1, maxLength: 100 },
                  choices: {
                    type: "array",
                    minItems: 1,
                    maxItems: 20,
                    items: { type: "string", minLength: 1, maxLength: 100 },
                  },
                },
              },
            },
            studentIds: {
              type: "array",
              minItems: 1,
              maxItems: 200,
              items: { type: "string", minLength: 1 },
            },
            schedule: {
              type: "object",
              additionalProperties: false,
              required: ["startsAt", "unit", "interval", "occurrenceLimit"],
              properties: {
                startsAt: { type: "string", format: "date-time" },
                unit: { type: "string", enum: [SCHEDULE_UNITS.DAY, SCHEDULE_UNITS.WEEK] },
                interval: { type: "integer", minimum: 1, maximum: 52 },
                occurrenceLimit: { type: "integer", minimum: 1, maximum: 365 },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const token = await request.jwtVerify<AccessTokenPayload>();
      try {
        const homework = store.createPublishedHomework({
          publisherId: token.sub,
          title: request.body.title.trim(),
          instructions: request.body.instructions,
          studentIds: request.body.studentIds,
          schedule: request.body.schedule,
          templateType: request.body.templateType,
          cards: request.body.cards,
          items: request.body.items,
        });
        return reply.code(201).send({
          homework: {
            ...homework,
            targetCount: new Set(request.body.studentIds).size,
            occurrenceCount: store.getHomeworkOccurrenceCount(homework.id),
          },
        });
      } catch (error) {
        if (error instanceof InvalidHomeworkStudentsError) {
          return reply.code(400).send({
            code: "STUDENTS_NOT_ASSIGNABLE",
            message: "所选学生不存在、已停用或不是学生账号",
          });
        }
        if (error instanceof InvalidPictureBookCardsError) {
          return reply.code(400).send({
            code: "PICTURE_BOOK_CARDS_REQUIRED",
            message: "跟读绘本每页都需要图片、示范录音和跟读文本",
          });
        }
        if (error instanceof InvalidHomeworkItemsError) {
          return reply.code(400).send({
            code: "HOMEWORK_ITEMS_INVALID",
            message: "请检查练习条目必填内容、答案和选项",
          });
        }
        throw error;
      }
    },
  );

  app.post(
    "/uploads",
    { preHandler: (request, reply) => requireStaff(store, request, reply) },
    async (request, reply) => {
      const file = await request.file();
      if (!file) {
        return reply.code(400).send({
          code: "UPLOAD_REQUIRED",
          message: "请选择需要上传的图片或音频",
        });
      }
      if (!getUploadKind(file.mimetype)) {
        file.file.resume();
        return reply.code(400).send({
          code: "UNSUPPORTED_UPLOAD_TYPE",
          message: "只支持 JPG、PNG、WebP 图片和 MP3、WAV、M4A、WebM、OGG 音频",
        });
      }
      try {
        const uploaded = await saveUpload(file, config.uploadsPath, "assets");
        return reply.code(201).send(uploaded);
      } catch (error) {
        if (error instanceof Error && error.message === "UPLOAD_TOO_LARGE") {
          return reply.code(413).send({
            code: "UPLOAD_TOO_LARGE",
            message: "单个文件不能超过 20 MB",
          });
        }
        throw error;
      }
    },
  );

  app.get(
    "/homeworks",
    { preHandler: (request, reply) => requireStaff(store, request, reply) },
    async () => ({ homeworks: store.listPublishedHomeworks() }),
  );

  app.get(
    "/read-aloud-submissions",
    { preHandler: (request, reply) => requireStaff(store, request, reply) },
    async () => ({ submissions: store.listReadAloudSubmissions() }),
  );

  app.post<{ Params: { submissionId: string }; Body: ReviewBody }>(
    "/read-aloud-submissions/:submissionId/review",
    {
      preHandler: (request, reply) => requireStaff(store, request, reply),
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["grade"],
          properties: {
            grade: { type: "string", enum: ["A", "B", "C", "D"] },
            feedbackAudioUrl: { type: "string", minLength: 1, maxLength: 500 },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        return { submission: store.reviewReadingSubmission({
          submissionId: request.params.submissionId,
          grade: request.body.grade,
          feedbackAudioUrl: request.body.feedbackAudioUrl,
        }) };
      } catch (error) {
        if (error instanceof ReviewSubmissionNotFoundError) {
          return reply.code(404).send({
            code: "SUBMISSION_NOT_FOUND",
            message: "没有找到可批改的当前录音",
          });
        }
        throw error;
      }
    },
  );

  app.get(
    "/practice-recording-submissions",
    { preHandler: (request, reply) => requireStaff(store, request, reply) },
    async () => ({ submissions: store.listPracticeRecordingSubmissions() }),
  );

  app.post<{ Params: { submissionId: string }; Body: ReviewBody }>(
    "/practice-recording-submissions/:submissionId/review",
    {
      preHandler: (request, reply) => requireStaff(store, request, reply),
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["grade"],
          properties: {
            grade: { type: "string", enum: ["A", "B", "C", "D"] },
            feedbackAudioUrl: { type: "string", minLength: 1, maxLength: 500 },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        return {
          submission: store.reviewPracticeRecordingSubmission({
            submissionId: request.params.submissionId,
            grade: request.body.grade,
            feedbackAudioUrl: request.body.feedbackAudioUrl,
          }),
        };
      } catch (error) {
        if (error instanceof ReviewSubmissionNotFoundError) {
          return reply.code(404).send({
            code: "SUBMISSION_NOT_FOUND",
            message: "没有找到可批改的当前录音",
          });
        }
        throw error;
      }
    },
  );
  };
}
