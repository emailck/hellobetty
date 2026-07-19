import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { buildApp } from "../src/app.js";
import { config } from "../src/config.js";
import { USER_ROLES } from "../src/domain/user.js";
import { AccountStore } from "../src/lib/account-store.js";
import { hashPassword } from "../src/security/password.js";

const store = new AccountStore(":memory:");
const app = await buildApp(store);
const createdFiles: string[] = [];

beforeAll(async () => {
  await app.ready();
});

beforeEach(() => {
  store.deleteAll();
});

afterAll(async () => {
  await app.close();
  createdFiles.forEach((file) => rmSync(file, { force: true }));
});

describe("private recording media", () => {
  it("requires ownership or an active staff account and supports byte ranges", async () => {
    const student = store.createUser({
      phone: "13500135000",
      displayName: "Betty",
      passwordHash: await hashPassword("StudentPass123"),
      role: USER_ROLES.STUDENT,
    });
    const otherStudent = store.createUser({
      phone: "13400134000",
      displayName: "Alice",
      passwordHash: await hashPassword("StudentPass123"),
      role: USER_ROLES.STUDENT,
    });
    const teacher = store.createUser({
      phone: "13600136000",
      displayName: "Ms. Lin",
      passwordHash: await hashPassword("TeacherPass123"),
      role: USER_ROLES.TEACHER,
    });
    const homework = store.createPublishedHomework({
      publisherId: teacher.id,
      title: "Read a sentence",
      studentIds: [student.id],
      templateType: "SENTENCE_READ_ALOUD",
      items: [{ promptText: "I see a cat.", sampleAudioUrl: "/uploads/assets/cat.mp3" }],
      schedule: {
        startsAt: new Date(Date.now() - 60_000).toISOString(),
        unit: "DAY",
        interval: 1,
        occurrenceLimit: 1,
      },
    });
    expect(homework.templateType).toBe("SENTENCE_READ_ALOUD");
    const occurrenceId = store.listStudentPracticeOccurrences(student.id)[0].id;
    const item = store.getStudentPracticeOccurrence(occurrenceId, student.id).items[0];
    const filename = `${randomUUID()}.webm`;
    const audioUrl = `/uploads/submissions/${filename}`;
    store.submitPracticeRecording({
      occurrenceId,
      itemId: item.id,
      studentId: student.id,
      audioUrl,
    });
    const filePath = resolve(config.uploadsPath, "submissions", filename);
    mkdirSync(resolve(config.uploadsPath, "submissions"), { recursive: true });
    writeFileSync(filePath, Buffer.from("private-audio"));
    createdFiles.push(filePath);

    const anonymous = await app.inject({ method: "GET", url: audioUrl });
    expect(anonymous.statusCode).toBe(401);

    const forbidden = await app.inject({
      method: "GET",
      url: audioUrl,
      headers: {
        authorization: `Bearer ${app.jwt.sign({ sub: otherStudent.id, role: otherStudent.role })}`,
      },
    });
    expect(forbidden.statusCode).toBe(404);

    const owned = await app.inject({
      method: "GET",
      url: audioUrl,
      headers: {
        authorization: `Bearer ${app.jwt.sign({ sub: student.id, role: student.role })}`,
        range: "bytes=0-6",
      },
    });
    expect(owned.statusCode).toBe(206);
    expect(owned.headers["content-range"]).toBe("bytes 0-6/13");
    expect(owned.rawPayload.toString()).toBe("private");

    const staff = await app.inject({
      method: "GET",
      url: audioUrl,
      headers: {
        authorization: `Bearer ${app.jwt.sign({ sub: teacher.id, role: teacher.role })}`,
      },
    });
    expect(staff.statusCode).toBe(200);
    expect(staff.rawPayload.toString()).toBe("private-audio");
  });
});
