import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { buildApp } from "../src/app.js";
import { HOMEWORK_TEMPLATE_TYPES } from "../src/domain/homework.js";
import { USER_ROLES } from "../src/domain/user.js";
import { AccountStore } from "../src/lib/account-store.js";
import { hashPassword } from "../src/security/password.js";

const store = new AccountStore(":memory:");
const app = await buildApp(store);

beforeAll(async () => {
  await app.ready();
});

beforeEach(() => {
  store.deleteAll();
});

afterAll(async () => {
  await app.close();
});

async function createUsers() {
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
  return {
    student,
    otherStudent,
    teacher,
    studentToken: app.jwt.sign({ sub: student.id, role: student.role }),
    otherStudentToken: app.jwt.sign({ sub: otherStudent.id, role: otherStudent.role }),
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

describe("student engagement backend", () => {
  it("serves and validates the current student's editable profile", async () => {
    const { studentToken, otherStudentToken } = await createUsers();

    const initial = await app.inject({
      method: "GET",
      url: "/api/student/profile",
      headers: { authorization: `Bearer ${studentToken}` },
    });
    expect(initial.statusCode).toBe(200);
    expect(initial.json().user).toMatchObject({ phone: "13500135000", displayName: "Betty" });
    expect(initial.json().user.passwordHash).toBeUndefined();
    expect(initial.json().profile).toMatchObject({ englishName: null, schoolName: null });
    expect(initial.json().points).toMatchObject({ total: 0, level: 1, currentLevelPoints: 0, nextLevelPoints: 100 });

    const invalidName = await app.inject({
      method: "PATCH",
      url: "/api/student/profile",
      headers: { authorization: `Bearer ${studentToken}` },
      payload: { displayName: "B" },
    });
    expect(invalidName.statusCode).toBe(400);
    const blankName = await app.inject({
      method: "PATCH",
      url: "/api/student/profile",
      headers: { authorization: `Bearer ${studentToken}` },
      payload: { displayName: "  " },
    });
    expect(blankName.statusCode).toBe(400);

    const readOnlyPhone = await app.inject({
      method: "PATCH",
      url: "/api/student/profile",
      headers: { authorization: `Bearer ${studentToken}` },
      payload: { phone: "13900139000" },
    });
    expect(readOnlyPhone.statusCode).toBe(400);

    const updated = await app.inject({
      method: "PATCH",
      url: "/api/student/profile",
      headers: { authorization: `Bearer ${studentToken}` },
      payload: {
        displayName: "Betty Zhang",
        englishName: "Betty",
        schoolName: " ",
        gradeLevel: "Grade 2",
        learningGoal: "Read every day",
      },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().user).toMatchObject({ displayName: "Betty Zhang", phone: "13500135000" });
    expect(updated.json().profile).toMatchObject({
      englishName: "Betty",
      schoolName: null,
      gradeLevel: "Grade 2",
      learningGoal: "Read every day",
    });
    const partial = await app.inject({
      method: "PATCH",
      url: "/api/student/profile",
      headers: { authorization: `Bearer ${studentToken}` },
      payload: { gradeLevel: "Grade 3", learningGoal: null },
    });
    expect(partial.statusCode).toBe(200);
    expect(partial.json().profile).toMatchObject({
      englishName: "Betty",
      schoolName: null,
      gradeLevel: "Grade 3",
      learningGoal: null,
    });

    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { phone: "13500135000", password: "StudentPass123" },
    });
    expect(login.statusCode).toBe(200);
    const persisted = await app.inject({
      method: "GET",
      url: "/api/student/profile",
      headers: { authorization: `Bearer ${login.json().token}` },
    });
    expect(persisted.statusCode).toBe(200);
    expect(persisted.json().user).toMatchObject({ displayName: "Betty Zhang", phone: "13500135000" });
    expect(persisted.json().profile).toMatchObject({
      englishName: "Betty",
      schoolName: null,
      gradeLevel: "Grade 3",
      learningGoal: null,
    });

    const other = await app.inject({
      method: "GET",
      url: "/api/student/profile",
      headers: { authorization: `Bearer ${otherStudentToken}` },
    });
    expect(other.statusCode).toBe(200);
    expect(other.json().user.displayName).toBe("Alice");
    expect(other.json().profile.englishName).toBeNull();
  });

  it("awards check-in and homework completion points idempotently without rerecord farming", async () => {
    const { student, teacher, studentToken } = await createUsers();
    store.createPublishedHomework({
      publisherId: teacher.id,
      title: "One sentence",
      studentIds: [student.id],
      templateType: HOMEWORK_TEMPLATE_TYPES.SENTENCE_READ_ALOUD,
      items: [{ promptText: "I see a cat.", sampleAudioUrl: "/uploads/assets/cat.mp3" }],
      schedule: schedule(),
    });
    const occurrence = store.getStudentPracticeOccurrence(store.listStudentPracticeOccurrences(student.id)[0].id, student.id);
    const item = occurrence.items[0];

    store.submitPracticeRecording({
      occurrenceId: occurrence.id,
      itemId: item.id,
      studentId: student.id,
      audioUrl: "/uploads/submissions/first.webm",
    });
    store.submitPracticeRecording({
      occurrenceId: occurrence.id,
      itemId: item.id,
      studentId: student.id,
      audioUrl: "/uploads/submissions/second.webm",
    });

    const profile = await app.inject({
      method: "GET",
      url: "/api/student/profile",
      headers: { authorization: `Bearer ${studentToken}` },
    });
    expect(profile.statusCode).toBe(200);
    expect(profile.json().points.total).toBe(12);
    expect(profile.json().events.map((event: { type: string; points: number }) => [event.type, event.points]).sort()).toEqual([
      ["DAILY_CHECKIN", 2],
      ["HOMEWORK_COMPLETED", 10],
    ]);

    const stats = await app.inject({
      method: "GET",
      url: "/api/student/learning-stats",
      headers: { authorization: `Bearer ${studentToken}` },
    });
    expect(stats.statusCode).toBe(200);
    expect(stats.json().recentDays).toHaveLength(7);
    expect(stats.json().recentDays.some((day: { voiceSeconds: number; homeworkSeconds: number }) => day.voiceSeconds === 0 && day.homeworkSeconds === 0)).toBe(true);
  });

  it("hides ended homework after the student's next login and preserves it in history", async () => {
    const { student, teacher } = await createUsers();
    const homework = store.createPublishedHomework({
      publisherId: teacher.id,
      title: "History sentence",
      studentIds: [student.id],
      templateType: HOMEWORK_TEMPLATE_TYPES.SENTENCE_READ_ALOUD,
      items: [{ promptText: "I see a dog.", sampleAudioUrl: "/uploads/assets/dog.mp3" }],
      schedule: schedule(),
    });
    const occurrence = store.getStudentPracticeOccurrence(store.listStudentPracticeOccurrences(student.id)[0].id, student.id);
    const item = occurrence.items[0];
    store.submitPracticeRecording({ occurrenceId: occurrence.id, itemId: item.id, studentId: student.id, audioUrl: "/uploads/submissions/first.webm" });
    const firstSubmission = store.listPracticeRecordingSubmissions()[0];
    store.reviewPracticeRecordingSubmission({ submissionId: firstSubmission.id, grade: "A" });
    store.submitPracticeRecording({ occurrenceId: occurrence.id, itemId: item.id, studentId: student.id, audioUrl: "/uploads/submissions/rerecord.webm" });
    store.updateHomeworkStatus({ homeworkId: homework.id, status: "ARCHIVED" });

    const relogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { phone: student.phone, password: "StudentPass123" },
    });
    expect(relogin.statusCode).toBe(200);
    const freshStudentToken = relogin.json().token as string;
    const currentHomeworks = await app.inject({
      method: "GET",
      url: "/api/student/practice-homeworks",
      headers: { authorization: `Bearer ${freshStudentToken}` },
    });
    expect(currentHomeworks.statusCode).toBe(200);
    expect(currentHomeworks.json().occurrences).toHaveLength(0);

    const history = await app.inject({
      method: "GET",
      url: "/api/student/homework-history?page=1&pageSize=10",
      headers: { authorization: `Bearer ${freshStudentToken}` },
    });
    expect(history.statusCode).toBe(200);
    expect(history.json().occurrences[0]).toMatchObject({
      id: occurrence.id,
      title: "History sentence",
      templateType: HOMEWORK_TEMPLATE_TYPES.SENTENCE_READ_ALOUD,
      homeworkStatus: "ARCHIVED",
      occurrenceStatus: "COMPLETED",
      completedCount: 1,
      totalCount: 1,
      reviewedCount: 0,
    });
    expect(history.json().pagination.total).toBe(1);
  });

  it("authorizes and atomically replaces classroom point policies", async () => {
    const admin = store.createUser({ phone: "13900139000", displayName: "Admin", passwordHash: await hashPassword("AdminPass123"), role: USER_ROLES.ADMIN });
    const teacher = store.createUser({ phone: "13610136101", displayName: "Ms. Lin", passwordHash: await hashPassword("TeacherPass123"), role: USER_ROLES.TEACHER });
    const otherTeacher = store.createUser({ phone: "13710137101", displayName: "Ms. Wu", passwordHash: await hashPassword("TeacherPass123"), role: USER_ROLES.TEACHER });
    const student = store.createUser({ phone: "13510135101", displayName: "Betty", passwordHash: await hashPassword("StudentPass123"), role: USER_ROLES.STUDENT });
    const classroom = store.createClassroom({ creatorId: admin.id, name: "Class A", teacherIds: [teacher.id], studentIds: [student.id] });
    const otherClassroom = store.createClassroom({ creatorId: admin.id, name: "Class B", teacherIds: [otherTeacher.id], studentIds: [student.id] });
    const archivedClassroom = store.createClassroom({ creatorId: admin.id, name: "Old class", teacherIds: [teacher.id], studentIds: [student.id] });
    store.updateClassroom({ classroomId: archivedClassroom.id, status: "ARCHIVED" });
    const adminToken = app.jwt.sign({ sub: admin.id, role: admin.role });
    const teacherToken = app.jwt.sign({ sub: teacher.id, role: teacher.role });

    const policies = await app.inject({ method: "GET", url: "/api/admin/point-policies", headers: { authorization: `Bearer ${teacherToken}` } });
    expect(policies.statusCode).toBe(200);
    expect(policies.json().policies).toEqual([expect.objectContaining({ classroomId: classroom.id, dailyCheckinPoints: 2, homeworkCompletionPoints: 10, streakRewards: [] })]);

    const invalid = await app.inject({
      method: "PUT",
      url: `/api/admin/classrooms/${classroom.id}/point-policy`,
      headers: { authorization: `Bearer ${teacherToken}` },
      payload: { dailyCheckinPoints: 5, homeworkCompletionPoints: 20, streakRewards: [{ days: 3, points: 10 }, { days: 3, points: 20 }] },
    });
    expect(invalid.statusCode).toBe(400);
    expect(store.getClassroomPointPolicy(classroom.id)).toMatchObject({ dailyCheckinPoints: 2, homeworkCompletionPoints: 10, streakRewards: [] });

    const denied = await app.inject({
      method: "PUT",
      url: `/api/admin/classrooms/${otherClassroom.id}/point-policy`,
      headers: { authorization: `Bearer ${teacherToken}` },
      payload: { dailyCheckinPoints: 5, homeworkCompletionPoints: 20, streakRewards: [] },
    });
    expect(denied.statusCode).toBe(404);
    const archived = await app.inject({
      method: "PUT",
      url: `/api/admin/classrooms/${archivedClassroom.id}/point-policy`,
      headers: { authorization: `Bearer ${teacherToken}` },
      payload: { dailyCheckinPoints: 5, homeworkCompletionPoints: 20, streakRewards: [] },
    });
    expect(archived.statusCode).toBe(404);

    const replaced = await app.inject({
      method: "PUT",
      url: `/api/admin/classrooms/${classroom.id}/point-policy`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { dailyCheckinPoints: 5, homeworkCompletionPoints: 20, streakRewards: [{ days: 2, points: 50 }] },
    });
    expect(replaced.statusCode).toBe(200);
    expect(replaced.json().policy).toMatchObject({ dailyCheckinPoints: 5, homeworkCompletionPoints: 20, streakRewards: [{ days: 2, points: 50 }] });
  });

  it("uses classroom point policies for daily, completion, and exact streak rewards without rewriting old events", async () => {
    const admin = store.createUser({ phone: "13920139201", displayName: "Admin", passwordHash: await hashPassword("AdminPass123"), role: USER_ROLES.ADMIN });
    const teacher = store.createUser({ phone: "13620136201", displayName: "Ms. Lin", passwordHash: await hashPassword("TeacherPass123"), role: USER_ROLES.TEACHER });
    const student = store.createUser({ phone: "13520135201", displayName: "Betty", passwordHash: await hashPassword("StudentPass123"), role: USER_ROLES.STUDENT });
    const classroom = store.createClassroom({ creatorId: admin.id, name: "Policy class", teacherIds: [teacher.id], studentIds: [student.id] });
    store.replaceClassroomPointPolicy({ classroomId: classroom.id, scope: { userId: admin.id, role: admin.role }, dailyCheckinPoints: 5, homeworkCompletionPoints: 20, streakRewards: [{ days: 2, points: 50 }] });

    function publish(title: string) {
      store.createPublishedHomework({
        publisherId: teacher.id,
        classroomId: classroom.id,
        staffRole: USER_ROLES.TEACHER,
        title,
        studentIds: [student.id],
        templateType: HOMEWORK_TEMPLATE_TYPES.SENTENCE_READ_ALOUD,
        items: [{ promptText: title, sampleAudioUrl: "/uploads/assets/sample.mp3" }],
        schedule: schedule(),
      });
      const occurrence = store.getStudentPracticeOccurrence(store.listStudentPracticeOccurrences(student.id).at(-1)!.id, student.id);
      return { occurrence, item: occurrence.items[0] };
    }

    const first = publish("day one");
    store.submitPracticeRecording({ occurrenceId: first.occurrence.id, itemId: first.item.id, studentId: student.id, audioUrl: "/uploads/submissions/one.webm", now: new Date("2026-07-13T16:00:00.000Z") });
    const second = publish("day two");
    store.submitPracticeRecording({ occurrenceId: second.occurrence.id, itemId: second.item.id, studentId: student.id, audioUrl: "/uploads/submissions/two.webm", now: new Date("2026-07-14T16:00:00.000Z") });
    store.submitPracticeRecording({ occurrenceId: second.occurrence.id, itemId: second.item.id, studentId: student.id, audioUrl: "/uploads/submissions/two-again.webm", now: new Date("2026-07-14T17:00:00.000Z") });

    let profile = store.getStudentProfile(student.id);
    expect(profile.points.total).toBe(100);
    expect(profile.events.map((event) => [event.type, event.points, event.classroomName]).sort()).toEqual([
      ["DAILY_CHECKIN", 5, "Policy class"],
      ["DAILY_CHECKIN", 5, "Policy class"],
      ["HOMEWORK_COMPLETED", 20, "Policy class"],
      ["HOMEWORK_COMPLETED", 20, "Policy class"],
      ["STREAK_BONUS", 50, "Policy class"],
    ].sort());

    store.replaceClassroomPointPolicy({ classroomId: classroom.id, scope: { userId: admin.id, role: admin.role }, dailyCheckinPoints: 7, homeworkCompletionPoints: 30, streakRewards: [] });
    const third = publish("day three");
    store.submitPracticeRecording({ occurrenceId: third.occurrence.id, itemId: third.item.id, studentId: student.id, audioUrl: "/uploads/submissions/three.webm", now: new Date("2026-07-15T16:00:00.000Z") });
    profile = store.getStudentProfile(student.id);
    expect(profile.points.total).toBe(137);
    expect(profile.events.filter((event) => event.type === "STREAK_BONUS")).toHaveLength(1);
  });

  it("does not back-award zero-point completions after a policy increase", async () => {
    const admin = store.createUser({ phone: "13930139301", displayName: "Admin", passwordHash: await hashPassword("AdminPass123"), role: USER_ROLES.ADMIN });
    const teacher = store.createUser({ phone: "13630136301", displayName: "Ms. Lin", passwordHash: await hashPassword("TeacherPass123"), role: USER_ROLES.TEACHER });
    const student = store.createUser({ phone: "13530135301", displayName: "Betty", passwordHash: await hashPassword("StudentPass123"), role: USER_ROLES.STUDENT });
    const classroom = store.createClassroom({ creatorId: admin.id, name: "Zero policy", teacherIds: [teacher.id], studentIds: [student.id] });
    store.replaceClassroomPointPolicy({ classroomId: classroom.id, scope: { userId: admin.id, role: admin.role }, dailyCheckinPoints: 0, homeworkCompletionPoints: 0, streakRewards: [] });

    store.createPublishedHomework({
      publisherId: teacher.id,
      classroomId: classroom.id,
      staffRole: USER_ROLES.TEACHER,
      title: "Zero sentence",
      studentIds: [student.id],
      templateType: HOMEWORK_TEMPLATE_TYPES.SENTENCE_READ_ALOUD,
      items: [{ promptText: "No back award.", sampleAudioUrl: "/uploads/assets/sample.mp3" }],
      schedule: schedule(),
    });
    const sentence = store.getStudentPracticeOccurrence(store.listStudentPracticeOccurrences(student.id).at(-1)!.id, student.id);
    store.submitPracticeRecording({ occurrenceId: sentence.id, itemId: sentence.items[0].id, studentId: student.id, audioUrl: "/uploads/submissions/zero-sentence.webm" });

    store.createPublishedHomework({
      publisherId: teacher.id,
      classroomId: classroom.id,
      staffRole: USER_ROLES.TEACHER,
      title: "Zero picture",
      studentIds: [student.id],
      templateType: HOMEWORK_TEMPLATE_TYPES.READ_ALOUD_PICTURE_BOOK,
      cards: [{ imageUrl: "/uploads/assets/page.png", sampleAudioUrl: "/uploads/assets/page.mp3", referenceText: "No back award." }],
      schedule: schedule(),
    });
    const picture = store.getStudentReadingOccurrence(store.listStudentReadingOccurrences(student.id).at(-1)!.id, student.id);
    store.submitReadingCard({ occurrenceId: picture.id, cardId: picture.cards[0].id, studentId: student.id, audioUrl: "/uploads/submissions/zero-picture.webm" });
    expect(store.getStudentProfile(student.id)).toMatchObject({ points: { total: 0 }, events: [] });

    store.replaceClassroomPointPolicy({ classroomId: classroom.id, scope: { userId: admin.id, role: admin.role }, dailyCheckinPoints: 10, homeworkCompletionPoints: 99, streakRewards: [] });
    store.submitPracticeRecording({ occurrenceId: sentence.id, itemId: sentence.items[0].id, studentId: student.id, audioUrl: "/uploads/submissions/zero-sentence-again.webm" });
    store.submitReadingCard({ occurrenceId: picture.id, cardId: picture.cards[0].id, studentId: student.id, audioUrl: "/uploads/submissions/zero-picture-again.webm" });

    const profile = store.getStudentProfile(student.id);
    expect(profile.points.total).toBe(0);
    expect(profile.events).toEqual([]);

    const directory = mkdtempSync(join(tmpdir(), "hellobetty-zero-points-"));
    const databasePath = join(directory, "zero.db");
    let persistentStore: AccountStore | null = new AccountStore(databasePath);
    try {
      const persistentAdmin = persistentStore.createUser({ phone: "13940139401", displayName: "Admin", passwordHash: await hashPassword("AdminPass123"), role: USER_ROLES.ADMIN });
      const persistentTeacher = persistentStore.createUser({ phone: "13640136401", displayName: "Ms. Lin", passwordHash: await hashPassword("TeacherPass123"), role: USER_ROLES.TEACHER });
      const persistentStudent = persistentStore.createUser({ phone: "13540135401", displayName: "Betty", passwordHash: await hashPassword("StudentPass123"), role: USER_ROLES.STUDENT });
      const persistentClassroom = persistentStore.createClassroom({
        creatorId: persistentAdmin.id,
        name: "Persistent zero policy",
        teacherIds: [persistentTeacher.id],
        studentIds: [persistentStudent.id],
      });
      persistentStore.replaceClassroomPointPolicy({
        classroomId: persistentClassroom.id,
        scope: { userId: persistentAdmin.id, role: persistentAdmin.role },
        dailyCheckinPoints: 0,
        homeworkCompletionPoints: 0,
        streakRewards: [],
      });
      persistentStore.createPublishedHomework({
        publisherId: persistentTeacher.id,
        classroomId: persistentClassroom.id,
        staffRole: USER_ROLES.TEACHER,
        title: "Persistent zero sentence",
        studentIds: [persistentStudent.id],
        templateType: HOMEWORK_TEMPLATE_TYPES.SENTENCE_READ_ALOUD,
        items: [{ promptText: "Persist zero.", sampleAudioUrl: "/uploads/assets/sample.mp3" }],
        schedule: schedule(),
      });
      const occurrence = persistentStore.getStudentPracticeOccurrence(persistentStore.listStudentPracticeOccurrences(persistentStudent.id)[0].id, persistentStudent.id);
      persistentStore.submitPracticeRecording({
        occurrenceId: occurrence.id,
        itemId: occurrence.items[0].id,
        studentId: persistentStudent.id,
        audioUrl: "/uploads/submissions/persistent-zero.webm",
      });
      const beforeReopen = (persistentStore as unknown as { database: DatabaseSync }).database
        .prepare("SELECT event_type, points FROM student_point_events WHERE student_id = ? ORDER BY event_type")
        .all(persistentStudent.id);
      expect(beforeReopen).toEqual([
        { event_type: "DAILY_CHECKIN", points: 0 },
        { event_type: "HOMEWORK_COMPLETED", points: 0 },
      ]);
      persistentStore.close();
      persistentStore = new AccountStore(databasePath);

      const reopenedProfile = persistentStore.getStudentProfile(persistentStudent.id);
      expect(reopenedProfile.points.total).toBe(0);
      expect(reopenedProfile.events).toEqual([]);
      const afterReopen = (persistentStore as unknown as { database: DatabaseSync }).database
        .prepare("SELECT event_type, points FROM student_point_events WHERE student_id = ? ORDER BY event_type")
        .all(persistentStudent.id);
      expect(afterReopen).toEqual(beforeReopen);
    } finally {
      persistentStore?.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects future picture-book submissions before scheduledAt without points or state changes", async () => {
    const { student, teacher, studentToken } = await createUsers();
    store.createPublishedHomework({
      publisherId: teacher.id,
      title: "Future picture",
      studentIds: [student.id],
      templateType: HOMEWORK_TEMPLATE_TYPES.READ_ALOUD_PICTURE_BOOK,
      cards: [{ imageUrl: "/uploads/assets/page.png", sampleAudioUrl: "/uploads/assets/page.mp3", referenceText: "Future page." }],
      schedule: { startsAt: new Date(Date.now() + 86_400_000).toISOString(), unit: "DAY", interval: 1, occurrenceLimit: 1 },
    });
    const row = (store as unknown as { database: DatabaseSync }).database
      .prepare(`
        SELECT occurrence.id AS occurrence_id, card.id AS card_id, occurrence.status
        FROM homework_occurrences occurrence
        INNER JOIN homework_cards card ON card.homework_id = occurrence.homework_id
        WHERE occurrence.student_id = ?
        LIMIT 1
      `)
      .get(student.id) as { occurrence_id: string; card_id: string; status: string };

    expect(() => store.getStudentReadingOccurrence(row.occurrence_id, student.id)).toThrow();
    const detail = await app.inject({
      method: "GET",
      url: `/api/student/reading-homeworks/${row.occurrence_id}`,
      headers: { authorization: `Bearer ${studentToken}` },
    });
    expect(detail.statusCode).toBe(404);
    expect(detail.json().code).toBe("HOMEWORK_NOT_FOUND");
    expect(() => store.submitReadingCard({
      occurrenceId: row.occurrence_id,
      cardId: row.card_id,
      studentId: student.id,
      audioUrl: "/uploads/submissions/future.webm",
      now: new Date(),
    })).toThrow();
    const unchanged = (store as unknown as { database: DatabaseSync }).database
      .prepare("SELECT status FROM homework_occurrences WHERE id = ?")
      .get(row.occurrence_id) as { status: string };
    expect(unchanged.status).toBe("SCHEDULED");
    expect(store.getStudentProfile(student.id).points.total).toBe(0);
  });

  it("migrates legacy profiles and backfills existing point events idempotently", () => {
    const directory = mkdtempSync(join(tmpdir(), "hellobetty-engagement-migration-"));
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
      CREATE TABLE student_daily_learning (
        student_id TEXT NOT NULL,
        checkin_date TEXT NOT NULL,
        first_activity_at TEXT NOT NULL,
        voice_seconds INTEGER NOT NULL DEFAULT 0,
        homework_seconds INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (student_id, checkin_date)
      );
      CREATE TABLE homework_occurrences (
        id TEXT PRIMARY KEY,
        homework_id TEXT NOT NULL,
        student_id TEXT NOT NULL,
        sequence_number INTEGER NOT NULL,
        scheduled_at TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      INSERT INTO users VALUES ('student-1', '13500135000', 'Betty', 'hash', 'STUDENT', 'ACTIVE', NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
      INSERT INTO student_daily_learning VALUES ('student-1', '2026-07-14', '2026-07-13T16:30:00.000Z', 30, 0, '2026-07-13T16:30:00.000Z');
      INSERT INTO homework_occurrences VALUES ('occurrence-1', 'homework-1', 'student-1', 1, '2026-07-13T16:00:00.000Z', 'COMPLETED', '2026-07-13T16:00:00.000Z');
    `);
    database.close();

    new AccountStore(databasePath).close();
    new AccountStore(databasePath).close();
    const migrated = new DatabaseSync(databasePath);
    const profileTable = migrated.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'student_profiles'").get();
    const points = migrated.prepare("SELECT event_type, points FROM student_point_events ORDER BY event_type").all();
    expect(profileTable).toBeTruthy();
    expect(points).toEqual([
      { event_type: "DAILY_CHECKIN", points: 2 },
      { event_type: "HOMEWORK_COMPLETED", points: 10 },
    ]);
    migrated.close();
    rmSync(directory, { recursive: true, force: true });
  });
});
