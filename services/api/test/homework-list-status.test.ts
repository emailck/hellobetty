import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { HOMEWORK_TEMPLATE_TYPES } from "../src/domain/homework.js";
import { USER_ROLES } from "../src/domain/user.js";
import { AccountStore } from "../src/lib/account-store.js";
import { hashPassword } from "../src/security/password.js";

const store = new AccountStore(":memory:");

beforeEach(() => {
  store.deleteAll();
});

afterAll(() => {
  store.close();
});

function schedule() {
  return {
    startsAt: new Date(Date.now() - 60_000).toISOString(),
    unit: "DAY" as const,
    interval: 1,
    occurrenceLimit: 1,
  };
}

describe("student homework list status summaries", () => {
  it("limits the current list to five Shanghai calendar days while history remains complete", async () => {
    const student = store.createUser({
      phone: "13580135799",
      displayName: "Betty",
      passwordHash: await hashPassword("StudentPass123"),
      role: USER_ROLES.STUDENT,
    });
    const teacher = store.createUser({
      phone: "13680136799",
      displayName: "Ms. Lin",
      passwordHash: await hashPassword("TeacherPass123"),
      role: USER_ROLES.TEACHER,
    });
    const currentTime = new Date("2026-07-20T04:00:00.000Z");

    store.createPublishedHomework({
      publisherId: teacher.id,
      title: "Six daily sentences",
      studentIds: [student.id],
      templateType: HOMEWORK_TEMPLATE_TYPES.SENTENCE_READ_ALOUD,
      items: [{ promptText: "Hello, Betty.", sampleAudioUrl: "/uploads/assets/sentence.mp3" }],
      schedule: {
        startsAt: "2026-07-15T04:00:00.000Z",
        unit: "DAY",
        interval: 1,
        occurrenceLimit: 6,
      },
    });
    store.createPublishedHomework({
      publisherId: teacher.id,
      title: "Six daily pages",
      studentIds: [student.id],
      templateType: HOMEWORK_TEMPLATE_TYPES.READ_ALOUD_PICTURE_BOOK,
      cards: [{ imageUrl: "/uploads/assets/page.png", sampleAudioUrl: "/uploads/assets/page.mp3", referenceText: "Hello." }],
      schedule: {
        startsAt: "2026-07-15T04:00:00.000Z",
        unit: "DAY",
        interval: 1,
        occurrenceLimit: 6,
      },
    });

    const current = store.listStudentPracticeOccurrences(student.id, currentTime);
    const currentReading = store.listStudentReadingOccurrences(student.id, currentTime);
    const expectedDates = [
      "2026-07-16",
      "2026-07-17",
      "2026-07-18",
      "2026-07-19",
      "2026-07-20",
    ];
    expect(current).toHaveLength(5);
    expect(currentReading).toHaveLength(5);
    expect(current.map((occurrence) => occurrence.scheduledAt.slice(0, 10))).toEqual(expectedDates);
    expect(currentReading.map((occurrence) => occurrence.scheduledAt.slice(0, 10))).toEqual(expectedDates);
    const history = store.listStudentHomeworkHistory({ studentId: student.id, page: 1, pageSize: 20, currentTime });
    expect(history.pagination.total).toBe(12);
    expect(history.occurrences).toHaveLength(12);
  });

  it("returns each due recurring trigger as an independent homework row", async () => {
    const student = store.createUser({
      phone: "13580135800",
      displayName: "Betty",
      passwordHash: await hashPassword("StudentPass123"),
      role: USER_ROLES.STUDENT,
    });
    const teacher = store.createUser({
      phone: "13680136800",
      displayName: "Ms. Lin",
      passwordHash: await hashPassword("TeacherPass123"),
      role: USER_ROLES.TEACHER,
    });
    const startsAt = new Date(Date.now() - 2 * 86_400_000).toISOString();

    store.createPublishedHomework({
      publisherId: teacher.id,
      title: "Daily sentence",
      studentIds: [student.id],
      templateType: HOMEWORK_TEMPLATE_TYPES.SENTENCE_READ_ALOUD,
      items: [{ promptText: "Hello, Betty.", sampleAudioUrl: "/uploads/assets/sentence.mp3" }],
      schedule: { startsAt, unit: "DAY", interval: 1, occurrenceLimit: 2 },
    });

    const occurrences = store.listStudentPracticeOccurrences(student.id);
    expect(occurrences).toHaveLength(2);
    expect(new Set(occurrences.map((occurrence) => occurrence.id)).size).toBe(2);
    expect(occurrences.map((occurrence) => occurrence.scheduledAt)).toEqual([
      startsAt,
      new Date(new Date(startsAt).getTime() + 86_400_000).toISOString(),
    ]);

    const first = store.getStudentPracticeOccurrence(occurrences[0].id, student.id);
    store.submitPracticeRecording({
      occurrenceId: first.id,
      itemId: first.items[0].id,
      studentId: student.id,
      audioUrl: "/uploads/submissions/first-day.webm",
    });
    expect(store.listStudentPracticeOccurrences(student.id).map((occurrence) => occurrence.completedItemCount)).toEqual([1, 0]);
  });

  it("tracks viewed, completed, reviewed, and rerecorded states across reading templates", async () => {
    const student = store.createUser({
      phone: "13580135801",
      displayName: "Betty",
      passwordHash: await hashPassword("StudentPass123"),
      role: USER_ROLES.STUDENT,
    });
    const teacher = store.createUser({
      phone: "13680136801",
      displayName: "Ms. Lin",
      passwordHash: await hashPassword("TeacherPass123"),
      role: USER_ROLES.TEACHER,
    });

    store.createPublishedHomework({
      publisherId: teacher.id,
      title: "Picture status",
      studentIds: [student.id],
      templateType: HOMEWORK_TEMPLATE_TYPES.READ_ALOUD_PICTURE_BOOK,
      cards: [{ imageUrl: "/uploads/assets/page.png", sampleAudioUrl: "/uploads/assets/page.mp3", referenceText: "Hello." }],
      schedule: schedule(),
    });
    store.createPublishedHomework({
      publisherId: teacher.id,
      title: "Sentence status",
      studentIds: [student.id],
      templateType: HOMEWORK_TEMPLATE_TYPES.SENTENCE_READ_ALOUD,
      items: [{ promptText: "Hello, Betty.", sampleAudioUrl: "/uploads/assets/sentence.mp3" }],
      schedule: schedule(),
    });

    const readingSummary = () => store.listStudentReadingOccurrences(student.id)[0];
    const practiceSummary = () => store.listStudentPracticeOccurrences(student.id)[0];
    expect(readingSummary()).toMatchObject({ hasViewed: false, cardCount: 1, submittedCardCount: 0, reviewedCardCount: 0 });
    expect(practiceSummary()).toMatchObject({ hasViewed: false, itemCount: 1, completedItemCount: 0, reviewedItemCount: 0 });

    const reading = store.getStudentReadingOccurrence(readingSummary().id, student.id);
    const practice = store.getStudentPracticeOccurrence(practiceSummary().id, student.id);
    store.startHomeworkSession({ occurrenceId: reading.id, studentId: student.id });
    store.startHomeworkSession({ occurrenceId: practice.id, studentId: student.id });
    expect(readingSummary().hasViewed).toBe(true);
    expect(practiceSummary().hasViewed).toBe(true);

    store.submitReadingCard({ occurrenceId: reading.id, cardId: reading.cards[0].id, studentId: student.id, audioUrl: "/uploads/submissions/page.webm" });
    store.submitPracticeRecording({ occurrenceId: practice.id, itemId: practice.items[0].id, studentId: student.id, audioUrl: "/uploads/submissions/sentence.webm" });
    expect(readingSummary()).toMatchObject({ submittedCardCount: 1, reviewedCardCount: 0 });
    expect(practiceSummary()).toMatchObject({ completedItemCount: 1, reviewedItemCount: 0 });

    store.reviewReadingSubmission({ submissionId: store.listReadAloudSubmissions()[0].id, grade: "A" });
    store.reviewPracticeRecordingSubmission({ submissionId: store.listPracticeRecordingSubmissions()[0].id, grade: "A" });
    expect(readingSummary().reviewedCardCount).toBe(1);
    expect(practiceSummary().reviewedItemCount).toBe(1);

    store.submitReadingCard({ occurrenceId: reading.id, cardId: reading.cards[0].id, studentId: student.id, audioUrl: "/uploads/submissions/page-again.webm" });
    store.submitPracticeRecording({ occurrenceId: practice.id, itemId: practice.items[0].id, studentId: student.id, audioUrl: "/uploads/submissions/sentence-again.webm" });
    expect(readingSummary()).toMatchObject({ cardCount: 1, submittedCardCount: 1, reviewedCardCount: 0 });
    expect(practiceSummary()).toMatchObject({ itemCount: 1, completedItemCount: 1, reviewedItemCount: 0 });
  });
});
