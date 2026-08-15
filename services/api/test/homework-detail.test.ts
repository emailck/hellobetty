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
    phone: "13600136201",
    displayName: "Ms. Detail",
    passwordHash: await hashPassword("TeacherPass123"),
    role: USER_ROLES.TEACHER,
  });
  const students = await Promise.all([
    ["13500135201", "Betty"],
    ["13500135202", "Alice"],
  ].map(async ([phone, displayName]) => store.createUser({
    phone,
    displayName,
    passwordHash: await hashPassword("StudentPass123"),
    role: USER_ROLES.STUDENT,
  })));
  const classroom = store.createClassroom({
    creatorId: teacher.id,
    name: "Detail Class",
    teacherIds: [teacher.id],
    studentIds: students.map((student) => student.id),
  });
  return {
    teacher,
    students,
    classroom,
    token: app.jwt.sign({ sub: teacher.id, role: teacher.role }),
  };
}

describe("staff published homework detail", () => {
  it("returns recipients and ordered generic homework content", async () => {
    const fixture = await createFixture();
    const homework = store.createPublishedHomework({
      publisherId: fixture.teacher.id,
      classroomId: fixture.classroom.id,
      staffRole: USER_ROLES.TEACHER,
      title: "Fill the words",
      instructions: "Look and complete.",
      studentIds: fixture.students.map((student) => student.id),
      schedule: { startsAt: new Date().toISOString(), unit: "DAY", interval: 2, occurrenceLimit: 3 },
      templateType: "WORD_FILL_BLANK",
      items: [
        { promptText: "This is an ____.", imageUrl: "/uploads/assets/apple.png", answerText: "apple", choices: ["apple", "pear"] },
        { promptText: "This is a ____.", imageUrl: "/uploads/assets/banana.png", answerText: "banana", choices: ["orange", "banana"] },
      ],
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/admin/homeworks/${homework.id}`,
      headers: { authorization: `Bearer ${fixture.token}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      homework: {
        id: homework.id,
        title: "Fill the words",
        instructions: "Look and complete.",
        classroomName: "Detail Class",
        repeatInterval: 2,
        occurrenceLimit: 3,
        targetCount: 2,
      },
      recipients: [
        { displayName: "Alice", phone: "13500135202" },
        { displayName: "Betty", phone: "13500135201" },
      ],
      questions: [
        {
          sourceKind: "ITEM",
          position: 1,
          promptText: "This is an ____.",
          imageUrl: "/uploads/assets/apple.png",
          answerText: "apple",
          choices: ["apple", "pear"],
        },
        {
          sourceKind: "ITEM",
          position: 2,
          answerText: "banana",
          choices: ["orange", "banana"],
        },
      ],
    });
  });

  it("returns ordered picture-book pages", async () => {
    const fixture = await createFixture();
    const homework = store.createPublishedHomework({
      publisherId: fixture.teacher.id,
      classroomId: fixture.classroom.id,
      staffRole: USER_ROLES.TEACHER,
      title: "My picture book",
      studentIds: [fixture.students[0].id],
      schedule: { startsAt: new Date().toISOString(), unit: "WEEK", interval: 1, occurrenceLimit: 1 },
      templateType: "READ_ALOUD_PICTURE_BOOK",
      cards: [
        { imageUrl: "/uploads/assets/page-1.png", sampleAudioUrl: "/uploads/assets/page-1.m4a", referenceText: "This is my family." },
      ],
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/admin/homeworks/${homework.id}`,
      headers: { authorization: `Bearer ${fixture.token}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().questions).toEqual([
      expect.objectContaining({
        sourceKind: "CARD",
        position: 1,
        referenceText: "This is my family.",
        imageUrl: "/uploads/assets/page-1.png",
        sampleAudioUrl: "/uploads/assets/page-1.m4a",
      }),
    ]);
  });

  it("does not expose homework outside the teacher's active classroom scope", async () => {
    const fixture = await createFixture();
    const homework = store.createPublishedHomework({
      publisherId: fixture.teacher.id,
      classroomId: fixture.classroom.id,
      staffRole: USER_ROLES.TEACHER,
      title: "Private class work",
      studentIds: [fixture.students[0].id],
      schedule: { startsAt: new Date().toISOString(), unit: "DAY", interval: 1, occurrenceLimit: 1 },
      templateType: "WORD_SCRAMBLE",
      items: [{ imageUrl: "/uploads/assets/apple.png", answerText: "apple" }],
    });
    const outsider = store.createUser({
      phone: "13600136209",
      displayName: "Outside teacher",
      passwordHash: await hashPassword("TeacherPass123"),
      role: USER_ROLES.TEACHER,
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/admin/homeworks/${homework.id}`,
      headers: { authorization: `Bearer ${app.jwt.sign({ sub: outsider.id, role: outsider.role })}` },
    });

    expect(response.statusCode).toBe(404);
  });
});
