import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { USER_ROLES } from "../src/domain/user.js";
import { AccountStore } from "../src/lib/account-store.js";
import { hashPassword } from "../src/security/password.js";

const store = new AccountStore(":memory:");
const app = await buildApp(store);

beforeEach(() => store.deleteAll());
afterAll(async () => app.close());

async function createFixture() {
  const teacher = store.createUser({
    phone: "13600136001",
    displayName: "Ms. Lin",
    passwordHash: await hashPassword("TeacherPass123"),
    role: USER_ROLES.TEACHER,
  });
  const betty = store.createUser({
    phone: "13500135001",
    displayName: "Betty",
    passwordHash: await hashPassword("StudentPass123"),
    role: USER_ROLES.STUDENT,
  });
  const alice = store.createUser({
    phone: "13500135002",
    displayName: "Alice",
    passwordHash: await hashPassword("StudentPass123"),
    role: USER_ROLES.STUDENT,
  });
  const classroom = store.createClassroom({
    creatorId: teacher.id,
    name: "English 1",
    teacherIds: [teacher.id],
    studentIds: [betty.id, alice.id],
  });
  const schedule = {
    startsAt: new Date(Date.now() - 60_000).toISOString(),
    unit: "DAY" as const,
    interval: 1,
    occurrenceLimit: 1,
  };
  const wordHomework = store.createPublishedHomework({
    publisherId: teacher.id,
    classroomId: classroom.id,
    staffRole: USER_ROLES.TEACHER,
    title: "Picture words",
    studentIds: [betty.id, alice.id],
    schedule,
    templateType: "WORD_IMAGE_MATCH",
    items: [{ imageUrl: "/uploads/assets/apple.png", answerText: "apple", choices: ["apple", "pear"] }],
  });
  const sentenceHomework = store.createPublishedHomework({
    publisherId: teacher.id,
    classroomId: classroom.id,
    staffRole: USER_ROLES.TEACHER,
    title: "Read a sentence",
    studentIds: [betty.id],
    schedule,
    templateType: "SENTENCE_READ_ALOUD",
    items: [{ promptText: "I see an apple.", sampleAudioUrl: "/uploads/assets/sentence.mp3" }],
  });

  for (const student of [betty, alice]) {
    const occurrence = store.listStudentPracticeOccurrences(student.id)
      .find((item) => item.title === wordHomework.title)!;
    const item = store.getStudentPracticeOccurrence(occurrence.id, student.id).items[0];
    store.submitPracticeAnswer({ occurrenceId: occurrence.id, itemId: item.id, studentId: student.id, answerText: "apple" });
  }
  const sentenceOccurrence = store.listStudentPracticeOccurrences(betty.id)
    .find((item) => item.title === sentenceHomework.title)!;
  const sentenceItem = store.getStudentPracticeOccurrence(sentenceOccurrence.id, betty.id).items[0];
  store.submitPracticeRecording({
    occurrenceId: sentenceOccurrence.id,
    itemId: sentenceItem.id,
    studentId: betty.id,
    audioUrl: "/uploads/submissions/betty-sentence.webm",
    durationSeconds: 5,
  });

  return {
    teacher,
    betty,
    alice,
    wordHomework,
    sentenceHomework,
    sentenceOccurrence,
    token: app.jwt.sign({ sub: teacher.id, role: teacher.role }),
  };
}

describe("staff homework submission conversations", () => {
  it("groups every template by student occurrence and exposes review progress", async () => {
    const fixture = await createFixture();
    const response = await app.inject({
      method: "GET",
      url: "/api/admin/homework-submissions?page=1&pageSize=20",
      headers: { authorization: `Bearer ${fixture.token}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().pagination.total).toBe(3);
    expect(response.json().conversations).toHaveLength(3);
    expect(response.json().conversations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        studentId: fixture.betty.id,
        homeworkId: fixture.wordHomework.id,
        submittedCount: 1,
        reviewedCount: 0,
        totalCount: 1,
        reviewStatus: "PENDING_REVIEW",
      }),
      expect.objectContaining({
        occurrenceId: fixture.sentenceOccurrence.id,
        homeworkId: fixture.sentenceHomework.id,
        submittedCount: 1,
        reviewedCount: 0,
      }),
    ]));
    expect(response.json().filters.students).toEqual(expect.arrayContaining([
      { id: fixture.betty.id, displayName: "Betty" },
      { id: fixture.alice.id, displayName: "Alice" },
    ]));
  });

  it("filters by student, homework, and latest submission time", async () => {
    const fixture = await createFixture();
    const headers = { authorization: `Bearer ${fixture.token}` };
    const student = await app.inject({
      method: "GET",
      url: `/api/admin/homework-submissions?studentId=${fixture.betty.id}`,
      headers,
    });
    const homework = await app.inject({
      method: "GET",
      url: `/api/admin/homework-submissions?homeworkId=${fixture.wordHomework.id}`,
      headers,
    });
    const future = encodeURIComponent(new Date(Date.now() + 60_000).toISOString());
    const time = await app.inject({
      method: "GET",
      url: `/api/admin/homework-submissions?submittedFrom=${future}`,
      headers,
    });

    expect(student.json().pagination.total).toBe(2);
    expect(homework.json().pagination.total).toBe(2);
    expect(time.json().pagination.total).toBe(0);
  });

  it("shows every question and reviews objective and recording submissions", async () => {
    const fixture = await createFixture();
    const headers = { authorization: `Bearer ${fixture.token}` };
    const list = await app.inject({
      method: "GET",
      url: `/api/admin/homework-submissions?studentId=${fixture.betty.id}&homeworkId=${fixture.wordHomework.id}`,
      headers,
    });
    const occurrenceId = list.json().conversations[0].occurrenceId as string;
    const detail = await app.inject({
      method: "GET",
      url: `/api/admin/homework-submissions/${occurrenceId}`,
      headers,
    });

    expect(detail.statusCode).toBe(200);
    expect(detail.json().conversation.questions[0]).toMatchObject({
      sourceKind: "ITEM",
      answerText: "apple",
      submittedAnswerText: "apple",
      isCorrect: true,
      reviewStatus: "PENDING_REVIEW",
    });
    const submissionId = detail.json().conversation.questions[0].submissionId as string;
    const review = await app.inject({
      method: "POST",
      url: `/api/admin/homework-submissions/${occurrenceId}/ITEM/${submissionId}/review`,
      headers,
      payload: { grade: "A" },
    });

    expect(review.statusCode).toBe(200);
    expect(review.json().conversation).toMatchObject({
      reviewedCount: 1,
      submittedCount: 1,
      reviewStatus: "REVIEWED",
    });
    expect(review.json().conversation.questions[0]).toMatchObject({ grade: "A", reviewStatus: "REVIEWED" });
    const studentList = store.listStudentPracticeOccurrences(fixture.betty.id);
    expect(studentList.find((item) => item.title === fixture.wordHomework.title)).toMatchObject({ reviewedItemCount: 1 });
    expect(store.getStudentPracticeOccurrence(occurrenceId, fixture.betty.id).items[0]).toMatchObject({ status: "GRADED", grade: "A" });

    const sentenceDetail = await app.inject({
      method: "GET",
      url: `/api/admin/homework-submissions/${fixture.sentenceOccurrence.id}`,
      headers,
    });
    expect(sentenceDetail.json().conversation.questions[0]).toMatchObject({
      sourceKind: "ITEM",
      submissionType: "RECORDING",
      audioUrl: "/uploads/submissions/betty-sentence.webm",
    });
  });

  it("keeps list, detail, and review inside the teacher's active classroom scope", async () => {
    const fixture = await createFixture();
    const outsider = store.createUser({
      phone: "13600136009",
      displayName: "Outside teacher",
      passwordHash: await hashPassword("TeacherPass123"),
      role: USER_ROLES.TEACHER,
    });
    const headers = { authorization: `Bearer ${app.jwt.sign({ sub: outsider.id, role: outsider.role })}` };
    const list = await app.inject({ method: "GET", url: "/api/admin/homework-submissions", headers });
    expect(list.statusCode).toBe(200);
    expect(list.json().conversations).toEqual([]);

    const detail = await app.inject({
      method: "GET",
      url: `/api/admin/homework-submissions/${fixture.sentenceOccurrence.id}`,
      headers,
    });
    expect(detail.statusCode).toBe(404);

    const submission = store.getHomeworkSubmissionConversation(
      fixture.sentenceOccurrence.id,
      { userId: fixture.teacher.id, role: fixture.teacher.role },
    ).questions[0];
    const review = await app.inject({
      method: "POST",
      url: `/api/admin/homework-submissions/${fixture.sentenceOccurrence.id}/ITEM/${submission.submissionId}/review`,
      headers,
      payload: { grade: "A" },
    });
    expect(review.statusCode).toBe(404);
  });
});
