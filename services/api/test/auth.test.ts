import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import {
  AccountStore,
  InvalidCardSequenceError,
  ReviewSubmissionNotFoundError,
} from "../src/lib/account-store.js";
import { hashPassword } from "../src/security/password.js";
import { USER_ROLES } from "../src/domain/user.js";

const store = new AccountStore(":memory:");
const app = await buildApp(store);

beforeAll(async () => {
  await app.ready();
});

beforeEach(async () => {
  store.deleteAll();
});

afterAll(async () => {
  await app.close();
});

describe("account flow", () => {
  it("registers a student and restores the session", async () => {
    const register = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        phone: "+86 138-0013-8000",
        displayName: "Betty",
        password: "Practice123",
      },
    });

    expect(register.statusCode).toBe(201);
    const registered = register.json();
    expect(registered.user).toMatchObject({
      phone: "13800138000",
      displayName: "Betty",
      role: "STUDENT",
    });
    expect(registered.user.passwordHash).toBeUndefined();

    const me = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { authorization: `Bearer ${registered.token}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.phone).toBe("13800138000");
  });

  it("rejects duplicate registration and invalid login", async () => {
    const payload = {
      phone: "13900139000",
      displayName: "Alice",
      password: "Practice123",
    };
    await app.inject({ method: "POST", url: "/api/auth/register", payload });

    const duplicate = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload,
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().code).toBe("PHONE_ALREADY_REGISTERED");

    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { phone: payload.phone, password: "WrongPass123" },
    });
    expect(login.statusCode).toBe(401);
    expect(login.json().code).toBe("INVALID_CREDENTIALS");
  });

  it("allows staff but not students to list student accounts", async () => {
    const studentRegister = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        phone: "13700137000",
        displayName: "Chris",
        password: "Practice123",
      },
    });
    const registeredStudent = studentRegister.json().user;
    const studentToken = studentRegister.json().token;

    const forbidden = await app.inject({
      method: "GET",
      url: "/api/admin/users",
      headers: { authorization: `Bearer ${studentToken}` },
    });
    expect(forbidden.statusCode).toBe(403);

    const teacher = store.createUser({
      phone: "13600136000",
      displayName: "Teacher",
      passwordHash: await hashPassword("AdminPass123"),
      role: USER_ROLES.TEACHER,
    });
    store.createClassroom({
      creatorId: teacher.id,
      name: "Teacher class",
      teacherIds: [teacher.id],
      studentIds: [registeredStudent.id],
    });
    const teacherToken = app.jwt.sign({ sub: teacher.id, role: teacher.role });
    const list = await app.inject({
      method: "GET",
      url: "/api/admin/users",
      headers: { authorization: `Bearer ${teacherToken}` },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().users).toHaveLength(1);
    expect(list.json().users[0].displayName).toBe("Chris");
  });

  it("publishes scheduled homework for selected students", async () => {
    const student = store.createUser({
      phone: "13500135000",
      displayName: "Dora",
      passwordHash: await hashPassword("StudentPass123"),
      role: USER_ROLES.STUDENT,
    });
    const admin = store.createUser({
      phone: "13400134000",
      displayName: "Teacher",
      passwordHash: await hashPassword("AdminPass123"),
      role: USER_ROLES.ADMIN,
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/admin/homeworks",
      headers: { authorization: `Bearer ${app.jwt.sign({ sub: admin.id, role: admin.role })}` },
      payload: {
        title: "Unit 1 朗读练习",
        instructions: "完成录音并提交。",
        studentIds: [student.id],
        schedule: {
          startsAt: "2026-07-20T08:00:00.000Z",
          unit: "WEEK",
          interval: 2,
          occurrenceLimit: 3,
        },
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().homework).toMatchObject({
      title: "Unit 1 朗读练习",
      targetCount: 1,
      occurrenceCount: 3,
    });

    const list = await app.inject({
      method: "GET",
      url: "/api/admin/homeworks",
      headers: { authorization: `Bearer ${app.jwt.sign({ sub: admin.id, role: admin.role })}` },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().homeworks[0]).toMatchObject({
      title: "Unit 1 朗读练习",
      targetCount: 1,
      occurrenceCount: 3,
    });
  });

  it("unlocks picture-book cards one at a time and accepts re-recording", async () => {
    const student = store.createUser({
      phone: "13300133000",
      displayName: "Evan",
      passwordHash: await hashPassword("StudentPass123"),
      role: USER_ROLES.STUDENT,
    });
    const admin = store.createUser({
      phone: "13200132000",
      displayName: "Teacher",
      passwordHash: await hashPassword("AdminPass123"),
      role: USER_ROLES.ADMIN,
    });
    const homework = store.createPublishedHomework({
      publisherId: admin.id,
      title: "The Red Ball",
      studentIds: [student.id],
      templateType: "READ_ALOUD_PICTURE_BOOK",
      cards: [
        {
          imageUrl: "/uploads/assets/one.png",
          sampleAudioUrl: "/uploads/assets/one.mp3",
          referenceText: "This is page one.",
        },
        {
          imageUrl: "/uploads/assets/two.png",
          sampleAudioUrl: "/uploads/assets/two.mp3",
          referenceText: "This is page two.",
        },
      ],
      schedule: {
        startsAt: new Date(Date.now() - 60_000).toISOString(),
        unit: "DAY",
        interval: 1,
        occurrenceLimit: 1,
      },
    });
    const occurrenceId = store.listStudentReadingOccurrences(student.id)[0].id;
    const firstDetail = store.getStudentReadingOccurrence(occurrenceId, student.id);
    const [firstCard, secondCard] = firstDetail.cards;

    expect(() => store.submitReadingCard({
      occurrenceId, cardId: secondCard.id, studentId: student.id, audioUrl: "/uploads/submissions/two.m4a",
    })).toThrow(InvalidCardSequenceError);

    store.submitReadingCard({
      occurrenceId, cardId: firstCard.id, studentId: student.id, audioUrl: "/uploads/submissions/one.m4a",
    });
    const afterFirst = store.getStudentReadingOccurrence(occurrenceId, student.id);
    expect(afterFirst.cards[0]).toMatchObject({
      submittedAudioUrl: "/uploads/submissions/one.m4a",
      referenceText: "This is page one.",
      assessment: { status: "QUEUED", provider: null },
    });
    const originalFirstSubmissionId = store.listReadAloudSubmissions().find(
      (submission) => submission.cardPosition === 1,
    )!.id;

    store.submitReadingCard({
      occurrenceId, cardId: secondCard.id, studentId: student.id, audioUrl: "/uploads/submissions/two.m4a",
    });
    const afterComplete = store.submitReadingCard({
      occurrenceId, cardId: firstCard.id, studentId: student.id, audioUrl: "/uploads/submissions/one-again.m4a",
    });
    expect(afterComplete.status).toBe("COMPLETED");
    expect(afterComplete.cards[0].submittedAudioUrl).toBe("/uploads/submissions/one-again.m4a");
    expect(() => store.reviewReadingSubmission({
      submissionId: originalFirstSubmissionId,
      grade: "B",
    })).toThrow(ReviewSubmissionNotFoundError);
    const firstSubmission = store.listReadAloudSubmissions().find(
      (submission) => submission.cardPosition === 1,
    )!;
    const feedbackUrl = "/uploads/feedback/00000000-0000-4000-8000-000000000001.m4a";
    store.registerFeedbackUpload({ url: feedbackUrl, uploaderId: admin.id });
    store.reviewReadingSubmission({
      submissionId: firstSubmission.id,
      grade: "A",
      feedbackAudioUrl: feedbackUrl,
      scope: { userId: admin.id, role: admin.role },
    });
    const afterReview = store.getStudentReadingOccurrence(occurrenceId, student.id);
    expect(afterReview.cards[0]).toMatchObject({
      status: "GRADED",
      grade: "A",
      feedbackAudioUrl: "/uploads/feedback/00000000-0000-4000-8000-000000000001.m4a",
    });
    expect(store.getHomeworkOccurrenceCount(homework.id)).toBe(1);
  });
});
