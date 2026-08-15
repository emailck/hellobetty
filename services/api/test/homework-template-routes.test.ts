import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
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

function wordTemplatePayload(title = "Apple sound") {
  return {
    title,
    instructions: "Listen and read.",
    templateType: "WORD_READ_ALOUD",
    items: [{ promptText: "apple", imageUrl: "/uploads/assets/apple.png", sampleAudioUrl: "/uploads/assets/apple.mp3", answerText: "apple" }],
  };
}

describe("staff homework template routes", () => {
  it("creates, lists, previews, and deletes a teacher-owned template", async () => {
    const teacher = await createUser(USER_ROLES.TEACHER, "13620136001", "Ms. Route");
    const teacherToken = tokenFor(teacher);

    const create = await app.inject({
      method: "POST",
      url: "/api/admin/homework-templates",
      headers: { authorization: `Bearer ${teacherToken}` },
      payload: wordTemplatePayload(),
    });
    expect(create.statusCode).toBe(201);
    expect(create.json()).toMatchObject({
      template: { title: "Apple sound", templateType: "WORD_READ_ALOUD" },
      questions: [{ position: 1, promptText: "apple", sampleAudioUrl: "/uploads/assets/apple.mp3", answerText: "apple" }],
    });
    const templateId = create.json().template.id as string;

    const list = await app.inject({
      method: "GET",
      url: "/api/admin/homework-templates?page=1&pageSize=10",
      headers: { authorization: `Bearer ${teacherToken}` },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toMatchObject({
      templates: [expect.objectContaining({ id: templateId, title: "Apple sound", templateType: "WORD_READ_ALOUD" })],
      pagination: { page: 1, pageSize: 10, total: 1 },
    });

    const detail = await app.inject({
      method: "GET",
      url: `/api/admin/homework-templates/${templateId}`,
      headers: { authorization: `Bearer ${teacherToken}` },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().questions).toEqual([
      expect.objectContaining({ position: 1, imageUrl: "/uploads/assets/apple.png", answerText: "apple" }),
    ]);

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/admin/homework-templates/${templateId}`,
      headers: { authorization: `Bearer ${teacherToken}` },
    });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toEqual({ ok: true });

    const afterDelete = await app.inject({
      method: "GET",
      url: `/api/admin/homework-templates/${templateId}`,
      headers: { authorization: `Bearer ${teacherToken}` },
    });
    expect(afterDelete.statusCode).toBe(404);
  });

  it("does not allow STANDARD templates in the reusable homework library", async () => {
    const teacher = await createUser(USER_ROLES.TEACHER, "13620136002", "Ms. Standard");

    const response = await app.inject({
      method: "POST",
      url: "/api/admin/homework-templates",
      headers: { authorization: `Bearer ${tokenFor(teacher)}` },
      payload: { title: "Generic note", templateType: "STANDARD" },
    });

    expect(response.statusCode).toBe(400);
  });

  it("hides another teacher's template on preview and delete", async () => {
    const teacher = await createUser(USER_ROLES.TEACHER, "13620136003", "Ms. Owner");
    const otherTeacher = await createUser(USER_ROLES.TEACHER, "13620136004", "Ms. Other");
    const create = await app.inject({
      method: "POST",
      url: "/api/admin/homework-templates",
      headers: { authorization: `Bearer ${tokenFor(teacher)}` },
      payload: wordTemplatePayload("Private apple"),
    });
    const templateId = create.json().template.id as string;
    const otherToken = tokenFor(otherTeacher);

    const preview = await app.inject({
      method: "GET",
      url: `/api/admin/homework-templates/${templateId}`,
      headers: { authorization: `Bearer ${otherToken}` },
    });
    expect(preview.statusCode).toBe(404);

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/admin/homework-templates/${templateId}`,
      headers: { authorization: `Bearer ${otherToken}` },
    });
    expect(deleted.statusCode).toBe(404);
  });

  it("publishes a later assignment from a saved template to a different own class without reusing old students", async () => {
    const teacher = await createUser(USER_ROLES.TEACHER, "13620136005", "Ms. Reuse");
    const firstStudent = await createUser(USER_ROLES.STUDENT, "13520135005", "Betty");
    const secondStudent = await createUser(USER_ROLES.STUDENT, "13520135006", "Alice");
    const firstClass = store.createClassroom({
      creatorId: teacher.id,
      name: "Monday Class",
      teacherIds: [teacher.id],
      studentIds: [firstStudent.id],
    });
    const secondClass = store.createClassroom({
      creatorId: teacher.id,
      name: "Friday Class",
      teacherIds: [teacher.id],
      studentIds: [secondStudent.id],
    });
    const teacherToken = tokenFor(teacher);

    const inlinePublish = await app.inject({
      method: "POST",
      url: "/api/admin/homeworks",
      headers: { authorization: `Bearer ${teacherToken}` },
      payload: {
        ...wordTemplatePayload("Reusable apple"),
        classroomId: firstClass.id,
        studentIds: [firstStudent.id],
        schedule: schedule(),
      },
    });
    expect(inlinePublish.statusCode).toBe(201);

    const templates = await app.inject({
      method: "GET",
      url: "/api/admin/homework-templates",
      headers: { authorization: `Bearer ${teacherToken}` },
    });
    expect(templates.statusCode).toBe(200);
    const templateId = templates.json().templates.find((template: { title: string }) => template.title === "Reusable apple")?.id as string | undefined;
    expect(templateId).toBeTruthy();

    const reused = await app.inject({
      method: "POST",
      url: "/api/admin/homeworks",
      headers: { authorization: `Bearer ${teacherToken}` },
      payload: {
        templateId,
        classroomId: secondClass.id,
        studentIds: [secondStudent.id],
        schedule: schedule(),
      },
    });
    expect(reused.statusCode).toBe(201);
    expect(reused.json().homework).toMatchObject({ title: "Reusable apple", targetCount: 1 });

    const detail = await app.inject({
      method: "GET",
      url: `/api/admin/homeworks/${reused.json().homework.id}`,
      headers: { authorization: `Bearer ${teacherToken}` },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().recipients).toEqual([expect.objectContaining({ id: secondStudent.id, displayName: "Alice" })]);
    expect(detail.json().recipients.some((recipient: { id: string }) => recipient.id === firstStudent.id)).toBe(false);

    const mixed = await app.inject({
      method: "POST",
      url: "/api/admin/homeworks",
      headers: { authorization: `Bearer ${teacherToken}` },
      payload: {
        templateId,
        title: "Should not mix",
        classroomId: secondClass.id,
        studentIds: [secondStudent.id],
        schedule: schedule(),
      },
    });
    expect(mixed.statusCode).toBe(400);
    expect(mixed.json().code).toBe("HOMEWORK_TEMPLATE_MIXED_CONTENT");
  });

  it("rejects private, external, and mismatched homework asset URLs", async () => {
    const teacher = await createUser(USER_ROLES.TEACHER, "13620136007", "Ms. Assets");
    const authorization = `Bearer ${tokenFor(teacher)}`;
    const invalidItems = [
      { promptText: "Private audio", imageUrl: "/uploads/assets/apple.png", sampleAudioUrl: "/uploads/feedback/private.m4a", answerText: "apple" },
      { promptText: "External audio", imageUrl: "/uploads/assets/apple.png", sampleAudioUrl: "https://example.test/audio.mp3", answerText: "apple" },
      { promptText: "Wrong media", imageUrl: "/uploads/assets/apple.mp3", sampleAudioUrl: "/uploads/assets/apple.png", answerText: "apple" },
    ];

    for (const [index, item] of invalidItems.entries()) {
      const response = await app.inject({
        method: "POST",
        url: "/api/admin/homework-templates",
        headers: { authorization },
        payload: {
          title: `Invalid assets ${index}`,
          templateType: "WORD_READ_ALOUD",
          items: [item],
        },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe("HOMEWORK_ITEMS_INVALID");
    }
  });
});
