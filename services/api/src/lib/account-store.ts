import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  getOccurrenceTime,
  HOMEWORK_TEMPLATE_TYPES,
  isGenericHomeworkTemplate,
  isObjectiveHomeworkTemplate,
  isRecordingHomeworkTemplate,
  type HomeworkItemInput,
  type HomeworkSchedule,
  type ScheduleUnit,
} from "../domain/homework.js";
import {
  SPEECH_ASSESSMENT_SOURCE_KINDS,
  SPEECH_ASSESSMENT_STATUSES,
  type ClaimedSpeechAssessment,
  type SpeechAssessment,
  type SpeechAssessmentResult,
  type SpeechAssessmentSourceKind,
  type SpeechAssessmentStatus,
  type SpeechWordResult,
} from "../domain/speech-assessment.js";

export interface UserRecord {
  id: string;
  phone: string;
  displayName: string;
  passwordHash: string;
  role: string;
  status: string;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface HomeworkRecord {
  id: string;
  publisherId: string;
  title: string;
  instructions: string | null;
  status: string;
  templateType: string;
  startsAt: string;
  repeatUnit: ScheduleUnit;
  repeatInterval: number;
  occurrenceLimit: number;
  publishedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface PictureBookCardRecord {
  id: string;
  homeworkId: string;
  position: number;
  imageUrl: string;
  sampleAudioUrl: string;
  referenceText: string | null;
}

export interface HomeworkItemRecord {
  id: string;
  homeworkId: string;
  position: number;
  promptText: string | null;
  imageUrl: string | null;
  sampleAudioUrl: string | null;
  answerText: string | null;
  choices: string[] | null;
}

export interface HomeworkOccurrenceRecord {
  id: string;
  homeworkId: string;
  studentId: string;
  sequenceNumber: number;
  scheduledAt: string;
  status: string;
  createdAt: string;
}

export interface HomeworkSummary extends HomeworkRecord {
  publisherName: string;
  targetCount: number;
  occurrenceCount: number;
}

interface CreateUserInput {
  phone: string;
  displayName: string;
  passwordHash: string;
  role: string;
  status?: string;
}

export class DuplicatePhoneError extends Error {}
export class InvalidHomeworkStudentsError extends Error {}
export class InvalidPictureBookCardsError extends Error {}
export class InvalidHomeworkItemsError extends Error {}
export class InvalidCardSequenceError extends Error {}
export class InvalidItemSequenceError extends Error {}
export class InvalidItemSubmissionError extends Error {}
export class HomeworkAccessError extends Error {}
export class ReviewSubmissionNotFoundError extends Error {}
export class HomeworkSessionNotFoundError extends Error {}
export class InvalidRecordingDurationError extends Error {}

export interface HomeworkLearningSession {
  id: string;
  occurrenceId: string;
  startedAt: string;
  completedAt: string | null;
  creditedSeconds: number;
}

interface NormalizedHomeworkItem {
  promptText: string | null;
  imageUrl: string | null;
  sampleAudioUrl: string | null;
  answerText: string | null;
  choices: string[] | null;
}

function optionalText(value: string | undefined): string | null {
  return value?.trim() || null;
}

function normalizeAnswer(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

function getShanghaiDate(value: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

function shiftCalendarDate(date: string, days: number): string {
  const shifted = new Date(`${date}T00:00:00.000Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

function clampRecordingDuration(value: number | undefined): number {
  if (value === undefined) return 0;
  if (!Number.isFinite(value) || value <= 0) {
    throw new InvalidRecordingDurationError();
  }
  return Math.min(600, Math.max(1, Math.round(value)));
}

function parseChoices(value: unknown): string[] | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(String(value));
    return Array.isArray(parsed) && parsed.every((choice) => typeof choice === "string")
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function scrambleLetters(answerText: string, seedText: string): string[] {
  const letters = Array.from(answerText.replace(/\s+/g, ""));
  let seed = Array.from(seedText).reduce((value, character) => {
    return (value * 31 + character.charCodeAt(0)) >>> 0;
  }, 2166136261);
  for (let index = letters.length - 1; index > 0; index -= 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const target = seed % (index + 1);
    [letters[index], letters[target]] = [letters[target], letters[index]];
  }
  if (letters.length > 1 && letters.join("") === answerText.replace(/\s+/g, "")) {
    letters.push(letters.shift()!);
  }
  return letters;
}

function validateHomeworkItems(
  templateType: string,
  items: HomeworkItemInput[],
): NormalizedHomeworkItem[] {
  if (!isGenericHomeworkTemplate(templateType)) return [];
  if (items.length === 0) throw new InvalidHomeworkItemsError();

  return items.map((item) => {
    const promptText = optionalText(item.promptText);
    const imageUrl = optionalText(item.imageUrl);
    const sampleAudioUrl = optionalText(item.sampleAudioUrl);
    const answerText = optionalText(item.answerText);
    const choices = item.choices
      ? [...new Set(item.choices.map((choice) => choice.trim()).filter(Boolean))]
      : null;

    if (item.choices && (!choices || choices.length === 0)) {
      throw new InvalidHomeworkItemsError();
    }
    if (
      templateType === HOMEWORK_TEMPLATE_TYPES.SENTENCE_READ_ALOUD &&
      (!promptText || !sampleAudioUrl)
    ) {
      throw new InvalidHomeworkItemsError();
    }
    if (
      templateType === HOMEWORK_TEMPLATE_TYPES.WORD_READ_ALOUD &&
      (!imageUrl || !sampleAudioUrl || !answerText)
    ) {
      throw new InvalidHomeworkItemsError();
    }
    if (isObjectiveHomeworkTemplate(templateType) && (!imageUrl || !answerText)) {
      throw new InvalidHomeworkItemsError();
    }
    if (
      templateType === HOMEWORK_TEMPLATE_TYPES.WORD_FILL_BLANK &&
      (!promptText || !promptText.includes("____"))
    ) {
      throw new InvalidHomeworkItemsError();
    }
    if (
      choices && answerText &&
      !choices.some((choice) => normalizeAnswer(choice) === normalizeAnswer(answerText))
    ) {
      throw new InvalidHomeworkItemsError();
    }

    return { promptText, imageUrl, sampleAudioUrl, answerText, choices };
  });
}

export class AccountStore {
  private readonly database: DatabaseSync;

  constructor(databasePath: string) {
    if (databasePath !== ":memory:") {
      const absolutePath = resolve(databasePath);
      mkdirSync(dirname(absolutePath), { recursive: true });
      this.database = new DatabaseSync(absolutePath);
    } else {
      this.database = new DatabaseSync(databasePath);
    }
    this.initialize();
  }

  private initialize() {
    this.database.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS users (
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
      CREATE INDEX IF NOT EXISTS users_role_created_at_idx
        ON users(role, created_at);
      CREATE INDEX IF NOT EXISTS users_status_idx ON users(status);
      CREATE TABLE IF NOT EXISTS homeworks (
        id TEXT PRIMARY KEY,
        publisher_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
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
      CREATE INDEX IF NOT EXISTS homeworks_publisher_created_at_idx
        ON homeworks(publisher_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS homework_recipients (
        homework_id TEXT NOT NULL REFERENCES homeworks(id) ON DELETE CASCADE,
        student_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        created_at TEXT NOT NULL,
        PRIMARY KEY (homework_id, student_id)
      );
      CREATE INDEX IF NOT EXISTS homework_recipients_student_idx
        ON homework_recipients(student_id);
      CREATE TABLE IF NOT EXISTS homework_occurrences (
        id TEXT PRIMARY KEY,
        homework_id TEXT NOT NULL,
        student_id TEXT NOT NULL,
        sequence_number INTEGER NOT NULL,
        scheduled_at TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (homework_id, student_id)
          REFERENCES homework_recipients(homework_id, student_id)
          ON DELETE CASCADE,
        UNIQUE (homework_id, student_id, sequence_number)
      );
      CREATE INDEX IF NOT EXISTS homework_occurrences_student_schedule_idx
        ON homework_occurrences(student_id, scheduled_at);
      CREATE TABLE IF NOT EXISTS homework_cards (
        id TEXT PRIMARY KEY,
        homework_id TEXT NOT NULL REFERENCES homeworks(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        image_url TEXT NOT NULL,
        sample_audio_url TEXT NOT NULL,
        reference_text TEXT,
        UNIQUE (homework_id, position)
      );
      CREATE TABLE IF NOT EXISTS homework_card_submissions (
        id TEXT PRIMARY KEY,
        occurrence_id TEXT NOT NULL REFERENCES homework_occurrences(id) ON DELETE CASCADE,
        card_id TEXT NOT NULL REFERENCES homework_cards(id) ON DELETE CASCADE,
        student_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        audio_url TEXT NOT NULL,
        attempt_number INTEGER NOT NULL,
        submitted_at TEXT NOT NULL,
        feedback_audio_url TEXT,
        grade TEXT,
        reviewed_at TEXT,
        duration_seconds INTEGER NOT NULL DEFAULT 0,
        UNIQUE (occurrence_id, card_id, student_id, attempt_number)
      );
      CREATE INDEX IF NOT EXISTS homework_card_submissions_latest_idx
        ON homework_card_submissions(occurrence_id, card_id, attempt_number DESC);
      CREATE TABLE IF NOT EXISTS homework_items (
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
      CREATE TABLE IF NOT EXISTS homework_item_submissions (
        id TEXT PRIMARY KEY,
        occurrence_id TEXT NOT NULL REFERENCES homework_occurrences(id) ON DELETE CASCADE,
        item_id TEXT NOT NULL REFERENCES homework_items(id) ON DELETE CASCADE,
        student_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        submission_type TEXT NOT NULL,
        audio_url TEXT,
        answer_text TEXT,
        is_correct INTEGER,
        attempt_number INTEGER NOT NULL,
        submitted_at TEXT NOT NULL,
        feedback_audio_url TEXT,
        grade TEXT,
        reviewed_at TEXT,
        duration_seconds INTEGER NOT NULL DEFAULT 0,
        UNIQUE (occurrence_id, item_id, student_id, attempt_number)
      );
      CREATE INDEX IF NOT EXISTS homework_item_submissions_latest_idx
        ON homework_item_submissions(occurrence_id, item_id, attempt_number DESC);
      CREATE TABLE IF NOT EXISTS speech_assessments (
        id TEXT PRIMARY KEY,
        submission_id TEXT NOT NULL UNIQUE,
        source_kind TEXT NOT NULL,
        status TEXT NOT NULL,
        provider TEXT,
        audio_url TEXT NOT NULL,
        reference_text TEXT NOT NULL,
        locale TEXT NOT NULL,
        duration_seconds INTEGER,
        overall_score REAL,
        accuracy_score REAL,
        fluency_score REAL,
        completeness_score REAL,
        prosody_score REAL,
        word_results_json TEXT,
        raw_result_json TEXT,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TEXT NOT NULL,
        lease_expires_at TEXT,
        lease_token TEXT,
        last_error TEXT,
        completed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS speech_assessments_queue_idx
        ON speech_assessments(status, next_attempt_at, created_at);
      CREATE TABLE IF NOT EXISTS student_daily_learning (
        student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        checkin_date TEXT NOT NULL,
        first_activity_at TEXT NOT NULL,
        voice_seconds INTEGER NOT NULL DEFAULT 0,
        homework_seconds INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (student_id, checkin_date)
      );
      CREATE INDEX IF NOT EXISTS student_daily_learning_student_date_idx
        ON student_daily_learning(student_id, checkin_date DESC);
      CREATE TABLE IF NOT EXISTS homework_learning_sessions (
        id TEXT PRIMARY KEY,
        occurrence_id TEXT NOT NULL REFERENCES homework_occurrences(id) ON DELETE CASCADE,
        student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        credited_seconds INTEGER NOT NULL DEFAULT 0
      );
      CREATE UNIQUE INDEX IF NOT EXISTS homework_learning_sessions_active_idx
        ON homework_learning_sessions(occurrence_id, student_id)
        WHERE completed_at IS NULL;
      CREATE INDEX IF NOT EXISTS homework_learning_sessions_student_idx
        ON homework_learning_sessions(student_id, started_at DESC);
    `);
    try {
      this.database.exec(
        "ALTER TABLE homeworks ADD COLUMN template_type TEXT NOT NULL DEFAULT 'STANDARD'",
      );
    } catch {
      // Existing databases already have the column after the first upgrade.
    }
    for (const statement of [
      "ALTER TABLE homework_cards ADD COLUMN reference_text TEXT",
      "ALTER TABLE homework_card_submissions ADD COLUMN feedback_audio_url TEXT",
      "ALTER TABLE homework_card_submissions ADD COLUMN grade TEXT",
      "ALTER TABLE homework_card_submissions ADD COLUMN reviewed_at TEXT",
      "ALTER TABLE homework_card_submissions ADD COLUMN duration_seconds INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE homework_item_submissions ADD COLUMN duration_seconds INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE speech_assessments ADD COLUMN lease_token TEXT",
    ]) {
      try {
        this.database.exec(statement);
      } catch {
        // Existing databases already have the column after the first upgrade.
      }
    }
  }

  createUser(input: CreateUserInput): UserRecord {
    const now = new Date().toISOString();
    const user: UserRecord = {
      id: randomUUID(),
      phone: input.phone,
      displayName: input.displayName,
      passwordHash: input.passwordHash,
      role: input.role,
      status: input.status ?? "ACTIVE",
      lastLoginAt: null,
      createdAt: now,
      updatedAt: now,
    };
    try {
      this.database
        .prepare(`
          INSERT INTO users (
            id, phone, display_name, password_hash, role, status,
            last_login_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          user.id,
          user.phone,
          user.displayName,
          user.passwordHash,
          user.role,
          user.status,
          user.lastLoginAt,
          user.createdAt,
          user.updatedAt,
        );
      return user;
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE")) {
        throw new DuplicatePhoneError();
      }
      throw error;
    }
  }

  findByPhone(phone: string): UserRecord | null {
    const row = this.database
      .prepare("SELECT * FROM users WHERE phone = ?")
      .get(phone);
    return row ? mapUserRow(row) : null;
  }

  findById(id: string): UserRecord | null {
    const row = this.database
      .prepare("SELECT * FROM users WHERE id = ?")
      .get(id);
    return row ? mapUserRow(row) : null;
  }

  markLoggedIn(id: string): UserRecord {
    const now = new Date().toISOString();
    this.database
      .prepare(
        "UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?",
      )
      .run(now, now, id);
    const user = this.findById(id);
    if (!user) throw new Error("User disappeared during login");
    return user;
  }

  listStudents(page: number, pageSize: number, search: string) {
    const offset = (page - 1) * pageSize;
    const searchValue = `%${search}%`;
    const filter = search
      ? "role = 'STUDENT' AND (phone LIKE ? OR display_name LIKE ?)"
      : "role = 'STUDENT'";
    const values = search ? [searchValue, searchValue] : [];
    const rows = this.database
      .prepare(
        `SELECT * FROM users WHERE ${filter}
         ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      )
      .all(...values, pageSize, offset);
    const totalRow = this.database
      .prepare(`SELECT COUNT(*) AS count FROM users WHERE ${filter}`)
      .get(...values) as { count: number };
    const activeRow = this.database
      .prepare(
        "SELECT COUNT(*) AS count FROM users WHERE role = 'STUDENT' AND status = 'ACTIVE'",
      )
      .get() as { count: number };
    return {
      users: rows.map(mapUserRow),
      total: Number(totalRow.count),
      activeCount: Number(activeRow.count),
    };
  }

  upsertAdmin(input: CreateUserInput): UserRecord {
    const existing = this.findByPhone(input.phone);
    if (!existing) return this.createUser(input);

    const now = new Date().toISOString();
    this.database
      .prepare(`
        UPDATE users
        SET display_name = ?, password_hash = ?, role = ?, status = ?, updated_at = ?
        WHERE phone = ?
      `)
      .run(
        input.displayName,
        input.passwordHash,
        input.role,
        input.status ?? "ACTIVE",
        now,
        input.phone,
      );
    return this.findByPhone(input.phone)!;
  }

  createPublishedHomework(input: {
    publisherId: string;
    title: string;
    instructions?: string;
    studentIds: string[];
    schedule: HomeworkSchedule;
    templateType?: string;
    cards?: Array<{ imageUrl: string; sampleAudioUrl: string; referenceText?: string }>;
    items?: HomeworkItemInput[];
  }): HomeworkRecord {
    const studentIds = [...new Set(input.studentIds)];
    if (studentIds.length === 0) throw new InvalidHomeworkStudentsError();
    const templateType = input.templateType ?? HOMEWORK_TEMPLATE_TYPES.STANDARD;
    const cards = (input.cards ?? []).map((card) => ({
      imageUrl: optionalText(card.imageUrl),
      sampleAudioUrl: optionalText(card.sampleAudioUrl),
      referenceText: optionalText(card.referenceText),
    }));
    const items = validateHomeworkItems(templateType, input.items ?? []);
    if (!(Object.values(HOMEWORK_TEMPLATE_TYPES) as string[]).includes(templateType)) {
      throw new InvalidHomeworkItemsError();
    }
    if (
      templateType === HOMEWORK_TEMPLATE_TYPES.READ_ALOUD_PICTURE_BOOK &&
      (cards.length === 0 || cards.some(
        (card) => !card.imageUrl || !card.sampleAudioUrl || !card.referenceText,
      ))
    ) {
      throw new InvalidPictureBookCardsError();
    }
    const now = new Date().toISOString();
    const homework: HomeworkRecord = {
      id: randomUUID(),
      publisherId: input.publisherId,
      title: input.title,
      instructions: input.instructions?.trim() || null,
      status: "PUBLISHED",
      templateType,
      startsAt: new Date(input.schedule.startsAt).toISOString(),
      repeatUnit: input.schedule.unit,
      repeatInterval: input.schedule.interval,
      occurrenceLimit: input.schedule.occurrenceLimit,
      publishedAt: now,
      createdAt: now,
      updatedAt: now,
    };

    this.database.exec("BEGIN IMMEDIATE");
    try {
      const studentPlaceholders = studentIds.map(() => "?").join(", ");
      const students = this.database
        .prepare(
          `SELECT id FROM users
           WHERE id IN (${studentPlaceholders})
             AND role = 'STUDENT' AND status = 'ACTIVE'`,
        )
        .all(...studentIds) as Array<{ id: string }>;
      if (students.length !== studentIds.length) {
        throw new InvalidHomeworkStudentsError();
      }

      this.database
        .prepare(`
          INSERT INTO homeworks (
            id, publisher_id, title, instructions, status, template_type, starts_at, repeat_unit,
            repeat_interval, occurrence_limit, published_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          homework.id,
          homework.publisherId,
          homework.title,
          homework.instructions,
          homework.status,
          homework.templateType,
          homework.startsAt,
          homework.repeatUnit,
          homework.repeatInterval,
          homework.occurrenceLimit,
          homework.publishedAt,
          homework.createdAt,
          homework.updatedAt,
        );

      if (templateType === HOMEWORK_TEMPLATE_TYPES.READ_ALOUD_PICTURE_BOOK) {
        const cardStatement = this.database.prepare(`
          INSERT INTO homework_cards (
            id, homework_id, position, image_url, sample_audio_url, reference_text
          ) VALUES (?, ?, ?, ?, ?, ?)
        `);
        cards.forEach((card, index) => {
          cardStatement.run(
            randomUUID(),
            homework.id,
            index + 1,
            card.imageUrl,
            card.sampleAudioUrl,
            card.referenceText,
          );
        });
      }

      if (isGenericHomeworkTemplate(templateType)) {
        const itemStatement = this.database.prepare(`
          INSERT INTO homework_items (
            id, homework_id, position, prompt_text, image_url,
            sample_audio_url, answer_text, choices_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        items.forEach((item, index) => {
          itemStatement.run(
            randomUUID(),
            homework.id,
            index + 1,
            item.promptText,
            item.imageUrl,
            item.sampleAudioUrl,
            item.answerText,
            item.choices ? JSON.stringify(item.choices) : null,
          );
        });
      }

      const recipientStatement = this.database.prepare(`
        INSERT INTO homework_recipients (homework_id, student_id, created_at)
        VALUES (?, ?, ?)
      `);
      const occurrenceStatement = this.database.prepare(`
        INSERT INTO homework_occurrences (
          id, homework_id, student_id, sequence_number, scheduled_at, status, created_at
        ) VALUES (?, ?, ?, ?, ?, 'SCHEDULED', ?)
      `);
      for (const studentId of studentIds) {
        recipientStatement.run(homework.id, studentId, now);
        for (let sequenceNumber = 1; sequenceNumber <= homework.occurrenceLimit; sequenceNumber += 1) {
          occurrenceStatement.run(
            randomUUID(),
            homework.id,
            studentId,
            sequenceNumber,
            getOccurrenceTime(input.schedule, sequenceNumber),
            now,
          );
        }
      }
      this.database.exec("COMMIT");
      return homework;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  getHomeworkOccurrenceCount(homeworkId: string): number {
    const row = this.database
      .prepare("SELECT COUNT(*) AS count FROM homework_occurrences WHERE homework_id = ?")
      .get(homeworkId) as { count: number };
    return Number(row.count);
  }

  listPublishedHomeworks(limit = 20): HomeworkSummary[] {
    const rows = this.database
      .prepare(`
        SELECT
          h.*,
          publisher.display_name AS publisher_name,
          COUNT(DISTINCT recipient.student_id) AS target_count,
          COUNT(occurrence.id) AS occurrence_count
        FROM homeworks h
        INNER JOIN users publisher ON publisher.id = h.publisher_id
        LEFT JOIN homework_recipients recipient ON recipient.homework_id = h.id
        LEFT JOIN homework_occurrences occurrence ON occurrence.homework_id = h.id
        GROUP BY h.id
        ORDER BY h.published_at DESC
        LIMIT ?
      `)
      .all(limit) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      ...mapHomeworkRow(row),
      publisherName: String(row.publisher_name),
      targetCount: Number(row.target_count),
      occurrenceCount: Number(row.occurrence_count),
    }));
  }

  listStudentReadingOccurrences(studentId: string) {
    const now = new Date().toISOString();
    this.database
      .prepare(`
        UPDATE homework_occurrences SET status = 'AVAILABLE'
        WHERE student_id = ? AND scheduled_at <= ? AND status = 'SCHEDULED'
      `)
      .run(studentId, now);
    return this.database
      .prepare(`
        SELECT o.id, h.title, h.instructions, o.status, o.scheduled_at,
          COUNT(card.id) AS card_count,
          COUNT(DISTINCT submission.card_id) AS submitted_card_count
        FROM homework_occurrences o
        INNER JOIN homeworks h ON h.id = o.homework_id
        INNER JOIN homework_cards card ON card.homework_id = h.id
        LEFT JOIN homework_card_submissions submission
          ON submission.occurrence_id = o.id AND submission.student_id = o.student_id
        WHERE o.student_id = ?
          AND h.template_type = 'READ_ALOUD_PICTURE_BOOK'
          AND o.scheduled_at <= ?
        GROUP BY o.id
        ORDER BY o.scheduled_at ASC
      `)
      .all(studentId, now)
      .map((row) => ({
        id: String((row as Record<string, unknown>).id),
        title: String((row as Record<string, unknown>).title),
        instructions: (row as Record<string, unknown>).instructions
          ? String((row as Record<string, unknown>).instructions)
          : null,
        status: String((row as Record<string, unknown>).status),
        scheduledAt: String((row as Record<string, unknown>).scheduled_at),
        cardCount: Number((row as Record<string, unknown>).card_count),
        submittedCardCount: Number((row as Record<string, unknown>).submitted_card_count),
      }));
  }

  getStudentReadingOccurrence(occurrenceId: string, studentId: string) {
    const occurrence = this.database
      .prepare(`
        SELECT o.id, o.homework_id, o.status, h.title, h.instructions
        FROM homework_occurrences o
        INNER JOIN homeworks h ON h.id = o.homework_id
        WHERE o.id = ? AND o.student_id = ?
          AND h.template_type = 'READ_ALOUD_PICTURE_BOOK'
      `)
      .get(occurrenceId, studentId) as Record<string, unknown> | undefined;
    if (!occurrence) throw new HomeworkAccessError();
    const cards = this.database
      .prepare(`
        SELECT card.id, card.position, card.image_url, card.sample_audio_url,
          card.reference_text,
          submission.audio_url AS submitted_audio_url,
          submission.submitted_at,
          submission.feedback_audio_url,
          submission.grade,
          submission.reviewed_at,
          assessment.id AS assessment_id,
          assessment.status AS assessment_status,
          assessment.provider AS assessment_provider,
          assessment.overall_score AS assessment_overall_score,
          assessment.accuracy_score AS assessment_accuracy_score,
          assessment.fluency_score AS assessment_fluency_score,
          assessment.completeness_score AS assessment_completeness_score,
          assessment.prosody_score AS assessment_prosody_score,
          assessment.word_results_json AS assessment_word_results_json,
          assessment.completed_at AS assessment_completed_at
        FROM homework_cards card
        LEFT JOIN homework_card_submissions submission ON submission.id = (
          SELECT latest.id FROM homework_card_submissions latest
          WHERE latest.occurrence_id = ? AND latest.card_id = card.id
            AND latest.student_id = ?
          ORDER BY latest.attempt_number DESC LIMIT 1
        )
        LEFT JOIN speech_assessments assessment
          ON assessment.submission_id = submission.id
        WHERE card.homework_id = ?
        ORDER BY card.position ASC
      `)
      .all(occurrenceId, studentId, String(occurrence.homework_id))
      .map((row) => {
        const card = row as Record<string, unknown>;
        return {
          id: String(card.id),
          position: Number(card.position),
          imageUrl: String(card.image_url),
          sampleAudioUrl: String(card.sample_audio_url),
          referenceText: card.reference_text ? String(card.reference_text) : null,
          submittedAudioUrl: card.submitted_audio_url
            ? String(card.submitted_audio_url)
            : null,
          submittedAt: card.submitted_at ? String(card.submitted_at) : null,
          feedbackAudioUrl: card.feedback_audio_url
            ? String(card.feedback_audio_url)
            : null,
          grade: card.grade ? String(card.grade) : null,
          reviewedAt: card.reviewed_at ? String(card.reviewed_at) : null,
          assessment: mapSpeechAssessment(card),
          status: !card.submitted_audio_url
            ? "UNMADE"
            : card.reviewed_at || card.grade
              ? "GRADED"
              : "DONE",
        };
      });
    return {
      id: String(occurrence.id),
      title: String(occurrence.title),
      instructions: occurrence.instructions ? String(occurrence.instructions) : null,
      status: String(occurrence.status),
      cards,
    };
  }

  submitReadingCard(input: {
    occurrenceId: string;
    cardId: string;
    studentId: string;
    audioUrl: string;
    durationSeconds?: number;
    now?: Date;
  }) {
    const durationSeconds = clampRecordingDuration(input.durationSeconds);
    const activityAt = input.now ?? new Date();
    const now = activityAt.toISOString();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const card = this.database
        .prepare(`
          SELECT card.position, card.homework_id, card.reference_text
          FROM homework_cards card
          INNER JOIN homework_occurrences occurrence
            ON occurrence.homework_id = card.homework_id
          WHERE occurrence.id = ? AND occurrence.student_id = ? AND card.id = ?
        `)
        .get(input.occurrenceId, input.studentId, input.cardId) as
        | { position: number; homework_id: string; reference_text: string | null }
        | undefined;
      if (!card) throw new HomeworkAccessError();
      const hasSubmission = this.database
        .prepare(`
          SELECT 1 FROM homework_card_submissions
          WHERE occurrence_id = ? AND card_id = ? AND student_id = ? LIMIT 1
        `)
        .get(input.occurrenceId, input.cardId, input.studentId);
      if (!hasSubmission) {
        const previousMissing = this.database
          .prepare(`
            SELECT 1 FROM homework_cards previous
            WHERE previous.homework_id = ? AND previous.position < ?
              AND NOT EXISTS (
                SELECT 1 FROM homework_card_submissions submitted
                WHERE submitted.occurrence_id = ? AND submitted.card_id = previous.id
                  AND submitted.student_id = ?
              ) LIMIT 1
          `)
          .get(card.homework_id, card.position, input.occurrenceId, input.studentId);
        if (previousMissing) throw new InvalidCardSequenceError();
      }
      const attemptRow = this.database
        .prepare(`
          SELECT COALESCE(MAX(attempt_number), 0) + 1 AS attempt
          FROM homework_card_submissions
          WHERE occurrence_id = ? AND card_id = ? AND student_id = ?
        `)
        .get(input.occurrenceId, input.cardId, input.studentId) as { attempt: number };
      const submissionId = randomUUID();
      this.database
        .prepare(`
          INSERT INTO homework_card_submissions (
            id, occurrence_id, card_id, student_id, audio_url,
            attempt_number, submitted_at, duration_seconds
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          submissionId,
          input.occurrenceId,
          input.cardId,
          input.studentId,
          input.audioUrl,
          attemptRow.attempt,
          now,
          durationSeconds,
        );
      if (card.reference_text) {
        this.enqueueSpeechAssessment({
          submissionId,
          sourceKind: SPEECH_ASSESSMENT_SOURCE_KINDS.PICTURE_BOOK_CARD,
          audioUrl: input.audioUrl,
          referenceText: card.reference_text,
          durationSeconds,
          createdAt: now,
        });
      }
      this.addDailyLearning(input.studentId, activityAt, durationSeconds, 0);
      const pending = this.database
        .prepare(`
          SELECT 1 FROM homework_cards card
          WHERE card.homework_id = ? AND NOT EXISTS (
            SELECT 1 FROM homework_card_submissions submitted
            WHERE submitted.occurrence_id = ? AND submitted.card_id = card.id
              AND submitted.student_id = ?
          ) LIMIT 1
        `)
        .get(card.homework_id, input.occurrenceId, input.studentId);
      this.database
        .prepare("UPDATE homework_occurrences SET status = ? WHERE id = ?")
        .run(pending ? "AVAILABLE" : "COMPLETED", input.occurrenceId);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return this.getStudentReadingOccurrence(input.occurrenceId, input.studentId);
  }

  listReadAloudSubmissions(limit = 100) {
    const rows = this.database
      .prepare(`
        SELECT submission.id, submission.audio_url, submission.feedback_audio_url,
          submission.grade, submission.submitted_at, submission.reviewed_at,
          student.display_name AS student_name, homework.title AS homework_title,
          card.position AS card_position, card.reference_text,
          assessment.id AS assessment_id,
          assessment.status AS assessment_status,
          assessment.provider AS assessment_provider,
          assessment.overall_score AS assessment_overall_score,
          assessment.accuracy_score AS assessment_accuracy_score,
          assessment.fluency_score AS assessment_fluency_score,
          assessment.completeness_score AS assessment_completeness_score,
          assessment.prosody_score AS assessment_prosody_score,
          assessment.word_results_json AS assessment_word_results_json,
          assessment.completed_at AS assessment_completed_at
        FROM homework_card_submissions submission
        INNER JOIN homework_occurrences occurrence ON occurrence.id = submission.occurrence_id
        INNER JOIN users student ON student.id = submission.student_id
        INNER JOIN homework_cards card ON card.id = submission.card_id
        INNER JOIN homeworks homework ON homework.id = card.homework_id
        LEFT JOIN speech_assessments assessment
          ON assessment.submission_id = submission.id
        WHERE NOT EXISTS (
          SELECT 1 FROM homework_card_submissions newer
          WHERE newer.occurrence_id = submission.occurrence_id
            AND newer.card_id = submission.card_id
            AND newer.student_id = submission.student_id
            AND newer.attempt_number > submission.attempt_number
        )
        ORDER BY submission.reviewed_at IS NOT NULL, submission.submitted_at DESC
        LIMIT ?
      `)
      .all(limit) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id),
      studentName: String(row.student_name),
      homeworkTitle: String(row.homework_title),
      cardPosition: Number(row.card_position),
      referenceText: row.reference_text ? String(row.reference_text) : null,
      audioUrl: String(row.audio_url),
      feedbackAudioUrl: row.feedback_audio_url ? String(row.feedback_audio_url) : null,
      grade: row.grade ? String(row.grade) : null,
      submittedAt: String(row.submitted_at),
      reviewedAt: row.reviewed_at ? String(row.reviewed_at) : null,
      assessment: mapSpeechAssessment(row),
      status: row.reviewed_at || row.grade ? "GRADED" : "DONE",
    }));
  }

  reviewReadingSubmission(input: {
    submissionId: string;
    grade: "A" | "B" | "C" | "D";
    feedbackAudioUrl?: string;
  }) {
    const reviewedAt = new Date().toISOString();
    const changed = this.database
      .prepare(`
        UPDATE homework_card_submissions
        SET grade = ?, feedback_audio_url = ?, reviewed_at = ?
        WHERE id = ? AND NOT EXISTS (
          SELECT 1 FROM homework_card_submissions newer
          WHERE newer.occurrence_id = homework_card_submissions.occurrence_id
            AND newer.card_id = homework_card_submissions.card_id
            AND newer.student_id = homework_card_submissions.student_id
            AND newer.attempt_number > homework_card_submissions.attempt_number
        )
      `)
      .run(input.grade, input.feedbackAudioUrl ?? null, reviewedAt, input.submissionId);
    if (Number(changed.changes) !== 1) throw new ReviewSubmissionNotFoundError();
    return this.listReadAloudSubmissions().find((submission) => submission.id === input.submissionId)!;
  }

  listStudentPracticeOccurrences(studentId: string) {
    const now = new Date().toISOString();
    this.database
      .prepare(`
        UPDATE homework_occurrences SET status = 'AVAILABLE'
        WHERE student_id = ? AND scheduled_at <= ? AND status = 'SCHEDULED'
      `)
      .run(studentId, now);
    return this.database
      .prepare(`
        SELECT o.id, h.title, h.instructions, h.template_type, o.status, o.scheduled_at,
          COUNT(DISTINCT item.id) AS item_count,
          COUNT(DISTINCT CASE
            WHEN h.template_type IN ('SENTENCE_READ_ALOUD', 'WORD_READ_ALOUD')
              AND submission.id IS NOT NULL THEN item.id
            WHEN h.template_type IN ('WORD_IMAGE_MATCH', 'WORD_SCRAMBLE', 'WORD_FILL_BLANK')
              AND submission.is_correct = 1 THEN item.id
          END) AS completed_item_count
        FROM homework_occurrences o
        INNER JOIN homeworks h ON h.id = o.homework_id
        INNER JOIN homework_items item ON item.homework_id = h.id
        LEFT JOIN homework_item_submissions submission
          ON submission.occurrence_id = o.id
          AND submission.item_id = item.id
          AND submission.student_id = o.student_id
        WHERE o.student_id = ?
          AND h.template_type IN (
            'SENTENCE_READ_ALOUD', 'WORD_READ_ALOUD', 'WORD_IMAGE_MATCH',
            'WORD_SCRAMBLE', 'WORD_FILL_BLANK'
          )
          AND o.scheduled_at <= ?
        GROUP BY o.id
        ORDER BY o.scheduled_at ASC
      `)
      .all(studentId, now)
      .map((row) => {
        const occurrence = row as Record<string, unknown>;
        return {
          id: String(occurrence.id),
          title: String(occurrence.title),
          instructions: occurrence.instructions ? String(occurrence.instructions) : null,
          templateType: String(occurrence.template_type),
          status: String(occurrence.status),
          scheduledAt: String(occurrence.scheduled_at),
          itemCount: Number(occurrence.item_count),
          completedItemCount: Number(occurrence.completed_item_count),
        };
      });
  }

  getStudentPracticeOccurrence(occurrenceId: string, studentId: string) {
    const now = new Date().toISOString();
    this.database
      .prepare(`
        UPDATE homework_occurrences SET status = 'AVAILABLE'
        WHERE id = ? AND student_id = ? AND scheduled_at <= ? AND status = 'SCHEDULED'
      `)
      .run(occurrenceId, studentId, now);
    const occurrence = this.database
      .prepare(`
        SELECT o.id, o.homework_id, o.status, o.scheduled_at,
          h.title, h.instructions, h.template_type
        FROM homework_occurrences o
        INNER JOIN homeworks h ON h.id = o.homework_id
        WHERE o.id = ? AND o.student_id = ? AND o.scheduled_at <= ?
          AND h.template_type IN (
            'SENTENCE_READ_ALOUD', 'WORD_READ_ALOUD', 'WORD_IMAGE_MATCH',
            'WORD_SCRAMBLE', 'WORD_FILL_BLANK'
          )
      `)
      .get(occurrenceId, studentId, now) as Record<string, unknown> | undefined;
    if (!occurrence) throw new HomeworkAccessError();

    const rows = this.database
      .prepare(`
        SELECT item.*,
          submission.id AS submission_id,
          submission.submission_type,
          submission.audio_url AS submitted_audio_url,
          submission.answer_text AS submitted_answer_text,
          submission.is_correct,
          submission.attempt_number,
          submission.submitted_at,
          submission.feedback_audio_url,
          submission.grade,
          submission.reviewed_at,
          assessment.id AS assessment_id,
          assessment.status AS assessment_status,
          assessment.provider AS assessment_provider,
          assessment.overall_score AS assessment_overall_score,
          assessment.accuracy_score AS assessment_accuracy_score,
          assessment.fluency_score AS assessment_fluency_score,
          assessment.completeness_score AS assessment_completeness_score,
          assessment.prosody_score AS assessment_prosody_score,
          assessment.word_results_json AS assessment_word_results_json,
          assessment.completed_at AS assessment_completed_at,
          EXISTS (
            SELECT 1 FROM homework_item_submissions correct
            WHERE correct.occurrence_id = ? AND correct.item_id = item.id
              AND correct.student_id = ? AND correct.is_correct = 1
          ) AS has_correct_submission
        FROM homework_items item
        LEFT JOIN homework_item_submissions submission ON submission.id = (
          SELECT latest.id FROM homework_item_submissions latest
          WHERE latest.occurrence_id = ? AND latest.item_id = item.id
            AND latest.student_id = ?
          ORDER BY latest.attempt_number DESC LIMIT 1
        )
        LEFT JOIN speech_assessments assessment
          ON assessment.submission_id = submission.id
        WHERE item.homework_id = ?
        ORDER BY item.position ASC
      `)
      .all(occurrenceId, studentId, occurrenceId, studentId, String(occurrence.homework_id)) as
      Array<Record<string, unknown>>;
    const templateType = String(occurrence.template_type);
    const fallbackChoices = rows
      .map((row) => row.answer_text ? String(row.answer_text) : null)
      .filter((answer): answer is string => Boolean(answer));
    let previousComplete = true;
    const items = rows.map((row) => {
      const hasSubmission = Boolean(row.submission_id);
      const hasCorrectSubmission = Boolean(row.has_correct_submission);
      const complete = isRecordingHomeworkTemplate(templateType)
        ? hasSubmission
        : hasCorrectSubmission;
      const locked = !previousComplete;
      previousComplete = previousComplete && complete;
      const answerText = row.answer_text ? String(row.answer_text) : null;
      const configuredChoices = parseChoices(row.choices_json);
      return {
        id: String(row.id),
        position: Number(row.position),
        promptText: row.prompt_text ? String(row.prompt_text) : null,
        imageUrl: row.image_url ? String(row.image_url) : null,
        sampleAudioUrl: row.sample_audio_url ? String(row.sample_audio_url) : null,
        answerText: templateType === HOMEWORK_TEMPLATE_TYPES.WORD_READ_ALOUD
          ? answerText
          : null,
        choices: isObjectiveHomeworkTemplate(templateType)
          ? (configuredChoices ?? fallbackChoices)
          : configuredChoices,
        letters: templateType === HOMEWORK_TEMPLATE_TYPES.WORD_SCRAMBLE && answerText
          ? scrambleLetters(answerText, String(row.id))
          : null,
        locked,
        submittedAudioUrl: row.submitted_audio_url ? String(row.submitted_audio_url) : null,
        submittedAnswerText: row.submitted_answer_text ? String(row.submitted_answer_text) : null,
        isCorrect: row.is_correct === null || row.is_correct === undefined
          ? null
          : Boolean(row.is_correct),
        attemptNumber: row.attempt_number ? Number(row.attempt_number) : null,
        submittedAt: row.submitted_at ? String(row.submitted_at) : null,
        feedbackAudioUrl: row.feedback_audio_url ? String(row.feedback_audio_url) : null,
        grade: row.grade ? String(row.grade) : null,
        reviewedAt: row.reviewed_at ? String(row.reviewed_at) : null,
        assessment: mapSpeechAssessment(row),
        status: isRecordingHomeworkTemplate(templateType)
          ? (!hasSubmission ? "UNMADE" : row.reviewed_at || row.grade ? "GRADED" : "DONE")
          : (!hasSubmission ? "UNMADE" : hasCorrectSubmission ? "CORRECT" : "INCORRECT"),
      };
    });
    return {
      id: String(occurrence.id),
      title: String(occurrence.title),
      instructions: occurrence.instructions ? String(occurrence.instructions) : null,
      templateType,
      status: String(occurrence.status),
      scheduledAt: String(occurrence.scheduled_at),
      items,
    };
  }

  submitPracticeRecording(input: {
    occurrenceId: string;
    itemId: string;
    studentId: string;
    audioUrl: string;
    durationSeconds?: number;
    now?: Date;
  }) {
    this.insertPracticeSubmission({
      ...input,
      submissionType: "RECORDING",
      durationSeconds: clampRecordingDuration(input.durationSeconds),
      activityAt: input.now,
    });
    return this.getStudentPracticeOccurrence(input.occurrenceId, input.studentId);
  }

  submitPracticeAnswer(input: {
    occurrenceId: string;
    itemId: string;
    studentId: string;
    answerText: string;
  }) {
    const result = this.insertPracticeSubmission({ ...input, submissionType: "ANSWER" });
    return {
      isCorrect: result.isCorrect,
      occurrence: this.getStudentPracticeOccurrence(input.occurrenceId, input.studentId),
    };
  }

  private insertPracticeSubmission(input: {
    occurrenceId: string;
    itemId: string;
    studentId: string;
    submissionType: "RECORDING" | "ANSWER";
    audioUrl?: string;
    answerText?: string;
    durationSeconds?: number;
    activityAt?: Date;
  }) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const item = this.database
        .prepare(`
          SELECT item.position, item.homework_id, item.prompt_text, item.answer_text,
            homework.template_type
          FROM homework_items item
          INNER JOIN homework_occurrences occurrence ON occurrence.homework_id = item.homework_id
          INNER JOIN homeworks homework ON homework.id = item.homework_id
          WHERE occurrence.id = ? AND occurrence.student_id = ? AND occurrence.scheduled_at <= ?
            AND item.id = ?
        `)
        .get(input.occurrenceId, input.studentId, new Date().toISOString(), input.itemId) as
        | {
            position: number;
            homework_id: string;
            prompt_text: string | null;
            answer_text: string | null;
            template_type: string;
          }
        | undefined;
      if (!item) throw new HomeworkAccessError();
      if (
        (input.submissionType === "RECORDING" && !isRecordingHomeworkTemplate(item.template_type)) ||
        (input.submissionType === "ANSWER" && !isObjectiveHomeworkTemplate(item.template_type))
      ) {
        throw new InvalidItemSubmissionError();
      }

      const previousIncomplete = this.database
        .prepare(`
          SELECT 1 FROM homework_items previous
          WHERE previous.homework_id = ? AND previous.position < ?
            AND NOT EXISTS (
              SELECT 1 FROM homework_item_submissions submitted
              WHERE submitted.occurrence_id = ? AND submitted.item_id = previous.id
                AND submitted.student_id = ?
                AND (? = 'RECORDING' OR submitted.is_correct = 1)
            ) LIMIT 1
        `)
        .get(
          item.homework_id,
          item.position,
          input.occurrenceId,
          input.studentId,
          input.submissionType,
        );
      if (previousIncomplete) throw new InvalidItemSequenceError();

      const attemptRow = this.database
        .prepare(`
          SELECT COALESCE(MAX(attempt_number), 0) + 1 AS attempt
          FROM homework_item_submissions
          WHERE occurrence_id = ? AND item_id = ? AND student_id = ?
        `)
        .get(input.occurrenceId, input.itemId, input.studentId) as { attempt: number };
      const activityAt = input.activityAt ?? new Date();
      const submittedAt = activityAt.toISOString();
      const isCorrect = input.submissionType === "ANSWER"
        ? normalizeAnswer(input.answerText ?? "") === normalizeAnswer(item.answer_text ?? "")
        : null;
      const submissionId = randomUUID();
      this.database
        .prepare(`
          INSERT INTO homework_item_submissions (
            id, occurrence_id, item_id, student_id, submission_type,
            audio_url, answer_text, is_correct, attempt_number, submitted_at,
            duration_seconds
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          submissionId,
          input.occurrenceId,
          input.itemId,
          input.studentId,
          input.submissionType,
          input.audioUrl ?? null,
          input.answerText?.trim() || null,
          isCorrect === null ? null : Number(isCorrect),
          attemptRow.attempt,
          submittedAt,
          input.durationSeconds ?? 0,
        );
      if (input.submissionType === "RECORDING") {
        const referenceText = item.template_type === HOMEWORK_TEMPLATE_TYPES.WORD_READ_ALOUD
          ? item.answer_text
          : item.prompt_text;
        if (!referenceText) throw new InvalidHomeworkItemsError();
        this.enqueueSpeechAssessment({
          submissionId,
          sourceKind: SPEECH_ASSESSMENT_SOURCE_KINDS.PRACTICE_ITEM,
          audioUrl: input.audioUrl!,
          referenceText,
          durationSeconds: input.durationSeconds ?? 0,
          createdAt: submittedAt,
        });
        this.addDailyLearning(
          input.studentId,
          activityAt,
          input.durationSeconds ?? 0,
          0,
        );
      }
      const pending = this.database
        .prepare(`
          SELECT 1 FROM homework_items pending
          WHERE pending.homework_id = ? AND NOT EXISTS (
            SELECT 1 FROM homework_item_submissions submitted
            WHERE submitted.occurrence_id = ? AND submitted.item_id = pending.id
              AND submitted.student_id = ?
              AND (? = 'RECORDING' OR submitted.is_correct = 1)
          ) LIMIT 1
        `)
        .get(item.homework_id, input.occurrenceId, input.studentId, input.submissionType);
      this.database
        .prepare("UPDATE homework_occurrences SET status = ? WHERE id = ?")
        .run(pending ? "AVAILABLE" : "COMPLETED", input.occurrenceId);
      this.database.exec("COMMIT");
      return { isCorrect };
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  listPracticeRecordingSubmissions(limit = 100) {
    const rows = this.database
      .prepare(`
        SELECT submission.id, submission.audio_url, submission.feedback_audio_url,
          submission.grade, submission.submitted_at, submission.reviewed_at,
          student.id AS student_id, student.display_name AS student_name,
          homework.id AS homework_id, homework.title AS homework_title,
          homework.template_type, occurrence.id AS occurrence_id,
          item.id AS item_id, item.position AS item_position, item.prompt_text,
          item.answer_text,
          assessment.id AS assessment_id,
          assessment.status AS assessment_status,
          assessment.provider AS assessment_provider,
          assessment.overall_score AS assessment_overall_score,
          assessment.accuracy_score AS assessment_accuracy_score,
          assessment.fluency_score AS assessment_fluency_score,
          assessment.completeness_score AS assessment_completeness_score,
          assessment.prosody_score AS assessment_prosody_score,
          assessment.word_results_json AS assessment_word_results_json,
          assessment.completed_at AS assessment_completed_at
        FROM homework_item_submissions submission
        INNER JOIN homework_occurrences occurrence ON occurrence.id = submission.occurrence_id
        INNER JOIN users student ON student.id = submission.student_id
        INNER JOIN homework_items item ON item.id = submission.item_id
        INNER JOIN homeworks homework ON homework.id = item.homework_id
        LEFT JOIN speech_assessments assessment
          ON assessment.submission_id = submission.id
        WHERE submission.submission_type = 'RECORDING' AND NOT EXISTS (
          SELECT 1 FROM homework_item_submissions newer
          WHERE newer.occurrence_id = submission.occurrence_id
            AND newer.item_id = submission.item_id
            AND newer.student_id = submission.student_id
            AND newer.attempt_number > submission.attempt_number
        )
        ORDER BY submission.reviewed_at IS NOT NULL, submission.submitted_at DESC
        LIMIT ?
      `)
      .all(limit) as Array<Record<string, unknown>>;
    return rows.map(mapPracticeRecordingSubmission);
  }

  canAccessSubmissionAudio(input: {
    audioUrl: string;
    userId: string;
    isStaff: boolean;
  }): boolean {
    const row = this.database
      .prepare(`
        SELECT 1 FROM (
          SELECT student_id, audio_url FROM homework_card_submissions
          UNION ALL
          SELECT student_id, audio_url FROM homework_item_submissions
          WHERE audio_url IS NOT NULL
        ) submission
        WHERE submission.audio_url = ?
          AND (? = 1 OR submission.student_id = ?)
        LIMIT 1
      `)
      .get(input.audioUrl, Number(input.isStaff), input.userId);
    return Boolean(row);
  }

  reviewPracticeRecordingSubmission(input: {
    submissionId: string;
    grade: "A" | "B" | "C" | "D";
    feedbackAudioUrl?: string;
  }) {
    const changed = this.database
      .prepare(`
        UPDATE homework_item_submissions
        SET grade = ?, feedback_audio_url = ?, reviewed_at = ?
        WHERE id = ? AND submission_type = 'RECORDING' AND NOT EXISTS (
          SELECT 1 FROM homework_item_submissions newer
          WHERE newer.occurrence_id = homework_item_submissions.occurrence_id
            AND newer.item_id = homework_item_submissions.item_id
            AND newer.student_id = homework_item_submissions.student_id
            AND newer.attempt_number > homework_item_submissions.attempt_number
        )
      `)
      .run(
        input.grade,
        input.feedbackAudioUrl?.trim() || null,
        new Date().toISOString(),
        input.submissionId,
      );
    if (Number(changed.changes) !== 1) throw new ReviewSubmissionNotFoundError();
    const reviewed = this.database
      .prepare(`
        SELECT submission.id, submission.audio_url, submission.feedback_audio_url,
          submission.grade, submission.submitted_at, submission.reviewed_at,
          student.id AS student_id, student.display_name AS student_name,
          homework.id AS homework_id, homework.title AS homework_title,
          homework.template_type, occurrence.id AS occurrence_id,
          item.id AS item_id, item.position AS item_position, item.prompt_text,
          item.answer_text,
          assessment.id AS assessment_id,
          assessment.status AS assessment_status,
          assessment.provider AS assessment_provider,
          assessment.overall_score AS assessment_overall_score,
          assessment.accuracy_score AS assessment_accuracy_score,
          assessment.fluency_score AS assessment_fluency_score,
          assessment.completeness_score AS assessment_completeness_score,
          assessment.prosody_score AS assessment_prosody_score,
          assessment.word_results_json AS assessment_word_results_json,
          assessment.completed_at AS assessment_completed_at
        FROM homework_item_submissions submission
        INNER JOIN homework_occurrences occurrence ON occurrence.id = submission.occurrence_id
        INNER JOIN users student ON student.id = submission.student_id
        INNER JOIN homework_items item ON item.id = submission.item_id
        INNER JOIN homeworks homework ON homework.id = item.homework_id
        LEFT JOIN speech_assessments assessment
          ON assessment.submission_id = submission.id
        WHERE submission.id = ?
      `)
      .get(input.submissionId) as Record<string, unknown>;
    return mapPracticeRecordingSubmission(reviewed);
  }

  claimNextSpeechAssessment(input: {
    provider: string;
    now?: Date;
    leaseDurationMs?: number;
  }): ClaimedSpeechAssessment | null {
    const now = input.now ?? new Date();
    const nowIso = now.toISOString();
    const leaseExpiresAt = new Date(
      now.getTime() + Math.max(1_000, input.leaseDurationMs ?? 5 * 60_000),
    ).toISOString();
    const leaseToken = randomUUID();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database
        .prepare(`
          UPDATE speech_assessments
          SET status = 'FAILED', lease_expires_at = NULL, lease_token = NULL,
            last_error = 'Processing lease expired after the final attempt', updated_at = ?
          WHERE status = 'PROCESSING' AND lease_expires_at <= ? AND attempt_count >= 3
        `)
        .run(nowIso, nowIso);
      this.database
        .prepare(`
          UPDATE speech_assessments
          SET status = 'QUEUED', lease_expires_at = NULL, lease_token = NULL,
            next_attempt_at = ?, last_error = 'Processing lease expired', updated_at = ?
          WHERE status = 'PROCESSING' AND lease_expires_at <= ? AND attempt_count < 3
        `)
        .run(nowIso, nowIso, nowIso);
      const candidate = this.database
        .prepare(`
          SELECT id FROM speech_assessments
          WHERE status = 'QUEUED' AND next_attempt_at <= ? AND attempt_count < 3
          ORDER BY next_attempt_at ASC, created_at ASC
          LIMIT 1
        `)
        .get(nowIso) as { id: string } | undefined;
      if (!candidate) {
        this.database.exec("COMMIT");
        return null;
      }
      this.database
        .prepare(`
          UPDATE speech_assessments
          SET status = 'PROCESSING', provider = ?, attempt_count = attempt_count + 1,
            lease_expires_at = ?, lease_token = ?, updated_at = ?
          WHERE id = ? AND status = 'QUEUED'
        `)
        .run(input.provider, leaseExpiresAt, leaseToken, nowIso, candidate.id);
      const claimed = this.database
        .prepare(`
          SELECT id, submission_id, audio_url, reference_text, locale,
            duration_seconds, attempt_count
          FROM speech_assessments WHERE id = ?
        `)
        .get(candidate.id) as Record<string, unknown>;
      this.database.exec("COMMIT");
      return {
        id: String(claimed.id),
        submissionId: String(claimed.submission_id),
        audioUrl: String(claimed.audio_url),
        referenceText: String(claimed.reference_text),
        locale: String(claimed.locale),
        durationSeconds: claimed.duration_seconds === null
          ? null
          : Number(claimed.duration_seconds),
        attemptCount: Number(claimed.attempt_count),
        leaseToken,
      };
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  completeSpeechAssessment(input: {
    assessmentId: string;
    provider: string;
    leaseToken: string;
    result: SpeechAssessmentResult;
    now?: Date;
  }): boolean {
    const completedAt = (input.now ?? new Date()).toISOString();
    const changed = this.database
      .prepare(`
        UPDATE speech_assessments
        SET status = 'COMPLETED', overall_score = ?, accuracy_score = ?,
          fluency_score = ?, completeness_score = ?, prosody_score = ?,
          word_results_json = ?, raw_result_json = ?, completed_at = ?,
          lease_expires_at = NULL, lease_token = NULL, last_error = NULL, updated_at = ?
        WHERE id = ? AND status = 'PROCESSING' AND provider = ? AND lease_token = ?
          AND lease_expires_at > ?
      `)
      .run(
        input.result.overallScore,
        input.result.accuracyScore,
        input.result.fluencyScore,
        input.result.completenessScore,
        input.result.prosodyScore,
        input.result.wordResults ? JSON.stringify(input.result.wordResults) : null,
        input.result.rawResult === undefined ? null : JSON.stringify(input.result.rawResult),
        completedAt,
        completedAt,
        input.assessmentId,
        input.provider,
        input.leaseToken,
        completedAt,
      );
    return Number(changed.changes) === 1;
  }

  failSpeechAssessmentAttempt(input: {
    assessmentId: string;
    provider: string;
    leaseToken: string;
    error: string;
    now?: Date;
    retryDelayMs?: number;
  }): SpeechAssessmentStatus | null {
    const now = input.now ?? new Date();
    const nowIso = now.toISOString();
    const existing = this.database
      .prepare(`
        SELECT attempt_count FROM speech_assessments
        WHERE id = ? AND status = 'PROCESSING' AND provider = ? AND lease_token = ?
          AND lease_expires_at > ?
      `)
      .get(input.assessmentId, input.provider, input.leaseToken, nowIso) as
      | { attempt_count: number }
      | undefined;
    if (!existing) return null;
    const status = Number(existing.attempt_count) >= 3
      ? SPEECH_ASSESSMENT_STATUSES.FAILED
      : SPEECH_ASSESSMENT_STATUSES.QUEUED;
    const nextAttemptAt = status === SPEECH_ASSESSMENT_STATUSES.QUEUED
      ? new Date(now.getTime() + Math.max(0, input.retryDelayMs ?? 1_000)).toISOString()
      : nowIso;
    const changed = this.database
      .prepare(`
        UPDATE speech_assessments
        SET status = ?, next_attempt_at = ?, lease_expires_at = NULL, lease_token = NULL,
          last_error = ?, updated_at = ?
        WHERE id = ? AND status = 'PROCESSING' AND provider = ? AND lease_token = ?
          AND lease_expires_at > ?
      `)
      .run(
        status,
        nextAttemptAt,
        input.error.slice(0, 2_000),
        nowIso,
        input.assessmentId,
        input.provider,
        input.leaseToken,
        nowIso,
      );
    return Number(changed.changes) === 1 ? status : null;
  }

  findSpeechAssessmentBySubmissionId(submissionId: string): SpeechAssessment | null {
    const row = this.database
      .prepare(`
        SELECT id AS assessment_id, status AS assessment_status,
          provider AS assessment_provider, overall_score AS assessment_overall_score,
          accuracy_score AS assessment_accuracy_score,
          fluency_score AS assessment_fluency_score,
          completeness_score AS assessment_completeness_score,
          prosody_score AS assessment_prosody_score,
          word_results_json AS assessment_word_results_json,
          completed_at AS assessment_completed_at
        FROM speech_assessments WHERE submission_id = ?
      `)
      .get(submissionId) as Record<string, unknown> | undefined;
    return row ? mapSpeechAssessment(row) : null;
  }

  private enqueueSpeechAssessment(input: {
    submissionId: string;
    sourceKind: SpeechAssessmentSourceKind;
    audioUrl: string;
    referenceText: string;
    durationSeconds: number;
    createdAt: string;
  }) {
    this.database
      .prepare(`
        INSERT INTO speech_assessments (
          id, submission_id, source_kind, status, audio_url, reference_text,
          locale, duration_seconds, next_attempt_at, created_at, updated_at
        ) VALUES (?, ?, ?, 'QUEUED', ?, ?, 'en-US', ?, ?, ?, ?)
      `)
      .run(
        randomUUID(),
        input.submissionId,
        input.sourceKind,
        input.audioUrl,
        input.referenceText,
        input.durationSeconds || null,
        input.createdAt,
        input.createdAt,
        input.createdAt,
      );
  }

  startHomeworkSession(input: {
    occurrenceId: string;
    studentId: string;
    now?: Date;
  }): HomeworkLearningSession {
    const startedAt = input.now ?? new Date();
    const startedAtIso = startedAt.toISOString();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const occurrence = this.database
        .prepare(`
          SELECT id FROM homework_occurrences
          WHERE id = ? AND student_id = ? AND scheduled_at <= ?
        `)
        .get(input.occurrenceId, input.studentId, startedAtIso);
      if (!occurrence) throw new HomeworkAccessError();

      const active = this.database
        .prepare(`
          SELECT * FROM homework_learning_sessions
          WHERE occurrence_id = ? AND student_id = ? AND completed_at IS NULL
        `)
        .get(input.occurrenceId, input.studentId) as Record<string, unknown> | undefined;
      if (active) {
        this.database.exec("COMMIT");
        return mapHomeworkLearningSession(active);
      }

      const session: HomeworkLearningSession = {
        id: randomUUID(),
        occurrenceId: input.occurrenceId,
        startedAt: startedAtIso,
        completedAt: null,
        creditedSeconds: 0,
      };
      this.database
        .prepare(`
          INSERT INTO homework_learning_sessions (
            id, occurrence_id, student_id, started_at, completed_at, credited_seconds
          ) VALUES (?, ?, ?, ?, NULL, 0)
        `)
        .run(session.id, session.occurrenceId, input.studentId, session.startedAt);
      this.database.exec("COMMIT");
      return session;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  completeHomeworkSession(input: {
    sessionId: string;
    studentId: string;
    now?: Date;
  }): HomeworkLearningSession {
    const completedAt = input.now ?? new Date();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const row = this.database
        .prepare(`
          SELECT * FROM homework_learning_sessions
          WHERE id = ? AND student_id = ?
        `)
        .get(input.sessionId, input.studentId) as Record<string, unknown> | undefined;
      if (!row) throw new HomeworkSessionNotFoundError();
      if (row.completed_at) {
        this.database.exec("COMMIT");
        return mapHomeworkLearningSession(row);
      }

      const elapsedSeconds = Math.max(
        0,
        Math.floor((completedAt.getTime() - new Date(String(row.started_at)).getTime()) / 1000),
      );
      const creditedSeconds = Math.min(7_200, elapsedSeconds);
      const completedAtIso = completedAt.toISOString();
      this.database
        .prepare(`
          UPDATE homework_learning_sessions
          SET completed_at = ?, credited_seconds = ?
          WHERE id = ? AND completed_at IS NULL
        `)
        .run(completedAtIso, creditedSeconds, input.sessionId);
      this.addDailyLearning(input.studentId, completedAt, 0, creditedSeconds);
      this.database.exec("COMMIT");
      return {
        id: String(row.id),
        occurrenceId: String(row.occurrence_id),
        startedAt: String(row.started_at),
        completedAt: completedAtIso,
        creditedSeconds,
      };
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  getLearningStats(studentId: string, now = new Date()) {
    const rows = this.database
      .prepare(`
        SELECT checkin_date, first_activity_at, voice_seconds, homework_seconds
        FROM student_daily_learning
        WHERE student_id = ?
        ORDER BY checkin_date DESC
      `)
      .all(studentId) as Array<Record<string, unknown>>;
    const dates = rows.map((row) => String(row.checkin_date));
    const today = getShanghaiDate(now);
    const yesterday = shiftCalendarDate(today, -1);
    let currentStreak = 0;
    if (dates[0] === today || dates[0] === yesterday) {
      let expected = dates[0];
      for (const date of dates) {
        if (date !== expected) break;
        currentStreak += 1;
        expected = shiftCalendarDate(expected, -1);
      }
    }
    const checkins = rows.map((row) => ({
      checkinDate: String(row.checkin_date),
      firstActivityAt: String(row.first_activity_at),
      voiceSeconds: Number(row.voice_seconds),
      homeworkSeconds: Number(row.homework_seconds),
    }));
    return {
      summary: {
        checkinDays: checkins.length,
        currentStreak,
        voiceSeconds: checkins.reduce((total, day) => total + day.voiceSeconds, 0),
        homeworkSeconds: checkins.reduce((total, day) => total + day.homeworkSeconds, 0),
      },
      checkins,
    };
  }

  private addDailyLearning(
    studentId: string,
    activityAt: Date,
    voiceSeconds: number,
    homeworkSeconds: number,
  ) {
    const activityAtIso = activityAt.toISOString();
    this.database
      .prepare(`
        INSERT INTO student_daily_learning (
          student_id, checkin_date, first_activity_at,
          voice_seconds, homework_seconds, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(student_id, checkin_date) DO UPDATE SET
          first_activity_at = MIN(first_activity_at, excluded.first_activity_at),
          voice_seconds = voice_seconds + excluded.voice_seconds,
          homework_seconds = homework_seconds + excluded.homework_seconds,
          updated_at = excluded.updated_at
      `)
      .run(
        studentId,
        getShanghaiDate(activityAt),
        activityAtIso,
        voiceSeconds,
        homeworkSeconds,
        activityAtIso,
      );
  }

  deleteAll() {
    this.database.exec(`
      DELETE FROM homework_learning_sessions;
      DELETE FROM student_daily_learning;
      DELETE FROM speech_assessments;
      DELETE FROM homework_item_submissions;
      DELETE FROM homework_card_submissions;
      DELETE FROM homework_occurrences;
      DELETE FROM homework_items;
      DELETE FROM homework_cards;
      DELETE FROM homework_recipients;
      DELETE FROM homeworks;
      DELETE FROM users;
    `);
  }

  close() {
    this.database.close();
  }
}

function mapUserRow(row: Record<string, unknown>): UserRecord {
  return {
    id: String(row.id),
    phone: String(row.phone),
    displayName: String(row.display_name),
    passwordHash: String(row.password_hash),
    role: String(row.role),
    status: String(row.status),
    lastLoginAt: row.last_login_at ? String(row.last_login_at) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapHomeworkRow(row: Record<string, unknown>): HomeworkRecord {
  return {
    id: String(row.id),
    publisherId: String(row.publisher_id),
    title: String(row.title),
    instructions: row.instructions ? String(row.instructions) : null,
    status: String(row.status),
    templateType: String(row.template_type),
    startsAt: String(row.starts_at),
    repeatUnit: String(row.repeat_unit) as ScheduleUnit,
    repeatInterval: Number(row.repeat_interval),
    occurrenceLimit: Number(row.occurrence_limit),
    publishedAt: String(row.published_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapPracticeRecordingSubmission(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    studentId: String(row.student_id),
    studentName: String(row.student_name),
    homeworkId: String(row.homework_id),
    homeworkTitle: String(row.homework_title),
    templateType: String(row.template_type),
    occurrenceId: String(row.occurrence_id),
    itemId: String(row.item_id),
    itemPosition: Number(row.item_position),
    promptText: row.prompt_text ? String(row.prompt_text) : null,
    answerText: row.answer_text ? String(row.answer_text) : null,
    audioUrl: String(row.audio_url),
    feedbackAudioUrl: row.feedback_audio_url ? String(row.feedback_audio_url) : null,
    grade: row.grade ? String(row.grade) : null,
    submittedAt: String(row.submitted_at),
    reviewedAt: row.reviewed_at ? String(row.reviewed_at) : null,
    assessment: mapSpeechAssessment(row),
    status: row.reviewed_at || row.grade ? "GRADED" : "DONE",
  };
}

function mapSpeechAssessment(row: Record<string, unknown>): SpeechAssessment | null {
  if (!row.assessment_id) return null;
  return {
    id: String(row.assessment_id),
    status: String(row.assessment_status) as SpeechAssessmentStatus,
    provider: row.assessment_provider ? String(row.assessment_provider) : null,
    overallScore: nullableNumber(row.assessment_overall_score),
    accuracyScore: nullableNumber(row.assessment_accuracy_score),
    fluencyScore: nullableNumber(row.assessment_fluency_score),
    completenessScore: nullableNumber(row.assessment_completeness_score),
    prosodyScore: nullableNumber(row.assessment_prosody_score),
    wordResults: parseWordResults(row.assessment_word_results_json),
    completedAt: row.assessment_completed_at
      ? String(row.assessment_completed_at)
      : null,
  };
}

function nullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function parseWordResults(value: unknown): SpeechWordResult[] | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed as SpeechWordResult[] : null;
  } catch {
    return null;
  }
}

function mapHomeworkLearningSession(row: Record<string, unknown>): HomeworkLearningSession {
  return {
    id: String(row.id),
    occurrenceId: String(row.occurrence_id),
    startedAt: String(row.started_at),
    completedAt: row.completed_at ? String(row.completed_at) : null,
    creditedSeconds: Number(row.credited_seconds),
  };
}
