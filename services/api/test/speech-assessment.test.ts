import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { buildApp } from "../src/app.js";
import { USER_ROLES } from "../src/domain/user.js";
import type {
  SpeechAssessmentProvider,
  SpeechAssessmentRequest,
  SpeechAssessmentResult,
} from "../src/domain/speech-assessment.js";
import { AccountStore } from "../src/lib/account-store.js";
import { SpeechAssessmentWorker } from "../src/lib/speech-assessment-worker.js";
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
    otherStudentToken: app.jwt.sign({ sub: otherStudent.id, role: otherStudent.role }),
    teacherToken: app.jwt.sign({ sub: teacher.id, role: teacher.role }),
  };
}

function publishSentenceHomework(teacherId: string, studentId: string) {
  store.createPublishedHomework({
    publisherId: teacherId,
    title: "Read a sentence",
    studentIds: [studentId],
    templateType: "SENTENCE_READ_ALOUD",
    items: [{ promptText: "I see a cat.", sampleAudioUrl: "/uploads/cat.mp3" }],
    schedule: {
      startsAt: new Date(Date.now() - 60_000).toISOString(),
      unit: "DAY",
      interval: 1,
      occurrenceLimit: 1,
    },
  });
  const occurrence = store.listStudentPracticeOccurrences(studentId)[0];
  return store.getStudentPracticeOccurrence(occurrence.id, studentId);
}

class FakeProvider implements SpeechAssessmentProvider {
  readonly requests: SpeechAssessmentRequest[] = [];

  constructor(
    readonly id: string,
    private readonly result: SpeechAssessmentResult | Error,
  ) {}

  async assess(request: SpeechAssessmentRequest): Promise<SpeechAssessmentResult> {
    this.requests.push(request);
    if (this.result instanceof Error) throw this.result;
    return this.result;
  }
}

describe("asynchronous speech assessment", () => {
  it("adds nullable reference text without losing legacy picture-book cards", () => {
    const directory = mkdtempSync(join(tmpdir(), "hellobetty-speech-migration-"));
    const databasePath = join(directory, "legacy.db");
    const legacyDatabase = new DatabaseSync(databasePath);
    legacyDatabase.exec(`
      CREATE TABLE homework_cards (
        id TEXT PRIMARY KEY,
        homework_id TEXT NOT NULL,
        position INTEGER NOT NULL,
        image_url TEXT NOT NULL,
        sample_audio_url TEXT NOT NULL,
        UNIQUE (homework_id, position)
      );
      INSERT INTO homework_cards (
        id, homework_id, position, image_url, sample_audio_url
      ) VALUES ('legacy-card', 'legacy-homework', 1, '/legacy.png', '/legacy.mp3');
    `);
    legacyDatabase.close();

    new AccountStore(databasePath).close();
    const migratedDatabase = new DatabaseSync(databasePath);
    const card = migratedDatabase
      .prepare("SELECT id, reference_text FROM homework_cards WHERE id = 'legacy-card'")
      .get() as { id: string; reference_text: string | null };
    expect(card).toEqual({ id: "legacy-card", reference_text: null });
    migratedDatabase.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("keeps machine results independent from teacher review and creates a new task on rerecord", async () => {
    const { student, teacher, teacherToken, otherStudentToken } = await createUsers();
    const occurrence = publishSentenceHomework(teacher.id, student.id);
    const item = occurrence.items[0];

    const first = store.submitPracticeRecording({
      occurrenceId: occurrence.id,
      itemId: item.id,
      studentId: student.id,
      audioUrl: "/uploads/submissions/first.webm",
      durationSeconds: 4,
    });
    expect(first.items[0].assessment).toMatchObject({
      status: "QUEUED",
      provider: null,
      overallScore: null,
    });
    expect(first.items[0].assessment).not.toHaveProperty("rawResult");
    expect(first.items[0].assessment).not.toHaveProperty("attemptCount");
    expect(first.items[0].assessment).not.toHaveProperty("leaseExpiresAt");

    const firstSubmission = store.listPracticeRecordingSubmissions()[0];
    const review = await app.inject({
      method: "POST",
      url: `/api/admin/practice-recording-submissions/${firstSubmission.id}/review`,
      headers: { authorization: `Bearer ${teacherToken}` },
      payload: { grade: "A" },
    });
    expect(review.statusCode).toBe(200);

    const provider = new FakeProvider("fake-success", {
      overallScore: 88,
      accuracyScore: 90,
      fluencyScore: 84,
      completenessScore: 100,
      prosodyScore: null,
      wordResults: [{
        word: "cat",
        accuracyScore: 91,
        errorType: null,
        phonemes: [{ phoneme: "k", accuracyScore: 93 }],
      }],
      rawResult: { privateProviderPayload: true },
    });
    const worker = new SpeechAssessmentWorker(store, provider, ".");
    expect(await worker.processNext(new Date("2030-01-01T00:00:00.000Z"))).toBe(true);
    expect(provider.requests[0]).toMatchObject({
      referenceText: "I see a cat.",
      locale: "en-US",
      durationSeconds: 4,
    });
    expect(isAbsolute(provider.requests[0].audioPath)).toBe(true);

    const completed = store.listPracticeRecordingSubmissions()[0];
    expect(completed).toMatchObject({
      grade: "A",
      status: "GRADED",
      assessment: {
        status: "COMPLETED",
        provider: "fake-success",
        overallScore: 88,
        prosodyScore: null,
      },
    });
    expect(completed.assessment).not.toHaveProperty("rawResult");

    store.submitPracticeRecording({
      occurrenceId: occurrence.id,
      itemId: item.id,
      studentId: student.id,
      audioUrl: "/uploads/submissions/second.webm",
      durationSeconds: 3,
    });
    const rerecorded = store.listPracticeRecordingSubmissions()[0];
    expect(rerecorded.id).not.toBe(firstSubmission.id);
    expect(rerecorded).toMatchObject({
      grade: null,
      status: "DONE",
      assessment: { status: "QUEUED", provider: null },
    });
    expect(rerecorded.assessment.id).not.toBe(completed.assessment.id);
    expect(store.findSpeechAssessmentBySubmissionId(firstSubmission.id)).toMatchObject({
      status: "COMPLETED",
      overallScore: 88,
    });

    const forbidden = await app.inject({
      method: "GET",
      url: `/api/student/practice-homeworks/${occurrence.id}`,
      headers: { authorization: `Bearer ${otherStudentToken}` },
    });
    expect(forbidden.statusCode).toBe(404);
    expect(forbidden.json().code).toBe("HOMEWORK_NOT_FOUND");
  });

  it("keeps work queued without a provider and fails after three attempts", async () => {
    const { student, teacher } = await createUsers();
    const occurrence = publishSentenceHomework(teacher.id, student.id);
    store.submitPracticeRecording({
      occurrenceId: occurrence.id,
      itemId: occurrence.items[0].id,
      studentId: student.id,
      audioUrl: "/uploads/submissions/failing.webm",
    });
    const submission = store.listPracticeRecordingSubmissions()[0];

    const unconfiguredWorker = new SpeechAssessmentWorker(store, null, ".");
    expect(await unconfiguredWorker.processNext()).toBe(false);
    expect(store.findSpeechAssessmentBySubmissionId(submission.id)).toMatchObject({
      status: "QUEUED",
      provider: null,
    });

    const provider = new FakeProvider("fake-failure", new Error("temporary provider error"));
    const worker = new SpeechAssessmentWorker(store, provider, ".");
    expect(await worker.processNext(new Date("2030-01-01T00:00:00.000Z"))).toBe(true);
    expect(await worker.processNext(new Date("2030-01-01T00:00:02.000Z"))).toBe(true);
    expect(await worker.processNext(new Date("2030-01-01T00:00:10.000Z"))).toBe(true);
    expect(provider.requests).toHaveLength(3);
    expect(store.findSpeechAssessmentBySubmissionId(submission.id)).toMatchObject({
      status: "FAILED",
      provider: "fake-failure",
      overallScore: null,
      completedAt: null,
    });
  });

  it("recovers an expired lease without accepting the stale worker result", async () => {
    const { student, teacher } = await createUsers();
    const occurrence = publishSentenceHomework(teacher.id, student.id);
    store.submitPracticeRecording({
      occurrenceId: occurrence.id,
      itemId: occurrence.items[0].id,
      studentId: student.id,
      audioUrl: "/uploads/submissions/leased.webm",
    });
    const submission = store.listPracticeRecordingSubmissions()[0];
    const firstClaim = store.claimNextSpeechAssessment({
      provider: "fake-success",
      now: new Date("2030-01-01T00:00:00.000Z"),
      leaseDurationMs: 1_000,
    })!;
    const recoveredClaim = store.claimNextSpeechAssessment({
      provider: "fake-success",
      now: new Date("2030-01-01T00:00:02.000Z"),
      leaseDurationMs: 1_000,
    })!;
    expect(recoveredClaim.id).toBe(firstClaim.id);
    expect(recoveredClaim.attemptCount).toBe(2);
    expect(recoveredClaim.leaseToken).not.toBe(firstClaim.leaseToken);

    const result: SpeechAssessmentResult = {
      overallScore: 75,
      accuracyScore: 75,
      fluencyScore: null,
      completenessScore: null,
      prosodyScore: null,
      wordResults: null,
    };
    expect(store.completeSpeechAssessment({
      assessmentId: firstClaim.id,
      provider: "fake-success",
      leaseToken: firstClaim.leaseToken,
      result,
      now: new Date("2030-01-01T00:00:02.500Z"),
    })).toBe(false);
    expect(store.completeSpeechAssessment({
      assessmentId: recoveredClaim.id,
      provider: "fake-success",
      leaseToken: recoveredClaim.leaseToken,
      result,
      now: new Date("2030-01-01T00:00:02.500Z"),
    })).toBe(true);
    expect(store.findSpeechAssessmentBySubmissionId(submission.id)).toMatchObject({
      status: "COMPLETED",
      overallScore: 75,
    });
  });

  it("rejects completion and failure once the current lease has expired", async () => {
    const { student, teacher } = await createUsers();
    const occurrence = publishSentenceHomework(teacher.id, student.id);
    store.submitPracticeRecording({
      occurrenceId: occurrence.id,
      itemId: occurrence.items[0].id,
      studentId: student.id,
      audioUrl: "/uploads/submissions/expired.webm",
    });
    const submission = store.listPracticeRecordingSubmissions()[0];
    const claim = store.claimNextSpeechAssessment({
      provider: "fake-expired",
      now: new Date("2030-01-01T00:00:00.000Z"),
      leaseDurationMs: 1_000,
    })!;
    const result: SpeechAssessmentResult = {
      overallScore: 80,
      accuracyScore: 80,
      fluencyScore: null,
      completenessScore: null,
      prosodyScore: null,
      wordResults: null,
    };

    expect(store.completeSpeechAssessment({
      assessmentId: claim.id,
      provider: "fake-expired",
      leaseToken: claim.leaseToken,
      result,
      now: new Date("2030-01-01T00:00:01.000Z"),
    })).toBe(false);
    expect(store.failSpeechAssessmentAttempt({
      assessmentId: claim.id,
      provider: "fake-expired",
      leaseToken: claim.leaseToken,
      error: "late failure",
      now: new Date("2030-01-01T00:00:02.000Z"),
    })).toBeNull();
    expect(store.findSpeechAssessmentBySubmissionId(submission.id)).toMatchObject({
      status: "PROCESSING",
      overallScore: null,
      completedAt: null,
    });
  });

  it("snapshots the answer text for word read-aloud assessment", async () => {
    const { student, teacher } = await createUsers();
    store.createPublishedHomework({
      publisherId: teacher.id,
      title: "Read a word",
      studentIds: [student.id],
      templateType: "WORD_READ_ALOUD",
      items: [{
        imageUrl: "/uploads/apple.png",
        sampleAudioUrl: "/uploads/apple.mp3",
        answerText: "apple",
      }],
      schedule: {
        startsAt: new Date(Date.now() - 60_000).toISOString(),
        unit: "DAY",
        interval: 1,
        occurrenceLimit: 1,
      },
    });
    const occurrence = store.listStudentPracticeOccurrences(student.id)[0];
    const item = store.getStudentPracticeOccurrence(occurrence.id, student.id).items[0];
    expect(item.promptText).toBeNull();
    expect(item.answerText).toBe("apple");
    store.submitPracticeRecording({
      occurrenceId: occurrence.id,
      itemId: item.id,
      studentId: student.id,
      audioUrl: "/uploads/submissions/apple.webm",
    });
    const provider = new FakeProvider("fake-word", {
      overallScore: 90,
      accuracyScore: 90,
      fluencyScore: null,
      completenessScore: null,
      prosodyScore: null,
      wordResults: null,
    });
    const worker = new SpeechAssessmentWorker(store, provider, ".");
    await worker.processNext(new Date("2030-01-01T00:00:00.000Z"));
    expect(provider.requests[0].referenceText).toBe("apple");
    expect(store.listPracticeRecordingSubmissions()[0]).toMatchObject({
      promptText: null,
      answerText: "apple",
    });
  });

  it("snapshots picture-book reference text and exposes only normalized results", async () => {
    const { student, teacher } = await createUsers();
    store.createPublishedHomework({
      publisherId: teacher.id,
      title: "Read a picture book",
      studentIds: [student.id],
      templateType: "READ_ALOUD_PICTURE_BOOK",
      cards: [{
        imageUrl: "/uploads/page.png",
        sampleAudioUrl: "/uploads/page.mp3",
        referenceText: "The red ball is big.",
      }],
      schedule: {
        startsAt: new Date(Date.now() - 60_000).toISOString(),
        unit: "DAY",
        interval: 1,
        occurrenceLimit: 1,
      },
    });
    const occurrenceId = store.listStudentReadingOccurrences(student.id)[0].id;
    const occurrence = store.getStudentReadingOccurrence(occurrenceId, student.id);
    store.submitReadingCard({
      occurrenceId,
      cardId: occurrence.cards[0].id,
      studentId: student.id,
      audioUrl: "/uploads/submissions/picture.webm",
      durationSeconds: 5,
    });
    const provider = new FakeProvider("fake-picture", {
      overallScore: 86,
      accuracyScore: 87,
      fluencyScore: 85,
      completenessScore: 100,
      prosodyScore: null,
      wordResults: null,
      rawResult: { providerOnly: true },
    });
    const worker = new SpeechAssessmentWorker(store, provider, ".");
    await worker.processNext(new Date("2030-01-01T00:00:00.000Z"));

    expect(provider.requests[0]).toMatchObject({
      referenceText: "The red ball is big.",
      durationSeconds: 5,
    });
    const studentCard = store.getStudentReadingOccurrence(occurrenceId, student.id).cards[0];
    const staffSubmission = store.listReadAloudSubmissions()[0];
    expect(studentCard).toMatchObject({
      referenceText: "The red ball is big.",
      assessment: { status: "COMPLETED", provider: "fake-picture", overallScore: 86 },
    });
    expect(staffSubmission).toMatchObject({
      referenceText: "The red ball is big.",
      assessment: { status: "COMPLETED", provider: "fake-picture", overallScore: 86 },
    });
    expect(studentCard.assessment).not.toHaveProperty("rawResult");
    expect(staffSubmission.assessment).not.toHaveProperty("rawResult");
  });

  it("requires reference text on newly published picture-book cards", async () => {
    const { student, teacherToken } = await createUsers();
    const response = await app.inject({
      method: "POST",
      url: "/api/admin/homeworks",
      headers: { authorization: `Bearer ${teacherToken}` },
      payload: {
        title: "Picture book",
        studentIds: [student.id],
        templateType: "READ_ALOUD_PICTURE_BOOK",
        cards: [{ imageUrl: "/uploads/page.png", sampleAudioUrl: "/uploads/page.mp3" }],
        schedule: {
          startsAt: new Date(Date.now() - 60_000).toISOString(),
          unit: "DAY",
          interval: 1,
          occurrenceLimit: 1,
        },
      },
    });
    expect(response.statusCode).toBe(400);
  });
});
