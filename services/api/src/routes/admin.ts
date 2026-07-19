import { rmSync } from "node:fs";
import { resolve } from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AccountStore, StaffScope } from "../lib/account-store.js";
import { toPublicUser, normalizePhone, isValidPhone, USER_ROLES, USER_STATUSES } from "../domain/user.js";
import { HOMEWORK_STATUS, SCHEDULE_UNITS } from "../domain/homework.js";
import {
  ClassroomAccessError,
  DuplicatePhoneError,
  InvalidClassroomMembershipError,
  InvalidFeedbackAudioUrlError,
  InvalidHomeworkStatusTransitionError,
  InvalidHomeworkStudentsError,
  InvalidHomeworkItemsError,
  InvalidPictureBookCardsError,
  ReviewSubmissionNotFoundError,
  SpeechAssessmentAccessError,
  SpeechAssessmentRetryError,
} from "../lib/account-store.js";
import type { SpeechAssessmentProvider } from "../domain/speech-assessment.js";
import type { AccessTokenPayload } from "../types/jwt.js";
import { config } from "../config.js";
import { getUploadKind, saveUpload } from "../lib/uploads.js";
import { hashPassword } from "../security/password.js";

interface UserListQuery {
  page?: string;
  pageSize?: string;
  search?: string;
  role?: "TEACHER" | "STUDENT";
}

interface PublishHomeworkBody {
  title: string;
  instructions?: string;
  classroomId?: string | null;
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

interface AdminRouteOptions {
  speechAssessmentProvider?: SpeechAssessmentProvider | null;
}

function getScope(user: { id: string; role: string }): StaffScope {
  return { userId: user.id, role: user.role };
}

function getMultipartFieldValue(fields: Record<string, unknown>, name: string): string | null {
  const raw = fields[name];
  const field = Array.isArray(raw) ? raw[0] : raw;
  if (!field || typeof field !== "object" || !("value" in field)) return null;
  const value = (field as { value: unknown }).value;
  return typeof value === "string" ? value : null;
}

async function getStaffUser(
  store: AccountStore,
  request: FastifyRequest,
) {
  const token = await request.jwtVerify<AccessTokenPayload>();
  const user = store.findById(token.sub);
  if (
    !user ||
    user.status !== USER_STATUSES.ACTIVE ||
    (user.role !== USER_ROLES.ADMIN && user.role !== USER_ROLES.TEACHER)
  ) {
    return null;
  }
  return user;
}

async function requireStaff(
  store: AccountStore,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  try {
    const user = await getStaffUser(store, request);
    if (!user) {
      return reply.code(403).send({ code: "FORBIDDEN", message: "当前账号没有老师管理权限" });
    }
  } catch {
    return reply.code(401).send({ code: "UNAUTHORIZED", message: "请先登录管理台" });
  }
}

async function requireAdmin(
  store: AccountStore,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  try {
    const user = await getStaffUser(store, request);
    if (!user || user.role !== USER_ROLES.ADMIN) {
      return reply.code(403).send({ code: "FORBIDDEN", message: "只有管理员可以操作" });
    }
  } catch {
    return reply.code(401).send({ code: "UNAUTHORIZED", message: "请先登录管理台" });
  }
}

const paginationQuerySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    page: { type: "string", pattern: "^[0-9]+$" },
    pageSize: { type: "string", pattern: "^[0-9]+$" },
    search: { type: "string", maxLength: 40 },
    role: { type: "string", enum: ["TEACHER", "STUDENT"] },
  },
} as const;

export function createAdminRoutes(store: AccountStore, options: AdminRouteOptions = {}) {
  return async function adminRoutes(app: FastifyInstance) {
    app.get("/context", { preHandler: (request, reply) => requireStaff(store, request, reply) }, async (request) => {
      const user = (await getStaffUser(store, request))!;
      return {
        user: toPublicUser(user),
        speechAssessment: {
          configured: Boolean(options.speechAssessmentProvider),
          provider: options.speechAssessmentProvider?.id ?? null,
        },
      };
    });

    app.get<{ Querystring: UserListQuery }>(
      "/users",
      { preHandler: (request, reply) => requireStaff(store, request, reply), schema: { querystring: paginationQuerySchema } },
      async (request) => {
        const user = (await getStaffUser(store, request))!;
        const page = Math.max(1, Number(request.query.page ?? 1));
        const pageSize = Math.min(100, Math.max(1, Number(request.query.pageSize ?? 20)));
        const search = request.query.search?.trim() ?? "";
        const result = store.listAdminUsers({
          page,
          pageSize,
          search,
          role: request.query.role,
          scope: getScope(user),
        });
        return {
          users: result.users.map(toPublicUser),
          pagination: { page, pageSize, total: result.total },
          summary: {
            accountCount: result.total,
            studentCount: result.studentCount,
            teacherCount: result.teacherCount,
            activeCount: result.activeCount,
          },
        };
      },
    );

    app.post<{ Body: { phone: string; displayName: string; password: string; role: "TEACHER" | "STUDENT" } }>(
      "/users",
      {
        preHandler: (request, reply) => requireAdmin(store, request, reply),
        schema: {
          body: {
            type: "object",
            additionalProperties: false,
            required: ["phone", "displayName", "password", "role"],
            properties: {
              phone: { type: "string", minLength: 1, maxLength: 30 },
              displayName: { type: "string", minLength: 2, maxLength: 24 },
              password: { type: "string", minLength: 8, maxLength: 72 },
              role: { type: "string", enum: [USER_ROLES.TEACHER, USER_ROLES.STUDENT] },
            },
          },
        },
      },
      async (request, reply) => {
        const phone = normalizePhone(request.body.phone);
        if (!isValidPhone(phone)) return reply.code(400).send({ code: "INVALID_PHONE", message: "请输入有效手机号" });
        try {
          const user = store.createUser({
            phone,
            displayName: request.body.displayName.trim(),
            passwordHash: await hashPassword(request.body.password),
            role: request.body.role,
          });
          return reply.code(201).send({ user: toPublicUser(user) });
        } catch (error) {
          if (error instanceof DuplicatePhoneError) {
            return reply.code(409).send({ code: "PHONE_ALREADY_REGISTERED", message: "这个手机号已经注册" });
          }
          throw error;
        }
      },
    );

    app.patch<{ Params: { userId: string }; Body: { status: "ACTIVE" | "DISABLED" } }>(
      "/users/:userId/status",
      {
        preHandler: (request, reply) => requireAdmin(store, request, reply),
        schema: {
          params: { type: "object", additionalProperties: false, required: ["userId"], properties: { userId: { type: "string", minLength: 1 } } },
          body: { type: "object", additionalProperties: false, required: ["status"], properties: { status: { type: "string", enum: ["ACTIVE", "DISABLED"] } } },
        },
      },
      async (request, reply) => {
        const current = (await getStaffUser(store, request))!;
        if (request.params.userId === current.id && request.body.status === USER_STATUSES.DISABLED) {
          return reply.code(400).send({ code: "CANNOT_DISABLE_SELF", message: "不能停用当前管理员账号" });
        }
        const updated = store.updateUserStatus({ userId: request.params.userId, status: request.body.status });
        if (!updated) return reply.code(404).send({ code: "USER_NOT_FOUND", message: "没有找到账号" });
        return { user: toPublicUser(updated) };
      },
    );

    app.get("/point-policies", { preHandler: (request, reply) => requireStaff(store, request, reply) }, async (request) => {
      const user = (await getStaffUser(store, request))!;
      return { policies: store.listPointPolicies(getScope(user)) };
    });

    app.put<{
      Params: { classroomId: string };
      Body: {
        dailyCheckinPoints: number;
        homeworkCompletionPoints: number;
        streakRewards?: Array<{ days: number; points: number }>;
      };
    }>(
      "/classrooms/:classroomId/point-policy",
      {
        preHandler: (request, reply) => requireStaff(store, request, reply),
        schema: {
          params: {
            type: "object",
            additionalProperties: false,
            required: ["classroomId"],
            properties: { classroomId: { type: "string", minLength: 1 } },
          },
          body: {
            type: "object",
            additionalProperties: false,
            required: ["dailyCheckinPoints", "homeworkCompletionPoints"],
            properties: {
              dailyCheckinPoints: { type: "integer", minimum: 0, maximum: 100 },
              homeworkCompletionPoints: { type: "integer", minimum: 0, maximum: 500 },
              streakRewards: {
                type: "array",
                maxItems: 20,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["days", "points"],
                  properties: {
                    days: { type: "integer", minimum: 2, maximum: 365 },
                    points: { type: "integer", minimum: 1, maximum: 1000 },
                  },
                },
              },
            },
          },
        },
      },
      async (request, reply) => {
        const rewards = request.body.streakRewards ?? [];
        if (new Set(rewards.map((reward) => reward.days)).size !== rewards.length) {
          return reply.code(400).send({ code: "INVALID_POINT_POLICY", message: "连续奖励天数不能重复" });
        }
        const user = (await getStaffUser(store, request))!;
        const policy = store.replaceClassroomPointPolicy({
          classroomId: request.params.classroomId,
          scope: getScope(user),
          dailyCheckinPoints: request.body.dailyCheckinPoints,
          homeworkCompletionPoints: request.body.homeworkCompletionPoints,
          streakRewards: rewards,
        });
        if (!policy) {
          return reply.code(404).send({ code: "CLASSROOM_NOT_FOUND", message: "没有找到可配置的班级" });
        }
        return { policy };
      },
    );

    app.get("/classrooms", { preHandler: (request, reply) => requireStaff(store, request, reply) }, async (request) => {
      const user = (await getStaffUser(store, request))!;
      return { classrooms: store.listClassrooms(getScope(user)) };
    });

    app.post<{ Body: { name: string; teacherIds?: string[]; studentIds?: string[] } }>(
      "/classrooms",
      {
        preHandler: (request, reply) => requireAdmin(store, request, reply),
        schema: {
          body: {
            type: "object",
            additionalProperties: false,
            required: ["name"],
            properties: {
              name: { type: "string", minLength: 1, maxLength: 80 },
              teacherIds: { type: "array", maxItems: 100, items: { type: "string", minLength: 1 } },
              studentIds: { type: "array", maxItems: 500, items: { type: "string", minLength: 1 } },
            },
          },
        },
      },
      async (request, reply) => {
        const admin = (await getStaffUser(store, request))!;
        try {
          const classroom = store.createClassroom({
            creatorId: admin.id,
            name: request.body.name,
            teacherIds: request.body.teacherIds ?? [],
            studentIds: request.body.studentIds ?? [],
          });
          return reply.code(201).send({ classroom });
        } catch (error) {
          if (error instanceof InvalidClassroomMembershipError) {
            return reply.code(400).send({ code: "INVALID_CLASSROOM_MEMBERS", message: "班级成员必须是已启用的老师或学生" });
          }
          throw error;
        }
      },
    );

    app.patch<{ Params: { classroomId: string }; Body: { name?: string; status?: "ACTIVE" | "ARCHIVED"; teacherIds?: string[]; studentIds?: string[] } }>(
      "/classrooms/:classroomId",
      {
        preHandler: (request, reply) => requireAdmin(store, request, reply),
        schema: {
          params: { type: "object", additionalProperties: false, required: ["classroomId"], properties: { classroomId: { type: "string", minLength: 1 } } },
          body: {
            type: "object",
            additionalProperties: false,
            properties: {
              name: { type: "string", minLength: 1, maxLength: 80 },
              status: { type: "string", enum: ["ACTIVE", "ARCHIVED"] },
              teacherIds: { type: "array", maxItems: 100, items: { type: "string", minLength: 1 } },
              studentIds: { type: "array", maxItems: 500, items: { type: "string", minLength: 1 } },
            },
          },
        },
      },
      async (request, reply) => {
        try {
          const classroom = store.updateClassroom({ classroomId: request.params.classroomId, ...request.body });
          if (!classroom) return reply.code(404).send({ code: "CLASSROOM_NOT_FOUND", message: "没有找到班级" });
          return { classroom };
        } catch (error) {
          if (error instanceof InvalidClassroomMembershipError) {
            return reply.code(400).send({ code: "INVALID_CLASSROOM_MEMBERS", message: "班级成员必须是已启用的老师或学生" });
          }
          throw error;
        }
      },
    );

    app.get<{ Params: { studentId: string } }>(
      "/students/:studentId/learning-stats",
      {
        preHandler: (request, reply) => requireStaff(store, request, reply),
        schema: { params: { type: "object", additionalProperties: false, required: ["studentId"], properties: { studentId: { type: "string", minLength: 1, maxLength: 100 } } } },
      },
      async (request, reply) => {
        const staff = (await getStaffUser(store, request))!;
        const student = store.findById(request.params.studentId);
        if (!student || student.role !== USER_ROLES.STUDENT || student.status !== USER_STATUSES.ACTIVE || !store.canStaffAccessStudent(getScope(staff), student.id)) {
          return reply.code(404).send({ code: "STUDENT_NOT_FOUND", message: "没有找到可查看的学生账号" });
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
              classroomId: { anyOf: [{ type: "string", minLength: 1, maxLength: 100 }, { type: "null" }] },
              templateType: { type: "string", enum: ["STANDARD", "READ_ALOUD_PICTURE_BOOK", "SENTENCE_READ_ALOUD", "WORD_READ_ALOUD", "WORD_IMAGE_MATCH", "WORD_SCRAMBLE", "WORD_FILL_BLANK"] },
              cards: { type: "array", minItems: 1, maxItems: 80, items: { type: "object", additionalProperties: false, required: ["imageUrl", "sampleAudioUrl", "referenceText"], properties: { imageUrl: { type: "string", minLength: 1, maxLength: 500 }, sampleAudioUrl: { type: "string", minLength: 1, maxLength: 500 }, referenceText: { type: "string", minLength: 1, maxLength: 500 } } } },
              items: { type: "array", minItems: 1, maxItems: 100, items: { type: "object", additionalProperties: false, properties: { promptText: { type: "string", minLength: 1, maxLength: 500 }, imageUrl: { type: "string", minLength: 1, maxLength: 500 }, sampleAudioUrl: { type: "string", minLength: 1, maxLength: 500 }, answerText: { type: "string", minLength: 1, maxLength: 100 }, choices: { type: "array", minItems: 1, maxItems: 20, items: { type: "string", minLength: 1, maxLength: 100 } } } } },
              studentIds: { type: "array", minItems: 1, maxItems: 200, items: { type: "string", minLength: 1 } },
              schedule: { type: "object", additionalProperties: false, required: ["startsAt", "unit", "interval", "occurrenceLimit"], properties: { startsAt: { type: "string", format: "date-time" }, unit: { type: "string", enum: [SCHEDULE_UNITS.DAY, SCHEDULE_UNITS.WEEK] }, interval: { type: "integer", minimum: 1, maximum: 52 }, occurrenceLimit: { type: "integer", minimum: 1, maximum: 365 } } },
            },
          },
        },
      },
      async (request, reply) => {
        const user = (await getStaffUser(store, request))!;
        try {
          const homework = store.createPublishedHomework({
            publisherId: user.id,
            classroomId: request.body.classroomId,
            staffRole: user.role,
            title: request.body.title.trim(),
            instructions: request.body.instructions,
            studentIds: request.body.studentIds,
            schedule: request.body.schedule,
            templateType: request.body.templateType,
            cards: request.body.cards,
            items: request.body.items,
          });
          return reply.code(201).send({ homework: { ...homework, targetCount: new Set(request.body.studentIds).size, occurrenceCount: store.getHomeworkOccurrenceCount(homework.id), completedOccurrenceCount: 0 } });
        } catch (error) {
          if (error instanceof ClassroomAccessError) return reply.code(403).send({ code: "CLASSROOM_NOT_ALLOWED", message: "请选择可管理的有效班级" });
          if (error instanceof InvalidHomeworkStudentsError) return reply.code(400).send({ code: "STUDENTS_NOT_ASSIGNABLE", message: "所选学生不属于班级、已停用或不是学生账号" });
          if (error instanceof InvalidPictureBookCardsError) return reply.code(400).send({ code: "PICTURE_BOOK_CARDS_REQUIRED", message: "跟读绘本每页都需要图片、示范录音和跟读文本" });
          if (error instanceof InvalidHomeworkItemsError) return reply.code(400).send({ code: "HOMEWORK_ITEMS_INVALID", message: "请检查练习条目必填内容、答案和选项" });
          throw error;
        }
      },
    );

    app.patch<{ Params: { homeworkId: string }; Body: { status: "PUBLISHED" | "PAUSED" | "ARCHIVED" } }>(
      "/homeworks/:homeworkId/status",
      {
        preHandler: (request, reply) => requireStaff(store, request, reply),
        schema: { params: { type: "object", additionalProperties: false, required: ["homeworkId"], properties: { homeworkId: { type: "string", minLength: 1 } } }, body: { type: "object", additionalProperties: false, required: ["status"], properties: { status: { type: "string", enum: [HOMEWORK_STATUS.PUBLISHED, HOMEWORK_STATUS.PAUSED, HOMEWORK_STATUS.ARCHIVED] } } } },
      },
      async (request, reply) => {
        const user = (await getStaffUser(store, request))!;
        try {
          const homework = store.updateHomeworkStatus({ homeworkId: request.params.homeworkId, status: request.body.status, scope: getScope(user) });
          if (!homework) return reply.code(404).send({ code: "HOMEWORK_NOT_FOUND", message: "没有找到作业" });
          return { homework };
        } catch (error) {
          if (error instanceof InvalidHomeworkStatusTransitionError) return reply.code(409).send({ code: "INVALID_HOMEWORK_STATUS", message: "作业状态不能这样切换" });
          throw error;
        }
      },
    );

    app.post("/uploads", { preHandler: (request, reply) => requireStaff(store, request, reply) }, async (request, reply) => {
      const file = await request.file();
      if (!file) return reply.code(400).send({ code: "UPLOAD_REQUIRED", message: "请选择需要上传的图片或音频" });
      const kind = getUploadKind(file.mimetype);
      if (!kind) {
        file.file.resume();
        return reply.code(400).send({ code: "UNSUPPORTED_UPLOAD_TYPE", message: "只支持 JPG、PNG、WebP 图片和 MP3、WAV、M4A、WebM、OGG 音频" });
      }
      const purpose = getMultipartFieldValue(file.fields as Record<string, unknown>, "purpose") ?? "ASSET";
      if (purpose !== "ASSET" && purpose !== "FEEDBACK") {
        file.file.resume();
        return reply.code(400).send({ code: "INVALID_UPLOAD_PURPOSE", message: "上传用途不支持" });
      }
      if (purpose === "FEEDBACK" && kind !== "audio") {
        file.file.resume();
        return reply.code(400).send({ code: "FEEDBACK_AUDIO_REQUIRED", message: "点评反馈只能上传音频" });
      }
      try {
        const directory = purpose === "FEEDBACK" ? "feedback" : "assets";
        const uploaded = await saveUpload(file, config.uploadsPath, directory);
        if (purpose === "FEEDBACK") {
          try {
            const staff = (await getStaffUser(store, request))!;
            store.registerFeedbackUpload({ url: uploaded.url, uploaderId: staff.id });
          } catch (error) {
            rmSync(resolve(config.uploadsPath, directory, uploaded.url.split("/").pop() ?? ""), { force: true });
            throw error;
          }
        }
        return reply.code(201).send({ ...uploaded, purpose });
      } catch (error) {
        if (error instanceof Error && error.message === "UPLOAD_TOO_LARGE") return reply.code(413).send({ code: "UPLOAD_TOO_LARGE", message: "单个文件不能超过 20 MB" });
        throw error;
      }
    });

    app.get("/homeworks", { preHandler: (request, reply) => requireStaff(store, request, reply) }, async (request) => {
      const user = (await getStaffUser(store, request))!;
      return { homeworks: store.listPublishedHomeworks(20, getScope(user)) };
    });

    app.get("/read-aloud-submissions", { preHandler: (request, reply) => requireStaff(store, request, reply) }, async (request) => {
      const user = (await getStaffUser(store, request))!;
      return { submissions: store.listReadAloudSubmissions(100, getScope(user)) };
    });

    app.post<{ Params: { submissionId: string }; Body: ReviewBody }>("/read-aloud-submissions/:submissionId/review", { preHandler: (request, reply) => requireStaff(store, request, reply), schema: { body: { type: "object", additionalProperties: false, required: ["grade"], properties: { grade: { type: "string", enum: ["A", "B", "C", "D"] }, feedbackAudioUrl: { type: "string", minLength: 1, maxLength: 500 } } } } }, async (request, reply) => {
      const user = (await getStaffUser(store, request))!;
      try { return { submission: store.reviewReadingSubmission({ submissionId: request.params.submissionId, grade: request.body.grade, feedbackAudioUrl: request.body.feedbackAudioUrl, scope: getScope(user) }) }; }
      catch (error) { if (error instanceof ReviewSubmissionNotFoundError) return reply.code(404).send({ code: "SUBMISSION_NOT_FOUND", message: "没有找到可批改的当前录音" }); if (error instanceof InvalidFeedbackAudioUrlError) return reply.code(400).send({ code: "FEEDBACK_AUDIO_INVALID", message: "请先上传私有点评音频" }); throw error; }
    });

    app.get("/practice-recording-submissions", { preHandler: (request, reply) => requireStaff(store, request, reply) }, async (request) => {
      const user = (await getStaffUser(store, request))!;
      return { submissions: store.listPracticeRecordingSubmissions(100, getScope(user)) };
    });

    app.post<{ Params: { submissionId: string }; Body: ReviewBody }>("/practice-recording-submissions/:submissionId/review", { preHandler: (request, reply) => requireStaff(store, request, reply), schema: { body: { type: "object", additionalProperties: false, required: ["grade"], properties: { grade: { type: "string", enum: ["A", "B", "C", "D"] }, feedbackAudioUrl: { type: "string", minLength: 1, maxLength: 500 } } } } }, async (request, reply) => {
      const user = (await getStaffUser(store, request))!;
      try { return { submission: store.reviewPracticeRecordingSubmission({ submissionId: request.params.submissionId, grade: request.body.grade, feedbackAudioUrl: request.body.feedbackAudioUrl, scope: getScope(user) }) }; }
      catch (error) { if (error instanceof ReviewSubmissionNotFoundError) return reply.code(404).send({ code: "SUBMISSION_NOT_FOUND", message: "没有找到可批改的当前录音" }); if (error instanceof InvalidFeedbackAudioUrlError) return reply.code(400).send({ code: "FEEDBACK_AUDIO_INVALID", message: "请先上传私有点评音频" }); throw error; }
    });

    app.get<{ Querystring: { page?: string; pageSize?: string; status?: string } }>("/speech-assessments", { preHandler: (request, reply) => requireStaff(store, request, reply), schema: { querystring: { type: "object", additionalProperties: false, properties: { page: { type: "string", pattern: "^[0-9]+$" }, pageSize: { type: "string", pattern: "^[0-9]+$" }, status: { type: "string", enum: ["QUEUED", "PROCESSING", "COMPLETED", "FAILED"] } } } } }, async (request) => {
      const user = (await getStaffUser(store, request))!;
      const page = Math.max(1, Number(request.query.page ?? 1));
      const pageSize = Math.min(100, Math.max(1, Number(request.query.pageSize ?? 20)));
      return store.listSpeechAssessments({ page, pageSize, status: request.query.status, scope: getScope(user) });
    });

    app.post<{ Params: { assessmentId: string } }>("/speech-assessments/:assessmentId/retry", { preHandler: (request, reply) => requireStaff(store, request, reply), schema: { params: { type: "object", additionalProperties: false, required: ["assessmentId"], properties: { assessmentId: { type: "string", minLength: 1 } } } } }, async (request, reply) => {
      const user = (await getStaffUser(store, request))!;
      try { return { assessment: store.retrySpeechAssessment({ assessmentId: request.params.assessmentId, scope: getScope(user) }) }; }
      catch (error) {
        if (error instanceof SpeechAssessmentAccessError) return reply.code(404).send({ code: "ASSESSMENT_NOT_FOUND", message: "没有找到评测任务" });
        if (error instanceof SpeechAssessmentRetryError) return reply.code(409).send({ code: "ASSESSMENT_NOT_RETRYABLE", message: "只有失败任务可以重试" });
        throw error;
      }
    });
  };
}
