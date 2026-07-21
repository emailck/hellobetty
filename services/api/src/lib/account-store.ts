import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import {
  getOccurrenceTime,
  HOMEWORK_STATUS,
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
  classroomId: string | null;
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

export interface ClassroomRecord {
  id: string;
  name: string;
  status: string;
  creatorId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ClassroomMember {
  id: string;
  phone: string;
  displayName: string;
  role: string;
  status: string;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ClassroomSummary extends ClassroomRecord {
  teachers: ClassroomMember[];
  students: ClassroomMember[];
  teacherCount: number;
  studentCount: number;
}

export interface HomeworkSummary extends HomeworkRecord {
  publisherName: string;
  classroomName: string | null;
  classroomStatus: string | null;
  targetCount: number;
  occurrenceCount: number;
  completedOccurrenceCount: number;
}

export interface StaffScope {
  userId: string;
  role: string;
}

export interface SpeechAssessmentQueueItem {
  id: string;
  submissionId: string;
  sourceKind: string;
  status: string;
  provider: string | null;
  referenceText: string;
  locale: string;
  durationSeconds: number | null;
  attemptCount: number;
  lastError: string | null;
  nextAttemptAt: string;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  studentId: string;
  studentName: string;
  homeworkId: string;
  homeworkTitle: string;
  classroomId: string | null;
  classroomName: string | null;
}

export interface SpeechAssessmentQueueResult {
  assessments: SpeechAssessmentQueueItem[];
  pagination: { page: number; pageSize: number; total: number };
  summary: Record<SpeechAssessmentStatus, number>;
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
export class ClassroomAccessError extends Error {}
export class ClassroomNotFoundError extends Error {}
export class InvalidClassroomMembershipError extends Error {}
export class InvalidHomeworkStatusTransitionError extends Error {}
export class InvalidFeedbackAudioUrlError extends Error {}
export class SpeechAssessmentAccessError extends Error {}
export class SpeechAssessmentRetryError extends Error {}
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

export interface StudentProfileRecord {
  studentId: string;
  englishName: string | null;
  schoolName: string | null;
  gradeLevel: string | null;
  learningGoal: string | null;
  updatedAt: string;
}

export interface StudentPointEventRecord {
  id: string;
  studentId: string;
  type: string;
  sourceId: string;
  points: number;
  occurredAt: string;
  classroomId: string | null;
  classroomName: string | null;
}

export interface ClassroomPointPolicy {
  classroomId: string;
  classroomName: string;
  dailyCheckinPoints: number;
  homeworkCompletionPoints: number;
  streakRewards: Array<{ days: number; points: number }>;
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

function nullableTrimmedText(value: string | undefined | null): string | null {
  if (value === undefined || value === null) return null;
  return value.trim() || null;
}

const STUDENT_POINT_EVENTS = {
  DAILY_CHECKIN: { type: "DAILY_CHECKIN", points: 2 },
  HOMEWORK_COMPLETED: { type: "HOMEWORK_COMPLETED", points: 10 },
  STREAK_BONUS: { type: "STREAK_BONUS" },
} as const;

const POINTS_PER_LEVEL = 100;

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

function getRecentHomeworkCutoff(value: Date): string {
  const firstDate = shiftCalendarDate(getShanghaiDate(value), -4);
  return new Date(`${firstDate}T00:00:00+08:00`).toISOString();
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

function isAdminScope(scope: StaffScope | undefined): boolean {
  return scope?.role === "ADMIN";
}

function isTeacherScope(scope: StaffScope | undefined): scope is StaffScope {
  return scope?.role === "TEACHER";
}

function appendStaffHomeworkScope(
  clauses: string[],
  values: SQLInputValue[],
  scope: StaffScope | undefined,
  homeworkAlias = "homework",
): void {
  if (!scope || isAdminScope(scope)) return;
  clauses.push(`(
    (${homeworkAlias}.classroom_id IS NULL AND ${homeworkAlias}.publisher_id = ?)
    OR EXISTS (
      SELECT 1 FROM classroom_teachers scoped_teacher
      INNER JOIN classrooms scoped_classroom ON scoped_classroom.id = scoped_teacher.classroom_id
      WHERE scoped_teacher.classroom_id = ${homeworkAlias}.classroom_id
        AND scoped_teacher.teacher_id = ?
        AND scoped_classroom.status = 'ACTIVE'
    )
  )`);
  values.push(scope.userId, scope.userId);
}

function appendStaffStudentScope(
  clauses: string[],
  values: SQLInputValue[],
  scope: StaffScope | undefined,
  studentAlias = "users",
): void {
  if (!scope || isAdminScope(scope)) return;
  clauses.push(`EXISTS (
    SELECT 1 FROM classroom_students scoped_student
    INNER JOIN classroom_teachers scoped_teacher
      ON scoped_teacher.classroom_id = scoped_student.classroom_id
    INNER JOIN classrooms scoped_classroom ON scoped_classroom.id = scoped_student.classroom_id
    WHERE scoped_student.student_id = ${studentAlias}.id
      AND scoped_teacher.teacher_id = ?
      AND scoped_classroom.status = 'ACTIVE'
  )`);
  values.push(scope.userId);
}

function isPrivateFeedbackAudioUrl(value: string | undefined): boolean {
  return !value || /^\/uploads\/feedback\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(mp3|wav|m4a|webm|ogg)$/.test(value);
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
      CREATE TABLE IF NOT EXISTS classrooms (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        creator_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS classrooms_status_created_at_idx
        ON classrooms(status, created_at DESC);
      CREATE TABLE IF NOT EXISTS classroom_teachers (
        classroom_id TEXT NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
        teacher_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        created_at TEXT NOT NULL,
        PRIMARY KEY (classroom_id, teacher_id)
      );
      CREATE INDEX IF NOT EXISTS classroom_teachers_teacher_idx
        ON classroom_teachers(teacher_id, classroom_id);
      CREATE TABLE IF NOT EXISTS classroom_students (
        classroom_id TEXT NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
        student_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        created_at TEXT NOT NULL,
        PRIMARY KEY (classroom_id, student_id)
      );
      CREATE INDEX IF NOT EXISTS classroom_students_student_idx
        ON classroom_students(student_id, classroom_id);
      CREATE TABLE IF NOT EXISTS homeworks (
        id TEXT PRIMARY KEY,
        publisher_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        classroom_id TEXT REFERENCES classrooms(id) ON DELETE SET NULL,
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
      CREATE TABLE IF NOT EXISTS student_profiles (
        student_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        english_name TEXT,
        school_name TEXT,
        grade_level TEXT,
        learning_goal TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS student_point_events (
        id TEXT PRIMARY KEY,
        student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        event_type TEXT NOT NULL,
        source_id TEXT NOT NULL,
        points INTEGER NOT NULL,
        occurred_at TEXT NOT NULL,
        classroom_id TEXT REFERENCES classrooms(id) ON DELETE SET NULL,
        UNIQUE(student_id, event_type, source_id)
      );
      CREATE INDEX IF NOT EXISTS student_point_events_student_time_idx
        ON student_point_events(student_id, occurred_at DESC);
      CREATE TABLE IF NOT EXISTS classroom_point_policies (
        classroom_id TEXT PRIMARY KEY REFERENCES classrooms(id) ON DELETE CASCADE,
        daily_points INTEGER NOT NULL DEFAULT 2,
        homework_points INTEGER NOT NULL DEFAULT 10,
        updated_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS classroom_streak_rewards (
        classroom_id TEXT NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
        days INTEGER NOT NULL,
        points INTEGER NOT NULL,
        PRIMARY KEY (classroom_id, days)
      );
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
      CREATE TABLE IF NOT EXISTS feedback_uploads (
        url TEXT PRIMARY KEY,
        uploader_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        created_at TEXT NOT NULL,
        consumed_submission_id TEXT,
        consumed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS feedback_uploads_uploader_idx
        ON feedback_uploads(uploader_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS feedback_uploads_consumed_submission_idx
        ON feedback_uploads(consumed_submission_id);
    `);
    try {
      this.database.exec(
        "ALTER TABLE homeworks ADD COLUMN template_type TEXT NOT NULL DEFAULT 'STANDARD'",
      );
    } catch {
      // Existing databases already have the column after the first upgrade.
    }
    for (const statement of [
      "ALTER TABLE homeworks ADD COLUMN classroom_id TEXT REFERENCES classrooms(id) ON DELETE SET NULL",
      "ALTER TABLE homework_cards ADD COLUMN reference_text TEXT",
      "ALTER TABLE homework_card_submissions ADD COLUMN feedback_audio_url TEXT",
      "ALTER TABLE homework_card_submissions ADD COLUMN grade TEXT",
      "ALTER TABLE homework_card_submissions ADD COLUMN reviewed_at TEXT",
      "ALTER TABLE homework_card_submissions ADD COLUMN duration_seconds INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE homework_item_submissions ADD COLUMN duration_seconds INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE speech_assessments ADD COLUMN lease_token TEXT",
      "ALTER TABLE student_point_events ADD COLUMN classroom_id TEXT REFERENCES classrooms(id) ON DELETE SET NULL",
    ]) {
      try {
        this.database.exec(statement);
      } catch {
        // Existing databases already have the column after the first upgrade.
      }
    }
    this.database.exec(`
      CREATE INDEX IF NOT EXISTS homeworks_classroom_published_at_idx
        ON homeworks(classroom_id, published_at DESC);
    `);
    this.backfillPointEvents();
  }

  private backfillPointEvents() {
    const dailyRows = this.database
      .prepare(`
        SELECT student_id, checkin_date, first_activity_at
        FROM student_daily_learning
      `)
      .all() as Array<{ student_id: string; checkin_date: string; first_activity_at: string }>;
    for (const row of dailyRows) {
      this.addPointEvent({
        studentId: String(row.student_id),
        eventType: STUDENT_POINT_EVENTS.DAILY_CHECKIN.type,
        sourceId: String(row.checkin_date),
        points: STUDENT_POINT_EVENTS.DAILY_CHECKIN.points,
        occurredAt: String(row.first_activity_at),
      });
    }

    const completedRows = this.database
      .prepare(`
        SELECT o.id, o.student_id,
          COALESCE((
            SELECT MAX(submitted_at) FROM (
              SELECT submitted_at FROM homework_card_submissions card_submission
              WHERE card_submission.occurrence_id = o.id
              UNION ALL
              SELECT submitted_at FROM homework_item_submissions item_submission
              WHERE item_submission.occurrence_id = o.id
            ) submitted_times
          ), o.scheduled_at) AS occurred_at
        FROM homework_occurrences o
        WHERE o.status = 'COMPLETED'
      `)
      .all() as Array<{ id: string; student_id: string; occurred_at: string }>;
    for (const row of completedRows) {
      this.addPointEvent({
        studentId: String(row.student_id),
        eventType: STUDENT_POINT_EVENTS.HOMEWORK_COMPLETED.type,
        sourceId: String(row.id),
        points: STUDENT_POINT_EVENTS.HOMEWORK_COMPLETED.points,
        occurredAt: String(row.occurred_at),
      });
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

  getStudentProfile(studentId: string) {
    const profile = this.findOrCreateStudentProfile(studentId);
    return {
      profile,
      points: this.getStudentPoints(studentId),
      events: this.listStudentPointEvents(studentId),
    };
  }

  updateStudentProfile(input: {
    studentId: string;
    displayName?: string;
    englishName?: string | null;
    schoolName?: string | null;
    gradeLevel?: string | null;
    learningGoal?: string | null;
  }) {
    const now = new Date().toISOString();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      if (input.displayName !== undefined) {
        const displayName = input.displayName.trim();
        if (displayName.length < 2 || displayName.length > 24) throw new Error("INVALID_DISPLAY_NAME");
        this.database
          .prepare("UPDATE users SET display_name = ?, updated_at = ? WHERE id = ? AND role = 'STUDENT'")
          .run(displayName, now, input.studentId);
      }
      const existing = this.findOrCreateStudentProfile(input.studentId);
      this.database
        .prepare(`
          INSERT INTO student_profiles (
            student_id, english_name, school_name, grade_level, learning_goal, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(student_id) DO UPDATE SET
            english_name = excluded.english_name,
            school_name = excluded.school_name,
            grade_level = excluded.grade_level,
            learning_goal = excluded.learning_goal,
            updated_at = excluded.updated_at
        `)
        .run(
          input.studentId,
          input.englishName === undefined ? existing.englishName : nullableTrimmedText(input.englishName),
          input.schoolName === undefined ? existing.schoolName : nullableTrimmedText(input.schoolName),
          input.gradeLevel === undefined ? existing.gradeLevel : nullableTrimmedText(input.gradeLevel),
          input.learningGoal === undefined ? existing.learningGoal : nullableTrimmedText(input.learningGoal),
          now,
        );
      this.database.exec("COMMIT");
      return this.getStudentProfile(input.studentId);
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  private findOrCreateStudentProfile(studentId: string): StudentProfileRecord {
    const existing = this.database
      .prepare("SELECT * FROM student_profiles WHERE student_id = ?")
      .get(studentId) as Record<string, unknown> | undefined;
    if (existing) return mapStudentProfileRow(existing);
    const now = new Date().toISOString();
    this.database
      .prepare(`
        INSERT INTO student_profiles (
          student_id, english_name, school_name, grade_level, learning_goal, updated_at
        ) VALUES (?, NULL, NULL, NULL, NULL, ?)
      `)
      .run(studentId, now);
    return {
      studentId,
      englishName: null,
      schoolName: null,
      gradeLevel: null,
      learningGoal: null,
      updatedAt: now,
    };
  }

  private getStudentPoints(studentId: string) {
    const row = this.database
      .prepare("SELECT COALESCE(SUM(points), 0) AS total FROM student_point_events WHERE student_id = ?")
      .get(studentId) as { total: number };
    const total = Number(row.total);
    return {
      total,
      level: Math.floor(total / POINTS_PER_LEVEL) + 1,
      currentLevelPoints: total % POINTS_PER_LEVEL,
      nextLevelPoints: POINTS_PER_LEVEL,
    };
  }

  private listStudentPointEvents(studentId: string, limit = 20): StudentPointEventRecord[] {
    const rows = this.database
      .prepare(`
        SELECT event.*, classroom.name AS classroom_name
        FROM student_point_events event
        LEFT JOIN classrooms classroom ON classroom.id = event.classroom_id
        WHERE event.student_id = ?
          AND event.points > 0
        ORDER BY event.occurred_at DESC
        LIMIT ?
      `)
      .all(studentId, limit) as Array<Record<string, unknown>>;
    return rows.map(mapStudentPointEventRow);
  }

  private addPointEvent(input: {
    studentId: string;
    eventType: string;
    sourceId: string;
    points: number;
    occurredAt: string;
    classroomId?: string | null;
  }) {
    if (input.points < 0) return;
    this.database
      .prepare(`
        INSERT OR IGNORE INTO student_point_events (
          id, student_id, event_type, source_id, points, occurred_at, classroom_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        randomUUID(),
        input.studentId,
        input.eventType,
        input.sourceId,
        input.points,
        input.occurredAt,
        input.classroomId ?? null,
      );
  }

  listPointPolicies(scope: StaffScope): ClassroomPointPolicy[] {
    const classrooms = this.listClassrooms(scope).filter((classroom) => classroom.status === "ACTIVE");
    return classrooms.map((classroom) => this.getClassroomPointPolicy(classroom.id)!);
  }

  replaceClassroomPointPolicy(input: {
    classroomId: string;
    scope: StaffScope;
    dailyCheckinPoints: number;
    homeworkCompletionPoints: number;
    streakRewards: Array<{ days: number; points: number }>;
  }): ClassroomPointPolicy | null {
    if (!this.canManageActiveClassroom(input.classroomId, input.scope)) return null;
    const now = new Date().toISOString();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database
        .prepare(`
          INSERT INTO classroom_point_policies (
            classroom_id, daily_points, homework_points, updated_by, updated_at
          ) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(classroom_id) DO UPDATE SET
            daily_points = excluded.daily_points,
            homework_points = excluded.homework_points,
            updated_by = excluded.updated_by,
            updated_at = excluded.updated_at
        `)
        .run(input.classroomId, input.dailyCheckinPoints, input.homeworkCompletionPoints, input.scope.userId, now);
      this.database
        .prepare("DELETE FROM classroom_streak_rewards WHERE classroom_id = ?")
        .run(input.classroomId);
      const statement = this.database.prepare(`
        INSERT INTO classroom_streak_rewards (classroom_id, days, points)
        VALUES (?, ?, ?)
      `);
      for (const reward of input.streakRewards) {
        statement.run(input.classroomId, reward.days, reward.points);
      }
      this.database.exec("COMMIT");
      return this.getClassroomPointPolicy(input.classroomId)!;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  private canManageActiveClassroom(classroomId: string, scope: StaffScope): boolean {
    if (scope.role === "ADMIN") {
      return Boolean(this.database
        .prepare("SELECT 1 FROM classrooms WHERE id = ? AND status = 'ACTIVE'")
        .get(classroomId));
    }
    return Boolean(this.database
      .prepare(`
        SELECT 1 FROM classrooms
        INNER JOIN classroom_teachers ON classroom_teachers.classroom_id = classrooms.id
        WHERE classrooms.id = ? AND classrooms.status = 'ACTIVE'
          AND classroom_teachers.teacher_id = ?
      `)
      .get(classroomId, scope.userId));
  }

  getClassroomPointPolicy(classroomId: string): ClassroomPointPolicy | null {
    const classroom = this.getClassroom(classroomId);
    if (!classroom) return null;
    const policy = this.database
      .prepare("SELECT * FROM classroom_point_policies WHERE classroom_id = ?")
      .get(classroomId) as Record<string, unknown> | undefined;
    const rewards = this.database
      .prepare(`
        SELECT days, points FROM classroom_streak_rewards
        WHERE classroom_id = ? ORDER BY days ASC
      `)
      .all(classroomId) as Array<{ days: number; points: number }>;
    return {
      classroomId,
      classroomName: classroom.name,
      dailyCheckinPoints: policy ? Number(policy.daily_points) : STUDENT_POINT_EVENTS.DAILY_CHECKIN.points,
      homeworkCompletionPoints: policy ? Number(policy.homework_points) : STUDENT_POINT_EVENTS.HOMEWORK_COMPLETED.points,
      streakRewards: rewards.map((reward) => ({ days: Number(reward.days), points: Number(reward.points) })),
    };
  }

  private getPolicyForClassroom(classroomId: string | null): {
    dailyCheckinPoints: number;
    homeworkCompletionPoints: number;
    streakRewards: Array<{ days: number; points: number }>;
  } {
    if (!classroomId) {
      return {
        dailyCheckinPoints: STUDENT_POINT_EVENTS.DAILY_CHECKIN.points,
        homeworkCompletionPoints: STUDENT_POINT_EVENTS.HOMEWORK_COMPLETED.points,
        streakRewards: [],
      };
    }
    const policy = this.getClassroomPointPolicy(classroomId);
    return policy ?? {
      dailyCheckinPoints: STUDENT_POINT_EVENTS.DAILY_CHECKIN.points,
      homeworkCompletionPoints: STUDENT_POINT_EVENTS.HOMEWORK_COMPLETED.points,
      streakRewards: [],
    };
  }

  registerFeedbackUpload(input: { url: string; uploaderId: string; createdAt?: Date }) {
    if (!isPrivateFeedbackAudioUrl(input.url)) throw new InvalidFeedbackAudioUrlError();
    const createdAt = (input.createdAt ?? new Date()).toISOString();
    this.database
      .prepare(`
        INSERT INTO feedback_uploads (url, uploader_id, created_at, consumed_submission_id, consumed_at)
        VALUES (?, ?, ?, NULL, NULL)
      `)
      .run(input.url, input.uploaderId, createdAt);
  }

  private consumeFeedbackUpload(input: {
    url: string | undefined;
    uploaderId: string | undefined;
    submissionId: string;
    consumedAt: string;
  }) {
    if (input.url === undefined) return;
    if (!input.uploaderId || !isPrivateFeedbackAudioUrl(input.url)) {
      throw new InvalidFeedbackAudioUrlError();
    }
    const changed = this.database
      .prepare(`
        UPDATE feedback_uploads
        SET consumed_submission_id = COALESCE(consumed_submission_id, ?),
          consumed_at = COALESCE(consumed_at, ?)
        WHERE url = ?
          AND (
            (consumed_submission_id IS NULL AND uploader_id = ?)
            OR consumed_submission_id = ?
          )
      `)
      .run(
        input.submissionId,
        input.consumedAt,
        input.url,
        input.uploaderId,
        input.submissionId,
      );
    if (Number(changed.changes) !== 1) throw new InvalidFeedbackAudioUrlError();
  }

  listStudents(
    page: number,
    pageSize: number,
    search: string,
    scope?: StaffScope,
  ) {
    const offset = (page - 1) * pageSize;
    const clauses = ["role = 'STUDENT'"];
    const values: SQLInputValue[] = [];
    if (search) {
      clauses.push("(phone LIKE ? OR display_name LIKE ?)");
      values.push(`%${search}%`, `%${search}%`);
    }
    appendStaffStudentScope(clauses, values, scope, "users");
    const filter = clauses.join(" AND ");
    const rows = this.database
      .prepare(
        `SELECT * FROM users WHERE ${filter}
         ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      )
      .all(...values, pageSize, offset);
    const totalRow = this.database
      .prepare(`SELECT COUNT(*) AS count FROM users WHERE ${filter}`)
      .get(...values) as { count: number };
    const activeClauses = ["role = 'STUDENT'", "status = 'ACTIVE'"];
    const activeValues: SQLInputValue[] = [];
    appendStaffStudentScope(activeClauses, activeValues, scope, "users");
    const activeRow = this.database
      .prepare(`SELECT COUNT(*) AS count FROM users WHERE ${activeClauses.join(" AND ")}`)
      .get(...activeValues) as { count: number };
    return {
      users: rows.map(mapUserRow),
      total: Number(totalRow.count),
      activeCount: Number(activeRow.count),
    };
  }

  listAdminUsers(input: {
    page: number;
    pageSize: number;
    search: string;
    role?: string;
    scope?: StaffScope;
  }) {
    if (isTeacherScope(input.scope)) {
      const result = this.listStudents(input.page, input.pageSize, input.search, input.scope);
      return {
        users: result.users,
        total: result.total,
        activeCount: result.activeCount,
        teacherCount: 0,
        studentCount: result.total,
      };
    }
    const offset = (input.page - 1) * input.pageSize;
    const clauses: string[] = [];
    const values: SQLInputValue[] = [];
    if (input.role) {
      clauses.push("role = ?");
      values.push(input.role);
    } else {
      clauses.push("role IN ('TEACHER', 'STUDENT')");
    }
    if (input.search) {
      clauses.push("(phone LIKE ? OR display_name LIKE ?)");
      values.push(`%${input.search}%`, `%${input.search}%`);
    }
    const filter = clauses.join(" AND ");
    const rows = this.database
      .prepare(`SELECT * FROM users WHERE ${filter} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .all(...values, input.pageSize, offset);
    const totalRow = this.database
      .prepare(`SELECT COUNT(*) AS count FROM users WHERE ${filter}`)
      .get(...values) as { count: number };
    const activeRow = this.database
      .prepare(`SELECT COUNT(*) AS count FROM users WHERE ${filter} AND status = 'ACTIVE'`)
      .get(...values) as { count: number };
    const teacherRow = this.database
      .prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'TEACHER'")
      .get() as { count: number };
    const studentRow = this.database
      .prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'STUDENT'")
      .get() as { count: number };
    return {
      users: rows.map(mapUserRow),
      total: Number(totalRow.count),
      activeCount: Number(activeRow.count),
      teacherCount: Number(teacherRow.count),
      studentCount: Number(studentRow.count),
    };
  }

  updateUserStatus(input: { userId: string; status: string }): UserRecord | null {
    const now = new Date().toISOString();
    const changed = this.database
      .prepare("UPDATE users SET status = ?, updated_at = ? WHERE id = ?")
      .run(input.status, now, input.userId);
    return Number(changed.changes) === 1 ? this.findById(input.userId) : null;
  }

  createClassroom(input: {
    creatorId: string;
    name: string;
    teacherIds?: string[];
    studentIds?: string[];
  }): ClassroomSummary {
    const now = new Date().toISOString();
    const classroomId = randomUUID();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.validateClassroomMembers(input.teacherIds ?? [], input.studentIds ?? []);
      this.database
        .prepare(`
          INSERT INTO classrooms (id, name, status, creator_id, created_at, updated_at)
          VALUES (?, ?, 'ACTIVE', ?, ?, ?)
        `)
        .run(classroomId, input.name.trim(), input.creatorId, now, now);
      this.replaceClassroomMembership(classroomId, input.teacherIds ?? [], input.studentIds ?? [], now);
      this.database.exec("COMMIT");
      return this.getClassroom(classroomId)!;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  updateClassroom(input: {
    classroomId: string;
    name?: string;
    status?: string;
    teacherIds?: string[];
    studentIds?: string[];
  }): ClassroomSummary | null {
    const now = new Date().toISOString();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.database
        .prepare("SELECT id FROM classrooms WHERE id = ?")
        .get(input.classroomId);
      if (!existing) {
        this.database.exec("COMMIT");
        return null;
      }
      if (input.teacherIds || input.studentIds) {
        const currentTeachers = input.teacherIds ?? this.listClassroomMemberIds(input.classroomId, "teacher");
        const currentStudents = input.studentIds ?? this.listClassroomMemberIds(input.classroomId, "student");
        this.validateClassroomMembers(currentTeachers, currentStudents);
        this.replaceClassroomMembership(input.classroomId, currentTeachers, currentStudents, now);
      }
      if (input.name !== undefined || input.status !== undefined) {
        const sets: string[] = [];
        const values: SQLInputValue[] = [];
        if (input.name !== undefined) {
          sets.push("name = ?");
          values.push(input.name.trim());
        }
        if (input.status !== undefined) {
          sets.push("status = ?");
          values.push(input.status);
        }
        sets.push("updated_at = ?");
        values.push(now, input.classroomId);
        this.database.prepare(`UPDATE classrooms SET ${sets.join(", ")} WHERE id = ?`).run(...values);
      }
      this.database.exec("COMMIT");
      return this.getClassroom(input.classroomId);
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  listClassrooms(scope?: StaffScope): ClassroomSummary[] {
    const clauses: string[] = [];
    const values: SQLInputValue[] = [];
    if (isTeacherScope(scope)) {
      clauses.push(`EXISTS (
        SELECT 1 FROM classroom_teachers scoped_teacher
        WHERE scoped_teacher.classroom_id = classrooms.id AND scoped_teacher.teacher_id = ?
      )`);
      values.push(scope.userId);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.database
      .prepare(`SELECT * FROM classrooms ${where} ORDER BY created_at DESC`)
      .all(...values) as Array<Record<string, unknown>>;
    return rows.map((row) => this.getClassroom(String(row.id))!);
  }

  getClassroom(classroomId: string): ClassroomSummary | null {
    const row = this.database
      .prepare("SELECT * FROM classrooms WHERE id = ?")
      .get(classroomId) as Record<string, unknown> | undefined;
    if (!row) return null;
    const teachers = this.database
      .prepare(`
        SELECT users.* FROM users
        INNER JOIN classroom_teachers ON classroom_teachers.teacher_id = users.id
        WHERE classroom_teachers.classroom_id = ?
        ORDER BY users.display_name ASC
      `)
      .all(classroomId)
      .map((row) => mapClassroomMember(mapUserRow(row)));
    const students = this.database
      .prepare(`
        SELECT users.* FROM users
        INNER JOIN classroom_students ON classroom_students.student_id = users.id
        WHERE classroom_students.classroom_id = ?
        ORDER BY users.display_name ASC
      `)
      .all(classroomId)
      .map((row) => mapClassroomMember(mapUserRow(row)));
    return {
      ...mapClassroomRow(row),
      teachers,
      students,
      teacherCount: teachers.length,
      studentCount: students.length,
    };
  }

  canStaffAccessStudent(scope: StaffScope, studentId: string): boolean {
    if (scope.role === "ADMIN") return true;
    const row = this.database
      .prepare(`
        SELECT 1 FROM users student
        WHERE student.id = ? AND student.role = 'STUDENT' AND student.status = 'ACTIVE'
          AND EXISTS (
            SELECT 1 FROM classroom_students scoped_student
            INNER JOIN classroom_teachers scoped_teacher
              ON scoped_teacher.classroom_id = scoped_student.classroom_id
            INNER JOIN classrooms scoped_classroom ON scoped_classroom.id = scoped_student.classroom_id
            WHERE scoped_student.student_id = student.id
              AND scoped_teacher.teacher_id = ?
              AND scoped_classroom.status = 'ACTIVE'
          )
        LIMIT 1
      `)
      .get(studentId, scope.userId);
    return Boolean(row);
  }

  private validateClassroomMembers(teacherIds: string[], studentIds: string[]) {
    const uniqueTeachers = [...new Set(teacherIds)];
    const uniqueStudents = [...new Set(studentIds)];
    if (uniqueTeachers.length) {
      const placeholders = uniqueTeachers.map(() => "?").join(", ");
      const rows = this.database
        .prepare(`SELECT id FROM users WHERE id IN (${placeholders}) AND role = 'TEACHER' AND status = 'ACTIVE'`)
        .all(...uniqueTeachers);
      if (rows.length !== uniqueTeachers.length) throw new InvalidClassroomMembershipError();
    }
    if (uniqueStudents.length) {
      const placeholders = uniqueStudents.map(() => "?").join(", ");
      const rows = this.database
        .prepare(`SELECT id FROM users WHERE id IN (${placeholders}) AND role = 'STUDENT' AND status = 'ACTIVE'`)
        .all(...uniqueStudents);
      if (rows.length !== uniqueStudents.length) throw new InvalidClassroomMembershipError();
    }
  }

  private listClassroomMemberIds(classroomId: string, kind: "teacher" | "student"): string[] {
    const table = kind === "teacher" ? "classroom_teachers" : "classroom_students";
    const column = kind === "teacher" ? "teacher_id" : "student_id";
    return (this.database
      .prepare(`SELECT ${column} AS id FROM ${table} WHERE classroom_id = ?`)
      .all(classroomId) as Array<{ id: string }>).map((row) => String(row.id));
  }

  private replaceClassroomMembership(
    classroomId: string,
    teacherIds: string[],
    studentIds: string[],
    now: string,
  ) {
    this.database.prepare("DELETE FROM classroom_teachers WHERE classroom_id = ?").run(classroomId);
    this.database.prepare("DELETE FROM classroom_students WHERE classroom_id = ?").run(classroomId);
    const teacherStatement = this.database.prepare(`
      INSERT INTO classroom_teachers (classroom_id, teacher_id, created_at)
      VALUES (?, ?, ?)
    `);
    for (const teacherId of [...new Set(teacherIds)]) teacherStatement.run(classroomId, teacherId, now);
    const studentStatement = this.database.prepare(`
      INSERT INTO classroom_students (classroom_id, student_id, created_at)
      VALUES (?, ?, ?)
    `);
    for (const studentId of [...new Set(studentIds)]) studentStatement.run(classroomId, studentId, now);
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
    classroomId?: string | null;
    staffRole?: string;
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
      classroomId: input.classroomId?.trim() || null,
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

      if (input.staffRole === "TEACHER" && !homework.classroomId) {
        throw new ClassroomAccessError();
      }
      if (homework.classroomId) {
        const classroom = this.database
          .prepare("SELECT id, status FROM classrooms WHERE id = ?")
          .get(homework.classroomId) as { id: string; status: string } | undefined;
        if (!classroom || classroom.status !== "ACTIVE") throw new ClassroomAccessError();
        if (input.staffRole === "TEACHER") {
          const teacherMembership = this.database
            .prepare(`
              SELECT 1 FROM classroom_teachers
              WHERE classroom_id = ? AND teacher_id = ?
              LIMIT 1
            `)
            .get(homework.classroomId, input.publisherId);
          if (!teacherMembership) throw new ClassroomAccessError();
        }
        const classroomStudents = this.database
          .prepare(`
            SELECT student_id FROM classroom_students
            WHERE classroom_id = ? AND student_id IN (${studentPlaceholders})
          `)
          .all(homework.classroomId, ...studentIds) as Array<{ student_id: string }>;
        if (classroomStudents.length !== studentIds.length) {
          throw new InvalidHomeworkStudentsError();
        }
      }

      this.database
        .prepare(`
          INSERT INTO homeworks (
            id, publisher_id, classroom_id, title, instructions, status, template_type, starts_at, repeat_unit,
            repeat_interval, occurrence_limit, published_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          homework.id,
          homework.publisherId,
          homework.classroomId,
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

  listPublishedHomeworks(limit = 20, scope?: StaffScope, offset = 0): HomeworkSummary[] {
    const clauses: string[] = [];
    const values: SQLInputValue[] = [];
    appendStaffHomeworkScope(clauses, values, scope, "h");
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.database
      .prepare(`
        SELECT
          h.*,
          publisher.display_name AS publisher_name,
          classroom.name AS classroom_name,
          classroom.status AS classroom_status,
          COUNT(DISTINCT recipient.student_id) AS target_count,
          COUNT(occurrence.id) AS occurrence_count,
          COUNT(CASE WHEN occurrence.status = 'COMPLETED' THEN 1 END) AS completed_occurrence_count
        FROM homeworks h
        INNER JOIN users publisher ON publisher.id = h.publisher_id
        LEFT JOIN classrooms classroom ON classroom.id = h.classroom_id
        LEFT JOIN homework_recipients recipient ON recipient.homework_id = h.id
        LEFT JOIN homework_occurrences occurrence ON occurrence.homework_id = h.id
        ${where}
        GROUP BY h.id
        ORDER BY h.published_at DESC
        LIMIT ? OFFSET ?
      `)
      .all(...values, limit, offset) as Array<Record<string, unknown>>;
    return rows.map(mapHomeworkSummaryRow);
  }

  countPublishedHomeworks(scope?: StaffScope): number {
    const clauses: string[] = [];
    const values: SQLInputValue[] = [];
    appendStaffHomeworkScope(clauses, values, scope, "h");
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const row = this.database
      .prepare(`SELECT COUNT(*) AS count FROM homeworks h ${where}`)
      .get(...values) as { count: number };
    return Number(row.count);
  }

  updateHomeworkStatus(input: {
    homeworkId: string;
    status: string;
    scope?: StaffScope;
  }): HomeworkSummary | null {
    const existing = this.getScopedHomework(input.homeworkId, input.scope);
    if (!existing) return null;
    if (existing.status === HOMEWORK_STATUS.ARCHIVED) {
      throw new InvalidHomeworkStatusTransitionError();
    }
    const allowed = input.status === HOMEWORK_STATUS.ARCHIVED ||
      (existing.status === HOMEWORK_STATUS.PUBLISHED && input.status === HOMEWORK_STATUS.PAUSED) ||
      (existing.status === HOMEWORK_STATUS.PAUSED && input.status === HOMEWORK_STATUS.PUBLISHED);
    if (!allowed) throw new InvalidHomeworkStatusTransitionError();
    this.database
      .prepare("UPDATE homeworks SET status = ?, updated_at = ? WHERE id = ?")
      .run(input.status, new Date().toISOString(), input.homeworkId);
    return this.getHomeworkSummary(input.homeworkId, input.scope);
  }

  getHomeworkSummary(homeworkId: string, scope?: StaffScope): HomeworkSummary | null {
    const clauses = ["h.id = ?"];
    const values: SQLInputValue[] = [homeworkId];
    appendStaffHomeworkScope(clauses, values, scope, "h");
    const row = this.database
      .prepare(`
        SELECT
          h.*,
          publisher.display_name AS publisher_name,
          classroom.name AS classroom_name,
          classroom.status AS classroom_status,
          COUNT(DISTINCT recipient.student_id) AS target_count,
          COUNT(occurrence.id) AS occurrence_count,
          COUNT(CASE WHEN occurrence.status = 'COMPLETED' THEN 1 END) AS completed_occurrence_count
        FROM homeworks h
        INNER JOIN users publisher ON publisher.id = h.publisher_id
        LEFT JOIN classrooms classroom ON classroom.id = h.classroom_id
        LEFT JOIN homework_recipients recipient ON recipient.homework_id = h.id
        LEFT JOIN homework_occurrences occurrence ON occurrence.homework_id = h.id
        WHERE ${clauses.join(" AND ")}
        GROUP BY h.id
        LIMIT 1
      `)
      .get(...values) as Record<string, unknown> | undefined;
    return row ? mapHomeworkSummaryRow(row) : null;
  }

  private getScopedHomework(homeworkId: string, scope?: StaffScope): HomeworkRecord | null {
    const clauses = ["h.id = ?"];
    const values: SQLInputValue[] = [homeworkId];
    appendStaffHomeworkScope(clauses, values, scope, "h");
    const row = this.database
      .prepare(`SELECT h.* FROM homeworks h WHERE ${clauses.join(" AND ")}`)
      .get(...values) as Record<string, unknown> | undefined;
    return row ? mapHomeworkRow(row) : null;
  }

  listStudentReadingOccurrences(studentId: string, currentTime = new Date()) {
    const now = currentTime.toISOString();
    const recentCutoff = getRecentHomeworkCutoff(currentTime);
    this.database
      .prepare(`
        UPDATE homework_occurrences SET status = 'AVAILABLE'
        WHERE student_id = ? AND scheduled_at <= ? AND status = 'SCHEDULED'
          AND EXISTS (
            SELECT 1 FROM homeworks h
            WHERE h.id = homework_occurrences.homework_id AND h.status = 'PUBLISHED'
          )
      `)
      .run(studentId, now);
    return this.database
      .prepare(`
        SELECT o.id, h.title, h.instructions, o.status, o.scheduled_at,
          COUNT(DISTINCT card.id) AS card_count,
          COUNT(DISTINCT submission.card_id) AS submitted_card_count,
          COUNT(DISTINCT CASE
            WHEN (submission.reviewed_at IS NOT NULL OR submission.grade IS NOT NULL)
              AND NOT EXISTS (
                SELECT 1 FROM homework_card_submissions newer
                WHERE newer.occurrence_id = submission.occurrence_id
                  AND newer.card_id = submission.card_id
                  AND newer.student_id = submission.student_id
                  AND newer.attempt_number > submission.attempt_number
              ) THEN submission.card_id
          END) AS reviewed_card_count,
          EXISTS (
            SELECT 1 FROM homework_learning_sessions session
            WHERE session.occurrence_id = o.id AND session.student_id = o.student_id
          ) AS has_viewed
        FROM homework_occurrences o
        INNER JOIN homeworks h ON h.id = o.homework_id
        INNER JOIN homework_cards card ON card.homework_id = h.id
        LEFT JOIN homework_card_submissions submission
          ON submission.occurrence_id = o.id AND submission.student_id = o.student_id
        WHERE o.student_id = ?
          AND h.template_type = 'READ_ALOUD_PICTURE_BOOK'
          AND h.status = 'PUBLISHED'
          AND o.scheduled_at >= ?
          AND o.scheduled_at <= ?
        GROUP BY o.id
        ORDER BY o.scheduled_at ASC
      `)
      .all(studentId, recentCutoff, now)
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
        reviewedCardCount: Number((row as Record<string, unknown>).reviewed_card_count),
        hasViewed: Boolean((row as Record<string, unknown>).has_viewed),
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
          AND h.status = 'PUBLISHED'
          AND o.scheduled_at <= ?
      `)
      .get(occurrenceId, studentId, new Date().toISOString()) as Record<string, unknown> | undefined;
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
          SELECT card.position, card.homework_id, card.reference_text,
            occurrence.status AS occurrence_status,
            occurrence.scheduled_at, homework.classroom_id
          FROM homework_cards card
          INNER JOIN homework_occurrences occurrence
            ON occurrence.homework_id = card.homework_id
          INNER JOIN homeworks homework ON homework.id = card.homework_id
          WHERE occurrence.id = ? AND occurrence.student_id = ? AND card.id = ?
            AND homework.status = 'PUBLISHED'
        `)
        .get(input.occurrenceId, input.studentId, input.cardId) as
        | {
            position: number;
            homework_id: string;
            reference_text: string | null;
            occurrence_status: string;
            scheduled_at: string;
            classroom_id: string | null;
          }
        | undefined;
      if (!card || new Date(card.scheduled_at).getTime() > activityAt.getTime()) {
        throw new HomeworkAccessError();
      }
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
      this.addDailyLearning(input.studentId, activityAt, durationSeconds, 0, card.classroom_id);
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
      if (!pending && card.occurrence_status !== "COMPLETED") {
        this.addPointEvent({
          studentId: input.studentId,
          eventType: STUDENT_POINT_EVENTS.HOMEWORK_COMPLETED.type,
          sourceId: input.occurrenceId,
          points: this.getPolicyForClassroom(card.classroom_id).homeworkCompletionPoints,
          occurredAt: now,
          classroomId: card.classroom_id,
        });
      }
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return this.getStudentReadingOccurrence(input.occurrenceId, input.studentId);
  }

  listReadAloudSubmissions(limit = 100, scope?: StaffScope) {
    const clauses: string[] = [];
    const values: SQLInputValue[] = [];
    appendStaffHomeworkScope(clauses, values, scope, "homework");
    const scopeWhere = clauses.length ? `AND ${clauses.join(" AND ")}` : "";
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
        ${scopeWhere}
        ORDER BY submission.reviewed_at IS NOT NULL, submission.submitted_at DESC
        LIMIT ?
      `)
      .all(...values, limit) as Array<Record<string, unknown>>;
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
    scope?: StaffScope;
  }) {
    const reviewedAt = new Date().toISOString();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.consumeFeedbackUpload({
        url: input.feedbackAudioUrl,
        uploaderId: input.scope?.userId,
        submissionId: input.submissionId,
        consumedAt: reviewedAt,
      });
      const changed = this.database
        .prepare(`
          UPDATE homework_card_submissions
          SET grade = ?,
            feedback_audio_url = CASE WHEN ? = 1 THEN ? ELSE feedback_audio_url END,
            reviewed_at = ?
          WHERE id = ? AND (
            ? = 'ADMIN' OR EXISTS (
              SELECT 1 FROM homework_occurrences occurrence
              INNER JOIN homeworks homework ON homework.id = occurrence.homework_id
              WHERE occurrence.id = homework_card_submissions.occurrence_id
                AND ((homework.classroom_id IS NULL AND homework.publisher_id = ?) OR EXISTS (
                  SELECT 1 FROM classroom_teachers scoped_teacher
                  INNER JOIN classrooms scoped_classroom ON scoped_classroom.id = scoped_teacher.classroom_id
                  WHERE scoped_teacher.classroom_id = homework.classroom_id
                    AND scoped_teacher.teacher_id = ?
                    AND scoped_classroom.status = 'ACTIVE'
                ))
            )
          ) AND NOT EXISTS (
            SELECT 1 FROM homework_card_submissions newer
            WHERE newer.occurrence_id = homework_card_submissions.occurrence_id
              AND newer.card_id = homework_card_submissions.card_id
              AND newer.student_id = homework_card_submissions.student_id
              AND newer.attempt_number > homework_card_submissions.attempt_number
          )
        `)
        .run(
          input.grade,
          Number(input.feedbackAudioUrl !== undefined),
          input.feedbackAudioUrl ?? null,
          reviewedAt,
          input.submissionId,
          input.scope?.role ?? "ADMIN",
          input.scope?.userId ?? "",
          input.scope?.userId ?? "",
        );
      if (Number(changed.changes) !== 1) throw new ReviewSubmissionNotFoundError();
      this.database.exec("COMMIT");
      return this.listReadAloudSubmissions(100, input.scope).find((submission) => submission.id === input.submissionId)!;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  listStudentPracticeOccurrences(studentId: string, currentTime = new Date()) {
    const now = currentTime.toISOString();
    const recentCutoff = getRecentHomeworkCutoff(currentTime);
    this.database
      .prepare(`
        UPDATE homework_occurrences SET status = 'AVAILABLE'
        WHERE student_id = ? AND scheduled_at <= ? AND status = 'SCHEDULED'
          AND EXISTS (
            SELECT 1 FROM homeworks h
            WHERE h.id = homework_occurrences.homework_id AND h.status = 'PUBLISHED'
          )
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
          END) AS completed_item_count,
          COUNT(DISTINCT CASE
            WHEN h.template_type IN ('SENTENCE_READ_ALOUD', 'WORD_READ_ALOUD')
              AND (submission.reviewed_at IS NOT NULL OR submission.grade IS NOT NULL)
              AND NOT EXISTS (
                SELECT 1 FROM homework_item_submissions newer
                WHERE newer.occurrence_id = submission.occurrence_id
                  AND newer.item_id = submission.item_id
                  AND newer.student_id = submission.student_id
                  AND newer.attempt_number > submission.attempt_number
              ) THEN item.id
          END) AS reviewed_item_count,
          EXISTS (
            SELECT 1 FROM homework_learning_sessions session
            WHERE session.occurrence_id = o.id AND session.student_id = o.student_id
          ) AS has_viewed
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
          AND h.status = 'PUBLISHED'
          AND o.scheduled_at >= ?
          AND o.scheduled_at <= ?
        GROUP BY o.id
        ORDER BY o.scheduled_at ASC
      `)
      .all(studentId, recentCutoff, now)
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
          reviewedItemCount: Number(occurrence.reviewed_item_count),
          hasViewed: Boolean(occurrence.has_viewed),
        };
      });
  }

  getStudentPracticeOccurrence(occurrenceId: string, studentId: string) {
    const now = new Date().toISOString();
    this.database
      .prepare(`
        UPDATE homework_occurrences SET status = 'AVAILABLE'
        WHERE id = ? AND student_id = ? AND scheduled_at <= ? AND status = 'SCHEDULED'
          AND EXISTS (
            SELECT 1 FROM homeworks h
            WHERE h.id = homework_occurrences.homework_id AND h.status = 'PUBLISHED'
          )
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
          AND h.status = 'PUBLISHED'
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
            occurrence.status AS occurrence_status,
            homework.template_type, homework.classroom_id
          FROM homework_items item
          INNER JOIN homework_occurrences occurrence ON occurrence.homework_id = item.homework_id
          INNER JOIN homeworks homework ON homework.id = item.homework_id
          WHERE occurrence.id = ? AND occurrence.student_id = ? AND occurrence.scheduled_at <= ?
            AND homework.status = 'PUBLISHED'
            AND item.id = ?
        `)
        .get(input.occurrenceId, input.studentId, new Date().toISOString(), input.itemId) as
        | {
            position: number;
            homework_id: string;
            prompt_text: string | null;
            answer_text: string | null;
            occurrence_status: string;
            template_type: string;
            classroom_id: string | null;
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
          item.classroom_id,
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
      if (!pending && item.occurrence_status !== "COMPLETED") {
        this.addPointEvent({
          studentId: input.studentId,
          eventType: STUDENT_POINT_EVENTS.HOMEWORK_COMPLETED.type,
          sourceId: input.occurrenceId,
          points: this.getPolicyForClassroom(item.classroom_id).homeworkCompletionPoints,
          occurredAt: submittedAt,
          classroomId: item.classroom_id,
        });
      }
      this.database.exec("COMMIT");
      return { isCorrect };
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  listPracticeRecordingSubmissions(limit = 100, scope?: StaffScope) {
    const clauses: string[] = [];
    const values: SQLInputValue[] = [];
    appendStaffHomeworkScope(clauses, values, scope, "homework");
    const scopeWhere = clauses.length ? `AND ${clauses.join(" AND ")}` : "";
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
        ${scopeWhere}
        ORDER BY submission.reviewed_at IS NOT NULL, submission.submitted_at DESC
        LIMIT ?
      `)
      .all(...values, limit) as Array<Record<string, unknown>>;
    return rows.map(mapPracticeRecordingSubmission);
  }

  canAccessSubmissionAudio(input: {
    audioUrl: string;
    userId: string;
    isStaff: boolean;
    staffScope?: StaffScope;
  }): boolean {
    if (!input.isStaff) {
      const row = this.database
        .prepare(`
          SELECT 1 FROM (
            SELECT student_id, audio_url FROM homework_card_submissions
            UNION ALL
            SELECT student_id, audio_url FROM homework_item_submissions
            WHERE audio_url IS NOT NULL
          ) submission
          WHERE submission.audio_url = ? AND submission.student_id = ?
          LIMIT 1
        `)
        .get(input.audioUrl, input.userId);
      return Boolean(row);
    }
    if (!input.staffScope || input.staffScope.role === "ADMIN") {
      const row = this.database
        .prepare(`
          SELECT 1 FROM (
            SELECT audio_url FROM homework_card_submissions
            UNION ALL
            SELECT audio_url FROM homework_item_submissions WHERE audio_url IS NOT NULL
          ) submission
          WHERE submission.audio_url = ? LIMIT 1
        `)
        .get(input.audioUrl);
      return Boolean(row);
    }
    const row = this.database
      .prepare(`
        SELECT 1 FROM homework_card_submissions submission
        INNER JOIN homework_occurrences occurrence ON occurrence.id = submission.occurrence_id
        INNER JOIN homeworks homework ON homework.id = occurrence.homework_id
        WHERE submission.audio_url = ?
          AND (
            (homework.classroom_id IS NULL AND homework.publisher_id = ?)
            OR EXISTS (
              SELECT 1 FROM classroom_teachers scoped_teacher
              INNER JOIN classrooms scoped_classroom ON scoped_classroom.id = scoped_teacher.classroom_id
              WHERE scoped_teacher.classroom_id = homework.classroom_id
                AND scoped_teacher.teacher_id = ?
                AND scoped_classroom.status = 'ACTIVE'
            )
          )
        UNION ALL
        SELECT 1 FROM homework_item_submissions submission
        INNER JOIN homework_occurrences occurrence ON occurrence.id = submission.occurrence_id
        INNER JOIN homework_items item ON item.id = submission.item_id
        INNER JOIN homeworks homework ON homework.id = item.homework_id
        WHERE submission.audio_url = ?
          AND (
            (homework.classroom_id IS NULL AND homework.publisher_id = ?)
            OR EXISTS (
              SELECT 1 FROM classroom_teachers scoped_teacher
              INNER JOIN classrooms scoped_classroom ON scoped_classroom.id = scoped_teacher.classroom_id
              WHERE scoped_teacher.classroom_id = homework.classroom_id
                AND scoped_teacher.teacher_id = ?
                AND scoped_classroom.status = 'ACTIVE'
            )
          )
        LIMIT 1
      `)
      .get(
        input.audioUrl,
        input.staffScope.userId,
        input.staffScope.userId,
        input.audioUrl,
        input.staffScope.userId,
        input.staffScope.userId,
      );
    return Boolean(row);
  }

  canAccessFeedbackAudio(input: {
    audioUrl: string;
    userId: string;
    isStaff: boolean;
    staffScope?: StaffScope;
  }): boolean {
    if (!isPrivateFeedbackAudioUrl(input.audioUrl)) return false;
    if (input.isStaff && (!input.staffScope || input.staffScope.role === "ADMIN")) {
      const row = this.database
        .prepare(`
          SELECT 1 FROM (
            SELECT feedback_audio_url FROM homework_card_submissions WHERE feedback_audio_url IS NOT NULL
            UNION ALL
            SELECT feedback_audio_url FROM homework_item_submissions WHERE feedback_audio_url IS NOT NULL
          ) feedback
          WHERE feedback.feedback_audio_url = ?
          LIMIT 1
        `)
        .get(input.audioUrl);
      return Boolean(row);
    }
    const row = this.database
      .prepare(`
        SELECT 1 FROM homework_card_submissions submission
        INNER JOIN homework_occurrences occurrence ON occurrence.id = submission.occurrence_id
        INNER JOIN homeworks homework ON homework.id = occurrence.homework_id
        WHERE submission.feedback_audio_url = ?
          AND (
            (? = 0 AND submission.student_id = ?)
            OR (? = 1 AND (
              (homework.classroom_id IS NULL AND homework.publisher_id = ?)
              OR EXISTS (
                SELECT 1 FROM classroom_teachers scoped_teacher
                INNER JOIN classrooms scoped_classroom ON scoped_classroom.id = scoped_teacher.classroom_id
                WHERE scoped_teacher.classroom_id = homework.classroom_id
                  AND scoped_teacher.teacher_id = ?
                  AND scoped_classroom.status = 'ACTIVE'
              )
            ))
          )
        UNION ALL
        SELECT 1 FROM homework_item_submissions submission
        INNER JOIN homework_occurrences occurrence ON occurrence.id = submission.occurrence_id
        INNER JOIN homework_items item ON item.id = submission.item_id
        INNER JOIN homeworks homework ON homework.id = item.homework_id
        WHERE submission.feedback_audio_url = ?
          AND (
            (? = 0 AND submission.student_id = ?)
            OR (? = 1 AND (
              (homework.classroom_id IS NULL AND homework.publisher_id = ?)
              OR EXISTS (
                SELECT 1 FROM classroom_teachers scoped_teacher
                INNER JOIN classrooms scoped_classroom ON scoped_classroom.id = scoped_teacher.classroom_id
                WHERE scoped_teacher.classroom_id = homework.classroom_id
                  AND scoped_teacher.teacher_id = ?
                  AND scoped_classroom.status = 'ACTIVE'
              )
            ))
          )
        LIMIT 1
      `)
      .get(
        input.audioUrl,
        Number(input.isStaff),
        input.userId,
        Number(input.isStaff),
        input.staffScope?.userId ?? "",
        input.staffScope?.userId ?? "",
        input.audioUrl,
        Number(input.isStaff),
        input.userId,
        Number(input.isStaff),
        input.staffScope?.userId ?? "",
        input.staffScope?.userId ?? "",
      );
    return Boolean(row);
  }

  reviewPracticeRecordingSubmission(input: {
    submissionId: string;
    grade: "A" | "B" | "C" | "D";
    feedbackAudioUrl?: string;
    scope?: StaffScope;
  }) {
    const reviewedAt = new Date().toISOString();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.consumeFeedbackUpload({
        url: input.feedbackAudioUrl,
        uploaderId: input.scope?.userId,
        submissionId: input.submissionId,
        consumedAt: reviewedAt,
      });
      const changed = this.database
        .prepare(`
          UPDATE homework_item_submissions
          SET grade = ?,
            feedback_audio_url = CASE WHEN ? = 1 THEN ? ELSE feedback_audio_url END,
            reviewed_at = ?
          WHERE id = ? AND submission_type = 'RECORDING' AND (
            ? = 'ADMIN' OR EXISTS (
              SELECT 1 FROM homework_occurrences occurrence
              INNER JOIN homework_items item ON item.id = homework_item_submissions.item_id
              INNER JOIN homeworks homework ON homework.id = item.homework_id
              WHERE occurrence.id = homework_item_submissions.occurrence_id
                AND ((homework.classroom_id IS NULL AND homework.publisher_id = ?) OR EXISTS (
                  SELECT 1 FROM classroom_teachers scoped_teacher
                  INNER JOIN classrooms scoped_classroom ON scoped_classroom.id = scoped_teacher.classroom_id
                  WHERE scoped_teacher.classroom_id = homework.classroom_id
                    AND scoped_teacher.teacher_id = ?
                    AND scoped_classroom.status = 'ACTIVE'
                ))
            )
          ) AND NOT EXISTS (
            SELECT 1 FROM homework_item_submissions newer
            WHERE newer.occurrence_id = homework_item_submissions.occurrence_id
              AND newer.item_id = homework_item_submissions.item_id
              AND newer.student_id = homework_item_submissions.student_id
              AND newer.attempt_number > homework_item_submissions.attempt_number
          )
        `)
        .run(
          input.grade,
          Number(input.feedbackAudioUrl !== undefined),
          input.feedbackAudioUrl ?? null,
          reviewedAt,
          input.submissionId,
          input.scope?.role ?? "ADMIN",
          input.scope?.userId ?? "",
          input.scope?.userId ?? "",
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
      this.database.exec("COMMIT");
      return mapPracticeRecordingSubmission(reviewed);
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
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

  listSpeechAssessments(input: {
    page: number;
    pageSize: number;
    status?: string;
    scope?: StaffScope;
  }): SpeechAssessmentQueueResult {
    const offset = (input.page - 1) * input.pageSize;
    const clauses: string[] = [];
    const values: SQLInputValue[] = [];
    if (input.status) {
      clauses.push("assessment.status = ?");
      values.push(input.status);
    }
    appendStaffHomeworkScope(clauses, values, input.scope, "homework");
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const baseSql = `
      FROM speech_assessments assessment
      INNER JOIN (
        SELECT
          submission.id AS submission_id,
          submission.student_id,
          student.display_name AS student_name,
          homework.id AS homework_id,
          homework.title AS homework_title,
          homework.classroom_id,
          classroom.name AS classroom_name
        FROM homework_card_submissions submission
        INNER JOIN users student ON student.id = submission.student_id
        INNER JOIN homework_occurrences occurrence ON occurrence.id = submission.occurrence_id
        INNER JOIN homework_cards card ON card.id = submission.card_id
        INNER JOIN homeworks homework ON homework.id = card.homework_id
        LEFT JOIN classrooms classroom ON classroom.id = homework.classroom_id
        UNION ALL
        SELECT
          submission.id AS submission_id,
          submission.student_id,
          student.display_name AS student_name,
          homework.id AS homework_id,
          homework.title AS homework_title,
          homework.classroom_id,
          classroom.name AS classroom_name
        FROM homework_item_submissions submission
        INNER JOIN users student ON student.id = submission.student_id
        INNER JOIN homework_occurrences occurrence ON occurrence.id = submission.occurrence_id
        INNER JOIN homework_items item ON item.id = submission.item_id
        INNER JOIN homeworks homework ON homework.id = item.homework_id
        LEFT JOIN classrooms classroom ON classroom.id = homework.classroom_id
      ) linked ON linked.submission_id = assessment.submission_id
      INNER JOIN homeworks homework ON homework.id = linked.homework_id
      ${where}
    `;
    const rows = this.database
      .prepare(`
        SELECT assessment.id, assessment.submission_id, assessment.source_kind,
          assessment.status, assessment.provider, assessment.reference_text,
          assessment.locale, assessment.duration_seconds, assessment.attempt_count,
          assessment.last_error, assessment.next_attempt_at, assessment.completed_at,
          assessment.created_at, assessment.updated_at,
          linked.student_id, linked.student_name, linked.homework_id,
          linked.homework_title, linked.classroom_id, linked.classroom_name
        ${baseSql}
        ORDER BY assessment.updated_at DESC, assessment.created_at DESC
        LIMIT ? OFFSET ?
      `)
      .all(...values, input.pageSize, offset) as Array<Record<string, unknown>>;
    const totalRow = this.database
      .prepare(`SELECT COUNT(*) AS count ${baseSql}`)
      .get(...values) as { count: number };
    return {
      assessments: rows.map(mapSpeechAssessmentQueueRow),
      pagination: { page: input.page, pageSize: input.pageSize, total: Number(totalRow.count) },
      summary: this.countSpeechAssessmentsByStatus(input.scope),
    };
  }

  private countSpeechAssessmentsByStatus(scope?: StaffScope): Record<SpeechAssessmentStatus, number> {
    const clauses: string[] = [];
    const values: SQLInputValue[] = [];
    appendStaffHomeworkScope(clauses, values, scope, "homework");
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.database
      .prepare(`
        SELECT assessment.status, COUNT(*) AS count
        FROM speech_assessments assessment
        INNER JOIN (
          SELECT submission.id AS submission_id, homework.id AS homework_id
          FROM homework_card_submissions submission
          INNER JOIN homework_cards card ON card.id = submission.card_id
          INNER JOIN homeworks homework ON homework.id = card.homework_id
          UNION ALL
          SELECT submission.id AS submission_id, homework.id AS homework_id
          FROM homework_item_submissions submission
          INNER JOIN homework_items item ON item.id = submission.item_id
          INNER JOIN homeworks homework ON homework.id = item.homework_id
        ) linked ON linked.submission_id = assessment.submission_id
        INNER JOIN homeworks homework ON homework.id = linked.homework_id
        ${where}
        GROUP BY assessment.status
      `)
      .all(...values) as Array<{ status: SpeechAssessmentStatus; count: number }>;
    const summary: Record<SpeechAssessmentStatus, number> = {
      QUEUED: 0,
      PROCESSING: 0,
      COMPLETED: 0,
      FAILED: 0,
    };
    for (const row of rows) summary[row.status] = Number(row.count);
    return summary;
  }

  retrySpeechAssessment(input: { assessmentId: string; scope?: StaffScope }): SpeechAssessmentQueueItem {
    const scoped = this.getSpeechAssessmentQueueItem(input.assessmentId, input.scope);
    if (!scoped) throw new SpeechAssessmentAccessError();
    if (scoped.status !== SPEECH_ASSESSMENT_STATUSES.FAILED) {
      throw new SpeechAssessmentRetryError();
    }
    const now = new Date().toISOString();
    const changed = this.database
      .prepare(`
        UPDATE speech_assessments
        SET status = 'QUEUED', provider = NULL, attempt_count = 0,
          next_attempt_at = ?, lease_expires_at = NULL, lease_token = NULL,
          last_error = NULL, updated_at = ?
        WHERE id = ? AND status = 'FAILED'
      `)
      .run(now, now, input.assessmentId);
    if (Number(changed.changes) !== 1) throw new SpeechAssessmentRetryError();
    return this.getSpeechAssessmentQueueItem(input.assessmentId, input.scope)!;
  }

  private getSpeechAssessmentQueueItem(
    assessmentId: string,
    scope?: StaffScope,
  ): SpeechAssessmentQueueItem | null {
    const clauses = ["assessment.id = ?"];
    const values: SQLInputValue[] = [assessmentId];
    appendStaffHomeworkScope(clauses, values, scope, "homework");
    const row = this.database
      .prepare(`
        SELECT assessment.id, assessment.submission_id, assessment.source_kind,
          assessment.status, assessment.provider, assessment.reference_text,
          assessment.locale, assessment.duration_seconds, assessment.attempt_count,
          assessment.last_error, assessment.next_attempt_at, assessment.completed_at,
          assessment.created_at, assessment.updated_at,
          linked.student_id, linked.student_name, linked.homework_id,
          linked.homework_title, linked.classroom_id, linked.classroom_name
        FROM speech_assessments assessment
        INNER JOIN (
          SELECT
            submission.id AS submission_id,
            submission.student_id,
            student.display_name AS student_name,
            homework.id AS homework_id,
            homework.title AS homework_title,
            homework.classroom_id,
            classroom.name AS classroom_name
          FROM homework_card_submissions submission
          INNER JOIN users student ON student.id = submission.student_id
          INNER JOIN homework_occurrences occurrence ON occurrence.id = submission.occurrence_id
          INNER JOIN homework_cards card ON card.id = submission.card_id
          INNER JOIN homeworks homework ON homework.id = card.homework_id
          LEFT JOIN classrooms classroom ON classroom.id = homework.classroom_id
          UNION ALL
          SELECT
            submission.id AS submission_id,
            submission.student_id,
            student.display_name AS student_name,
            homework.id AS homework_id,
            homework.title AS homework_title,
            homework.classroom_id,
            classroom.name AS classroom_name
          FROM homework_item_submissions submission
          INNER JOIN users student ON student.id = submission.student_id
          INNER JOIN homework_occurrences occurrence ON occurrence.id = submission.occurrence_id
          INNER JOIN homework_items item ON item.id = submission.item_id
          INNER JOIN homeworks homework ON homework.id = item.homework_id
          LEFT JOIN classrooms classroom ON classroom.id = homework.classroom_id
        ) linked ON linked.submission_id = assessment.submission_id
        INNER JOIN homeworks homework ON homework.id = linked.homework_id
        WHERE ${clauses.join(" AND ")}
        LIMIT 1
      `)
      .get(...values) as Record<string, unknown> | undefined;
    return row ? mapSpeechAssessmentQueueRow(row) : null;
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
            AND EXISTS (
              SELECT 1 FROM homeworks h
              WHERE h.id = homework_occurrences.homework_id AND h.status = 'PUBLISHED'
            )
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
      if (!row.completed_at) {
        const published = this.database
          .prepare(`
            SELECT homework.classroom_id FROM homework_learning_sessions session
            INNER JOIN homework_occurrences occurrence ON occurrence.id = session.occurrence_id
            INNER JOIN homeworks homework ON homework.id = occurrence.homework_id
            WHERE session.id = ? AND session.student_id = ? AND homework.status = 'PUBLISHED'
            LIMIT 1
          `)
          .get(input.sessionId, input.studentId) as { classroom_id: string | null } | undefined;
        if (!published) throw new HomeworkSessionNotFoundError();
      }
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
      const sessionClassroom = this.database
        .prepare(`
          SELECT homework.classroom_id FROM homework_learning_sessions session
          INNER JOIN homework_occurrences occurrence ON occurrence.id = session.occurrence_id
          INNER JOIN homeworks homework ON homework.id = occurrence.homework_id
          WHERE session.id = ?
          LIMIT 1
        `)
        .get(input.sessionId) as { classroom_id: string | null } | undefined;
      this.addDailyLearning(input.studentId, completedAt, 0, creditedSeconds, sessionClassroom?.classroom_id ?? null);
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
    const byDate = new Map(checkins.map((day) => [day.checkinDate, day]));
    const recentDays = Array.from({ length: 7 }, (_, index) => {
      const checkinDate = shiftCalendarDate(today, index - 6);
      const day = byDate.get(checkinDate);
      return {
        checkinDate,
        voiceSeconds: day?.voiceSeconds ?? 0,
        homeworkSeconds: day?.homeworkSeconds ?? 0,
      };
    });
    return {
      summary: {
        checkinDays: checkins.length,
        currentStreak,
        voiceSeconds: checkins.reduce((total, day) => total + day.voiceSeconds, 0),
        homeworkSeconds: checkins.reduce((total, day) => total + day.homeworkSeconds, 0),
      },
      checkins,
      recentDays,
    };
  }

  listStudentHomeworkHistory(input: { studentId: string; page: number; pageSize: number; currentTime?: Date }) {
    const now = (input.currentTime ?? new Date()).toISOString();
    const offset = (input.page - 1) * input.pageSize;
    const rows = this.database
      .prepare(`
        SELECT o.id, o.homework_id, o.status AS occurrence_status, o.scheduled_at,
          h.title, h.template_type, h.status AS homework_status
        FROM homework_occurrences o
        INNER JOIN homeworks h ON h.id = o.homework_id
        WHERE o.student_id = ? AND o.scheduled_at <= ?
        ORDER BY o.scheduled_at DESC, o.id DESC
        LIMIT ? OFFSET ?
      `)
      .all(input.studentId, now, input.pageSize, offset) as Array<Record<string, unknown>>;
    const totalRow = this.database
      .prepare(`
        SELECT COUNT(*) AS count
        FROM homework_occurrences
        WHERE student_id = ? AND scheduled_at <= ?
      `)
      .get(input.studentId, now) as { count: number };
    const occurrences = rows.map((row) => {
      const templateType = String(row.template_type);
      const occurrenceId = String(row.id);
      const homeworkId = String(row.homework_id);
      const counts = templateType === HOMEWORK_TEMPLATE_TYPES.READ_ALOUD_PICTURE_BOOK
        ? this.getReadingHistoryCounts(occurrenceId, homeworkId, input.studentId)
        : this.getPracticeHistoryCounts(occurrenceId, homeworkId, input.studentId, templateType);
      return {
        id: occurrenceId,
        title: String(row.title),
        templateType,
        scheduledAt: String(row.scheduled_at),
        homeworkStatus: String(row.homework_status),
        occurrenceStatus: String(row.occurrence_status),
        ...counts,
      };
    });
    return {
      occurrences,
      pagination: { page: input.page, pageSize: input.pageSize, total: Number(totalRow.count) },
    };
  }

  private getReadingHistoryCounts(occurrenceId: string, homeworkId: string, studentId: string) {
    const total = this.database
      .prepare("SELECT COUNT(*) AS count FROM homework_cards WHERE homework_id = ?")
      .get(homeworkId) as { count: number };
    const completed = this.database
      .prepare(`
        SELECT COUNT(DISTINCT card_id) AS count
        FROM homework_card_submissions
        WHERE occurrence_id = ? AND student_id = ?
      `)
      .get(occurrenceId, studentId) as { count: number };
    const reviewed = this.database
      .prepare(`
        SELECT COUNT(*) AS count FROM homework_cards card
        INNER JOIN homework_card_submissions latest ON latest.id = (
          SELECT submission.id FROM homework_card_submissions submission
          WHERE submission.occurrence_id = ? AND submission.card_id = card.id
            AND submission.student_id = ?
          ORDER BY submission.attempt_number DESC LIMIT 1
        )
        WHERE card.homework_id = ? AND (latest.reviewed_at IS NOT NULL OR latest.grade IS NOT NULL)
      `)
      .get(occurrenceId, studentId, homeworkId) as { count: number };
    return {
      completedCount: Number(completed.count),
      totalCount: Number(total.count),
      reviewedCount: Number(reviewed.count),
    };
  }

  private getPracticeHistoryCounts(
    occurrenceId: string,
    homeworkId: string,
    studentId: string,
    templateType: string,
  ) {
    const total = this.database
      .prepare("SELECT COUNT(*) AS count FROM homework_items WHERE homework_id = ?")
      .get(homeworkId) as { count: number };
    const completedSql = isRecordingHomeworkTemplate(templateType)
      ? `
        SELECT COUNT(DISTINCT item_id) AS count
        FROM homework_item_submissions
        WHERE occurrence_id = ? AND student_id = ? AND submission_type = 'RECORDING'
      `
      : `
        SELECT COUNT(DISTINCT item_id) AS count
        FROM homework_item_submissions
        WHERE occurrence_id = ? AND student_id = ? AND is_correct = 1
      `;
    const completed = this.database
      .prepare(completedSql)
      .get(occurrenceId, studentId) as { count: number };
    const reviewed = isRecordingHomeworkTemplate(templateType)
      ? this.database
        .prepare(`
          SELECT COUNT(*) AS count FROM homework_items item
          INNER JOIN homework_item_submissions latest ON latest.id = (
            SELECT submission.id FROM homework_item_submissions submission
            WHERE submission.occurrence_id = ? AND submission.item_id = item.id
              AND submission.student_id = ? AND submission.submission_type = 'RECORDING'
            ORDER BY submission.attempt_number DESC LIMIT 1
          )
          WHERE item.homework_id = ? AND (latest.reviewed_at IS NOT NULL OR latest.grade IS NOT NULL)
        `)
        .get(occurrenceId, studentId, homeworkId) as { count: number }
      : { count: 0 };
    return {
      completedCount: Number(completed.count),
      totalCount: Number(total.count),
      reviewedCount: Number(reviewed.count),
    };
  }

  private addDailyLearning(
    studentId: string,
    activityAt: Date,
    voiceSeconds: number,
    homeworkSeconds: number,
    classroomId: string | null = null,
  ) {
    const activityAtIso = activityAt.toISOString();
    const checkinDate = getShanghaiDate(activityAt);
    const existing = this.database
      .prepare(`
        SELECT 1 FROM student_daily_learning
        WHERE student_id = ? AND checkin_date = ?
        LIMIT 1
      `)
      .get(studentId, checkinDate);
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
        checkinDate,
        activityAtIso,
        voiceSeconds,
        homeworkSeconds,
        activityAtIso,
      );
    if (!existing) {
      const policy = this.getPolicyForClassroom(classroomId);
      this.addPointEvent({
        studentId,
        eventType: STUDENT_POINT_EVENTS.DAILY_CHECKIN.type,
        sourceId: checkinDate,
        points: policy.dailyCheckinPoints,
        occurredAt: activityAtIso,
        classroomId,
      });
      const streak = this.getCheckinStreakOnDate(studentId, checkinDate);
      const reward = policy.streakRewards.find((candidate) => candidate.days === streak);
      if (reward) {
        this.addPointEvent({
          studentId,
          eventType: STUDENT_POINT_EVENTS.STREAK_BONUS.type,
          sourceId: `${checkinDate}:${reward.days}`,
          points: reward.points,
          occurredAt: activityAtIso,
          classroomId,
        });
      }
    }
  }

  private getCheckinStreakOnDate(studentId: string, checkinDate: string): number {
    const rows = this.database
      .prepare(`
        SELECT checkin_date FROM student_daily_learning
        WHERE student_id = ? AND checkin_date <= ?
        ORDER BY checkin_date DESC
      `)
      .all(studentId, checkinDate) as Array<{ checkin_date: string }>;
    let expected = checkinDate;
    let streak = 0;
    for (const row of rows) {
      if (String(row.checkin_date) !== expected) break;
      streak += 1;
      expected = shiftCalendarDate(expected, -1);
    }
    return streak;
  }

  deleteAll() {
    this.database.exec(`
      DELETE FROM feedback_uploads;
      DELETE FROM homework_learning_sessions;
      DELETE FROM student_point_events;
      DELETE FROM classroom_streak_rewards;
      DELETE FROM classroom_point_policies;
      DELETE FROM student_profiles;
      DELETE FROM student_daily_learning;
      DELETE FROM speech_assessments;
      DELETE FROM homework_item_submissions;
      DELETE FROM homework_card_submissions;
      DELETE FROM homework_occurrences;
      DELETE FROM homework_items;
      DELETE FROM homework_cards;
      DELETE FROM homework_recipients;
      DELETE FROM homeworks;
      DELETE FROM classroom_teachers;
      DELETE FROM classroom_students;
      DELETE FROM classrooms;
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


function mapStudentProfileRow(row: Record<string, unknown>): StudentProfileRecord {
  return {
    studentId: String(row.student_id),
    englishName: row.english_name ? String(row.english_name) : null,
    schoolName: row.school_name ? String(row.school_name) : null,
    gradeLevel: row.grade_level ? String(row.grade_level) : null,
    learningGoal: row.learning_goal ? String(row.learning_goal) : null,
    updatedAt: String(row.updated_at),
  };
}

function mapStudentPointEventRow(row: Record<string, unknown>): StudentPointEventRecord {
  return {
    id: String(row.id),
    studentId: String(row.student_id),
    type: String(row.event_type),
    sourceId: String(row.source_id),
    points: Number(row.points),
    occurredAt: String(row.occurred_at),
    classroomId: row.classroom_id ? String(row.classroom_id) : null,
    classroomName: row.classroom_name ? String(row.classroom_name) : null,
  };
}

function mapClassroomRow(row: Record<string, unknown>): ClassroomRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    status: String(row.status),
    creatorId: String(row.creator_id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapClassroomMember(user: UserRecord): ClassroomMember {
  return {
    id: user.id,
    phone: user.phone,
    displayName: user.displayName,
    role: user.role,
    status: user.status,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function mapHomeworkRow(row: Record<string, unknown>): HomeworkRecord {
  return {
    id: String(row.id),
    publisherId: String(row.publisher_id),
    classroomId: row.classroom_id ? String(row.classroom_id) : null,
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

function mapHomeworkSummaryRow(row: Record<string, unknown>): HomeworkSummary {
  return {
    ...mapHomeworkRow(row),
    publisherName: String(row.publisher_name),
    classroomName: row.classroom_name ? String(row.classroom_name) : null,
    classroomStatus: row.classroom_status ? String(row.classroom_status) : null,
    targetCount: Number(row.target_count),
    occurrenceCount: Number(row.occurrence_count),
    completedOccurrenceCount: Number(row.completed_occurrence_count),
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

function mapSpeechAssessmentQueueRow(row: Record<string, unknown>): SpeechAssessmentQueueItem {
  return {
    id: String(row.id),
    submissionId: String(row.submission_id),
    sourceKind: String(row.source_kind),
    status: String(row.status),
    provider: row.provider ? String(row.provider) : null,
    referenceText: String(row.reference_text),
    locale: String(row.locale),
    durationSeconds: row.duration_seconds === null || row.duration_seconds === undefined
      ? null
      : Number(row.duration_seconds),
    attemptCount: Number(row.attempt_count),
    lastError: row.last_error ? String(row.last_error) : null,
    nextAttemptAt: String(row.next_attempt_at),
    completedAt: row.completed_at ? String(row.completed_at) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    studentId: String(row.student_id),
    studentName: String(row.student_name),
    homeworkId: String(row.homework_id),
    homeworkTitle: String(row.homework_title),
    classroomId: row.classroom_id ? String(row.classroom_id) : null,
    classroomName: row.classroom_name ? String(row.classroom_name) : null,
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
