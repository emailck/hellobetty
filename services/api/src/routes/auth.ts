import type { FastifyInstance } from "fastify";
import {
  isValidPhone,
  normalizePhone,
  toPublicUser,
  USER_ROLES,
  USER_STATUSES,
} from "../domain/user.js";
import {
  type AccountStore,
  DuplicatePhoneError,
} from "../lib/account-store.js";
import { hashPassword, verifyPassword } from "../security/password.js";
import type { AccessTokenPayload } from "../types/jwt.js";

interface RegisterBody {
  phone: string;
  displayName: string;
  password: string;
}

interface LoginBody {
  phone: string;
  password: string;
}

const credentialsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["phone", "password"],
  properties: {
    phone: { type: "string", minLength: 1, maxLength: 30 },
    password: { type: "string", minLength: 8, maxLength: 72 },
  },
} as const;

function issueToken(app: FastifyInstance, userId: string, role: string) {
  return app.jwt.sign({ sub: userId, role }, { expiresIn: "7d" });
}

export function createAuthRoutes(store: AccountStore) {
  return async function authRoutes(app: FastifyInstance) {
  app.post<{ Body: RegisterBody }>(
    "/register",
    {
      schema: {
        body: {
          ...credentialsSchema,
          required: ["phone", "password", "displayName"],
          properties: {
            ...credentialsSchema.properties,
            displayName: { type: "string", minLength: 2, maxLength: 24 },
          },
        },
      },
    },
    async (request, reply) => {
      const phone = normalizePhone(request.body.phone);
      const displayName = request.body.displayName.trim();
      if (!isValidPhone(phone)) {
        return reply.code(400).send({
          code: "INVALID_PHONE",
          message: "请输入有效的中国大陆手机号",
        });
      }
      if (displayName.length < 2) {
        return reply.code(400).send({
          code: "INVALID_DISPLAY_NAME",
          message: "姓名至少需要 2 个字符",
        });
      }

      try {
        const user = store.createUser({
          phone,
          displayName,
          passwordHash: await hashPassword(request.body.password),
          role: USER_ROLES.STUDENT,
        });
        return reply.code(201).send({
          token: issueToken(app, user.id, user.role),
          user: toPublicUser(user),
        });
      } catch (error) {
        if (
          error instanceof DuplicatePhoneError
        ) {
          return reply.code(409).send({
            code: "PHONE_ALREADY_REGISTERED",
            message: "这个手机号已经注册，请直接登录",
          });
        }
        throw error;
      }
    },
  );

  app.post<{ Body: LoginBody }>(
    "/login",
    { schema: { body: credentialsSchema } },
    async (request, reply) => {
      const phone = normalizePhone(request.body.phone);
      const user = isValidPhone(phone)
        ? store.findByPhone(phone)
        : null;
      const valid = user
        ? await verifyPassword(request.body.password, user.passwordHash)
        : false;

      if (!user || !valid) {
        return reply.code(401).send({
          code: "INVALID_CREDENTIALS",
          message: "手机号或密码不正确",
        });
      }
      if (user.status !== USER_STATUSES.ACTIVE) {
        return reply.code(403).send({
          code: "ACCOUNT_DISABLED",
          message: "账号已停用，请联系老师",
        });
      }

      const updatedUser = store.markLoggedIn(user.id);
      return {
        token: issueToken(app, updatedUser.id, updatedUser.role),
        user: toPublicUser(updatedUser),
      };
    },
  );

  app.get("/me", async (request, reply) => {
    let token: AccessTokenPayload;
    try {
      token = await request.jwtVerify<AccessTokenPayload>();
    } catch {
      return reply.code(401).send({
        code: "UNAUTHORIZED",
        message: "登录已过期，请重新登录",
      });
    }

    const user = store.findById(token.sub);
    if (!user || user.status !== USER_STATUSES.ACTIVE) {
      return reply.code(401).send({
        code: "UNAUTHORIZED",
        message: "登录已过期，请重新登录",
      });
    }
    return { user: toPublicUser(user) };
  });
  };
}
