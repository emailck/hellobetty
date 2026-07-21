import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/app.js";
import { config } from "../src/config.js";
import { USER_ROLES, USER_STATUSES } from "../src/domain/user.js";
import { AccountStore } from "../src/lib/account-store.js";
import { hashPassword } from "../src/security/password.js";

const store = new AccountStore(":memory:");
const uploadsPath = mkdtempSync(join(tmpdir(), "hellobetty-stats-test-"));
config.uploadsPath = uploadsPath;
const app = await buildApp(store);

beforeAll(async () => {
  await app.ready();
});

beforeEach(() => {
  store.deleteAll();
});

afterAll(async () => {
  await app.close();
  rmSync(uploadsPath, { recursive: true, force: true });
});

async function createUsers() {
  const student = store.createUser({
    phone: "13500135000",
    displayName: "Betty",
    passwordHash: await hashPassword("StudentPass123"),
    role: USER_ROLES.STUDENT,
  });
  const otherStudent = store.createUser({
    phone: "13700137000",
    displayName: "Other",
    passwordHash: await hashPassword("StudentPass123"),
    role: USER_ROLES.STUDENT,
  });
  const teacher = store.createUser({
    phone: "13600136000",
    displayName: "Ms. Lin",
    passwordHash: await hashPassword("TeacherPass123"),
    role: USER_ROLES.TEACHER,
  });
  return {
    student,
    otherStudent,
    teacher,
    studentToken: app.jwt.sign({ sub: student.id, role: student.role }),
    otherStudentToken: app.jwt.sign({ sub: otherStudent.id, role: otherStudent.role }),
    teacherToken: app.jwt.sign({ sub: teacher.id, role: teacher.role }),
  };
}

function schedule(startsAt = new Date(Date.now() - 60_000).toISOString()) {
  return { startsAt, unit: "DAY" as const, interval: 1, occurrenceLimit: 1 };
}

function audioMultipart(durationSeconds?: string) {
  const boundary = `hellobetty-stats-${Math.random().toString(16).slice(2)}`;
  const durationPart = durationSeconds === undefined
    ? ""
    : `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="durationSeconds"\r\n\r\n` +
      `${durationSeconds}\r\n`;
  return {
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.from(
      durationPart +
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="attempt.webm"\r\n` +
      `Content-Type: audio/webm\r\n\r\n` +
      `test-audio\r\n--${boundary}--\r\n`,
    ),
  };
}

describe("learning statistics", () => {
  it("accepts optional recording duration on both recording APIs and clamps at 600 seconds", async () => {
    const { student, teacher, studentToken } = await createUsers();
    store.createPublishedHomework({
      publisherId: teacher.id,
      title: "Sentence",
      studentIds: [student.id],
      templateType: "SENTENCE_READ_ALOUD",
      items: [{ promptText: "Hello.", sampleAudioUrl: "/uploads/hello.mp3" }],
      schedule: schedule(),
    });
    const practice = store.listStudentPracticeOccurrences(student.id)[0];
    const practiceItem = store.getStudentPracticeOccurrence(practice.id, student.id).items[0];

    const invalidMultipart = audioMultipart("0");
    const invalid = await app.inject({
      method: "POST",
      url: `/api/student/practice-homeworks/${practice.id}/items/${practiceItem.id}/recordings`,
      headers: { ...invalidMultipart.headers, authorization: `Bearer ${studentToken}` },
      payload: invalidMultipart.payload,
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().code).toBe("DURATION_INVALID");
    expect(store.getLearningStats(student.id).summary.checkinDays).toBe(0);
    const submissionPath = join(uploadsPath, "submissions");
    expect(existsSync(submissionPath) ? readdirSync(submissionPath) : []).toHaveLength(0);

    const cappedMultipart = audioMultipart("999.6");
    const capped = await app.inject({
      method: "POST",
      url: `/api/student/practice-homeworks/${practice.id}/items/${practiceItem.id}/recordings`,
      headers: { ...cappedMultipart.headers, authorization: `Bearer ${studentToken}` },
      payload: cappedMultipart.payload,
    });
    expect(capped.statusCode).toBe(201);

    store.createPublishedHomework({
      publisherId: teacher.id,
      title: "Picture book",
      studentIds: [student.id],
      templateType: "READ_ALOUD_PICTURE_BOOK",
      cards: [{
        imageUrl: "/uploads/page.png",
        sampleAudioUrl: "/uploads/page.mp3",
        referenceText: "Read this page.",
      }],
      schedule: schedule(),
    });
    const reading = store.listStudentReadingOccurrences(student.id)[0];
    const card = store.getStudentReadingOccurrence(reading.id, student.id).cards[0];
    const pictureMultipart = audioMultipart("12.4");
    const picture = await app.inject({
      method: "POST",
      url: `/api/student/reading-homeworks/${reading.id}/cards/${card.id}/submissions`,
      headers: { ...pictureMultipart.headers, authorization: `Bearer ${studentToken}` },
      payload: pictureMultipart.payload,
    });
    expect(picture.statusCode).toBe(201);

    const omittedMultipart = audioMultipart();
    const omitted = await app.inject({
      method: "POST",
      url: `/api/student/reading-homeworks/${reading.id}/cards/${card.id}/submissions`,
      headers: { ...omittedMultipart.headers, authorization: `Bearer ${studentToken}` },
      payload: omittedMultipart.payload,
    });
    expect(omitted.statusCode).toBe(201);
    expect(store.getLearningStats(student.id).summary).toMatchObject({
      checkinDays: 1,
      voiceSeconds: 612,
      homeworkSeconds: 0,
    });
  });

  it("restricts sessions to the assigned student and completes them idempotently with a two-hour cap", async () => {
    const { student, otherStudent, teacher, studentToken, otherStudentToken } = await createUsers();
    store.createPublishedHomework({
      publisherId: teacher.id,
      title: "Long practice",
      studentIds: [student.id],
      templateType: "SENTENCE_READ_ALOUD",
      items: [{ promptText: "Practice.", sampleAudioUrl: "/uploads/practice.mp3" }],
      schedule: schedule("2026-07-01T00:00:00.000Z"),
    });
    const startedAt = new Date("2026-07-13T16:30:00.000Z");
    const occurrence = store.listStudentHomeworkHistory({
      studentId: student.id,
      page: 1,
      pageSize: 1,
      currentTime: startedAt,
    }).occurrences[0];

    const denied = await app.inject({
      method: "POST",
      url: "/api/student/homework-sessions",
      headers: { authorization: `Bearer ${otherStudentToken}` },
      payload: { occurrenceId: occurrence.id },
    });
    expect(denied.statusCode).toBe(404);
    expect(denied.json().code).toBe("HOMEWORK_NOT_FOUND");

    const first = store.startHomeworkSession({
      occurrenceId: occurrence.id,
      studentId: student.id,
      now: startedAt,
    });
    const repeatedStart = store.startHomeworkSession({
      occurrenceId: occurrence.id,
      studentId: student.id,
      now: new Date("2026-07-13T16:40:00.000Z"),
    });
    expect(repeatedStart.id).toBe(first.id);

    const completed = store.completeHomeworkSession({
      sessionId: first.id,
      studentId: student.id,
      now: new Date("2026-07-13T19:30:00.000Z"),
    });
    expect(completed).toMatchObject({
      id: first.id,
      occurrenceId: occurrence.id,
      completedAt: "2026-07-13T19:30:00.000Z",
      creditedSeconds: 7200,
    });
    const repeatedComplete = store.completeHomeworkSession({
      sessionId: first.id,
      studentId: student.id,
      now: new Date("2026-07-14T19:30:00.000Z"),
    });
    expect(repeatedComplete).toEqual(completed);

    const stats = store.getLearningStats(student.id, new Date("2026-07-14T02:00:00.000Z"));
    expect(stats.summary).toEqual({
      checkinDays: 1,
      currentStreak: 1,
      voiceSeconds: 0,
      homeworkSeconds: 7200,
    });
    expect(stats.checkins[0]).toMatchObject({
      checkinDate: "2026-07-14",
      homeworkSeconds: 7200,
    });
    expect(stats.recentDays).toEqual([
      { checkinDate: "2026-07-08", voiceSeconds: 0, homeworkSeconds: 0 },
      { checkinDate: "2026-07-09", voiceSeconds: 0, homeworkSeconds: 0 },
      { checkinDate: "2026-07-10", voiceSeconds: 0, homeworkSeconds: 0 },
      { checkinDate: "2026-07-11", voiceSeconds: 0, homeworkSeconds: 0 },
      { checkinDate: "2026-07-12", voiceSeconds: 0, homeworkSeconds: 0 },
      { checkinDate: "2026-07-13", voiceSeconds: 0, homeworkSeconds: 0 },
      { checkinDate: "2026-07-14", voiceSeconds: 0, homeworkSeconds: 7200 },
    ]);

    const missing = await app.inject({
      method: "POST",
      url: `/api/student/homework-sessions/${first.id}/complete`,
      headers: { authorization: `Bearer ${otherStudentToken}` },
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().code).toBe("SESSION_NOT_FOUND");

    const ownStats = await app.inject({
      method: "GET",
      url: "/api/student/learning-stats",
      headers: { authorization: `Bearer ${studentToken}` },
    });
    expect(ownStats.statusCode).toBe(200);
    expect(ownStats.json().summary.homeworkSeconds).toBe(7200);
    expect(store.getLearningStats(otherStudent.id).summary.checkinDays).toBe(0);
  });

  it("rejects completing an active learning session after homework is paused", async () => {
    const { student, teacher, studentToken } = await createUsers();
    const homework = store.createPublishedHomework({
      publisherId: teacher.id,
      title: "Pause before completion",
      studentIds: [student.id],
      templateType: "SENTENCE_READ_ALOUD",
      items: [{ promptText: "Practice.", sampleAudioUrl: "/uploads/practice.mp3" }],
      schedule: schedule("2026-07-01T00:00:00.000Z"),
    });
    const occurrence = store.listStudentHomeworkHistory({
      studentId: student.id,
      page: 1,
      pageSize: 1,
      currentTime: new Date("2026-07-13T16:30:00.000Z"),
    }).occurrences[0];
    const session = store.startHomeworkSession({
      occurrenceId: occurrence.id,
      studentId: student.id,
      now: new Date("2026-07-13T16:30:00.000Z"),
    });
    store.updateHomeworkStatus({ homeworkId: homework.id, status: "PAUSED" });

    const rejected = await app.inject({
      method: "POST",
      url: `/api/student/homework-sessions/${session.id}/complete`,
      headers: { authorization: `Bearer ${studentToken}` },
    });
    expect(rejected.statusCode).toBe(404);
    expect(rejected.json().code).toBe("SESSION_NOT_FOUND");
    expect(store.getLearningStats(student.id).summary.homeworkSeconds).toBe(0);
  });

  it("allows staff to read only active student statistics", async () => {
    const { student, otherStudentToken, teacher, teacherToken } = await createUsers();
    store.createClassroom({
      creatorId: teacher.id,
      name: "Stats class",
      teacherIds: [teacher.id],
      studentIds: [student.id],
    });
    const disabled = store.createUser({
      phone: "13800138000",
      displayName: "Disabled",
      passwordHash: await hashPassword("StudentPass123"),
      role: USER_ROLES.STUDENT,
      status: USER_STATUSES.DISABLED,
    });

    const forbidden = await app.inject({
      method: "GET",
      url: `/api/admin/students/${student.id}/learning-stats`,
      headers: { authorization: `Bearer ${otherStudentToken}` },
    });
    expect(forbidden.statusCode).toBe(403);

    const allowed = await app.inject({
      method: "GET",
      url: `/api/admin/students/${student.id}/learning-stats`,
      headers: { authorization: `Bearer ${teacherToken}` },
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json()).toMatchObject({
      summary: { checkinDays: 0, currentStreak: 0, voiceSeconds: 0, homeworkSeconds: 0 },
      checkins: [],
    });
    expect(allowed.json().recentDays).toHaveLength(7);

    for (const invalidStudentId of [disabled.id, teacher.id, "missing-student"]) {
      const response = await app.inject({
        method: "GET",
        url: `/api/admin/students/${invalidStudentId}/learning-stats`,
        headers: { authorization: `Bearer ${teacherToken}` },
      });
      expect(response.statusCode).toBe(404);
      expect(response.json().code).toBe("STUDENT_NOT_FOUND");
    }
  });
});
