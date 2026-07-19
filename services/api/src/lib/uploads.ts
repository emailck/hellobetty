import { randomUUID } from "node:crypto";
import { createWriteStream, mkdirSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { join } from "node:path";
import type { MultipartFile } from "@fastify/multipart";

const fileExtensions: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/mp4": "m4a",
  "audio/m4a": "m4a",
  "audio/x-m4a": "m4a",
  "audio/webm": "webm",
  "audio/ogg": "ogg",
};

export function getUploadKind(mimetype: string): "image" | "audio" | null {
  if (!fileExtensions[mimetype]) return null;
  return mimetype.startsWith("image/") ? "image" : "audio";
}

export async function saveUpload(
  file: MultipartFile,
  uploadsPath: string,
  directory: "assets" | "submissions" | "feedback",
) {
  const kind = getUploadKind(file.mimetype);
  if (!kind) throw new Error("UNSUPPORTED_UPLOAD_TYPE");
  const folder = join(uploadsPath, directory);
  mkdirSync(folder, { recursive: true });
  const filename = `${randomUUID()}.${fileExtensions[file.mimetype]}`;
  await pipeline(file.file, createWriteStream(join(folder, filename)));
  if (file.file.truncated) throw new Error("UPLOAD_TOO_LARGE");
  return { kind, url: `/uploads/${directory}/${filename}` };
}
