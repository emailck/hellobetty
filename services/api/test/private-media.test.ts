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


function feedbackMultipart() {
  const boundary = "hellobetty-feedback-boundary";
  return {
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="purpose"\r\n\r\n` +
      `FEEDBACK\r\n` +
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="feedback.webm"\r\n` +
      `Content-Type: audio/webm\r\n\r\n` +
      `teacher-feedback\r\n--${boundary}--\r\n`,
    ),
  };
}

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
    const otherTeacher = store.createUser({
      phone: "13700137000",
      displayName: "Ms. Wu",
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
    const submission = store.listPracticeRecordingSubmissions()[0];
    const teacherToken = app.jwt.sign({ sub: teacher.id, role: teacher.role });
    const otherTeacherToken = app.jwt.sign({ sub: otherTeacher.id, role: otherTeacher.role });
    const otherFeedbackUpload = await app.inject({
      method: "POST",
      url: "/api/admin/uploads",
      headers: { authorization: `Bearer ${otherTeacherToken}`, ...feedbackMultipart().headers },
      payload: feedbackMultipart().payload,
    });
    expect(otherFeedbackUpload.statusCode).toBe(201);
    const crossUploaderReview = await app.inject({
      method: "POST",
      url: `/api/admin/practice-recording-submissions/${submission.id}/review`,
      headers: { authorization: `Bearer ${teacherToken}` },
      payload: { grade: "A", feedbackAudioUrl: otherFeedbackUpload.json().url },
    });
    expect(crossUploaderReview.statusCode).toBe(400);

    const missingUploadReview = await app.inject({
      method: "POST",
      url: `/api/admin/practice-recording-submissions/${submission.id}/review`,
      headers: { authorization: `Bearer ${teacherToken}` },
      payload: { grade: "A", feedbackAudioUrl: `/uploads/feedback/${randomUUID()}.webm` },
    });
    expect(missingUploadReview.statusCode).toBe(400);

    const feedbackUpload = await app.inject({
      method: "POST",
      url: "/api/admin/uploads",
      headers: { authorization: `Bearer ${teacherToken}`, ...feedbackMultipart().headers },
      payload: feedbackMultipart().payload,
    });
    expect(feedbackUpload.statusCode).toBe(201);
    expect(feedbackUpload.json()).toMatchObject({ kind: "audio", purpose: "FEEDBACK" });
    expect(feedbackUpload.json().url).toMatch(/^\/uploads\/feedback\//);
    const firstReview = await app.inject({
      method: "POST",
      url: `/api/admin/practice-recording-submissions/${submission.id}/review`,
      headers: { authorization: `Bearer ${teacherToken}` },
      payload: { grade: "A", feedbackAudioUrl: feedbackUpload.json().url },
    });
    expect(firstReview.statusCode).toBe(200);
    const repeatedReview = await app.inject({
      method: "POST",
      url: `/api/admin/practice-recording-submissions/${submission.id}/review`,
      headers: { authorization: `Bearer ${teacherToken}` },
      payload: { grade: "B" },
    });
    expect(repeatedReview.statusCode).toBe(200);
    expect(repeatedReview.json().submission).toMatchObject({
      grade: "B",
      feedbackAudioUrl: feedbackUpload.json().url,
    });

    store.submitPracticeRecording({
      occurrenceId,
      itemId: item.id,
      studentId: student.id,
      audioUrl: `/uploads/submissions/${randomUUID()}.webm`,
    });
    const secondSubmission = store.listPracticeRecordingSubmissions()[0];
    const crossSubmissionReview = await app.inject({
      method: "POST",
      url: `/api/admin/practice-recording-submissions/${secondSubmission.id}/review`,
      headers: { authorization: `Bearer ${teacherToken}` },
      payload: { grade: "A", feedbackAudioUrl: feedbackUpload.json().url },
    });
    expect(crossSubmissionReview.statusCode).toBe(400);
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

    const feedbackAnonymous = await app.inject({ method: "GET", url: feedbackUpload.json().url });
    expect(feedbackAnonymous.statusCode).toBe(401);
    const feedbackOtherStudent = await app.inject({
      method: "GET",
      url: feedbackUpload.json().url,
      headers: { authorization: `Bearer ${app.jwt.sign({ sub: otherStudent.id, role: otherStudent.role })}` },
    });
    expect(feedbackOtherStudent.statusCode).toBe(404);
    const feedbackStudent = await app.inject({
      method: "GET",
      url: feedbackUpload.json().url,
      headers: { authorization: `Bearer ${app.jwt.sign({ sub: student.id, role: student.role })}` },
    });
    expect(feedbackStudent.statusCode).toBe(200);
    expect(feedbackStudent.rawPayload.toString()).toBe("teacher-feedback");
    const feedbackOtherTeacher = await app.inject({
      method: "GET",
      url: feedbackUpload.json().url,
      headers: { authorization: `Bearer ${app.jwt.sign({ sub: otherTeacher.id, role: otherTeacher.role })}` },
    });
    expect(feedbackOtherTeacher.statusCode).toBe(404);
  });
});
