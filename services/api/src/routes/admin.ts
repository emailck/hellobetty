import { rmSync } from "node:fs";
import { resolve } from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { REVIEW_GRADES } from "../lib/account-store.js";
import type { AccountStore, ReviewGrade, StaffHomeworkReviewMode, StaffScope } from "../lib/account-store.js";
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
  HomeworkAccessError,
  HomeworkTemplateAccessError,
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

interface HomeworkListQuery {
  page?: string;
  pageSize?: string;
}

interface PublishedHomeworkListQuery extends HomeworkListQuery {
  search?: string;
  status?: "PUBLISHED" | "PAUSED" | "ARCHIVED";
  classroomId?: string;
}

interface HomeworkTemplateListQuery extends HomeworkListQuery {
  search?: string;
  templateType?: PublishableHomeworkTemplateType;
}

interface HomeworkSubmissionListQuery extends HomeworkListQuery {
  studentId?: string;
  studentSearch?: string;
  homeworkId?: string;
  submittedFrom?: string;
  submittedTo?: string;
  reviewMode?: StaffHomeworkReviewMode;
}

type PublishableHomeworkTemplateType =
  | "READ_ALOUD_PICTURE_BOOK"
  | "SENTENCE_READ_ALOUD"
  | "WORD_READ_ALOUD"
  | "WORD_IMAGE_MATCH"
  | "WORD_SCRAMBLE"
  | "WORD_FILL_BLANK";

interface HomeworkContentBody {
  title: string;
  instructions?: string;
  templateType?: "STANDARD" | PublishableHomeworkTemplateType;
  cards?: Array<{ imageUrl: string; sampleAudioUrl: string; referenceText: string }>;
  items?: Array<{
    promptText?: string;
    imageUrl?: string;
    sampleAudioUrl?: string;
    answerText?: string;
    choices?: string[];
  }>;
}

interface HomeworkTemplateBody extends HomeworkContentBody {
  templateType: PublishableHomeworkTemplateType;
}

interface PublishHomeworkBody extends Partial<HomeworkContentBody> {
  templateId?: string;
  classroomId?: string | null;
  studentIds: string[];
  schedule: {
    startsAt: string;
    unit: "DAY" | "WEEK";
    interval: number;
    occurrenceLimit: number;
  };
}

interface ReviewBody {
  grade: ReviewGrade;
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

const homeworkPaginationQuerySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    page: { type: "string", pattern: "^[0-9]+$" },
    pageSize: { type: "string", pattern: "^[0-9]+$" },
  },
} as const;

const publishedHomeworkListQuerySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    page: { type: "string", pattern: "^[0-9]+$" },
    pageSize: { type: "string", pattern: "^[0-9]+$" },
    search: { type: "string", maxLength: 100 },
    status: { type: "string", enum: [HOMEWORK_STATUS.PUBLISHED, HOMEWORK_STATUS.PAUSED, HOMEWORK_STATUS.ARCHIVED] },
    classroomId: { type: "string", minLength: 1 },
  },
} as const;

const homeworkTemplateListQuerySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    page: { type: "string", pattern: "^[0-9]+$" },
    pageSize: { type: "string", pattern: "^[0-9]+$" },
    search: { type: "string", maxLength: 100 },
    templateType: { type: "string", enum: [
      "READ_ALOUD_PICTURE_BOOK",
      "SENTENCE_READ_ALOUD",
      "WORD_READ_ALOUD",
      "WORD_IMAGE_MATCH",
      "WORD_SCRAMBLE",
      "WORD_FILL_BLANK",
    ] },
  },
} as const;

const publishableTemplateTypes = [
  "READ_ALOUD_PICTURE_BOOK",
  "SENTENCE_READ_ALOUD",
  "WORD_READ_ALOUD",
  "WORD_IMAGE_MATCH",
  "WORD_SCRAMBLE",
  "WORD_FILL_BLANK",
] as const;

const inlineTemplateTypes = ["STANDARD", ...publishableTemplateTypes] as const;

const homeworkContentProperties = {
  title: { type: "string", minLength: 2, maxLength: 100 },
  instructions: { type: "string", maxLength: 2000 },
  templateType: { type: "string", enum: inlineTemplateTypes },
  cards: { type: "array", minItems: 1, maxItems: 80, items: { type: "object", additionalProperties: false, required: ["imageUrl", "sampleAudioUrl", "referenceText"], properties: { imageUrl: { type: "string", minLength: 1, maxLength: 500 }, sampleAudioUrl: { type: "string", minLength: 1, maxLength: 500 }, referenceText: { type: "string", minLength: 1, maxLength: 500 } } } },
  items: { type: "array", minItems: 1, maxItems: 100, items: { type: "object", additionalProperties: false, properties: { promptText: { type: "string", minLength: 1, maxLength: 500 }, imageUrl: { type: "string", minLength: 1, maxLength: 500 }, sampleAudioUrl: { type: "string", minLength: 1, maxLength: 500 }, answerText: { type: "string", minLength: 1, maxLength: 100 }, choices: { type: "array", minItems: 1, maxItems: 20, items: { type: "string", minLength: 1, maxLength: 100 } } } } },
} as const;

const publishScheduleSchema = {
  type: "object",
  additionalProperties: false,
  required: ["startsAt", "unit", "interval", "occurrenceLimit"],
  properties: {
    startsAt: { type: "string", format: "date-time" },
    unit: { type: "string", enum: [SCHEDULE_UNITS.DAY, SCHEDULE_UNITS.WEEK] },
    interval: { type: "integer", minimum: 1, maximum: 52 },
    occurrenceLimit: { type: "integer", minimum: 1, maximum: 365 },
  },
} as const;

function hasInlineHomeworkContent(body: PublishHomeworkBody): boolean {
  return body.title !== undefined || body.instructions !== undefined || body.templateType !== undefined || body.cards !== undefined || body.items !== undefined;
}

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

    app.get("/classroom-student-candidates", { preHandler: (request, reply) => requireStaff(store, request, reply) }, async () => {
      return { students: store.listClassroomStudentCandidates() };
    });

    app.post<{ Body: { name: string; teacherIds?: string[]; studentIds?: string[] } }>(
      "/classrooms",
      {
        preHandler: (request, reply) => requireStaff(store, request, reply),
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
        const staff = (await getStaffUser(store, request))!;
        if (staff.role === USER_ROLES.TEACHER && request.body.teacherIds !== undefined) {
          return reply.code(403).send({ code: "CLASSROOM_NOT_ALLOWED", message: "老师创建班级时不能指定其他老师" });
        }
        try {
          const classroom = store.createClassroom({
            creatorId: staff.id,
            name: request.body.name,
            teacherIds: staff.role === USER_ROLES.TEACHER ? [staff.id] : request.body.teacherIds ?? [],
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
        preHandler: (request, reply) => requireStaff(store, request, reply),
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
        const staff = (await getStaffUser(store, request))!;
        if (staff.role === USER_ROLES.TEACHER && (request.body.teacherIds !== undefined || request.body.status !== undefined)) {
          return reply.code(403).send({ code: "CLASSROOM_NOT_ALLOWED", message: "老师只能编辑自己班级的名称和学生" });
        }
        try {
          const classroom = store.updateClassroom({ classroomId: request.params.classroomId, ...request.body, scope: getScope(staff) });
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

    app.get<{ Querystring: HomeworkTemplateListQuery }>(
      "/homework-templates",
      { preHandler: (request, reply) => requireStaff(store, request, reply), schema: { querystring: homeworkTemplateListQuerySchema } },
      async (request) => {
        const user = (await getStaffUser(store, request))!;
        const page = Math.max(1, Number(request.query.page ?? 1));
        const pageSize = Math.min(50, Math.max(1, Number(request.query.pageSize ?? 20)));
        const scope = getScope(user);
        const filters = { search: request.query.search, templateType: request.query.templateType };
        return {
          templates: store.listHomeworkTemplates(pageSize, scope, (page - 1) * pageSize, filters),
          pagination: { page, pageSize, total: store.countHomeworkTemplates(scope, filters) },
        };
      },
    );

    app.get<{ Params: { templateId: string } }>(
      "/homework-templates/:templateId",
      {
        preHandler: (request, reply) => requireStaff(store, request, reply),
        schema: {
          params: {
            type: "object",
            additionalProperties: false,
            required: ["templateId"],
            properties: { templateId: { type: "string", minLength: 1 } },
          },
        },
      },
      async (request, reply) => {
        const user = (await getStaffUser(store, request))!;
        const detail = store.getHomeworkTemplateDetail(request.params.templateId, getScope(user));
        if (!detail) {
          return reply.code(404).send({ code: "HOMEWORK_TEMPLATE_NOT_FOUND", message: "没有找到可查看的作业模板" });
        }
        return detail;
      },
    );

    app.post<{ Body: HomeworkTemplateBody }>(
      "/homework-templates",
      {
        preHandler: (request, reply) => requireStaff(store, request, reply),
        schema: {
          body: {
            type: "object",
            additionalProperties: false,
            required: ["title", "templateType"],
            properties: {
              ...homeworkContentProperties,
              templateType: { type: "string", enum: publishableTemplateTypes },
            },
          },
        },
      },
      async (request, reply) => {
        const user = (await getStaffUser(store, request))!;
        try {
          const detail = store.createHomeworkTemplate({
            creatorId: user.id,
            title: request.body.title.trim(),
            instructions: request.body.instructions,
            templateType: request.body.templateType,
            cards: request.body.cards,
            items: request.body.items,
          });
          return reply.code(201).send(detail);
        } catch (error) {
          if (error instanceof InvalidPictureBookCardsError) return reply.code(400).send({ code: "PICTURE_BOOK_CARDS_REQUIRED", message: "跟读绘本每页都需要图片、示范录音和跟读文本" });
          if (error instanceof InvalidHomeworkItemsError) return reply.code(400).send({ code: "HOMEWORK_ITEMS_INVALID", message: "请检查练习条目必填内容、答案和选项" });
          throw error;
        }
      },
    );

    app.delete<{ Params: { templateId: string } }>(
      "/homework-templates/:templateId",
      {
        preHandler: (request, reply) => requireStaff(store, request, reply),
        schema: {
          params: {
            type: "object",
            additionalProperties: false,
            required: ["templateId"],
            properties: { templateId: { type: "string", minLength: 1 } },
          },
        },
      },
      async (request, reply) => {
        const user = (await getStaffUser(store, request))!;
        try {
          const deleted = store.deleteHomeworkTemplate(request.params.templateId, getScope(user));
          if (!deleted) return reply.code(404).send({ code: "HOMEWORK_TEMPLATE_NOT_FOUND", message: "没有找到可删除的作业模板" });
          return { ok: true };
        } catch (error) {
          if (error instanceof HomeworkTemplateAccessError) {
            return reply.code(404).send({ code: "HOMEWORK_TEMPLATE_NOT_FOUND", message: "没有找到可删除的作业模板" });
          }
          throw error;
        }
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
            required: ["studentIds", "schedule"],
            properties: {
              ...homeworkContentProperties,
              templateId: { type: "string", minLength: 1, maxLength: 100 },
              classroomId: { anyOf: [{ type: "string", minLength: 1, maxLength: 100 }, { type: "null" }] },
              studentIds: { type: "array", minItems: 1, maxItems: 200, items: { type: "string", minLength: 1 } },
              schedule: publishScheduleSchema,
            },
          },
        },
      },
      async (request, reply) => {
        const user = (await getStaffUser(store, request))!;
        const templateId = request.body.templateId?.trim();
        if (templateId && hasInlineHomeworkContent(request.body)) {
          return reply.code(400).send({ code: "HOMEWORK_TEMPLATE_MIXED_CONTENT", message: "从作业库发布时不能同时传入新的作业内容" });
        }
        if (!templateId && (!request.body.title || request.body.title.trim().length < 2)) {
          return reply.code(400).send({ code: "HOMEWORK_TITLE_REQUIRED", message: "新增作业需要填写标题" });
        }
        try {
          const publishInput = {
            publisherId: user.id,
            classroomId: request.body.classroomId,
            staffRole: user.role,
            templateId,
            title: request.body.title?.trim() ?? "",
            instructions: request.body.instructions,
            studentIds: request.body.studentIds,
            schedule: request.body.schedule,
            templateType: request.body.templateType,
            cards: request.body.cards,
            items: request.body.items,
          };
          const homework = store.createPublishedHomework(publishInput);
          return reply.code(201).send({ homework: { ...homework, targetCount: new Set(request.body.studentIds).size, occurrenceCount: store.getHomeworkOccurrenceCount(homework.id), completedOccurrenceCount: 0 } });
        } catch (error) {
          if (error instanceof ClassroomAccessError) return reply.code(403).send({ code: "CLASSROOM_NOT_ALLOWED", message: "请选择可管理的有效班级" });
          if (error instanceof HomeworkTemplateAccessError) return reply.code(404).send({ code: "HOMEWORK_TEMPLATE_NOT_FOUND", message: "没有找到可发布的作业模板" });
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

    app.get<{ Querystring: PublishedHomeworkListQuery }>(
      "/homeworks",
      { preHandler: (request, reply) => requireStaff(store, request, reply), schema: { querystring: publishedHomeworkListQuerySchema } },
      async (request) => {
        const user = (await getStaffUser(store, request))!;
        const page = Math.max(1, Number(request.query.page ?? 1));
        const pageSize = Math.min(50, Math.max(1, Number(request.query.pageSize ?? 20)));
        const scope = getScope(user);
        const filters = { search: request.query.search, status: request.query.status, classroomId: request.query.classroomId };
        return {
          homeworks: store.listPublishedHomeworks(pageSize, scope, (page - 1) * pageSize, filters),
          pagination: { page, pageSize, total: store.countPublishedHomeworks(scope, filters) },
        };
      },
    );

    app.get<{ Params: { homeworkId: string } }>(
      "/homeworks/:homeworkId",
      {
        preHandler: (request, reply) => requireStaff(store, request, reply),
        schema: {
          params: {
            type: "object",
            additionalProperties: false,
            required: ["homeworkId"],
            properties: { homeworkId: { type: "string", minLength: 1 } },
          },
        },
      },
      async (request, reply) => {
        const user = (await getStaffUser(store, request))!;
        const detail = store.getPublishedHomeworkDetail(request.params.homeworkId, getScope(user));
        if (!detail) {
          return reply.code(404).send({ code: "HOMEWORK_NOT_FOUND", message: "没有找到可查看的作业" });
        }
        return detail;
      },
    );

    app.get<{ Params: { homeworkId: string } }>(
      "/homeworks/:homeworkId/latest-cycle",
      {
        preHandler: (request, reply) => requireStaff(store, request, reply),
        schema: {
          params: {
            type: "object",
            additionalProperties: false,
            required: ["homeworkId"],
            properties: { homeworkId: { type: "string", minLength: 1 } },
          },
        },
      },
      async (request, reply) => {
        const user = (await getStaffUser(store, request))!;
        const result = store.getLatestHomeworkCycle(request.params.homeworkId, getScope(user));
        if (!result) {
          return reply.code(404).send({ code: "HOMEWORK_NOT_FOUND", message: "没有找到可查看的作业" });
        }
        return result;
      },
    );

    app.get<{ Querystring: HomeworkSubmissionListQuery }>(
      "/homework-submission-groups",
      {
        preHandler: (request, reply) => requireStaff(store, request, reply),
        schema: {
          querystring: {
            type: "object",
            additionalProperties: false,
            properties: {
              page: { type: "string", pattern: "^[0-9]+$" },
              pageSize: { type: "string", pattern: "^[0-9]+$" },
              studentSearch: { type: "string", maxLength: 40 },
              reviewMode: { type: "string", enum: ["PENDING", "ALL"] },
            },
          },
        },
      },
      async (request) => {
        const user = (await getStaffUser(store, request))!;
        const page = Math.max(1, Number(request.query.page ?? 1));
        const pageSize = Math.min(50, Math.max(1, Number(request.query.pageSize ?? 20)));
        const filters = {
          studentSearch: request.query.studentSearch,
          reviewMode: request.query.reviewMode ?? "PENDING",
        };
        const scope = getScope(user);
        return {
          groups: store.listHomeworkSubmissionGroups({ page, pageSize, scope, ...filters }),
          pagination: {
            page,
            pageSize,
            total: store.countHomeworkSubmissionGroups(filters, scope),
          },
        };
      },
    );

    app.get<{ Querystring: HomeworkSubmissionListQuery }>(
      "/homework-submissions",
      {
        preHandler: (request, reply) => requireStaff(store, request, reply),
        schema: {
          querystring: {
            type: "object",
            additionalProperties: false,
            properties: {
              page: { type: "string", pattern: "^[0-9]+$" },
              pageSize: { type: "string", pattern: "^[0-9]+$" },
              studentId: { type: "string", minLength: 1 },
              studentSearch: { type: "string", maxLength: 40 },
              homeworkId: { type: "string", minLength: 1 },
              submittedFrom: { type: "string", format: "date-time" },
              submittedTo: { type: "string", format: "date-time" },
              reviewMode: { type: "string", enum: ["PENDING", "ALL"] },
            },
          },
        },
      },
      async (request, reply) => {
        const user = (await getStaffUser(store, request))!;
        const page = Math.max(1, Number(request.query.page ?? 1));
        const pageSize = Math.min(50, Math.max(1, Number(request.query.pageSize ?? 20)));
        const filters = {
          studentId: request.query.studentId,
          studentSearch: request.query.studentSearch,
          homeworkId: request.query.homeworkId,
          submittedFrom: request.query.submittedFrom,
          submittedTo: request.query.submittedTo,
          reviewMode: request.query.reviewMode,
        };
        if (filters.submittedFrom && filters.submittedTo && filters.submittedFrom > filters.submittedTo) {
          return reply.code(400).send({ code: "INVALID_SUBMITTED_RANGE", message: "提交开始时间不能晚于结束时间" });
        }
        const scope = getScope(user);
        return {
          conversations: store.listHomeworkSubmissionConversations({ page, pageSize, scope, ...filters }),
          filters: store.listHomeworkSubmissionFilterOptions(scope),
          pagination: {
            page,
            pageSize,
            total: store.countHomeworkSubmissionConversations(filters, scope),
          },
        };
      },
    );

    app.get<{ Params: { occurrenceId: string } }>(
      "/homework-submissions/:occurrenceId",
      {
        preHandler: (request, reply) => requireStaff(store, request, reply),
        schema: {
          params: {
            type: "object",
            additionalProperties: false,
            required: ["occurrenceId"],
            properties: { occurrenceId: { type: "string", minLength: 1 } },
          },
        },
      },
      async (request, reply) => {
        const user = (await getStaffUser(store, request))!;
        try {
          return { conversation: store.getHomeworkSubmissionConversation(request.params.occurrenceId, getScope(user)) };
        } catch (error) {
          if (error instanceof HomeworkAccessError) {
            return reply.code(404).send({ code: "HOMEWORK_SUBMISSION_NOT_FOUND", message: "没有找到可查看的作业提交" });
          }
          throw error;
        }
      },
    );

    app.post<{
      Params: { occurrenceId: string; sourceKind: "CARD" | "ITEM"; submissionId: string };
      Body: ReviewBody;
    }>(
      "/homework-submissions/:occurrenceId/:sourceKind/:submissionId/review",
      {
        preHandler: (request, reply) => requireStaff(store, request, reply),
        schema: {
          params: {
            type: "object",
            additionalProperties: false,
            required: ["occurrenceId", "sourceKind", "submissionId"],
            properties: {
              occurrenceId: { type: "string", minLength: 1 },
              sourceKind: { type: "string", enum: ["CARD", "ITEM"] },
              submissionId: { type: "string", minLength: 1 },
            },
          },
          body: {
            type: "object",
            additionalProperties: false,
            required: ["grade"],
            properties: {
              grade: { type: "string", enum: REVIEW_GRADES },
              feedbackAudioUrl: { type: "string", minLength: 1, maxLength: 500 },
            },
          },
        },
      },
      async (request, reply) => {
        const user = (await getStaffUser(store, request))!;
        const input = {
          submissionId: request.params.submissionId,
          occurrenceId: request.params.occurrenceId,
          grade: request.body.grade,
          feedbackAudioUrl: request.body.feedbackAudioUrl,
          scope: getScope(user),
        };
        try {
          if (request.params.sourceKind === "CARD") store.reviewReadingSubmission(input);
          else store.reviewPracticeRecordingSubmission(input);
          return { conversation: store.getHomeworkSubmissionConversation(request.params.occurrenceId, getScope(user)) };
        } catch (error) {
          if (error instanceof ReviewSubmissionNotFoundError) {
            return reply.code(404).send({ code: "SUBMISSION_NOT_FOUND", message: "没有找到可批改的当前提交" });
          }
          if (error instanceof InvalidFeedbackAudioUrlError) {
            return reply.code(400).send({ code: "FEEDBACK_AUDIO_INVALID", message: "请先上传私有点评音频" });
          }
          if (error instanceof HomeworkAccessError) {
            return reply.code(404).send({ code: "HOMEWORK_SUBMISSION_NOT_FOUND", message: "没有找到可查看的作业提交" });
          }
          throw error;
        }
      },
    );

    app.get("/read-aloud-submissions", { preHandler: (request, reply) => requireStaff(store, request, reply) }, async (request) => {
      const user = (await getStaffUser(store, request))!;
      return { submissions: store.listReadAloudSubmissions(100, getScope(user)) };
    });

    app.post<{ Params: { submissionId: string }; Body: ReviewBody }>("/read-aloud-submissions/:submissionId/review", { preHandler: (request, reply) => requireStaff(store, request, reply), schema: { body: { type: "object", additionalProperties: false, required: ["grade"], properties: { grade: { type: "string", enum: REVIEW_GRADES }, feedbackAudioUrl: { type: "string", minLength: 1, maxLength: 500 } } } } }, async (request, reply) => {
      const user = (await getStaffUser(store, request))!;
      try { return { submission: store.reviewReadingSubmission({ submissionId: request.params.submissionId, grade: request.body.grade, feedbackAudioUrl: request.body.feedbackAudioUrl, scope: getScope(user) }) }; }
      catch (error) { if (error instanceof ReviewSubmissionNotFoundError) return reply.code(404).send({ code: "SUBMISSION_NOT_FOUND", message: "没有找到可批改的当前录音" }); if (error instanceof InvalidFeedbackAudioUrlError) return reply.code(400).send({ code: "FEEDBACK_AUDIO_INVALID", message: "请先上传私有点评音频" }); throw error; }
    });

    app.get("/practice-recording-submissions", { preHandler: (request, reply) => requireStaff(store, request, reply) }, async (request) => {
      const user = (await getStaffUser(store, request))!;
      return { submissions: store.listPracticeRecordingSubmissions(100, getScope(user)) };
    });

    app.post<{ Params: { submissionId: string }; Body: ReviewBody }>("/practice-recording-submissions/:submissionId/review", { preHandler: (request, reply) => requireStaff(store, request, reply), schema: { body: { type: "object", additionalProperties: false, required: ["grade"], properties: { grade: { type: "string", enum: REVIEW_GRADES }, feedbackAudioUrl: { type: "string", minLength: 1, maxLength: 500 } } } } }, async (request, reply) => {
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
