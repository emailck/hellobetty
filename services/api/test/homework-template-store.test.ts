import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { HOMEWORK_TEMPLATE_TYPES, type HomeworkSchedule } from "../src/domain/homework.js";
import { USER_ROLES } from "../src/domain/user.js";
import {
  AccountStore,
  HomeworkTemplateAccessError,
  InvalidHomeworkItemsError,
} from "../src/lib/account-store.js";

function schedule(): HomeworkSchedule {
  return {
    startsAt: new Date(Date.now() - 60_000).toISOString(),
    unit: "DAY",
    interval: 1,
    occurrenceLimit: 1,
  };
}

function createTeacherClassroom(store: AccountStore, suffix: string) {
  const teacher = store.createUser({
    phone: `13600236${suffix}`,
    displayName: `Teacher ${suffix}`,
    passwordHash: "hash",
    role: USER_ROLES.TEACHER,
  });
  const student = store.createUser({
    phone: `13500235${suffix}`,
    displayName: `Student ${suffix}`,
    passwordHash: "hash",
    role: USER_ROLES.STUDENT,
  });
  const classroom = store.createClassroom({
    creatorId: teacher.id,
    name: `Class ${suffix}`,
    teacherIds: [teacher.id],
    studentIds: [student.id],
  });
  return { teacher, student, classroom };
}

function createOldHomeworkDatabase(path: string) {
  const database = new DatabaseSync(path);
  const now = "2026-01-01T00:00:00.000Z";
  database.exec(`
    PRAGMA foreign_keys = ON;
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
      publisher_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      classroom_id TEXT,
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
    CREATE TABLE homework_cards (
      id TEXT PRIMARY KEY,
      homework_id TEXT NOT NULL REFERENCES homeworks(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      image_url TEXT NOT NULL,
      sample_audio_url TEXT NOT NULL,
      reference_text TEXT,
      UNIQUE (homework_id, position)
    );
    CREATE TABLE homework_items (
      id TEXT PRIMARY KEY,
      homework_id TEXT NOT NULL REFERENCES homeworks(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      prompt_text TEXT,
      image_url TEXT,
      sample_audio_url TEXT,
      answer_text TEXT,
      choices_json TEXT,
      UNIQUE (homework_id, position)
    );
  `);
  database
    .prepare(`
      INSERT INTO users (
        id, phone, display_name, password_hash, role, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run("teacher-old", "13600999000", "Old Teacher", "hash", USER_ROLES.TEACHER, "ACTIVE", now, now);
  database
    .prepare(`
      INSERT INTO homeworks (
        id, publisher_id, classroom_id, title, instructions, status, template_type, starts_at,
        repeat_unit, repeat_interval, occurrence_limit, published_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      "homework-old",
      "teacher-old",
      null,
      "Legacy words",
      "Fill the blank.",
      "PUBLISHED",
      HOMEWORK_TEMPLATE_TYPES.WORD_FILL_BLANK,
      now,
      "DAY",
      1,
      1,
      now,
      now,
      now,
    );
  database
    .prepare(`
      INSERT INTO homework_items (
        id, homework_id, position, prompt_text, image_url, sample_audio_url, answer_text, choices_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      "item-old",
      "homework-old",
      1,
      "I like ____.",
      "/uploads/assets/apple.png",
      null,
      "apples",
      JSON.stringify(["apples", "pears"]),
    );
  database.close();
}

let store: AccountStore | null = null;
const tempDirs: string[] = [];

afterEach(() => {
  store?.close();
  store = null;
  for (const tempDir of tempDirs.splice(0)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("homework template store", () => {
  it("backfills legacy published homework into one reusable template idempotently", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "hellobetty-template-migration-"));
    tempDirs.push(tempDir);
    const databasePath = join(tempDir, "old.sqlite");
    createOldHomeworkDatabase(databasePath);

    store = new AccountStore(databasePath);
    const backfilledHomework = store.getHomeworkSummary("homework-old");
    const templates = store.listHomeworkTemplates();

    expect(backfilledHomework?.templateId).toEqual(expect.any(String));
    expect(templates).toHaveLength(1);
    expect(templates[0]).toMatchObject({
      id: backfilledHomework?.templateId,
      creatorId: "teacher-old",
      title: "Legacy words",
      templateType: HOMEWORK_TEMPLATE_TYPES.WORD_FILL_BLANK,
      questionCount: 1,
    });
    expect(store.getHomeworkTemplateDetail(templates[0].id)?.questions[0]).toMatchObject({
      sourceKind: "ITEM",
      promptText: "I like ____.",
      answerText: "apples",
      choices: ["apples", "pears"],
    });

    store.close();
    store = new AccountStore(databasePath);
    expect(store.listHomeworkTemplates()).toHaveLength(1);
    expect(store.getHomeworkSummary("homework-old")?.templateId).toBe(templates[0].id);

    expect(store.deleteHomeworkTemplate(templates[0].id, { userId: "teacher-old", role: USER_ROLES.TEACHER })).toBe(true);
    store.close();
    store = new AccountStore(databasePath);
    expect(store.listHomeworkTemplates()).toHaveLength(0);
    expect(store.getHomeworkSummary("homework-old")?.templateId).toBeNull();
  });

  it("creates a library template and an immutable published snapshot for inline publication", () => {
    store = new AccountStore(":memory:");
    const fixture = createTeacherClassroom(store, "001");

    const homework = store.createPublishedHomework({
      publisherId: fixture.teacher.id,
      classroomId: fixture.classroom.id,
      staffRole: USER_ROLES.TEACHER,
      title: "Match words",
      instructions: "Pick the right word.",
      studentIds: [fixture.student.id],
      schedule: schedule(),
      templateType: HOMEWORK_TEMPLATE_TYPES.WORD_IMAGE_MATCH,
      items: [{ imageUrl: "/uploads/assets/apple.png", answerText: "apple", choices: ["apple", "pear"] }],
    });

    expect(homework.templateId).toEqual(expect.any(String));
    expect(store.listHomeworkTemplates(10, { userId: fixture.teacher.id, role: fixture.teacher.role })).toEqual([
      expect.objectContaining({
        id: homework.templateId,
        title: "Match words",
        questionCount: 1,
        publishedHomeworkCount: 1,
      }),
    ]);
    expect(store.getPublishedHomeworkDetail(homework.id)?.questions[0]).toMatchObject({
      imageUrl: "/uploads/assets/apple.png",
      answerText: "apple",
      choices: ["apple", "pear"],
    });
  });

  it("publishes the same template to different classes without sharing recipients or losing snapshots", () => {
    store = new AccountStore(":memory:");
    const first = createTeacherClassroom(store, "101");
    const secondStudent = store.createUser({
      phone: "13500235102",
      displayName: "Student 102",
      passwordHash: "hash",
      role: USER_ROLES.STUDENT,
    });
    const secondClassroom = store.createClassroom({
      creatorId: first.teacher.id,
      name: "Class 102",
      teacherIds: [first.teacher.id],
      studentIds: [secondStudent.id],
    });
    const template = store.createHomeworkTemplate({
      creatorId: first.teacher.id,
      title: "Reusable fill",
      instructions: "Use this again.",
      templateType: HOMEWORK_TEMPLATE_TYPES.WORD_FILL_BLANK,
      items: [{
        promptText: "This is an ____.",
        imageUrl: "/uploads/assets/apple.png",
        answerText: "apple",
        choices: ["apple", "pear"],
      }],
    });

    const firstHomework = store.createPublishedHomework({
      publisherId: first.teacher.id,
      templateId: template.template.id,
      title: "Ignored title",
      studentIds: [first.student.id],
      classroomId: first.classroom.id,
      staffRole: USER_ROLES.TEACHER,
      schedule: schedule(),
    });
    const secondHomework = store.createPublishedHomework({
      publisherId: first.teacher.id,
      templateId: template.template.id,
      title: "Another ignored title",
      studentIds: [secondStudent.id],
      classroomId: secondClassroom.id,
      staffRole: USER_ROLES.TEACHER,
      schedule: { ...schedule(), occurrenceLimit: 2 },
    });

    expect(firstHomework.id).not.toBe(secondHomework.id);
    expect(firstHomework.templateId).toBe(template.template.id);
    expect(secondHomework.templateId).toBe(template.template.id);
    expect(store.getPublishedHomeworkDetail(firstHomework.id)?.recipients).toEqual([
      expect.objectContaining({ id: first.student.id }),
    ]);
    expect(store.getPublishedHomeworkDetail(secondHomework.id)?.recipients).toEqual([
      expect.objectContaining({ id: secondStudent.id }),
    ]);
    expect(store.getHomeworkTemplateDetail(template.template.id)?.template.publishedHomeworkCount).toBe(2);

    expect(store.deleteHomeworkTemplate(template.template.id, { userId: first.teacher.id, role: first.teacher.role })).toBe(true);
    expect(store.getHomeworkTemplateDetail(template.template.id)).toBeNull();
    expect(store.getPublishedHomeworkDetail(firstHomework.id)?.questions[0]).toMatchObject({
      promptText: "This is an ____.",
      answerText: "apple",
    });
    expect(store.getPublishedHomeworkDetail(secondHomework.id)?.questions[0]).toMatchObject({
      promptText: "This is an ____.",
      answerText: "apple",
    });
  });

  it("keeps teacher-owned templates scoped and blocks unauthorized template instantiation", () => {
    store = new AccountStore(":memory:");
    const owner = createTeacherClassroom(store, "201");
    const outsider = createTeacherClassroom(store, "202");
    const template = store.createHomeworkTemplate({
      creatorId: owner.teacher.id,
      title: "Owner only",
      templateType: HOMEWORK_TEMPLATE_TYPES.SENTENCE_READ_ALOUD,
      items: [{ promptText: "Hello, Betty.", sampleAudioUrl: "/uploads/assets/hello.mp3" }],
    });

    const outsiderScope = { userId: outsider.teacher.id, role: outsider.teacher.role };
    expect(store.listHomeworkTemplates(10, outsiderScope)).toHaveLength(0);
    expect(store.getHomeworkTemplateDetail(template.template.id, outsiderScope)).toBeNull();
    expect(store.deleteHomeworkTemplate(template.template.id, outsiderScope)).toBe(false);
    expect(() => store.createPublishedHomework({
      publisherId: outsider.teacher.id,
      templateId: template.template.id,
      title: "Should fail",
      studentIds: [outsider.student.id],
      classroomId: outsider.classroom.id,
      staffRole: USER_ROLES.TEACHER,
      schedule: schedule(),
    })).toThrow(HomeworkTemplateAccessError);
  });

  it("lets teachers reuse but not delete templates referenced by visible classroom homework", () => {
    store = new AccountStore(":memory:");
    const fixture = createTeacherClassroom(store, "251");
    const secondStudent = store.createUser({
      phone: "13500235252",
      displayName: "Student 252",
      passwordHash: "hash",
      role: USER_ROLES.STUDENT,
    });
    const secondClassroom = store.createClassroom({
      creatorId: fixture.teacher.id,
      name: "Class 252",
      teacherIds: [fixture.teacher.id],
      studentIds: [secondStudent.id],
    });
    const admin = store.createUser({
      phone: "13900235251",
      displayName: "Admin 251",
      passwordHash: "hash",
      role: USER_ROLES.ADMIN,
    });
    const template = store.createHomeworkTemplate({
      creatorId: admin.id,
      title: "Shared through class",
      templateType: HOMEWORK_TEMPLATE_TYPES.SENTENCE_READ_ALOUD,
      items: [{ promptText: "Hello, class.", sampleAudioUrl: "/uploads/assets/hello.mp3" }],
    });
    store.createPublishedHomework({
      publisherId: admin.id,
      templateId: template.template.id,
      title: "",
      studentIds: [fixture.student.id],
      classroomId: fixture.classroom.id,
      staffRole: USER_ROLES.ADMIN,
      schedule: schedule(),
    });

    const teacherScope = { userId: fixture.teacher.id, role: fixture.teacher.role };
    expect(store.listHomeworkTemplates(10, teacherScope)).toEqual([
      expect.objectContaining({ id: template.template.id }),
    ]);
    expect(store.deleteHomeworkTemplate(template.template.id, teacherScope)).toBe(false);

    const reused = store.createPublishedHomework({
      publisherId: fixture.teacher.id,
      templateId: template.template.id,
      title: "",
      studentIds: [secondStudent.id],
      classroomId: secondClassroom.id,
      staffRole: USER_ROLES.TEACHER,
      schedule: schedule(),
    });
    expect(store.getPublishedHomeworkDetail(reused.id)?.recipients).toEqual([
      expect.objectContaining({ id: secondStudent.id }),
    ]);
  });

  it("allows empty STANDARD templates to be previewed but not published from the library", () => {
    store = new AccountStore(":memory:");
    const fixture = createTeacherClassroom(store, "301");
    const template = store.createHomeworkTemplate({
      creatorId: fixture.teacher.id,
      title: "Empty idea",
      templateType: HOMEWORK_TEMPLATE_TYPES.STANDARD,
    });

    expect(template.questions).toEqual([]);
    expect(store.getHomeworkTemplateDetail(template.template.id)?.template.questionCount).toBe(0);
    expect(() => store.createPublishedHomework({
      publisherId: fixture.teacher.id,
      templateId: template.template.id,
      title: "Empty idea",
      studentIds: [fixture.student.id],
      classroomId: fixture.classroom.id,
      staffRole: USER_ROLES.TEACHER,
      schedule: schedule(),
    })).toThrow(InvalidHomeworkItemsError);
  });
});
