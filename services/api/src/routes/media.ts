import { createReadStream, statSync } from "node:fs";
import { extname, resolve } from "node:path";
import type { FastifyInstance } from "fastify";
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
      {
        schema: {
          params: {
            type: "object",
            additionalProperties: false,
            required: ["filename"],
            properties: {
              filename: {
                type: "string",
                pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(mp3|wav|m4a|webm|ogg)$",
              },
            },
          },
        },
      },
      async (request, reply) => {
        let token: AccessTokenPayload;
        try {
          token = await request.jwtVerify<AccessTokenPayload>();
        } catch {
          return reply.code(401).send({ code: "UNAUTHORIZED", message: "请先登录" });
        }
        const user = store.findById(token.sub);
        if (!user || user.status !== USER_STATUSES.ACTIVE) {
          return reply.code(403).send({ code: "FORBIDDEN", message: "当前账号不能访问该录音" });
        }
        const isStaff = user.role === USER_ROLES.ADMIN || user.role === USER_ROLES.TEACHER;
        if (user.role !== USER_ROLES.STUDENT && !isStaff) {
          return reply.code(403).send({ code: "FORBIDDEN", message: "当前账号不能访问该录音" });
        }
        const audioUrl = `/uploads/submissions/${request.params.filename}`;
        if (!store.canAccessSubmissionAudio({ audioUrl, userId: user.id, isStaff })) {
          return reply.code(404).send({ code: "MEDIA_NOT_FOUND", message: "没有找到该录音" });
        }

        const filePath = resolve(config.uploadsPath, "submissions", request.params.filename);
        let size: number;
        try {
          size = statSync(filePath).size;
        } catch {
          return reply.code(404).send({ code: "MEDIA_NOT_FOUND", message: "没有找到该录音" });
        }
        const contentType = AUDIO_CONTENT_TYPES[extname(request.params.filename)]
          ?? "application/octet-stream";
        reply.header("Accept-Ranges", "bytes").type(contentType);

        const range = parseByteRange(request.headers.range, size);
        if (range === "invalid") {
          return reply.header("Content-Range", `bytes */${size}`).code(416).send();
        }
        if (range) {
          const { start, end } = range;
          reply
            .header("Content-Range", `bytes ${start}-${end}/${size}`)
            .header("Content-Length", end - start + 1)
            .code(206);
          return reply.send(createReadStream(filePath, { start, end }));
        }
        reply.header("Content-Length", size);
        return reply.send(createReadStream(filePath));
      },
    );
  };
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
