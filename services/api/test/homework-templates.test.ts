import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/app.js";
import { config } from "../src/config.js";
import { USER_ROLES } from "../src/domain/user.js";
import { AccountStore } from "../src/lib/account-store.js";
import { hashPassword } from "../src/security/password.js";

const store = new AccountStore(":memory:");
const uploadsPath = mkdtempSync(join(tmpdir(), "hellobetty-api-test-"));
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
  const teacher = store.createUser({
    phone: "13600136000",
    displayName: "Ms. Lin",
    passwordHash: await hashPassword("TeacherPass123"),
    role: USER_ROLES.TEACHER,
  });
  return {
    student,
    teacher,
    studentToken: app.jwt.sign({ sub: student.id, role: student.role }),
    teacherToken: app.jwt.sign({ sub: teacher.id, role: teacher.role }),
  };
}

function schedule() {
  return {
    startsAt: new Date(Date.now() - 60_000).toISOString(),
    unit: "DAY" as const,
    interval: 1,
    occurrenceLimit: 1,
  };
}

function audioMultipart() {
  const boundary = "hellobetty-test-boundary";
  return {
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="attempt.webm"\r\n` +
      `Content-Type: audio/webm\r\n\r\n` +
      `test-audio\r\n--${boundary}--\r\n`,
    ),
  };
}

describe("generic homework templates", () => {
  it("validates all template payloads and rolls back invalid publication", async () => {
    const { student, teacher, teacherToken } = await createUsers();
    const classroom = store.createClassroom({
      creatorId: teacher.id,
      name: "Word class",
      teacherIds: [teacher.id],
      studentIds: [student.id],
    });
    const basePayload = {
      title: "Word practice",
      classroomId: classroom.id,
      studentIds: [student.id],
      schedule: schedule(),
    };
    const invalidCases = [
      { templateType: "SENTENCE_READ_ALOUD", items: [{ promptText: "I like apples." }] },
      {
        templateType: "WORD_READ_ALOUD",
        items: [{ promptText: "apple", sampleAudioUrl: "/uploads/apple.mp3", answerText: "apple" }],
      },
      { templateType: "WORD_IMAGE_MATCH", items: [{ answerText: "apple" }] },
      { templateType: "WORD_SCRAMBLE", items: [{ imageUrl: "/uploads/apple.png" }] },
      {
        templateType: "WORD_FILL_BLANK",
        items: [{ promptText: "I like apples.", imageUrl: "/uploads/apple.png", answerText: "apples" }],
      },
    ];
    for (const invalid of invalidCases) {
      const response = await app.inject({
        method: "POST",
        url: "/api/admin/homeworks",
        headers: { authorization: `Bearer ${teacherToken}` },
        payload: { ...basePayload, ...invalid },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe("HOMEWORK_ITEMS_INVALID");
      expect(store.listPublishedHomeworks()).toHaveLength(0);
    }

    const invalidStudent = await app.inject({
      method: "POST",
      url: "/api/admin/homeworks",
      headers: { authorization: `Bearer ${teacherToken}` },
      payload: {
        ...basePayload,
        studentIds: [student.id, "missing-student"],
        templateType: "SENTENCE_READ_ALOUD",
        items: [{ promptText: "Hello, Betty.", sampleAudioUrl: "/uploads/hello.mp3" }],
      },
    });
    expect(invalidStudent.statusCode).toBe(400);
    expect(invalidStudent.json().code).toBe("STUDENTS_NOT_ASSIGNABLE");
    expect(store.listPublishedHomeworks()).toHaveLength(0);

    const validCases = [
      {
        templateType: "SENTENCE_READ_ALOUD",
        items: [{ promptText: "I like apples.", sampleAudioUrl: "/uploads/sentence.mp3" }],
      },
      {
        templateType: "WORD_READ_ALOUD",
        items: [{
          promptText: "apple",
          imageUrl: "/uploads/apple.png",
          sampleAudioUrl: "/uploads/apple.mp3",
          answerText: "apple",
        }],
      },
      {
        templateType: "WORD_IMAGE_MATCH",
        items: [{ imageUrl: "/uploads/apple.png", answerText: "apple", choices: ["apple", "pear"] }],
      },
      {
        templateType: "WORD_SCRAMBLE",
        items: [{ imageUrl: "/uploads/apple.png", answerText: "apple" }],
      },
      {
        templateType: "WORD_FILL_BLANK",
        items: [{
          promptText: "I like ____.",
          imageUrl: "/uploads/apple.png",
          answerText: "apples",
          choices: ["apples", "pears"],
        }],
      },
    ];
    for (const valid of validCases) {
      const response = await app.inject({
        method: "POST",
        url: "/api/admin/homeworks",
        headers: { authorization: `Bearer ${teacherToken}` },
        payload: { ...basePayload, ...valid },
      });
      expect(response.statusCode).toBe(201);
      expect(response.json().homework.templateType).toBe(valid.templateType);
    }
    expect(store.listPublishedHomeworks()).toHaveLength(5);
  });

  it("reviews only the latest recording and a rerecord clears the current review", async () => {
    const { student, teacher, studentToken, teacherToken } = await createUsers();
    store.createPublishedHomework({
      publisherId: teacher.id,
      title: "Read two sentences",
      studentIds: [student.id],
      templateType: "SENTENCE_READ_ALOUD",
      items: [
        { promptText: "I see a cat.", sampleAudioUrl: "/uploads/cat.mp3" },
        { promptText: "It is happy.", sampleAudioUrl: "/uploads/happy.mp3" },
      ],
      schedule: schedule(),
    });
    const list = await app.inject({
      method: "GET",
      url: "/api/student/practice-homeworks",
      headers: { authorization: `Bearer ${studentToken}` },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().occurrences[0]).toMatchObject({
      templateType: "SENTENCE_READ_ALOUD",
      itemCount: 2,
      completedItemCount: 0,
    });
    const occurrenceId = list.json().occurrences[0].id as string;
    const detail = store.getStudentPracticeOccurrence(occurrenceId, student.id);
    const [firstItem, secondItem] = detail.items;

    const lockedMultipart = audioMultipart();
    const locked = await app.inject({
      method: "POST",
      url: `/api/student/practice-homeworks/${occurrenceId}/items/${secondItem.id}/recordings`,
      headers: { ...lockedMultipart.headers, authorization: `Bearer ${studentToken}` },
      payload: lockedMultipart.payload,
    });
    expect(locked.statusCode).toBe(409);
    expect(locked.json().code).toBe("ITEM_LOCKED");

    const firstMultipart = audioMultipart();
    const firstAttempt = await app.inject({
      method: "POST",
      url: `/api/student/practice-homeworks/${occurrenceId}/items/${firstItem.id}/recordings`,
      headers: { ...firstMultipart.headers, authorization: `Bearer ${studentToken}` },
      payload: firstMultipart.payload,
    });
    expect(firstAttempt.statusCode).toBe(201);
    expect(firstAttempt.json().occurrence.items[0]).toMatchObject({ status: "DONE", attemptNumber: 1 });

    const submissions = await app.inject({
      method: "GET",
      url: "/api/admin/practice-recording-submissions",
      headers: { authorization: `Bearer ${teacherToken}` },
    });
    expect(submissions.statusCode).toBe(200);
    expect(submissions.json().submissions[0]).toMatchObject({
      studentId: student.id,
      templateType: "SENTENCE_READ_ALOUD",
      itemId: firstItem.id,
      itemPosition: 1,
      promptText: "I see a cat.",
      status: "DONE",
    });
    const firstSubmissionId = submissions.json().submissions[0].id as string;
    const publicFeedback = await app.inject({
      method: "POST",
      url: `/api/admin/practice-recording-submissions/${firstSubmissionId}/review`,
      headers: { authorization: `Bearer ${teacherToken}` },
      payload: { grade: "A", feedbackAudioUrl: "/uploads/assets/teacher-feedback.m4a" },
    });
    expect(publicFeedback.statusCode).toBe(400);
    expect(publicFeedback.json().code).toBe("FEEDBACK_AUDIO_INVALID");

    const privateFeedbackUrl = "/uploads/feedback/00000000-0000-4000-8000-000000000002.m4a";
    store.registerFeedbackUpload({ url: privateFeedbackUrl, uploaderId: teacher.id });
    const review = await app.inject({
      method: "POST",
      url: `/api/admin/practice-recording-submissions/${firstSubmissionId}/review`,
      headers: { authorization: `Bearer ${teacherToken}` },
      payload: { grade: "A", feedbackAudioUrl: privateFeedbackUrl },
    });
    expect(review.statusCode).toBe(200);
    expect(review.json().submission).toMatchObject({ grade: "A", status: "GRADED" });

    const rerecordMultipart = audioMultipart();
    const rerecord = await app.inject({
      method: "POST",
      url: `/api/student/practice-homeworks/${occurrenceId}/items/${firstItem.id}/recordings`,
      headers: { ...rerecordMultipart.headers, authorization: `Bearer ${studentToken}` },
      payload: rerecordMultipart.payload,
    });
    expect(rerecord.statusCode).toBe(201);
    expect(rerecord.json().occurrence.items[0]).toMatchObject({
      status: "DONE",
      attemptNumber: 2,
      grade: null,
      feedbackAudioUrl: null,
    });
    const latest = store.listPracticeRecordingSubmissions();
    expect(latest).toHaveLength(1);
    expect(latest[0]).toMatchObject({ status: "DONE", grade: null });
    expect(latest[0].id).not.toBe(firstSubmissionId);

    const staleReview = await app.inject({
      method: "POST",
      url: `/api/admin/practice-recording-submissions/${firstSubmissionId}/review`,
      headers: { authorization: `Bearer ${teacherToken}` },
      payload: { grade: "B" },
    });
    expect(staleReview.statusCode).toBe(404);
  });

  it("scores objective answers and unlocks the next item only after a correct answer", async () => {
    const { student, teacher, studentToken } = await createUsers();
    store.createPublishedHomework({
      publisherId: teacher.id,
      title: "Fill the blanks",
      studentIds: [student.id],
      templateType: "WORD_FILL_BLANK",
      items: [
        {
          promptText: "I see an ____.",
          imageUrl: "/uploads/apple.png",
          answerText: "apple",
          choices: ["apple", "orange"],
        },
        {
          promptText: "It is ____.",
          imageUrl: "/uploads/red.png",
          answerText: "red",
          choices: ["red", "blue"],
        },
      ],
      schedule: schedule(),
    });
    const occurrence = store.listStudentPracticeOccurrences(student.id)[0];
    const detail = store.getStudentPracticeOccurrence(occurrence.id, student.id);
    const [firstItem, secondItem] = detail.items;
    expect(firstItem).toMatchObject({
      answerText: null,
      choices: ["apple", "orange"],
      status: "UNMADE",
      locked: false,
    });
    expect(secondItem.locked).toBe(true);

    const wrong = await app.inject({
      method: "POST",
      url: `/api/student/practice-homeworks/${occurrence.id}/items/${firstItem.id}/answers`,
      headers: { authorization: `Bearer ${studentToken}` },
      payload: { answerText: "orange" },
    });
    expect(wrong.statusCode).toBe(201);
    expect(wrong.json().isCorrect).toBe(false);
    expect(wrong.json().occurrence.items[0].status).toBe("INCORRECT");

    const stillLocked = await app.inject({
      method: "POST",
      url: `/api/student/practice-homeworks/${occurrence.id}/items/${secondItem.id}/answers`,
      headers: { authorization: `Bearer ${studentToken}` },
      payload: { answerText: "red" },
    });
    expect(stillLocked.statusCode).toBe(409);
    expect(stillLocked.json().code).toBe("ITEM_LOCKED");

    const correct = await app.inject({
      method: "POST",
      url: `/api/student/practice-homeworks/${occurrence.id}/items/${firstItem.id}/answers`,
      headers: { authorization: `Bearer ${studentToken}` },
      payload: { answerText: " Apple " },
    });
    expect(correct.statusCode).toBe(201);
    expect(correct.json().isCorrect).toBe(true);
    expect(correct.json().occurrence.items[1].locked).toBe(false);

    const completed = await app.inject({
      method: "POST",
      url: `/api/student/practice-homeworks/${occurrence.id}/items/${secondItem.id}/answers`,
      headers: { authorization: `Bearer ${studentToken}` },
      payload: { answerText: "RED" },
    });
    expect(completed.statusCode).toBe(201);
    expect(completed.json().isCorrect).toBe(true);
    expect(completed.json().occurrence.status).toBe("COMPLETED");
  });
});
