import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { buildApp } from "../src/app.js";
import { USER_ROLES } from "../src/domain/user.js";
import type { SpeechAssessmentProvider, SpeechAssessmentRequest, SpeechAssessmentResult } from "../src/domain/speech-assessment.js";
import { AccountStore } from "../src/lib/account-store.js";
import { SpeechAssessmentWorker } from "../src/lib/speech-assessment-worker.js";
import { hashPassword } from "../src/security/password.js";

const store = new AccountStore(":memory:");
const app = await buildApp(store, {
  speechAssessmentProvider: {
    id: "configured-test",
    async assess(): Promise<SpeechAssessmentResult> {
      throw new Error("not used by app worker in this test");
    },
  },
  speechAssessmentPollIntervalMs: 60 * 60 * 1000,
});

beforeAll(async () => {
  await app.ready();
});

beforeEach(() => {
  store.deleteAll();
});

afterAll(async () => {
  await app.close();
});

class FailingProvider implements SpeechAssessmentProvider {
  readonly id = "failing-provider";
  readonly requests: SpeechAssessmentRequest[] = [];

  async assess(request: SpeechAssessmentRequest): Promise<SpeechAssessmentResult> {
    this.requests.push(request);
    throw new Error("provider down");
  }
}

async function createUser(role: "ADMIN" | "TEACHER" | "STUDENT", phone: string, displayName: string) {
  return store.createUser({
    phone,
    displayName,
    passwordHash: await hashPassword("Practice123"),
    role,
  });
}

function tokenFor(user: { id: string; role: string }, role = user.role) {
  return app.jwt.sign({ sub: user.id, role });
}

function sentenceHomeworkPayload(studentIds: string[], classroomId?: string | null) {
  return {
    title: "Scoped sentence",
    classroomId,
    studentIds,
    templateType: "SENTENCE_READ_ALOUD",
    items: [{ promptText: "I see a cat.", sampleAudioUrl: "/uploads/assets/cat.mp3" }],
    schedule: {
      startsAt: new Date(Date.now() - 60_000).toISOString(),
      unit: "DAY",
      interval: 1,
      occurrenceLimit: 1,
    },
  };
}

describe("operations milestone backend", () => {
  it("adds classroom tables and nullable homework classroom ownership to legacy databases", () => {
    const directory = mkdtempSync(join(tmpdir(), "hellobetty-ops-migration-"));
    const databasePath = join(directory, "legacy.db");
    const database = new DatabaseSync(databasePath);
    database.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        phone TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'STUDENT',
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        last_login_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE homeworks (
        id TEXT PRIMARY KEY,
        publisher_id TEXT NOT NULL,
        title TEXT NOT NULL,
        instructions TEXT,
        status TEXT NOT NULL,
        template_type TEXT NOT NULL DEFAULT 'STANDARD',
        starts_at TEXT NOT NULL,
        repeat_unit TEXT NOT NULL,
        repeat_interval INTEGER NOT NULL,
        occurrence_limit INTEGER NOT NULL,
        published_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO users VALUES ('admin', '13900139000', 'Admin', 'hash', 'ADMIN', 'ACTIVE', NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
      INSERT INTO homeworks VALUES ('legacy-homework', 'admin', 'Legacy', NULL, 'PUBLISHED', 'STANDARD', '2026-01-01T00:00:00.000Z', 'DAY', 1, 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    `);
    database.close();

    new AccountStore(databasePath).close();
    const migrated = new DatabaseSync(databasePath);
    const classroomTable = migrated.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'classrooms'").get();
    const feedbackTable = migrated.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'feedback_uploads'").get();
    const homework = migrated.prepare("SELECT classroom_id FROM homeworks WHERE id = 'legacy-homework'").get() as { classroom_id: string | null };
    expect(classroomTable).toBeTruthy();
    expect(feedbackTable).toBeTruthy();
    expect(homework.classroom_id).toBeNull();
    migrated.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("returns the authorized homework by id after lifecycle updates beyond the first page", async () => {
    const admin = await createUser(USER_ROLES.ADMIN, "13910139100", "Admin");
    const student = await createUser(USER_ROLES.STUDENT, "13510135100", "Betty");
    const created: string[] = [];
    for (let index = 0; index < 1_005; index += 1) {
      const homework = store.createPublishedHomework({
        publisherId: admin.id,
        title: `Bulk ${index}`,
        studentIds: [student.id],
        schedule: {
          startsAt: new Date(Date.now() - 60_000).toISOString(),
          unit: "DAY",
          interval: 1,
          occurrenceLimit: 1,
        },
      });
      created.push(homework.id);
    }

    const updated = store.updateHomeworkStatus({
      homeworkId: created[0],
      status: "PAUSED",
      scope: { userId: admin.id, role: admin.role },
    });
    expect(updated).toMatchObject({ id: created[0], status: "PAUSED" });
  });

  it("enforces admin provisioning, classroom scope, homework lifecycle, assessment retry, and DB roles", async () => {
    const admin = await createUser(USER_ROLES.ADMIN, "13900139000", "Admin");
    const teacher = await createUser(USER_ROLES.TEACHER, "13600136000", "Ms. Lin");
    const otherTeacher = await createUser(USER_ROLES.TEACHER, "13700137000", "Ms. Wu");
    const student = await createUser(USER_ROLES.STUDENT, "13500135000", "Betty");
    const otherStudent = await createUser(USER_ROLES.STUDENT, "13400134000", "Alice");
    const adminToken = tokenFor(admin);
    const teacherToken = tokenFor(teacher);
    const forgedAdminToken = tokenFor(teacher, USER_ROLES.ADMIN);
    const studentToken = tokenFor(student);

    const context = await app.inject({ method: "GET", url: "/api/admin/context", headers: { authorization: `Bearer ${teacherToken}` } });
    expect(context.statusCode).toBe(200);
    expect(context.json()).toMatchObject({ speechAssessment: { configured: true, provider: "configured-test" } });
    expect(context.json().user.passwordHash).toBeUndefined();

    const forgedCreate = await app.inject({
      method: "POST",
      url: "/api/admin/users",
      headers: { authorization: `Bearer ${forgedAdminToken}` },
      payload: { phone: "13800138000", displayName: "Forged", password: "Practice123", role: USER_ROLES.STUDENT },
    });
    expect(forgedCreate.statusCode).toBe(403);

    const adminCreateTeacher = await app.inject({
      method: "POST",
      url: "/api/admin/users",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { phone: "13800138000", displayName: "New Teacher", password: "Practice123", role: USER_ROLES.TEACHER },
    });
    expect(adminCreateTeacher.statusCode).toBe(201);
    expect(adminCreateTeacher.json().user.passwordHash).toBeUndefined();

    const accountList = await app.inject({ method: "GET", url: "/api/admin/users", headers: { authorization: `Bearer ${adminToken}` } });
    expect(accountList.statusCode).toBe(200);
    expect(accountList.json().users.some((user: { role: string }) => user.role === USER_ROLES.TEACHER)).toBe(true);
    expect(JSON.stringify(accountList.json())).not.toContain("passwordHash");

    const classroomResponse = await app.inject({
      method: "POST",
      url: "/api/admin/classrooms",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: "Class A", teacherIds: [teacher.id], studentIds: [student.id] },
    });
    expect(classroomResponse.statusCode).toBe(201);
    expect(JSON.stringify(classroomResponse.json())).not.toContain("passwordHash");
    const classroomId = classroomResponse.json().classroom.id as string;

    const otherClassroom = store.createClassroom({
      creatorId: admin.id,
      name: "Class B",
      teacherIds: [otherTeacher.id],
      studentIds: [otherStudent.id],
    });

    const teacherClassrooms = await app.inject({ method: "GET", url: "/api/admin/classrooms", headers: { authorization: `Bearer ${teacherToken}` } });
    expect(teacherClassrooms.statusCode).toBe(200);
    expect(teacherClassrooms.json().classrooms.map((classroom: { id: string }) => classroom.id)).toEqual([classroomId]);
    const teacherClassroomUpdate = await app.inject({ method: "PATCH", url: `/api/admin/classrooms/${classroomId}`, headers: { authorization: `Bearer ${teacherToken}` }, payload: { name: "Teacher cannot rename" } });
    expect(teacherClassroomUpdate.statusCode).toBe(403);

    const teacherUsers = await app.inject({ method: "GET", url: "/api/admin/users", headers: { authorization: `Bearer ${teacherToken}` } });
    expect(teacherUsers.statusCode).toBe(200);
    expect(teacherUsers.json().users.map((user: { id: string }) => user.id)).toEqual([student.id]);

    const missingClass = await app.inject({ method: "POST", url: "/api/admin/homeworks", headers: { authorization: `Bearer ${teacherToken}` }, payload: sentenceHomeworkPayload([student.id]) });
    expect(missingClass.statusCode).toBe(403);

    const outOfClass = await app.inject({ method: "POST", url: "/api/admin/homeworks", headers: { authorization: `Bearer ${teacherToken}` }, payload: sentenceHomeworkPayload([otherStudent.id], classroomId) });
    expect(outOfClass.statusCode).toBe(400);

    const publish = await app.inject({ method: "POST", url: "/api/admin/homeworks", headers: { authorization: `Bearer ${teacherToken}` }, payload: sentenceHomeworkPayload([student.id], classroomId) });
    expect(publish.statusCode).toBe(201);
    const homeworkId = publish.json().homework.id as string;

    const legacy = store.createPublishedHomework({
      publisherId: teacher.id,
      title: "Legacy by teacher",
      studentIds: [otherStudent.id],
      schedule: sentenceHomeworkPayload([otherStudent.id]).schedule,
    });
    const otherHomework = store.createPublishedHomework({
      publisherId: otherTeacher.id,
      classroomId: otherClassroom.id,
      staffRole: USER_ROLES.TEACHER,
      title: "Other class",
      studentIds: [otherStudent.id],
      templateType: "SENTENCE_READ_ALOUD",
      items: [{ promptText: "I see a dog.", sampleAudioUrl: "/uploads/assets/dog.mp3" }],
      schedule: sentenceHomeworkPayload([otherStudent.id]).schedule,
    });
    const otherOccurrence = store.getStudentPracticeOccurrence(store.listStudentPracticeOccurrences(otherStudent.id)[0].id, otherStudent.id);
    const otherAudioUrl = `/uploads/submissions/${randomUUID()}.webm`;
    const otherSubmitted = store.submitPracticeRecording({
      occurrenceId: otherOccurrence.id,
      itemId: otherOccurrence.items[0].id,
      studentId: otherStudent.id,
      audioUrl: otherAudioUrl,
    });
    const otherSubmission = store.listPracticeRecordingSubmissions(100, { userId: otherTeacher.id, role: otherTeacher.role })[0];
    const otherAssessmentId = otherSubmitted.items[0].assessment.id as string;

    const classBStats = await app.inject({ method: "GET", url: `/api/admin/students/${otherStudent.id}/learning-stats`, headers: { authorization: `Bearer ${teacherToken}` } });
    expect(classBStats.statusCode).toBe(404);
    const classBReview = await app.inject({ method: "POST", url: `/api/admin/practice-recording-submissions/${otherSubmission.id}/review`, headers: { authorization: `Bearer ${teacherToken}` }, payload: { grade: "B" } });
    expect(classBReview.statusCode).toBe(404);
    const classBRetry = await app.inject({ method: "POST", url: `/api/admin/speech-assessments/${otherAssessmentId}/retry`, headers: { authorization: `Bearer ${teacherToken}` } });
    expect(classBRetry.statusCode).toBe(404);
    const classBMedia = await app.inject({ method: "GET", url: otherAudioUrl, headers: { authorization: `Bearer ${teacherToken}` } });
    expect(classBMedia.statusCode).toBe(404);

    const teacherHomeworks = await app.inject({ method: "GET", url: "/api/admin/homeworks", headers: { authorization: `Bearer ${teacherToken}` } });
    expect(teacherHomeworks.statusCode).toBe(200);
    const teacherHomeworkIds = teacherHomeworks.json().homeworks.map((homework: { id: string }) => homework.id);
    expect(teacherHomeworkIds).toContain(homeworkId);
    expect(teacherHomeworkIds).toContain(legacy.id);
    expect(teacherHomeworks.json().homeworks.find((homework: { id: string }) => homework.id === homeworkId)).toMatchObject({
      classroomId,
      completedOccurrenceCount: 0,
    });
    expect(teacherHomeworkIds).not.toContain(otherHomework.id);

    const teacherHistoryPageOne = await app.inject({ method: "GET", url: "/api/admin/homeworks?page=1&pageSize=1", headers: { authorization: `Bearer ${teacherToken}` } });
    const teacherHistoryPageTwo = await app.inject({ method: "GET", url: "/api/admin/homeworks?page=2&pageSize=1", headers: { authorization: `Bearer ${teacherToken}` } });
    expect(teacherHistoryPageOne.statusCode).toBe(200);
    expect(teacherHistoryPageOne.json().pagination).toEqual({ page: 1, pageSize: 1, total: 2 });
    expect(teacherHistoryPageTwo.json().pagination).toEqual({ page: 2, pageSize: 1, total: 2 });
    expect([
      teacherHistoryPageOne.json().homeworks[0].id,
      teacherHistoryPageTwo.json().homeworks[0].id,
    ]).toEqual(expect.arrayContaining([homeworkId, legacy.id]));

    const occurrenceIdBeforePause = store.listStudentPracticeOccurrences(student.id)[0].id as string;
    const pause = await app.inject({ method: "PATCH", url: `/api/admin/homeworks/${homeworkId}/status`, headers: { authorization: `Bearer ${teacherToken}` }, payload: { status: "PAUSED" } });
    expect(pause.statusCode).toBe(200);
    expect(store.listStudentPracticeOccurrences(student.id)).toHaveLength(0);

    const pausedDetail = await app.inject({ method: "GET", url: `/api/student/practice-homeworks/${occurrenceIdBeforePause}`, headers: { authorization: `Bearer ${studentToken}` } });
    expect(pausedDetail.statusCode).toBe(404);

    const resume = await app.inject({ method: "PATCH", url: `/api/admin/homeworks/${homeworkId}/status`, headers: { authorization: `Bearer ${teacherToken}` }, payload: { status: "PUBLISHED" } });
    expect(resume.statusCode).toBe(200);
    const occurrence = store.getStudentPracticeOccurrence(store.listStudentPracticeOccurrences(student.id)[0].id, student.id);
    const item = occurrence.items[0];

    const submission = store.submitPracticeRecording({ occurrenceId: occurrence.id, itemId: item.id, studentId: student.id, audioUrl: "/uploads/submissions/attempt.webm" });
    const currentSubmission = store.listPracticeRecordingSubmissions(100, { userId: teacher.id, role: teacher.role })[0];
    store.reviewPracticeRecordingSubmission({ submissionId: currentSubmission.id, grade: "A", scope: { userId: teacher.id, role: teacher.role } });

    const provider = new FailingProvider();
    const worker = new SpeechAssessmentWorker(store, provider, ".");
    await worker.processNext(new Date("2030-01-01T00:00:00.000Z"));
    await worker.processNext(new Date("2030-01-01T00:00:02.000Z"));
    await worker.processNext(new Date("2030-01-01T00:00:10.000Z"));
    await worker.processNext(new Date("2030-01-01T00:00:20.000Z"));
    await worker.processNext(new Date("2030-01-01T00:00:22.000Z"));
    await worker.processNext(new Date("2030-01-01T00:00:30.000Z"));

    const scopedQueue = await app.inject({ method: "GET", url: "/api/admin/speech-assessments", headers: { authorization: `Bearer ${teacherToken}` } });
    expect(scopedQueue.json().assessments.map((assessment: { id: string }) => assessment.id)).not.toContain(otherAssessmentId);
    expect(scopedQueue.json().summary).toMatchObject({ FAILED: 1, QUEUED: 0 });
    const failedQueue = await app.inject({ method: "GET", url: "/api/admin/speech-assessments?status=FAILED", headers: { authorization: `Bearer ${teacherToken}` } });
    expect(failedQueue.statusCode).toBe(200);
    expect(failedQueue.json().assessments).toHaveLength(1);
    expect(failedQueue.json().summary.FAILED).toBe(1);
    expect(failedQueue.json().assessments[0]).toMatchObject({ status: "FAILED", attemptCount: 3, lastError: "provider down" });
    expect(failedQueue.json().assessments[0].rawResult).toBeUndefined();
    expect(failedQueue.json().assessments[0].leaseToken).toBeUndefined();
    const assessmentId = submission.items[0].assessment.id as string;

    const retry = await app.inject({ method: "POST", url: `/api/admin/speech-assessments/${assessmentId}/retry`, headers: { authorization: `Bearer ${teacherToken}` } });
    expect(retry.statusCode).toBe(200);
    expect(retry.json().assessment).toMatchObject({ status: "QUEUED", attemptCount: 0 });
    expect(store.listPracticeRecordingSubmissions(100, { userId: teacher.id, role: teacher.role })[0]).toMatchObject({ grade: "A", status: "GRADED" });
    const progressAfterCompletion = await app.inject({ method: "GET", url: "/api/admin/homeworks", headers: { authorization: `Bearer ${teacherToken}` } });
    expect(progressAfterCompletion.json().homeworks.find((homework: { id: string }) => homework.id === homeworkId)).toMatchObject({ completedOccurrenceCount: 1 });

    const archive = await app.inject({ method: "PATCH", url: `/api/admin/homeworks/${homeworkId}/status`, headers: { authorization: `Bearer ${teacherToken}` }, payload: { status: "ARCHIVED" } });
    expect(archive.statusCode).toBe(200);
    const terminal = await app.inject({ method: "PATCH", url: `/api/admin/homeworks/${homeworkId}/status`, headers: { authorization: `Bearer ${teacherToken}` }, payload: { status: "PUBLISHED" } });
    expect(terminal.statusCode).toBe(409);
  });
});
