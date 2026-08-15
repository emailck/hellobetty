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
    phone: "13600136101",
    displayName: "Ms. Lin",
    passwordHash: await hashPassword("TeacherPass123"),
    role: USER_ROLES.TEACHER,
  });
  const students = await Promise.all([
    ["13500135101", "Betty"],
    ["13500135102", "Alice"],
    ["13500135103", "Cindy"],
  ].map(async ([phone, displayName]) => store.createUser({
    phone,
    displayName,
    passwordHash: await hashPassword("StudentPass123"),
    role: USER_ROLES.STUDENT,
  })));
  const classroom = store.createClassroom({
    creatorId: teacher.id,
    name: "English 1",
    teacherIds: [teacher.id],
    studentIds: students.map((student) => student.id),
  });
  const startsAt = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();
  const homework = store.createPublishedHomework({
    publisherId: teacher.id,
    classroomId: classroom.id,
    staffRole: USER_ROLES.TEACHER,
    title: "Daily words",
    studentIds: students.map((student) => student.id),
    schedule: { startsAt, unit: "DAY", interval: 1, occurrenceLimit: 3 },
    templateType: "WORD_IMAGE_MATCH",
    items: [
      { imageUrl: "/uploads/assets/apple.png", answerText: "apple", choices: ["apple", "pear"] },
      { imageUrl: "/uploads/assets/banana.png", answerText: "banana", choices: ["banana", "orange"] },
    ],
  });

  const latestOccurrences = students.map((student) => {
    const occurrences = store.listStudentPracticeOccurrences(student.id)
      .filter((occurrence) => occurrence.title === homework.title)
      .sort((left, right) => right.scheduledAt.localeCompare(left.scheduledAt));
    return store.getStudentPracticeOccurrence(occurrences[0].id, student.id);
  });
  for (const [index, item] of latestOccurrences[0].items.entries()) {
    store.submitPracticeAnswer({
      occurrenceId: latestOccurrences[0].id,
      itemId: item.id,
      studentId: students[0].id,
      answerText: index === 0 ? "apple" : "banana",
    });
  }
  store.submitPracticeAnswer({
    occurrenceId: latestOccurrences[1].id,
    itemId: latestOccurrences[1].items[0].id,
    studentId: students[1].id,
    answerText: "apple",
  });

  return {
    teacher,
    students,
    homework,
    latestOccurrences,
    token: app.jwt.sign({ sub: teacher.id, role: teacher.role }),
  };
}

describe("staff latest homework cycle", () => {
  it("lists every assigned student and counts check-in only after all questions are complete", async () => {
    const fixture = await createFixture();
    const response = await app.inject({
      method: "GET",
      url: `/api/admin/homeworks/${fixture.homework.id}/latest-cycle`,
      headers: { authorization: `Bearer ${fixture.token}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().homework).toMatchObject({
      id: fixture.homework.id,
      title: "Daily words",
      targetCount: 3,
    });
    expect(response.json().cycle).toMatchObject({
      sequenceNumber: 2,
      studentCount: 3,
      checkedInCount: 1,
      inProgressCount: 1,
      notStartedCount: 1,
    });
    expect(response.json().cycle.students).toEqual(expect.arrayContaining([
      expect.objectContaining({
        studentId: fixture.students[0].id,
        occurrenceId: fixture.latestOccurrences[0].id,
        status: "CHECKED_IN",
        submittedCount: 2,
        totalCount: 2,
      }),
      expect.objectContaining({
        studentId: fixture.students[1].id,
        status: "IN_PROGRESS",
        submittedCount: 1,
        totalCount: 2,
      }),
      expect.objectContaining({
        studentId: fixture.students[2].id,
        status: "NOT_STARTED",
        submittedCount: 0,
        totalCount: 2,
        lastSubmittedAt: null,
      }),
    ]));

    const history = await app.inject({
      method: "GET",
      url: "/api/admin/homeworks",
      headers: { authorization: `Bearer ${fixture.token}` },
    });
    expect(history.json().homeworks[0]).toMatchObject({
      occurrenceCount: 9,
      completedOccurrenceCount: 1,
    });
  });

  it("does not expose a homework outside the teacher's active classroom scope", async () => {
    const fixture = await createFixture();
    const outsider = store.createUser({
      phone: "13600136109",
      displayName: "Outside teacher",
      passwordHash: await hashPassword("TeacherPass123"),
      role: USER_ROLES.TEACHER,
    });
    const response = await app.inject({
      method: "GET",
      url: `/api/admin/homeworks/${fixture.homework.id}/latest-cycle`,
      headers: { authorization: `Bearer ${app.jwt.sign({ sub: outsider.id, role: outsider.role })}` },
    });

    expect(response.statusCode).toBe(404);
  });

  it("returns no current cycle before the first scheduled cycle starts", async () => {
    const teacher = store.createUser({
      phone: "13600136111",
      displayName: "Ms. Future",
      passwordHash: await hashPassword("TeacherPass123"),
      role: USER_ROLES.TEACHER,
    });
    const student = store.createUser({
      phone: "13500135111",
      displayName: "Future student",
      passwordHash: await hashPassword("StudentPass123"),
      role: USER_ROLES.STUDENT,
    });
    const classroom = store.createClassroom({
      creatorId: teacher.id,
      name: "Future class",
      teacherIds: [teacher.id],
      studentIds: [student.id],
    });
    const homework = store.createPublishedHomework({
      publisherId: teacher.id,
      classroomId: classroom.id,
      staffRole: USER_ROLES.TEACHER,
      title: "Future work",
      studentIds: [student.id],
      schedule: {
        startsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        unit: "DAY",
        interval: 1,
        occurrenceLimit: 1,
      },
      templateType: "WORD_IMAGE_MATCH",
      items: [{ imageUrl: "/uploads/assets/apple.png", answerText: "apple", choices: ["apple"] }],
    });
    const response = await app.inject({
      method: "GET",
      url: `/api/admin/homeworks/${homework.id}/latest-cycle`,
      headers: { authorization: `Bearer ${app.jwt.sign({ sub: teacher.id, role: teacher.role })}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ homework: { id: homework.id }, cycle: null });
  });
});
