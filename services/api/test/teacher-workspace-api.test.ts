import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { HOMEWORK_STATUS } from "../src/domain/homework.js";
import { USER_ROLES } from "../src/domain/user.js";
import { AccountStore } from "../src/lib/account-store.js";
import { hashPassword } from "../src/security/password.js";

const store = new AccountStore(":memory:");
const app = await buildApp(store);

beforeEach(() => store.deleteAll());
afterAll(async () => app.close());

async function createUser(role: "ADMIN" | "TEACHER" | "STUDENT", phone: string, displayName: string) {
  return store.createUser({
    phone,
    displayName,
    passwordHash: await hashPassword("Practice123"),
    role,
  });
}

function tokenFor(user: { id: string; role: string }) {
  return app.jwt.sign({ sub: user.id, role: user.role });
}

function schedule() {
  return {
    startsAt: new Date(Date.now() - 60_000).toISOString(),
    unit: "DAY" as const,
    interval: 1,
    occurrenceLimit: 1,
  };
}

async function createSubmissionFixture() {
  const teacher = await createUser(USER_ROLES.TEACHER, "13630136001", "Ms. Groups");
  const betty = await createUser(USER_ROLES.STUDENT, "13530135001", "Betty Blue");
  const alice = await createUser(USER_ROLES.STUDENT, "13530135002", "Alice Amber");
  const classroom = store.createClassroom({
    creatorId: teacher.id,
    name: "Groups Class",
    teacherIds: [teacher.id],
    studentIds: [betty.id, alice.id],
  });
  const firstHomework = store.createPublishedHomework({
    publisherId: teacher.id,
    classroomId: classroom.id,
    staffRole: USER_ROLES.TEACHER,
    title: "Apple match",
    studentIds: [betty.id, alice.id],
    schedule: schedule(),
    templateType: "WORD_IMAGE_MATCH",
    items: [{ imageUrl: "/uploads/assets/apple.png", answerText: "apple", choices: ["apple", "pear"] }],
  });
  const secondHomework = store.createPublishedHomework({
    publisherId: teacher.id,
    classroomId: classroom.id,
    staffRole: USER_ROLES.TEACHER,
    title: "Banana match",
    studentIds: [betty.id],
    schedule: schedule(),
    templateType: "WORD_IMAGE_MATCH",
    items: [{ imageUrl: "/uploads/assets/banana.png", answerText: "banana", choices: ["banana", "pear"] }],
  });

  for (const student of [betty, alice]) {
    const occurrence = store.listStudentPracticeOccurrences(student.id)
      .find((item) => item.title === firstHomework.title)!;
    const item = store.getStudentPracticeOccurrence(occurrence.id, student.id).items[0];
    store.submitPracticeAnswer({ occurrenceId: occurrence.id, itemId: item.id, studentId: student.id, answerText: "apple" });
  }
  const secondOccurrence = store.listStudentPracticeOccurrences(betty.id)
    .find((item) => item.title === secondHomework.title)!;
  const secondItem = store.getStudentPracticeOccurrence(secondOccurrence.id, betty.id).items[0];
  store.submitPracticeAnswer({ occurrenceId: secondOccurrence.id, itemId: secondItem.id, studentId: betty.id, answerText: "banana" });

  return { teacher, betty, alice, classroom, firstHomework, secondHomework, token: tokenFor(teacher) };
}

describe("teacher workspace API additions", () => {
  it("groups submissions by published homework with pending filters, pagination, and student search", async () => {
    const fixture = await createSubmissionFixture();
    const headers = { authorization: `Bearer ${fixture.token}` };

    const firstList = await app.inject({
      method: "GET",
      url: `/api/admin/homework-submissions?homeworkId=${fixture.firstHomework.id}&studentId=${fixture.betty.id}`,
      headers,
    });
    const occurrenceId = firstList.json().conversations[0].occurrenceId as string;
    const detail = await app.inject({ method: "GET", url: `/api/admin/homework-submissions/${occurrenceId}`, headers });
    const submissionId = detail.json().conversation.questions[0].submissionId as string;
    const reviewed = await app.inject({
      method: "POST",
      url: `/api/admin/homework-submissions/${occurrenceId}/ITEM/${submissionId}/review`,
      headers,
      payload: { grade: "SSS" },
    });
    expect(reviewed.statusCode).toBe(200);
    expect(reviewed.json().conversation.questions[0]).toMatchObject({ grade: "SSS", reviewStatus: "REVIEWED" });

    const pendingGroups = await app.inject({
      method: "GET",
      url: "/api/admin/homework-submission-groups?reviewMode=PENDING&page=1&pageSize=1",
      headers,
    });
    expect(pendingGroups.statusCode).toBe(200);
    expect(pendingGroups.json().pagination).toMatchObject({ page: 1, pageSize: 1, total: 2 });
    expect(pendingGroups.json().groups).toHaveLength(1);

    const completePendingSummary = await app.inject({
      method: "GET",
      url: "/api/admin/homework-submission-groups?reviewMode=PENDING&page=1&pageSize=20",
      headers,
    });
    const firstHomeworkGroup = completePendingSummary.json().groups.find(
      (group: { homeworkId: string }) => group.homeworkId === fixture.firstHomework.id,
    );
    expect(firstHomeworkGroup).toMatchObject({
      submittedOccurrenceCount: 2,
      pendingReviewCount: 1,
      reviewedOccurrenceCount: 1,
      submittedQuestionCount: 2,
      reviewedQuestionCount: 1,
    });

    const searched = await app.inject({
      method: "GET",
      url: "/api/admin/homework-submission-groups?reviewMode=PENDING&studentSearch=Alice",
      headers,
    });
    expect(searched.statusCode).toBe(200);
    expect(searched.json().pagination.total).toBe(1);
    expect(searched.json().groups[0]).toMatchObject({
      homeworkId: fixture.firstHomework.id,
      title: "Apple match",
      assignedStudentCount: 2,
      submittedOccurrenceCount: 1,
      pendingReviewCount: 1,
      submittedQuestionCount: 1,
      reviewedQuestionCount: 0,
    });

    const pendingConversations = await app.inject({
      method: "GET",
      url: `/api/admin/homework-submissions?reviewMode=PENDING&studentSearch=Betty&homeworkId=${fixture.firstHomework.id}`,
      headers,
    });
    expect(pendingConversations.statusCode).toBe(200);
    expect(pendingConversations.json().pagination.total).toBe(0);
  });

  it("accepts only SSS/SS/S/A/B review grades on staff review routes", async () => {
    const fixture = await createSubmissionFixture();
    const headers = { authorization: `Bearer ${fixture.token}` };
    const list = await app.inject({
      method: "GET",
      url: `/api/admin/homework-submissions?homeworkId=${fixture.secondHomework.id}`,
      headers,
    });
    const occurrenceId = list.json().conversations[0].occurrenceId as string;
    const detail = await app.inject({ method: "GET", url: `/api/admin/homework-submissions/${occurrenceId}`, headers });
    const submissionId = detail.json().conversation.questions[0].submissionId as string;

    for (const grade of ["C", "D"]) {
      const rejected = await app.inject({
        method: "POST",
        url: `/api/admin/homework-submissions/${occurrenceId}/ITEM/${submissionId}/review`,
        headers,
        payload: { grade },
      });
      expect(rejected.statusCode).toBe(400);
    }

    const accepted = await app.inject({
      method: "POST",
      url: `/api/admin/homework-submissions/${occurrenceId}/ITEM/${submissionId}/review`,
      headers,
      payload: { grade: "B" },
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().conversation.questions[0].grade).toBe("B");
  });

  it("lets teachers create assigned classes and edit only active own class students", async () => {
    const teacher = await createUser(USER_ROLES.TEACHER, "13630136011", "Ms. Class");
    const otherTeacher = await createUser(USER_ROLES.TEACHER, "13630136012", "Ms. Other");
    const betty = await createUser(USER_ROLES.STUDENT, "13530135011", "Betty Class");
    const alice = await createUser(USER_ROLES.STUDENT, "13530135012", "Alice Class");
    const headers = { authorization: `Bearer ${tokenFor(teacher)}` };

    const candidates = await app.inject({ method: "GET", url: "/api/admin/classroom-student-candidates", headers });
    expect(candidates.statusCode).toBe(200);
    expect(candidates.json().students).toEqual(expect.arrayContaining([
      { id: alice.id, phone: alice.phone, displayName: alice.displayName },
      { id: betty.id, phone: betty.phone, displayName: betty.displayName },
    ]));

    const created = await app.inject({
      method: "POST",
      url: "/api/admin/classrooms",
      headers,
      payload: { name: "Teacher Built", studentIds: [betty.id] },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().classroom).toMatchObject({ name: "Teacher Built", teachers: [expect.objectContaining({ id: teacher.id })] });
    expect(created.json().classroom.students).toEqual([expect.objectContaining({ id: betty.id })]);

    const forbiddenCreate = await app.inject({
      method: "POST",
      url: "/api/admin/classrooms",
      headers,
      payload: { name: "Bad Class", teacherIds: [otherTeacher.id], studentIds: [alice.id] },
    });
    expect(forbiddenCreate.statusCode).toBe(403);

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/admin/classrooms/${created.json().classroom.id}`,
      headers,
      payload: { name: "Teacher Updated", studentIds: [alice.id] },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().classroom).toMatchObject({ name: "Teacher Updated", studentCount: 1 });
    expect(patched.json().classroom.students[0]).toMatchObject({ id: alice.id });

    const forbiddenPatch = await app.inject({
      method: "PATCH",
      url: `/api/admin/classrooms/${created.json().classroom.id}`,
      headers,
      payload: { teacherIds: [otherTeacher.id] },
    });
    expect(forbiddenPatch.statusCode).toBe(403);

    const otherClass = store.createClassroom({
      creatorId: otherTeacher.id,
      name: "Other Class",
      teacherIds: [otherTeacher.id],
      studentIds: [betty.id],
    });
    const deniedOtherClass = await app.inject({
      method: "PATCH",
      url: `/api/admin/classrooms/${otherClass.id}`,
      headers,
      payload: { name: "Takeover" },
    });
    expect(deniedOtherClass.statusCode).toBe(404);
  });

  it("filters published history and homework templates with matching counts", async () => {
    const teacher = await createUser(USER_ROLES.TEACHER, "13630136021", "Ms. Filter");
    const student = await createUser(USER_ROLES.STUDENT, "13530135021", "Filter Student");
    const classroom = store.createClassroom({
      creatorId: teacher.id,
      name: "Filter Class",
      teacherIds: [teacher.id],
      studentIds: [student.id],
    });
    const headers = { authorization: `Bearer ${tokenFor(teacher)}` };
    const apple = store.createPublishedHomework({
      publisherId: teacher.id,
      classroomId: classroom.id,
      staffRole: USER_ROLES.TEACHER,
      title: "Apple library",
      studentIds: [student.id],
      schedule: schedule(),
      templateType: "WORD_READ_ALOUD",
      items: [{ promptText: "apple", imageUrl: "/uploads/assets/apple.png", sampleAudioUrl: "/uploads/assets/apple.mp3", answerText: "apple" }],
    });
    const banana = store.createPublishedHomework({
      publisherId: teacher.id,
      classroomId: classroom.id,
      staffRole: USER_ROLES.TEACHER,
      title: "Banana library",
      studentIds: [student.id],
      schedule: schedule(),
      templateType: "WORD_IMAGE_MATCH",
      items: [{ imageUrl: "/uploads/assets/banana.png", answerText: "banana", choices: ["banana", "pear"] }],
    });
    store.updateHomeworkStatus({ homeworkId: banana.id, status: HOMEWORK_STATUS.PAUSED, scope: { userId: teacher.id, role: teacher.role } });

    const history = await app.inject({
      method: "GET",
      url: `/api/admin/homeworks?search=Apple&status=PUBLISHED&classroomId=${classroom.id}`,
      headers,
    });
    expect(history.statusCode).toBe(200);
    expect(history.json().pagination.total).toBe(1);
    expect(history.json().homeworks[0]).toMatchObject({ id: apple.id, title: "Apple library" });

    const templates = await app.inject({
      method: "GET",
      url: "/api/admin/homework-templates?search=Apple&templateType=WORD_READ_ALOUD",
      headers,
    });
    expect(templates.statusCode).toBe(200);
    expect(templates.json().pagination.total).toBe(1);
    expect(templates.json().templates[0]).toMatchObject({
      title: "Apple library",
      templateType: "WORD_READ_ALOUD",
      publishedHomeworkCount: 1,
      lastPublishedAt: apple.publishedAt,
    });
  });
});
