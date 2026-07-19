import { createReadStream, statSync } from "node:fs";
import { extname, resolve } from "node:path";
import type { FastifyInstance, FastifyReply } from "fastify";
import { USER_ROLES, USER_STATUSES } from "../domain/user.js";
import type { AccountStore } from "../lib/account-store.js";
import type { AccessTokenPayload } from "../types/jwt.js";
import { config } from "../config.js";

const AUDIO_CONTENT_TYPES: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".webm": "audio/webm",
  ".ogg": "audio/ogg",
};

export function createMediaRoutes(store: AccountStore) {
  return async function mediaRoutes(app: FastifyInstance) {
    app.get<{ Params: { filename: string } }>(
      "/uploads/submissions/:filename",
      { schema: { params: privateAudioParamsSchema } },
      async (request, reply) => {
        const audioUrl = `/uploads/submissions/${request.params.filename}`;
        return streamPrivateAudio({
          store,
          reply,
          requestHeadersRange: request.headers.range,
          tokenVerifier: () => request.jwtVerify<AccessTokenPayload>(),
          filename: request.params.filename,
          directory: "submissions",
          audioUrl,
          canAccess: (input) => store.canAccessSubmissionAudio(input),
        });
      },
    );

    app.get<{ Params: { filename: string } }>(
      "/uploads/feedback/:filename",
      { schema: { params: privateAudioParamsSchema } },
      async (request, reply) => {
        const audioUrl = `/uploads/feedback/${request.params.filename}`;
        return streamPrivateAudio({
          store,
          reply,
          requestHeadersRange: request.headers.range,
          tokenVerifier: () => request.jwtVerify<AccessTokenPayload>(),
          filename: request.params.filename,
          directory: "feedback",
          audioUrl,
          canAccess: (input) => store.canAccessFeedbackAudio(input),
        });
      },
    );
  };
}

const privateAudioParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["filename"],
  properties: {
    filename: {
      type: "string",
      pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(mp3|wav|m4a|webm|ogg)$",
    },
  },
} as const;

async function streamPrivateAudio(input: {
  store: AccountStore;
  reply: FastifyReply;
  requestHeadersRange: string | undefined;
  tokenVerifier: () => Promise<AccessTokenPayload>;
  filename: string;
  directory: "submissions" | "feedback";
  audioUrl: string;
  canAccess: (input: {
    audioUrl: string;
    userId: string;
    isStaff: boolean;
    staffScope?: { userId: string; role: string };
  }) => boolean;
}) {
  let token: AccessTokenPayload;
  try {
    token = await input.tokenVerifier();
  } catch {
    return input.reply.code(401).send({ code: "UNAUTHORIZED", message: "请先登录" });
  }
  const user = input.store.findById(token.sub);
  if (!user || user.status !== USER_STATUSES.ACTIVE) {
    return input.reply.code(403).send({ code: "FORBIDDEN", message: "当前账号不能访问该录音" });
  }
  const isStaff = user.role === USER_ROLES.ADMIN || user.role === USER_ROLES.TEACHER;
  if (user.role !== USER_ROLES.STUDENT && !isStaff) {
    return input.reply.code(403).send({ code: "FORBIDDEN", message: "当前账号不能访问该录音" });
  }
  if (!input.canAccess({
    audioUrl: input.audioUrl,
    userId: user.id,
    isStaff,
    staffScope: isStaff ? { userId: user.id, role: user.role } : undefined,
  })) {
    return input.reply.code(404).send({ code: "MEDIA_NOT_FOUND", message: "没有找到该录音" });
  }

  const filePath = resolve(config.uploadsPath, input.directory, input.filename);
  let size: number;
  try {
    size = statSync(filePath).size;
  } catch {
    return input.reply.code(404).send({ code: "MEDIA_NOT_FOUND", message: "没有找到该录音" });
  }
  const contentType = AUDIO_CONTENT_TYPES[extname(input.filename)] ?? "application/octet-stream";
  input.reply.header("Accept-Ranges", "bytes").type(contentType);

  const range = parseByteRange(input.requestHeadersRange, size);
  if (range === "invalid") {
    return input.reply.header("Content-Range", `bytes */${size}`).code(416).send();
  }
  if (range) {
    const { start, end } = range;
    input.reply
      .header("Content-Range", `bytes ${start}-${end}/${size}`)
      .header("Content-Length", end - start + 1)
      .code(206);
    return input.reply.send(createReadStream(filePath, { start, end }));
  }
  input.reply.header("Content-Length", size);
  return input.reply.send(createReadStream(filePath));
}

function parseByteRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | "invalid" | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2]) || size === 0) return "invalid";

  let start: number;
  let end: number;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isInteger(suffixLength) || suffixLength <= 0) return "invalid";
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  }
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start >= size || end < start) {
    return "invalid";
  }
  return { start, end: Math.min(end, size - 1) };
}
